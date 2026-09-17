import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { NeoCalendarContent } from './NeoCalendar';
import { emptyGoogleSource, type GoogleSource } from '@/lib/google/workspace/types';
import { UPCOMING_RANGE_STORAGE_KEY, useUpcomingRangeStore } from '@/stores/upcomingRangeStore';
import { viewTask } from '@/test/taskViewFixtures';

const now = new Date(2026, 8, 12, 12);
const source: GoogleSource = {
  ...emptyGoogleSource(), connected: true, status: 'ready', fetchedAt: now.toISOString(),
  items: [{ id: 'google-1', title: '会場打ち合わせ', text: '', at: new Date(2026, 8, 12, 14).toISOString(), end: new Date(2026, 8, 12, 15).toISOString(), url: 'https://calendar.google.com/event', sourceName: '自分の予定' }],
};
const tasks = [
  { ...viewTask({ id: 'today', title: '今日の原稿を確認', dueDate: now }), projectName: '展示会', listName: '出展準備' },
  { ...viewTask({ id: 'later', title: '6日目の納品', dueDate: new Date(2026, 8, 17) }), projectName: '展示会' },
  { ...viewTask({ id: 'undated', title: '期限なし', dueDate: null }), projectName: '展示会' },
];

beforeEach(() => {
  localStorage.removeItem(UPCOMING_RANGE_STORAGE_KEY);
  useUpcomingRangeStore.setState({ dayCount: 5, persistenceFailed: false });
});

describe('Neo calendar', () => {
  it('shows today’s deadlines and connected appointments, with working source links', () => {
    render(<NeoCalendarContent tasks={tasks} source={source} now={now} isLoading={false} error={null} />);
    const today = screen.getByRole('region', { name: '9月12日' });
    expect(within(today).getByRole('link', { name: /今日の原稿を確認/ })).toHaveAttribute('href', '/projects/project-1/board?task=today');
    expect(within(today).getByRole('link', { name: /会場打ち合わせ/ })).toHaveAttribute('href', 'https://calendar.google.com/event');
    expect(within(today).getByText('14:00–15:00')).toBeVisible();
    expect(within(today).getByText('自分の予定')).toBeVisible();
    expect(within(today).getByText('展示会 / 出展準備')).toBeVisible();
    expect(screen.queryByText('6日目の納品')).not.toBeInTheDocument();
    expect(screen.getByText('期限未設定の1件は一覧で確認できます。')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '7日' }));
    expect(screen.getByRole('heading', { name: '今日から7日' })).toBeVisible();
    expect(screen.getByRole('link', { name: /6日目の納品/ })).toBeVisible();
    expect(localStorage.getItem(UPCOMING_RANGE_STORAGE_KEY)).toBe('7');
  });

  it.each(['partial', 'error', 'selection_required', 'pending'] as const)('does not present %s calendar coverage as an empty schedule', status => {
    render(<NeoCalendarContent tasks={[]} source={{ ...source, items: [], status }} now={now} isLoading={false} error={null} />);
    expect(screen.queryByText('予定・期限なし')).not.toBeInTheDocument();
    expect(screen.getAllByText('取得できた予定・期限はありません')).toHaveLength(5);
  });

  it('labels stale cached events and does not claim that absent future events are known to be empty', () => {
    render(<NeoCalendarContent tasks={[]} source={{ ...source, fetchedAt: new Date(2026, 8, 9).toISOString() }} now={now} isLoading={false} error={null} />);
    expect(screen.getByRole('status')).toHaveTextContent('Google予定は前回の取得分です');
    expect(screen.getByRole('link', { name: /会場打ち合わせ/ })).toBeVisible();
    expect(screen.queryByText('予定・期限なし')).not.toBeInTheDocument();
  });

  it.each([null, 'invalid-cache-date'])('treats an unknown fetchedAt (%s) as unverified rather than empty', fetchedAt => {
    render(<NeoCalendarContent tasks={[]} source={{ ...source, fetchedAt, items: [] }} now={now} isLoading={false} error={null} />);
    expect(screen.getByRole('status')).toHaveTextContent('Google予定の取得をまだ確認できていません');
    expect(screen.queryByText('予定・期限なし')).not.toBeInTheDocument();
    expect(screen.queryByText(/Google予定の取得：/)).not.toBeInTheDocument();
  });

  it('keeps unconnected, loading, task failure and confirmed empty states distinct', () => {
    const { rerender } = render(<NeoCalendarContent tasks={[]} now={now} isLoading={false} error={null} />);
    expect(screen.getByText(/Google予定は未連携です/)).toBeVisible();
    expect(screen.getAllByText('期限タスクなし')).toHaveLength(5);
    rerender(<NeoCalendarContent tasks={[]} now={now} isLoading calendarLoading error={null} />);
    expect(screen.getByText('タスクを読み込み中…')).toBeVisible();
    expect(screen.getByText('Google予定を読み込み中…')).toBeVisible();
    expect(screen.queryByText('期限タスクなし')).not.toBeInTheDocument();
    rerender(<NeoCalendarContent tasks={[]} now={now} isLoading={false} error={new Error('unavailable')} />);
    expect(screen.getAllByText('取得できた予定・期限はありません')).toHaveLength(5);
    rerender(<NeoCalendarContent tasks={[]} source={{ ...source, items: [] }} now={now} isLoading={false} error={null} />);
    expect(screen.getAllByText('予定・期限なし')).toHaveLength(5);
  });

  it('uses the same calendar coverage for the brief and shows only today appointments without duplicate tasks', () => {
    const { rerender } = render(<NeoCalendarContent tasks={tasks} source={source} now={now} isLoading={false} error={null} scheduleOnly />);
    const heading = screen.getByRole('heading', { name: '今日の予定' });
    expect(heading).toBeVisible();
    const headingRow = heading.parentElement!.parentElement!;
    expect(within(headingRow).getByText('Google予定の取得：9/12 12:00')).toBeVisible();
    expect(within(headingRow).queryByText(/固定更新：/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Google予定の取得：/)).toHaveLength(1);
    expect(screen.getByRole('link', { name: /会場打ち合わせ/ })).toBeVisible();
    expect(screen.queryByText('今日の原稿を確認')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '5日' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('region')).toHaveLength(1);
    rerender(<NeoCalendarContent tasks={tasks} source={{ ...source, status: 'partial', items: [] }} now={now} isLoading={false} error={null} scheduleOnly />);
    expect(screen.getByText('取得できた予定はありません')).toBeVisible();
    expect(screen.queryByText('取得範囲に今日の予定はありません')).not.toBeInTheDocument();
  });

  it('shows every daily appointment and deadline without expansion', () => {
    const many = Array.from({ length: 5 }, (_, index) => ({ ...tasks[0], id: `task-${index}`, title: `提出物${index}` }));
    render(<NeoCalendarContent tasks={many} source={source} now={now} isLoading={false} error={null} />);
    const today = screen.getByRole('region', { name: '9月12日' });
    expect(within(today).getByRole('link', { name: /会場打ち合わせ/ })).toBeVisible();
    for (const task of many) {
      expect(within(today).getByRole('link', { name: new RegExp(task.title) })).toBeVisible();
    }
    expect(within(today).queryByText(/ほか\d+件/)).not.toBeInTheDocument();
  });
});
