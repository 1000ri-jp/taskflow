import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskCard } from './TaskCard';
import type { Label, Tag, Task } from '@/types';
import { DEFAULT_BOARD_DISPLAY, useBoardDisplayStore } from '@/stores/boardDisplayStore';
import { getUsersByIds } from '@/lib/firebase/firestore';

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: ({ disabled }: { disabled?: boolean }) => ({
    attributes: { role: 'button', tabIndex: 0, 'aria-disabled': disabled, 'aria-roledescription': 'sortable' },
    listeners: {},
    setNodeRef: () => undefined,
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <div data-testid="task-card-hover-details">{children}</div>
  ),
}));

vi.mock('@/lib/firebase/firestore', () => ({
  getUsersByIds: vi.fn().mockResolvedValue([]),
  getTaskAttachments: vi.fn().mockResolvedValue([]),
}));

const baseTask: Task = {
  id: 'task-1',
  projectId: 'project-1',
  listId: 'list-1',
  title: 'タスクカードの日付とステータスを見やすくするための長いタイトル',
  description: 'ホバーで表示する詳細です',
  order: 0,
  assigneeIds: [],
  labelIds: ['label-1'],
  tagIds: ['tag-1'],
  dependsOnTaskIds: [],
  priority: 'high',
  startDate: new Date('2026-07-15T00:00:00.000Z'),
  dueDate: new Date('2026-07-18T00:00:00.000Z'),
  durationDays: null,
  isDueDateFixed: false,
  isCompleted: false,
  completedAt: null,
  isAbandoned: false,
  isArchived: false,
  archivedAt: null,
  archivedBy: null,
  createdBy: 'user-1',
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
  updatedAt: new Date('2026-07-01T00:00:00.000Z'),
};

const labels: Label[] = [{
  id: 'label-1',
  projectId: 'project-1',
  name: 'デザイン',
  color: '#7c3aed',
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
}];

const tags: Tag[] = [{
  id: 'tag-1',
  projectId: 'project-1',
  name: 'UI改善',
  color: '#0891b2',
  order: 0,
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
}];

function renderTaskCard(task: Task = baseTask, availableTags: Tag[] = tags, onClick = vi.fn()) {
  return render(
    <TaskCard
      projectId="project-1"
      task={task}
      listName="進行中"
      listColor="#2563eb"
      labels={labels}
      tags={availableTags}
      allTasks={[task]}
      onClick={onClick}
    />
  );
}

