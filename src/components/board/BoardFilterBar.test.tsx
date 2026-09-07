import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BoardFilterBar } from './BoardFilterBar';
import type { BoardFilters } from '@/lib/board/filters';

vi.mock('./CommentedTasksPopover', () => ({
  CommentedTasksPopover: () => <button type="button">コメントあり</button>,
}));

const defaultFilters: BoardFilters = {
  keyword: '',
  labelIds: new Set(),
  dueFilter: 'all',
  showCompleted: true,
};

describe('BoardFilterBar', () => {
  it('toggles the read-only today view', () => {
    const onFiltersChange = vi.fn();

    render(
      <BoardFilterBar
        projectId="project-1"
        filters={defaultFilters}
        labels={[]}
        tasks={[]}
        lists={[]}
        onFiltersChange={onFiltersChange}
        onTaskClick={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '今日やる' }));

    expect(onFiltersChange).toHaveBeenCalledWith({
      ...defaultFilters,
      dueFilter: 'today',
    });
  });
});
