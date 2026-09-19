import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { viewTask } from '@/test/taskViewFixtures';
import { TaskChildrenSummary } from './TaskChildrenSummary';

describe('child task summary', () => {
  it('starts expanded when pending work exists, marks own pending work, and keeps completed children behind their disclosure', () => {
    const parent = viewTask({ id: 'p' });
    const children = [
      viewTask({ id: 'later', title: '後で確認', parentTaskId: 'p', assigneeIds: ['me', 'other'], dueDate: new Date(2026, 8, 20) }),
      viewTask({ id: 'first', title: '先に確認', parentTaskId: 'p', assigneeIds: ['me'], dueDate: new Date(2026, 8, 10) }),
      viewTask({ id: 'other', title: '他の人の作業', parentTaskId: 'p', assigneeIds: ['other'] }),
      viewTask({ id: 'done', title: '済んだ確認', parentTaskId: 'p', assigneeIds: ['me'], isCompleted: true }),
    ];
    const openParent = vi.fn(), openChild = vi.fn();
    render(<div onClick={openParent}><TaskChildrenSummary task={parent} childrenTasks={children} allTasks={[parent, ...children]} viewerId="me" names={{ me: '自分', other: '別の担当者' }} onTaskClick={openChild} /></div>);
    expect(screen.getByText('サブタスク 4')).toBeVisible();
    expect(screen.getByTitle('自分の未完了 2件')).toBeVisible();
    const toggle = screen.getByRole('button', { name: /出展準備のサブタスクを折りたたむ/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAccessibleDescription('サブタスク 4件・未完了 3件・自分の未完了 2件');
    expect(screen.queryByText('あなたの未完了なし')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '後で確認' })).toBeVisible();
    expect(screen.getByRole('button', { name: '先に確認' })).toBeVisible();
    expect(screen.getByRole('button', { name: '他の人の作業' })).toBeVisible();
    expect(screen.getByRole('button', { name: '後で確認' })).not.toHaveClass('min-h-7');
    const firstRow = screen.getByRole('button', { name: '先に確認' }).parentElement;
    expect(firstRow).not.toBeNull();
    expect(within(firstRow!).getByTitle('未完了')).toBeVisible();
    expect(within(firstRow!).getByRole('group', { name: '担当者: 自分' })).toBeVisible();
    expect(within(firstRow!).getByRole('time', { name: '期限：2026年9月10日' })).toHaveTextContent('9/10');
    expect(screen.queryByRole('button', { name: '済んだ確認' })).not.toBeVisible();
    expect(openParent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '先に確認' }));
    expect(openChild).toHaveBeenCalledExactlyOnceWith('first');
    expect(openParent).not.toHaveBeenCalled();
    fireEvent.click(toggle);
    expect(screen.queryByRole('button', { name: '後で確認' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /出展準備のサブタスクを展開/ }));
    fireEvent.click(screen.getByText('完了済み 1件'));
    expect(screen.getByRole('button', { name: '済んだ確認' })).toBeVisible();
    expect(within(screen.getByRole('button', { name: '済んだ確認' })).getByText('済んだ確認')).toHaveClass('line-through');
    fireEvent.click(screen.getByRole('button', { name: '済んだ確認' }));
    expect(openChild).toHaveBeenLastCalledWith('done');
    expect(openParent).not.toHaveBeenCalled();
  });
  it('keeps each Kanban subtask title and its status, assignee, and due date in one row', () => {
    const parent = viewTask({ id: 'p' });
    const child = viewTask({ id: 'child', title: 'かぎん振込予約', parentTaskId: 'p', assigneeIds: ['me'], dueDate: new Date(2026, 8, 16) });
    render(<TaskChildrenSummary task={parent} childrenTasks={[child]} allTasks={[parent, child]} viewerId="me" names={{ me: '自分' }} onTaskClick={vi.fn()} rowLayout="single-line" />);
    const title = screen.getByRole('button', { name: 'かぎん振込予約' });
    const row = title.parentElement;
    expect(row).not.toBeNull();
    expect(row).toHaveAttribute('data-testid', 'task-child-row');
    expect(row).toHaveClass('flex', 'items-center', 'gap-x-2');
    expect(title).toHaveClass('tf-task-title', 'min-h-6');
    expect(row).not.toHaveClass('py-1');
    expect(screen.getByTestId('task-children-summary')).toHaveClass('py-1');
    expect(row?.parentElement).toHaveClass('mt-1', 'space-y-0.5');
    expect(title.parentElement).toBe(row);
    expect(within(row!).getByTestId('task-child-metadata').parentElement).toBe(row);
    expect(within(row!).getByTitle('未完了')).toBeVisible();
    expect(within(row!).getByRole('group', { name: '担当者: 自分' })).toBeVisible();
    expect(within(row!).getByRole('time', { name: '期限：2026年9月16日' })).toHaveTextContent('9/16');
  });
  it('keeps an inconsistent completion visible as an icon, with its explanation on expansion', () => {
    const parent = viewTask({ isCompleted: true });
    const child = viewTask({ id: 'child', parentTaskId: parent.id, assigneeIds: ['other'] });
    render(<TaskChildrenSummary task={parent} childrenTasks={[child]} allTasks={[parent, child]} viewerId="me" onTaskClick={vi.fn()} />);
    expect(screen.getByTitle('親は完了・サブタスクは未完了です')).toBeVisible();
    expect(screen.getByText('親は完了・サブタスクは未完了です')).toBeVisible();
    expect(screen.queryByText('あなたの未完了なし')).not.toBeInTheDocument();
    expect(screen.queryByTitle(/自分の未完了/)).not.toBeInTheDocument();
  });
  it('supports Enter and Space without starting parent dragging or opening its menu', async () => {
    const user = userEvent.setup();
    const parent = viewTask();
    const child = viewTask({ id: 'child', title: '中身を確認', parentTaskId: parent.id });
    const parentClick = vi.fn(), parentPointer = vi.fn(), parentKey = vi.fn(), parentMenu = vi.fn(), move = vi.fn();
    render(<div onClick={parentClick} onPointerDown={parentPointer} onKeyDown={parentKey} onContextMenu={parentMenu}><TaskChildrenSummary task={parent} childrenTasks={[child]} allTasks={[parent, child]} viewerId="me" onTaskClick={vi.fn()} onMoveTask={move} /></div>);
    const toggle = screen.getByRole('button', { name: '出展準備のサブタスクを折りたたむ' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.pointerDown(toggle);
    fireEvent.contextMenu(toggle);
    toggle.focus();
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: '中身を確認' })).not.toBeInTheDocument();
    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: '中身を確認' })).toBeVisible();
    for (const handler of [parentClick, parentPointer, parentKey, parentMenu, move]) expect(handler).not.toHaveBeenCalled();
  });
  it('keeps completed-only and abandoned children available behind the compact control', () => {
    const parent = viewTask();
    const children = [viewTask({ id: 'done', title: '済んだ仕事', isCompleted: true }), viewTask({ id: 'stopped', title: '取りやめた仕事', isAbandoned: true })];
    const open = vi.fn();
    render(<TaskChildrenSummary task={parent} childrenTasks={children} allTasks={[parent, ...children]} viewerId="me" onTaskClick={open} />);
    expect(screen.getByText('サブタスク 2')).toBeVisible();
    expect(screen.queryByTitle(/自分の未完了/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '出展準備のサブタスクを展開' }));
    const completedSummary = screen.getByText('完了済み 1件');
    expect(completedSummary).toHaveClass('py-1');
    fireEvent.click(completedSummary);
    fireEvent.click(screen.getByRole('button', { name: '済んだ仕事' }));
    expect(open).toHaveBeenLastCalledWith('done');
    fireEvent.click(screen.getByText('取りやめ 1件'));
    fireEvent.click(screen.getByRole('button', { name: '取りやめた仕事' }));
    expect(open).toHaveBeenLastCalledWith('stopped');
  });
  it('opens when unfinished children arrive after the card first renders', () => {
    const parent = viewTask();
    const child = viewTask({ id: 'child', title: 'あとで追加された仕事', parentTaskId: parent.id });
    const { rerender } = render(<TaskChildrenSummary task={parent} childrenTasks={[]} allTasks={[parent, child]} viewerId="me" onTaskClick={vi.fn()} />);
    rerender(<TaskChildrenSummary task={parent} childrenTasks={[child]} allTasks={[parent, child]} viewerId="me" onTaskClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: '出展準備のサブタスクを折りたたむ' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'あとで追加された仕事' })).toBeVisible();
  });
});
