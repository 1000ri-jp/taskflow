import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Notification } from '@/types';
import { previewCompanionGreeting } from '@/hooks/useCompanionSchedule';
import { DEFAULT_COMPANION_SCHEDULE } from '@/lib/ai/companionSchedule';
import { CompanionLauncher } from './CompanionLauncher';

const state = vi.hoisted(() => ({
  notifications: [] as Notification[], unreadCount: 0, isLoading: false, error: null as Error | null,
  markAsRead: vi.fn(), markAllAsRead: vi.fn(),
}));
vi.mock('next/navigation', () => ({useRouter:()=>({push:vi.fn()})}));
vi.mock('@/hooks/useNotifications', () => ({ useNotifications: () => state }));
const props = { userId: 'user-1', isOpen: false, busy: false, onToggle: vi.fn(), onOpenNotifications: vi.fn() };
const seenKey = 'taskflow.companion.schedule-seen.v1:user-1';
const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
let visibility: DocumentVisibilityState = 'visible';
const notice = (id = 'notice-1'): Notification => ({ id, userId: 'user-1', type: 'comment_added', title: '共有コメントが届きました', message: '確認してください', projectId: 'p', taskId: 't', isRead: false, createdAt: new Date(), data: {} });
async function mount(changes: Partial<typeof props> = {}) {
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<CompanionLauncher {...props} {...changes} />); });
  return view;
}
const advance = async (milliseconds: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); }); };

beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-14T09:00:00+09:00'));
  localStorage.clear(); sessionStorage.clear(); visibility = 'visible';
  Object.assign(state, { notifications: [], unreadCount: 0, isLoading: false, error: null });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: vi.fn((_name: string, callback: () => unknown) => Promise.resolve().then(callback)) } });
});
afterEach(() => {
  cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
  if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks); else Reflect.deleteProperty(navigator, 'locks');
  if (originalVisibility) Object.defineProperty(document, 'visibilityState', originalVisibility); else Reflect.deleteProperty(document, 'visibilityState');
});

