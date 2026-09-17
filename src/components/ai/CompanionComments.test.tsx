import { fireEvent, render as renderUI, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { submitTaskComment } from '@/lib/firebase/commentSubmission';
import { fetchCommentReactions, fetchStampSettings, putCommentReaction } from '@/lib/comments/client';
import { CompanionComments } from './CompanionComments';
import { loadDashboardComments } from '@/lib/dashboard/comments';
import { viewTask } from '@/test/taskViewFixtures';

const render = (ui: React.ReactElement) => renderUI(ui, { wrapper: ({ children }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider> });

vi.mock('@/lib/firebase/commentSubmission', () => ({ submitTaskComment: vi.fn() }));
vi.mock('@/lib/firebase/storage', async original => ({ ...await original<typeof import('@/lib/firebase/storage')>(), uploadCommentAttachment: vi.fn() }));
vi.mock('@/lib/comments/client', () => ({ fetchCommentReactions: vi.fn(), fetchStampSettings: vi.fn(), putCommentReaction: vi.fn(), stampSettingsKey: (uid: string) => ['comment-stamp-settings', uid] }));
vi.mock('@/hooks/useMeetingMembers', () => ({ useMeetingMembers: (projects: { id: string }[]) => ({ users: [{ id: 'me', displayName: 'Kozue' }, { id: projects[0]?.id === 'q' ? 'q-member' : 'p-member', displayName: projects[0]?.id === 'q' ? 'Qのメンバー' : 'Pのメンバー' }], isLoading: false, hasError: false, refresh: vi.fn() }) }));

vi.mock('next/image', () => ({ default: ({ src, alt }: { src: string; alt: string }) => <span role="img" aria-label={alt} data-src={src} /> }));

const state = vi.hoisted(() => ({ loading: false, error: null as Error | null, tasks: [{ id: 'task', projectId: 'p', title: '会場の確認', projectName: '展示会' }] }));
vi.mock('@/hooks/useMyTasks', () => ({ useMyTasks: () => ({ projects: ['p', 'q'].map(id => ({ id, ownerId: 'me', memberIds: ['me', `${id}-member`] })), allProjectTasks: state.tasks.map(task => ({ ...viewTask(task), projectName: task.projectName })), isLoading: state.loading, error: state.error }) }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: (select: (v: unknown) => unknown) => select({ firebaseUser: { uid: 'me' }, user: { id: 'me', displayName: 'Kozue' } }) }));
vi.mock('@/lib/firebase/testMode', () => ({ isE2EMockAuthEnabled: () => false }));
vi.mock('@/lib/dashboard/comments', async original => ({ ...await original<typeof import('@/lib/dashboard/comments')>(), loadDashboardComments: vi.fn() }));
const result = (): Awaited<ReturnType<typeof loadDashboardComments>> => ({ items: [{
  key: 'p/task/comment', projectId: 'p', taskId: 'task', authorName: '同僚', listName: '準備',
  comment: { id: 'comment', taskId: 'task', content: '入口は南側です。\nこのルートでよいですか？', purpose: 'review_request', authorId: 'other', mentions: ['me'], createdAt: new Date('2026-09-14T01:00:00Z'), updatedAt: new Date('2026-09-14T01:00:00Z'), attachments: [{ id: 'file', name: '搬入図.pdf', url: 'https://example.com/map.pdf', size: 10, type: 'application/pdf' }] },
}], failedTasks: 0, errorCodes: [], metadataIncomplete: false });
beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); localStorage.clear(); vi.mocked(submitTaskComment).mockResolvedValue({ commentId: 'new', reviewTaskId: null, alreadySubmitted: false }); vi.mocked(fetchCommentReactions).mockResolvedValue({ own: null, reactions: [], partial: false }); vi.mocked(fetchStampSettings).mockResolvedValue({ seenStampId: 'cat' }); state.loading = false; state.error = null; state.tasks = [{ id: 'task', projectId: 'p', title: '会場の確認', projectName: '展示会' }]; vi.mocked(loadDashboardComments).mockResolvedValue(result()); });

