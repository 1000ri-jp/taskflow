import { act, fireEvent, render as renderRTL, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { NeoWorkContinuation } from './NeoWorkContinuation';
import { viewTask } from '@/test/taskViewFixtures';
import type { MyTask, ProjectTaskStatus } from '@/hooks/useMyTasks';
import type { Task, Comment, Checklist } from '@/types';
import { sendWorkflow } from '@/lib/task/workflowClient';
import { submitTaskComment } from '@/lib/firebase/commentSubmission';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_AI_SUPPORT } from '@/lib/ai/support/profile';
import { requestAISupport } from '@/lib/ai/support/client';
import type { ReactElement } from 'react';
vi.mock('@/lib/ai/support/client', () => ({ requestAISupport: vi.fn(async () => DEFAULT_AI_SUPPORT) }));
vi.mock('@/components/ai/WorkSupportPreparation', () => ({ WorkSupportPreparation: ({ actions }: { actions?: import('react').ReactNode }) => <section><button>AIで次の一歩を整理</button>{actions}</section> }));
let client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function render(ui: ReactElement) { const view = renderRTL(<QueryClientProvider client={client}>{ui}</QueryClientProvider>); return { ...view, rerender: (next: ReactElement) => view.rerender(<QueryClientProvider client={client}>{next}</QueryClientProvider>) }; }
const state = vi.hoisted(() => ({ task: null as Task | null, loading: false, error: null as string | null, owner: 'worker', comments: [] as Comment[], checklists: [] as Checklist[], toggle: vi.fn() }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: (select: (v: unknown) => unknown) => select({ user: { id: 'worker', displayName: '制作担当' } }) }));
vi.mock('@/hooks/useProjects', () => ({ useProject: () => ({ project: { id: 'project-1', ownerId: state.owner, memberIds: ['worker', 'reviewer'], description: '展示会で紹介する' }, members: [], isLoading: false, error: null }) }));
vi.mock('@/hooks/useMeetingMembers', () => ({ useMeetingMembers: () => ({ users: [{ id: 'worker', displayName: '制作担当' }, { id: 'reviewer', displayName: '確認担当' }], isLoading: false, hasError: false, refresh: vi.fn() }) }));
vi.mock('@/hooks/useTaskDetails', () => ({ useTaskDetails: () => ({ task: state.task, isLoading: state.loading, detailsError: state.error, attachments: [], comments: state.comments, commentStatus: 'ready', checklists: state.checklists, toggleChecklistItem: state.toggle }) }));
vi.mock('@/lib/task/workflowClient', () => ({ sendWorkflow: vi.fn() }));
vi.mock('@/lib/firebase/commentSubmission', () => ({ submitTaskComment: vi.fn() }));
vi.mock('@/lib/firebase/storage', () => ({ uploadCommentAttachment: vi.fn() }));
const task = (changes: Partial<Task> = {}): MyTask => ({ ...viewTask({ id: 'parent', title: 'チラシ制作', assigneeIds: ['worker'], completionCriteria: '入稿用PDFの確認が済んでいる', ...changes }), projectName: '展示会', projectColor: '#333333', projectIcon: '📄' });
const ready = new Map<string, ProjectTaskStatus>([['project-1', { status: 'ready' }]]);
const props = (tasks: MyTask[], status = ready) => ({ tasks, userId: 'worker', isLoading: false, error: null, projectTaskStatus: status, onList: vi.fn() });
beforeEach(() => { vi.clearAllMocks(); client = new QueryClient({defaultOptions:{queries:{retry:false}}}); vi.mocked(requestAISupport).mockResolvedValue(DEFAULT_AI_SUPPORT); sessionStorage.clear(); localStorage.clear(); state.task = task(); state.loading = false; state.error = null; state.owner = 'worker'; state.comments = []; state.checklists = []; state.toggle.mockResolvedValue(undefined); vi.mocked(sendWorkflow).mockResolvedValue(null); vi.mocked(submitTaskComment).mockResolvedValue({ commentId: 'comment', reviewTaskId: 'review', alreadySubmitted: false }); });
it('starts from the same job, prepares the completion criteria, and submits only explicitly selected reviewers and next job', async () => {
 const parent = task(); const next = task({ id: 'next', title: '印刷に回す', assigneeIds: ['reviewer'] });
 const ui = render(<NeoWorkContinuation {...props([parent, next])} />); await act(async () => {});
 expect(sendWorkflow).not.toHaveBeenCalled(); expect(submitTaskComment).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button', { name: '作業を始める' }));
 await waitFor(() => expect(sendWorkflow).toHaveBeenCalledWith('project-1', 'parent', expect.objectContaining({ action: 'start' })));
 const started = task({ workProgress: 'started', updatedAt: new Date('2026-09-13T01:00:00Z') }); state.task = started;
 ui.rerender(<NeoWorkContinuation {...props([started, next])} />);
 fireEvent.click(screen.getByRole('button', { name: '資料を送って確認してもらう' }));
 await waitFor(() => expect(screen.getByRole('textbox', { name: '確認してほしいこと' })).toBeEnabled());
 expect(screen.getByRole('textbox', { name: '確認してほしいこと' })).toHaveValue('次の完了条件を確認してください。\n入稿用PDFの確認が済んでいる');
 const reviewers = within(screen.getByRole('group', { name: '確認する人（複数可）' }));
 expect(reviewers.getByRole('checkbox', { name: '制作担当' })).not.toBeChecked();
 fireEvent.click(reviewers.getByRole('checkbox', { name: '確認担当' }));
 fireEvent.change(screen.getByRole('combobox', { name: '確認OKのあとに進む仕事' }), { target: { value: 'next' } });
 fireEvent.click(screen.getByRole('button', { name: '資料を送って確認を依頼' }));
 await waitFor(() => expect(submitTaskComment).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'parent', expectedTaskVersion: started.updatedAt.toISOString(), review: expect.objectContaining({ assigneeIds: ['reviewer'], nextTaskId: 'next' }) })));
 expect(parent.assigneeIds).toEqual(['worker']);
});
it('requires a new check after the job changes while keeping the authored request intact', async () => {
 const parent = task({ workProgress: 'started' }); state.task = parent;
 const ui = render(<NeoWorkContinuation {...props([parent])} />); await act(async () => {});
 fireEvent.click(screen.getByRole('button', { name: '資料を送って確認してもらう' }));
 await waitFor(() => expect(screen.getByRole('textbox', { name: '確認してほしいこと' })).toBeEnabled());
 fireEvent.change(screen.getByRole('textbox', { name: '確認してほしいこと' }), { target: { value: '会場名を確認してください' } });
 fireEvent.click(within(screen.getByRole('group', { name: '確認する人（複数可）' })).getByRole('checkbox', { name: '確認担当' }));
 const updated = task({ workProgress: 'started', updatedAt: new Date('2026-09-13T02:00:00Z'), completionCriteria: '新しい入稿条件' }); state.task = updated;
 ui.rerender(<NeoWorkContinuation {...props([updated])} />);
 fireEvent.click(screen.getByRole('button', { name: '資料を送って確認を依頼' }));
 expect(submitTaskComment).not.toHaveBeenCalled();
 expect(screen.getByRole('textbox', { name: '確認してほしいこと' })).toHaveValue('会場名を確認してください');
 fireEvent.click(screen.getByRole('button', { name: '変更後の内容を確認しました' }));
 fireEvent.click(screen.getByRole('button', { name: '資料を送って確認を依頼' }));
 await waitFor(() => expect(submitTaskComment).toHaveBeenCalledWith(expect.objectContaining({ expectedTaskVersion: updated.updatedAt.toISOString(), review: expect.objectContaining({ content: '会場名を確認してください' }) })));
});
it.each(['loading', 'error', 'permission'] as const)('does not allow a shared write while source is unavailable: %s', async problem => {
 state.loading = problem === 'loading'; state.error = problem === 'error' ? '取得できません' : null; if (problem === 'permission') state.owner = 'another';
 render(<NeoWorkContinuation {...props([task()])} />); await act(async () => {});
 expect(screen.getByRole('button', { name: '作業を始める' })).toBeDisabled();
 expect(sendWorkflow).not.toHaveBeenCalled(); expect(submitTaskComment).not.toHaveBeenCalled();
});
it('retains a completed selected job and closes actions when its project snapshot fails', async () => {
 const parent = task(); const other = task({ id: 'other', title: '別の仕事' });
 const ui = render(<NeoWorkContinuation {...props([parent, other])} />); await act(async () => {});
 fireEvent.change(screen.getByRole('combobox', { name: '続ける仕事' }), { target: { value: JSON.stringify(['project-1', 'parent']) } });
 state.task = task({ isCompleted: true }); ui.rerender(<NeoWorkContinuation {...props([state.task as MyTask, other])} />);
 expect(screen.getByRole('heading', { name: 'この仕事の結果を記録しました' })).toBeVisible();
 expect(screen.getByRole('combobox', { name: '続ける仕事' })).toHaveValue(JSON.stringify(['project-1', 'parent']));
 ui.rerender(<NeoWorkContinuation {...props([parent, other], new Map([['project-1', { status: 'error', error: new Error('offline') }]]))} />);
 expect(screen.queryByRole('button', { name: '作業を始める' })).not.toBeInTheDocument();
 expect(screen.getByText(/この仕事の最新情報を取得できません/)).toBeVisible();
 expect(sendWorkflow).not.toHaveBeenCalled();
});

