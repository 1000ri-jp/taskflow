import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NeoTodayContent } from './NeoToday';
import { viewTask } from '@/test/taskViewFixtures';
import { emptyGoogleSource } from '@/lib/google/workspace/types';
import { useAuthStore } from '@/stores/authStore';
import { workBlockKey } from '@/lib/dashboard/work-blocks';

vi.mock('@/contexts/NotificationContext', () => ({ useNotifications: () => ({ notifications: [] }) }));
vi.mock('./NeoWorkContinuation', () => ({ NeoWorkContinuation: () => <p>続きの操作</p> }));
vi.mock('./NeoMorningBrief', () => ({ NeoMorningBrief: ({ taskScope, assigneeFilterId, assigneeFilterName }: { taskScope: string; assigneeFilterId: string | null; assigneeFilterName?: string }) => <p>全体 {taskScope}・担当 {assigneeFilterId ?? '全員'} {assigneeFilterName}</p> }));
const now = new Date(2026, 8, 15, 12);
const task = { ...viewTask({ assigneeIds: ['me'], dueDate: new Date(2026, 8, 18), startDate: new Date(2026, 8, 15) }), projectName: '出展', projectColor: '', projectIcon: '' };
const props = { tasks: [task], now, userId: 'me', isLoading: false, error: null, projectTaskStatus: new Map([['project-1', { status: 'ready' as const }]]), onList: vi.fn(), onCalendar: vi.fn() };
const event = { id: 'next', title: '次の打合せ', at: new Date(2026, 8, 15, 14).toISOString(), end: new Date(2026, 8, 15, 15).toISOString(), text: '', sourceName: '会社', url: '' };
beforeEach(() => { localStorage.clear(); useAuthStore.setState({ user: { id: 'me' } as NonNullable<ReturnType<typeof useAuthStore.getState>['user']> }); });
describe('Today essentials', () => {
  it('surfaces a completed parent with its exact unfinished child from the dashboard', () => {
    const parent = { ...task, id: 'parent', title: '展示資料の準備', isCompleted: true, completedAt: new Date(2026, 8, 15) };
    const child = { ...task, id: 'child', parentTaskId: parent.id, title: '写真を確認する', isCompleted: false, completedAt: null };
    render(<NeoTodayContent {...props} tasks={[parent, child]} />);
    const issue = screen.getByRole('region', { name: '完了状態の確認' });
    expect(within(issue).getByText('親は完了ですが、未完了のサブタスクが残っています。')).toBeVisible();
    expect(within(issue).getByRole('link', { name: /展示資料の準備/ })).toHaveAttribute('href', '/projects/project-1/board?task=parent');
    expect(within(issue).getByRole('link', { name: '写真を確認する' })).toHaveAttribute('href', '/projects/project-1/board?task=child');
  });
  it('shows the next appointment alongside an ongoing one and does not turn deadlines or uncertain state into reply requests', () => {
    render(<NeoTodayContent {...props} source={{ ...emptyGoogleSource(), connected: true, status: 'ready', items: [
      { ...event, id: 'current', title: '開催中の展示会', at: new Date(2026, 8, 15, 10).toISOString(), end: new Date(2026, 8, 15, 17).toISOString() }, event,
      { ...event, id: 'past', title: '終わった予定', at: new Date(2026, 8, 15, 9).toISOString(), end: new Date(2026, 8, 15, 10).toISOString() },
    ] }} />);
    expect(screen.getByText('開催中の展示会')).toBeVisible();
    expect(screen.getByText('次の打合せ')).toBeVisible();
    expect(screen.queryByText('終わった予定')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '今返答が必要なこと' })).not.toBeInTheDocument();
    expect(screen.queryByText(/要状況確認|再確認日を過ぎ/)).not.toBeInTheDocument();
  });
  it('includes explicit personal work time in the next appointment without treating the deadline as a reservation', () => {
    localStorage.setItem(workBlockKey('me'), JSON.stringify([{ id: 'work', projectId: task.projectId, taskId: task.id, start: new Date(2026, 8, 15, 13).toISOString(), end: new Date(2026, 8, 15, 14).toISOString() }]));
    render(<NeoTodayContent {...props} source={{ ...emptyGoogleSource(), connected: true, status: 'ready', items: [event] }} />);
    const next = within(screen.getByRole('region', { name: '次の予定' }));
    expect(next.getByText(task.title)).toBeVisible();
    expect(next.getByText('13:00–14:00')).toBeVisible();
    expect(next.getByText('自分の作業時間')).toBeVisible();
    expect(next.queryByText('次の打合せ')).not.toBeInTheDocument();
  });
  it('keeps the briefing open and keeps only the schedule and continuing work beside it', () => {
    render(<NeoTodayContent {...props} members={[{ id: 'me', displayName: '本人' }, { id: 'colleague', displayName: '同僚', photoURL: 'https://example.test/colleague.png' }]} tasks={[task, { ...task, id: 'colleague-task', title: '同僚の仕事', assigneeIds: ['colleague'] }]} />);
    const briefing = screen.getByRole('region', { name: '今日のブリーフィング' });
    const heading = within(briefing).getByRole('heading', { name: '今日のブリーフィング' });
    expect(heading).toHaveClass('text-lg');
    expect(heading.querySelector('svg')).toHaveClass('size-5');
    expect(within(briefing).getByText('全体 mine・担当 me 本人')).toBeVisible();
    const filters = within(briefing).getByRole('group', { name: 'ブリーフの担当者' });
    expect(within(filters).getByRole('button', { name: '本人・自分' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(filters).getByRole('button', { name: '同僚' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(filters).getByRole('button', { name: '同僚' }).querySelector('[data-slot="avatar"]')).toBeInTheDocument();
    expect(within(filters).queryByText('同僚')).not.toBeInTheDocument();
    fireEvent.click(within(filters).getByRole('button', { name: '同僚' }));
    expect(within(briefing).getByText('全体 mine・担当 colleague 同僚')).toBeVisible();
    expect(briefing.closest('details')).toBeNull();
    fireEvent.click(within(filters).getByRole('button', { name: '全員' }));
    expect(within(filters).getByRole('button', { name: '全員' })).toHaveAttribute('title', '全員');
    expect(within(briefing).getByText('全体 all・担当 全員')).toBeVisible();
    const schedule = screen.getByRole('region', { name: '次の予定' });
    const side = schedule.parentElement!;
    expect(side.children[0]).toBe(schedule);
    expect(side.children[1]).toBe(screen.getByRole('region', { name: '進めている仕事' }));
    expect(side.children).toHaveLength(2);
    expect(screen.queryByText('今日が期限')).not.toBeInTheDocument();
    expect(briefing.nextElementSibling).toBe(side);
  });
  it('keeps missing calendar information explicit', () => {
    render(<NeoTodayContent {...props} calendarError="offline" />);
    expect(screen.getByText('Google予定を取得できません。')).toBeVisible();
    expect(screen.queryByText('Google予定は未連携です。')).not.toBeInTheDocument();
  });
});
