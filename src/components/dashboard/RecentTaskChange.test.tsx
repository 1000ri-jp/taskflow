import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { HistoryEntry } from '@/lib/task/history/types';
const mock = vi.hoisted(() => ({ result: { status: 'ready', entry: null as HistoryEntry | null } }));
vi.mock('@/hooks/useLatestTaskActivity', () => ({ useLatestTaskActivity: () => mock.result }));
import { RecentTaskChange } from './RecentTaskChange';
const updatedAt = new Date('2026-09-16T00:00:00Z');
beforeEach(() => { mock.result = { status: 'ready', entry: { id: 'edit', kind: 'meeting', title: '会議', text: '', actor: '同僚', at: '2026-09-02T00:00:00Z', recordedAt: updatedAt.toISOString(), private: false, changes: [{ field: 'title', before: '案', after: '確定' }] } }; });
const show = () => render(<RecentTaskChange projectId="p" taskId="t" userId="u" updatedAt={updatedAt} />);
it('shows the actor and change inline and uses adoption time for meeting changes', () => {
  show(); expect(screen.getByText(/同僚/)).toBeVisible(); expect(screen.getByText(/タイトル：案 → 確定/)).toBeVisible(); expect(screen.queryByText(/直近の変更は記録なし/)).not.toBeInTheDocument();
});
it('distinguishes the last recorded change from a newer task edit with no record', () => {
  mock.result.entry!.recordedAt = '2026-09-15T00:00:00Z'; show(); expect(screen.getByText(/直近の変更は記録なし。前回/)).toBeVisible(); expect(screen.getByText(/タイトル：案 → 確定/)).toBeVisible();
});
it.each([['loading', '変更内容を取得中…'], ['error', '変更内容を取得できません'], ['ready', '変更内容の記録なし']])('distinguishes %s from an actual update', (status, text) => {
  mock.result = { status, entry: null }; show(); expect(screen.getByText(text)).toBeVisible();
});
