'use client';

import { useState } from 'react';
import { Bell, BellRing, MessageCircle } from 'lucide-react';
import { useNotifications } from '@/contexts/NotificationContext';
import { notificationTaskHref } from '@/lib/task/commentSubmission';

function openInNewWindow(url: string) {
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  return Boolean(opened);
}

function isEmbeddedWebKit() {
  const userAgent = navigator.userAgent;
  return /AppleWebKit/i.test(userAgent) && !/Chrome|CriOS|Edg|Firefox|Safari/i.test(userAgent);
}

export function DesktopMoaiEntry() {
  const { notifications, unreadCount, isLoading, error, markAsRead } = useNotifications();
  const latestUnread = notifications.find(notification => !notification.isRead);
  const [openError, setOpenError] = useState('');

  const openLatest = () => {
    setOpenError('');
    const href = latestUnread ? notificationTaskHref(latestUnread) : '/neo';
    // WKWebView delegates target=_blank to NSWorkspace and can return null
    // even after the external app was opened. Do not fall back to navigating
    // the Mini itself, and only show the browser popup error in real browsers.
    if (!openInNewWindow(href) && !isEmbeddedWebKit()) {
      setOpenError('別ウィンドウを開けませんでした。ブラウザのポップアップ許可を確認してください。');
      return;
    }
    if (!latestUnread) {
      return;
    }
    void markAsRead(latestUnread.id).catch(() => {});
  };

  return <div role="group" aria-label="モアイ" className="flex items-center gap-1">
    <a href="/neo" target="_blank" rel="noreferrer" aria-label="モアイに相談" title="モアイに相談" className="inline-flex size-8 items-center justify-center text-muted-foreground hover:text-foreground">
      <MessageCircle className="size-4" aria-hidden="true" />
    </a>
    <button type="button" onClick={openLatest} disabled={isLoading} aria-label={error ? '通知を更新できていません' : latestUnread ? `未読通知${unreadCount}件を確認` : '通知を確認'} title={error ? '通知を更新できていません' : latestUnread ? `未読通知${unreadCount}件を確認` : '通知を確認'} className={`relative inline-flex size-8 items-center justify-center transition-colors disabled:cursor-wait disabled:opacity-60 ${latestUnread ? 'text-amber-700 hover:text-amber-800' : 'text-muted-foreground hover:text-foreground'}`}>
          {latestUnread ? <BellRing className="size-4" aria-hidden="true" /> : <Bell className="size-4" aria-hidden="true" />}
          {unreadCount > 0 && <span aria-label={`未読${unreadCount}件`} className="absolute -right-1 -top-1 flex min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 py-0.5 text-[10px] font-bold leading-none text-white shadow-sm">{unreadCount > 9 ? '9+' : unreadCount}</span>}
    </button>
    {error && <p role="status" className="sr-only">通知を更新できていません。最後に取得できた表示を保持しています。</p>}
    {openError && <p role="alert" className="sr-only">{openError}</p>}
  </div>;
}
