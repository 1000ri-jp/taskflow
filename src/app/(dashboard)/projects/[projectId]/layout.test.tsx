import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ProjectLayout from './layout';
import { useProject } from '@/hooks/useProjects';
import type { Project } from '@/types';

vi.mock('next/navigation', () => ({
  useParams: () => ({ projectId: 'project-1' }),
  usePathname: () => '/projects/project-1/board',
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
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

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ user: { id: 'user-1' } }),
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

  it('places the task view dropdown inside the active board tab', () => {
    mockedUseProject.mockReturnValue({
      project,
      isLoading: false,
    } as ReturnType<typeof useProject>);

    render(
      <ProjectLayout>
        <div>content</div>
      </ProjectLayout>
    );

    expect(screen.getByRole('link', { name: /ボード/ })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'タスクの表示切り替え' })).toHaveValue('board');
  });
});