describe('CompanionComments', () => {
  it('shows the full saved comment, request type and attachment, linking to the exact reply location', async () => {
    const navigate = vi.fn(); render(<CompanionComments onNavigate={navigate} />);
    expect(await screen.findByText(/入口は南側です/)).toHaveTextContent('このルートでよいですか？');
    expect(within(screen.getByRole('article', { name: 'コメントの内容' })).getByText('確認依頼')).toBeVisible();
    expect(screen.getByRole('link', { name: '搬入図.pdf' })).toHaveAttribute('href', 'https://example.com/map.pdf');
    const reply = screen.getByRole('link', { name: '依頼を開く・返答' });
    expect(reply).toHaveAttribute('href', '/projects/p/board?task=task&comment=comment');
    fireEvent.click(reply); expect(navigate).toHaveBeenCalledOnce();
    expect(screen.queryByText('未読')).not.toBeInTheDocument();
  });
  it('waits for the task scope, offers refresh, and does not treat a partial read as no comments', async () => {
    state.loading = true; const ui = render(<CompanionComments onNavigate={vi.fn()} />);
    expect(loadDashboardComments).not.toHaveBeenCalled(); expect(screen.getByRole('status')).toHaveTextContent('読み込み中');
    state.loading = false; state.error = new Error('unavailable');
    vi.mocked(loadDashboardComments).mockResolvedValue({ ...result(), items: [], failedTasks: 1, errorCodes: ['unavailable'] });
    ui.rerender(<CompanionComments onNavigate={vi.fn()} />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent('一部のコメントを取得できません');
    expect(screen.queryByText('表示できるコメントはありません。')).not.toBeInTheDocument();
    vi.mocked(loadDashboardComments).mockResolvedValue(result());
    fireEvent.click(screen.getByRole('button', { name: 'コメントを更新' }));
    expect(await screen.findByText(/入口は南側です/)).toBeVisible();
    expect(loadDashboardComments).toHaveBeenCalledTimes(2);
  });
  it('shows an empty state only after loading successfully, and never activates unsafe attachment URLs', async () => {
    const data = result(); data.items[0].comment.attachments![0].url = 'javascript:alert(1)';
    vi.mocked(loadDashboardComments).mockResolvedValue(data);
    render(<CompanionComments onNavigate={vi.fn()} />);
    expect(await screen.findByText('搬入図.pdf')).toBeVisible();
    expect(screen.queryByRole('link', { name: '搬入図.pdf' })).not.toBeInTheDocument();
    vi.mocked(loadDashboardComments).mockResolvedValue({ ...data, items: [] });
    fireEvent.click(screen.getByRole('button', { name: 'コメントを更新' }));
    expect(await screen.findByText('表示できるコメントはありません。')).toBeVisible();
  });
});


it('groups comments by task identity, preserving each author, attachment, request and reply link', async () => {
  const data = result();
  const older = data.items[0];
  const latest = { ...older, key: 'p/task/latest', authorName: '別の同僚', comment: { ...older.comment, id: 'latest', content: '南側の入口で確定しました。', purpose: undefined, attachments: [], createdAt: new Date('2026-09-14T02:00:00Z') } };
  state.tasks.push({ ...state.tasks[0], projectId: 'q', projectName: '別の展示会' }, { ...state.tasks[0], id: 'another-task' });
  data.items = [latest, older,
    { ...older, key: 'q/task/comment', projectId: 'q', comment: { ...older.comment, content: '別プロジェクトのコメント', purpose: undefined, attachments: [] } },
    { ...older, key: 'p/another-task/comment', taskId: 'another-task', comment: { ...older.comment, taskId: 'another-task', content: '同名の別タスクのコメント', purpose: undefined, attachments: [] } },
  ];
  vi.mocked(loadDashboardComments).mockResolvedValue(data);
  const navigate = vi.fn(); render(<CompanionComments onNavigate={navigate} />);
  const group = await screen.findByRole('button', { name: '展示会 / 会場の確認のコメント（2件）' });
  expect(group).toHaveTextContent('別の同僚');
  const history = within(screen.getByRole('region', { name: 'コメント履歴' }));
  expect(history.getAllByRole('button', { name: /会場の確認のコメント/ })).toHaveLength(3);
  const articles = screen.getAllByRole('article', { name: 'コメントの内容' });
  expect(articles).toHaveLength(2);
  expect(articles[0]).toHaveTextContent('南側の入口で確定しました。');
  expect(articles[1]).toHaveTextContent('入口は南側です。');
  expect(within(articles[1]).getByRole('link', { name: '搬入図.pdf' })).toHaveAttribute('href', 'https://example.com/map.pdf');
  expect(within(articles[1]).getByRole('link', { name: '依頼を開く・返答' })).toHaveAttribute('href', '/projects/p/board?task=task&comment=comment');
  expect(within(articles[0]).getByRole('link', { name: 'タスクで続きを見る' })).toHaveAttribute('href', '/projects/p/board?task=task&comment=latest');
  fireEvent.click(history.getByRole('button', { name: '別の展示会 / 会場の確認のコメント（1件）' }));
  expect(screen.getByRole('article', { name: 'コメントの内容' })).toHaveTextContent('別プロジェクトのコメント');
  expect(screen.getByRole('link', { name: 'タスクで続きを見る' })).toHaveAttribute('href', '/projects/q/board?task=task&comment=comment');
  expect(screen.queryByText('南側の入口で確定しました。')).not.toBeInTheDocument();
  fireEvent.click(history.getByRole('button', { name: '展示会 / 会場の確認のコメント（1件）' }));
  expect(screen.getByRole('article', { name: 'コメントの内容' })).toHaveTextContent('同名の別タスクのコメント');
  expect(navigate).not.toHaveBeenCalled();
});

it('retains the selected task when a new comment changes its latest item, and falls back if the task disappears', async () => {
  const data = result();
  const original = data.items[0];
  state.tasks.push({ ...state.tasks[0], id: 'other', title: '別の仕事' });
  const other = { ...original, key: 'p/other/comment', taskId: 'other', comment: { ...original.comment, taskId: 'other', content: '別の仕事へのコメント' } };
  data.items = [other, original];
  vi.mocked(loadDashboardComments).mockResolvedValue(data);
  render(<CompanionComments onNavigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: '展示会 / 会場の確認のコメント（1件）' }));
  expect(screen.getByRole('article', { name: 'コメントの内容' })).toHaveTextContent('入口は南側です。');
  const added = { ...original, key: 'p/task/new', authorName: '新しい投稿者', comment: { ...original.comment, id: 'new', content: '追加の連絡です。', createdAt: new Date('2026-09-14T03:00:00Z') } };
  vi.mocked(loadDashboardComments).mockResolvedValue({ ...data, items: [other, added, original] });
  fireEvent.click(screen.getByRole('button', { name: 'コメントを更新' }));
  expect(await screen.findByText('追加の連絡です。')).toBeVisible();
  expect(screen.getByRole('button', { name: '展示会 / 会場の確認のコメント（2件）' })).toHaveAttribute('aria-current', 'true');
  expect(screen.getAllByRole('article', { name: 'コメントの内容' })).toHaveLength(2);
  expect(screen.queryByText('別の仕事へのコメント')).not.toBeInTheDocument();
  vi.mocked(loadDashboardComments).mockResolvedValue({ ...data, items: [other] });
  fireEvent.click(screen.getByRole('button', { name: 'コメントを更新' }));
  expect(await screen.findByText('別の仕事へのコメント')).toBeVisible();
  expect(screen.getByRole('button', { name: '展示会 / 別の仕事のコメント（1件）' })).toHaveAttribute('aria-current', 'true');
  expect(screen.queryByText('追加の連絡です。')).not.toBeInTheDocument();
});

