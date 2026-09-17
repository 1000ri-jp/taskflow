'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Settings2, SmilePlus } from 'lucide-react';
import { fetchCommentReactions, fetchStampSettings, putCommentReaction, stampSettingsKey } from '@/lib/comments/client';
import { DEFAULT_SEEN_STAMP, REACTION_LABELS, type ReactionAction, type ReactionKind, type ReactionList, type ReactionTarget } from '@/lib/comments/reactions';
import { StampPicture } from './StampPicture';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ControlHint } from '@/components/ui/control-hint';

export function CommentReactions({ userId, authorId, projectId, taskId, commentId }: ReactionTarget & { userId: string; authorId: string }) {
  const canMarkSeen = userId !== authorId;
  const anchor = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const locked = useRef(false);
  const [pending, setPending] = useState<ReactionAction | null>(null);
  const [error, setError] = useState('');
  const client = useQueryClient();
  const key = ['comment-reactions', userId, projectId, taskId, commentId];
  const target = { projectId, taskId, commentId };
  useEffect(() => {
    const node = anchor.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '80px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const reactions = useQuery({ queryKey: key, queryFn: () => fetchCommentReactions(userId, target), enabled: visible, retry: false, staleTime: 60000, refetchOnWindowFocus: false });
  const settings = useQuery({ queryKey: stampSettingsKey(userId), queryFn: () => fetchStampSettings(userId), enabled: visible && canMarkSeen, retry: false, staleTime: 60000, refetchOnWindowFocus: false });
  const own = reactions.data?.own;
  const stampId = own?.marks.seen?.stampId ?? settings.data?.seenStampId ?? DEFAULT_SEEN_STAMP;
  const customStamp = own?.marks.seen?.customStamp ?? settings.data?.customStamps?.find(stamp => stamp.id === stampId);
  async function save(action: ReactionAction) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      await client.cancelQueries({ queryKey: key });
      const { reaction } = await putCommentReaction(userId, action);
      client.setQueryData<ReactionList>(key, previous => previous ? { ...previous, own: reaction, reactions: [...previous.reactions.filter(row => row.userId !== userId), ...(reaction ? [reaction] : [])] } : { reactions: reaction ? [reaction] : [], own: reaction, partial: false });
      setPending(null);
    } catch {
      setPending(action);
      setError('保存を確認できませんでした。');
    } finally { locked.current = false; setBusy(false); }
  }
  const disabled = busy || !!pending || !reactions.data || reactions.isError;
  return <div ref={anchor} className="relative -mt-2 ml-2 space-y-1" aria-label="コメントのスタンプ">
    <div className="flex flex-wrap items-center gap-1">
      {canMarkSeen && <ControlHint label={own?.marks.seen ? '見たよを取り消す' : '見たよ'} description="読んだことを相手に伝えます。承認・タスク完了にはなりません。もう一度押すと取り消せます。">
        <button type="button" aria-label={`見たよ${own?.marks.seen ? 'を取り消す' : 'を付ける'}`} aria-pressed={!!own?.marks.seen}
          disabled={disabled || !own?.marks.seen && (!settings.data || settings.isError)}
          onClick={() => void save({ ...target, kind: 'seen', active: !own?.marks.seen, stampId })}
          className="inline-flex min-h-8 items-center gap-1 rounded-full border bg-background px-2 text-xs hover:bg-muted aria-pressed:border-blue-300 aria-pressed:bg-blue-50 disabled:opacity-50">
          <StampPicture stampId={stampId} customStamp={customStamp} />
        </button>
      </ControlHint>}
      <Popover open={open} onOpenChange={setOpen}>
        <ControlHint label="スタンプ" description="ありがとう・やったねを選べます。">
          <PopoverTrigger asChild><button type="button" aria-label="スタンプを選ぶ" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"><SmilePlus className="h-4 w-4" /></button></PopoverTrigger>
        </ControlHint>
        <PopoverContent align="start" side="bottom" className="w-auto max-w-[calc(100vw-2rem)] p-2" aria-label="スタンプを選択">
          <div className="flex items-center gap-1">
      {(['thanks', 'celebrate'] as const).map(kind => <ControlHint key={kind} label={REACTION_LABELS[kind]} description="気持ちを伝えるスタンプです。もう一度押すと取り消せます。">
        <button type="button" aria-label={`${REACTION_LABELS[kind]}${own?.marks[kind] ? 'を取り消す' : 'を付ける'}`} aria-pressed={!!own?.marks[kind]} disabled={disabled} onClick={() => void save({ ...target, kind, active: !own?.marks[kind], stampId: kind })} className="inline-flex h-11 w-11 items-center justify-center rounded-full border bg-background hover:bg-muted aria-pressed:border-blue-300 aria-pressed:bg-blue-50 disabled:opacity-50">
          <StampPicture stampId={kind} />
        </button>
      </ControlHint>)}
      <ControlHint label="スタンプを再取得" description="ほかの人のスタンプを最新にします。"><button type="button" aria-label="スタンプを再取得" className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-50" disabled={busy || reactions.isFetching} onClick={() => void reactions.refetch()}><RefreshCw className="h-3 w-3" /></button></ControlHint>
      {canMarkSeen && <ControlHint label="見たよの絵柄を選ぶ"><Link href="/settings#comment-stamps" aria-label="見たよの絵柄を選ぶ" className="rounded p-1 text-muted-foreground hover:bg-muted"><Settings2 className="h-3 w-3" /></Link></ControlHint>}
          </div>
        </PopoverContent>
      </Popover>
    {reactions.data && !reactions.isError && <div className="contents" aria-label="付いているスタンプ">
      {reactions.data.reactions.map(row => (Object.keys(REACTION_LABELS) as ReactionKind[]).filter(kind => row.marks[kind] && (canMarkSeen || row.userId !== userId || kind !== 'seen')).map(kind => <ControlHint key={`${row.userId}:${kind}`} label={`${row.displayName} · ${REACTION_LABELS[kind]}`} description={`${row.marks[kind]!.customStamp?.name ? `${row.marks[kind]!.customStamp!.name} · ` : ''}${new Date(row.marks[kind]!.at).toLocaleString('ja-JP')}`}><span tabIndex={0} aria-label={`${row.displayName}：${REACTION_LABELS[kind]}${row.marks[kind]!.customStamp?.name ? `（${row.marks[kind]!.customStamp!.name}）` : ''}`} className="inline-flex h-9 w-9 items-center justify-center rounded-full border bg-background">
        <StampPicture stampId={row.marks[kind]!.stampId} customStamp={row.marks[kind]!.customStamp} />
      </span></ControlHint>))}
      {reactions.data.partial && <span className="text-xs text-muted-foreground">一部を表示</span>}
    </div>}
    </div>
    {visible && reactions.isPending && <p role="status" className="text-xs text-muted-foreground">スタンプを読み込み中…</p>}
    {reactions.isError && <p role="alert" className="text-xs text-destructive">スタンプを取得できませんでした。<button className="ml-1 underline" onClick={() => void reactions.refetch()}>再取得</button></p>}
    {canMarkSeen && settings.isError && <p role="alert" className="text-xs text-destructive">見たよの絵柄を取得できませんでした。<button className="ml-1 underline" onClick={() => void settings.refetch()}>再取得</button></p>}
    {busy && <p role="status" className="text-xs text-muted-foreground">スタンプを保存中…</p>}
    {error && <p role="alert" className="text-xs text-destructive">{error} <button disabled={busy} className="underline" onClick={() => pending && void save(pending)}>同じ操作を再試行</button></p>}
  </div>;
}
