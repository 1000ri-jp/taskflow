import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from './Sidebar';
import { useProjects } from '@/hooks/useProjects';
import { useUIStore } from '@/stores/uiStore';
import { useAuthStore } from '@/stores/authStore';
import { viewTask } from '@/test/taskViewFixtures';
import type { ProjectTaskStatus } from '@/hooks/useMyTasks';
import type { Notification, Project, Task } from '@/types';

const navigation = vi.hoisted(() => ({ pathname: '/projects/project-1/board' }));
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.ComponentProps<'a'>) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('@/hooks/useProjects', () => ({ useProjects: vi.fn() }));
const attentionData = vi.hoisted(() => ({ tasks: [] as Task[], status: new Map<string, ProjectTaskStatus>(), notifications: [] as Notification[], notificationsLoading: false, notificationsError: null as Error | null }));
vi.mock('@/hooks/useMyTasks', () => ({ useMyTasks: () => ({ allProjectTasks: attentionData.tasks, projectTaskStatus: attentionData.status }) }));
vi.mock('@/hooks/useNotifications', () => ({ useNotifications: () => ({ notifications: attentionData.notifications, isLoading: attentionData.notificationsLoading, error: attentionData.notificationsError }) }));

const projects: Project[] = [
  { id: 'project-1', name: '制作案件', description: '', color: '#0f766e', icon: '🌱', ownerId: 'user-1', memberIds: ['user-1'], isArchived: false, order: 0, createdAt: new Date(), updatedAt: new Date() },
  { id: 'project-10', name: '別の案件', description: '', color: '#0f766e', icon: '🌿', ownerId: 'user-1', memberIds: ['user-1'], isArchived: false, order: 1, createdAt: new Date(), updatedAt: new Date() },
];
const reorder = vi.fn();
const mockedUseProjects = vi.mocked(useProjects);
const showProjects = (values: Partial<ReturnType<typeof useProjects>> = {}) => mockedUseProjects.mockReturnValue({
  projects, isLoading: false, error: null, reorder, ...values,
} as ReturnType<typeof useProjects>);