it('identifies your messages by account ID, preserving names and per-message reply destinations', async () => {
  const data = result();
  const other = data.items[0];
  // Names can match: ownership must follow the saved author ID.
  data.items = [{ ...other, key: 'p/task/mine', comment: { ...other.comment, id: 'mine', authorId: 'me', content: '自分の返信です。', purpose: undefined, attachments: [] } }, other];
  vi.mocked(loadDashboardComments).mockResolvedValue(data);
  render(<CompanionComments onNavigate={vi.fn()} />);
  await screen.findByText('自分の返信です。');
  const [mine, incoming] = screen.getAllByRole('article', { name: 'コメントの内容' });
  expect(within(mine).getByText('あなた')).toBeVisible();
  expect(within(incoming).queryByText('あなた')).not.toBeInTheDocument();
  expect(within(mine).getByRole('link', { name: 'タスクで続きを見る' })).toHaveAttribute('href', '/projects/p/board?task=task&comment=mine');
  expect(within(incoming).getByText('確認依頼')).toBeVisible();
});

it('retains saved author icons and uses a neutral fallback when author metadata is missing', async () => {
  const data = result();
  data.items[0].comment.authorIcon = '🗿';
  data.items[0].authorName = 'モアイ';
  vi.mocked(loadDashboardComments).mockResolvedValue(data);
  render(<CompanionComments onNavigate={vi.fn()} />);
  expect(await screen.findByText('🗿')).toBeVisible();
  data.items[0] = { ...data.items[0], authorName: '投稿者名未取得', comment: { ...data.items[0].comment, authorIcon: null } };
  vi.mocked(loadDashboardComments).mockResolvedValue({ ...data, metadataIncomplete: true });
  fireEvent.click(screen.getByRole('button', { name: 'コメントを更新' }));
  expect(await screen.findByText('?')).toBeVisible();
  expect(screen.queryByText('🗿')).not.toBeInTheDocument();
  expect(screen.getByRole('article', { name: 'コメントの内容' })).toHaveTextContent('投稿者名未取得');
});


