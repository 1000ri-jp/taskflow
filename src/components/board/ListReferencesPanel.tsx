'use client';

import { useRef, useState } from 'react';
import { Archive, FileText, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DetailFrame, DetailBody, detailHeader, detailContent, detailDialog } from '@/components/ui/screen-layouts';
import { AttachmentPreview } from '@/components/task/AttachmentPreview';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { useAuthStore } from '@/stores/authStore';
import { useProject } from '@/hooks/useProjects';
import { uploadReferenceAttachment } from '@/lib/firebase/storage';
import { useListReferences, isSafeReferenceUrl } from '@/hooks/useListReferences';
import { cn } from '@/lib/utils';
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
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentDirty, setCommentDirty] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const attachmentInput = useRef<HTMLInputElement>(null);
  const reference = references.find(item => item.id === selectedId);
  const beginEdit = (value?: ListReference) => {
    setEditing(value ?? 'new'); setTitle(value?.title ?? ''); setFiles([]); setSaveError(''); setCreatedId(null);
  };
  const show = (value?: ListReference) => {
    setSelectedId(value?.id ?? null);
    if (value) { setEditing(null); setSaveError(''); }
    else if (canEdit) beginEdit();
    setOpen(true);
  };
  const close = () => {
    if (busy || commentBusy) return;
    const draftChanged = editing && (title !== (editing === 'new' ? '' : editing.title) || files.length);
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
      const id = editing === 'new' ? createdId ?? await create({ title, body: '' }) : editing.id;
      // If upload fails after creation, retry against the same record.
      if (editing === 'new') { setCreatedId(id); setSelectedId(id); }
      const uploaded = await Promise.all(files.map(async file => isE2EMockAuthEnabled()
        ? { id: crypto.randomUUID(), referenceId: id, name: file.name, type: file.type, size: file.size, url: URL.createObjectURL(file), uploadedBy: userId!, uploadedAt: new Date() }
        : { ...await uploadReferenceAttachment(projectId, id, file), uploadedBy: userId! }));
      if (editing !== 'new' || uploaded.length || createdId) await update(id, { title, ...(uploaded.length ? { attachments: [...(editing === 'new' ? [] : editing.attachments), ...uploaded] } : {}) }, editing === 'new' ? undefined : editing.updatedAt);
      setFiles([]); setEditing(null); setCreatedId(null);
    } catch (reason) { setSaveError(reason instanceof Error ? reason.message : '保存できませんでした。入力を保持しています。'); }
    finally { setBusy(false); }
  };
  const addAttachments = async (selected: File[]) => {
    if (!reference || !selected.length) return;
    if (selected.some(file => file.size > 10 * 1024 * 1024)) { setSaveError('ファイルサイズは10MB以下にしてください。'); return; }
    setBusy(true); setSaveError('');
    try {
      const uploaded = await Promise.all(selected.map(async file => isE2EMockAuthEnabled()
        ? { id: crypto.randomUUID(), referenceId: reference.id, name: file.name, type: file.type, size: file.size, url: URL.createObjectURL(file), uploadedBy: userId!, uploadedAt: new Date() }
        : { ...await uploadReferenceAttachment(projectId, reference.id, file), uploadedBy: userId! }));
      await update(reference.id, { attachments: [...reference.attachments, ...uploaded] }, reference.updatedAt);
    } catch (reason) { setSaveError(reason instanceof Error ? reason.message : '添付を保存できませんでした。'); }
    finally { setBusy(false); }
  };
  const trigger = canEdit && <Button type="button" variant="ghost" size="icon" className="size-6 shrink-0" title="関連情報" aria-label="関連情報を追加" disabled={isLoading || !!error} onClick={() => show()}><Paperclip className="size-3.5" aria-hidden="true" /></Button>;
  return <>
    {renderTrigger ? renderTrigger(trigger) : trigger}
    {(references.length > 0 || error) && <section className="space-y-2 border-b px-3 py-2" aria-label="このリストの関連情報">
      {error ? <p role="status" className="text-xs text-destructive">関連情報を取得できません。再読み込みしてください。</p> : references.map(item => <Button key={item.id} variant="outline" className="h-auto w-full justify-start whitespace-normal text-left" onClick={() => show(item)}><FileText className="size-4 shrink-0" /><span className="min-w-0 break-words">{item.title}</span></Button>)}
    </section>}
    <Dialog open={open} onOpenChange={next => { if (!next) close(); }}>
      <DialogContent className={detailDialog} aria-describedby={undefined}>
        <DetailFrame>
          <DialogHeader className={cn(detailHeader, 'pr-10 pt-5')}><div className="flex items-center gap-2"><DialogTitle className="min-w-0 flex-1">
            {editing === 'new' ? '関連情報を追加' : editing ? <Input aria-label="タイトル" value={title} onChange={event => setTitle(event.target.value)} disabled={busy} autoFocus className="h-8 border-0 px-0 py-0 text-base font-semibold shadow-none focus-visible:ring-0" /> : reference ? canEdit ? <button type="button" className="text-left" aria-label={`${reference.title}のタイトルを編集`} onClick={() => beginEdit(reference)}>{reference.title}</button> : reference.title : '関連情報'}
          </DialogTitle>
          {editing && editing !== 'new' && <><Button size="sm" disabled={busy} onClick={() => void handleSave()}>保存</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => { setEditing(null); setSaveError(''); }}>キャンセル</Button></>}
          {canEdit && reference && !editing && <><input ref={attachmentInput} className="sr-only" type="file" multiple aria-label="関連情報の添付ファイル" onChange={event => { const selected = Array.from(event.target.files ?? []); event.target.value = ''; void addAttachments(selected); }} /><Button variant="ghost" size="icon" aria-label="添付を追加" title="添付を追加" disabled={busy || commentBusy} onClick={() => attachmentInput.current?.click()}><Paperclip className="size-4" /></Button></>}
          </div></DialogHeader>
          <DetailBody><div className={cn(detailContent, 'space-y-4')}>
            {editing === 'new' ? <div className="space-y-3">
              <label className="block space-y-1 text-sm"><span>タイトル</span><Input value={title} onChange={event => setTitle(event.target.value)} disabled={busy} autoFocus /></label>
              <label className="block space-y-1 text-sm"><span>添付を追加</span><Input type="file" multiple disabled={busy} onChange={event => setFiles(Array.from(event.target.files ?? []))} /><span className="text-xs text-muted-foreground">1ファイル10MBまで</span></label>
              <div className="flex justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={close}>キャンセル</Button><Button disabled={busy} onClick={() => void handleSave()}>{busy ? '保存中…' : '保存'}</Button></div>
            </div> : reference && <>
              {reference.attachments.map(file => <AttachmentPreview key={file.id} {...file} />)}
              {reference.sourceTaskId && <p><a href={`/projects/${projectId}/board?task=${encodeURIComponent(reference.sourceTaskId)}`} target="_blank" rel="noreferrer" className="text-sm text-primary underline">元のタスク・やり取りを見る</a></p>}
            </>}
            {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
            {reference && <ReferenceComments key={reference.id} projectId={projectId} referenceId={reference.id} legacyBody={reference.body} legacyLinks={reference.links.filter(link => isSafeReferenceUrl(link.url))} legacyComment={reference.comment} onLegacyBodyChange={value => update(reference.id, { body: value }, reference.updatedAt)} canEdit={canEdit && !busy && !editing} onDirtyChange={setCommentDirty} onBusyChange={setCommentBusy} />}
          </div></DetailBody>
          <DialogFooter className="border-t p-3">
            {canEdit && reference && !editing && <Button variant="ghost" size="icon" aria-label="保管" title="保管" disabled={busy || commentBusy || commentDirty} onClick={async () => {
              if (!confirm('この関連情報を保管しますか？')) return;
              setBusy(true); setSaveError('');
              try { await archive(reference.id); setOpen(false); } catch { setSaveError('保管できませんでした。再試行してください。'); } finally { setBusy(false); }
            }}><Archive className="size-4" /></Button>}
            <Button variant="outline" disabled={busy || commentBusy} onClick={close}>閉じる</Button>
          </DialogFooter>
        </DetailFrame>
      </DialogContent>
    </Dialog>
  </>;
}
