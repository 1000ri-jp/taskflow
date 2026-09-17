import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Project } from '@/types';
import { ProjectCard } from './ProjectCard';

const project: Project = {
  id: 'project-1',
  name: '出展準備',
  description: '',
  icon: '📁',
  color: '#38bdf8',
  ownerId: 'user-1',
  memberIds: ['user-1'],
  isArchived: false,
  order: 0,
  createdAt: new Date('2026-09-01T00:00:00Z'),
  updatedAt: new Date('2026-09-01T00:00:00Z'),
};

describe('ProjectCard task count', () => {
  it('shows the member count first and up to ten avatars with named overflow, retaining unresolved members', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `member-${i}`);
    const people = ids.slice(0, 11).map((id, i) => ({ id, displayName: `メンバー${i}` }));
    const { rerender } = render(<ProjectCard project={{ ...project, memberIds: [...ids, ids[0]] }} members={people} />);
    const members = screen.getByRole('group', { name: /参加メンバー/ });
    expect(within(members).getAllByLabelText(/^メンバー\d+$/)).toHaveLength(10);
    expect(within(members).getByLabelText('メンバー0')).toBeVisible();
    expect(within(members).getByLabelText('ほか2人')).toHaveTextContent('+2');
    expect(members).toHaveAttribute('aria-label', expect.stringContaining('名前未取得'));
    expect(members.firstElementChild).toHaveTextContent('12人');
    rerender(<ProjectCard project={{ ...project, memberIds: ids.slice(0, 10) }} members={people} />);
    expect(within(members).getAllByLabelText(/^メンバー\d+$/)).toHaveLength(10);
    expect(members.firstElementChild).toHaveTextContent('10人');
    expect(within(members).queryByLabelText(/ほか\d+人/)).not.toBeInTheDocument();
  });

  it('exposes settings and archive directly and invokes only the selected existing operation', () => {
    const archive = vi.fn(); const restore = vi.fn(); const remove = vi.fn();
    const { rerender } = render(<ProjectCard project={project} onArchive={archive} onRestore={restore} onDelete={remove} />);
    expect(screen.getByRole('link', { name: '設定' })).toHaveAttribute('href', '/projects/project-1/settings');
    expect(archive).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '出展準備を削除' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '出展準備をアーカイブ' }));
    expect(archive).toHaveBeenCalledExactlyOnceWith('project-1');
    expect(restore).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
    rerender(<ProjectCard project={{ ...project, isArchived: true }} onArchive={archive} onRestore={restore} onDelete={remove} />);
    expect(screen.queryByRole('button', { name: '出展準備をアーカイブ' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '出展準備を復元' }));
    expect(restore).toHaveBeenCalledExactlyOnceWith('project-1');
  });
  it('does not present an unavailable count as zero', () => {
    render(<ProjectCard project={project} />);

    expect(screen.queryByText(/\d+ タスク/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /出展準備/ })).toHaveAttribute(
      'href',
      '/projects/project-1/board'
    );
  });

  it.each([0, 12])('shows the supplied count, including zero: %i', (taskCount) => {
    render(<ProjectCard project={project} taskCount={taskCount} />);

    expect(screen.getByText(`${taskCount} タスク`)).toBeVisible();
  });

  it.each(['loading', 'error'] as const)('keeps %s progress distinct from a known zero', (status) => {
    render(<ProjectCard project={project} taskCount={0} taskProgress={{ status }} />);
    expect(screen.queryByText('0 タスク')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(status === 'loading' ? '読み込み中' : '取得できません');
  });

  it('shows task completion, remaining work and overdue work without treating project metadata as task activity', () => {
    render(<ProjectCard project={project} taskProgress={{ status: 'ready', progress: { total: 4, completed: 1, remaining: 3, overdue: 2 } }} />);
    expect(screen.getByText('完了 1 / 4件')).toBeVisible();
    expect(screen.getByText('未完了 3件')).toBeVisible();
    expect(screen.getByText('期限超過 2件')).toBeVisible();
    expect(screen.getByText(/^更新:/)).toBeVisible();
  });

  it('shows an empty task collection only when its progress is ready', () => {
    render(<ProjectCard project={project} taskProgress={{ status: 'ready', progress: { total: 0, completed: 0, remaining: 0, overdue: 0 } }} />);
    expect(screen.getByText('0 タスク')).toBeVisible();
    expect(screen.queryByText(/期限超過/)).not.toBeInTheDocument();
  });
});
