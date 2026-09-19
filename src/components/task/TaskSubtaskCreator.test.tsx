import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { viewTask } from '@/test/taskViewFixtures';
import { TaskSubtaskCreator } from './TaskSubtaskCreator';

const task = viewTask({ id: 'parent', title: '請求書作成' });
it('creates a trimmed subtask only on submit, prevents duplicate submits, and closes the input after success', async () => {
  let finish!: () => void;
  const onAdd = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  render(<TaskSubtaskCreator task={task} onAdd={onAdd} />);
  fireEvent.click(screen.getByRole('button', { name: 'サブタスク' }));
  expect(screen.getByRole('button', { name: '追加' })).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox', { name: 'サブタスク名' }), { target: { value: '  金額を確認  ' } });
  expect(onAdd).not.toHaveBeenCalled();
  fireEvent.submit(screen.getByRole('form'));
  fireEvent.submit(screen.getByRole('form'));
  expect(onAdd).toHaveBeenCalledExactlyOnceWith(task, '金額を確認', []);
  expect(screen.getByRole('button', { name: '追加中…' })).toBeDisabled();
  await act(async () => finish());
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
it('keeps input after a failed save, allows retry, and never writes on cancel', async () => {
  const onAdd = vi.fn().mockRejectedValueOnce(new Error('保存できません')).mockResolvedValueOnce('child');
  render(<TaskSubtaskCreator task={task} onAdd={onAdd} />);
  fireEvent.click(screen.getByRole('button', { name: 'サブタスク' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '送付する' } });
  fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
  expect(onAdd).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'サブタスク' }));
  expect(screen.getByRole('textbox')).toHaveValue('');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '送付する' } });
  fireEvent.submit(screen.getByRole('form'));
  expect(await screen.findByRole('alert')).toHaveTextContent('保存できません');
  expect(screen.getByRole('textbox')).toHaveValue('送付する');
  fireEvent.submit(screen.getByRole('form'));
  await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
  expect(onAdd).toHaveBeenCalledTimes(2);
});
describe('unavailable parent', () => {
  it.each([{ isArchived: true }, { isAbandoned: true }, { parentTaskId: 'parent-task' }])('does not offer additions for %s', patch => {
    render(<TaskSubtaskCreator task={{ ...task, ...patch }} onAdd={vi.fn()} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

vi.mock('@/hooks/useProjects', () => ({ useProject: () => ({ project: { id: 'project-1', memberIds: ['user-1'], defaultAssigneeId: null }, isLoading: false, error: null }) }));
vi.mock('@/hooks/useMeetingMembers', () => ({ useMeetingMembers: () => ({ users: [{ id: 'user-1', displayName: '本人' }], isLoading: false, hasError: false }) }));
