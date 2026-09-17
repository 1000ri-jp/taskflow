import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { TaskStatusControl } from './TaskStatusControl';
import { sendWorkflow } from '@/lib/task/workflowClient';
import { viewTask } from '@/test/taskViewFixtures';
vi.mock('@/lib/task/workflowClient', () => ({ sendWorkflow: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); vi.mocked(sendWorkflow).mockResolvedValue(null); });
it('changes status only after a user action and retains the original request for uncertain retries', async () => {
  const task = viewTask();
  vi.mocked(sendWorkflow).mockRejectedValueOnce(new Error('通信切断'));
  const ui = render(<TaskStatusControl task={task} tasks={[task]} userId="u" />);
  await act(async () => {});
  expect(sendWorkflow).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'started' } });
  await screen.findByRole('alert');
  const request = vi.mocked(sendWorkflow).mock.calls[0];
  expect(request[2]).toMatchObject({ action: 'start', expectedVersion: task.updatedAt.toISOString() });
  expect(screen.getByRole('combobox')).toBeDisabled();
  ui.unmount();
  render(<TaskStatusControl task={{ ...task, updatedAt: new Date() }} tasks={[task]} userId="u" />);
  await screen.findByRole('button', { name: '同じ操作を再試行' });
  fireEvent.click(screen.getByRole('button', { name: '同じ操作を再試行' }));
  await waitFor(() => expect(sendWorkflow).toHaveBeenLastCalledWith(...request));
  await screen.findByRole('status');
  expect(sessionStorage.length).toBe(0);
});
it('explains waiting and offers archive while blocking manual progress until dependencies finish', async () => {
  const prerequisite = viewTask({ id: 'dep', title: '原稿確認' });
  const task = viewTask({ dependsOnTaskIds: ['dep'] });
  const ui = render(<TaskStatusControl task={task} tasks={[task, prerequisite]} userId="u" />);
  await act(async () => {});
  expect(screen.getByRole('combobox')).toHaveValue('waiting');
  expect(screen.getByText('前提の完了待ち：原稿確認')).toBeInTheDocument();
  expect(screen.getByRole('option', { name: '着手' })).toBeDisabled();
  expect(screen.getByRole('option', { name: '完了' })).toBeDisabled();
  expect(screen.getByRole('option', { name: 'アーカイブ' })).not.toBeDisabled();
  ui.rerender(<TaskStatusControl task={task} tasks={[task, { ...prerequisite, isCompleted: true }]} userId="u" />);
  expect(screen.getByRole('combobox')).toHaveValue('not_started');
  expect(screen.getByRole('option', { name: '待機' })).toBeDisabled();
  expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['未着手', '着手', '待機', '完了', 'アーカイブ']);
  expect(screen.getByRole('option', { name: '着手' })).not.toBeDisabled();
});
it('restores an archived task through the same workflow', async () => {
  const task = viewTask({ isArchived: true, isCompleted: true });
  render(<TaskStatusControl task={task} tasks={[task]} userId="u" />);
  await act(async () => {});
  expect(screen.getByRole('combobox')).toHaveValue('archived');
  fireEvent.click(screen.getByRole('button', { name: '復元' }));
  await waitFor(() => expect(sendWorkflow).toHaveBeenCalledWith(task.projectId, task.id, expect.objectContaining({ action: 'restore' })));
});

it('can hide the inline saved confirmation when the surrounding task detail already provides context', async () => {
  const task = viewTask();
  render(<TaskStatusControl task={task} tasks={[task]} userId="u" showSuccess={false} />);
  await act(async () => {});
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'started' } });
  await waitFor(() => expect(sendWorkflow).toHaveBeenCalledWith(task.projectId, task.id, expect.objectContaining({ action: 'start' })));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it('offers the existing shared resume action for a held parent',async()=>{
 const task=viewTask({workState:{status:'hold',reason:'準備中',resumeCondition:'素材が届いたら',reviewAt:null}});render(<TaskStatusControl task={task} tasks={[task]} userId="u"/>);const button=screen.getByRole('button',{name:'保留・待ちを解除'});await waitFor(()=>expect(button).toBeEnabled());fireEvent.click(button);await waitFor(()=>expect(sendWorkflow).toHaveBeenCalledWith(task.projectId,task.id,expect.objectContaining({action:'resume'})));
});
