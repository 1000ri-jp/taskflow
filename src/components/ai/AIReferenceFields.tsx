import { useState, type Dispatch, type SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { parseStrengthsResult } from '@/lib/ai/support/strengthsImport';
import { NatalReferenceField } from './NatalReferenceField';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { MBTI_TYPES, REFERENCE_LIMITS, hasSupportReferences, type AISupportProfile, type AISupportReferences } from '@/lib/ai/support/profile';

export function AIReferenceFields({ draft, onChange }: { draft: AISupportProfile; onChange: Dispatch<SetStateAction<AISupportProfile>> }) {
  const [resultText, setResultText] = useState('');
  const [importError, setImportError] = useState('');
  const [importNotice, setImportNotice] = useState('');
  const references = draft.references ?? { natal: '', mbti: '', strengths: [] };
  const update = (patch: Partial<AISupportReferences>) => onChange(current => ({ ...current, references: { ...(current.references ?? { natal: '', mbti: '', strengths: [] }), ...patch } }));
  const topFive = Array.from({ length: 5 }, (_, index) => references.strengths[index] ?? '');
  return <section aria-label="特性の参考情報" className="rounded-md border p-3">
    <h3 className="text-sm font-medium">特性の参考情報（任意）{hasSupportReferences(references) || draft.referenceNotes ? '・登録あり' : ''}</h3>
    <p className="my-3 text-xs text-muted-foreground">分かるものだけで始められます。</p>
    <div className="space-y-4">
      <NatalReferenceField value={references.natal} onChange={natal => update({ natal })} />
      <label className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium">MBTI</span>
        <select aria-label="MBTIのタイプ" className="rounded-md border bg-background px-2 py-1.5" value={references.mbti} onChange={event => update({ mbti: event.target.value })}>
          <option value="">未登録</option>
          {MBTI_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
        </select>
      </label>
      <div className="space-y-2">
        <p className="text-sm font-medium">ストレングスファインダー</p>
        <label className="block space-y-1 text-xs"><span className="text-muted-foreground">結果をまとめて貼り付け（順位付きの文章・資質名の一覧・JSON）</span><Textarea aria-label="ストレングスファインダーの結果を貼り付け" rows={3} maxLength={20000} value={resultText} placeholder={'1. 最上志向\n2. 調和性\n3. 規律性'} onChange={event => { setResultText(event.target.value); setImportError(''); setImportNotice(''); }} /></label>
        <Button type="button" size="sm" variant="outline" disabled={!resultText.trim()} onClick={() => {
          try { const strengths = parseStrengthsResult(resultText); update({ strengths }); setImportError(''); setImportNotice(`${strengths.filter(Boolean).length}件を順位どおりに入力しました。「保存して反映」で登録できます。`); }
          catch (error) { setImportNotice(''); setImportError(error instanceof Error ? error.message : '結果を読み取れませんでした。'); }
        }}>順位に取り込む</Button>
        {importError && <p role="alert" className="text-xs text-destructive">{importError}</p>}
        {importNotice && <p role="status" className="text-xs text-emerald-700">{importNotice}</p>}
        <div className="grid gap-2 sm:grid-cols-2">
          {topFive.map((value, index) => <label key={index} className="flex min-w-0 items-center gap-2 text-sm">
            <span className="shrink-0">{index + 1}位</span>
            <Input aria-label={`ストレングスファインダー ${index + 1}位`} value={value} maxLength={REFERENCE_LIMITS.strength} placeholder="資質名" onChange={event => {
              const strengths = [...topFive, ...references.strengths.slice(5)]; strengths[index] = event.target.value; update({ strengths });
            }} />
          </label>)}
        </div>
        <details className="text-xs">
          <summary className="cursor-pointer py-1 text-muted-foreground">6位以降も登録する（任意）</summary>
          <Textarea aria-label="ストレングスファインダー 6位以降" value={references.strengths.slice(5).join('\n')} maxLength={2348} rows={4} className="mt-1" placeholder="6位から34位まで、1行に1つの資質名" onChange={event => update({ strengths: [...topFive, ...event.target.value.split('\n')] })} />
        </details>
      </div>
      {draft.referenceNotes && <details className="border-t pt-3">
        <summary className="cursor-pointer text-xs text-muted-foreground">以前の自由記入を確認・編集</summary>
        <Textarea aria-label="以前の参考資料" value={draft.referenceNotes} maxLength={8000} rows={4} className="mt-2" onChange={event => onChange({ ...draft, referenceNotes: event.target.value })} />
      </details>}
    </div>
  </section>;
}
