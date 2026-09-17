import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Notification } from '@/types';
import { NotificationList } from './NotificationList';
import { NotificationDropdown } from './NotificationDropdown';

const state = vi.hoisted(() => ({
  notifications: [] as Notification[], unreadCount: 0, isLoading: false, error: null as Error | null,
  markAsRead: vi.fn(), markAllAsRead: vi.fn(),
}));
vi.mock('@/hooks/useNotifications', () => ({ useNotifications: () => state }));
const notice = (id: string): Notification => ({
  id, userId: 'user-1', type: 'comment_added', title: 'コメントが届きました', message: '内容を確認してください',
  projectId: 'project-1', projectName: '展示会', taskId: 'task-1', taskName: '準備',
  isRead: false, createdAt: new Date('2026-09-12T09:00:00Z'), data: { commentId: 'comment-1' },
});
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, { notifications: [notice('notice-1')], unreadCount: 1, isLoading: false, error: null });
  state.markAsRead.mockResolvedValue(undefined);
});

describe('Shared notification list', () => {
  it('shows the source comment link without reading it until an explicit action', async () => {
    render(<NotificationList />);
    expect(screen.getByRole('link', { name: /コメントが届きました/ })).toHaveAttribute('href', '/projects/project-1/board?task=task-1&comment=comment-1');
    expect(screen.getByText('展示会 / 準備')).toBeVisible();
    expect(state.markAsRead).not.toHaveBeenCalled();
    expect(state.markAllAsRead).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '既読にする: コメントが届きました' }));
    await waitFor(() => expect(state.markAsRead).toHaveBeenCalledExactlyOnceWith('notice-1'));
    expect(state.markAllAsRead).not.toHaveBeenCalled();
  });

  it('marks only the opened notification and closes the companion so its source is visible', async () => {
    const onNavigate = vi.fn();
    render(<NotificationList onNavigate={onNavigate} />);
    const link = screen.getByRole('link');
    link.addEventListener('click', event => event.preventDefault());
    fireEvent.click(link);
    await waitFor(() => expect(state.markAsRead).toHaveBeenCalledExactlyOnceWith('notice-1'));
    expect(onNavigate).toHaveBeenCalledOnce();
    expect(state.markAllAsRead).not.toHaveBeenCalled();
  });

  it('reports a failed read and allows retry without claiming it was read', async () => {
    state.markAsRead.mockRejectedValueOnce(new Error('offline'));
    render(<NotificationList />);
    fireEvent.click(screen.getByRole('button', { name: /^既読にする/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('既読にできませんでした');
    fireEvent.click(screen.getByRole('button', { name: /^既読にする/ }));
    await waitFor(() => expect(state.markAsRead).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('distinguishes loading, failure, and an empty list', () => {
    state.isLoading = true;
    const view = render(<NotificationList />);
    expect(screen.getByRole('status')).toHaveTextContent('通知を読み込み中');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    state.isLoading = false; state.error = new Error('denied');
    view.rerender(<NotificationList />);
    expect(screen.getByRole('alert')).toHaveTextContent('通知を取得できませんでした');
    expect(screen.queryByText('通知はありません')).not.toBeInTheDocument();
    state.error = null; state.notifications = [];
    view.rerender(<NotificationList />);
    expect(screen.getByText('通知はありません')).toBeVisible();
  });

  it('keeps the header dropdown source links and explicit mark-all action', async () => {
    render(<NotificationDropdown />);
    fireEvent.pointerDown(screen.getByRole('button', { name: /通知$/ }), { button: 0 });
    const item = await screen.findByRole('menuitem', { name: /コメントが届きました/ });
    expect(item).toHaveAttribute('href', '/projects/project-1/board?task=task-1&comment=comment-1');
    expect(state.markAsRead).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'すべて既読' }));
    expect(state.markAllAsRead).toHaveBeenCalledOnce();
  });
});


it('offers a history with explicit read and reply actions, keeping selection when the order changes', async () => {
  const request = { ...notice('request'), title: '確認の依頼', message: '承認の返答をお願いします', data: { commentId: 'request-comment', requiresResponse: true } };
  const update = { ...notice('update'), title: '日程の連絡', message: '集合は十時です', data: { commentId: 'update-comment' } };
  state.notifications = [update, request];
  const onNavigate = vi.fn(); const ui = render(<NotificationList asHistory onNavigate={onNavigate} />);
  const detail = () => screen.getByRole('region', { name: '通知の内容' });
  expect(detail()).toHaveTextContent('承認の返答をお願いします');
  expect(within(detail()).getByRole('link', { name: '依頼を開く・返答' })).toHaveAttribute('href', '/projects/project-1/board?task=task-1&comment=request-comment');
  fireEvent.click(within(screen.getByRole('region', { name: '通知履歴' })).getByRole('button', { name: /日程の連絡/ }));
  expect(detail()).toHaveTextContent('集合は十時です');
  expect(state.markAsRead).toHaveBeenCalledWith('update'); expect(onNavigate).not.toHaveBeenCalled();
  state.notifications = [request, update]; ui.rerender(<NotificationList asHistory onNavigate={onNavigate} />);
  expect(detail()).toHaveTextContent('集合は十時です');
  fireEvent.click(within(detail()).getByRole('button', { name: '既読にする: 日程の連絡' }));
  await waitFor(() => expect(state.markAsRead).toHaveBeenCalledExactlyOnceWith('update'));
  state.notifications = [request]; ui.rerender(<NotificationList asHistory onNavigate={onNavigate} />);
  const link = within(detail()).getByRole('link', { name: '依頼を開く・返答' });
  link.addEventListener('click', event => event.preventDefault()); fireEvent.click(link);
  await waitFor(() => expect(state.markAsRead).toHaveBeenLastCalledWith('request'));
  expect(onNavigate).toHaveBeenCalledOnce(); expect(state.markAllAsRead).not.toHaveBeenCalled();
});

it('does not show stale notification details when history loading fails', () => {
  const ui = render(<NotificationList asHistory />);
  state.isLoading = true; ui.rerender(<NotificationList asHistory />);
  expect(screen.getByRole('status')).toHaveTextContent('通知を読み込み中');
  expect(screen.queryByRole('region', { name: '通知の内容' })).not.toBeInTheDocument();
  state.isLoading = false; state.error = new Error('offline'); ui.rerender(<NotificationList asHistory />);
  expect(screen.getByRole('alert')).toHaveTextContent('通知を取得できませんでした');
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
