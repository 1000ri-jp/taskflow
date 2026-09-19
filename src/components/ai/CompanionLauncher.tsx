'use client';

import { useCallback, useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { CompanionBubble, GreetingContent } from './CompanionBubble';
import { ArrowUpRight, Bell, X } from 'lucide-react';
import { useNotifications } from '@/hooks/useNotifications';
import { useCompanionSchedule } from '@/hooks/useCompanionSchedule';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { notificationTaskHref } from '@/lib/task/commentSubmission';
import { isPersistentNotice, isUrgentNotice, urgentNoticeKey, unreadCompanionNotices } from '@/lib/ai/companionNotices';
import { cn } from '@/lib/utils';
import { CompanionMascot } from './CompanionMascot';

function readDismissed(key: string): string[] {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string').slice(-200) : [];
  } catch { return []; }
}

type Position = { x: number; y: number };
type Viewport = { width: number; height: number };
const iconSize = 96;
const edge = 8;

function getViewport(): Viewport {
  return typeof window === 'undefined' ? { width: 1024, height: 768 }
    : { width: window.innerWidth, height: window.innerHeight };
}

function clampPosition(position: Position, viewport: Viewport): Position {
  return {
    x: Math.min(Math.max(edge, position.x), Math.max(edge, viewport.width - iconSize - edge)),
    y: Math.min(Math.max(edge, position.y), Math.max(edge, viewport.height - iconSize - edge)),
  };
}

function readPosition(key: string): Position | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (!value || typeof value !== 'object' || !('x' in value) || !('y' in value)
      || typeof value.x !== 'number' || typeof value.y !== 'number'
      || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return null;
    return clampPosition({ x: value.x, y: value.y }, getViewport());
  } catch { return null; }
}

type LauncherProps = {
  quickCheck?: ReactNode; userId: string; isOpen: boolean; busy: boolean; onToggle: () => void; onOpenNotifications: () => void;
};

export function CompanionLauncher(props: LauncherProps) {
  return <LauncherForUser key={props.userId} {...props} />;
}

