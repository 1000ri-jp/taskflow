import type { DashboardBriefRow } from './brief';

export function filterStaleProjects(row: DashboardBriefRow, hiddenProjectIds: string[]): DashboardBriefRow {
  if (row.label !== '3日動いていない' || hiddenProjectIds.length === 0) return row;
  const hidden = new Set(hiddenProjectIds);
  const items = row.items.filter((item) => !item.projectId || !hidden.has(item.projectId));
  if (items.length === row.items.length) return row;
  return {
    ...row,
    total: items.length,
    items: items.length ? items : [{ source: 'TF', title: '表示中の停止タスクはありません', meta: '表示設定から対象プロジェクトを戻せます' }],
  };
}
