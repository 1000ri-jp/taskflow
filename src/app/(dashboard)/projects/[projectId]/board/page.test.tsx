import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BoardPage from './page';
import { taskViewScope, useProjectTaskViewStore } from '@/stores/projectTaskViewStore';
import { viewList, viewTask } from '@/test/taskViewFixtures';
import type { BoardFilters } from '@/lib/board/filters';
import type { Task } from '@/types';

const state = vi.hoisted(() => ({ query: '', projectId: 'project-1', replace: vi.fn(), editTask: vi.fn(), removeTask: vi.fn(), duplicateTask: vi.fn(), updateProject: vi.fn(), error: null as Error | null, isLoading: false }));
vi.mock('next/navigation', () => ({ useParams: () => ({ projectId: state.projectId }), usePathname: () => `/projects/${state.projectId}/board`, useSearchParams: () => new URLSearchParams(state.query), useRouter: () => ({ replace: state.replace }) }));
vi.mock('@/hooks/useBoard', () => ({ useBoard: () => ({ lists: [viewList()], labels: [], tasks: [viewTask({ id: 'active', title: '準備する' }), viewTask({ id: 'done', title: '完了済み', isCompleted: true }), viewTask({ id: 'archive', title: 'アーカイブ済み', isArchived: true }), viewTask({ id: 'other', projectId: 'other', title: '他プロジェクト' })], ...state }) }));
vi.mock('@/hooks/useProjects', () => ({ useProject: () => ({ project: { memberIds: ['u'], urls: [] }, update: state.updateProject }) }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => ({ user: { id: 'u' } }) }));
vi.mock('@/components/board/ProjectUrlsBar', () => ({ ProjectUrlsBar: () => null }));
vi.mock('@/components/board/BoardView', () => ({ BoardView: () => <p>既存カンバン</p> }));
vi.mock('@/components/board/AlternateTaskViews', () => ({ AlternateTaskViews: ({ view, tasks, onTaskClick }: { view: string; tasks: Task[]; onTaskClick: (id: string) => void }) => <section aria-label={`view-${view}`}>{tasks.map(task => <button key={task.id} onClick={() => onTaskClick(task.id)}>{task.title}</button>)}</section> }));
vi.mock('@/components/board/BoardFilterBar', () => ({ BoardFilterBar: ({ filters, onFiltersChange, showCardSettings }: { filters: BoardFilters; onFiltersChange: (filters: BoardFilters) => void; showCardSettings: boolean }) => <div><input aria-label="テスト検索" value={filters.keyword} onChange={e => onFiltersChange({ ...filters, keyword: e.target.value })} /><button onClick={() => onFiltersChange({ ...filters, showCompleted: !filters.showCompleted })}>完了表示切替</button>{showCardSettings && <p>カード表示設定</p>}</div> }));
vi.mock('@/components/task/TaskDetailModal', () => ({ TaskDetailModal: ({ task, isOpen, onClose }: { task: Task | null; isOpen: boolean; onClose: () => void }) => isOpen ? <div role="dialog" aria-label="タスク詳細">{task?.title}<button onClick={onClose}>閉じる</button></div> : null }));
const renderPage = () => render(<QueryClientProvider client={new QueryClient()}><BoardPage /></QueryClientProvider>);
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  useProjectTaskViewStore.setState({ byScope: {}, hydrated: false, persistenceFailed: false });
  state.query = ''; state.projectId = 'project-1'; state.error = null; state.isLoading = false;
});

describe('project views integration', () => {
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
