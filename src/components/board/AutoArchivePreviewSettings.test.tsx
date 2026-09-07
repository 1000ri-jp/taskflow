import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoArchivePreviewSettings } from './AutoArchivePreviewSettings';
import { archivePreviewScope, AUTO_ARCHIVE_PREVIEW_KEY, useAutoArchivePreviewStore as store } from '@/stores/autoArchivePreviewStore';
import { useAuthStore } from '@/stores/authStore';
import { getProjectLists, getProjectTasks, archiveTask, updateTask } from '@/lib/firebase/firestore';
import type { Task } from '@/types';

vi.mock('@/lib/firebase/firestore', () => ({ getProjectTasks: vi.fn(), getProjectLists: vi.fn(), archiveTask: vi.fn(), updateTask: vi.fn() }));
const old = { id: 'old', projectId: 'p', listId: 'l', title: '古い完了タスク', isCompleted: true, isArchived: false, completedAt: new Date('2026-08-01T00:00:00Z') } as Task;
const recent = { ...old, id: 'recent', title: '最近の完了タスク', completedAt: new Date('2026-09-01T00:00:00Z') };
const clients: QueryClient[] = [];
function mount(projectId = 'p') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } }); clients.push(client);
  return render(<QueryClientProvider client={client}><AutoArchivePreviewSettings projectId={projectId} /></QueryClientProvider>);
}
function savePeriod(value: string) {
  fireEvent.change(screen.getByLabelText('完了からの期間'), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'テスト設定を保存' }));
}
describe('auto archive preview settings', () => {
  beforeEach(() => {
    vi.restoreAllMocks(); vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-03T12:00:00Z'));
    localStorage.removeItem(AUTO_ARCHIVE_PREVIEW_KEY);
    store.setState({ byScope: {}, hydrated: false, persistenceFailed: false });
    useAuthStore.setState({ user: { id: 'u' } as NonNullable<ReturnType<typeof useAuthStore.getState>['user']> });
    vi.mocked(getProjectTasks).mockResolvedValue([old, recent, { ...old, id: 'todo', title: '未完了', isCompleted: false }, { ...old, id: 'missing', completedAt: null }]);
    vi.mocked(getProjectLists).mockResolvedValue([{ id: 'l', name: '確認済み' } as Awaited<ReturnType<typeof getProjectLists>>[number]]);
  });
  afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.useRealTimers(); });
  it('defaults to 30 days, persists changes and explicit OFF without shared writes', async () => {
    const view = mount();
    expect(screen.getByLabelText('完了からの期間')).toHaveValue('30');
    expect(await screen.findByRole('link', { name: old.title })).toBeInTheDocument();
    savePeriod('7');
    expect(await screen.findByRole('link', { name: old.title })).toHaveAttribute('href', '/projects/p/board?task=old');
    expect(screen.queryByRole('link', { name: recent.title })).not.toBeInTheDocument();
    expect(screen.getByText('対象 1件 ／ 期間未経過 1件 ／ 完了日不明で除外 1件')).toBeInTheDocument();
    expect(screen.getByText(/確認済み · 完了/)).toBeInTheDocument();
    view.unmount(); store.setState({ byScope: {} }); mount();
    expect(screen.getByLabelText('完了からの期間')).toHaveValue('7');
    savePeriod('off');
    expect(screen.queryByRole('region', { name: 'アーカイブ対象のプレビュー' })).not.toBeInTheDocument();
    expect(archiveTask).not.toHaveBeenCalled(); expect(updateTask).not.toHaveBeenCalled();
  });
  it('validates custom days and saves a per-project custom preview', async () => {
    mount();
    fireEvent.change(screen.getByLabelText('完了からの期間'), { target: { value: 'custom' } });
    const input = screen.getByLabelText('日数（1〜3650）');
    for (const value of ['', '0', '1.5', '3651']) {
      fireEvent.change(input, { target: { value } });
      expect(screen.getByRole('button', { name: 'テスト設定を保存' })).toBeDisabled();
    }
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'テスト設定を保存' }));
    expect(await screen.findByRole('link', { name: recent.title })).toBeInTheDocument();
    expect(store.getState().byScope[archivePreviewScope('u', 'p')]).toBe(2);
    expect(store.getState().byScope[archivePreviewScope('u', 'other')]).toBeUndefined();
  });
  it('shows a fetch failure instead of an empty list and can retry', async () => {
    vi.mocked(getProjectTasks).mockRejectedValue(new Error('permission-denied'));
    mount(); savePeriod('30');
    expect(await screen.findByRole('alert')).toHaveTextContent('タスクを取得できませんでした');
    expect(screen.queryByText('この期間に該当するタスクはありません。')).not.toBeInTheDocument();
    vi.mocked(getProjectTasks).mockResolvedValue([old]);
    fireEvent.click(screen.getByRole('button', { name: 'プレビューを更新' }));
    expect(await screen.findByRole('link', { name: old.title })).toBeInTheDocument();
  });
  it('updates from refreshed data and syncs settings from another tab', async () => {
    mount(); savePeriod('7'); await screen.findByRole('link', { name: old.title });
    vi.mocked(getProjectTasks).mockResolvedValue([{ ...old, isCompleted: false }]);
    fireEvent.click(screen.getByRole('button', { name: 'プレビューを更新' }));
    await waitFor(() => expect(screen.queryByRole('link', { name: old.title })).not.toBeInTheDocument());
    localStorage.setItem(AUTO_ARCHIVE_PREVIEW_KEY, JSON.stringify({ [archivePreviewScope('u', 'p')]: null }));
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: AUTO_ARCHIVE_PREVIEW_KEY })); });
    expect(screen.getByLabelText('完了からの期間')).toHaveValue('off');
  });
  it('warns if local persistence fails and does not enable shared writes', async () => {
    mount(); vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    savePeriod('7');
    expect(screen.getByRole('alert')).toHaveTextContent('ブラウザに保存できません');
    await screen.findByRole('link', { name: old.title });
    expect(archiveTask).not.toHaveBeenCalled(); expect(updateTask).not.toHaveBeenCalled();
  });
});
