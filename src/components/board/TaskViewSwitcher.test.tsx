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

  it('keeps the browser-only primary view action available', () => {
    const onSetDefault = vi.fn();
    render(<TaskViewSwitcher {...defaultProps} view="calendar" primaryView="board" onSetDefault={onSetDefault} />);

    const button = screen.getByRole('button', { name: 'この表示を主表示にする' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onSetDefault).toHaveBeenCalledOnce();
  });
});
