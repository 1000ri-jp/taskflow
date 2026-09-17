import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CompanionScheduleSettings } from './CompanionScheduleSettings';

const mocks = vi.hoisted(() => ({ save: vi.fn(), preview: vi.fn(), settings: { enabled: true, entries: [{ id: 'morning', enabled: true, time: '09:00', message: 'おはようございます' }] } }));
vi.mock('@/hooks/useCompanionSchedule', () => ({
  useCompanionScheduleSettings: () => ({ settings: mocks.settings, saveSettings: mocks.save }),
  previewCompanionGreeting: mocks.preview,
}));
beforeEach(() => {
  mocks.save.mockReset(); mocks.preview.mockReset();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => vi.unstubAllGlobals());

it('previews an unsaved message without saving a schedule', () => {
  render(<CompanionScheduleSettings userId="me" />);
  fireEvent.change(screen.getByRole('textbox', { name: '声かけ1のメッセージ' }), { target: { value: '休憩しましょう' } });
  fireEvent.click(screen.getByRole('button', { name: '声かけ1の表示を試す' }));
  expect(mocks.preview).toHaveBeenCalledWith('me', '休憩しましょう');
  expect(mocks.save).not.toHaveBeenCalled();
});

it('keeps a changed time and message after a storage failure and lets the user retry', () => {
  mocks.save.mockImplementationOnce(() => { throw new Error('保存できませんでした'); });
  render(<CompanionScheduleSettings userId="me" />);
  fireEvent.change(screen.getByLabelText('声かけ1の時刻'), { target: { value: '09:30' } });
  fireEvent.change(screen.getByRole('textbox', { name: '声かけ1のメッセージ' }), { target: { value: '今日もよろしくお願いします' } });
  fireEvent.click(screen.getByRole('button', { name: '声かけの設定を保存' }));
  expect(screen.getByRole('alert')).toHaveTextContent('保存できませんでした');
  expect(screen.getByLabelText('声かけ1の時刻')).toHaveValue('09:30');
  expect(screen.getByRole('textbox', { name: '声かけ1のメッセージ' })).toHaveValue('今日もよろしくお願いします');
  fireEvent.click(screen.getByRole('button', { name: '声かけの設定を保存' }));
  expect(mocks.save).toHaveBeenLastCalledWith({ enabled: true, targetDays: ['weekday'], entries: [{ id: 'morning', enabled: true, time: '09:30', message: '今日もよろしくお願いします' }] });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('保存しました');
});

it('requires an explicit save before disabling greetings', () => {
  render(<CompanionScheduleSettings userId="me" />);
  fireEvent.click(screen.getByRole('switch', { name: '定時の声かけ' }));
  expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '声かけの設定を保存' }));
  expect(mocks.save).toHaveBeenCalledWith({ ...mocks.settings, targetDays: ['weekday'], enabled: false });
});

it('combines target days and saves them without changing the existing greetings', () => {
  render(<CompanionScheduleSettings userId="me" />);
  expect(screen.getByRole('checkbox', { name: '平日' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: '土日' })).not.toBeChecked();
  expect(screen.getByRole('checkbox', { name: '祝日' })).not.toBeChecked();
  fireEvent.click(screen.getByRole('checkbox', { name: '土日' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '祝日' }));
  expect(screen.getByRole('checkbox', { name: '平日' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: '土日' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: '祝日' })).toBeChecked();
  expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '声かけの設定を保存' }));
  expect(mocks.save).toHaveBeenLastCalledWith({ ...mocks.settings, targetDays: ['weekday', 'weekend', 'holiday'] });
});
