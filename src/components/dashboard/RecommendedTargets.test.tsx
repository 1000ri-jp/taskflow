import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardTask } from '@/lib/dashboard/brief';
import { RecommendedTargets } from './RecommendedTargets';

const makeTask = (id: string, changes: Partial<DashboardTask> = {}) => ({ id, projectId: 'p', title: `タスク${id}`, dueDate: null, startDate: null, priority: null, isCompleted: false, isArchived: false, isAbandoned: false, dependsOnTaskIds: [], ...changes } as DashboardTask);
const props = { projectId: 'p', tasks: [makeTask('a'), makeTask('b'), makeTask('c'), makeTask('d')], isLoading: false, error: null as Error | null };
describe('RecommendedTargets', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 3, 12)); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
  it('automatically shows three task links with reasons and no selection controls or writes', () => {
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
    render(<RecommendedTargets {...props} />);
    expect(screen.getAllByRole('link')).toHaveLength(3);
    expect(screen.getByRole('link', { name: /タスクa/ })).toHaveAttribute('href', '/projects/p/board?task=a');
    expect(screen.queryByText('タスクd')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getAllByText('未完了タスクから候補を抽出')).toHaveLength(3);
    expect(storageWrite).not.toHaveBeenCalled();
  });
  it('updates titles and deadlines, replacing completed, archived or abandoned recommendations', () => {
    const { rerender } = render(<RecommendedTargets {...props} />);
    rerender(<RecommendedTargets {...props} tasks={[makeTask('a', { isCompleted: true }), makeTask('b', { isArchived: true }), makeTask('c', { isAbandoned: true }), makeTask('d', { title: '新しいタイトル', dueDate: new Date(2026, 8, 2) })]} />);
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByText('新しいタイトル')).toBeVisible();
    expect(screen.getByText('期限 2026.9.2')).toHaveClass('text-rose-700');
    const deadline = screen.getByText('期限 2026.9.2');
    const reason = screen.getByText('期限を1日超過');
    expect(reason).toBeVisible();
    expect(reason.parentElement).toBe(deadline.parentElement);
  });
  it('distinguishes loading, errors, partial results, and a genuinely empty list', () => {
    const { rerender } = render(<RecommendedTargets {...props} isLoading />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('読み込み中');
    rerender(<RecommendedTargets {...props} error={new Error('offline')} />);
    expect(screen.getByRole('alert')).toHaveTextContent('取得できた範囲');
    expect(screen.getAllByRole('link')).toHaveLength(3);
    rerender(<RecommendedTargets {...props} tasks={[]} error={new Error('offline')} />);
    expect(screen.queryByText('今月おすすめする未完了タスクはありません。')).not.toBeInTheDocument();
    rerender(<RecommendedTargets {...props} tasks={[]} />);
    expect(screen.getByText('今月おすすめする未完了タスクはありません。')).toBeVisible();
  });
  it('recomputes the month and deadlines when the date changes', () => {
    vi.setSystemTime(new Date(2026, 8, 30, 23, 59, 30));
    render(<RecommendedTargets {...props} tasks={[makeTask('october', { startDate: new Date(2026, 9, 1), dueDate: new Date(2026, 9, 1) })]} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByRole('link')).toHaveTextContent('タスクoctober');
    expect(screen.getByText(/本日期限/)).toBeVisible();
  });
});
