'use client';

import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { requestAISupport } from '@/lib/ai/support/client';
import { withSupportFeedback } from '@/lib/ai/support/profile';
import { supportQueryKey } from './AISupportSettings';

export function AISupportAdjust({ userId, disabled, pendingInstruction, onApplyOnce, displayInstruction, surface = 'chat', inline = false }: { userId: string; disabled?: boolean; pendingInstruction?: string; onApplyOnce: (instruction: string) => void; surface?: 'chat' | 'work'; displayInstruction?: string; inline?: boolean }) {
  const cache = useQueryClient();
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [scope, setScope] = useState<'once' | 'usual'>('once');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  return <div className={inline ? "inline-flex min-w-0 flex-wrap items-center gap-1 text-left text-xs" : "border-t px-3 py-1.5 text-xs"}>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button type="button" variant="ghost" size="sm" className={inline ? "h-8 gap-1.5 px-2 text-xs has-[>svg]:px-2" : "h-7 px-2 text-xs"} disabled={disabled || !userId}><SlidersHorizontal aria-hidden="true" className={inline ? "h-3.5 w-3.5 shrink-0" : "h-4 w-4 shrink-0"} />手伝い方を変更</Button></PopoverTrigger>
      <PopoverContent aria-label="AIの手伝い方を調整" className="w-[32rem] max-w-[calc(100vw-2rem)] max-h-[var(--radix-popover-content-available-height)] space-y-4 overflow-y-auto" side="top" align="start" collisionPadding={16}>
        <p className="text-sm font-medium">どんな手伝い方がよいですか？</p>
        <div className="flex flex-wrap gap-1">{['もっと短く', '全体を見たい', '今は提案不要'].map(text => <Button key={text} variant="outline" size="sm" className="h-7 text-xs" disabled={saving} onClick={() => setInstruction(text)}>{text}</Button>)}</div>
        <Textarea aria-label="手伝い方へのフィードバック" placeholder="自由に書けます" rows={5} className="min-h-32" maxLength={1000} disabled={saving} value={instruction} onChange={event => setInstruction(event.target.value)} />
        <div className="flex gap-4 text-xs">{(['once', 'usual'] as const).map(value => <label key={value} className="flex items-center gap-1"><input type="radio" name="support-scope" value={value} checked={scope === value} disabled={saving} onChange={() => setScope(value)} />{value === 'once' ? '今回だけ' : '普段もこうして'}</label>)}</div>
        <p className="text-xs text-muted-foreground">{scope === 'once' ? surface === 'work' ? 'この仕事を開いている間の表示と、次のAI整理だけに反映します。' : '次に送るメッセージへの応答だけに反映します。' : '本人のプロフィールに保存し、次回からの標準にします。'}</p>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <div className="flex items-center justify-between gap-2"><a href="/profile#ai-support" className="text-xs underline">プロフィールで調整</a><Button size="sm" disabled={saving || !instruction.trim()} onClick={async () => {
          setError('');
          if (scope === 'once') { onApplyOnce(instruction.trim()); setMessage(''); setOpen(false); return; }
          setSaving(true);
          try {
            const profile = await requestAISupport(userId);
            const saved = await requestAISupport(userId, withSupportFeedback(profile, instruction));
            cache.setQueryData(supportQueryKey(userId), saved); onApplyOnce('');
            setMessage('普段の手伝い方に保存しました。'); setOpen(false);
          } catch (error) { setError(error instanceof Error ? error.message : '保存できませんでした。'); }
          finally { setSaving(false); }
        }}>{saving ? '保存中…' : scope === 'once' ? '今回に適用' : '保存して適用'}</Button></div>
      </PopoverContent>
    </Popover>
    {(pendingInstruction || displayInstruction) && <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onApplyOnce('')}>今回の指定を解除</Button>}
    {(pendingInstruction || displayInstruction || message) && <span role="status" className="ml-2 text-muted-foreground">{pendingInstruction ? `${surface === 'work' ? 'この仕事・次の整理だけ' : '次の応答だけ'}：${pendingInstruction}` : displayInstruction ? `この仕事の表示だけ：${displayInstruction}` : message}</span>}
  </div>;
}
