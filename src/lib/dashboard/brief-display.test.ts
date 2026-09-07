import { describe, expect, it } from 'vitest';
import { filterStaleProjects } from './brief-display';
import { buildTaskFlowBrief, type DashboardBriefRow, type DashboardTask } from './brief';
import { viewTask } from '@/test/taskViewFixtures';

const stale: DashboardBriefRow = { label: '3日動いていない', tone: 'amber', total: 4,
  items: ['a', 'a', 'a', 'b'].map((projectId, index) => ({ source: 'TF', projectId, title: `task-${index}` })) };
describe('filterStaleProjects', () => {
  it('filters before the three-item preview and updates the count without mutating its input', () => {
    const result = filterStaleProjects(stale, ['a']);
    expect(result.total).toBe(1);
    expect(result.items[0].title).toBe('task-3');
    expect(stale.total).toBe(4);
    expect(stale.items).toHaveLength(4);
  });
  it('leaves other rows and unknown/sample project IDs unchanged', () => {
    for (const label of ['今日やる', '返信待ち・重要', '今日の予定']) {
      const row = { ...stale, label };
      expect(filterStaleProjects(row, ['a'])).toBe(row);
    }
    expect(filterStaleProjects(stale, [])).toBe(stale);
    expect(filterStaleProjects(stale, ['unknown'])).toBe(stale);
    const sample = { ...stale, items: [{ source: 'TF' as const, title: 'sample' }] };
    expect(filterStaleProjects(sample, ['a'])).toBe(sample);
  });
  it('shows an actionable empty state when every source item is excluded', () => {
    const result = filterStaleProjects(stale, ['a', 'b']);
    expect(result.total).toBe(0);
    expect(result.items).toEqual([{ source: 'TF', title: '表示中の停止タスクはありません', meta: '表示設定から対象プロジェクトを戻せます' }]);
  });
  it('receives the real project ID from the brief builder, independent of project names', () => {
    const task: DashboardTask = {
      ...viewTask({ id: 'task', projectId: 'real-project', title: '作業', updatedAt: new Date(2026, 7, 1) }),
      projectName: '改名できる名前',
    };
    const row = buildTaskFlowBrief([], [task], [], new Date(2026, 8, 3)).rows.find((row) => row.label === '3日動いていない')!;
    expect(row.items[0].projectId).toBe('real-project');
    expect(filterStaleProjects(row, ['real-project']).total).toBe(0);
  });
});