beforeEach(() => {
  vi.clearAllMocks();
  navigation.pathname = '/projects/project-1/board';
  useUIStore.setState({ isSidebarOpen: true, isSidebarCollapsed: false, isProjectModalOpen: false });
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  showProjects();
  useAuthStore.setState({ user: { id: 'user-1' } as NonNullable<ReturnType<typeof useAuthStore.getState>['user']> });
  attentionData.tasks = []; attentionData.notifications = [];
  attentionData.status = new Map(projects.map(project => [project.id, { status: 'ready' }]));
  attentionData.notificationsLoading = false; attentionData.notificationsError = null;
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const notice = (patch: Partial<Notification> = {}): Notification => ({ id: 'notice-1', userId: 'user-1', type: 'comment_added', title: 'コメント', message: '', projectId: 'project-1', taskId: 'task-1', isRead: false, createdAt: new Date(), data: {}, ...patch });

describe('Sidebar project attention', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 15, 12)); });
  it('counts unfinished project work before today, including other members and unassigned tasks', () => {
    const dueDate = new Date(2026, 8, 14, 23, 59);
    attentionData.tasks = [
      viewTask({ id: 'other-member', dueDate, assigneeIds: ['other'] }),
      viewTask({ id: 'unassigned', dueDate, assigneeIds: [] }),
      viewTask({ id: 'today', dueDate: new Date(2026, 8, 15) }),
      viewTask({ id: 'future', dueDate: new Date(2026, 8, 16) }),
      viewTask({ id: 'done', dueDate, isCompleted: true }),
      viewTask({ id: 'archived', dueDate, isArchived: true }),
      viewTask({ id: 'cancelled', dueDate, isAbandoned: true }),
      viewTask({ id: 'invalid', dueDate: new Date('invalid') }),
      viewTask({ id: 'no-date' }),
      viewTask({ id: 'unknown-project', projectId: 'unavailable', dueDate }),
    ];
    render(<Sidebar />);
    const project = screen.getByRole('link', { name: '制作案件' });
    expect(within(project).getByTitle('期限切れ 2件')).toBeVisible();
    expect(project).toHaveAccessibleDescription('プロジェクト全体の期限切れ 2件');
    expect(screen.getByRole('link', { name: '別の案件' })).not.toHaveAttribute('aria-describedby');
  });
  it('shows unread notifications separately and updates both indicators after completion and reading', () => {
    attentionData.tasks = [viewTask({ dueDate: new Date(2026, 8, 14) })];
    attentionData.notifications = [notice(), notice({ id: 'notice-2', type: 'task_bell' }), notice({ id: 'read', isRead: true }), notice({ id: 'someone-else', userId: 'other' }), notice({ id: 'neighbour', projectId: 'project-10' })];
    const page = render(<Sidebar />);
    const project = screen.getByRole('link', { name: '制作案件' });
    expect(within(project).getByTitle('期限切れ 1件')).toBeVisible();
    expect(within(project).getByTitle('未読通知 2件')).toBeVisible();
    expect(project).toHaveAccessibleDescription('プロジェクト全体の期限切れ 1件、自分への未読通知 2件');
    expect(within(screen.getByRole('link', { name: '別の案件' })).getByTitle('未読通知 1件')).toBeVisible();
    attentionData.tasks = attentionData.tasks.map(task => ({ ...task, isCompleted: true }));
    attentionData.notifications = attentionData.notifications.map(notification => ({ ...notification, isRead: true }));
    page.rerender(<Sidebar />);
    expect(project).not.toHaveAttribute('aria-describedby');
    expect(project).toHaveAttribute('title', '制作案件');
    expect(within(project).queryByTitle(/期限切れ|未読通知/)).not.toBeInTheDocument();
    expect(reorder).not.toHaveBeenCalled();
  });
  it('suppresses counts from unavailable sources while retaining another ready project', () => {
    attentionData.tasks = projects.map(project => viewTask({ projectId: project.id, dueDate: new Date(2026, 8, 14) }));
    attentionData.notifications = [notice()];
    attentionData.status.set('project-1', { status: 'loading' });
    attentionData.notificationsLoading = true;
    const page = render(<Sidebar />);
    const project = screen.getByRole('link', { name: '制作案件' });
    expect(project).not.toHaveAttribute('aria-describedby');
    expect(screen.getByRole('link', { name: '別の案件' })).toHaveAccessibleDescription('プロジェクト全体の期限切れ 1件');
    attentionData.status.set('project-1', { status: 'error', error: new Error('unavailable') });
    attentionData.notificationsLoading = false; attentionData.notificationsError = new Error('unavailable');
    page.rerender(<Sidebar />);
    expect(project).not.toHaveAttribute('aria-describedby');
  });
  it('keeps project navigation and accessible counts when the sidebar is collapsed', () => {
    attentionData.tasks = [viewTask({ dueDate: new Date(2026, 8, 14) })];
    attentionData.notifications = [notice()];
    useUIStore.setState({ isSidebarCollapsed: true });
    render(<Sidebar />);
    const project = screen.getByRole('link', { name: '制作案件' });
    expect(project).toHaveAttribute('href', '/projects/project-1/board');
    expect(project).toHaveAccessibleDescription('プロジェクト全体の期限切れ 1件、自分への未読通知 1件');
    expect(project).toHaveAttribute('title', '制作案件 — プロジェクト全体の期限切れ 1件、自分への未読通知 1件');
    expect(project.querySelectorAll('.rounded-full')).toHaveLength(2);
    expect(reorder).not.toHaveBeenCalled();
  });
  it('starts the overdue marker after midnight and removes it on logout', () => {
    vi.setSystemTime(new Date(2026, 8, 15, 23, 59, 30));
    attentionData.tasks = [viewTask({ dueDate: new Date(2026, 8, 15) })];
    attentionData.notifications = [notice()];
    render(<Sidebar />);
    const project = screen.getByRole('link', { name: '制作案件' });
    expect(within(project).queryByTitle(/期限切れ/)).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(60_000));
    expect(within(project).getByTitle('期限切れ 1件')).toBeVisible();
    act(() => useAuthStore.setState({ user: null }));
    expect(project).not.toHaveAttribute('aria-describedby');
  });
});

