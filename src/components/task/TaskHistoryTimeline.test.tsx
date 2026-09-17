import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskHistoryTimeline } from './TaskHistoryTimeline';
import type { TaskHistoryPage } from '@/lib/task/history/types';
const mock = vi.hoisted(() => ({ page: null as TaskHistoryPage | null, error: null as string | null, busy: false, more: vi.fn(), refresh: vi.fn(), source: vi.fn() }));
vi.mock('@/lib/task/organizationClient', () => ({ requestOrganization: mock.source }));
vi.mock('@/hooks/useTaskHistory', () => ({ useTaskHistory: () => mock }));
const props = { projectId: 'p', taskId: 't', userId: 'u', comments: [], names: {}, enabled: true, commentStatus: 'ready' as const };
beforeEach(() => { mock.error = null; mock.busy = false; mock.page = { entries: [], nextCursor: null, activityStatus: 'ready', issues: [], checkedAt: '2026-09-12T00:00:00Z' }; });
describe('task provenance timeline', () => {
  it('initially shows the newest five and fetches older targeted activity on demand', () => {
    mock.page!.entries = Array.from({ length: 7 }, (_, i) => ({ id: String(i), kind: 'activity', title: `変更${i}`, text: '', actor: '梢', private: false, at: `2026-09-${String(i + 1).padStart(2, '0')}T00:00:00Z` }));
    mock.page!.nextCursor = 'older'; render(<TaskHistoryTimeline {...props} />);
    expect(screen.queryByText('変更0')).not.toBeInTheDocument();
    const list = screen.getByRole('list'); expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: '取得済みの経緯を展開（7件）' }));
    expect(screen.getByText('変更0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'さらに古い変更を取得' })); expect(mock.more).toHaveBeenCalled();
  });
  it('does not label failures as no history', () => {
    mock.error = '経緯を取得できません'; render(<TaskHistoryTimeline {...props} commentStatus="error" />);
    expect(screen.queryByText('取得できた共有の経緯はまだありません。')).not.toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(2);
  });
  it('requires an explicit personal-source expansion and keeps source time separate from linkage time', () => {
    mock.page!.privateSources = { entries: [{ id: 'm', kind: 'gmail', title: '注文内容', text: '本人だけの本文', actor: '販売店', at: '2026-09-01T00:00:00Z', recordedAt: '2026-09-12T00:00:00Z', private: true, url: 'javascript:alert(1)' }], status: 'partial', issues: ['取得範囲の一部です'], unavailableLinks: 1 };
    render(<TaskHistoryTimeline {...props} />);
    expect(screen.queryByText('本人だけの本文')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '本人用のメール・Chat（1件）を見る' }));
    expect(screen.getByText('本人だけの本文')).toBeInTheDocument();
    expect(screen.getByText(/メール 2026\/9\/1/)).toBeInTheDocument(); expect(screen.getByText(/関連付け 2026\/9\/12/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '原文を開く' })).not.toBeInTheDocument();
  });
  it('opens the original meeting through its importer-only source record without changing event time', async () => {
    mock.page!.entries = [{ id: 'meeting', kind: 'meeting', title: '会議', text: '引用', actor: '本人', at: '2026-09-01T00:00:00Z', recordedAt: '2026-09-12T00:00:00Z', private: false, sourceRef: { ownerId: 'u', operationId: 'op1' } }];
    mock.source.mockResolvedValue({ kind: 'meeting', id: 'original', title: '会議元資料', text: '引用以外も含む元の議事録', occurredAt: '2026-09-01T00:00:00Z' });
    const { rerender } = render(<TaskHistoryTimeline {...props} />);
    expect(screen.queryByText('引用以外も含む元の議事録')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '会議原文を開く（取り込んだ本人用）' }));
    await waitFor(() => expect(screen.getByText('引用以外も含む元の議事録')).toBeInTheDocument());
    expect(mock.source).toHaveBeenCalledWith({ action: 'source', projectId: 'p', id: 'op1' });
    rerender(<TaskHistoryTimeline {...props} userId="different-member" />);
    expect(screen.queryByText('引用以外も含む元の議事録')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /会議原文を開く/ })).not.toBeInTheDocument();
  });

});
