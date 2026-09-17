import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BoardPage from './page';
import { taskViewScope, useProjectTaskViewStore } from '@/stores/projectTaskViewStore';
import { viewList, viewTask } from '@/test/taskViewFixtures';
import type { BoardFilters } from '@/lib/board/filters';
import type { ProjectRole, Task } from '@/types';

const state = vi.hoisted(() => ({ query: '', projectId: 'project-1', replace: vi.fn(), editTask: vi.fn(), removeTask: vi.fn(), duplicateTask: vi.fn(), updateProject: vi.fn(), moveTask: vi.fn().mockResolvedValue(undefined), error: null as Error | null, isLoading: false,
  tasks: null as Task[] | null, canEditProgress: false, memberRole: 'editor' as ProjectRole | null, memberIds: ['u'], projectLoading: false, projectError: null as Error | null,
  calendarDateChange: undefined as ((task: Task, kind: '開始' | '期限' | '開始・期限', date: Date) => Promise<void>) | undefined,
}));
vi.mock('@/hooks/useProjectMilestones', () => ({ useProjectMilestones: () => ({ milestones: [], isLoading: false, error: false, selectedId: null, setSelectedId: vi.fn() }) }));
vi.mock('next/navigation', () => ({ useParams: () => ({ projectId: state.projectId }), usePathname: () => `/projects/${state.projectId}/board`, useSearchParams: () => new URLSearchParams(state.query), useRouter: () => ({ replace: state.replace }) }));
vi.mock('@/hooks/useBoard', () => ({ useBoard: () => ({ lists: [viewList()], labels: [], ...state, tasks: state.tasks ?? [viewTask({ id: 'active', title: '準備する', listId: 'missing-list' }), viewTask({ id: 'done', title: '完了済み', isCompleted: true }), viewTask({ id: 'archive', title: 'アーカイブ済み', isArchived: true }), viewTask({ id: 'other', projectId: 'other', title: '他プロジェクト' })] }) }));
vi.mock('@/hooks/useProjects', () => ({ useProject: () => ({ project: { id: state.projectId, ownerId: 'owner', isArchived: false, memberIds: state.memberIds, urls: [] }, members: state.memberRole ? [{ userId: 'u', role: state.memberRole }] : [], isLoading: state.projectLoading, error: state.projectError, update: state.updateProject }) }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => ({ user: { id: 'u' }, firebaseUser: { uid: 'u' } }) }));
vi.mock('@/components/board/ProjectUrlsBar', () => ({ ProjectUrlsBar: () => null }));
vi.mock('@/components/board/BoardView', () => ({ BoardView: () => <p>既存カンバン</p> }));
vi.mock('@/components/board/AlternateTaskViews', () => ({ AlternateTaskViews: ({ view, tasks, onTaskClick, onMoveTask, onDateChange, canEdit }: { view: string; tasks: Task[]; canEdit: boolean; onTaskClick: (id: string) => void; onMoveTask: (id: string, listId: string) => Promise<void>; onDateChange?: typeof state.calendarDateChange }) => {
  state.calendarDateChange = onDateChange; state.canEditProgress = canEdit;
  return <section aria-label={`view-${view}`}>{tasks.map(task => <button key={task.id} onClick={() => onTaskClick(task.id)}>{task.title}</button>)}<button onClick={() => { void onMoveTask('active', 'list-1'); }}>まとまりを選んで移動</button></section>;
} }));
vi.mock('@/components/board/BoardFilterBar', () => ({ BoardFilterBar: ({ filters, onFiltersChange, showCardSettings }: { filters: BoardFilters; onFiltersChange: (filters: BoardFilters) => void; showCardSettings: boolean }) => <div><input aria-label="テスト検索" value={filters.keyword} onChange={e => onFiltersChange({ ...filters, keyword: e.target.value })} /><button onClick={() => onFiltersChange({ ...filters, showCompleted: !filters.showCompleted })}>完了表示切替</button>{showCardSettings && <p>カード表示設定</p>}</div> }));
vi.mock('@/components/task/TaskDetailModal', () => ({ TaskDetailModal: ({ task, isOpen, onClose, openHistory }: { task: Task | null; isOpen: boolean; onClose: () => void; openHistory?: boolean }) => isOpen ? <div role="dialog" aria-label="タスク詳細" data-history-open={openHistory}>{task?.title}<button onClick={onClose}>閉じる</button></div> : null }));
const renderPage = () => render(<QueryClientProvider client={new QueryClient()}><BoardPage /></QueryClientProvider>);
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  useProjectTaskViewStore.setState({ byScope: {}, hydrated: false, persistenceFailed: false });
  state.query = ''; state.projectId = 'project-1'; state.error = null; state.isLoading = false;
  state.tasks = null; state.memberRole = 'editor'; state.memberIds = ['u']; state.projectLoading = false; state.projectError = null; state.calendarDateChange = undefined;
});