describe('Sidebar project navigation', () => {
  it.each(['board', 'gantt', 'activity', 'settings'])('keeps the project selected in %s without selecting a prefix neighbour', tab => {
    navigation.pathname = `/projects/project-1/${tab}`;
    render(<Sidebar />);
    const links = within(screen.getByRole('navigation', { name: '参加中のプロジェクト' }));
    expect(links.getByRole('link', { name: '制作案件' })).toHaveAttribute('aria-current', 'page');
    expect(links.getByRole('link', { name: '別の案件' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'プロジェクト' })).not.toHaveAttribute('aria-current');
  });

  it('does not confuse project-1 with project-10 or the project list', () => {
    navigation.pathname = '/projects/project-10/settings';
    const page = render(<Sidebar />);
    expect(screen.getByRole('link', { name: '制作案件' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: '別の案件' })).toHaveAttribute('aria-current', 'page');
    navigation.pathname = '/projects';
    page.rerender(<Sidebar />);
    expect(screen.getByRole('link', { name: 'プロジェクト' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '別の案件' })).not.toHaveAttribute('aria-current');
  });

  it('keeps meaningful names when collapsed and opens creation without saving project data', () => {
    useUIStore.setState({ isSidebarCollapsed: true });
    render(<Sidebar />);
    expect(screen.getByRole('link', { name: '制作案件' })).toHaveAttribute('title', '制作案件');
    expect(screen.getByRole('link', { name: '設定' })).toBeInTheDocument();
    const create = screen.getByRole('button', { name: 'プロジェクトを作成' });
    expect(create).toHaveAttribute('title', 'プロジェクトを作成');
    fireEvent.click(create);
    expect(useUIStore.getState().isProjectModalOpen).toBe(true);
    expect(reorder).not.toHaveBeenCalled();
  });

  it('makes reorder handles named and visible on keyboard focus', () => {
    render(<Sidebar />);
    const handle = screen.getByRole('button', { name: '制作案件を並べ替え' });
    expect(handle).toHaveClass('focus-visible:opacity-100');
    expect(handle).not.toBeDisabled();
  });
});

describe('Sidebar project retrieval states', () => {
  it('distinguishes initial loading, a failed request, and a successful empty list', () => {
    showProjects({ projects: [], isLoading: true });
    const page = render(<Sidebar />);
    expect(screen.getByText('プロジェクトを読み込み中です。')).toBeInTheDocument();
    expect(screen.queryByText('参加中のプロジェクトはありません。')).not.toBeInTheDocument();
    showProjects({ projects: [], error: new Error('unavailable') });
    page.rerender(<Sidebar />);
    expect(screen.getByRole('alert')).toHaveTextContent('プロジェクトを取得できませんでした。');
    expect(screen.queryByText('参加中のプロジェクトはありません。')).not.toBeInTheDocument();
    showProjects({ projects: [] });
    page.rerender(<Sidebar />);
    expect(screen.getByText('参加中のプロジェクトはありません。')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('labels retained projects on failure and disables stale reordering', () => {
    showProjects({ error: new Error('unavailable') });
    render(<Sidebar />);
    expect(screen.getByRole('alert')).toHaveTextContent('最後に取得できたプロジェクトを表示しています。');
    expect(screen.getByRole('link', { name: '制作案件' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '制作案件を並べ替え' })).toBeDisabled();
    expect(reorder).not.toHaveBeenCalled();
  });

  it('labels retained projects while refreshing', () => {
    showProjects({ isLoading: true });
    render(<Sidebar />);
    expect(screen.getByText('プロジェクトを更新中です。前回取得した一覧を表示しています。')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '制作案件' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '制作案件を並べ替え' })).toBeDisabled();
  });
});
