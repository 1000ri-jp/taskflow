import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TaskProjectPicker } from './TaskProjectPicker';
const api = vi.hoisted(() => ({ context: vi.fn(), preview: vi.fn(), move: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: api.push }) }));
vi.mock('@/lib/task/projectMoveClient', () => ({ getProjectMoveContext: api.context, previewProjectMove: api.preview, applyProjectMove: api.move }));
beforeEach(() => {
  vi.clearAllMocks();
  api.context.mockResolvedValue({ currentName: 'nico', projects: [{ id: 'office', name: '総務', lists: [{ id: 'account', name: '会計' }] }] });
  api.preview.mockResolvedValue({ version: 'checked-version', taskCount: 2, commentCount: 3, attachmentCount: 1, checklistCount: 1, targetName: '総務', listName: '会計' });
  api.move.mockResolvedValue({ projectId: 'office', taskId: 'root' });
});
async function selectDestination() {
  render(<TaskProjectPicker projectId="nico" taskId="root" />);
  fireEvent.click(screen.getByRole('button', { name: 'プロジェクトを変更' }));
  fireEvent.change(await screen.findByLabelText('移動先のプロジェクト'), { target: { value: 'office' } });
  fireEvent.change(screen.getByLabelText('移動先のリスト'), { target: { value: 'account' } });
  fireEvent.click(screen.getByRole('button', { name: '内容を確認' }));
  await screen.findByRole('button', { name: '移動' });
}
it('loads on demand, shows the shared destination and moves only after confirmation', async () => {
  await selectDestination();
  expect(api.move).not.toHaveBeenCalled();
  expect(screen.getByRole('status')).toHaveTextContent('内容は移動先のメンバーに共有');
  fireEvent.click(screen.getByRole('button', { name: '移動' }));
  await waitFor(() => expect(api.push).toHaveBeenCalledWith('/projects/office/board?task=root'));
  expect(api.move).toHaveBeenCalledWith('nico', 'root', expect.objectContaining({ targetProjectId: 'office', listId: 'account', version: 'checked-version' }));
});
it('retains the same operation after an uncertain result, without changing the destination', async () => {
  api.move.mockRejectedValueOnce(new Error('結果を確認できません'));
  await selectDestination(); fireEvent.click(screen.getByRole('button', { name: '移動' }));
  const retry = await screen.findByRole('button', { name: '結果を確認・再試行' });
  expect(screen.getByLabelText('移動先のプロジェクト')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'キャンセル' })).toBeDisabled();
  fireEvent.click(retry);
  await waitFor(() => expect(api.push).toHaveBeenCalled());
  expect(api.move.mock.calls[0]).toEqual(api.move.mock.calls[1]);
});
it('retains selected destinations but rechecks a rejected stale preview', async () => {
  api.move.mockRejectedValueOnce(Object.assign(new Error('確認後に更新されました'), { rejected: true }));
  await selectDestination(); fireEvent.click(screen.getByRole('button', { name: '移動' }));
  await screen.findByText('確認後に更新されました');
  expect(screen.getByLabelText('移動先のプロジェクト')).toHaveValue('office');
  expect(screen.getByLabelText('移動先のリスト')).toHaveValue('account');
  expect(screen.getByRole('button', { name: '内容を確認' })).toBeEnabled();
  expect(api.push).not.toHaveBeenCalled();
});
it('does not enable movement when there are no editable destinations', async () => {
  api.context.mockResolvedValue({ currentName: 'nico', projects: [] });
  render(<TaskProjectPicker projectId="nico" taskId="root" />);
  expect(api.context).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'プロジェクトを変更' }));
  await screen.findByText('移動できるプロジェクトがありません。移動先の編集権限が必要です。');
  expect(screen.getByRole('button', { name: '内容を確認' })).toBeDisabled();
});
