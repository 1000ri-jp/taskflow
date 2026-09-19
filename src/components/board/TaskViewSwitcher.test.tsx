import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TaskViewSwitcher } from './TaskViewSwitcher';

const defaultProps = {
  view: 'board' as const,
  primaryView: 'board' as const,
  onChange: vi.fn(),
  onSetDefault: vi.fn(),
  canSave: true,
  persistenceFailed: false,
};

describe('TaskViewSwitcher', () => {
  it('uses a dropdown to change the task view', () => {
    render(<TaskViewSwitcher {...defaultProps} />);
    const select = screen.getByRole('combobox', { name: 'タスクの表示切り替え' });

    expect(select).toHaveValue('board');
    fireEvent.change(select, { target: { value: 'table' } });

    expect(defaultProps.onChange).toHaveBeenCalledWith('table');
  });

  it.each(['calendar', 'gantt', 'progress'] as const)('keeps the browser-only primary view action available for %s', (view) => {
    const onSetDefault = vi.fn();
    render(<TaskViewSwitcher {...defaultProps} view={view} primaryView="board" onSetDefault={onSetDefault} />);

    expect(screen.getByRole('combobox')).toHaveValue(view);
    const button = screen.getByRole('button', { name: '自分の主表示にする' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onSetDefault).toHaveBeenCalledOnce();
  });
});
