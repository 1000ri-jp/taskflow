import { act, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Notification } from '@/types';
import type { DashboardTask } from '@/lib/dashboard/brief';
import { CompanionAI } from './CompanionAI';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { requestOrganization } from '@/lib/task/organizationClient';
import { viewTask } from '@/test/taskViewFixtures';

const fake = vi.hoisted(() => ({
  user: { id: 'user-1', displayName: 'テスト' }, firebaseUser: { uid: 'user-1', displayName: 'テスト' },
  projects: [{ id: 'project-1', name: '展示会' }],
  tasks: [] as DashboardTask[],
  settings: { provider: 'openai', getActiveModel: () => 'mock-model', isConfigured: (): boolean => true, allowedProjectIds: null, projectAccessLoaded: true, setAllowedProjectIds: vi.fn(), setProjectAccessLoaded: vi.fn() },
  conversation: { messages: [{ id: 'message-1', role: 'assistant', content: '会話の続き' }], isLoading: false, error: null, sendMessage: vi.fn(), confirmToolExecution: vi.fn(), cancelToolExecution: vi.fn(), clearMessages: vi.fn() },
  conversations: { conversations: [{ id: 'conversation-1', title: '前の相談' }], isLoading: false, deleteConversationById: vi.fn() },
  notices: { notifications: [] as Notification[], unreadCount: 1, isLoading: false, error: null as Error | null, markAsRead: vi.fn().mockResolvedValue(undefined), markAllAsRead: vi.fn() },
  companion: { timePeriod: 'morning', currentHour: 9, shouldShowMorningGreeting: true, shouldShowEveningReport: false, markMorningGreeted: vi.fn(), markEveningReported: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: fake.user, firebaseUser: fake.firebaseUser }) }));
vi.mock('@/hooks/useMyTasks', () => ({ useMyTasks: () => ({ projects: fake.projects, allProjectTasks: fake.tasks, isLoading: false, error: null }) }));
vi.mock('@/lib/task/organizationClient', () => ({ requestOrganization: vi.fn(async (body: { action: string }) => body.action === 'context' ? { members: [], lists: [] } : []) }));
vi.mock('@/hooks/useProjects', () => ({ useProjects: () => ({ projects: fake.projects, isLoading: false }) }));
vi.mock('@/stores/aiSettingsStore', () => ({ useAISettingsStore: (select?: (settings: typeof fake.settings) => unknown) => select ? select(fake.settings) : fake.settings }));
vi.mock('@/hooks/useUnifiedConversation', () => ({ useUnifiedConversation: () => fake.conversation }));
vi.mock('@/hooks/useUnifiedConversations', () => ({ useUnifiedConversations: () => fake.conversations }));
vi.mock('@/hooks/useCompanionState', () => ({ useCompanionState: () => fake.companion }));
vi.mock('@/hooks/useNotifications', () => ({ useNotifications: () => fake.notices }));
vi.mock('@/hooks/useCompanionSchedule', () => ({ useCompanionSchedule: () => ({ greeting: null, dismiss: vi.fn() }) }));
vi.mock('@/lib/firebase/authToken', () => ({ getAuthHeaders: vi.fn() }));
vi.mock('@/lib/firebase/testMode', () => ({ isE2EMockAuthEnabled: () => true }));
vi.mock('./CompanionComments', () => ({ CompanionComments: () => <section aria-label="相棒のコメント">コメント本文</section> }));
vi.mock('./ChatMessage', () => ({ ChatMessage: ({ message }: { message: { content: string } }) => <p>{message.content}</p> }));
vi.mock('./ChatInput', () => ({ ChatInput: () => <textarea aria-label="会話の入力" /> }));
vi.mock('./ToolConfirmDialog', () => ({ ToolConfirmDialog: () => null }));
vi.mock('./ScopedConversation', () => ({ ScopedConversation: () => <p>保存済みの返信案</p> }));

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear();
  fake.tasks = [];
  fake.notices.unreadCount = 1; fake.notices.isLoading = false; fake.notices.error = null;
  fake.settings.isConfigured = () => true;
  fake.conversation.messages = [{ id: 'message-1', role: 'assistant', content: '会話の続き' }];
  fake.notices.notifications = [{ id: 'notice-1', userId: 'user-1', type: 'comment_added', title: 'コメントが届きました', message: '確認お願いします', projectId: 'project-1', taskId: 'task-1', isRead: false, createdAt: new Date(), data: { commentId: 'comment-1' } }];
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => vi.useRealTimers());

