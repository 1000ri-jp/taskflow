import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TaskParentPicker } from './TaskParentPicker';
import { viewList, viewTask } from '@/test/taskViewFixtures';

const task = viewTask({ id: 'task', title: 'チャーム' });
const parent = viewTask({ id: 'parent', title: 'グッズ', isCompleted: true });
const lists = [viewList({ name: 'その他' })];

describe('parent task selection', () => {
  it('offers eligible project tasks and filters self, descendants, broken chains, archives and other projects', async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    render(<TaskParentPicker task={task} tasks={[task, parent,
      viewTask({ id: 'child', parentTaskId: 'parent' }),
      viewTask({ id: 'archived', isArchived: true }), viewTask({ id: 'other', projectId: 'other' }),
      viewTask({ id: 'orphan', parentTaskId: 'missing' }), viewTask({ id: 'cycle', parentTaskId: 'cycle' }),
    ]} lists={lists} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '親タスクを変更' }));
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['親なし（単独タスク）', 'グッズ · その他（完了）']);
    expect(screen.getByRole('button', { name: '変更' })).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'parent' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '変更' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledExactlyOnceWith('task', 'parent'));
    await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeInTheDocument());
  });

  it('allows detachment with no change on cancel, retains failed selection and permits retry', async () => {
    const onChange = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    render(<TaskParentPicker task={{ ...task, parentTaskId: 'parent' }} tasks={[task, parent]} lists={lists} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '親タスクを変更' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '親タスクを変更' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '変更' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('変更できませんでした');
    expect(screen.getByRole('combobox')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: '変更' }));
    await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeInTheDocument());
    expect(onChange).toHaveBeenNthCalledWith(2, 'task', null);
  });

  it('disables a selection that becomes unavailable before save', () => {
    const onChange = vi.fn();
    const { rerender } = render(<TaskParentPicker task={task} tasks={[task, parent]} lists={lists} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '親タスクを変更' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'parent' } });
    rerender(<TaskParentPicker task={task} tasks={[task, { ...parent, parentTaskId: 'task' }]} lists={lists} onChange={onChange} />);
    expect(screen.getByRole('button', { name: '変更' })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps a long parent name available in the compact control and requires an explicit change', async () => {
    const longName = '展示会の準備とグッズ制作から搬入までをまとめた親タスク';
    const onChange = vi.fn().mockResolvedValue(undefined);
    render(<TaskParentPicker compact task={{ ...task, parentTaskId: parent.id }} tasks={[task, { ...parent, title: longName }]} lists={lists} onChange={onChange} />);
    const trigger = screen.getByRole('button', { name: `親タスクを変更（現在：${longName}）` });
    expect(trigger).toHaveAttribute('title', `親タスクを変更（現在：${longName}）`);
    expect(trigger).toHaveClass('max-w-44');
    expect(screen.getByText(longName)).toHaveClass('truncate');
    fireEvent.click(trigger);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '変更' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledExactlyOnceWith('task', null));
    await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeInTheDocument());
  });

  it('distinguishes no parent from an unavailable parent in the compact control', () => {
    const onChange = vi.fn();
    const { rerender } = render(<TaskParentPicker compact task={task} tasks={[task]} lists={lists} onChange={onChange} />);
    expect(screen.getByRole('button', { name: '親タスクを変更（現在：親なし（単独タスク））' })).toHaveTextContent('親なし');
    rerender(<TaskParentPicker compact task={{ ...task, parentTaskId: 'missing' }} tasks={[task]} lists={lists} onChange={onChange} />);
    expect(screen.getByRole('button', { name: '親タスクを変更（現在：親タスクを確認できません）' })).toHaveTextContent('親タスクを確認できません');
    expect(screen.queryByText('親なし')).not.toBeInTheDocument();
  });

  it('keeps the compact control disabled for an archived task', () => {
    const onChange = vi.fn();
    render(<TaskParentPicker compact task={{ ...task, isArchived: true }} tasks={[task, parent]} lists={lists} onChange={onChange} />);
    const trigger = screen.getByRole('button', { name: /^親タスクを変更/ });
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
