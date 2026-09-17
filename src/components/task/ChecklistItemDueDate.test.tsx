import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChecklistItemDueDate } from './ChecklistItemDueDate';
import type { ChecklistItem } from '@/types';

beforeAll(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterAll(() => vi.unstubAllGlobals());
const item: ChecklistItem = { id: 'i', text: '持ちものリスト確認', order: 0, isChecked: false };

describe('ChecklistItemDueDate', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 8, 13)); });
  afterEach(() => vi.useRealTimers());
  it('saves a date only after confirmation, displays it, and clears it', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<ChecklistItemDueDate item={item} disabled={false} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: `${item.text}の期限を設定` }));
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '2026年9月23日' }));
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledExactlyOnceWith('2026-09-23'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: `${item.text}の期限` })).not.toBeInTheDocument());
    rerender(<ChecklistItemDueDate item={{ ...item, dueDate: '2026-09-23' }} disabled={false} onSave={onSave} />);
    const trigger = screen.getByRole('button', { name: /の期限: 2026\/9\/23/ });
    expect(trigger).toHaveTextContent('9/23');
    fireEvent.click(trigger);
    expect(screen.getByRole('button', { name: '2026年9月23日' })).toHaveAttribute('data-selected-single', 'true');
    fireEvent.click(screen.getByRole('button', { name: '期限を外す' }));
    await waitFor(() => expect(onSave).toHaveBeenLastCalledWith(null));
  });

  it('retains the saved date and draft if saving fails and blocks duplicate saves', async () => {
    let rejectSave!: (error: Error) => void;
    const onSave = vi.fn(() => new Promise<void>((_, reject) => { rejectSave = reject; }));
    render(<ChecklistItemDueDate item={{ ...item, dueDate: '2026-09-23' }} disabled={false} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: /の期限: 2026\/9\/23/ }));
    fireEvent.click(screen.getByRole('button', { name: '2026年9月24日' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByRole('button', { name: '保存中…' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '保存中…' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    await act(async () => rejectSave(new Error('期限を保存できません')));
    expect(screen.getByRole('alert')).toHaveTextContent('期限を保存できません');
    expect(screen.getByRole('button', { name: '2026年9月24日' })).toHaveAttribute('data-selected-single', 'true');
    expect(screen.getByRole('button', { name: /の期限: 2026\/9\/23/ })).toHaveTextContent('9/23');
  });

  it('marks overdue unfinished items but not completed items', () => {
    const { rerender } = render(<ChecklistItemDueDate item={{ ...item, dueDate: '2000-01-01' }} disabled={false} onSave={vi.fn()} />);
    expect(screen.getByRole('button', { name: /期限切れ/ })).toHaveClass('text-red-600');
    rerender(<ChecklistItemDueDate item={{ ...item, isChecked: true, dueDate: '2000-01-01' }} disabled={true} onSave={vi.fn()} />);
    expect(screen.getByRole('button')).not.toHaveClass('text-red-600');
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
