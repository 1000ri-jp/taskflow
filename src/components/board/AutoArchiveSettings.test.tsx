import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoArchiveSettings } from './AutoArchiveSettings';
import { readAutoArchive, saveAutoArchive } from '@/lib/board/autoArchiveClient';
import type { AutoArchiveView } from '@/lib/board/autoArchiveTypes';

const auth = vi.hoisted(() => ({ user: { id: 'u' } as { id: string } | null }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: (selector: (state: typeof auth) => unknown) => selector(auth) }));
vi.mock('@/lib/board/autoArchiveClient', () => ({ readAutoArchive: vi.fn(), saveAutoArchive: vi.fn() }));
const legacyKey = 'taskflow.autoArchivePreview.v1';
const view = (changes: Partial<AutoArchiveView> = {}): AutoArchiveView => ({
  projectId: null, revision: 'r1', mode: 'custom', days: null, defaultDays: null, effectiveDays: null, configured: false,
  canEdit: true, scopeLabel: '自分が所有するプロジェクト共通', backgroundConfigured: false, asOf: '2026-09-12T00:00:00Z',
  preview: null, lastRun: null, ...changes,
});
const projectView = (changes: Partial<AutoArchiveView> = {}) => view({ projectId: 'p', mode: 'inherit', defaultDays: 30, effectiveDays: 30, configured: true,
  scopeLabel: 'プロジェクトの自動アーカイブ', preview: { candidates: [{ id: 'task/a', title: '完了した原稿', listName: '確認済み', completedAt: '2026-08-01T00:00:00Z', elapsedDays: 42 }],
    waitingCount: 2, missingDateCount: 1, protectedCount: 3, restoredCount: 4 }, ...changes });
const clients: QueryClient[] = [];
function mount(projectId?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); clients.push(client);
  const renderScope = (id?: string) => <QueryClientProvider client={client}><AutoArchiveSettings projectId={id} /></QueryClientProvider>;
  return { ...render(renderScope(projectId)), renderScope };
}
async function ready() { await waitFor(() => expect(screen.getAllByRole('combobox')[0]).toBeEnabled()); }
function choose(period: string) { fireEvent.change(screen.getByLabelText('完了からの期間'), { target: { value: period } }); }
beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); auth.user = { id: 'u' }; vi.mocked(readAutoArchive).mockResolvedValue(view()); });
afterEach(() => { clients.splice(0).forEach(client => client.clear()); });

