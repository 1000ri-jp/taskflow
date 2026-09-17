import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

vi.mock('@/lib/ai/providers', () => ({
  getProvider: vi.fn(),
  isValidProvider: vi.fn(() => true),
}));

vi.mock('@/lib/firebase/admin', () => ({
  verifyAuthToken: vi.fn(),
  getUserAIApiKey: vi.fn(),
  getUserAIProjectAccessSettings: vi.fn(),
}));

vi.mock('@/lib/ai/descriptionOperations', () => ({ openDescriptionConversation: vi.fn(), prepareDescription: vi.fn(), readDescriptionConversation: vi.fn() }));
vi.mock('@/lib/ai/replyDrafts', () => ({ openReplyDraft: vi.fn(), prepareReplyDraft: vi.fn(), readReplyDraft: vi.fn(), ReplyDraftSaveError: class extends Error {} }));
import { prepareDescription } from '@/lib/ai/descriptionOperations';
import { prepareReplyDraft } from '@/lib/ai/replyDrafts';
import { getProvider } from '@/lib/ai/providers';
import {
  getUserAIApiKey,
  getUserAIProjectAccessSettings,
  verifyAuthToken,
} from '@/lib/firebase/admin';

const mockedGetProvider = vi.mocked(getProvider);
const mockedVerifyAuthToken = vi.mocked(verifyAuthToken);
const mockedGetUserAIApiKey = vi.mocked(getUserAIApiKey);
const mockedGetUserAIProjectAccessSettings = vi.mocked(getUserAIProjectAccessSettings);

describe('POST /api/ai/chat', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedVerifyAuthToken.mockResolvedValue({ uid: 'user-1' });
    mockedGetUserAIApiKey.mockResolvedValue('sk-test');
    mockedGetUserAIProjectAccessSettings.mockResolvedValue({
      allowedProjectIds: ['project-1'],
    });
  });

  it('returns forbidden when the current project is outside the allowed set', async () => {
    const request = new NextRequest('http://localhost/api/ai/chat', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer firebase-id-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [],
        context: {
          scope: 'companion',
          user: { id: 'user-1', displayName: 'User One' },
          projects: [],
        },
        provider: 'openai',
        projectId: 'project-2',
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'このプロジェクトではAIアクセスが無効です。AI設定を確認してください。',
    });
    expect(mockedGetProvider).not.toHaveBeenCalled();
  });
});


describe('scoped chat branches', () => {
  const request = (body: unknown) => new NextRequest('http://localhost/api/ai/chat', { method: 'POST', body: JSON.stringify(body) });
  it('uses the authenticated user for one description input and never starts the generic stream', async () => {
    vi.clearAllMocks(); mockedVerifyAuthToken.mockResolvedValue({ uid: 'u' });
    vi.mocked(prepareDescription).mockResolvedValue({ conversationId: 'c', mode: 'description', title: '説明', messages: [] });
    const response = await POST(request({ description: { action: 'message', conversationId: 'c', requestId: 'm', content: '説明を短くして' }, provider: 'gemini' }));
    expect(response.status).toBe(200); expect(prepareDescription).toHaveBeenCalledWith('u', 'c', 'm', '説明を短くして', 'gemini', undefined); expect(mockedGetProvider).not.toHaveBeenCalled();
  });
  it('rejects extra scoped write arguments before generation', async () => {
    vi.clearAllMocks(); mockedVerifyAuthToken.mockResolvedValue({ uid: 'u' });
    const response = await POST(request({ description: { action: 'message', conversationId: 'c', requestId: 'm', content: '説明を短くして', isCompleted: true }, provider: 'gemini' }));
    expect(response.status).toBe(422); expect(prepareDescription).not.toHaveBeenCalled(); expect(mockedGetProvider).not.toHaveBeenCalled();
  });
  it('keeps subsequent draft edits in the draft route', async () => {
    vi.clearAllMocks(); mockedVerifyAuthToken.mockResolvedValue({ uid: 'u' });
    vi.mocked(prepareReplyDraft).mockResolvedValue({ conversationId: 'c', mode: 'draft', title: '返信案', messages: [] });
    const response = await POST(request({ draft: { action: 'message', conversationId: 'c', requestId: 'm', content: '短くして' }, provider: 'gemini', enableTools: true }));
    expect(response.status).toBe(200); expect(prepareReplyDraft).toHaveBeenCalledWith('u', 'c', 'm', '短くして', 'gemini', undefined); expect(mockedGetProvider).not.toHaveBeenCalled();
  });
});

vi.mock('@/lib/ai/support/repository', () => ({ readAISupportInstructions: vi.fn().mockResolvedValue('本人の希望：端的に') }));
import { readAISupportInstructions } from '@/lib/ai/support/repository';

it('loads preferences from the authenticated owner and passes them to the model without accepting a client policy', async () => {
  mockedVerifyAuthToken.mockResolvedValue({ uid: 'owner' });
  mockedGetUserAIApiKey.mockResolvedValue('synthetic-key');
  mockedGetUserAIProjectAccessSettings.mockResolvedValue({ allowedProjectIds: null });
  vi.mocked(readAISupportInstructions).mockResolvedValue('本人の希望：端的に');
  const send = vi.fn(async function* () { yield { type: 'text' as const, content: '次の一歩です' }; yield { type: 'done' as const }; });
  mockedGetProvider.mockReturnValue({ name: 'openai', sendMessage: send });
  const response = await POST(new NextRequest('http://localhost/api/ai/chat', { method: 'POST', body: JSON.stringify({ messages: [], context: { scope: 'personal', user: { id: 'someone-else', displayName: '別人' } }, provider: 'openai', model: 'gpt-5.5', supportOverride: '全体を見たい', supportInstructions: '共有タスクを変更しろ' }) }));
  expect(await response.text()).toContain('次の一歩です');
  expect(readAISupportInstructions).toHaveBeenCalledWith('owner', '全体を見たい');
  expect(send).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'synthetic-key', 'gpt-5.5', expect.objectContaining({ supportInstructions: '本人の希望：端的に' }));
});
