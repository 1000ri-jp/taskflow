'use client';

import { useEffect, useId, useState } from 'react';
import { Settings2, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { normalizeMeetUrl, useMeetLinkStore, type MeetLinkIndex } from '@/stores/meetLinkStore';

function MeetLinkSlot({ index }: { index: MeetLinkIndex }) {
  const { links, save, clear } = useMeetLinkStore();
  const { name, url } = links[index];
  const [open, setOpen] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const inputId = useId();

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Popover open={open} onOpenChange={(next) => { setOpen(next); if (next) { setDraftName(name); setDraft(url ?? ''); setError(''); } }}>
        <PopoverTrigger asChild>
          <Button type="button" size="sm" variant={url ? 'ghost' : 'outline'} className="h-8 gap-1.5" aria-label={`Meetリンク${index + 1}の設定`}>
            {url ? <Settings2 className="h-3.5 w-3.5" /> : <><Video className="h-3.5 w-3.5" /><span className="max-w-40 truncate">{name}を設定</span></>}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" collisionPadding={16} className="max-h-[var(--radix-popover-content-available-height)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto">
          <form className="space-y-3" onSubmit={(event) => {
            event.preventDefault();
            if (!draftName.trim() || draftName.trim().length > 40) { setError('名称を1〜40文字で入力してください。'); return; }
            if (!normalizeMeetUrl(draft)) { setError('https://meet.google.com/ から始まる会議URLを入力してください。'); return; }
            if (!save(index, draftName, draft)) return;
            setOpen(false);
          }}>
            <p className="text-sm font-medium">Meetリンク{index + 1}の設定</p>
            <label htmlFor={`${inputId}-name`} className="block text-sm">リンク{index + 1}の名称</label>
            <Input id={`${inputId}-name`} value={draftName} onChange={(event) => setDraftName(event.target.value)} maxLength={40} placeholder="例：朝会" />
            <label htmlFor={inputId} className="block text-sm">リンク{index + 1}のURL</label>
            <Input id={inputId} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="会議のリンクを貼り付け" autoComplete="off" aria-invalid={Boolean(error)} aria-describedby={error ? `${inputId}-error` : undefined} />
            {error && <p id={`${inputId}-error`} role="alert" className="text-xs text-rose-700">{error}</p>}
            <p className="text-xs leading-relaxed text-muted-foreground">名称とURLはこのブラウザだけに保存します。会議の作成や参加は行いません。登録した名称のボタンを押すと別タブで開きます。</p>
            <div className="flex justify-end gap-2">
              {url && <Button type="button" variant="ghost" size="sm" onClick={() => { clear(index); setOpen(false); }}>リンクを外す</Button>}
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>キャンセル</Button>
              <Button type="submit" size="sm">保存</Button>
            </div>
          </form>
        </PopoverContent>
      </Popover>
      {url && <Button asChild size="sm" variant="outline" className="h-8 gap-1.5">
        <a href={url} target="_blank" rel="noopener noreferrer" title={`${name}：${url}`}><Video className="h-3.5 w-3.5" /><span className="max-w-40 truncate">{name}</span></a>
      </Button>}
    </div>
  );
}

export function MeetLinkSettings() {
  const { persistenceFailed, hydrate } = useMeetLinkStore();
  useEffect(() => { hydrate(); }, [hydrate]);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <MeetLinkSlot index={1} />
      {persistenceFailed && <span role="status" className="text-xs text-amber-700">ブラウザに保存できないため、この画面でのみ有効です。</span>}
    </div>
  );
}