it.each(['image/jpeg', '', 'application/octet-stream'])('shows image attachments inline and opens the original in a preview (%s)', async type => {
  const data = result();
  const file = { id: 'photo', name: '配布カード.JPG', url: 'https://firebasestorage.googleapis.com/v0/b/test/o/card.jpg?alt=media', type, size: 2048 };
  data.items[0].comment.attachments = [file];
  vi.mocked(loadDashboardComments).mockResolvedValue(data);
  const navigate = vi.fn();
  render(<CompanionComments onNavigate={navigate} />);
  expect(await screen.findByRole('img', { name: file.name })).toHaveAttribute('data-src', file.url);
  fireEvent.click(screen.getByRole('button', { name: file.name }));
  const preview = screen.getByRole('dialog', { name: file.name });
  expect(within(preview).getByRole('img', { name: file.name })).toHaveAttribute('data-src', file.url);
  expect(within(preview).getByRole('link', { name: '新しいタブで開く' })).toHaveAttribute('href', file.url);
  fireEvent.click(within(preview).getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('article', { name: 'コメントの内容' })).toBeVisible();
  expect(navigate).not.toHaveBeenCalled();
});

it('does not load an image or open a link when an attachment URL is unsafe', async () => {
  const data = result();
  data.items[0].comment.attachments = [{ id: 'photo', name: 'photo.jpg', url: 'javascript:alert(1)', type: 'image/jpeg', size: 10 }];
  vi.mocked(loadDashboardComments).mockResolvedValue(data);
  render(<CompanionComments onNavigate={vi.fn()} />);
  expect(await screen.findByText('photo.jpg')).toBeVisible();
  expect(screen.queryByRole('img', { name: 'photo.jpg' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'photo.jpg' })).not.toBeInTheDocument();
});