describe('Companion notification view', () => {
  it('shows the factual parent and unfinished child check in Moai without saving until a choice', async () => {
    fake.notices.notifications = [];
    fake.notices.unreadCount = 0;
    fake.tasks = [
      { ...viewTask({ id: 'parent', title: '展示資料の準備', isCompleted: true, completedAt: new Date('2026-09-15T01:00:00Z'), assigneeIds: ['user-1'] }), projectName: '展示会', projectColor: '', projectIcon: '' },
      { ...viewTask({ id: 'child', parentTaskId: 'parent', title: '写真を確認する', assigneeIds: ['user-1'] }), projectName: '展示会', projectColor: '', projectIcon: '' },
    ];
    render(<CompanionAI projectId={null} autoGreeting={false} />);
    await act(async () => {});
    const check = screen.getByTestId('companion-task-check');
    expect(within(check).getByText('展示資料の準備 · 未完了サブタスク 1件')).toBeVisible();
    expect(within(check).getByRole('region', { name: 'モアイからの確認' })).not.toBeVisible();
    fireEvent.click(within(check).getByText('展示資料の準備 · 未完了サブタスク 1件'));
    expect(within(check).getByRole('region', { name: 'モアイからの確認' })).toHaveTextContent('展示資料の準備');
    expect(check).toHaveTextContent('写真を確認する');
    expect(within(check).getByRole('button', { name: 'サブタスクを完了にする' })).toBeVisible();
    expect(within(check).getByRole('button', { name: '親を着手に戻す' })).toBeVisible();
  });

  it('leaves the dashboard to its inline confirmation entry instead of covering it with a second bubble', async () => {
    fake.notices.notifications = [];
    fake.notices.unreadCount = 0;
    render(<CompanionAI projectId={null} autoGreeting={false} quickCheckEnabled={false} />);
    await act(async () => {});
    expect(screen.queryByTestId('companion-task-check')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AIに相談する' })).toBeVisible();
  });

  it('opens notices from the mascot, without an AI key, an AI request, or read side effects', async () => {
    fake.settings.isConfigured = () => false;
    fake.conversation.messages = [];
    render(<CompanionAI projectId={null} />);
    await act(async () => {});
    fireEvent.click(screen.getAllByRole('button', { name: '未読の通知1件を開く' }).at(-1)!);
    const panel = screen.getByRole('region', { name: '相棒の通知' });
    expect(within(panel).getByText('確認お願いします')).toBeVisible();
    expect(within(panel).getByRole('link')).toHaveAttribute('href', '/projects/project-1/board?task=task-1&comment=comment-1');
    expect(fake.conversation.sendMessage).not.toHaveBeenCalled();
    expect(fake.companion.markMorningGreeted).not.toHaveBeenCalled();
    expect(fake.notices.markAsRead).not.toHaveBeenCalled();
    expect(fake.notices.markAllAsRead).not.toHaveBeenCalled();
  });

  it('does not start the automatic greeting when opening notices with AI already configured', async () => {
    vi.useFakeTimers();
    fake.conversation.messages = [];
    render(<CompanionAI projectId={null} />);
    await act(async () => {});
    fireEvent.click(screen.getAllByRole('button', { name: '未読の通知1件を開く' }).at(-1)!);
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(screen.getByRole('region', { name: '相棒の通知' })).toBeVisible();
    expect(fake.conversation.sendMessage).not.toHaveBeenCalled();
    expect(fake.companion.markMorningGreeted).not.toHaveBeenCalled();
  });

  it('preserves the conversation, unsent text, and history while switching between chat and notices', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<CompanionAI projectId={null} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'AIに相談する' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'まだ送信しない文' } });
    fireEvent.click(screen.getByRole('button', { name: /^通知/ }));
    expect(screen.getByRole('region', { name: '相棒の通知' })).toBeVisible();
    expect(screen.getByRole('button', { name: '会話' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: '会話' }));
    expect(screen.getByRole('textbox')).toHaveValue('まだ送信しない文');
    expect(screen.getAllByRole('button', { name: '手伝い方を変更' })).toHaveLength(1);
    const toolbar = screen.getByRole('group', { name: '相棒の表示' });
    for (const name of ['手伝い方を変更', '要望を送る']) {
      expect(toolbar).toContainElement(screen.getByRole('button', { name }));
      expect(within(screen.getByRole('group', { name: '相棒の操作' })).queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(errors.mock.calls.flat().join(' ')).not.toContain('same key');
    errors.mockRestore();
    expect(screen.getByText('会話の続き')).toBeVisible();
    expect(screen.queryByRole('button', { name: /履歴/ })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '会話履歴' })).toContainElement(screen.getByRole('button', { name: '前の相談' }));
    fireEvent.click(screen.getByRole('button', { name: /^通知/ }));
    expect(screen.queryByRole('region', { name: '会話履歴' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '会話' }));
    expect(screen.getByRole('region', { name: '会話履歴' })).toBeVisible();
    expect(fake.conversation.clearMessages).toHaveBeenCalledOnce(); // Existing project/user initialization only.
    expect(fake.conversation.sendMessage).not.toHaveBeenCalled();
  });

  it('returns to a specifically requested saved conversation while the notification view is open', async () => {
    render(<CompanionAI projectId={null} />);
    await act(async () => {});
    fireEvent.click(screen.getAllByRole('button', { name: '未読の通知1件を開く' }).at(-1)!);
    act(() => window.dispatchEvent(new CustomEvent('taskflow-open-conversation', { detail: { userId: 'user-1', conversationId: 'draft-1', mode: 'draft' } })));
    expect(screen.getByText('保存済みの返信案')).toBeVisible();
    expect(screen.queryByRole('region', { name: '相棒の通知' })).not.toBeInTheDocument();
    expect(fake.notices.markAsRead).not.toHaveBeenCalled();
  });
});

