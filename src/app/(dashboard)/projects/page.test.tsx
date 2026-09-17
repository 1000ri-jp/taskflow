import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project, Task } from '@/types';
import type { ProjectTaskStatus } from '@/hooks/useMyTasks';
import { viewTask } from '@/test/taskViewFixtures';
import ProjectsPage from './page';

const state = vi.hoisted(() => ({
  projects: [] as Project[], loading: false, error: null as Error | null,
  archived: [] as Project[], archivesLoading: false, archivesError: null as Error | null,
  tasks: [] as Task[], statuses: new Map<string, ProjectTaskStatus>(), tasksError: null as Error | null,
  archive: vi.fn(), remove: vi.fn(), restore: vi.fn(), openProject: vi.fn(),
}));
vi.mock('@/hooks/useProjects', () => ({
  useProjects: () => ({ projects: state.projects, isLoading: state.loading, error: state.error, archive: state.archive, remove: state.remove }),
  useArchivedProjects: () => ({ archivedProjects: state.archived, isLoading: state.archivesLoading, error: state.archivesError, restore: state.restore }),
}));
vi.mock('@/hooks/useMyTasks', () => ({
  useMyTasks: () => ({ allProjectTasks: state.tasks, projectTaskStatus: state.statuses, error: state.tasksError }),
}));
vi.mock('@/hooks/useMeetingMembers', () => ({ useMeetingMembers: () => ({ users: [{ id: 'user-1', displayName: 'Kozue' }], isLoading: false, hasError: false, refresh: vi.fn() }) }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: (selector: (value: { user: { id: string } }) => unknown) => selector({ user: { id: 'user-1' } }) }));
vi.mock('@/stores/uiStore', () => ({ useUIStore: () => ({ openProjectModal: state.openProject }) }));
vi.mock('@/lib/firebase/testMode', () => ({ isE2EMockAuthEnabled: () => false }));

const project = (id: string, name: string, isArchived = false): Project => ({
  id, name, description: '', icon: '📁', color: '#38bdf8', ownerId: 'user-1', memberIds: ['user-1'],
  isArchived, order: 0, createdAt: new Date(2026, 8, 1), updatedAt: new Date(2026, 8, 1),
});

describe('project directory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.projects = [];
    state.loading = false;
    state.error = null;
    state.archived = [];
    state.archivesLoading = false;
    state.archivesError = null;
    state.tasks = [];
    state.statuses = new Map();
    state.tasksError = null;
  });

  it('separates project loading, failure and a confirmed empty list', () => {
    state.loading = true;
    const { rerender } = render(<ProjectsPage />);
    expect(screen.getByRole('status')).toHaveTextContent('プロジェクトを読み込み中');
    expect(screen.queryByText('0件')).not.toBeInTheDocument();
    expect(screen.queryByText('プロジェクトがありません')).not.toBeInTheDocument();
    state.loading = false;
    state.error = new Error('denied');
    rerender(<ProjectsPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('プロジェクトを取得できませんでした');
    expect(screen.queryByText('0件')).not.toBeInTheDocument();
    expect(screen.queryByText('プロジェクトがありません')).not.toBeInTheDocument();
    state.error = null;
    rerender(<ProjectsPage />);
    expect(screen.getByText('プロジェクトがありません')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'プロジェクトを作成' }));
    expect(state.openProject).toHaveBeenCalledOnce();
  });

  it('searches names without case or character-width surprises and distinguishes no matches from no projects', () => {
    state.projects = [project('a', 'Alpha'), project('b', 'Beta')];
    render(<ProjectsPage />);
    const search = screen.getByRole('textbox', { name: 'プロジェクト名で検索' });
    fireEvent.change(search, { target: { value: '  ＢｅＴａ  ' } });
    expect(screen.getByRole('link', { name: /Beta/ })).toBeVisible();
    expect(screen.queryByRole('link', { name: /Alpha/ })).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'missing' } });
    expect(screen.getByText('進行中のプロジェクトに一致するものはありません。')).toBeVisible();
    expect(screen.queryByText('プロジェクトがありません')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '検索条件を解除' }));
    expect(screen.getAllByTestId('project-card')).toHaveLength(2);
    expect(state.archive).not.toHaveBeenCalled();
  });

  it('shows successful project progress while another fails or remains pending', () => {
    state.projects = [project('a', 'Alpha'), project('b', 'Beta'), project('c', 'Gamma'), project('d', 'Empty')];
    state.statuses = new Map([
      ['a', { status: 'ready' }], ['b', { status: 'error', error: new Error('denied') }],
      ['c', { status: 'loading' }], ['d', { status: 'ready' }],
    ]);
    state.tasksError = new Error('denied');
    state.tasks = [viewTask({ projectId: 'a', id: 'done', isCompleted: true }), viewTask({ projectId: 'a', id: 'late', dueDate: new Date(2000, 0, 1), assigneeIds: ['someone-else'] })];
    render(<ProjectsPage />);
    const [a, b, c, d] = screen.getAllByTestId('project-card');
    expect(within(a).getByText('完了 1 / 2件')).toBeVisible();
    expect(within(a).getByText('期限超過 1件')).toBeVisible();
    expect(within(b).getByText('タスクの進捗を取得できません')).toBeVisible();
    expect(within(b).queryByText('0 タスク')).not.toBeInTheDocument();
    expect(within(c).getByText('タスクの進捗を読み込み中…')).toBeVisible();
    expect(within(c).queryByText('0 タスク')).not.toBeInTheDocument();
    expect(within(d).getByText('0 タスク')).toBeVisible();
  });

  it('keeps archived projects searchable and expandable without inventing task counts', () => {
    state.projects = [project('a', 'Alpha')];
    state.archived = [project('b', 'Beta', true), project('c', 'Gamma', true)];
    render(<ProjectsPage />);
    fireEvent.change(screen.getByRole('textbox', { name: 'プロジェクト名で検索' }), { target: { value: 'Beta' } });
    const toggle = screen.getByTestId('toggle-archived-projects');
    expect(toggle).toHaveTextContent('1 / 2');
    fireEvent.click(toggle);
    expect(screen.getByRole('link', { name: /Beta/ })).toBeVisible();
    expect(screen.queryByRole('link', { name: /Gamma/ })).not.toBeInTheDocument();
    expect(screen.queryByText('0 タスク')).not.toBeInTheDocument();
  });

  it('reports an archive-list failure instead of claiming it is empty', () => {
    state.archivesError = new Error('denied');
    render(<ProjectsPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('アーカイブ済みプロジェクトを取得できませんでした');
  });
  it.each(['loading', 'error'] as const)('limits a no-match claim to active projects while archives are %s', (status) => {
    state.projects = [project('a', 'Alpha')];
    state.archivesLoading = status === 'loading';
    state.archivesError = status === 'error' ? new Error('denied') : null;
    render(<ProjectsPage />);
    fireEvent.change(screen.getByRole('textbox', { name: 'プロジェクト名で検索' }), { target: { value: 'missing' } });
    expect(screen.getByText('進行中のプロジェクトに一致するものはありません。')).toBeVisible();
    expect(screen.queryByText('検索に一致するプロジェクトがありません。')).not.toBeInTheDocument();
    expect(screen.getByText(status === 'loading' ? 'アーカイブ済みプロジェクトを読み込み中…' : /アーカイブ済みプロジェクトを取得できませんでした/)).toBeVisible();
  });
});
