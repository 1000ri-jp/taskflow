'use client';

import { useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HistoryPane } from './HistoryPane';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { useNotifications } from '@/hooks/useNotifications';
import { notificationTaskHref } from '@/lib/task/commentSubmission';
import { cn } from '@/lib/utils';
import type { Notification } from '@/types';

function NotificationContent({ notification, compact }: { notification: Notification; compact: boolean }) {
  return <div className="flex w-full items-start justify-between gap-2">
    <div className="min-w-0 flex-1">
      {notification.data?.urgency === 'urgent' && notification.data?.requiresResponse === true && <span className="mr-1 rounded bg-red-100 px-2 py-0.5 text-xs font-bold text-red-900">至急</span>}
      {notification.data?.requiresResponse === true && <span className="mb-1 inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">要確認</span>}
      <p className={cn("break-words text-sm font-medium", compact && "truncate")}>{notification.title}</p>
      <p className="break-words text-xs text-muted-foreground">
        {[notification.projectName, notification.taskName].filter(Boolean).join(' / ')}
      </p>
      {notification.message && <p className={cn("mt-1 whitespace-pre-wrap break-words text-sm text-foreground/80", compact && "line-clamp-2")}>{notification.message}</p>}
      <p className="mt-1 text-xs text-muted-foreground">{format(notification.createdAt, 'M/d HH:mm', { locale: ja })}</p>
    </div>
    {!notification.isRead && <span aria-label="未読" className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />}
  </div>;
}

/** The header and companion share the same notification snapshot and read action. */
export function NotificationList({ asMenu = false, asHistory = false, onNavigate }: { asMenu?: boolean; asHistory?: boolean; onNavigate?: () => void }) {
  const { notifications, isLoading, error, markAsRead } = useNotifications();
  const [readError, setReadError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const read = async (notification: Notification) => {
    if (notification.isRead || pendingIds.includes(notification.id)) return;
    setReadError(false);
    setPendingIds(ids => [...ids, notification.id]);
    try { await markAsRead(notification.id); }
    catch { setReadError(true); }
    finally { setPendingIds(ids => ids.filter(id => id !== notification.id)); }
  };

  const ordered = [...notifications].sort((a,b)=>Number(b.data?.urgency === 'urgent' && b.data?.requiresResponse === true)-Number(a.data?.urgency === 'urgent' && a.data?.requiresResponse === true) || Number(b.data?.requiresResponse === true)-Number(a.data?.requiresResponse === true));
  const selected = ordered.find(notification => notification.id === selectedId) ?? ordered[0];
  const status = isLoading
    ? <div role="status" className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />通知を読み込み中</div>
    : error ? <p role="alert" className="p-4 text-sm text-destructive">通知を取得できませんでした。接続を確認して、画面を開き直してください。</p>
    : !notifications.length ? <p className="py-8 text-center text-sm text-muted-foreground">通知はありません</p> : null;
  const readFeedback = readError && <p role="alert" className="px-3 py-2 text-sm text-destructive">既読にできませんでした。もう一度お試しください。</p>;
  const readAction = (notification: Notification) => notification.isRead
    ? <span className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground"><Check className="h-3.5 w-3.5" aria-hidden="true" />既読</span>
    : <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" disabled={pendingIds.includes(notification.id)} aria-label={`既読にする: ${notification.title}`} onClick={() => { void read(notification); }}><Check className="h-3.5 w-3.5" aria-hidden="true" />既読にする</Button>;

  if (asHistory) return <HistoryPane label="通知履歴" list={!isLoading && !error && <ul aria-label="通知一覧">{ordered.map(notification => <li key={notification.id}>
    <button type="button" aria-current={selected?.id === notification.id ? 'true' : undefined} title={notification.title} onClick={() => { setSelectedId(notification.id); void read(notification); }} className={cn('block w-full min-w-0 border-b px-2 py-2 text-left text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring', selected?.id === notification.id && 'bg-muted')}>
      <span className="flex items-center gap-1">{!notification.isRead && <span aria-label="未読" className="size-1.5 shrink-0 rounded-full bg-primary" />}<span className="truncate font-medium">{notification.taskName || notification.title}</span></span>
      <span className="mt-1 block truncate text-muted-foreground">{notification.title}</span>
      {notification.data?.urgency === 'urgent' && notification.data?.requiresResponse === true && <span className="mr-1 rounded bg-red-100 px-2 py-0.5 text-xs font-bold text-red-900">至急</span>}
      {notification.data?.requiresResponse === true && <span className="mt-1 inline-block rounded bg-amber-100 px-1 text-amber-900">要確認</span>}
    </button>
  </li>)}</ul>}>
    <div className="min-h-0 flex-1 overflow-y-auto bg-white p-3 text-stone-900">
      {status || selected && <section aria-label="通知の内容" className="space-y-3">
        <NotificationContent notification={selected} compact={false} />
        <div className="flex flex-wrap items-center gap-2">
          <Link href={notificationTaskHref(selected)} onClick={() => { void read(selected); onNavigate?.(); }} className="text-xs text-primary underline underline-offset-2">{selected.data?.requiresResponse === true ? '依頼を開く・返答' : '元の内容を開く'}</Link>
          {readAction(selected)}
        </div>
        {readFeedback}
      </section>}
    </div>
  </HistoryPane>;
  if (status) return status;

  const link = (notification: Notification) => <Link
    href={notificationTaskHref(notification)}
    className={cn('block min-w-0 flex-1 rounded-md p-3 outline-offset-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring', !notification.isRead && 'bg-muted/50')}
    onClick={() => { void read(notification); onNavigate?.(); }}
  ><NotificationContent notification={notification} compact={asMenu} /></Link>;

  return <>
    {readFeedback}
    {asMenu ? ordered.map(notification => <DropdownMenuItem key={notification.id} className="block cursor-pointer p-0" asChild>{link(notification)}</DropdownMenuItem>)
      : <ul className="divide-y" aria-label="通知一覧">{ordered.map(notification => <li key={notification.id} className="flex items-start gap-1 py-1">
        {link(notification)}
        <div className="shrink-0 pr-2 pt-3">
          {readAction(notification)}
        </div>
      </li>)}</ul>}
  </>;
}
