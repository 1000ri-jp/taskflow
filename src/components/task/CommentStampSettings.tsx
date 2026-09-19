'use client';
import { useEffect, useId, useRef, useState } from 'react';
import Image from 'next/image';
import { Plus, Trash2 } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteCustomStamp, fetchStampSettings, putStampSettings, stampSettingsKey, uploadCustomStamp } from '@/lib/comments/client';
import { MAX_CUSTOM_STAMPS, MAX_STAMP_IMAGE_BYTES, MAX_STAMP_NAME_LENGTH, SEEN_STAMPS, STAMP_IMAGE_ACCEPT, STAMP_IMAGE_MIME_TYPES, type CustomSeenStamp, type CustomSeenStampId, type SeenStampId } from '@/lib/comments/reactions';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { StampPicture } from './StampPicture';

type UploadDraft = { id: CustomSeenStampId; file: File; previewUrl: string };
export function CommentStampSettings({ userId }: { userId: string }) {
  // Account changes discard any unsaved image and in-flight UI response.
  return <StampSettingsForm key={userId} userId={userId} />;
}
function StampSettingsForm({ userId }: { userId: string }) {
  const client = useQueryClient();
  const settings = useQuery({ queryKey: stampSettingsKey(userId), queryFn: () => fetchStampSettings(userId), staleTime: 60000, retry: false });
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<CustomSeenStamp | null>(null);
  const selectedButton = useRef<HTMLButtonElement>(null);
  const addFormId = useId();
  const locked = useRef(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState<UploadDraft | null>(null);
  const [name, setName] = useState('');
  const [imageFailed, setImageFailed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const previewUrl = draft?.previewUrl;
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  const save = async (seenStampId: SeenStampId) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setMessage(''); setFailed(false);
    try {
      await client.cancelQueries({ queryKey: stampSettingsKey(userId) });
      client.setQueryData(stampSettingsKey(userId), await putStampSettings(userId, seenStampId));
      setMessage('お気に入りを保存しました。');
    } catch { setFailed(true); setMessage('保存を確認できませんでした。同じ絵柄を選んで再試行できます。'); }
    finally { locked.current = false; setBusy(false); }
  };
  const chooseFile = (file: File | undefined) => {
    if (!file) return;
    setMessage(''); setFailed(false); setImageFailed(false);
    if (!(STAMP_IMAGE_MIME_TYPES as readonly string[]).includes(file.type) || !file.size || file.size > MAX_STAMP_IMAGE_BYTES) {
      setDraft(null); setFailed(true); setMessage('PNG・JPEG・WebPの画像を2MB以下で選んでください。');
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    setDraft({ id: `custom_${crypto.randomUUID()}`, file, previewUrl: URL.createObjectURL(file) });
  };
  const add = async () => {
    if (locked.current || !draft || !name.trim() || imageFailed) return;
    locked.current = true; setBusy(true); setMessage(''); setFailed(false);
    try {
      await client.cancelQueries({ queryKey: stampSettingsKey(userId) });
      const saved = await uploadCustomStamp(userId, { id: draft.id, file: draft.file, name: name.trim() });
      client.setQueryData(stampSettingsKey(userId), saved);
      setDraft(null); setName('');
      if (fileInput.current) fileInput.current.value = '';
      setMessage(saved.seenStampId === draft.id ? 'スタンプを追加し、「見たよ」に選びました。' : 'スタンプを追加しました。');
    } catch (error) {
      setFailed(true); setMessage(`${error instanceof Error ? error.message : '保存を確認できませんでした。'} 入力を残しています。同じ内容で再試行できます。`);
    } finally { locked.current = false; setBusy(false); }
  };
  const remove = async () => {
    if (locked.current || !removing) return;
    locked.current = true; setBusy(true); setMessage(''); setFailed(false);
    try {
      await client.cancelQueries({ queryKey: stampSettingsKey(userId) });
      client.setQueryData(stampSettingsKey(userId), await deleteCustomStamp(userId, removing.id));
      setMessage(`「${removing.name}」を削除しました。`); setRemoving(null);
    } catch { setFailed(true); setMessage('削除を確認できませんでした。もう一度試してください。'); }
    finally { locked.current = false; setBusy(false); }
  };
  const custom = settings.data?.customStamps ?? [];
  return <section className="space-y-3" aria-label="見たよのスタンプ設定">
    <p className="text-sm text-muted-foreground">「見たよ」に使うスタンプを選べます。</p>
    {isE2EMockAuthEnabled() && <p className="text-xs text-muted-foreground">確認用：設定と追加した画像は、このブラウザだけに保存されます。</p>}
    {settings.isPending ? <p role="status" className="text-sm">読み込み中…</p> : settings.isError ? <p role="alert" className="text-sm">設定を取得できませんでした。<button className="ml-2 underline" onClick={() => void settings.refetch()}>再取得</button></p> : <>
      <fieldset disabled={busy}>
        <legend className="sr-only">お気に入りの見たよ</legend>
        <div className="flex flex-wrap gap-2">{[...SEEN_STAMPS, ...custom.map(stamp => ({ id: stamp.id, label: stamp.name }))].map(stamp => {
          const customStamp = custom.find(item => item.id === stamp.id);
          return <div key={stamp.id} className="relative flex w-20">
            <button ref={settings.data?.seenStampId === stamp.id ? selectedButton : undefined} type="button" aria-label={stamp.label} aria-pressed={settings.data?.seenStampId === stamp.id} onClick={() => void save(stamp.id)} className="flex w-20 flex-col items-center gap-1 rounded-xl border px-2 py-2 text-xs transition-colors hover:bg-muted aria-pressed:border-blue-500 aria-pressed:bg-blue-50 disabled:opacity-50">
              <StampPicture stampId={stamp.id} customStamp={customStamp} /><span className="w-full break-words">{stamp.label}</span>
            </button>
            {customStamp && <button type="button" aria-label={`「${stamp.label}」を削除`} title={`「${stamp.label}」を削除`} onClick={() => { setRemoving(customStamp); setFailed(false); setMessage(''); }} className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full border bg-white text-muted-foreground shadow-sm transition-colors hover:border-destructive hover:text-destructive focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"><Trash2 className="h-3 w-3" aria-hidden="true" /></button>}
          </div>;
        })}
          <button type="button" aria-label="オリジナルを追加" title="オリジナルを追加" aria-expanded={adding} aria-controls={addFormId} onClick={() => setAdding(value => !value)} className="flex min-h-16 w-20 shrink-0 items-center justify-center rounded-xl border border-dashed text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50">
            <Plus aria-hidden="true" className="h-6 w-6" />
          </button>
        </div>
      </fieldset>
      <AlertDialog open={!!removing} onOpenChange={open => { if (!open && !locked.current) setRemoving(null); }}>
        <AlertDialogContent onCloseAutoFocus={event => { event.preventDefault(); selectedButton.current?.focus(); }}>
          <AlertDialogHeader>
            <AlertDialogTitle>「{removing?.name}」を削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>一覧から削除します。過去のコメントに付けたスタンプは残ります。{settings.data?.seenStampId === removing?.id && '選択中のスタンプは「手をふる」に戻ります。'}</AlertDialogDescription>
          </AlertDialogHeader>
          {failed && <p role="alert" className="text-sm text-destructive">{message}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>キャンセル</AlertDialogCancel>
            <AlertDialogAction disabled={busy} className="bg-destructive text-white hover:bg-destructive/90" onClick={event => { event.preventDefault(); void remove(); }}>{busy ? '削除中…' : '削除する'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
        <form id={addFormId} hidden={!adding} className="space-y-3 rounded-lg border p-3" onSubmit={event => { event.preventDefault(); void add(); }}>
          <fieldset disabled={busy || custom.length >= MAX_CUSTOM_STAMPS} className="space-y-3 disabled:opacity-60">
            <legend className="sr-only">オリジナルスタンプを追加</legend>
            <label className="block space-y-1 text-sm"><span>画像</span><input ref={fileInput} type="file" accept={STAMP_IMAGE_ACCEPT} onChange={event => chooseFile(event.target.files?.[0])} className="block w-full min-w-0 rounded border p-2 text-xs file:mr-2 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1" aria-describedby="stamp-image-help" /></label>
            <p id="stamp-image-help" className="text-xs text-muted-foreground">PNG・JPEG・WebP、2MBまで。静止画を20個まで追加できます。</p>
            {draft && <div className="flex items-center gap-3">
              <Image key={draft.previewUrl} src={draft.previewUrl} alt="追加するスタンプのプレビュー" width={64} height={64} unoptimized className="h-16 w-16 shrink-0 rounded border object-contain" onError={() => { setImageFailed(true); setFailed(true); setMessage('画像を読み取れませんでした。別の画像を選んでください。'); }} />
              <span className="min-w-0 break-all text-xs text-muted-foreground">{draft.file.name}</span>
            </div>}
            <label className="block space-y-1 text-sm"><span>名前</span><input type="text" maxLength={MAX_STAMP_NAME_LENGTH} value={name} onChange={event => {
              setName(event.target.value);
              // A changed payload gets a new identity; an unchanged retry retains it.
              if (draft) setDraft({ ...draft, id: `custom_${crypto.randomUUID()}` });
            }} placeholder="スタンプの名前" className="block w-full rounded border bg-background px-3 py-2 text-sm" /></label>
            <button type="submit" disabled={!draft || !name.trim() || imageFailed} className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">追加して使う</button>
          </fieldset>
          {custom.length >= MAX_CUSTOM_STAMPS && <p className="text-xs text-muted-foreground">オリジナルは20個まで登録できます。</p>}
        </form>
    </>}
    {(busy || message) && <p role={failed ? 'alert' : 'status'} className="text-xs">{busy ? '保存中…' : message}</p>}
  </section>;
}
