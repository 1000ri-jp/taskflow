'use client';

import Link from 'next/link';
import { useState } from 'react';
import { HistoryPane } from '@/components/common/HistoryPane';
import { Loader2, RefreshCw, Paperclip, CornerUpLeft, MessageSquare } from 'lucide-react';
import { CommentComposer } from '@/components/task/CommentComposer';
import { CommentReactions } from '@/components/task/CommentReactions';
import { useMeetingMembers } from '@/hooks/useMeetingMembers';
import { useMyTasks } from '@/hooks/useMyTasks';
import { useDashboardComments } from '@/hooks/useDashboardComments';
import { useAuthStore } from '@/stores/authStore';
import { commentTaskKey, INBOX_COMMENT_LIMIT } from '@/lib/dashboard/comments';
import { sourceCommentHref } from '@/lib/task/commentSubmission';
import { safeHistoryUrl } from '@/lib/task/history/presentation';
import { cn, linkifyText } from '@/lib/utils';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { Button } from '@/components/ui/button';
import { AttachmentPreviewCompact } from '@/components/task/AttachmentPreview';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

/** Read the same comments as the dashboard; opening this view does not mark anything read. */
export function CompanionComments({ onNavigate }: { onNavigate: () => void }) {
  const { allProjectTasks, projects, isLoading, error } = useMyTasks();
  const userId = useAuthStore(state => state.firebaseUser?.uid);
  const authorName = useAuthStore(state => state.user?.displayName || state.firebaseUser?.displayName || 'メンバー');
  const comments = useDashboardComments(allProjectTasks, isLoading, error, true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const groups = new Map<string, { key: string; items: typeof comments.items }>();
  // The inbox is newest-first. Group by identity, preserving that order and every comment.
  for (const item of comments.items) {
    const key = commentTaskKey({ projectId: item.projectId, id: item.taskId });
    const group = groups.get(key);
    if (group) group.items.push(item);
    else groups.set(key, { key, items: [item] });
  }
  const threads = [...groups.values()];
  const selected = threads.find(thread => thread.key === selectedKey) ?? threads[0];
  const selectedTask = selected?.items[0].task;
  const parentTitle = selectedTask && allProjectTasks.find(task => task.projectId === selectedTask.projectId && task.id === selectedTask.parentTaskId)?.title;

  const project = projects.find(project => project.id === selectedTask?.projectId);
  const canComment = Boolean(userId && project && !project.isArchived && (project.ownerId === userId || project.memberIds.includes(userId)));
  const members = useMeetingMembers(project ? [project] : [], canComment);

  return <section aria-label="相棒のコメント" className="flex min-h-0 min-w-0 flex-1 bg-background text-foreground">
    <HistoryPane label="コメント履歴" actions={<Button type="button" size="icon-sm" variant="ghost" aria-label="コメントを更新" title="コメントを更新" disabled={comments.isLoading} onClick={comments.refresh}><RefreshCw className="size-4" aria-hidden="true" /></Button>} list={<>
      <p className="px-3 py-2 text-[11px] text-muted-foreground">最新{INBOX_COMMENT_LIMIT}件・タスク別</p>
      <ul className="space-y-1 px-1.5 pb-2">{threads.map(thread => {
        const item = thread.items[0];
        return <li key={thread.key}>
          <button type="button" aria-current={selected?.key === thread.key ? 'true' : undefined} aria-label={`${item.task.projectName} / ${item.task.title}のコメント（${thread.items.length}件）`} title={`${item.task.projectName} / ${item.task.title}：${item.comment.content || '添付ファイル'}`} onClick={() => setSelectedKey(thread.key)} className={cn('block w-full min-w-0 rounded-lg px-2.5 py-2.5 text-left text-xs transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring', selected?.key === thread.key && 'bg-primary/10')}>
            <span className="flex min-w-0 items-center gap-1"><span className="min-w-0 flex-1 truncate font-medium">{item.task.title}</span><span className="shrink-0 rounded-full bg-background/80 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">{thread.items.length}件</span></span>
            <span className="mt-1 block truncate text-[11px] text-muted-foreground">{item.authorName} · {item.comment.createdAt instanceof Date && Number.isFinite(item.comment.createdAt.getTime()) ? item.comment.createdAt.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '日時不明'}</span>
          </button>
        </li>;
      })}</ul>
    </>}>
      <div key={JSON.stringify([userId, selected?.key ?? 'empty'])} className="flex min-h-0 min-w-0 flex-1 flex-col bg-muted/35">
        {selected && selectedTask && <header className="flex shrink-0 items-center gap-3 border-b bg-background px-4 py-3">
          <MessageSquare className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="break-words text-[11px] text-muted-foreground">{selectedTask.projectName}{parentTitle ? ` / ${parentTitle}` : ''}</p>
            <h3 className="break-words text-sm font-medium">{selectedTask.title}</h3>
            <p className="text-[11px] text-muted-foreground">{selected.items.length}件のコメント・新しい順</p>
          </div>
        </header>}
        <div className="min-h-0 flex-1 overflow-y-auto p-3 @[520px]:p-5">
          {isE2EMockAuthEnabled() && <p className="mb-3 text-xs text-muted-foreground">架空データのコメントです。</p>}
          {comments.isLoading && <p role="status" className="flex items-center gap-2 py-3 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" />コメントを読み込み中…</p>}
          {comments.hasError && <p role="alert" className="mb-3 text-xs text-amber-800">一部のコメントを取得できません。取得できた分を表示しています。</p>}
          {comments.metadataIncomplete && <p className="mb-3 text-xs text-muted-foreground">一部の投稿者名・リスト名を取得できません。</p>}
          {!comments.isLoading && !comments.hasError && comments.items.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">表示できるコメントはありません。</p>}
          <div className="space-y-6">{selected?.items.map(item => {
            const { comment } = item;
            const date = comment.createdAt instanceof Date && Number.isFinite(comment.createdAt.getTime()) ? comment.createdAt : null;
            const own = Boolean(userId && comment.authorId === userId);
            const photoURL = !comment.authorIcon && safeHistoryUrl(item.authorPhotoURL ?? undefined);
            const avatarText = comment.authorIcon || (item.authorName === '投稿者名未取得' ? '?' : Array.from(item.authorName.trim()).slice(0, 2).join('').toUpperCase()) || '?';
            return <article key={item.key} aria-label="コメントの内容" className={cn('flex min-w-0 items-start gap-2.5', own && 'flex-row-reverse')}>
              <Avatar aria-hidden="true" className="mt-5 size-8 ring-1 ring-border/60">
                {photoURL && <AvatarImage src={photoURL} alt="" className="object-cover" />}
                <AvatarFallback className={cn('bg-background text-xs font-medium text-muted-foreground', own && 'bg-primary/10 text-primary', comment.authorIcon && 'text-base')}>{avatarText}</AvatarFallback>
              </Avatar>
              <div className={cn('flex min-w-0 max-w-[85%] flex-col items-start gap-1.5', own && 'items-end')}>
                <div className={cn('flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-1 text-[11px] text-muted-foreground', own && 'justify-end')}>
                  <span className="break-words font-medium text-foreground">{item.authorName}</span>
                  {own && <span>あなた</span>}
                  {date && <time dateTime={date.toISOString()}>{date.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>}
                </div>
                <div className={cn('min-w-0 max-w-full space-y-3 rounded-2xl border border-border/60 bg-card px-3.5 py-2.5 shadow-sm', own ? 'rounded-tr-sm border-primary/15 bg-primary/10' : 'rounded-tl-sm')}>
                  {comment.purpose === 'review_request' && <span className="inline-block rounded-md bg-amber-50 px-2 py-0.5 text-[11px] text-amber-900">確認依頼</span>}
                  {comment.content && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]">{linkifyText(comment.content)}</p>}
                  {!!comment.attachments?.length && <ul className="space-y-2">{comment.attachments.map(file => {
                    const href = safeHistoryUrl(file.url);
                    const isImage = file.type?.startsWith('image/') || ((!file.type || file.type === 'application/octet-stream') && /\.(jpe?g|png|gif|webp|avif|bmp)$/i.test(file.name));
                    if (href && isImage) return <li key={file.id} className="min-w-0 max-w-full space-y-1">
                      <AttachmentPreviewCompact {...file} url={href} type="image/*" imageFit="contain" />
                      <a href={href} target="_blank" rel="noopener noreferrer" className="block break-all px-1 text-[11px] text-muted-foreground hover:text-primary hover:underline">{file.name}</a>
                    </li>;
                    const fileContent = <><Paperclip className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="min-w-0 break-all">{file.name}</span></>;
                    const fileClass = 'flex min-w-0 items-center gap-2 rounded-lg border border-border/60 bg-background/80 px-3 py-2 text-xs';
                    return <li key={file.id}>{href ? <a href={href} target="_blank" rel="noopener noreferrer" className={cn(fileClass, 'text-primary transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring')}>{fileContent}</a> : <span className={fileClass}>{fileContent}</span>}</li>;
                  })}</ul>}
                </div>
                {userId && <div className="w-full pt-2"><CommentReactions userId={userId} authorId={comment.authorId} projectId={item.projectId} taskId={item.taskId} commentId={comment.id} /></div>}
                <Link prefetch={false} href={sourceCommentHref(item.projectId, item.taskId, comment.id)} onClick={onNavigate} className="inline-flex min-h-7 items-center gap-1.5 rounded px-1 text-[11px] text-muted-foreground transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-ring"><CornerUpLeft className="size-3" aria-hidden="true" />{comment.purpose === 'review_request' ? '依頼を開く・返答' : 'タスクで続きを見る'}</Link>
              </div>
            </article>;
          })}</div>
        </div>
        {selectedTask && userId && canComment && <div className="max-h-[45%] shrink-0 overflow-y-auto border-t bg-background p-3">
          <CommentComposer projectId={selectedTask.projectId} taskId={selectedTask.id} authorId={userId} authorName={authorName}
            members={members} parentAssigneeIds={selectedTask.assigneeIds}
            tasks={allProjectTasks.filter(task => task.projectId === selectedTask.projectId)} onSubmitted={comments.refresh} />
        </div>}
      </div>
    </HistoryPane>
  </section>;
}