describe('AutoArchiveSettings server policy', () => {
  it('starts unconfigured at 30 days with effective OFF and ignores the old browser-only preview', async () => {
    const legacy = JSON.stringify({ '["u","p"]': 7 }); localStorage.setItem(legacyKey, legacy);
    mount(); await ready();
    expect(readAutoArchive).toHaveBeenCalledExactlyOnceWith(null);
    expect(screen.getByLabelText('完了からの期間')).toHaveValue('30');
    expect(screen.getByText('停止中：自動アーカイブしません')).toBeVisible();
    expect(screen.getByText(/保存するまで自動アーカイブはOFF/)).toBeVisible();
    expect(screen.getByText(/保存すると、対象タスクのアーカイブを開始/)).toBeVisible();
    expect(screen.getByText(/次に開いた時に未実施分を1回確認/)).toBeVisible();
    expect(screen.queryByText('自分が所有するプロジェクト共通の日数です。各プロジェクトで上書きできます。')).not.toBeInTheDocument();
    expect(saveAutoArchive).not.toHaveBeenCalled();
    expect(localStorage.getItem(legacyKey)).toBe(legacy);
  });

  it('saves a default only on request, prevents duplicate submits, and displays the confirmed result', async () => {
    let finish!: (result: AutoArchiveView) => void;
    vi.mocked(saveAutoArchive).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    mount(); await ready(); choose('7');
    expect(screen.getByText('未保存')).toBeVisible();
    const save = screen.getByRole('button', { name: '保存' });
    fireEvent.click(save); fireEvent.click(save);
    await waitFor(() => expect(saveAutoArchive).toHaveBeenCalledExactlyOnceWith({ projectId: null, revision: 'r1', mode: 'custom', days: 7 }));
    expect(save).toBeDisabled();
    expect(screen.getByText('停止中：自動アーカイブしません')).toBeVisible();
    act(() => window.dispatchEvent(new Event('taskflow-auto-archive-updated')));
    expect(readAutoArchive).toHaveBeenCalledTimes(1);
    vi.mocked(readAutoArchive).mockResolvedValue(view({ revision: 'r2', configured: true, days: 7, defaultDays: 7, effectiveDays: 7 }));
    await act(async () => finish(view({ revision: 'r2', configured: true, days: 7, defaultDays: 7, effectiveDays: 7 })));
    await waitFor(() => expect(readAutoArchive).toHaveBeenCalledTimes(2));
    expect(screen.getByText('適用中：完了から7日後にアーカイブ')).toBeVisible();
    expect(screen.getByText('自動アーカイブ設定を保存しました。')).toBeVisible();
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    expect(screen.queryByText('未保存')).not.toBeInTheDocument();
    expect(localStorage.getItem(legacyKey)).toBeNull();
  });

  it('preserves explicit OFF from the server and validates custom day bounds before saving', async () => {
    vi.mocked(readAutoArchive).mockResolvedValue(view({ configured: true }));
    vi.mocked(saveAutoArchive).mockResolvedValue(view({ configured: true, revision: 'r2' }));
    mount(); await ready();
    expect(screen.getByLabelText('完了からの期間')).toHaveValue('off');
    choose('custom');
    const input = screen.getByLabelText('日数（1〜3650）');
    for (const value of ['', '0', '1.5', '3651']) {
      fireEvent.change(input, { target: { value } });
      expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    }
    expect(saveAutoArchive).not.toHaveBeenCalled();
    choose('off');
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    expect(screen.queryByText('未保存')).not.toBeInTheDocument();
    expect(saveAutoArchive).not.toHaveBeenCalled();
  });

  it('allows a project override and a return to the inherited default through the same API', async () => {
    vi.mocked(readAutoArchive).mockResolvedValue(projectView());
    vi.mocked(saveAutoArchive).mockResolvedValueOnce(projectView({ revision: 'r2', mode: 'custom', days: 7, effectiveDays: 7 }))
      .mockResolvedValueOnce(projectView({ revision: 'r3' }));
    mount('p'); await ready();
    expect(readAutoArchive).toHaveBeenCalledWith('p');
    expect(screen.getByLabelText('日数の設定')).toHaveValue('inherit');
    expect(screen.getByText('適用中：完了から30日後にアーカイブ（共通設定）')).toBeVisible();
    expect(screen.queryByLabelText('完了からの期間')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('日数の設定'), { target: { value: 'custom' } }); choose('7');
    expect(screen.getByRole('button', { name: 'プレビューを更新' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.getByText('適用中：完了から7日後にアーカイブ')).toBeVisible());
    expect(saveAutoArchive).toHaveBeenLastCalledWith({ projectId: 'p', revision: 'r1', mode: 'custom', days: 7 });
    fireEvent.change(screen.getByLabelText('日数の設定'), { target: { value: 'inherit' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.getByText('適用中：完了から30日後にアーカイブ（共通設定）')).toBeVisible());
    expect(saveAutoArchive).toHaveBeenLastCalledWith({ projectId: 'p', revision: 'r2', mode: 'inherit', days: null });
  });

  it('uses server candidates and exclusion counts and refreshes the preview without saving or inferring targets', async () => {
    vi.mocked(readAutoArchive).mockResolvedValueOnce(projectView({ lastRun: { at: '2026-09-11T01:00:00Z', archivedCount: 2, error: null } }))
      .mockResolvedValueOnce(projectView({ preview: { candidates: [], waitingCount: 0, missingDateCount: 0, protectedCount: 0, restoredCount: 0 } }));
    mount('p'); await ready();
    expect(screen.getByRole('link', { name: '完了した原稿' })).toHaveAttribute('href', '/projects/p/board?task=task%2Fa');
    expect(screen.getByText('対象 1件 ／ 期間未経過 2件')).toBeVisible();
    expect(screen.getByText('対象外：完了日不明 1件・保護対象 3件・復元済み 4件')).toBeVisible();
    expect(screen.getByText(/前回の確認：.*2件をアーカイブ/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'プレビューを更新' }));
    await waitFor(() => expect(screen.queryByRole('link', { name: '完了した原稿' })).not.toBeInTheDocument());
    expect(screen.getByText('現在の設定に該当するタスクはありません。')).toBeVisible();
    expect(readAutoArchive).toHaveBeenCalledTimes(2); expect(saveAutoArchive).not.toHaveBeenCalled();
  });

  it('retains unsaved input after failure and retries the same revision and desired setting', async () => {
    vi.mocked(readAutoArchive).mockResolvedValue(projectView({ mode: 'custom', days: 30 }));
    vi.mocked(saveAutoArchive).mockRejectedValueOnce(new Error('保存を確認できませんでした。'))
      .mockResolvedValueOnce(projectView({ revision: 'r2', mode: 'custom', days: 17, effectiveDays: 17 }));
    mount('p'); await ready(); choose('custom');
    fireEvent.change(screen.getByLabelText('日数（1〜3650）'), { target: { value: '17' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('入力内容を保持しています');
    expect(screen.getByLabelText('日数（1〜3650）')).toHaveValue(17);
    expect(screen.getByText('適用中：完了から30日後にアーカイブ')).toBeVisible();
    expect(screen.getByRole('button', { name: 'プレビューを更新' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.getByText('適用中：完了から17日後にアーカイブ')).toBeVisible());
    expect(vi.mocked(saveAutoArchive).mock.calls[0]).toEqual(vi.mocked(saveAutoArchive).mock.calls[1]);
  });

  it('can read back a changed server revision only after the user chooses to discard their draft', async () => {
    vi.mocked(readAutoArchive).mockResolvedValueOnce(projectView({ mode: 'custom', days: 30 }))
      .mockResolvedValueOnce(projectView({ revision: 'r-new', mode: 'custom', days: 90, effectiveDays: 90 }));
    vi.mocked(saveAutoArchive).mockRejectedValue(new Error('設定が更新されました。'));
    mount('p'); await ready(); choose('7');
    fireEvent.click(screen.getByRole('button', { name: '保存' })); await screen.findByRole('alert');
    expect(screen.getByLabelText('完了からの期間')).toHaveValue('7');
    fireEvent.click(screen.getByRole('button', { name: '入力を戻して最新の設定を取得' }));
    await waitFor(() => expect(screen.getByLabelText('日数（1〜3650）')).toHaveValue(90));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('適用中：完了から90日後にアーカイブ')).toBeVisible();
  });

  it('refreshes run results while retaining an unsaved draft and its original revision', async () => {
    vi.mocked(readAutoArchive).mockResolvedValueOnce(projectView({ mode: 'custom', days: 30 }))
      .mockResolvedValueOnce(projectView({ revision: 'r-other', mode: 'custom', days: 90, effectiveDays: 90, lastRun: { at: '2026-09-12T01:00:00Z', archivedCount: 3, error: null } }));
    vi.mocked(saveAutoArchive).mockRejectedValue(new Error('設定が更新されました。'));
    mount('p'); await ready(); choose('7');
    act(() => window.dispatchEvent(new Event('taskflow-auto-archive-updated')));
    await waitFor(() => expect(screen.getByText(/前回の確認：.*3件をアーカイブ/)).toBeVisible());
    await ready();
    expect(screen.getByLabelText('完了からの期間')).toHaveValue('7');
    expect(screen.getByText('適用中：完了から90日後にアーカイブ')).toBeVisible();
    expect(screen.queryByText(/更新中…/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(saveAutoArchive).toHaveBeenCalledWith({ projectId: 'p', revision: 'r1', mode: 'custom', days: 7 }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('完了からの期間')).toHaveValue('7');
  });

  it('distinguishes initial read failure, readonly access, and a last-run error without writes', async () => {
    vi.mocked(readAutoArchive).mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce(projectView({ canEdit: false,
      lastRun: { at: '2026-09-12T01:00:00Z', archivedCount: 0, error: '確認の一部に失敗しました。' } }));
    mount('p');
    expect(await screen.findByRole('alert')).toHaveTextContent('設定を取得できませんでした');
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '再取得' }));
    await screen.findByText('この設定を変更する権限がありません。');
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    expect(screen.getByLabelText('日数の設定')).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('確認の一部に失敗しました。');
    expect(saveAutoArchive).not.toHaveBeenCalled();
  });

  it('isolates user and project changes and never fetches when logged out', async () => {
    vi.mocked(readAutoArchive).mockImplementation(async projectId => projectView({ projectId, revision: projectId ?? 'default' }));
    const mounted = mount('p'); await ready();
    fireEvent.change(screen.getByLabelText('日数の設定'), { target: { value: 'custom' } }); choose('7');
    mounted.rerender(mounted.renderScope('other')); await ready();
    expect(screen.getByLabelText('日数の設定')).toHaveValue('inherit');
    auth.user = null;
    mounted.rerender(mounted.renderScope('other'));
    expect(screen.getByText('設定するにはログインしてください。')).toBeVisible();
    expect(readAutoArchive).toHaveBeenCalledTimes(2);
    expect(saveAutoArchive).not.toHaveBeenCalled();
  });
});

it('keeps the applied policy visible until an explicit OFF save succeeds and disables unchanged saves', async () => {
  vi.mocked(readAutoArchive).mockResolvedValue(view({ configured: true, days: 30, effectiveDays: 30 }));
  vi.mocked(saveAutoArchive).mockResolvedValue(view({ configured: true, revision: 'r2' }));
  mount(); await ready();
  expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
  choose('7'); expect(screen.getByText('未保存')).toBeVisible();
  expect(screen.getByLabelText('現在の適用状態')).toHaveTextContent('適用中：完了から30日後にアーカイブ');
  choose('30'); expect(screen.queryByText('未保存')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
  choose('off'); expect(saveAutoArchive).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(screen.getByLabelText('現在の適用状態')).toHaveTextContent('停止中：自動アーカイブしません'));
  expect(saveAutoArchive).toHaveBeenCalledExactlyOnceWith({ projectId: null, revision: 'r1', mode: 'custom', days: null });
});
