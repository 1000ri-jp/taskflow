import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Notification } from '@/types';
import { CompanionLauncher } from './CompanionLauncher';

const state = vi.hoisted(() => ({
  notifications: [] as Notification[], unreadCount: 0, isLoading: false, error: null as Error | null,
  markAsRead: vi.fn(), markAllAsRead: vi.fn(),
}));
vi.mock('next/navigation', () => ({useRouter:()=>({push:vi.fn()})}));
vi.mock('@/hooks/useNotifications', () => ({ useNotifications: () => state }));
vi.mock('@/hooks/useCompanionSchedule', () => ({ useCompanionSchedule: () => ({ greeting: null, dismiss: vi.fn() }) }));
const props = { userId: 'user-1', isOpen: false, busy: false, onToggle: vi.fn(), onOpenNotifications: vi.fn() };
const notice = (id: string): Notification => ({
  id, userId: 'user-1', type: 'comment_added', title: 'コメントが届きました', message: '確認お願いします',
  projectId: 'project-1', taskId: 'task-1', isRead: false, createdAt: new Date(), data: {},
});

beforeEach(() => {
  sessionStorage.clear(); localStorage.clear(); vi.clearAllMocks();
  Object.defineProperties(window, { innerWidth: { configurable: true, value: 1024 }, innerHeight: { configurable: true, value: 768 } });
  Object.assign(state, { notifications: [], unreadCount: 0, isLoading: false, error: null });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Companion notifications', () => {
  it('stays quiet without an actual unread notification and opens AI only on request', () => {
    render(<CompanionLauncher {...props} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /未読/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'AIに相談する' }));
    expect(props.onToggle).toHaveBeenCalledOnce();
  });

  it('follows incoming unread notices with amber color, a count and a bubble, then returns to blue when all are read', () => {
    const view = render(<CompanionLauncher {...props} />);
    const toggle = screen.getByRole('button', { name: 'AIに相談する' });
    expect(toggle).toHaveClass('bg-card', 'text-primary');
    expect(toggle).toHaveAttribute('data-unread', 'false');

    state.notifications = [notice('notice-1')]; state.unreadCount = 1;
    view.rerender(<CompanionLauncher {...props} />);
    expect(toggle).toHaveClass('bg-amber-50', 'text-amber-900', 'border-amber-500');
    expect(toggle).not.toHaveClass('bg-card');
    expect(toggle.querySelector('[data-busy]')).toHaveAttribute('data-unread', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('モアイからのお知らせ');
    expect(screen.getAllByRole('button', { name: '未読の通知1件を開く' }).find(button => button.textContent === '1')).toHaveClass('bg-amber-700');

    fireEvent.click(screen.getByRole('button', { name: '吹き出しを閉じる' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(toggle).toHaveClass('bg-amber-50');
    expect(screen.getByRole('button', { name: '未読の通知1件を開く' })).toHaveTextContent('1');

    state.notifications = [{ ...notice('notice-2'), createdAt: new Date(Date.now() + 1000) }, ...state.notifications]; state.unreadCount = 2;
    view.rerender(<CompanionLauncher {...props} busy />);
    expect(screen.getByRole('status')).toHaveTextContent('（2件）');
    expect(toggle).toHaveClass('bg-amber-50');
    expect(toggle.querySelector('[data-busy]')).toHaveAttribute('data-busy', 'true');
    expect(screen.getAllByRole('button', { name: '未読の通知2件を開く' }).find(button => button.textContent === '2')).toBeVisible();

    state.notifications = state.notifications.map(notification => ({ ...notification, isRead: true })); state.unreadCount = 0;
    view.rerender(<CompanionLauncher {...props} />);
    expect(toggle).toHaveClass('bg-card', 'text-primary');
    expect(toggle).not.toHaveClass('bg-amber-50', 'border-amber-500');
    expect(toggle.querySelector('[data-busy]')).toHaveAttribute('data-unread', 'false');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /未読/ })).not.toBeInTheDocument();
    expect(props.onToggle).not.toHaveBeenCalled();
    expect(state.markAsRead).not.toHaveBeenCalled();
    expect(state.markAllAsRead).not.toHaveBeenCalled();
  });

  it('keeps the companion visible while chatting and only toggles the conversation', () => {
    state.notifications = [notice('notice-1')]; state.unreadCount = 1;
    const openNotifications = vi.fn();
    window.addEventListener('taskflow-open-notifications', openNotifications);
    try {
      const view = render(<CompanionLauncher {...props} isOpen />);
      const toggle = screen.getByRole('button', { name: '会話を閉じる' });
      expect(toggle).toBeVisible();
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /未読/ })).not.toBeInTheDocument();
      fireEvent.click(toggle);
      expect(props.onToggle).toHaveBeenCalledOnce();

      view.rerender(<CompanionLauncher {...props} />);
      expect(screen.getByRole('button', { name: 'AIに相談する' })).toBe(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      fireEvent.click(toggle);
      expect(props.onToggle).toHaveBeenCalledTimes(2);
      expect(openNotifications).not.toHaveBeenCalled();
      expect(state.markAsRead).not.toHaveBeenCalled();
      expect(state.markAllAsRead).not.toHaveBeenCalled();
      expect(sessionStorage.getItem('taskflow.companion.notices.v1:user-1')).toBeNull();
    } finally {
      window.removeEventListener('taskflow-open-notifications', openNotifications);
    }
  });

  it('opens the companion notification view without toggling chat or marking anything as read', () => {
    state.notifications = [notice('notice-1')]; state.unreadCount = 1;
    render(<CompanionLauncher {...props} />);
    fireEvent.click(screen.getAllByRole('button', { name: '未読の通知1件を開く' }).find(button=>button.textContent==='1')!);
    expect(props.onOpenNotifications).toHaveBeenCalledOnce();
    expect(props.onToggle).not.toHaveBeenCalled();
    expect(state.markAsRead).not.toHaveBeenCalled();
    expect(state.markAllAsRead).not.toHaveBeenCalled();
  });

  it('dismisses the bubble once per notice in this session and keeps the unread badge', () => {
    state.notifications = [notice('notice-1')]; state.unreadCount = 1;
    const view = render(<CompanionLauncher {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '吹き出しを閉じる' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '未読の通知1件を開く' })).toBeVisible();
    view.unmount();
    const remount = render(<CompanionLauncher {...props} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    state.notifications = [notice('notice-2')];
    remount.rerender(<CompanionLauncher {...props} />);
    expect(screen.getByRole('status')).toBeVisible();
    expect(state.markAsRead).not.toHaveBeenCalled();
  });

  it('lets the bubble settle after twenty seconds without changing notification state', () => {
    vi.useFakeTimers();
    state.notifications = [notice('notice-1')]; state.unreadCount = 1;
    render(<CompanionLauncher {...props} />);
    act(() => { vi.advanceTimersByTime(10000); });
    expect(screen.getByRole('status')).toBeVisible();
    act(() => { vi.advanceTimersByTime(10000); });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '未読の通知1件を開く' })).toBeVisible();
    expect(state.markAsRead).not.toHaveBeenCalled();
  });

  it('does not announce cached notices while loading or after a fetch failure', async () => {
    state.notifications = [notice('notice-1')]; state.unreadCount = 1; state.isLoading = true;
    const view = render(<CompanionLauncher {...props} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    state.isLoading = false; state.error = new Error('permission denied');
    view.rerender(<CompanionLauncher {...props} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '通知を確認できません・通知を開く' }));
    expect(props.onOpenNotifications).toHaveBeenCalledOnce();
    expect(state.markAsRead).not.toHaveBeenCalled();
  });

  it('keeps a focused bubble available until keyboard interaction finishes', () => {
    vi.useFakeTimers();
    state.notifications = [notice('notice-1')]; state.unreadCount = 1;
    render(<CompanionLauncher {...props} />);
    const close = screen.getByRole('button', { name: '吹き出しを閉じる' });
    act(() => close.focus());
    act(() => { vi.advanceTimersByTime(25000); });
    expect(screen.getByRole('status')).toBeVisible();
    expect(close).toHaveFocus();
    fireEvent.click(close);
    expect(screen.getByRole('button', { name: 'AIに相談する' })).toHaveFocus();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

const positionKey = 'taskflow.companion.position.v1:user-1';
const point = (x: number, y: number, pointerType = 'mouse') => ({ pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y, pointerType });

describe('Companion position', () => {
  it.each(['mouse', 'touch'])('moves with %s capture, saves the position, and does not toggle on release', (pointerType) => {
    const view = render(<CompanionLauncher {...props} />);
    const toggle = screen.getByRole('button', { name: 'AIに相談する' });
    const capture = vi.fn(); const release = vi.fn();
    Object.defineProperties(toggle, { setPointerCapture: { value: capture }, releasePointerCapture: { value: release } });
    fireEvent.pointerDown(toggle, point(970, 640, pointerType));
    fireEvent.pointerMove(toggle, point(170, 80, pointerType));
    expect(localStorage.getItem(positionKey)).toBeNull();
    fireEvent.pointerUp(toggle, point(170, 80, pointerType));
    fireEvent.click(toggle, { detail: 1 });
    expect(capture).toHaveBeenCalledWith(1);
    expect(release).toHaveBeenCalledWith(1);
    expect(props.onToggle).not.toHaveBeenCalled();
    expect(state.markAsRead).not.toHaveBeenCalled();
    expect(state.markAllAsRead).not.toHaveBeenCalled();
    expect(toggle).toHaveStyle({ width: '96px', height: '96px' });
    expect(screen.getByTestId('companion-launcher')).toHaveStyle({ left: '104px', top: '16px' });
    expect(JSON.parse(localStorage.getItem(positionKey)!)).toEqual({ x: 104, y: 16 });

    // Keyboard activation remains usable even when a drag produced no click.
    fireEvent.pointerDown(toggle, point(170, 80, pointerType));
    fireEvent.pointerMove(toggle, point(186, 80, pointerType));
    fireEvent.pointerUp(toggle, point(186, 80, pointerType));
    fireEvent.click(toggle, { detail: 0 });
    expect(props.onToggle).toHaveBeenCalledOnce();
    view.unmount();
    render(<CompanionLauncher {...props} />);
    expect(screen.getByTestId('companion-launcher')).toHaveStyle({ left: '120px', top: '16px' });
  });

  it('keeps a small pointer movement as a normal click and leaves the default position unsaved', () => {
    render(<CompanionLauncher {...props} />);
    const toggle = screen.getByRole('button', { name: 'AIに相談する' });
    fireEvent.pointerDown(toggle, point(970, 640));
    fireEvent.pointerMove(toggle, point(973, 644));
    fireEvent.pointerUp(toggle, point(973, 644));
    fireEvent.click(toggle, { detail: 1 });
    expect(props.onToggle).toHaveBeenCalledOnce();
    expect(localStorage.getItem(positionKey)).toBeNull();
    expect(screen.getByTestId('companion-launcher')).toHaveStyle({ left: '904px', top: '576px' });
  });

  it('uses separate user positions even when the caller keeps the component mounted', () => {
    localStorage.setItem(positionKey, JSON.stringify({ x: 220, y: 170 }));
    localStorage.setItem('taskflow.companion.position.v1:user-2', JSON.stringify({ x: 400, y: 300 }));
    const view = render(<CompanionLauncher {...props} />);
    expect(screen.getByTestId('companion-launcher')).toHaveStyle({ left: '220px', top: '170px' });
    view.rerender(<CompanionLauncher {...props} userId="user-2" />);
    expect(screen.getByTestId('companion-launcher')).toHaveStyle({ left: '400px', top: '300px' });
    view.rerender(<CompanionLauncher {...props} />);
    expect(screen.getByTestId('companion-launcher')).toHaveStyle({ left: '220px', top: '170px' });
  });

  it('clamps restored and dragged positions, then keeps the icon inside a smaller viewport', () => {
    localStorage.setItem(positionKey, JSON.stringify({ x: 9999, y: -9999 }));
    render(<CompanionLauncher {...props} isOpen />);
    const launcher = screen.getByTestId('companion-launcher');
    const toggle = screen.getByRole('button', { name: '会話を閉じる' });
    expect(launcher).toHaveStyle({ left: '920px', top: '8px' });
    fireEvent.pointerDown(toggle, point(980, 28));
    fireEvent.pointerMove(toggle, point(5000, 5000));
    fireEvent.pointerUp(toggle, point(5000, 5000));
    expect(launcher).toHaveStyle({ left: '920px', top: '664px' });
    Object.defineProperties(window, { innerWidth: { configurable: true, value: 320 }, innerHeight: { configurable: true, value: 400 } });
    act(() => window.dispatchEvent(new Event('resize')));
    expect(launcher).toHaveStyle({ left: '216px', top: '296px' });
    expect(props.onToggle).not.toHaveBeenCalled();
  });

  it.each([
    [{ x: 8, y: 8 }, { left: '0px', top: '108px' }],
    [{ x: 8, y: 664 }, { left: '0px', bottom: '108px' }],
    [{ x: 920, y: 8 }, { left: '-240px', top: '108px' }],
  ])('keeps the notice inside the viewport at %j', (position, placement) => {
    state.notifications = [notice('notice-1')]; state.unreadCount = 1;
    localStorage.setItem(positionKey, JSON.stringify(position));
    render(<CompanionLauncher {...props} />);
    const bubble = screen.getByRole('status');
    expect(bubble).toHaveStyle(placement);
    const left = position.x + parseFloat(bubble.style.left);
    expect(left).toBeGreaterThanOrEqual(8);
    expect(left + parseFloat(bubble.style.width)).toBeLessThanOrEqual(window.innerWidth - 8);
    expect(parseFloat(bubble.style.maxHeight)).toBeGreaterThan(0);
  });

  it('fits a 320px viewport with the notice near the right edge', () => {
    Object.defineProperties(window, { innerWidth: { configurable: true, value: 320 }, innerHeight: { configurable: true, value: 640 } });
    state.notifications = [notice('notice-1')]; state.unreadCount = 1;
    localStorage.setItem(positionKey, JSON.stringify({ x: 216, y: 536 }));
    render(<CompanionLauncher {...props} />);
    const bubble = screen.getByRole('status');
    expect(bubble).toHaveStyle({ width: '304px', left: '-208px', bottom: '108px' });
    expect(screen.getByText('内容を見る')).toBeVisible();
  });

  it.each(['broken', '{"x":"20","y":30}', '{"x":1e309,"y":30}', '[]'])('ignores invalid saved position %s', (value) => {
    localStorage.setItem(positionKey, value);
    render(<CompanionLauncher {...props} />);
    expect(screen.getByTestId('companion-launcher')).toHaveStyle({ left: '904px', top: '576px' });
  });

  it('allows keyboard movement and ordinary activation when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<CompanionLauncher {...props} />);
    const toggle = screen.getByRole('button', { name: 'AIに相談する' });
    fireEvent.keyDown(toggle, { key: 'ArrowLeft' });
    expect(screen.getByTestId('companion-launcher')).toHaveStyle({ left: '888px', top: '576px' });
    expect(props.onToggle).not.toHaveBeenCalled();
    fireEvent.click(toggle, { detail: 0 });
    expect(props.onToggle).toHaveBeenCalledOnce();
  });

  it('finishes a canceled pointer without toggling and accepts the next ordinary click', () => {
    render(<CompanionLauncher {...props} />);
    const toggle = screen.getByRole('button', { name: 'AIに相談する' });
    fireEvent.pointerDown(toggle, point(970, 640));
    fireEvent.pointerMove(toggle, point(870, 640));
    fireEvent.pointerCancel(toggle, point(870, 640));
    expect(props.onToggle).not.toHaveBeenCalled();
    fireEvent.pointerDown(toggle, point(870, 640));
    fireEvent.pointerUp(toggle, point(870, 640));
    fireEvent.click(toggle, { detail: 1 });
    expect(props.onToggle).toHaveBeenCalledOnce();
  });
});