describe('TaskCard', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 3, 12));
    useBoardDisplayStore.setState({ settings: { ...DEFAULT_BOARD_DISPLAY } });
  });
  afterEach(() => vi.useRealTimers());

  it('keeps a date-sorted card clickable and keyboard accessible without drag semantics', () => {
    const onClick = vi.fn();
    render(<TaskCard projectId="project-1" task={baseTask} listName="進行中" listColor="#2563eb"
      labels={labels} tags={tags} onClick={onClick} disableDragging />);
    const card = screen.getByTestId('task-card');
    expect(card).not.toHaveAttribute('aria-disabled');
    expect(card).not.toHaveAttribute('aria-roledescription');
    fireEvent.click(card);
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: ' ' });
    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it('removes the card notification action while retaining opening the task', () => {
    const onClick = vi.fn();
    renderTaskCard(baseTask, tags, onClick);
    const card = screen.getByTestId('task-card');
    fireEvent.mouseEnter(card);
    fireEvent.focus(card);
    expect(within(card).queryByRole('button', { name: 'メンバーに通知' })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('メッセージ（任意）')).not.toBeInTheDocument();
    fireEvent.click(card);
    expect(onClick).toHaveBeenCalledOnce();
    expect(within(card).getByTestId('task-card-tag')).toHaveTextContent('UI改善');
  });

  it('shows the date rail and keeps the summary compact', () => {
    renderTaskCard();

    const card = screen.getByTestId('task-card');
    const dateRail = within(card).getByTestId('task-card-date-rail');
    const title = within(card).getByText(baseTask.title);

    expect(dateRail).toHaveTextContent('7/15〜7/18');
    expect(dateRail).toHaveClass('w-14', 'gap-1.5', 'py-2', 'text-red-700', 'bg-red-50');
    expect(dateRail).toHaveAttribute('data-date-status', 'overdue');
    expect(within(dateRail).getByText('7/15')).toHaveClass('text-[15px]', 'font-bold');
    expect(within(dateRail).getByText('7/18')).toHaveClass('text-[15px]', 'font-bold');
    expect(title).toHaveClass('line-clamp-2');
    expect(within(card).getByText('高')).toBeInTheDocument();
    expect(within(card).queryByText('進行中')).not.toBeInTheDocument();
    expect(within(card).queryByText(baseTask.description)).not.toBeInTheDocument();
    expect(within(card).queryByText('デザイン')).not.toBeInTheDocument();
    expect(within(card).getByText('UI改善')).toBeInTheDocument();
  });

  it('keeps the description, labels, and full tag names in hover details', () => {
    renderTaskCard();

    const details = screen.getByTestId('task-card-hover-details');

    expect(within(details).getByText(baseTask.description)).toBeInTheDocument();
    expect(within(details).getByText('デザイン')).toBeInTheDocument();
    expect(within(details).getByText('UI改善')).toBeInTheDocument();
  });

  it('uses the full content width when neither date is set', () => {
    renderTaskCard({
      ...baseTask,
      startDate: null,
      dueDate: null,
      description: '',
      labelIds: [],
      tagIds: [],
    });

    const card = screen.getByTestId('task-card');

    expect(within(card).queryByTestId('task-card-date-rail')).not.toBeInTheDocument();
    expect(within(card).queryByText('進行中')).not.toBeInTheDocument();
  });

  it('reacts to display settings without altering task data, dates, or completion', () => {
    const completed = { ...baseTask, isCompleted: true };
    const original = structuredClone(completed);
    renderTaskCard(completed);
    act(() => useBoardDisplayStore.getState().setOption('showListName', true));
    expect(within(screen.getByTestId('task-card')).getByText('進行中')).toBeInTheDocument();
    act(() => {
      useBoardDisplayStore.getState().setOption('showListName', false);
      useBoardDisplayStore.getState().setOption('showAssignees', false);
      useBoardDisplayStore.getState().setOption('showPriority', false);
    });
    const card = screen.getByTestId('task-card');
    expect(within(card).getByTestId('task-card-metadata')).toContainElement(screen.getByTestId('task-card-completion'));
    expect(within(card).queryByText('高')).not.toBeInTheDocument();
    expect(within(card).getByText('完了日未記録')).toBeInTheDocument();
    expect(within(card).getByTestId('task-card-date-rail')).toBeInTheDocument();
    expect(completed).toEqual(original);
  });

  it('hides and restores assigned users without modifying assignments', async () => {
    vi.mocked(getUsersByIds).mockResolvedValueOnce([{
      id: 'kozue', displayName: 'Kozue', email: 'test@example.com', photoURL: null,
      createdAt: new Date(), updatedAt: new Date(),
    }]);
    const assigned = { ...baseTask, assigneeIds: ['kozue'] };
    renderTaskCard(assigned);
    expect(await screen.findByText('K')).toBeInTheDocument();
    act(() => useBoardDisplayStore.getState().setOption('showAssignees', false));
    expect(screen.queryByText('K')).not.toBeInTheDocument();
    act(() => useBoardDisplayStore.getState().setOption('showAssignees', true));
    expect(screen.getByText('K')).toBeInTheDocument();
    expect(assigned.assigneeIds).toEqual(['kozue']);
  });

  it('shows completion clearly without changing a missing due date', () => {
    renderTaskCard({
      ...baseTask,
      startDate: null,
      dueDate: null,
      isCompleted: true,
      completedAt: new Date('2026-07-20T00:00:00.000Z'),
    });

    const card = screen.getByTestId('task-card');

    expect(card).toHaveAttribute('data-completed', 'true');
    expect(card).toHaveClass('border-neutral-300', 'bg-emerald-50/50');
    expect(card).not.toHaveClass('border-emerald-300');
    const completion = within(card).getByTestId('task-card-completion');
    expect(completion).toHaveTextContent('7/20完了');
    expect(within(completion).getByText('7/20')).toHaveAttribute('datetime', '2026-07-20');
    expect(completion).toHaveAttribute('title', '完了日：2026年7月20日');
    expect(within(card).getByText(baseTask.title)).toHaveClass('line-through');
    expect(within(card).queryByTestId('task-card-date-rail')).not.toBeInTheDocument();
  });

  it.each([
    { label: 'today', dueDate: new Date(2026, 8, 3), isCompleted: false },
    { label: 'future', dueDate: new Date(2026, 11, 31), isCompleted: false },
    { label: 'completed', dueDate: new Date(2026, 7, 25), isCompleted: true },
  ])('does not emphasize $label deadlines', ({ dueDate, isCompleted }) => {
    renderTaskCard({ ...baseTask, startDate: null, dueDate, isCompleted });
    const rail = screen.getByTestId('task-card-date-rail');
    const date = rail.querySelector('time');
    expect(date).toHaveClass('text-[15px]', 'font-normal');
    expect(rail).toHaveClass('text-slate-600', 'bg-blue-50');
    expect(date).not.toHaveClass('font-bold', 'text-red-700');
  });

  it.each([
    { label: 'start day including a later time', startDate: new Date(2026, 8, 3, 23), dueDate: new Date(2026, 8, 5) },
    { label: 'within the scheduled period', startDate: new Date(2026, 8, 1), dueDate: new Date(2026, 8, 5) },
    { label: 'on the due day', startDate: new Date(2026, 8, 1), dueDate: new Date(2026, 8, 3) },
    { label: 'no deadline after starting', startDate: new Date(2026, 8, 1), dueDate: null },
  ])('uses yellow text and background for $label', ({ startDate, dueDate }) => {
    renderTaskCard({ ...baseTask, startDate, dueDate });
    const rail = screen.getByTestId('task-card-date-rail');
    expect(rail).toHaveAttribute('data-date-status', 'started');
    expect(rail).toHaveClass('text-yellow-800', 'bg-yellow-50', 'border-yellow-200');
    rail.querySelectorAll('time').forEach((date) => {
      expect(date).toHaveClass('font-bold');
      expect(date).not.toHaveClass('font-normal');
    });
    expect(rail).not.toHaveClass('text-red-700', 'bg-red-50');
  });

  it.each([
    { label: 'not yet started', startDate: new Date(2026, 8, 4), isCompleted: false },
    { label: 'completed', startDate: new Date(2026, 8, 1), isCompleted: true },
  ])('does not highlight $label tasks as started', ({ startDate, isCompleted }) => {
    renderTaskCard({ ...baseTask, startDate, dueDate: new Date(2026, 8, 5), isCompleted });
    expect(screen.getByTestId('task-card-date-rail')).toHaveAttribute('data-date-status', 'neutral');
  });

  it('places the completion badge beside assignee icons below the title', async () => {
    vi.mocked(getUsersByIds).mockResolvedValueOnce([{
      id: 'kozue', displayName: 'Kozue', email: 'test@example.com', photoURL: null,
      createdAt: new Date(), updatedAt: new Date(),
    }]);
    renderTaskCard({ ...baseTask, assigneeIds: ['kozue'], isCompleted: true, completedAt: new Date(2026, 8, 1) });
    const assignees = await screen.findByTestId('task-card-assignees');
    const completion = screen.getByTestId('task-card-completion');
    expect(completion.previousElementSibling).toBe(assignees);
    expect(screen.getByTestId('task-card-metadata')).toContainElement(completion);
    expect(screen.getByText(baseTask.title).parentElement).not.toContainElement(completion);
    act(() => useBoardDisplayStore.getState().setOption('showAssignees', false));
    expect(screen.queryByTestId('task-card-assignees')).not.toBeInTheDocument();
    expect(screen.getByTestId('task-card-completion')).toHaveTextContent('9/1完了');
  });

  it('omits an empty footer on incomplete tasks with all metadata hidden', () => {
    useBoardDisplayStore.setState({ settings: { showListName: false, showAssignees: false, showPriority: false, showTags: false } });
    renderTaskCard();
    expect(screen.queryByTestId('task-card-metadata')).not.toBeInTheDocument();
  });

  it('shows the actual completion date rather than the due date', () => {
    renderTaskCard({ ...baseTask, isCompleted: true, completedAt: new Date(2026, 6, 21) });
    expect(screen.getByTestId('task-card-completion')).toHaveTextContent('7/21完了');
    expect(screen.getByTestId('task-card-date-rail')).toHaveTextContent('7/15〜7/18');
  });

  it('shows tags beside assignee icons without changing assignments or tags', async () => {
    vi.mocked(getUsersByIds).mockResolvedValueOnce([{
      id: 'kozue', displayName: 'Kozue', email: 'test@example.com', photoURL: null,
      createdAt: new Date(), updatedAt: new Date(),
    }]);
    const task = { ...baseTask, assigneeIds: ['kozue'] };
    const original = structuredClone(task);
    renderTaskCard(task);
    const assignees = await screen.findByTestId('task-card-assignees');
    const tag = screen.getByTestId('task-card-tag');
    expect(tag.previousElementSibling).toBe(assignees);
    expect(tag).toHaveTextContent('UI改善');
    expect(tag).toHaveAttribute('title', 'UI改善');
    expect(tag).toHaveStyle({ backgroundColor: tags[0].color });
    expect(assignees.parentElement).toHaveClass('flex-wrap');
    act(() => useBoardDisplayStore.getState().setOption('showTags', false));
    expect(screen.queryByTestId('task-card-tag')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('task-card-hover-details')).getByText('UI改善')).toBeInTheDocument();
    act(() => useBoardDisplayStore.getState().setOption('showTags', true));
    expect(screen.getByTestId('task-card-tag')).toBeInTheDocument();
    expect(task).toEqual(original);
  });

  it('shows tags without assignees and bounds long names to the card width', () => {
    const longTag = { ...tags[0], id: 'tag-2', name: '長いタグの名前をカードの幅からはみ出さないように表示する' };
    renderTaskCard({ ...baseTask, assigneeIds: [], tagIds: ['tag-1', 'tag-2', 'deleted-tag'], priority: null }, [...tags, longTag]);
    expect(screen.queryByTestId('task-card-assignees')).not.toBeInTheDocument();
    const renderedTags = screen.getAllByTestId('task-card-tag');
    expect(renderedTags).toHaveLength(2);
    for (const tag of renderedTags) expect(tag).toHaveClass('max-w-full', 'min-w-0');
    expect(renderedTags[1]).toHaveAttribute('title', longTag.name);
    expect(within(renderedTags[1]).getByText(longTag.name)).toHaveClass('truncate');
    expect(screen.getByTestId('task-card-metadata')).toContainElement(renderedTags[0]);
  });

  it('does not render tag badges when the task has no matching tags', () => {
    renderTaskCard({ ...baseTask, assigneeIds: [], tagIds: ['deleted-tag'], priority: null });
    expect(screen.queryByTestId('task-card-tag')).not.toBeInTheDocument();
    expect(screen.queryByTestId('task-card-metadata')).not.toBeInTheDocument();
  });

  it('does not substitute a deadline or update date for an unrecorded completion date', () => {
    const task = { ...baseTask, isCompleted: true, completedAt: null };
    const original = structuredClone(task);
    renderTaskCard(task);
    expect(screen.getByTestId('task-card-completion')).toHaveTextContent('完了日未記録');
    expect(screen.getByTestId('task-card-completion').querySelector('time')).toBeNull();
    expect(task).toEqual(original);
  });
});
