'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useGoogleWorkspace } from '@/hooks/useGoogleWorkspace';
import { MAX_UPCOMING_DAYS } from '@/lib/dashboard/upcoming-range';
import { useAuthStore } from '@/stores/authStore';
import { SecretaryRefreshSettings } from '@/components/secretary/SecretaryRefreshSettings';
import { GOOGLE_SERVICES, MAX_GOOGLE_SELECTIONS, SERVICE_LABELS, type GoogleSelection, type GoogleService, type GoogleSource } from '@/lib/google/workspace/types';

const descriptions: Record<GoogleService, string> = {
  calendar: `選んだ最大5カレンダーの今日から${MAX_UPCOMING_DAYS}日先まで・合計最大100件。AI整理では予定と作業時間を考える参考にします。`,
  gmail: '選んだ最大5ラベルの直近7日・各20件。いずれかのラベルにあるメールを重複なく表示します。添付は取得しません。',
  chat: '選んだ最大5スペースの直近7日・各20件。本文を表示します。個別DMは対象に含みません。',
};
export function googleStatus(source: GoogleSource) {
  if (!source.connected) return '未接続';
  if (source.status === 'selection_required') return '取得対象を選択';
  if (source.status === 'error') return source.fetchedAt ? '更新に失敗・前回の情報' : '取得できませんでした';
  if (source.status === 'pending') return '接続済み・取得待ち';
  return `${source.items.length}件${source.status === 'partial' ? '・一部取得' : '取得済み'}`;
}
function SourceItems({ source }: { source: GoogleSource }) {
  return <>
    {source.fetchedAt && <p className="text-xs text-muted-foreground">最終取得：{new Date(source.fetchedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}（日本時間）</p>}
    {source.error && <p className="text-sm text-amber-800">{source.error}</p>}
    {source.status === 'ready' && !source.items.length && <p className="text-sm text-muted-foreground">今回の取得範囲に情報はありません。</p>}
    {!!source.items.length && <details className="text-sm"><summary className="cursor-pointer">取得した情報を確認（{source.items.length}件）</summary>
      <ul className="mt-3 max-h-96 space-y-3 overflow-auto">{source.items.map(item => <li key={item.id} className="rounded-lg border p-3">
        <a href={item.url} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2">{item.title}</a>
        <p className="text-xs text-muted-foreground">{item.sourceName} · {new Date(item.at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}{item.allDay ? '（終日）' : ''}</p>
        {item.text && <p className="mt-1 whitespace-pre-wrap break-words">{item.text}</p>}
      </li>)}</ul>
    </details>}
  </>;
}
function collapsedGoogleStatus(source: GoogleSource) {
  if (!source.connected) return '未接続';
  if (source.status === 'selection_required') return '取得対象が未選択';
  if (source.status === 'error') return source.fetchedAt ? '更新失敗・前回の情報' : '取得エラー';
  if (source.status === 'partial') return '一部取得';
  if (source.status === 'pending' || !source.fetchedAt) return '未取得';
  return null;
}
export function GoogleWorkspaceSummary({ collapsible = false, children, extraStatus }: { collapsible?: boolean; children?: ReactNode; extraStatus?: ReactNode }) {
  const google = useGoogleWorkspace();
  const content = <>
    <div className="flex flex-wrap items-center justify-between gap-2"><Link href="/settings/google" className="font-medium underline underline-offset-4">Google連携</Link>
      <Button size="sm" variant="outline" disabled={google.busy} onClick={google.refresh}>{google.busy ? '確認中…' : 'Googleの情報を更新'}</Button></div>
    {google.error && <p className="mt-2 text-red-700" role="alert">{google.error}</p>}
    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-muted-foreground">{GOOGLE_SERVICES.map(s => <span key={s}>{SERVICE_LABELS[s]}：{google.data ? googleStatus(google.data.sources[s]) : google.loading ? '確認中' : '未確認'}</span>)}</div>
    <p className="mt-2 text-xs text-muted-foreground">自動取得：{google.refreshMinutes ? `${google.refreshMinutes}分ごと` : '手動のみ'}。次の「整理」で、予定とメール・Chatの確認候補に反映します。</p>
    {!collapsible && extraStatus && <p role="status" className="mt-2 text-xs text-muted-foreground">{extraStatus}</p>}
    {children && <div className="mt-3 space-y-3 border-t pt-3">{children}</div>}
  </>;
  if (!collapsible) return <div className="rounded-xl border bg-white p-4 text-sm" aria-label="Google連携の取得状況">{content}</div>;
  const status = google.error ? '取得エラー' : google.loading ? '確認中' : !google.data ? '未確認' : [
    google.busy ? '更新中' : null,
    !google.data.configured ? '連携準備中' : null,
    ...new Set(GOOGLE_SERVICES.map(service => collapsedGoogleStatus(google.data!.sources[service])).filter(Boolean)),
  ].filter(Boolean).join(' ／ ');
  return <details className="rounded-xl border bg-white px-3 py-2 text-sm" aria-label="Google連携の取得状況">
    <summary className="cursor-pointer text-xs text-muted-foreground"><span>Google連携・取得状況</span>{extraStatus && <span className="ml-2 break-words text-stone-600">{extraStatus}</span>}{status && <span className="ml-2 break-words text-amber-800">{status}</span>}</summary>
    <div className="mt-3">{content}</div>
  </details>;
}
export function GoogleInboxSource({ service }: { service: 'gmail' | 'chat' }) {
  const google = useGoogleWorkspace(); const source = google.data?.sources[service];
  return <div className="space-y-2 text-sm">
    <p>{google.error ?? (source ? googleStatus(source) : '接続を確認中…')} · <Link href="/settings/google" className="underline">Google連携設定</Link></p>
    {source && <SourceItems source={source} />}
  </div>;
}
const oauthErrors: Record<string, string> = {
  CANCELLED: '接続はキャンセルされました。既存の接続は保持しています。',
  SCOPE_MISSING: '必要な読み取り権限が選択されていません。もう一度接続して、権限のチェックを確認してください。',
  ACCOUNT_MISMATCH: 'TaskFlowと同じ会社のGoogleアカウントを選んでください。',
  INVALID_STATE: '接続操作の期限が切れました。もう一度接続してください。',
};
export function GoogleWorkspaceSettings() {
  const google = useGoogleWorkspace(); const params = useSearchParams();
  const uid = useAuthStore(s => s.user?.id);
  const [choices, setChoices] = useState<{ service: GoogleService; values: GoogleSelection[]; partial: boolean } | null>(null);
  const [selected, setSelected] = useState<string[]>([]); const [selectionError, setSelectionError] = useState<string | null>(null); const [choosing, setChoosing] = useState(false);
  async function openChoices(service: GoogleService) {
    setChoosing(true); setSelectionError(null);
    try {
      const result = await google.request<{ choices: GoogleSelection[]; partial: boolean }>(`/api/google?choices=${service}`);
      setChoices({ service, values: result.choices, partial: result.partial });
      const saved = service === 'calendar' ? google.data?.selectedCalendars : service === 'gmail' ? google.data?.gmailLabels : google.data?.selectedSpaces;
      setSelected(saved?.map(s => s.id) ?? []);
    } catch (e) { setSelectionError(e instanceof Error ? e.message : '一覧を取得できませんでした。'); }
    finally { setChoosing(false); }
  }
  return <div className="mx-auto max-w-3xl space-y-5">
    <Link href="/neo" className="text-sm underline">Neoに戻る</Link>
    <div><h1 className="text-2xl font-bold">Google連携</h1><p className="mt-2 text-sm text-muted-foreground">会社のGoogleアカウントで、必要なサービスを読み取り接続します。接続はページを閉じても維持されます。</p></div>
    {params.has('connected') && <p role="status" className="rounded-lg bg-green-50 p-3 text-green-900">Googleとの接続を保存しました。取得状況を確認しています。</p>}
    {params.has('google_error') && <p role="alert" className="rounded-lg bg-amber-50 p-3">{oauthErrors[params.get('google_error') ?? ''] ?? 'Googleに接続できませんでした。時間を置いて、もう一度接続してください。'}</p>}
    {google.error && <p role="alert" className="text-red-700">{google.error}</p>}
    {google.data && !google.data.configured && <p className="rounded-lg bg-amber-50 p-3 text-sm">Google連携のサーバー設定を準備中です。設定が完了すると、ここから接続できます。</p>}
    {google.data?.email && <p className="text-sm">接続アカウント：{google.data.email}</p>}
    <Button variant="outline" disabled={google.busy || !google.data?.configured} onClick={google.refresh}>{google.busy ? '確認中…' : 'Googleの情報を更新'}</Button>
    {GOOGLE_SERVICES.map(service => {
      const source = google.data?.sources[service];
      return <Card key={service} density="compact"><CardHeader><CardTitle className="flex flex-wrap justify-between gap-2">{SERVICE_LABELS[service]}<span className="text-sm font-normal text-muted-foreground">{source ? googleStatus(source) : '確認中…'}</span></CardTitle></CardHeader>
        <CardContent className="space-y-3"><p className="text-sm text-muted-foreground">{descriptions[service]}</p>
          {service === 'calendar' && <p className="text-sm">取得カレンダー：{google.data?.selectedCalendars.map(s => s.name).join('、') || '未選択'}</p>}
          {service === 'gmail' && <p className="text-sm">取得ラベル：{google.data?.gmailLabels.map(s => s.name).join('、') || '未選択'}</p>}
          {service === 'chat' && <p className="text-sm">取得スペース：{google.data?.selectedSpaces.map(s => s.name).join('、') || '未選択'}</p>}
          <div className="flex flex-wrap gap-2"><Button size="sm" disabled={google.busy || !google.data?.configured} onClick={() => google.connect(service)}>{source?.connected ? '再接続' : `${SERVICE_LABELS[service]}を接続`}</Button>
            {source?.connected && <Button size="sm" variant="outline" disabled={google.busy || choosing} onClick={() => service === 'calendar' && !google.data?.calendarSelectionAvailable ? google.connect('calendar') : openChoices(service)}>取得対象を選ぶ</Button>}
            {source?.connected && <Button size="sm" variant="ghost" disabled={google.busy} onClick={() => google.disconnect(service)}>このサービスの連携を解除</Button>}
          </div>
          {service === 'calendar' && source?.connected && !google.data?.calendarSelectionAvailable && <p className="text-xs text-muted-foreground">一覧の表示には、初回だけカレンダーの再接続が必要です。「取得対象を選ぶ」から閲覧を許可してください。</p>}
          {source && <SourceItems source={source} />}
          {choices?.service === service && <fieldset className="space-y-3 rounded-lg border p-3"><legend>取得対象</legend>
            <p className="text-sm text-muted-foreground">複数選択できます（{selected.length} / {MAX_GOOGLE_SELECTIONS}）。すべて外すと、このサービスの取得を停止します。</p>
            {choices.partial && <p className="text-sm text-amber-800">選択肢は取得上限までを表示しています。</p>}
            {selected.some(id => !choices.values.some(choice => choice.id === id)) && <p className="text-sm text-amber-800">一覧にない保存済みの対象は、チェックを外してから保存してください。</p>}
            {!choices.values.length && <p className="text-sm">選択できる対象がありません。</p>}
            <div className="max-h-64 space-y-2 overflow-auto">{[...choices.values, ...selected.filter(id => !choices.values.some(c => c.id === id)).map(id => ({ id, name: `${id}（一覧にない保存済み対象）` }))].map(choice => <label key={choice.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name={`google-${service}-selection`} checked={selected.includes(choice.id)}
                disabled={google.busy || (selected.length >= MAX_GOOGLE_SELECTIONS && !selected.includes(choice.id))}
                onChange={e => setSelected(e.target.checked ? [...selected, choice.id] : selected.filter(id => id !== choice.id))} />{choice.name}</label>)}</div>
            <div className="flex gap-2"><Button size="sm" disabled={google.busy} onClick={async () => { if (await google.select(choices.service, selected)) setChoices(null); }}>この範囲を保存</Button>
              <Button size="sm" variant="ghost" disabled={google.busy} onClick={() => setChoices(null)}>キャンセル</Button></div>
          </fieldset>}
        </CardContent></Card>;
    })}
    {selectionError && <p role="alert" className="text-red-700">{selectionError}</p>}
    <Card density="compact"><CardHeader><CardTitle>取得間隔</CardTitle></CardHeader><CardContent>{uid && <SecretaryRefreshSettings userId={uid} />}</CardContent></Card>
    <p className="text-xs text-muted-foreground">カレンダーはAI整理の参考に使います。選んだGmail・Chatの抜粋から、マイ画面に依頼・返信・期限の確認候補を出します。タスク登録や送信は行いません。Google側の許可も取り消す場合はGoogleアカウントの接続設定から操作できます。</p>
  </div>;
}
