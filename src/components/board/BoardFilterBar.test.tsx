import { fireEvent, render, screen } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BoardFilterBar } from './BoardFilterBar';
import type { BoardFilters } from '@/lib/board/filters';

beforeAll(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterAll(() => vi.unstubAllGlobals());

vi.mock('./CommentedTasksPopover', () => ({
  CommentedTasksPopover: () => <button type="button">コメント</button>,
}));

const defaultFilters: BoardFilters = {
  keyword: '',
  labelIds: new Set(),
  dueFilter: 'all',
  showCompleted: true,
};

describe('BoardFilterBar', () => {
  it('keeps the search input visible and places the list selector after the other controls', () => {
    const change = vi.fn();
    const { container } = render(<BoardFilterBar projectId="p" filters={defaultFilters} labels={[]} tasks={[]} lists={[]} onFiltersChange={change} onTaskClick={vi.fn()} showCardSettings={false} extraControls={<button>節目</button>} endControls={<select aria-label="まとまり"><option>すべて</option></select>} />);
    expect(screen.getByRole('textbox', { name: 'タスクを検索' })).toBeVisible();
    expect(container.firstElementChild?.lastElementChild).toContainElement(screen.getByRole('combobox', { name: 'まとまり' }));
    expect(screen.getByRole('button', { name: '節目' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'タスクを検索' }), { target: { value: '画像' } });
    expect(change).toHaveBeenCalledWith({ ...defaultFilters, keyword: '画像' });
  });
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

  it('explains the deadline icon on hover without filtering and still opens its controls on click', async () => {
    const change = vi.fn();
    render(<BoardFilterBar projectId="p" filters={defaultFilters} labels={[]} tasks={[]} lists={[]} onFiltersChange={change} onTaskClick={vi.fn()} showCardSettings={false} />);
    const deadline = screen.getByRole('button', { name: '期限' });
    fireEvent.pointerMove(deadline, { pointerType: 'mouse' });
    expect(await screen.findByRole('tooltip')).toHaveTextContent('今週まで・期限切れ・期限なしなどで絞り込みます。');
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(deadline);
    fireEvent.click(screen.getByRole('button', { name: '今週まで' }));
    expect(change).toHaveBeenCalledWith({ ...defaultFilters, dueFilter: 'week' });
  });
});