it('posts to the selected task across projects, resets drafts when switching and refreshes the saved comment without navigating', async () => {
  const data = result();
  const first = data.items[0];
  state.tasks.push({ ...state.tasks[0], projectId: 'q', projectName: '別の展示会' });
  const second = { ...first, key: 'q/task/comment', projectId: 'q', comment: { ...first.comment, content: 'Qのコメント' } };
  vi.mocked(loadDashboardComments).mockResolvedValue({ ...data, items: [first, second] });
  const navigate = vi.fn(); render(<CompanionComments onNavigate={navigate} />);
  const input = await screen.findByRole('textbox', { name: 'メモ・報告の本文' });
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.change(input, { target: { value: 'Pの下書き' } });
  fireEvent.click(screen.getByRole('button', { name: '別の展示会 / 会場の確認のコメント（1件）' }));
  const selectedInput = screen.getByRole('textbox', { name: 'メモ・報告の本文' });
  await waitFor(() => expect(selectedInput).toBeEnabled());
  expect(selectedInput).toHaveValue('');
  expect(screen.queryByRole('checkbox', { name: 'Pのメンバー' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Qのメンバー' }));
  expect(submitTaskComment).not.toHaveBeenCalled();
  const added = { ...second, key: 'q/task/new', authorName: 'Kozue', comment: { ...second.comment, id: 'new', authorId: 'me', content: 'こちらで確認します', purpose: undefined, attachments: [] } };
  vi.mocked(loadDashboardComments).mockResolvedValue({ ...data, items: [added, first, second] });
  fireEvent.change(selectedInput, { target: { value: 'こちらで確認します' } });
  fireEvent.click(screen.getByRole('button', { name: '投稿' }));
  await waitFor(() => expect(submitTaskComment).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ projectId: 'q', taskId: 'task', authorId: 'me', authorName: 'Kozue', content: 'こちらで確認します', notifyIds: ['q-member'], review: null })));
  expect(await screen.findByText('こちらで確認します')).toBeVisible();
  expect(screen.getByRole('button', { name: '別の展示会 / 会場の確認のコメント（2件）' })).toHaveAttribute('aria-current', 'true');
  expect(screen.getByRole('textbox', { name: 'メモ・報告の本文' })).toHaveValue('');
  expect(navigate).not.toHaveBeenCalled();
});

it('adds and removes a stamp on the selected comment, keeping identical IDs in other projects separate', async () => {
  const data = result(); const first = data.items[0];
  state.tasks.push({ ...state.tasks[0], projectId: 'q', projectName: '別の展示会' });
  vi.mocked(loadDashboardComments).mockResolvedValue({ ...data, items: [first, { ...first, key: 'q/task/comment', projectId: 'q' }] });
  const navigate = vi.fn(); render(<CompanionComments onNavigate={navigate} />);
  fireEvent.click(await screen.findByRole('button', { name: '別の展示会 / 会場の確認のコメント（1件）' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '見たよを付ける' })).toBeEnabled());
  expect(putCommentReaction).not.toHaveBeenCalled();
  vi.mocked(putCommentReaction).mockResolvedValue({ reaction: { userId: 'me', displayName: 'Kozue', marks: { seen: { stampId: 'cat', at: '2026-09-16T00:00:00Z' } } } });
  fireEvent.click(screen.getByRole('button', { name: '見たよを付ける' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '見たよを取り消す' })).toBeEnabled());
  expect(putCommentReaction).toHaveBeenCalledWith('me', { projectId: 'q', taskId: 'task', commentId: 'comment', kind: 'seen', active: true, stampId: 'cat' });
  vi.mocked(putCommentReaction).mockResolvedValue({ reaction: null });
  fireEvent.click(screen.getByRole('button', { name: '見たよを取り消す' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '見たよを付ける' })).toBeEnabled());
  expect(putCommentReaction).toHaveBeenLastCalledWith('me', { projectId: 'q', taskId: 'task', commentId: 'comment', kind: 'seen', active: false, stampId: 'cat' });
  expect(navigate).not.toHaveBeenCalled();
});
