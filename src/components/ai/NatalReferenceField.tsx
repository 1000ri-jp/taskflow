import { useEffect, useId, useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { REFERENCE_LIMITS } from '@/lib/ai/support/profile';
import { NATAL_FILE_ACCEPT, NATAL_TEMPLATE_URL, readNatalFile } from '@/lib/ai/support/natalImport';

export function NatalReferenceField({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(value);
  const active = useRef(true);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [imported, setImported] = useState<{ name: string; before: string; text: string } | null>(null);
  useEffect(() => { latest.current = value; }, [value]);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <label htmlFor={id} className="text-sm font-medium">ネイタル</label>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <Button type="button" size="sm" variant="outline" disabled={reading} onClick={() => input.current?.click()}><Upload className="h-3.5 w-3.5" />{reading ? '読み込み中…' : 'ファイルを取り込む'}</Button>
        <a href={NATAL_TEMPLATE_URL} download="taskflow-natal-template.md" className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"><Download className="h-3.5 w-3.5" />記入用サンプル</a>
        <input ref={input} type="file" accept={NATAL_FILE_ACCEPT} aria-label="ネイタルのファイル" className="sr-only" disabled={reading} onChange={async event => {
          const file = event.target.files?.[0]; event.target.value = ''; if (!file || reading) return;
          const before = value; setReading(true); setError('');
          try {
            const text = await readNatalFile(file);
            if (!active.current) return;
            if (latest.current !== before) throw new Error('入力が変わったため取り込みませんでした。もう一度選んでください。');
            onChange(text); setImported({ name: file.name, before, text });
          } catch (error) { if (active.current) setError(error instanceof Error ? error.message : 'ファイルを読み込めませんでした。'); }
          finally { if (active.current) setReading(false); }
        }} />
      </div>
    </div>
    <p id={`${id}-help`} className="text-xs text-muted-foreground">TXT・MD・JSON。サンプルは、元資料と一緒にAIへ渡せます。</p>
    <Textarea id={id} aria-label="ネイタルの結果" aria-describedby={`${id}-help`} value={value} disabled={reading} maxLength={REFERENCE_LIMITS.natal} rows={5} placeholder={'太陽：サイン・ハウス\n月：サイン・ハウス\nASC：サイン\nその他の天体・アスペクト'} onChange={event => onChange(event.target.value)} />
    {imported && value === imported.text && <p role="status" className="break-words text-xs text-muted-foreground">{imported.name}を取り込みました。保存で反映します。<button type="button" className="ml-2 underline" onClick={() => { onChange(imported.before); setImported(null); }}>取り込みを戻す</button></p>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}
