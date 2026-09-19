import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SecretaryReschedule } from './SecretaryReschedule';

const open = () => fireEvent.click(screen.getByRole('button', { name: '期限変更: 案内' }));
const calendar = () => fireEvent.click(screen.getByRole('button', { name: 'カレンダーから日付を選ぶ' }));

describe('Secretary deadline change', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-15T03:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  it.each([
    ['2026-09-14T15:30:00Z', '2026-09-16', '2026-09-17'],
    ['2026-09-30T03:00:00Z', '2026-10-01', '2026-10-02'],
    ['2026-12-31T03:00:00Z', '2027-01-01', '2027-01-02'],
  ])('prepares tomorrow and the day after in Japan from %s without saving immediately', async (now, tomorrow, dayAfter) => {
    vi.setSystemTime(new Date(now));
    const save = vi.fn().mockResolvedValue(true);
    render(<SecretaryReschedule title="案内" dueDate={null} disabled={false} onSave={save} />);
    for (const [label, day] of [['明日', tomorrow], ['明後日', dayAfter]]) {
      save.mockClear(); open();
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true');
      expect(save).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: '期限を変更' }));
      expect(save).toHaveBeenCalledExactlyOnceWith(day);
      await waitFor(() => expect(screen.queryByRole('button', { name: 'カレンダーから日付を選ぶ' })).not.toBeInTheDocument());
    }
  });

  it.each([['来週', '2026-09-21'], ['来月', '2026-10-01']])('saves the correct date from the short %s label', async (label, day) => {
    const save = vi.fn().mockResolvedValue(true);
    render(<SecretaryReschedule title="案内" dueDate={null} disabled={false} onSave={save} />);
    open();
    expect(screen.queryByLabelText('新しい期限')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '期限のカレンダー' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '期限を変更' }));
    expect(save).toHaveBeenCalledExactlyOnceWith(day);
    await waitFor(() => expect(screen.queryByRole('button', { name: '戻る' })).not.toBeInTheDocument());
  });

  it('blocks quick dates before the start and allows correcting them through the calendar', () => {
    const save = vi.fn();
    render(<SecretaryReschedule title="案内" startDate="2026-09-20T00:00:00Z" dueDate={null} disabled={false} onSave={save} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: '明日' }));
    expect(screen.getByRole('alert')).toHaveTextContent('開始日（9/20）以降');
    expect(screen.getByRole('button', { name: '期限を変更' })).toBeDisabled();
    calendar();
    expect(screen.getByRole('button', { name: '2026年9月19日' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '2026年9月21日' }));
    expect(screen.queryByRole('region', { name: '期限のカレンダー' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '期限を変更' })).toBeEnabled();
    expect(save).not.toHaveBeenCalled();
  });

  it('opens a calendar from the icon, keeps the current date selected, and saves only after confirmation', async () => {
    const save = vi.fn().mockResolvedValue(true);
    render(<SecretaryReschedule title="案内" dueDate="2026-10-01T00:00:00Z" disabled={false} onSave={save} />);
    open(); calendar();
    expect(screen.getByRole('button', { name: '2026年10月1日' })).toHaveAttribute('data-selected-single', 'true');
    fireEvent.click(screen.getByRole('button', { name: '2026年10月5日' }));
    expect(screen.queryByRole('region', { name: '期限のカレンダー' })).not.toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '期限を変更' }));
    expect(save).toHaveBeenCalledExactlyOnceWith('2026-10-05');
    await waitFor(() => expect(screen.queryByRole('button', { name: '戻る' })).not.toBeInTheDocument());
  });

  it('keeps the selected calendar date when saving fails', async () => {
    const save = vi.fn().mockResolvedValue(false);
    render(<SecretaryReschedule title="案内" dueDate={null} disabled={false} onSave={save} />);
    open(); calendar();
    fireEvent.click(screen.getByRole('button', { name: '2026年9月25日' }));
    fireEvent.click(screen.getByRole('button', { name: '期限を変更' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('入力した日付は保持しています');
    calendar();
    expect(screen.getByRole('button', { name: '2026年9月25日' })).toHaveAttribute('data-selected-single', 'true');
  });
});
