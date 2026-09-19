import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TaskListPicker } from './TaskListPicker';
import { viewList, viewTask } from '@/test/taskViewFixtures';

const task = viewTask({ id: 'orphan', title: '画像の不具合', listId: 'deleted' });
const lists = [viewList({ id: 'done', name: '完全完了', autoCompleteOnEnter: true, autoSetStartDateOnEnter: true })];
describe('task list reassignment', () => {
  it('lets an unclassified task choose a valid list without writing until Move is pressed', async () => {
    const move = vi.fn().mockResolvedValue(undefined);
    render(<TaskListPicker task={task} lists={lists} onMove={move} />);
    fireEvent.click(screen.getByRole('button', { name: '画像の不具合のリストを変更' }));
    expect(screen.getByText(/現在：分類不明/)).toBeVisible();
    expect(screen.getByRole('button', { name: '移動' })).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox', { name: '移動先のリスト' }), { target: { value: 'done' } });
    expect(screen.getByText(/このタスクは完了になります/)).toBeVisible();
    expect(screen.getByText(/開始日が今日になります/)).toBeVisible();
    expect(move).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '移動' }));
    await waitFor(() => expect(move).toHaveBeenCalledExactlyOnceWith('orphan', 'done'));
    await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeInTheDocument());
  });
  it('preserves the selection on failure and prevents saving the current list or an unavailable target', async () => {
    const move = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValue(undefined);
    const { rerender } = render(<TaskListPicker task={task} lists={lists} onMove={move} />);
    fireEvent.click(screen.getByRole('button', { name: '画像の不具合のリストを変更' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'done' } });
    fireEvent.click(screen.getByRole('button', { name: '移動' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('移動できません');
    expect(screen.getByRole('combobox')).toHaveValue('done');
    rerender(<TaskListPicker task={task} lists={[]} onMove={move} />);
    expect(screen.getByRole('button', { name: '移動' })).toBeDisabled();
    rerender(<TaskListPicker task={{ ...task, listId: 'done' }} lists={lists} onMove={move} />);
    expect(screen.getByRole('button', { name: '移動' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(move).toHaveBeenCalledTimes(1);
  });
});