it('keeps the unread tab badge current and hides counts while loading or failed', async () => {
  fake.notices.unreadCount=120;
  const ui=render(<CompanionAI projectId={null} />);await act(async()=>{});
  fireEvent.click(screen.getByRole('button',{name:'AIに相談する'}));
  const tab=screen.getByRole('button',{name:/^通知/});
  expect(within(tab).getByLabelText('未読120件')).toHaveTextContent('99+');
  fake.notices.unreadCount=2; ui.rerender(<CompanionAI projectId={null} />);
  expect(within(tab).getByLabelText('未読2件')).toHaveTextContent('2');
  fake.notices.isLoading=true;ui.rerender(<CompanionAI projectId={null} />);expect(within(tab).queryByLabelText('未読2件')).toBeNull();
  fake.notices.isLoading=false;fake.notices.error=new Error('offline');ui.rerender(<CompanionAI projectId={null} />);expect(within(tab).queryByLabelText('未読2件')).toBeNull();
  fake.notices.error=null;fake.notices.unreadCount=0;ui.rerender(<CompanionAI projectId={null} />);expect(within(tab).queryByLabelText(/未読/)).toBeNull();
  expect(fake.notices.markAllAsRead).not.toHaveBeenCalled();expect(fake.notices.markAsRead).not.toHaveBeenCalled();
});

vi.mock('./AISupportAdjust', () => ({ AISupportAdjust: () => <button>手伝い方を変更</button> }));


it.each([null, 'project-1'])('uses the existing overdue action once in the conversation for %s', async projectId => {
  render(<CompanionAI projectId={projectId} autoGreeting={false} />);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'AIに相談する' }));
  const actions = screen.getByRole('group', { name: '相棒の操作' });
  expect(within(actions).getAllByRole('button', { name: '期限切れ確認' })).toHaveLength(1);
  fireEvent.click(within(actions).getByRole('button', { name: '期限切れ確認' }));
  expect(fake.conversation.sendMessage).toHaveBeenCalledExactlyOnceWith('期限切れのタスクはありますか？');
});

vi.mock('./FeatureRequestDialog', () => ({ FeatureRequestDialog: () => null }));


it('shows comments without AI or read side effects and retains the unsent conversation', async () => {
  render(<CompanionAI projectId={null} autoGreeting={false} />); await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'AIに相談する' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'まだ送っていない相談' } });
  fireEvent.click(screen.getByRole('button', { name: 'コメント' }));
  expect(screen.getByRole('region', { name: '相棒のコメント' })).toBeVisible();
  expect(screen.queryByRole('region', { name: '相棒の通知' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '会話' }));
  expect(screen.getByRole('textbox')).toHaveValue('まだ送っていない相談');
  expect(fake.conversation.sendMessage).not.toHaveBeenCalled();
  expect(fake.notices.markAsRead).not.toHaveBeenCalled();
  expect(fake.notices.markAllAsRead).not.toHaveBeenCalled();
});