it('closes the submitted form after a review round and does not reopen it automatically after approval', async () => {
 const parent = task({ workProgress: 'started' }); state.task = parent;
 const ui = render(<NeoWorkContinuation {...props([parent])} />); await act(async () => {});
 fireEvent.click(screen.getByRole('button', { name: '資料を送って確認してもらう' }));
 await waitFor(() => expect(screen.getByRole('textbox', { name: '確認してほしいこと' })).toBeEnabled());
 const review = task({ id: 'review', parentTaskId: 'parent', taskKind: 'review_request', assigneeIds: ['reviewer'], review: { round: 1, policy: 'any', request: '確認してください', attachments: [], responses: {}, requestedAt: '2026-09-13T00:00:00Z' } });
 ui.rerender(<NeoWorkContinuation {...props([parent, review])} />);
 expect(screen.queryByRole('textbox', { name: '確認してほしいこと' })).not.toBeInTheDocument();
 const approved = { ...review, isCompleted: true, review: { ...review.review!, responses: { reviewer: { outcome: 'approved' as const, note: '', at: '2026-09-13T01:00:00Z' } } } };
 ui.rerender(<NeoWorkContinuation {...props([parent, approved])} />);
 expect(screen.getByRole('button', { name: '資料を送って確認してもらう' })).toBeVisible();
 expect(screen.queryByRole('textbox', { name: '確認してほしいこと' })).not.toBeInTheDocument();
 expect(submitTaskComment).not.toHaveBeenCalled();
});

