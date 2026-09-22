import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProjectLayout from './layout';
import { useProject } from '@/hooks/useProjects';
import type { Project } from '@/types';
import { taskViewScope, useProjectTaskViewStore } from '@/stores/projectTaskViewStore';

const navigation = vi.hoisted(() => ({ pathname: '/projects/project-1/board', query: '', replace: vi.fn() }));
beforeEach(() => {
  localStorage.clear();
  useProjectTaskViewStore.setState({ byScope: {}, hydrated: false, persistenceFailed: false });
  navigation.pathname = '/projects/project-1/board';
  navigation.query = '';
  navigation.replace.mockClear();
});

vi.mock('next/navigation', () => ({
  useParams: () => ({ projectId: 'project-1' }),
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams(navigation.query),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.ComponentProps<'a'> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('next/image', () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean }) => {
    const imageProps = { ...props };
    delete imageProps.fill;

    return (
      // next/image is mocked as a regular image for component tests.
      // eslint-disable-next-line @next/next/no-img-element
      <img alt={imageProps.alt ?? ''} {...imageProps} />
    );
  },
}));

vi.mock('@/hooks/useProjects', () => ({
  useProject: vi.fn(),
}));

vi.mock('@/hooks/useMeetingMembers', () => ({
  useMeetingMembers: () => ({ users: [{ id: 'user-1', displayName: 'Kozue' }], isLoading: false, hasError: false, refresh: vi.fn() }),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ user: { id: 'user-1' }, firebaseUser: { uid: 'user-1' } }),
}));

const mockedUseProject = vi.mocked(useProject);

