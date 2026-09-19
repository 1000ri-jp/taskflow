'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ArrowLeft, ArrowUpRight, BookOpen, Box, Layers3, PanelsTopLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ViewSwitcher } from '@/components/ui/view-switcher';
import { HelpText, PageHeading } from '@/components/ui/typography';
import { extendedSamples } from './ExtendedPreviews';
import catalog from '@/lib/ui-guide/catalog.json';
import { GuideSpecimenStatusSummary, guideSpecimenStatusLabel } from './GuideSpecimenStatus';
import usageData from '@/lib/ui-guide/usage.generated.json';
import verificationData from '@/lib/ui-guide/verification.json';

interface Usage { sourceHash: string; direct: string[]; indirect: string[]; routes: string[] }
interface VisualCheck { sample: string; sourceHash: string; where: string; result: string }
const usage = usageData.entries as Record<string, Usage>;
const verification = verificationData as { checks: VisualCheck[]; remaining: string[] };
const levels = [
  { id: 'basic', label: '基本部品', icon: Box },
  { id: 'composition', label: '用途別の組み合わせ', icon: Layers3 },
  { id: 'layout', label: '画面の型', icon: PanelsTopLeft },
] as const;

export function UIGuide({ initialSample = 'outline' }: { initialSample?: string }) {
  const initial = catalog.entries.find(entry => entry.id === initialSample) ?? catalog.entries[0];
  const [sample, setSample] = useState(initial.id);
  const entry = catalog.entries.find(item => item.id === sample)!;
  const [long, setLong] = useState(false);
  const [many, setMany] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [interaction, setInteraction] = useState('normal');
  const [fetchState, setFetchState] = useState('ready');
  const [variant, setVariant] = useState(entry.variants[0].id);
  const [trial, setTrial] = useState(initial.id === 'button');
  const [rowSpace, setRowSpace] = useState(6);
  const [cardSpace, setCardSpace] = useState(16);
  const [bubbleSpace, setBubbleSpace] = useState(16);
  const [buttonHeight, setButtonHeight] = useState(32);
  const supportsButtonHeight = sample === 'button';
  const supportsRowSpace = ['outline', 'table', 'list-layout'].includes(sample);
  const supportsCardSpace = sample === 'card' && variant !== 'standard' || ['detail-layout', 'settings-layout'].includes(sample);
  const supportsBubbleSpace = sample === 'bubble';
  const supportsSpacing = supportsRowSpace || supportsCardSpace || supportsBubbleSpace || supportsButtonHeight;
  const current = usage[entry.id];
  const isExtended = extendedSamples.includes(sample);
  const statusLabel = guideSpecimenStatusLabel(entry, trial);
  const supportsFetch = ['states', 'outline', 'table', 'list-layout', 'search', 'notifications', 'calendar', 'gantt', 'progress', 'proposal-review-flow-trial'].includes(sample);
  const supportsMany = ['outline', 'table', 'list-layout', 'detail-layout', 'settings-layout', 'search', 'notifications', 'calendar', 'calendar-task-create-trial', 'gantt', 'progress', 'frame-trial', 'table-trial', 'neo-brief-assignee-filter-trial', 'neo-shared-countdown-trial', 'neo-home-layout-trial', 'detail-header-spacing-trial', 'task-detail-subtask-order-trial', 'task-row-one-line-trial', 'task-structure-guidance-trial', 'subtask-view-alignment-trial', 'proposal-review-flow-trial'].includes(sample);
  const supportsSelected = ['button', 'input', 'navigation'].includes(sample);
  const supportsInteraction = !['text', 'states', 'bubble'].includes(sample);
  function choose(id: string) {
    const next = catalog.entries.find(item => item.id === id)!;
    setSample(id); setVariant(next.variants[0].id); setInteraction('normal'); setFetchState('ready'); setTrial(id === 'button');
    // A browser comment now identifies the specimen in its URL; no persistent settings are written.
    window.history.replaceState(null, '', `/ui-guide?sample=${encodeURIComponent(id)}`);
  }
  const params = new URLSearchParams({ sample, long: String(long), many: String(many), disabled: String(interaction === 'disabled'), selected: String(interaction === 'selected'), fetchState, variant });
  if (trial) {
    if (supportsRowSpace) params.set('rowSpace', String(rowSpace));
    if (supportsCardSpace) params.set('cardSpace', String(cardSpace));
    if (supportsBubbleSpace) params.set('bubbleSpace', String(bubbleSpace));
    if (supportsButtonHeight) params.set('buttonHeight', String(buttonHeight));
  }
  const checks = verification.checks.filter(check => check.sample === sample && !!current && check.sourceHash === current.sourceHash);
  return <main className="min-h-screen bg-background text-foreground">
    <header className="border-b bg-card">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-start justify-between gap-4 px-5 py-6">
        <div className="space-y-2"><Link className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline" href="/settings"><ArrowLeft className="size-3" />TaskFlowの設定へ</Link><PageHeading>TaskFlow UIガイド</PageHeading><HelpText>この見本を指して、文字・余白・配置・操作の希望を伝えられます。</HelpText></div>
        <div className="text-right"><span className="inline-flex items-center gap-1.5 rounded-full border bg-muted px-3 py-1 text-xs"><BookOpen className="size-3.5" />{statusLabel}</span><p className="mt-2 text-xs text-muted-foreground">操作はすべて架空データ</p></div>
      </div>
    </header>
    <div className="mx-auto max-w-[1440px] space-y-5 px-4 py-5 sm:px-5">
      <ViewSwitcher label="ガイドの段階" value={entry.level as 'basic' | 'composition' | 'layout'} options={levels} onChange={level => choose(catalog.entries.find(item => item.level === level)!.id)} />
      <div className="grid items-start gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="見本を選ぶ" className="flex flex-wrap gap-1 lg:flex-col">{catalog.entries.filter(item => item.level === entry.level).map(item => <Button key={item.id} variant={sample === item.id ? 'secondary' : 'ghost'} aria-pressed={sample === item.id} onClick={() => choose(item.id)} className="h-auto min-h-9 justify-start whitespace-normal text-left">{item.name}</Button>)}
          <p className="hidden pt-5 text-xs leading-relaxed text-muted-foreground lg:block">「この種類の行の余白を変えて」など、見本の名前と希望を伝えてください。利用先の照合・更新はAIが行います。</p>
        </nav>
        <section aria-label={`見本: ${entry.name}`} className="min-w-0 space-y-4">
          <div><h2 className="text-xl font-semibold">{entry.name}</h2><p className="mt-1 text-sm text-muted-foreground">{entry.purpose}</p><GuideSpecimenStatusSummary entry={entry} /></div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border bg-card px-4 py-3 text-sm" aria-label="見本の条件">
            <label className="flex min-h-8 items-center gap-2"><input type="checkbox" checked={long} onChange={event => setLong(event.target.checked)} />長い日本語</label>
            {supportsMany && <label className="flex min-h-8 items-center gap-2"><input type="checkbox" checked={many} onChange={event => setMany(event.target.checked)} />項目を多く</label>}
            <label className="flex min-h-8 items-center gap-2"><input type="checkbox" checked={narrow} onChange={event => setNarrow(event.target.checked)} />狭い画面（390px）</label>
            {supportsInteraction && <label className="flex flex-wrap items-center gap-2">操作状態<select aria-label="操作状態" className="h-9 rounded-md border bg-background px-2" value={interaction} onChange={event => setInteraction(event.target.value)}><option value="normal">通常</option>{supportsSelected && <option value="selected">選択中</option>}<option value="disabled">操作不可</option></select></label>}
            {supportsFetch && <label className="flex flex-wrap items-center gap-2">取得状態<select aria-label="取得状態" className="h-9 rounded-md border bg-background px-2" value={fetchState} onChange={event => setFetchState(event.target.value)}><option value="ready">通常</option><option value="loading">取得中</option><option value="empty">0件</option><option value="error">取得失敗</option></select></label>}
            {entry.variants.length > 1 && <label className="flex flex-wrap items-center gap-2">種類<select aria-label="バリエーション" className="h-9 rounded-md border bg-background px-2" value={variant} onChange={event => { setVariant(event.target.value); setTrial(false); }}>{entry.variants.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
          </div>
          {supportsSpacing && <details open={supportsButtonHeight ? true : undefined} className="rounded-xl border px-4 py-3">
            <summary className="cursor-pointer text-sm">余白を試す</summary>
            <div className="mt-3 flex flex-wrap items-center gap-5 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={trial} onChange={event => setTrial(event.target.checked)} />試作モード</label>
              {supportsRowSpace && <label>行の上下余白 {rowSpace}px<input className="ml-2 align-middle" aria-label="行の上下余白" type="range" min="4" max="12" step="1" value={rowSpace} disabled={!trial} onChange={event => setRowSpace(Number(event.target.value))} /></label>}
              {supportsCardSpace && <label>コンパクトカードの上下余白 {cardSpace}px<input className="ml-2 align-middle" aria-label="カードの上下余白" type="range" min="8" max="24" step="2" value={cardSpace} disabled={!trial} onChange={event => setCardSpace(Number(event.target.value))} /></label>}
              {supportsBubbleSpace && <label>吹き出しの内側余白 {bubbleSpace}px<input className="ml-2 align-middle" aria-label="吹き出しの内側余白" type="range" min="8" max="32" step="2" value={bubbleSpace} disabled={!trial} onChange={event => setBubbleSpace(Number(event.target.value))} /></label>}
              {supportsButtonHeight && <label>ボタンの高さ {buttonHeight}px<input className="ml-2 align-middle" aria-label="ボタンの高さ" type="range" min="28" max="36" step="2" value={buttonHeight} disabled={!trial} onChange={event => setButtonHeight(Number(event.target.value))} /></label>}
              <Button variant="ghost" size="sm" onClick={() => { setTrial(false); setRowSpace(6); setCardSpace(16); setBubbleSpace(16); }}>採用済み基準に戻す</Button>
            </div>
            {supportsButtonHeight && <HelpText className="mt-2">文字付きボタンを36pxから32pxへ。文字の上下を約2pxずつ詰めた試作です。文字サイズ・横幅・アイコンだけのボタンは変えません。採用は未決定です。</HelpText>}
            {sample === 'detail-layout' && <HelpText className="mt-2">詳細を開く前のカードの余白を調整します。</HelpText>}
            {supportsRowSpace && fetchState !== 'ready' && <HelpText className="mt-2">行の余白は、取得状態を「通常」にすると確認できます。</HelpText>}
            <HelpText className="mt-2">試作はこのガイド内だけです。採用する変更は、ガイド担当が採用内容を機能改善担当へ引き継ぎ、機能改善担当が共通設定と実画面へ反映・検証します。</HelpText>
          </details>}
          {trial && supportsSpacing && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">試作中 — 業務画面の基準は変わっていません。</p>}
          <div className="overflow-x-auto rounded-xl border bg-muted/30 p-2" data-testid="guide-preview-container">
            <iframe key={params.toString()} title={`${entry.name}の操作見本`} src={`/ui-guide/preview?${params}`} className="mx-auto block max-w-full rounded-lg border bg-background" style={{ width: narrow ? 390 : '100%', height: isExtended ? 740 : ['settings-layout','detail-layout'].includes(sample) ? 690 : ['outline','table','list-layout'].includes(sample) ? many ? 690 : 380 : long ? 510 : 360 }} />
          </div>
          <Link href={`/ui-guide/preview?${params}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm underline underline-offset-4">この条件の見本だけを別タブで開く<ArrowUpRight className="size-3" /></Link>
          <HelpText>条件を変えると見本の入力は初期化されます。保存の見本は最初の1回を失敗させ、入力を残して再試行できます。取得状態は対応する見本に適用します。別タブはその画面幅で表示します。</HelpText>
          <dl className="grid gap-x-8 gap-y-4 border-t pt-4 md:grid-cols-2">
            <div><dt className="text-sm font-semibold">利用先</dt><dd className="mt-2 flex flex-wrap gap-3">{entry.links.map(link => <Link key={link.label} href={link.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm underline underline-offset-4">{link.label}<ArrowUpRight className="size-3" /></Link>)}</dd><p className="mt-2 text-xs text-muted-foreground">プロジェクトのリンクは、確認するプロジェクトを選んで開きます。</p></div>
            <div><dt className="text-sm font-semibold">バリエーション</dt><dd className="mt-2 text-sm">{entry.variants.map(item => item.label).join('／')}</dd></div>
            <div><dt className="text-sm font-semibold">共通部分と用途上の違い</dt><dd className="mt-2 text-sm leading-relaxed">{entry.scope}</dd></div>
            <div><dt className="text-sm font-semibold">調整すると変わる範囲</dt><dd className="mt-2 text-sm leading-relaxed">{entry.impact}</dd></div>
          </dl>
          <div className="rounded-xl border p-4"><h3 className="text-sm font-semibold">照合の状態</h3>{!current && <HelpText>この追加見本の利用先情報は生成待ちです。0箇所と確定した意味ではありません。</HelpText>}<p className="mt-2 text-sm">コード上の直接利用 {current?.direct.length ?? 0}箇所／間接利用 {current?.indirect.length ?? 0}箇所／関連ルート {current?.routes.length ?? 0}件</p><HelpText className="mt-1">静的な参照を追跡しています。すべての表示条件を実画面で確認したという意味ではありません。</HelpText>
            <ul className="mt-3 space-y-1 text-sm">{checks.length ? checks.map((check, index) => <li key={index}>確認済み：{check.where} — {check.result}</li>) : <li>この部品版に一致する実画面の確認記録はまだありません。</li>}</ul>
            <details className="mt-3 text-xs"><summary className="cursor-pointer">利用先とAI向けの参照情報</summary><div className="mt-3 space-y-3 break-all"><p>正本：{catalog.canonical}</p><p>参照する実装・見本：{entry.sources.join('、')}</p><p>直接利用：{current?.direct.join('、') || 'なし'}</p><p>間接利用：{current?.indirect.join('、') || 'なし'}</p><p>関連ルート：{current?.routes.join('、') || 'なし'}</p>{usageData.limits.map(limit => <p key={limit}>{limit}</p>)}<p>採用基準版：{catalog.revision}／見本資料版：{catalog.guideRevision}／この作業環境に適用。別の作業ツリーは取り込み後の照合が通るまで未反映として扱います。</p></div></details>
          </div>
        </section>
      </div>
      <details className="border-t pt-4 text-sm"><summary className="cursor-pointer font-medium">残る独自実装・未確認</summary><div className="mt-3 space-y-2"><p>カンバン、ガント、カレンダーの専用配置や、詳細内の一部編集操作は、今回の共通の画面の型へ一律には変更していません。</p>{verification.remaining.map(item => <p key={item}>{item}</p>)}<p>既存の独自指定が残るファイル：{usageData.independent.length}件。登録されていない新しい文字・余白・色の指定は検証で検出します。</p><details><summary className="cursor-pointer text-xs">独自指定の多い利用先（AIの移行確認用）</summary><ul className="mt-2 space-y-1 break-all text-xs">{usageData.independent.slice(0,20).map(item => <li key={item.file}>{item.file}（{item.count}指定）</li>)}</ul></details></div></details>
    </div>
  </main>;
}
