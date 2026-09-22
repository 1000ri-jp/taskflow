'use client';

import { useState } from 'react';
import { Archive, FileText, Paperclip, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DetailFrame, DetailBody, detailHeader, detailContent, detailDialog } from '@/components/ui/screen-layouts';
import { Prose } from '@/components/ui/typography';
import { AttachmentPreview } from '@/components/task/AttachmentPreview';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { useAuthStore } from '@/stores/authStore';
import { useProject } from '@/hooks/useProjects';
import { uploadReferenceAttachment } from '@/lib/firebase/storage';
import { useListReferences, isSafeReferenceUrl } from '@/hooks/useListReferences';
import { cn, linkifyText } from '@/lib/utils';
import { ReferenceComments } from './ReferenceComments';
import type { ListReference } from '@/types';

export function ListReferencesPanel({ projectId, listId, renderTrigger }: { projectId: string; listId: string; renderTrigger?: (trigger: React.ReactNode) => React.ReactNode }) {
  const { references, isLoading, error, create, update, archive } = useListReferences(projectId, listId);
  const userId = useAuthStore(state => state.user?.id ?? null);
  const { project, members } = useProject(projectId);
  const canEdit = isE2EMockAuthEnabled() || (!!userId && !!project && (project.ownerId === userId || (members ?? []).some(member => member.userId === userId && (member.role === 'admin' || member.role === 'editor'))));
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ListReference | 'new' | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentDirty, setCommentDirty] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const reference = references.find(item => item.id === selectedId);
  const beginEdit = (value?: ListReference) => {
    setEditing(value ?? 'new'); setTitle(value?.title ?? ''); setBody(value?.body ?? ''); setFiles([]); setSaveError(''); setCreatedId(null);
  };
  const show = (value?: ListReference) => {
    setSelectedId(value?.id ?? null);
    if (canEdit) beginEdit(value); else { setEditing(null); setSaveError(''); }
    setOpen(true);
  };
  const close = () => {
    if (busy || commentBusy) return;
    const draftChanged = editing && (title !== (editing === 'new' ? '' : editing.title) || body !== (editing === 'new' ? '' : editing.body) || files.length);
    if ((draftChanged || commentDirty) && !confirm('未保存の入力があります。閉じてもよろしいですか？')) return;
    setOpen(false); setEditing(null); setCommentDirty(false); setSaveError('');
  };
  const handleSave = async () => {
    if (!editing) return;
    setSaveError('');
    if (!title.trim()) { setSaveError('タイトルを入力してください。'); return; }
    if (files.some(file => file.size > 10 * 1024 * 1024)) { setSaveError('ファイルサイズは10MB以下にしてください。'); return; }
    setBusy(true);
    try {
      const id = editing === 'new' ? createdId ?? await create({ title, body }) : editing.id;
      // If upload fails after creation, retry against the same record.
      if (editing === 'new') { setCreatedId(id); setSelectedId(id); }
      const uploaded = await Promise.all(files.map(async file => isE2EMockAuthEnabled()
        ? { id: crypto.randomUUID(), referenceId: id, name: file.name, type: file.type, size: file.size, url: URL.createObjectURL(file), uploadedBy: userId!, uploadedAt: new Date() }
        : { ...await uploadReferenceAttachment(projectId, id, file), uploadedBy: userId! }));
      if (editing !== 'new' || uploaded.length || createdId) await update(id, { title, body, ...(uploaded.length ? { attachments: [...(editing === 'new' ? [] : editing.attachments), ...uploaded] } : {}) }, editing === 'new' ? undefined : editing.updatedAt);
      setFiles([]); setEditing(null); setCreatedId(null);
    } catch (reason) { setSaveError(reason instanceof Error ? reason.message : '保存できませんでした。入力を保持しています。'); }
    finally { setBusy(false); }
  };
  const trigger = canEdit && <Button type="button" variant="ghost" size="icon" className="size-6 shrink-0" title="関連情報" aria-label="関連情報を追加" disabled={isLoading || !!error} onClick={() => show()}><Paperclip className="size-3.5" aria-hidden="true" /></Button>;
  return <>
    {renderTrigger ? renderTrigger(trigger) : trigger}
    {(references.length > 0 || error) && <section className="space-y-2 border-b px-3 py-2" aria-label="このリストの関連情報">
      {error ? <p role="status" className="text-xs text-destructive">関連情報を取得できません。再読み込みしてください。</p> : references.map(item => <Button key={item.id} variant="outline" className="h-auto w-full justify-start whitespace-normal text-left" onClick={() => show(item)}><FileText className="size-4 shrink-0" /><span className="min-w-0 break-words">{item.title}</span></Button>)}
    </section>}
    <Dialog open={open} onOpenChange={next => { if (!next) close(); }}>
      <DialogContent className={detailDialog}>
        <DetailFrame>
          <DialogHeader className={cn(detailHeader, 'pr-10')}><DialogTitle>{editing === 'new' ? '関連情報を追加' : reference?.title ?? '関連情報'}</DialogTitle><DialogDescription>このリストの説明・添付・コメント</DialogDescription></DialogHeader>
          <DetailBody><div className={cn(detailContent, 'space-y-4')}>
            {editing ? <div className="space-y-3">
              <label className="block space-y-1 text-sm"><span>タイトル</span><Input value={title} onChange={event => setTitle(event.target.value)} disabled={busy} autoFocus /></label>
              <label className="block space-y-1 text-sm"><span>説明</span><Textarea value={body} onChange={event => setBody(event.target.value)} rows={5} disabled={busy} /></label>
              {editing !== 'new' && editing.attachments.map(file => <AttachmentPreview key={file.id} {...file} />)}
              <label className="block space-y-1 text-sm"><span>添付を追加</span><Input type="file" multiple disabled={busy} onChange={event => setFiles(Array.from(event.target.files ?? []))} /><span className="text-xs text-muted-foreground">1ファイル10MBまで</span></label>
              <div className="flex justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={() => { if (editing === 'new') close(); else { setEditing(null); setSaveError(''); } }}>キャンセル</Button><Button disabled={busy} onClick={() => void handleSave()}>{busy ? '保存中…' : '保存'}</Button></div>
            </div> : reference && <>
              <div className="flex items-center justify-between"><h3 className="text-sm font-medium">説明</h3>{canEdit && <Button variant="ghost" size="sm" disabled={commentBusy} onClick={() => beginEdit(reference)}><Pencil className="mr-1 size-3" />編集</Button>}</div>
              <Prose className="break-words">{linkifyText(reference.body) || '説明はありません。'}</Prose>
              {reference.links.filter(link => isSafeReferenceUrl(link.url)).map(link => <p key={link.id}><a href={link.url} target="_blank" rel="noreferrer" className="break-all text-sm text-primary underline">{link.label}</a></p>)}
              {reference.attachments.map(file => <AttachmentPreview key={file.id} {...file} />)}
              {reference.sourceTaskId && <p><a href={`/projects/${projectId}/board?task=${encodeURIComponent(reference.sourceTaskId)}`} target="_blank" rel="noreferrer" className="text-sm text-primary underline">元のタスク・やり取りを見る</a></p>}
            </>}
            {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
            {reference && <ReferenceComments key={reference.id} projectId={projectId} referenceId={reference.id} legacyComment={reference.comment} canEdit={canEdit && !busy} onDirtyChange={setCommentDirty} onBusyChange={setCommentBusy} />}
          </div></DetailBody>
          <DialogFooter className="border-t p-3">
            {canEdit && reference && !editing && <Button variant="ghost" size="sm" disabled={busy || commentBusy || commentDirty} onClick={async () => {
              if (!confirm('この関連情報を保管しますか？')) return;
              setBusy(true); setSaveError('');
              try { await archive(reference.id); setOpen(false); } catch { setSaveError('保管できませんでした。再試行してください。'); } finally { setBusy(false); }
            }}><Archive className="mr-1 size-3" />保管</Button>}
            <Button variant="outline" disabled={busy || commentBusy} onClick={close}>閉じる</Button>
          </DialogFooter>
        </DetailFrame>
      </DialogContent>
    </Dialog>
  </>;
}
