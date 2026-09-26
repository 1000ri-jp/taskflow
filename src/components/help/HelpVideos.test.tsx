import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HelpVideos } from './HelpVideos';

const mocks = vi.hoisted(() => ({ firebaseUser: null as { uid: string } | null }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: (selector: (state: unknown) => unknown) => selector(mocks) }));
vi.mock('@/lib/firebase/testMode', () => ({ isE2EMockAuthEnabled: () => true }));
beforeEach(() => { mocks.firebaseUser = null; });
afterEach(() => vi.unstubAllGlobals());

it('shows only the selected operation instructions alongside its video', () => {
  render(<HelpVideos />);
  const select = screen.getByRole('combobox', { name: '操作動画を選ぶ' });
  expect(screen.queryByText('操作を選ぶ')).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: '01 プロジェクトを開くの手順' })).toHaveTextContent('プロジェクト一覧を開きます');
  expect(screen.queryByText('「タスク名」に作業名を入力します。')).not.toBeInTheDocument();

  fireEvent.change(select, { target: { value: '02_add-task' } });
  expect(screen.getByRole('region', { name: '02 タスクを追加するの手順' })).toHaveTextContent('「タスク名」に作業名を入力します');
  expect(screen.queryByText('プロジェクト一覧を開きます。')).not.toBeInTheDocument();

  fireEvent.change(select, { target: { value: 'manual-14' } });
  expect(screen.getByRole('region', { name: '14 チェック項目の期限を厳守するの手順' })).toHaveTextContent('日付と時刻');
  expect(screen.queryByText('動画を見るにはログインしてください。')).not.toBeInTheDocument();
});

it('loads a selected recording with the local preview identity', async () => {
  mocks.firebaseUser = { uid: 'e2e-mock-user' };
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['preview'], { type: 'video/mp4' }) });
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:local-preview') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  render(<HelpVideos />);
  expect(await screen.findByLabelText('01 プロジェクトを開く')).toHaveAttribute('src', 'blob:local-preview');
  expect(fetchMock).toHaveBeenCalledWith('/api/help/videos/01_project-open', expect.objectContaining({ headers: { Authorization: 'Bearer taskflow-local-help-preview' } }));
});
