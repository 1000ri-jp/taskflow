import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskQuickPreview } from './TaskQuickPreview';
import { viewList, viewTask } from '@/test/taskViewFixtures';

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => vi.unstubAllGlobals());

describe('task quick preview', () => {
  it('shows details on hover, dismisses with Escape, and leaves click and drag available', async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    const drag = vi.fn();
    const dayClick = vi.fn();
    const task = viewTask({ description: '印刷用PDFを確認してください', startDate: new Date(2026, 8, 1), dueDate: new Date(2026, 8, 23) });
    render(<div onClick={dayClick}><TaskQuickPreview task={task} allTasks={[task]} lists={[viewList()]} names={{}}>
      <button draggable onDragStart={drag} onClick={open}>出展準備</button>
    </TaskQuickPreview></div>);
    const trigger = screen.getByRole('button', { name: '出展準備' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    await user.hover(trigger);
    const preview = await screen.findByRole('tooltip');
    expect(preview).toHaveTextContent('印刷用PDFを確認してください');
    expect(preview).toHaveTextContent('担当者未設定');
    expect(preview).toHaveTextContent('2026/9/1');
    expect(preview).toHaveTextContent('2026/9/23');
    await user.click(screen.getByTestId('task-quick-preview'));
    expect(dayClick).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
    fireEvent.focus(trigger);
    await screen.findByRole('tooltip');
    fireEvent.dragStart(trigger);
    expect(drag).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
    await user.click(trigger);
    expect(open).toHaveBeenCalledOnce();
  });
});
