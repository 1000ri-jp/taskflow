'use client';

import { useState } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MAX_ANNOTATIONS, type ScreenAnnotation } from '@/lib/ai/featureRequest/annotations';

export function RequestAnnotations({ items, disabled, onChange, onCapture }: { items: ScreenAnnotation[]; disabled: boolean; onChange: (items: ScreenAnnotation[]) => void; onCapture: () => void }) {
  const [enlarged, setEnlarged] = useState<string | null>(null);
  return <section aria-label="画面注釈" className="min-w-0 space-y-3 rounded-lg border p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">画面を添える</h3><Button type="button" size="sm" variant="outline" disabled={disabled || items.length >= MAX_ANNOTATIONS} onClick={onCapture}><Camera aria-hidden="true" />画面に注釈を付ける</Button></div>
    {!items.length && <p className="text-xs text-muted-foreground">場所を選んで、コメントを付けられます。</p>}
    {items.map((item, index) => <article key={item.id} className="min-w-0 space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2"><h4 className="text-sm font-medium">画面 {index + 1}</h4><Button type="button" size="sm" variant="ghost" disabled={disabled} aria-label={`画面 ${index + 1} を削除`} onClick={() => onChange(items.filter(value => value.id !== item.id))}><Trash2 aria-hidden="true" />削除</Button></div>
      <div className={enlarged === item.id ? 'max-h-[60dvh] overflow-auto rounded border' : ''}>
        {/* Browser-only blob preview. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.preview} alt={`画面 ${index + 1} の注釈画像`} className={enlarged === item.id ? 'max-w-none' : 'max-h-60 w-full rounded border object-contain'} style={enlarged === item.id ? { width: item.viewport.width } : undefined} />
      </div>
      <Button type="button" size="sm" variant="ghost" className="h-auto px-0 text-xs underline" aria-expanded={enlarged === item.id} onClick={() => setEnlarged(enlarged === item.id ? null : item.id)}>{enlarged === item.id ? '画像を小さくする' : '画像を大きく見る'}</Button>
      <div className="space-y-1 text-xs text-muted-foreground"><p className="break-words">{item.target}</p><a className="block break-all underline" href={item.pageUrl} target="_blank" rel="noreferrer">{item.pageUrl}</a></div>
      <label className="block space-y-1 text-sm"><span>画面 {index + 1} へのコメント</span><Textarea value={item.comment} disabled={disabled} maxLength={1000} rows={3} placeholder="ここを、どう変えたいですか？" onChange={event => onChange(items.map(value => value.id === item.id ? { ...value, comment: event.target.value } : value))} /></label>
    </article>)}
    {!!items.length && <p className="text-xs text-muted-foreground">画像に写っている内容も送られます。見え方を確認してから登録してください。</p>}
  </section>;
}
