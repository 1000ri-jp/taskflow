import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { NeoScheduleCalendarContent } from './NeoScheduleCalendar';
import { emptyGoogleSource, type GoogleSource } from '@/lib/google/workspace/types';
import { viewTask } from '@/test/taskViewFixtures';
import { useAuthStore } from '@/stores/authStore';
import { workBlockKey } from '@/lib/dashboard/work-blocks';
import type { CalendarView } from '@/lib/dashboard/calendar-layout';
const now = new Date(2026, 8, 15, 12);
const source: GoogleSource = { ...emptyGoogleSource(), connected: true, status: 'ready', fetchedAt: now.toISOString(), items: [
  { id: 'meeting', title: '現地確認', at: new Date(2026, 8, 15, 10).toISOString(), end: new Date(2026, 8, 15, 11).toISOString(), sourceName: '会社', url: 'https://calendar.google.com/event', text: '' },
  { id: 'short-meeting', title: '短い打合せ', at: new Date(2026, 8, 15, 11).toISOString(), end: new Date(2026, 8, 15, 11, 30).toISOString(), sourceName: '会社', url: '', text: '' },
  { id: 'long-meeting', title: '長い打合せ', at: new Date(2026, 8, 15, 12).toISOString(), end: new Date(2026, 8, 15, 13, 30).toISOString(), sourceName: '会社', url: '', text: '' },
  { id: 'holiday', title: '終日予定', allDay: true, at: new Date(2026, 8, 15).toISOString(), end: new Date(2026, 8, 16).toISOString(), sourceName: '会社', url: '', text: '' },
]};
const tasks = [{ ...viewTask({ title: '提出する', dueDate: now }), projectName: '出展' }];
function Calendar({ status = 'ready', error = null }: { status?: GoogleSource['status']; error?: string | null }) {
  const [anchor, setAnchor] = useState(now), [view, setView] = useState<CalendarView>('week');
  return <NeoScheduleCalendarContent tasks={tasks} isLoading={false} error={null} selection={{ anchor, setAnchor, view, setView, now }} data={{ source: { ...source, status }, error }} />;
}
beforeEach(() => { localStorage.clear(); useAuthStore.setState({ user: { id: 'me' } as NonNullable<ReturnType<typeof useAuthStore.getState>['user']> }); });
describe('schedule calendar', () => {
  it('separates deadlines from timed events and opens an event with its original source', () => {
    render(<Calendar />);
    const timed = screen.getByRole('region', { name: '9月15日の時間割' });
    expect(within(timed).getByRole('button', { name: /現地確認/ })).toHaveStyle({ top: '500px', height: '50px' });
    const halfHour = within(timed).getByRole('button', { name: /短い打合せ/ });
    expect(halfHour).toHaveStyle({ top: '550px', height: '25px' });
    expect(halfHour).toHaveClass('justify-center', 'py-1', 'text-xs', 'leading-tight');
    expect(within(timed).getByRole('button', { name: /長い打合せ/ })).toHaveStyle({ top: '600px', height: '75px' });
    expect(within(timed).queryByRole('link', { name: /提出する/ })).not.toBeInTheDocument();
    const deadline = screen.getByRole('link', { name: /提出する/ });
    expect(deadline).toHaveAttribute('href', '/projects/project-1/board?task=task-1');
    expect(deadline).toHaveStyle({ minHeight: '25px' });
    expect(screen.getAllByRole('button', { name: /終日予定、/ })).toHaveLength(1);
    fireEvent.click(within(timed).getByRole('button', { name: /現地確認/ }));
    expect(screen.getByRole('link', { name: 'Googleカレンダーで開く' })).toHaveAttribute('href', 'https://calendar.google.com/event');
    expect(screen.getByText('9/15 10:00–11:00')).toBeVisible();
  });

  it('keeps a half-hour event readable and clickable at the deadline-chip baseline', () => {
    render(<Calendar />);
    const timed = screen.getByRole('region', { name: '9月15日の時間割' });
    const halfHour = within(timed).getByRole('button', { name: /短い打合せ/ });
    expect(halfHour).toHaveStyle({ height: '25px' });
    expect(halfHour.querySelector('span')?.textContent).toContain('11:00短い打合せ');
    fireEvent.click(halfHour);
    expect(screen.getByText('9/15 11:00–11:30')).toBeVisible();
  });
  it('navigates week/month/day and returns to today; source toggles do not remove other work', () => {
    render(<Calendar />);
    fireEvent.click(screen.getByRole('button', { name: '次の期間' }));
    expect(screen.queryByRole('button', { name: /現地確認/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '今日' }));
    expect(screen.getByRole('button', { name: /現地確認/ })).toBeVisible();
    expect(screen.queryByRole('checkbox', { name: 'Google予定' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '表示設定' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Google予定' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('button', { name: /現地確認/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /提出する/ })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '月' }));
    expect(screen.getByRole('region', { name: '9月15日' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '9月15日を表示' }));
    const agenda = screen.getByRole('dialog');
    expect(within(agenda).getByRole('heading', { name: '9月15日（火曜日）' })).toBeVisible();
    expect(within(agenda).getByText('提出する')).toBeVisible();
    expect(within(agenda).getByRole('link', { name: '予定の詳細' })).toHaveAttribute('href', 'https://calendar.google.com/event');
    fireEvent.click(within(agenda).getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: '日' }));
    expect(screen.getAllByRole('region', { name: /の時間割/ })).toHaveLength(1);
  });

  it('validates and saves a work reservation, renders it in the time grid after reopening, and keeps the deadline separate', () => {
    const originalDeadline = tasks[0].dueDate;
    const { unmount } = render(<Calendar />);
    fireEvent.click(screen.getByRole('button', { name: '9月15日を表示' }));
    fireEvent.click(screen.getByRole('button', { name: '作業時間を決める' }));
    fireEvent.change(screen.getByLabelText('作業の開始'), { target: { value: '2026-09-15T13:00' } });
    fireEvent.change(screen.getByLabelText('作業の終了'), { target: { value: '2026-09-15T12:00' } });
    fireEvent.click(screen.getByRole('button', { name: '作業時間を保存' }));
    expect(screen.getByRole('alert')).toHaveTextContent('終了は開始より後');
    expect(localStorage.getItem(workBlockKey('me'))).toBeNull();
    fireEvent.change(screen.getByLabelText('作業の終了'), { target: { value: '2026-09-15T14:00' } });
    fireEvent.click(screen.getByRole('button', { name: '作業時間を保存' }));
    expect(screen.queryByRole('form', { name: '作業時間の設定' })).not.toBeInTheDocument();
    expect(screen.getByText('作業時間を保存しました。')).toBeVisible();
    unmount(); render(<Calendar />);
    const timed = screen.getByRole('region', { name: '9月15日の時間割' });
    expect(within(timed).getByRole('button', { name: /提出する、作業時間/ })).toHaveStyle({ top: '650px', height: '50px' });
    expect(screen.getByRole('link', { name: /提出する、期限/ })).toBeVisible();
    expect(tasks[0].dueDate).toBe(originalDeadline);
    fireEvent.click(within(timed).getByRole('button', { name: /提出する、作業時間/ }));
    fireEvent.click(screen.getByRole('button', { name: '作業時間を取り消す' }));
    expect(JSON.parse(localStorage.getItem(workBlockKey('me'))!)).toEqual([]);
  });
  it('makes incomplete acquisition visible without claiming that a blank cell is free time', () => {
    const { rerender } = render(<Calendar status="partial" />);
    expect(screen.getByRole('status')).toHaveTextContent('Google予定は一部の取得分です');
    rerender(<Calendar error="offline" />);
    expect(screen.getByRole('status')).toHaveTextContent('Google予定を取得できません');
    expect(screen.queryByText(/空き時間|予定なし/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /現地確認/ })).toBeVisible();
  });
});