describe('project views integration', () => {
  it('opens history from its task link and clears the history flag on close while keeping view parameters', async () => {
    state.query = 'view=outline&task=active&history=1';
    renderPage();
    expect(await screen.findByRole('dialog')).toHaveAttribute('data-history-open', 'true');
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(state.replace).toHaveBeenLastCalledWith('/projects/project-1/board?view=outline', { scroll: false });
    expect(state.editTask).not.toHaveBeenCalled();
  });

  it('includes archived tasks only in the new progress view and opens their details without writing', async () => {
    state.query = 'view=progress';
    const ui = renderPage();
    expect(await screen.findByRole('region', { name: 'view-progress' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'アーカイブ済み' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('アーカイブ済み');
    expect(state.editTask).not.toHaveBeenCalled();
    ui.unmount();
    state.query = 'view=table';
    renderPage();
    expect(screen.queryByRole('button', { name: 'アーカイブ済み' })).toBeNull();
    expect(screen.queryByText('他プロジェクト')).toBeNull();
  });

  it('saves an undated deadline through the existing date edit operation without changing completion or making a task', async () => {
    state.query = 'view=calendar';
    renderPage();
    expect(state.editTask).not.toHaveBeenCalled();
    await state.calendarDateChange!(viewTask({ id: 'active' }), '期限', new Date(2026, 8, 8));
    expect(state.editTask).toHaveBeenCalledExactlyOnceWith('active', { startDate: null, dueDate: new Date(2026, 8, 8), durationDays: null, isDueDateFixed: true });
    for (const mutation of [state.removeTask, state.duplicateTask, state.updateProject, state.moveTask]) expect(mutation).not.toHaveBeenCalled();
  });
  it('recalculates from the current original task instead of a stale drag snapshot and propagates save failure', async () => {
    state.query = 'view=calendar';
    const current = viewTask({ id: 'active', startDate: new Date(2026, 8, 5), durationDays: 3, isCompleted: true, completedAt: new Date(2026, 8, 6) });
    state.tasks = [current];
    renderPage();
    state.editTask.mockRejectedValueOnce(new Error('permission-denied'));
    await expect(state.calendarDateChange!(viewTask({ id: 'active', durationDays: 99 }), '期限', new Date(2026, 8, 8))).rejects.toThrow('permission-denied');
    expect(state.editTask).toHaveBeenCalledExactlyOnceWith('active', { startDate: new Date(2026, 8, 5), dueDate: new Date(2026, 8, 8), durationDays: 4, isDueDateFixed: true });
    expect(current).toMatchObject({ isCompleted: true, completedAt: new Date(2026, 8, 6), dueDate: null, durationDays: 3 });
  });
  it.each(['viewer', 'missing-role', 'non-member', 'loading', 'error'] as const)('does not offer calendar date writes when project access is %s', access => {
    state.query = 'view=calendar';
    if (access === 'viewer') state.memberRole = 'viewer';
    if (access === 'missing-role') state.memberRole = null;
    if (access === 'non-member') state.memberIds = [];
    if (access === 'loading') state.projectLoading = true;
    if (access === 'error') state.projectError = new Error('permission-denied');
    renderPage();
    expect(screen.getByRole('region', { name: 'view-calendar' })).toBeInTheDocument();
    expect(state.calendarDateChange).toBeUndefined();
    expect(state.editTask).not.toHaveBeenCalled();
  });
  it.each(['archive', 'missing', 'other'] as const)('refuses to save a dropped %s task from outside the current editable source', async id => {
    state.query = 'view=calendar'; renderPage();
    await expect(state.calendarDateChange!(viewTask({ id, projectId: id === 'other' ? 'other' : 'project-1' }), '期限', new Date(2026, 8, 8))).rejects.toThrow('権限を確認できません');
    expect(state.editTask).not.toHaveBeenCalled();
  });
  it('routes list reassignment through the existing move operation, preserving its automation and undo behavior', async () => {
    state.query = 'view=outline';
    renderPage();
    expect(state.moveTask).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'まとまりを選んで移動' }));
    await waitFor(() => expect(state.moveTask).toHaveBeenCalledExactlyOnceWith('active', 'list-1', 1));
    expect(state.editTask).not.toHaveBeenCalled();
  });
  it('keeps the original Kanban default and view-only switching does not write any shared data', () => {
    state.query = 'view=table';
    renderPage();
    expect(screen.getByRole('region', { name: 'view-table' })).toBeInTheDocument();
    expect(screen.queryByText('既存カンバン')).not.toBeInTheDocument();
    expect(screen.queryByText('カード表示設定')).not.toBeInTheDocument();
    for (const mutation of [state.editTask, state.removeTask, state.duplicateTask, state.updateProject]) expect(mutation).not.toHaveBeenCalled();
  });
  it('uses project-scoped primary views on plain URLs and lets explicit URLs override them', () => {
    useProjectTaskViewStore.getState().setDefault(taskViewScope('u', 'project-1'), 'outline');
    const page = renderPage();
    expect(screen.getByRole('region', { name: 'view-outline' })).toBeInTheDocument();
    state.query = 'view=calendar';
    page.rerender(<QueryClientProvider client={new QueryClient()}><BoardPage /></QueryClientProvider>);
    expect(screen.getByRole('region', { name: 'view-calendar' })).toBeInTheDocument();
    expect(state.updateProject).not.toHaveBeenCalled();
    state.query = ''; state.projectId = 'project-2';
    page.rerender(<QueryClientProvider client={new QueryClient()}><BoardPage /></QueryClientProvider>);
    expect(screen.getByText('既存カンバン')).toBeInTheDocument();
  });
  it('shares filters across views and always excludes archived and other-project tasks', () => {
    state.query = 'view=table';
    const client = new QueryClient();
    const page = render(<QueryClientProvider client={client}><BoardPage /></QueryClientProvider>);
    expect(screen.queryByText('アーカイブ済み')).not.toBeInTheDocument();
    expect(screen.queryByText('他プロジェクト')).not.toBeInTheDocument();
    expect(screen.queryByText('カード表示設定')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '完了表示切替' }));
    expect(screen.queryByText('完了済み')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '準備' } });
    state.query = 'view=outline';
    page.rerender(<QueryClientProvider client={client}><BoardPage /></QueryClientProvider>);
    expect(screen.getByRole('textbox')).toHaveValue('準備');
    expect(screen.getByRole('button', { name: '準備する' })).toBeInTheDocument();
    expect(screen.queryByText('完了済み')).not.toBeInTheDocument();
  });
  it('preserves the view URL when opening and closing task details, and refetches checklist reads', () => {
    state.query = 'view=outline&extra=keep';
    const client = new QueryClient(); const invalidate = vi.spyOn(client, 'invalidateQueries');
    const page = render(<QueryClientProvider client={client}><BoardPage /></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: '準備する' }));
    expect(state.replace).toHaveBeenCalledWith('/projects/project-1/board?view=outline&extra=keep&task=active', { scroll: false });
    expect(screen.getByRole('dialog')).toHaveTextContent('準備する');
    state.query = 'view=outline&extra=keep&task=active';
    page.rerender(<QueryClientProvider client={client}><BoardPage /></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(state.replace).toHaveBeenLastCalledWith('/projects/project-1/board?view=outline&extra=keep', { scroll: false });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['outline-checklists', 'u', 'project-1', 'active'] });
    expect(state.editTask).not.toHaveBeenCalled();
  });
  it('distinguishes subscription failures from an empty view', () => {
    state.query = 'view=calendar'; state.error = new Error('permission-denied');
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent('タスクを取得できませんでした');
    expect(screen.queryByRole('region', { name: 'view-calendar' })).not.toBeInTheDocument();
  });
});

it.each(['editor', 'viewer', null] as const)('passes confirmed editing access to progress cards for %s', async role => {
  state.query = 'view=progress'; state.memberRole = role;
  renderPage();
  expect(await screen.findByRole('region', { name: 'view-progress' })).toBeInTheDocument();
  expect(screen.getByText('カード表示設定')).toBeInTheDocument();
  expect(state.canEditProgress).toBe(role === 'editor');
  expect(state.editTask).not.toHaveBeenCalled();
});
