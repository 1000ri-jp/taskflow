'use client';

import { useId, useState } from 'react';
import { SECRETARY_REFRESH_OPTIONS, useSecretaryRefreshSettings } from '@/hooks/useSecretaryRefreshSettings';

export function SecretaryRefreshSettings({ userId }: { userId: string }) {
  const { refreshMinutes, setRefreshMinutes } = useSecretaryRefreshSettings(userId);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  return <div className="space-y-2 text-sm">
    <div className="flex flex-wrap items-center gap-3">
      <label htmlFor={id} className="font-medium">実データの自動取得</label>
      <select id={id} value={refreshMinutes} onChange={event => {
        try { setRefreshMinutes(Number(event.target.value)); setError(null); }
        catch { setError('このブラウザに設定を保存できませんでした。'); }
      }} className="rounded-md border border-stone-300 bg-white px-3 py-2 text-stone-900">
        {SECRETARY_REFRESH_OPTIONS.map(option => <option key={option.minutes} value={option.minutes}>{option.label}</option>)}
      </select>
    </div>
    <p className="text-xs text-muted-foreground">初期値は1時間。このブラウザに、アカウントごとに保存します。</p>
    <p className="text-xs text-muted-foreground">AI整理の材料・接続したGoogleの情報・共通カウントダウンを、選んだ間隔で取得します。「手動のみ」でも初回は取得します。必要なときは「情報を更新」やカウントダウンの更新ボタンを使えます。</p>
    {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
  </div>;
}