describe('Companion meeting intake', () => {
  it.each([false, true])('opens the existing popup beside comments (has conversation: %s) and keeps both drafts', async (hasConversation) => {
    if (!hasConversation) fake.conversation.messages = [];
    render(<CompanionAI projectId={null} autoGreeting={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'AIに相談する' }));
    fireEvent.change(screen.getByLabelText('会話の入力'), { target: { value: 'まだ送信しない相談' } });
    expect(requestOrganization).not.toHaveBeenCalled();
    const toolbar = within(screen.getByRole('group', { name: '相棒の表示' }));
    const meeting = toolbar.getByRole('button', { name: 'メモから整理' });
    const support = toolbar.getByRole('button', { name: '手伝い方を変更' });
    const request = toolbar.getByRole('button', { name: '要望を送る' });
    expect(support.previousElementSibling).toBe(toolbar.getByRole('button', { name: 'コメント' }));
    expect(request.previousElementSibling).toBe(support);
    expect(meeting.previousElementSibling).toBe(request);
    expect(within(screen.getByRole('group', { name: '相棒の操作' })).queryByRole('button', { name: 'メモから整理' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '会話履歴' })).toBeVisible();
    fireEvent.click(meeting);
    const dialog = await screen.findByRole('dialog', { name: '仕事の整理と反映' });
    await waitFor(() => expect(within(dialog).getByLabelText('文字起こし・メモ')).toBeEnabled());
    fireEvent.change(within(dialog).getByLabelText('文字起こし・メモ'), { target: { value: '入力途中の会議メモ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.getByLabelText('会話の入力')).toHaveValue('まだ送信しない相談');
    fireEvent.click(screen.getByRole('button', { name: 'メモから整理' }));
    expect(await screen.findByLabelText('文字起こし・メモ')).toHaveValue('入力途中の会議メモ');
    await waitFor(() => expect(screen.getByLabelText('文字起こし・メモ')).toBeEnabled());
    expect(fake.conversation.sendMessage).not.toHaveBeenCalled();
    expect(vi.mocked(requestOrganization).mock.calls.every(([body]) => body.action === 'context' || body.action === 'list')).toBe(true);
    expect(fake.notices.markAsRead).not.toHaveBeenCalled();
  });
});


it('retains the selected notification when returning from the conversation', async () => {
  fake.notices.notifications.push({ ...fake.notices.notifications[0], id: 'notice-2', title: '二つ目の通知', message: '選んだ通知の本文' });
  render(<CompanionAI projectId={null} autoGreeting={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'AIに相談する' }));
  fireEvent.click(screen.getByRole('button', { name: /^通知/ }));
  fireEvent.click(within(screen.getByRole('region', { name: '通知履歴' })).getByRole('button', { name: /二つ目の通知/ }));
  fireEvent.click(screen.getByRole('button', { name: '会話' }));
  fireEvent.click(screen.getByRole('button', { name: /^通知/ }));
  expect(screen.getByRole('region', { name: '通知の内容' })).toHaveTextContent('選んだ通知の本文');
  expect(fake.notices.markAsRead).toHaveBeenCalledExactlyOnceWith('notice-2');
  expect(fake.conversation.sendMessage).not.toHaveBeenCalled();
});


it('keeps the comment panel open when dismissing an attachment preview, then lets Escape close the panel', async () => {
  const change = vi.fn();
  const content = (open: boolean) => <><CompanionAI projectId={null} autoGreeting={false} /><Dialog open={open} onOpenChange={change}><DialogContent><DialogTitle>添付画像</DialogTitle><DialogDescription>画像のプレビュー</DialogDescription></DialogContent></Dialog></>;
  const ui = render(content(false));
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'AIに相談する' }));
  ui.rerender(content(true));
  fireEvent.mouseDown(document.body);
  fireEvent.keyDown(screen.getByRole('dialog', { name: '添付画像' }), { key: 'Escape' });
  expect(change).toHaveBeenCalledWith(false);
  ui.rerender(content(false));
  expect(screen.getByRole('button', { name: 'AIアシスタントを閉じる' })).toBeVisible();
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(screen.queryByRole('button', { name: 'AIアシスタントを閉じる' })).not.toBeInTheDocument();
});

it('keeps a factual parent/child check available without changing task state automatically', async () => {
  fake.notices.notifications = []; fake.notices.unreadCount = 0;
  fake.tasks = [
    { id: 'parent', projectId: 'project-1', title: '完了した納品', isCompleted: true, assigneeIds: ['user-1'], updatedAt: new Date(), completionPolicy: null },
    { id: 'child', projectId: 'project-1', parentTaskId: 'parent', title: '任意の追加作業', isCompleted: false, assigneeIds: ['user-1'], updatedAt: new Date() },
  ] as DashboardTask[];
  const original = structuredClone(fake.tasks);
  const { rerender, unmount } = render(<CompanionAI projectId={null} />);
  await act(async () => {});
  expect(screen.getByText('完了した納品 · 未完了サブタスク 1件')).toBeVisible();
  fireEvent.click(screen.getByText('完了した納品 · 未完了サブタスク 1件'));
  expect(screen.getByRole('region', { name: 'モアイからの確認' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'サブタスクを完了にする' })).toBeVisible();
  expect(screen.getByRole('button', { name: '親を着手に戻す' })).toBeVisible();
  fake.tasks = fake.tasks.map(task => ({ ...task, updatedAt: new Date(Date.now() + 60000) }));
  rerender(<CompanionAI projectId={null} />);
  unmount(); render(<CompanionAI projectId={null} />);
  await act(async () => {});
  expect(screen.getByText('完了した納品 · 未完了サブタスク 1件')).toBeVisible();
  expect(screen.getByRole('region', { name: 'モアイからの確認' })).not.toBeVisible();
  expect(fake.tasks.map(task => [task.id, task.isCompleted])).toEqual(original.map(task => [task.id, task.isCompleted]));
  expect(fake.conversation.sendMessage).not.toHaveBeenCalled();
});
