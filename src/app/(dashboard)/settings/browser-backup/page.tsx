'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { BACKUP_EXCLUSIONS, BACKUP_STATUS_LABELS, backupMarkdown, collectBrowserBackup, type BrowserBackup } from '@/lib/browser-backup';

export default function BrowserBackupPage() {
  const [backup, setBackup] = useState<BrowserBackup | null>(null);
  const [error, setError] = useState('');
  function generate() {
    setError('');
    setBackup(collectBrowserBackup(key => window.localStorage.getItem(key), window.location.origin));
  }
  function download(kind: 'json' | 'md') {
    if (!backup) return;
    try {
      const content = kind === 'json' ? JSON.stringify(backup, null, 2) : backupMarkdown(backup);
      const url = URL.createObjectURL(new Blob([content], { type: kind === 'json' ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `taskflow-browser-backup-${backup.exportedAt.replace(/[:.]/g, '-')}.${kind}`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError('ダウンロードできませんでした。下のプレビューから内容をコピーできます。'); }
  }
  const warnings = backup?.entries.filter(e => ['read-error', 'excluded-sensitive', 'invalid-json'].includes(e.status)) ?? [];
  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 pb-8">
      <Link href="/settings" className="text-sm text-muted-foreground hover:underline">← 設定に戻る</Link>
      <h1 className="text-2xl font-bold">ブラウザ保存データの書き出し</h1>
      <p className="text-sm">このブラウザだけに保存している表示設定・Meetリンク・朝会下書き・テスト設定を、JSONと読みやすい一覧で保存できます。</p>
      <div className="rounded-lg border bg-muted/30 p-4 text-sm">
        <p className="font-medium">元の保存内容は変更しません。サーバーへの送信も行いません。</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">{BACKUP_EXCLUSIONS.map(note => <li key={note}>{note}</li>)}</ul>
      </div>
      <Button onClick={generate}>{backup ? '保存内容を再取得' : '保存内容を確認して書き出しを準備'}</Button>
      {backup && <>
        <p role="status" className="text-sm">保存値 {backup.entries.filter(e => e.raw !== undefined).length}件を出力対象にしました。確認対象 {backup.entries.length}種類 ／ 取得 {new Date(backup.exportedAt).toLocaleString('ja-JP')}</p>
        {!!warnings.length && <p role="alert" className="text-sm text-amber-700">注意が必要な項目が {warnings.length}件あります。下の保存状況をご確認ください。読み取り失敗・機密情報の可能性がある項目の内容は含みません。</p>}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => download('json')}>JSONバックアップを保存</Button>
          <Button variant="outline" onClick={() => download('md')}>読みやすい一覧を保存</Button>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="divide-y rounded-lg border">
          {backup.entries.map(entry => <div key={entry.key} className="p-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{entry.label}</span><span className="text-muted-foreground">{BACKUP_STATUS_LABELS[entry.status]}</span></div>
            <p className="mt-1 text-xs text-muted-foreground">{entry.summary}</p>
          </div>)}
        </div>
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm">バックアップJSONを表示</summary>
          <pre role="region" aria-label="バックアップJSON" className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(backup, null, 2)}</pre>
        </details>
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm">読みやすい一覧を表示</summary>
          <pre role="region" aria-label="読みやすい一覧" className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">{backupMarkdown(backup)}</pre>
        </details>
      </>}
    </div>
  );
}