it('shows only the original request attachment for a legacy review without review metadata', async () => {
 const parent = task(); state.task = parent;
 const review = task({ id: 'review', parentTaskId: 'parent', taskKind: 'review_request', sourceCommentId: 'source', assigneeIds: ['reviewer'] });
 const file = { id: 'pdf', name: '初稿.pdf', url: 'https://example.test/draft.pdf', type: 'application/pdf', size: 10 };
 state.comments = [{ id: 'source', createdAt: new Date('2026-09-13T00:00:00Z'), attachments: [file] }, { id: 'another', createdAt: new Date('2026-09-13T01:00:00Z'), attachments: [{ ...file, name: '別件.pdf', url: 'https://example.test/other.pdf' }] }] as Comment[];
 render(<NeoWorkContinuation {...props([parent, review])} />); await act(async () => {});
 expect(screen.getByRole('link', { name: /初稿.pdf/ })).toHaveAttribute('href', file.url);
 expect(screen.queryByRole('link', { name: /別件.pdf/ })).not.toBeInTheDocument();
 expect(sendWorkflow).not.toHaveBeenCalled();
});

it('uses only explicit personal display choices and keeps the same task actions and return paths', async () => {
 vi.mocked(requestAISupport).mockResolvedValue({...DEFAULT_AI_SUPPORT, presentation:'overview',referenceNotes:'人物像の参考'});
 render(<NeoWorkContinuation {...props([task()])} />); await act(async()=>{});
 expect(await screen.findByRole('button',{name:'説明を短くする'})).toHaveAttribute('aria-expanded','true');
 expect(screen.getByRole('link',{name:'カンバン進捗'})).toHaveAttribute('href','/projects/project-1/board?taskView=progress&view=progress');
 expect(screen.getByRole('button',{name:'作業を始める'})).toBeVisible();
 expect(screen.queryByText('人物像の参考')).not.toBeInTheDocument();
 expect(sendWorkflow).not.toHaveBeenCalled();
});