function LauncherForUser({ quickCheck, userId, isOpen, busy, onToggle, onOpenNotifications }: LauncherProps) {
  const { notifications, unreadCount, isLoading, error, markAsRead } = useNotifications();
  const router = useRouter();
  const [popupIds, setPopupIds] = useState<string[]>([]);
  const storageKey = `taskflow.companion.notices.v1:${userId}`;
  const [dismissed, setDismissed] = useState(() => readDismissed(storageKey));
  const [focused, setFocused] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const moveHintId = useId();
  const positionKey = `taskflow.companion.position.v1:${userId}`;
  const [position, setPosition] = useState(() => readPosition(positionKey));
  const [viewport, setViewport] = useState(getViewport);
  const currentPosition = clampPosition(position ?? {
    x: viewport.width - iconSize - 24,
    y: viewport.height - iconSize - 96,
  }, viewport);
  const drag = useRef<{
    pointerId: number; start: Position; origin: Position; current: Position; moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const savePosition = (next: Position) => {
    try { localStorage.setItem(positionKey, JSON.stringify(next)); } catch { /* Keep the position for this visit. */ }
  };

  useEffect(() => {
    const resize = () => {
      const next = getViewport();
      setViewport(next);
      setPosition(current => current ? clampPosition(current, next) : null);
    };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  const movePointer = (event: PointerEvent<HTMLButtonElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const dx = event.clientX - active.start.x;
    const dy = event.clientY - active.start.y;
    if (!active.moved && Math.hypot(dx, dy) < 6) return;
    active.moved = true;
    active.current = clampPosition({ x: active.origin.x + dx, y: active.origin.y + dy }, getViewport());
    setPosition(active.current);
    event.preventDefault();
  };
  const finishPointer = (event: PointerEvent<HTMLButtonElement>, canceled = false) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    suppressClick.current = active.moved || canceled;
    if (active.moved) savePosition(active.current);
    drag.current = null;
    try { event.currentTarget.releasePointerCapture?.(event.pointerId); } catch { /* Capture may already be lost. */ }
  };
  const unread = !isLoading && !error ? unreadCompanionNotices(notifications, userId) : [];
  const latest = unread.find(n => isPersistentNotice(n) || !dismissed.includes(n.id));
  const persistent = latest ? isPersistentNotice(latest) : false;
  const unseenUrgent = unread.filter(n => isUrgentNotice(n) && !dismissed.includes(urgentNoticeKey(n)));
  const urgentSignature = unseenUrgent.map(urgentNoticeKey).join('|');
  useEffect(() => {
    if (!urgentSignature || popupIds.length) return;
    const ids = unseenUrgent.map(n => n.id), keys = unseenUrgent.map(urgentNoticeKey);
    queueMicrotask(() => {
      setPopupIds(ids);
      setDismissed(previous => {
        const next = [...new Set([...previous, ...keys])].slice(-200);
        try { sessionStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Preserve this visit. */ }
        return next;
      });
    });
  // Signature carries identities and source times, so a resubmitted request is a new notice.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urgentSignature, popupIds.length, storageKey]);
  const popup = unread.filter(n => popupIds.includes(n.id) && isUrgentNotice(n));
  const openNotice = (notice: typeof latest) => {
    if (!notice) return;
    void markAsRead(notice.id).catch(() => {});
    setPopupIds([]);
    router.push(notificationTaskHref(notice));
  };
  const noticeId = latest?.id;
  const hasNotice = !isOpen && !!noticeId && (persistent || !dismissed.includes(noticeId));
  const hasQuickCheck = !isOpen && !!quickCheck && !hasNotice && !popup.length;
  const schedule = useCompanionSchedule(userId, { blocked: hasNotice || hasQuickCheck, paused: focused !== null || hovered !== null });
  const showNotice = hasNotice && !schedule.greeting?.preview;
  const showGreeting = schedule.greeting && (schedule.greeting.preview || (!hasNotice && !hasQuickCheck)) ? schedule.greeting : null;
  const count = !isLoading && !error ? unreadCount : 0;
  const dismiss = useCallback(() => {
    if (!noticeId) return;
    const next = [...dismissed.filter(id => id !== noticeId), noticeId].slice(-200);
    setDismissed(next);
    try { sessionStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Keep this session usable. */ }
  }, [dismissed, noticeId, storageKey]);

  useEffect(() => {
    if (!showNotice || persistent || focused === noticeId || hovered === noticeId) return;
    const timer = setTimeout(dismiss, 20000);
    return () => clearTimeout(timer);
  }, [showNotice, persistent, focused, hovered, noticeId, dismiss]);

  const openNotifications = () => {
    dismiss();
    setFocused(null); setHovered(null);
    onOpenNotifications();
  };

  const bubbleWidth = Math.min(336, Math.max(1, viewport.width - edge * 2));
  const bubbleLeft = Math.max(edge, Math.min(viewport.width - edge - bubbleWidth, currentPosition.x + iconSize - bubbleWidth));
  const aboveSpace = currentPosition.y - edge - 12;
  const belowSpace = viewport.height - edge - currentPosition.y - iconSize - 12;
  const above = aboveSpace >= belowSpace;
  const dismissGreeting = () => {
    schedule.dismiss(); setFocused(null); setHovered(null); toggleRef.current?.focus();
  };

  return <><Dialog open={popup.length > 0} onOpenChange={open => { if (!open) setPopupIds([]); }}>
    <DialogContent className="max-h-[85dvh] overflow-y-auto bg-white sm:max-w-md">
      <DialogHeader><DialogTitle>至急の依頼が届いています</DialogTitle><DialogDescription>内容を開いて確認できます。</DialogDescription></DialogHeader>
      {popup.map(notice => <section key={notice.id} className="space-y-2 border-t pt-3">
        <p className="text-sm font-medium">{notice.senderName || 'メンバー'}さんから · {notice.taskName}</p>
        <p className="whitespace-pre-wrap break-words text-sm">{notice.message}</p>
        {typeof notice.data?.dueDate === 'string' && <p className="text-xs text-muted-foreground">期限 {notice.data.dueDate}</p>}
        <Button type="button" size="sm" onClick={() => openNotice(notice)}>依頼を見る</Button>
      </section>)}
      <Button type="button" variant="ghost" onClick={() => setPopupIds([])}>あとで</Button>
    </DialogContent>
  </Dialog><div data-testid="companion-launcher" className="fixed z-[60]" style={{ left: currentPosition.x, top: currentPosition.y }}>
    {showGreeting && <CompanionBubble variant="greeting" role="status" data-companion-greeting data-testid="companion-scheduled-greeting"
      onFocusCapture={() => setFocused(showGreeting.key)}
      onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(null); }}
      onMouseEnter={() => setHovered(showGreeting.key)} onMouseLeave={() => setHovered(null)}
      className="absolute"
      style={{ left: bubbleLeft - currentPosition.x, width: bubbleWidth, maxHeight: Math.max(0, above ? aboveSpace : belowSpace), ...(above ? { bottom: iconSize + 12 } : { top: iconSize + 12 }) }}>
      <GreetingContent message={showGreeting.message} onDismiss={dismissGreeting} />
    </CompanionBubble>}
    {hasQuickCheck && !schedule.greeting?.preview && <CompanionBubble variant="quick-check" data-testid="companion-task-check" className="absolute" style={{ left: bubbleLeft - currentPosition.x, width: bubbleWidth, maxHeight: Math.max(0, above ? aboveSpace : belowSpace), ...(above ? { bottom: iconSize + 12 } : { top: iconSize + 12 }) }}>{quickCheck}</CompanionBubble>}
    {showNotice && <CompanionBubble key={noticeId} role="status" data-testid="companion-notice"
      onFocusCapture={() => setFocused(noticeId ?? null)}
      onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(null); }}
      onMouseEnter={() => setHovered(noticeId ?? null)} onMouseLeave={() => setHovered(null)}
      className="absolute"
      style={{ left: bubbleLeft - currentPosition.x, width: bubbleWidth, maxHeight: Math.max(0, above ? aboveSpace : belowSpace), ...(above ? { bottom: iconSize + 12 } : { top: iconSize + 12 }) }}>
      <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-100 px-3 py-2.5 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-600 text-white"><Bell className="h-4 w-4" aria-hidden="true" /></span>
        <span className="min-w-0 flex-1 pt-0.5 text-sm font-semibold leading-snug">{persistent ? '確認してほしいことがあります' : 'モアイからのお知らせ'}{unread.length > 1 ? `（${unread.length}件）` : ''}</span>
        {!persistent && <button type="button" onClick={() => { dismiss(); setFocused(null); setHovered(null); toggleRef.current?.focus(); }} aria-label="吹き出しを閉じる" title="吹き出しを閉じる" className="-mr-1 -mt-1 shrink-0 rounded-lg p-2 hover:bg-amber-200 focus-visible:outline-2 focus-visible:outline-ring dark:hover:bg-amber-900"><X className="h-4 w-4" aria-hidden="true" /></button>}
      </div>
      <button type="button" onClick={() => openNotice(latest)} className="block w-full min-w-0 rounded-b-xl px-4 py-3 text-left hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring" aria-label={`未読の通知${count}件を開く`}>
        <span className="block break-words text-base font-semibold leading-snug">{latest?.title}</span>
        <span className="mt-2 block line-clamp-3 break-words text-sm leading-relaxed">{latest?.message}</span>
        <span className="mt-3 flex items-center gap-1 text-sm font-semibold text-amber-900 dark:text-amber-200">内容を見る<ArrowUpRight className="h-4 w-4" aria-hidden="true" /></span>
      </button>
    </CompanionBubble>}
    <button ref={toggleRef} type="button" data-testid="companion-ai-toggle" data-companion-toggle data-unread={count > 0}
      aria-label={isOpen ? '会話を閉じる' : 'AIに相談する'}
      title={`${isOpen ? '会話を閉じる' : busy ? 'AIが応答中・会話を開く' : 'AIに相談する'}（ドラッグで移動）`}
      aria-describedby={moveHintId}
      aria-expanded={isOpen}
      onPointerDown={event => {
        if (event.button !== 0 || event.isPrimary === false || drag.current) return;
        suppressClick.current = false;
        drag.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: currentPosition, current: currentPosition, moved: false };
        try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* Pointer may have ended. */ }
      }}
      onPointerMove={movePointer}
      onPointerUp={event => { movePointer(event); finishPointer(event); }}
      onPointerCancel={event => finishPointer(event, true)}
      onLostPointerCapture={event => finishPointer(event, true)}
      onDragStart={event => event.preventDefault()}
      onClick={event => {
        const ignore = suppressClick.current && event.detail !== 0;
        suppressClick.current = false;
        if (ignore) { event.preventDefault(); return; }
        onToggle();
      }}
      onKeyDown={event => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const steps: Record<string, Position> = { ArrowLeft: { x: -16, y: 0 }, ArrowRight: { x: 16, y: 0 }, ArrowUp: { x: 0, y: -16 }, ArrowDown: { x: 0, y: 16 } };
        const step = steps[event.key];
        if (!step) return;
        event.preventDefault(); event.stopPropagation();
        const next = clampPosition({ x: currentPosition.x + step.x, y: currentPosition.y + step.y }, getViewport());
        setPosition(next); savePosition(next);
      }}
      style={{ width: iconSize, height: iconSize }}
      className={cn('relative flex touch-none select-none cursor-grab items-center justify-center rounded-full border-2 active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-safe:transition-transform motion-safe:hover:scale-105',
        count > 0 ? 'border-amber-500 bg-amber-50 text-amber-900 shadow-[0_0_0_5px_rgba(245,158,11,0.16),0_8px_24px_rgba(180,83,9,0.24)]'
          : 'border-primary/50 bg-card text-primary shadow-[0_0_0_5px_rgba(89,185,222,0.10),0_8px_24px_rgba(28,112,153,0.24)]')}>
      <CompanionMascot busy={busy} unread={count > 0} />
    </button>
    <span id={moveHintId} className="sr-only">ドラッグ、または矢印キーで移動できます</span>
    {!isOpen && (count > 0 || error) && <button type="button" onClick={openNotifications}
      aria-label={error ? '通知を確認できません・通知を開く' : `未読の通知${count}件を開く`}
      title={error ? '通知を確認できません' : `未読の通知${count}件`}
      className={cn('absolute -right-1 -top-1 flex min-h-8 min-w-8 items-center justify-center rounded-full border-2 border-background px-2 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        count > 0 ? 'bg-amber-700 text-white' : 'bg-primary text-primary-foreground')}>
      {error ? '!' : count > 99 ? '99+' : count}
    </button>}
  </div></>;
}
