import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ProjectFormModal } from './ProjectFormModal';

const mocks = vi.hoisted(() => ({ create: vi.fn(), close: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/stores/uiStore', () => ({ useUIStore: () => ({ isProjectModalOpen: true, selectedProjectId: null, closeProjectModal: mocks.close }) }));
vi.mock('@/hooks/useProjects', () => ({ useProjects: () => ({ create: mocks.create }) }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: (select: (state: { user: null }) => unknown) => select({ user: null }) }));

beforeEach(() => vi.clearAllMocks());

it('saves a joined emoji through the existing create path and keeps the selection and other input on failure', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.create.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('new-project');
  render(<ProjectFormModal />);
  await waitFor(() => expect(screen.getByRole('button', {name:'絵文字アイコンを変更'})).toHaveFocus());
  fireEvent.change(screen.getByLabelText('プロジェクト名 *'), { target: { value: '未保存の日本語のプロジェクト' } });
  fireEvent.click(screen.getByRole('button', {name:'絵文字アイコンを変更'}));
  fireEvent.change(await screen.findByLabelText('絵文字を検索'), { target: { value: '👨‍👩‍👧‍👦' } });
  fireEvent.click(await screen.findByRole('button', { name: '👨‍👩‍👧‍👦 家族: 男性 女性 女の子 男の子' }));
  fireEvent.click(screen.getByRole('button', { name: '作成' }));
  expect(await screen.findByText('プロジェクトの作成に失敗しました')).toBeVisible();
  expect(screen.getByLabelText('プロジェクト名 *')).toHaveValue('未保存の日本語のプロジェクト');
  expect(screen.getByText('選択中：家族: 男性 女性 女の子 男の子')).toBeVisible();
  expect(mocks.close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '作成' }));
  await waitFor(() => expect(mocks.close).toHaveBeenCalledOnce());
  expect(mocks.create).toHaveBeenNthCalledWith(2, expect.objectContaining({ name: '未保存の日本語のプロジェクト', icon: '👨‍👩‍👧‍👦' }));
  expect(mocks.push).toHaveBeenCalledWith('/projects/new-project/board');
  log.mockRestore();
});

it('dismisses the emoji choices with Escape without closing the project draft', async () => {
  render(<ProjectFormModal />);
  fireEvent.change(screen.getByLabelText('プロジェクト名 *'), {target:{value:'未保存の入力'}});
  fireEvent.click(screen.getByRole('button', {name:'絵文字アイコンを変更'}));
  await screen.findByRole('dialog', {name:'絵文字アイコンを選択'});
  fireEvent.keyDown(document, {key:'Escape'});
  await waitFor(() => expect(screen.queryByRole('dialog', {name:'絵文字アイコンを選択'})).not.toBeInTheDocument());
  expect(screen.getByRole('dialog', {name:'新規プロジェクト'})).toBeVisible();
  expect(screen.getByLabelText('プロジェクト名 *')).toHaveValue('未保存の入力');
  expect(mocks.close).not.toHaveBeenCalled();
});