describe('CompanionLauncher with actual scheduled greetings', () => {
  it('prioritizes an unread notice, then shows the greeting after the notice settles without clearing its unread badge', async () => {
    state.notifications = [notice()]; state.unreadCount = 1;
    await mount();
    expect(screen.getByRole('status')).toHaveTextContent('モアイからのお知らせ');
    expect(screen.queryByTestId('companion-scheduled-greeting')).not.toBeInTheDocument();
    expect(localStorage.getItem(seenKey)).toBeNull();
    await advance(20000);
    expect(screen.getByTestId('companion-scheduled-greeting')).toHaveTextContent('おはようございます');
    expect(screen.getByRole('button', { name: '未読の通知1件を開く' })).toHaveTextContent('1');
    expect(screen.getByTestId('companion-ai-toggle')).toHaveAttribute('data-unread', 'true');
    expect(state.notifications[0].isRead).toBe(false);
    expect(state.markAsRead).not.toHaveBeenCalled(); expect(state.markAllAsRead).not.toHaveBeenCalled();
    expect(props.onToggle).not.toHaveBeenCalled(); expect(props.onOpenNotifications).not.toHaveBeenCalled();
  });

  it('uses greeting acknowledgment only to close the bubble and does not reopen it after remount on the same day', async () => {
    const view = await mount();
    expect(screen.getByTestId('companion-scheduled-greeting')).toHaveTextContent('おはようございます');
    fireEvent.click(screen.getByRole('button', { name: 'みたよ' }));
    expect(screen.queryByTestId('companion-scheduled-greeting')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AIに相談する' })).toHaveFocus();
    expect(props.onToggle).not.toHaveBeenCalled(); expect(props.onOpenNotifications).not.toHaveBeenCalled();
    expect(state.markAsRead).not.toHaveBeenCalled(); expect(state.markAllAsRead).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(seenKey)!)).toHaveProperty('2026-09-14:morning');
    view.unmount(); await mount();
    expect(screen.queryByTestId('companion-scheduled-greeting')).not.toBeInTheDocument();
  });

  it('previews immediately over a notice without consuming the scheduled greeting or changing shared unread state', async () => {
    state.notifications = [notice()]; state.unreadCount = 1;
    await mount();
    act(() => previewCompanionGreeting('user-1', 'プレビューの声かけです'));
    expect(screen.getByTestId('companion-scheduled-greeting')).toHaveTextContent('プレビューの声かけです');
    expect(screen.queryByText('未読の通知が1件あります')).not.toBeInTheDocument();
    expect(localStorage.getItem(seenKey)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '声かけを閉じる' }));
    expect(screen.getByRole('status')).toHaveTextContent('モアイからのお知らせ');
    expect(state.markAsRead).not.toHaveBeenCalled(); expect(state.markAllAsRead).not.toHaveBeenCalled();
    expect(props.onToggle).not.toHaveBeenCalled(); expect(props.onOpenNotifications).not.toHaveBeenCalled();
  });

  it('allows a greeting while chat is open and acknowledgment leaves the conversation open', async () => {
    state.notifications = [notice()]; state.unreadCount = 1;
    await mount({ isOpen: true });
    expect(screen.getByTestId('companion-scheduled-greeting')).toHaveTextContent('おはようございます');
    fireEvent.click(screen.getByRole('button', { name: 'みたよ' }));
    expect(screen.getByRole('button', { name: '会話を閉じる' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByTestId('companion-scheduled-greeting')).not.toBeInTheDocument();
    expect(props.onToggle).not.toHaveBeenCalled(); expect(state.markAsRead).not.toHaveBeenCalled();
  });

  it.each(['hover', 'focus'] as const)('pauses the thirty-second display during %s and resumes only the remaining time', async interaction => {
    await mount(); await advance(10000);
    const bubble = screen.getByTestId('companion-scheduled-greeting');
    if (interaction === 'hover') fireEvent.mouseEnter(bubble);
    else act(() => screen.getByRole('button', { name: 'みたよ' }).focus());
    await advance(60000);
    expect(bubble).toBeVisible();
    if (interaction === 'hover') fireEvent.mouseLeave(bubble);
    else act(() => screen.getByTestId('companion-ai-toggle').focus());
    await advance(19999); expect(bubble).toBeVisible();
    await advance(1); expect(screen.queryByTestId('companion-scheduled-greeting')).not.toBeInTheDocument();
    expect(props.onToggle).not.toHaveBeenCalled(); expect(state.markAsRead).not.toHaveBeenCalled();
  });

  it('does not carry the prior user greeting into another user’s launcher or replay it when switching back', async () => {
    localStorage.setItem('taskflow.companion.schedule.v1:user-2', JSON.stringify({ ...DEFAULT_COMPANION_SCHEDULE, entries: [{ id: 'morning', enabled: true, time: '09:00', message: '別ユーザーの声かけ' }] }));
    const view = await mount(); expect(screen.getByTestId('companion-scheduled-greeting')).toHaveTextContent('おはようございます');
    await act(async () => { view.rerender(<CompanionLauncher {...props} userId="user-2" />); });
    expect(screen.getByTestId('companion-scheduled-greeting')).toHaveTextContent('別ユーザーの声かけ');
    expect(screen.queryByText('おはようございます')).not.toBeInTheDocument();
    await act(async () => { view.rerender(<CompanionLauncher {...props} />); });
    expect(screen.queryByTestId('companion-scheduled-greeting')).not.toBeInTheDocument();
    expect(props.onToggle).not.toHaveBeenCalled();
  });

  it('does not revive an expired morning greeting after the page was hidden until the afternoon', async () => {
    await mount(); expect(screen.getByTestId('companion-scheduled-greeting')).toBeVisible();
    act(() => { visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); });
    await advance(6 * 60 * 60 * 1000);
    await act(async () => { visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')); });
    expect(screen.queryByTestId('companion-scheduled-greeting')).not.toBeInTheDocument();
    expect(props.onToggle).not.toHaveBeenCalled(); expect(state.markAsRead).not.toHaveBeenCalled();
  });
});