it('shows the next assignees as avatars without repeating their names in the work summary', async () => {
 render(<NeoWorkContinuation {...props([task()])} />); await act(async () => {});
 const summary = screen.getByLabelText('現在の状況と次の担当');
 expect(within(summary).getByRole('group', { name: '担当者: 制作担当' })).toBeVisible();
 expect(summary).toHaveTextContent('未着手チラシ制作');
 expect(summary).not.toHaveTextContent('制作担当');
 expect(screen.getByRole('button', { name: '作業を始める' })).toBeEnabled();
});

it('uses actual checklist items on home and preserves them on failed save without completing the task',async()=>{
 state.checklists=[{id:'l',taskId:'parent',title:'準備',order:0,createdAt:new Date(),items:[{id:'a',text:'持ちもの確認',isChecked:false,order:0}]}];
 state.toggle.mockRejectedValueOnce(new Error('保存できません'));
 const ui=render(<NeoWorkContinuation {...props([task()])} />);await act(async()=>{});
 fireEvent.click(screen.getByRole('checkbox',{name:'持ちもの確認'}));
 await waitFor(()=>expect(state.toggle).toHaveBeenCalledWith('l','a'));
 expect(await screen.findByText('保存できません')).toBeVisible();
 expect(screen.getByRole('checkbox',{name:'持ちもの確認'})).not.toBeChecked();expect(sendWorkflow).not.toHaveBeenCalled();
 state.checklists=[{...state.checklists[0],items:[{...state.checklists[0].items[0],isChecked:true}]}];
 ui.rerender(<NeoWorkContinuation {...props([task()])} />);
 expect(screen.getByRole('checkbox',{name:'持ちもの確認'})).not.toBeVisible();
 fireEvent.click(screen.getByText('完了済み 1件'));
 expect(screen.getByRole('checkbox',{name:'持ちもの確認'})).toBeChecked();expect(sendWorkflow).not.toHaveBeenCalled();
});


it('limits the checklist preview across lists and leaves completed items available to undo', async () => {
 state.checklists = ['持ちもの', '会場'].map((title, listIndex) => ({ id: `list-${listIndex}`, taskId: 'parent', title, order: listIndex, createdAt: new Date(), items: Array.from({ length: 4 }, (_, index) => ({ id: `item-${index}`, text: `${title} ${index}`, isChecked: index === 0, order: index })) }));
 render(<NeoWorkContinuation {...props([task()])} />); await act(async () => {});
 const checklist = within(screen.getByRole('region', { name: 'この仕事のチェックリスト' }));
 for (const name of ['持ちもの持ちもの 1', '持ちもの持ちもの 2', '持ちもの持ちもの 3']) expect(checklist.getByRole('checkbox', { name })).toBeVisible();
 expect(checklist.getByRole('checkbox', { name: '会場会場 1' })).not.toBeVisible();
 expect(checklist.getByRole('checkbox', { name: '会場会場 0' })).not.toBeVisible();
 expect(checklist.getByText('残り6件 · 2/8完了')).toBeVisible();
 fireEvent.click(checklist.getByText('ほかの未完了 3件'));
 for (const name of ['会場会場 1', '会場会場 2', '会場会場 3']) expect(checklist.getByRole('checkbox', { name })).toBeVisible();
 expect(checklist.getByRole('checkbox', { name: '会場会場 0' })).not.toBeVisible();
 fireEvent.click(checklist.getByText('完了済み 2件'));
 expect(checklist.getByRole('checkbox', { name: '会場会場 0' })).toBeVisible();
 expect(checklist.getByRole('checkbox', { name: '持ちもの持ちもの 0' })).toBeVisible();
 fireEvent.click(checklist.getByRole('checkbox', { name: '会場会場 0' }));
 await waitFor(() => expect(state.toggle).toHaveBeenCalledWith('list-1', 'item-0'));
 expect(sendWorkflow).not.toHaveBeenCalled();
});
