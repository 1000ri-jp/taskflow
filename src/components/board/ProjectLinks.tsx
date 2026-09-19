'use client';

import { useState } from 'react';
import { Link2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ControlHint } from '@/components/ui/control-hint';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import type { ProjectUrl } from '@/types';

function webUrl(value: string) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

export function ProjectLinks({ urls, onUpdate }: { urls: ProjectUrl[]; onUpdate: (urls: ProjectUrl[]) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const selectLink = (id: string) => {
    const link = urls.find(item => item.id === id);
    setEditingId(id); setTitle(link?.title ?? ''); setUrl(link?.url ?? ''); setError('');
  };
  const start = (id = '') => { selectLink(id); setOpen(true); };
  const save = async (remove = false) => {
    if (saving) return;
    const href = webUrl(url.trim());
    if (!remove && (!title.trim() || !href)) { setError('表示名と、https:// または http:// で始まるURLを入力してください。'); return; }
    if (editingId && !urls.some(item => item.id === editingId)) { setError('このリンクは削除されています。選び直してください。'); return; }
    setSaving(true); setError('');
    try {
      const next = remove ? urls.filter(item => item.id !== editingId) : editingId
        ? urls.map(item => item.id === editingId ? { ...item, title: title.trim(), url: href! } : item)
        : [...urls, { id: crypto.randomUUID(), title: title.trim(), url: href! }];
      await onUpdate(next);
      setOpen(false);
    } catch { setError('リンクを保存できませんでした。入力内容を残しています。もう一度お試しください。'); }
    finally { setSaving(false); }
  };
  return <div aria-label="プロジェクト共通のリンク" className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1.5">
    <ControlHint label={urls.length ? 'リンクの追加・編集' : 'リンクを設定'} description="プロジェクト共通のリンクに表示名とURLを登録します。"><Button type="button" variant={urls.length ? 'ghost' : 'outline'} size={urls.length ? 'icon' : 'sm'} className={urls.length ? 'h-8 w-8' : 'h-8 gap-1.5'} aria-label={urls.length ? 'リンクの追加・編集' : 'リンクを設定'} onClick={() => start()}><Plus className="h-4 w-4" aria-hidden="true" />{urls.length === 0 && <span>リンクを設定</span>}</Button></ControlHint>
    {urls.map(link => {
      const href = webUrl(link.url);
      return <Button key={link.id} asChild variant="outline" size="sm" className="h-8 max-w-48 gap-1.5">
        <a href={href ?? undefined} target="_blank" rel="noopener noreferrer" aria-label={link.title} title={`${link.title}\n${link.url}\n右クリックで編集`} onClick={event => { if (!href) { event.preventDefault(); start(link.id); } }} onContextMenu={event => { event.preventDefault(); start(link.id); }} onKeyDown={event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); start(link.id); } }}>
          <Link2 className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{link.title}</span>
        </a>
      </Button>;
    })}

    <Dialog open={open} onOpenChange={value => { if (!saving) setOpen(value); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>プロジェクトのリンク</DialogTitle><DialogDescription>表示名を付けて、プロジェクトのメンバーで共有できます。</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); void save(); }}>
          <fieldset disabled={saving} className="space-y-3">
            {urls.length > 0 && <label className="block space-y-1 text-sm"><span>追加・編集</span><select aria-label="編集するリンク" value={editingId} onChange={event => selectLink(event.target.value)} className="h-9 w-full rounded-md border bg-background px-2"><option value="">新しいリンクを追加</option>{urls.map(link => <option key={link.id} value={link.id}>{link.title}</option>)}</select></label>}
            <label className="block space-y-1 text-sm"><span>表示名</span><Input required value={title} onChange={event => setTitle(event.target.value)} placeholder="例：共有フォルダ" autoFocus /></label>
            <label className="block space-y-1 text-sm"><span>URL</span><Input required type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://..." /></label>
          </fieldset>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex items-center gap-2">
            {editingId && <Button type="button" variant="ghost" size="sm" disabled={saving} className="text-destructive" onClick={() => { void save(true); }}><Trash2 className="h-4 w-4" />削除</Button>}
            <Button type="button" variant="outline" className="ml-auto" disabled={saving} onClick={() => setOpen(false)}>キャンセル</Button>
            <Button type="submit" disabled={saving || !title.trim() || !url.trim()}>{saving ? '保存中…' : editingId ? '保存' : '追加'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  </div>;
}
