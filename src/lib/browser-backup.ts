// Explicit application data only. Never enumerate storage or export auth/AI settings.
export const BACKUP_KEYS = [
  ['taskflow.boardDisplay.v1', 'ボードの表示項目'],
  ['taskflow.boardSort.v1', 'プロジェクト別の並び順'],
  ['taskflow.projectTaskView.v1', 'ユーザー・プロジェクト別のビュー'],
  ['taskflow.inboxDisplay.v1', '受信箱の表示項目'],
  ['taskflow.staleProjectDisplay.v1', '動いていないタスクから除外するプロジェクト'],
  ['taskflow.targetProjects.v1', '今月の的に表示するプロジェクト'],
  ['taskflow.targetTasks.v1', '旧版：手動選択した今月の的'],
  ['taskflow.targetGoals.v1', '達成目標・人数枠・紐づけタスク'],
  ['taskflow.upcomingRange.v1', '直近の表示期間（3日／5日）'],
  ['taskflow.meetLinks.v2', 'Meetリンクの名称・URL'],
  ['taskflow.meetLink.v1', '旧版：Meetリンク'],
  ['taskflow.autoArchivePreview.v1', '自動アーカイブの期間（テスト設定）'],
  ['taskflow.checklistAssignees.local.v1', 'チェックリスト項目の担当者（テスト）'],
  ['taskflow.meetingProposalReview.v2', '朝会提案の採用・保留・修正・登録先候補'],
  ['taskflow.meetingProposalReview.v1', '旧版：朝会提案の確認結果'],
  ['taskflow.meetingChecklistDraft.v1', '朝会の子タスク配置・完了チェック・期限（テスト）'],
  ['taskflow.testCountdown.v1', 'カウントダウン対象タスク（テスト）'],
  ['companionAIPanelOpen', 'AIパネルの開閉'],
  ['companionAIPanelPosition', 'AIパネルの位置'],
  ['companionAIPanelSize', 'AIパネルのサイズ'],
] as const;

export const BACKUP_EXCLUSIONS = [
  'ログイン情報、APIキー、AI設定、Cookie、Firebaseキャッシュは読み取りません。',
  '共有のプロジェクト・タスク・コメント・チェックリスト本体は含みません。',
  '投稿再試行用の一時記録、未送信フォーム、挨拶済みフラグは含みません。',
  '同じブラウザの同じURL（ホスト名・ポート）の保存内容です。別ポート・別ブラウザは含みません。',
  '同じURLで使用した別ユーザーの設定が含まれる場合があります。外部共有しないでください。',
  '復元機能は未実装です。旧版も記録用に保持し、自動移行・共有登録はしません。',
];

export type BackupStatus = 'saved' | 'missing' | 'invalid-json' | 'read-error' | 'excluded-sensitive';
export interface BackupEntry { key: string; label: string; status: BackupStatus; summary: string; raw?: string }
export interface BrowserBackup {
  format: 'taskflow-browser-backup';
  version: 1;
  exportedAt: string;
  origin: string;
  exclusions: string[];
  entries: BackupEntry[];
}
export const BACKUP_STATUS_LABELS: Record<BackupStatus, string> = {
  saved: '保存あり', missing: '保存なし', 'invalid-json': '形式不明・原文を保持',
  'read-error': '読み取り失敗', 'excluded-sensitive': '機密情報の可能性・内容を除外',
};

// Additional conservative guard for free-form drafts, not a complete secret scanner.
function sensitive(value: unknown): boolean {
  if (typeof value === 'string') return /(?:password|passwd|pwd|パスワード|暗証番号|api[_ -]?key|access[_ -]?token|secret)\s*["']?\s*[:=：]\s*\S+|Bearer\s+\S+|-----BEGIN[\s\S]*PRIVATE KEY-----|\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{8,}|https?:\/\/[^\s/@:]+:[^\s/@]+@/i.test(value);
  if (Array.isArray(value)) return value.some(sensitive);
  if (value && typeof value === 'object') return Object.entries(value).some(([key, item]) =>
    (/^(?:password|passwd|pwd|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|secret|パスワード)$/i.test(key) && item != null && item !== '') || sensitive(item));
  return false;
}
function summarize(value: unknown): string {
  if (value === null) return 'null を保存';
  if (Array.isArray(value)) return `${value.length}件`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const counts = ['reviews', 'placements', 'items'].flatMap(key => {
      const child = record[key];
      const labels: Record<string, string> = { reviews: '確認結果', placements: '配置', items: 'チェック項目' };
      return child && typeof child === 'object' ? [`${labels[key]} ${Object.keys(child).length}件`] : [];
    });
    return counts.length ? counts.join('、') : `${Object.keys(record).length}項目`;
  }
  return String(value);
}

export function collectBrowserBackup(read: (key: string) => string | null, origin: string, now = new Date()): BrowserBackup {
  const entries = BACKUP_KEYS.map(([key, label]): BackupEntry => {
    let raw: string | null;
    try { raw = read(key); } catch { return { key, label, status: 'read-error', summary: '保存領域を読み取れませんでした。内容は含まれていません。' }; }
    if (raw === null) return { key, label, status: 'missing', summary: '未保存（画面の既定値とは区別しています）' };
    let value: unknown;
    let valid = true;
    try { value = JSON.parse(raw); } catch { value = raw; valid = false; }
    if (sensitive(value)) return { key, label, status: 'excluded-sensitive', summary: '機密情報らしい記述があるため、この項目の値は出力していません。' };
    return { key, label, status: valid ? 'saved' : 'invalid-json', summary: valid ? summarize(value) : 'JSONとして読めない保存値です。自動修復せず原文を記録します。', raw };
  });
  return { format: 'taskflow-browser-backup', version: 1, exportedAt: now.toISOString(), origin, exclusions: [...BACKUP_EXCLUSIONS], entries };
}

export function backupMarkdown(backup: BrowserBackup): string {
  const included = backup.entries.filter(e => e.raw !== undefined);
  const lines = ['# TaskFlow ブラウザ保存データ', '', `取得日時：${backup.exportedAt}`, `保存元：${backup.origin}`, '',
    `出力した保存項目：${included.length}件／確認した種類：${backup.entries.length}種類`, '',
    'これは設定・下書きの記録です。共有タスクのバックアップではありません。元の保存内容は変更していません。', '',
    '## 対象と注意事項', '', ...backup.exclusions.map(v => `- ${v}`), '',
    '## 保存状況', '', ...backup.entries.map(e => `- ${e.label}：${BACKUP_STATUS_LABELS[e.status]} — ${e.summary}`), '', '## 保存値', ''];
  for (const entry of included) {
    let text = entry.raw!;
    try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* Preserve unknown format. */ }
    // A longer fence preserves any Markdown supplied in a draft as data.
    const fence = '`'.repeat(Math.max(3, ...Array.from(text.matchAll(/`+/g), m => m[0].length + 1)));
    lines.push(`### ${entry.label}`, '', `保存キー：${entry.key}`, '', fence + (entry.status === 'saved' ? 'json' : 'text'), text, fence, '');
  }
  return lines.join('\n');
}
