import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChecklistTitle } from './ChecklistTitle';

describe('ChecklistTitle', () => {
  it('saves a trimmed name only after confirmation and cancels without saving', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ChecklistTitle title="チェックリスト" disabled={false} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'チェックリストの名前を変更' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  当日の準備  ' } });
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'チェックリストの名前を変更' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  当日の準備  ' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    await waitFor(() => expect(onSave).toHaveBeenCalledExactlyOnceWith('当日の準備'));
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
  });

  it('rejects an empty name and does not save during Japanese composition', () => {
    const onSave = vi.fn();
    render(<ChecklistTitle title="準備" disabled={false} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: '準備の名前を変更' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'チェックリスト名を保存' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '出展準備' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', isComposing: true });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('keeps the draft on failure and prevents another save while pending', async () => {
    let rejectSave!: (error: Error) => void;
    const onSave = vi.fn(() => new Promise<void>((_, reject) => { rejectSave = reject; }));
    render(<ChecklistTitle title="準備" disabled={false} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: '準備の名前を変更' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '出展準備' } });
    fireEvent.click(screen.getByRole('button', { name: 'チェックリスト名を保存' }));
    expect(screen.getByRole('textbox')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'チェックリスト名を保存' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    await act(async () => rejectSave(new Error('offline')));
    expect(screen.getByRole('alert')).toHaveTextContent('名前を保存できません');
    expect(screen.getByRole('textbox')).toHaveValue('出展準備');
  });
});