const project: Project = {
  id: 'project-1',
  name: 'TaskFlow',
  description: 'Header preview test project',
  color: '#0f766e',
  icon: '🚀',
  iconUrl: undefined,
  headerImageUrl: 'https://example.com/header.jpg',
  ownerId: 'user-1',
  memberIds: ['user-1'],
  isArchived: false,
  order: 0,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('ProjectLayout', () => {
  it('distinguishes loading, retrieval failure, and a successfully missing project', () => {
    mockedUseProject.mockReturnValue({ project: null, isLoading: true, error: null } as ReturnType<typeof useProject>);
    const page = render(<ProjectLayout><div>content</div></ProjectLayout>);
    expect(screen.getByRole('status')).toHaveTextContent('プロジェクトを読み込み中です。');
    expect(screen.queryByText('プロジェクトが見つかりません')).not.toBeInTheDocument();

    mockedUseProject.mockReturnValue({ project: null, isLoading: false, error: new Error('unavailable') } as ReturnType<typeof useProject>);
    page.rerender(<ProjectLayout><div>content</div></ProjectLayout>);
    expect(screen.getByRole('alert')).toHaveTextContent('プロジェクトを表示できません');
    expect(screen.queryByText('プロジェクトが見つかりません')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'プロジェクト一覧に戻る' })).toHaveAttribute('href', '/projects');

    mockedUseProject.mockReturnValue({ project: null, isLoading: false, error: null } as ReturnType<typeof useProject>);
    page.rerender(<ProjectLayout><div>content</div></ProjectLayout>);
    expect(screen.getByText('プロジェクトが見つかりません')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps matching cached content visible and describes a failed refresh honestly', () => {
    const update = vi.fn();
    mockedUseProject.mockReturnValue({ project, isLoading: false, error: new Error('unavailable'), update } as unknown as ReturnType<typeof useProject>);
    render(<ProjectLayout><div>content</div></ProjectLayout>);
    expect(screen.getByRole('heading', { name: 'TaskFlow', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('最後に取得できた内容を表示しています。');
    expect(screen.getByText('content')).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it('does not show the previous project or its children under a different route', () => {
    const previous = { ...project, id: 'previous-project', name: '前の案件' };
    mockedUseProject.mockReturnValue({ project: previous, isLoading: false, error: null } as ReturnType<typeof useProject>);
    const page = render(<ProjectLayout><div>content</div></ProjectLayout>);
    expect(screen.getByRole('status')).toHaveTextContent('プロジェクトを読み込み中です。');
    expect(screen.queryByText('前の案件')).not.toBeInTheDocument();
    expect(screen.queryByText('content')).not.toBeInTheDocument();
    mockedUseProject.mockReturnValue({ project: previous, isLoading: false, error: new Error('unavailable') } as ReturnType<typeof useProject>);
    page.rerender(<ProjectLayout><div>content</div></ProjectLayout>);
    expect(screen.getByRole('alert')).toHaveTextContent('プロジェクトを表示できません');
    expect(screen.queryByText('前の案件')).not.toBeInTheDocument();
  });

  it('labels an ongoing refresh without hiding content already received for this project', () => {
    mockedUseProject.mockReturnValue({ project, isLoading: true, error: null } as ReturnType<typeof useProject>);
    render(<ProjectLayout><div>content</div></ProjectLayout>);
    expect(screen.getByRole('status')).toHaveTextContent('前回取得した内容を表示しています。');
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('renders the project header banner with a bounded max height for wide screens', () => {
    mockedUseProject.mockReturnValue({
      project,
      isLoading: false,
    } as ReturnType<typeof useProject>);

    render(
      <ProjectLayout>
        <div>content</div>
      </ProjectLayout>
    );

    expect(screen.getByTestId('project-header-banner')).toHaveClass('aspect-[10/1]');
    expect(screen.getByTestId('project-header-banner')).toHaveClass('max-h-[120px]');
    expect(screen.getByTestId('project-header-banner')).toHaveClass('sm:max-h-[130px]');
    expect(screen.getByAltText('TaskFlow header')).toBeInTheDocument();
  });

  it('keeps the same bounded header sizing when no header image is configured', () => {
    mockedUseProject.mockReturnValue({
      project: {
        ...project,
        headerImageUrl: undefined,
      },
      isLoading: false,
    } as ReturnType<typeof useProject>);

    render(
      <ProjectLayout>
        <div>content</div>
      </ProjectLayout>
    );

    expect(screen.getByTestId('project-header-banner')).toHaveClass('aspect-[10/1]');
    expect(screen.getByTestId('project-header-banner')).toHaveClass('max-h-[120px]');
    expect(screen.getByTestId('project-header-banner')).toHaveClass('sm:max-h-[130px]');
    expect(screen.queryByAltText('TaskFlow header')).not.toBeInTheDocument();
  });

  it('offers direct icon shortcuts with kanban as the default view', () => {
    mockedUseProject.mockReturnValue({
      project,
      isLoading: false,
    } as ReturnType<typeof useProject>);

    render(
      <ProjectLayout>
        <div>content</div>
      </ProjectLayout>
    );

    expect(screen.getByRole('link', { name: 'カンバン' })).toHaveAttribute('href', '/projects/project-1/board?taskView=board&view=board');
    expect(screen.getByRole('link', { name: 'カレンダー' })).toHaveAttribute('href', '/projects/project-1/board?taskView=board&view=calendar');
    expect(screen.getByRole('link', { name: 'ガントチャート' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'マイルストーン' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'タスクの表示切り替え' })).not.toBeInTheDocument();
  });

  it('preserves the list selection in direct view shortcuts', () => {
    mockedUseProject.mockReturnValue({ project, isLoading: false } as ReturnType<typeof useProject>);
    navigation.query = 'taskView=outline&view=outline&list=show';
    render(<ProjectLayout><div>content</div></ProjectLayout>);
    expect(screen.getByRole('link', { name: 'カンバン' })).toHaveAttribute('href', '/projects/project-1/board?taskView=board&view=board&list=show');
    expect(screen.getByRole('link', { name: 'カレンダー' })).toHaveAttribute('href', '/projects/project-1/board?taskView=outline&view=calendar&list=show');
  });

  it('opens a saved gantt default from a plain project link while explicit views keep priority', () => {
    mockedUseProject.mockReturnValue({ project, isLoading: false } as ReturnType<typeof useProject>);
    useProjectTaskViewStore.getState().setDefault(taskViewScope('user-1', 'project-1'), 'gantt');
    navigation.query = 'list=show&task=child&comment=source';
    const page = render(<ProjectLayout><div>content</div></ProjectLayout>);
    expect(navigation.replace).toHaveBeenLastCalledWith('/projects/project-1/gantt?list=show&task=child&comment=source&taskView=board', { scroll: false });
    navigation.replace.mockClear();
    navigation.query += '&view=calendar';
    page.rerender(<ProjectLayout><div>content</div></ProjectLayout>);
    expect(navigation.replace).not.toHaveBeenCalled();
  });
});
