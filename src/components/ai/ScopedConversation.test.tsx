import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScopedConversation } from './ScopedConversation';
import type { ScopedConversationView } from '@/lib/ai/descriptionOperationTypes';
const fake = vi.hoisted(() => ({ request: vi.fn(), update: vi.fn() }));
vi.mock('@/lib/ai/scopedConversationClient', () => ({ requestDescription: fake.request, requestReplyDraft: fake.request, updateDescription: fake.update, unsavedReply: () => null }));
vi.mock('@/stores/aiSettingsStore', () => ({ useAISettingsStore: () => ({ provider: 'gemini', getActiveModel: () => 'test' }) }));
vi.mock('@/lib/firebase/testMode', () => ({ isE2EMockAuthEnabled: () => true }));
vi.mock('./ToolConfirmDialog', () => ({ ToolConfirmDialog: () => null }));
beforeEach(() => vi.clearAllMocks());
describe('Scoped conversation failure recovery', () => {
  it('keeps failed input and retries its saved ID after reopening, clearing only that same input', async () => {
    const view: ScopedConversationView = { mode: 'draft', conversationId: 'draft-ui-1', title: '返信案', messages: [] };
    let savedId = ''; let fail = true;
    fake.request.mockImplementation(async (_uid, request) => {
      if (request.action === 'read') return structuredClone(view);
      savedId ||= request.requestId;
      expect(request.requestId).toBe(savedId);
      view.messages = [{ id: savedId, role: 'user', content: request.content, createdAt: '', retry: true }];
      if (fail) throw new Error('保存を確認できません。');
      view.messages = [...view.messages.map(m => ({ ...m, retry: false })), { id: `reply-${savedId}`, role: 'assistant', content: '返信本文', createdAt: '' }];
      return structuredClone(view);
    });
    const props = { userId: 'ui-user', conversationId: view.conversationId, mode: 'draft' as const, onBack: vi.fn() };
    const mounted = render(<ScopedConversation {...props} />);
    await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '返信案を短くして' } });
    fireEvent.click(screen.getByRole('button', { name: '送信' }));
    await screen.findByRole('alert'); expect(screen.getByRole('textbox')).toHaveValue('返信案を短くして');
    mounted.unmount(); fail = false;
    render(<ScopedConversation {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: '同じ依頼を再試行' }));
    await screen.findByText('返信本文'); await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''));
    expect(fake.update).not.toHaveBeenCalled();
  });
});
