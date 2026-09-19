import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AISupportSettings } from './AISupportSettings';
import { DEFAULT_AI_SUPPORT, type AISupportProfile } from '@/lib/ai/support/profile';
const mock = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/lib/ai/support/client', () => ({ requestAISupport: mock.request }));
const wrap = (uid: string) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AISupportSettings key={uid} userId={uid} /></QueryClientProvider>;
beforeEach(() => { vi.resetAllMocks(); mock.request.mockImplementation(async (_uid: string, next?: AISupportProfile) => next ?? DEFAULT_AI_SUPPORT); });

describe('AI support settings', () => {
  it('saves optional wishes and references, displays the applied settings, and can disable or reset them', async () => {
    render(wrap('kozue'));
    fireEvent.change(await screen.findByLabelText('AIへの希望'), { target: { value: '次の一歩を先に' } });
    expect(screen.getByRole('region', { name: '特性の参考情報' })).toBeVisible();
    expect(screen.getByLabelText('ネイタルの結果')).toBeVisible();
    fireEvent.change(screen.getByLabelText('ネイタルの結果'), { target: { value: '太陽：牡羊座・1ハウス' } });
    fireEvent.change(screen.getByLabelText('MBTIのタイプ'), { target: { value: 'INTJ' } });
    fireEvent.change(screen.getByLabelText('ストレングスファインダー 1位'), { target: { value: '着想' } });
    fireEvent.change(screen.getByLabelText('ストレングスファインダー 2位'), { target: { value: '学習欲' } });
    fireEvent.change(screen.getByLabelText('仕事の表示'), { target: { value: 'overview' } });
    fireEvent.click(screen.getByRole('button', { name: '保存して反映' }));
    await screen.findByText(/保存しました/);
    expect(mock.request).toHaveBeenLastCalledWith('kozue', { ...DEFAULT_AI_SUPPORT, wishes: '次の一歩を先に', presentation: 'overview', references: { natal: '太陽：牡羊座・1ハウス', mbti: 'INTJ', strengths: ['着想', '学習欲', '', '', ''] } });
    expect(screen.getByText('本人の希望を優先：次の一歩を先に')).toBeVisible();
    fireEvent.click(screen.getByLabelText('個人化を使う'));
    fireEvent.click(screen.getByRole('button', { name: '保存して反映' }));
    await screen.findByText('個人化を使わず、標準の手伝い方を使います。');
    expect(screen.getByLabelText('ネイタルの結果')).toHaveValue('太陽：牡羊座・1ハウス');
    expect(screen.getByLabelText('MBTIのタイプ')).toHaveValue('INTJ');
    expect(screen.getByLabelText('仕事の表示')).toHaveAccessibleDescription(/行動から、短く。全体から、詳しく。/);
    fireEvent.click(screen.getByRole('button', { name: '標準に戻す' }));
    expect(screen.getByLabelText('AIへの希望')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: '保存して反映' }));
    await waitFor(() => expect(mock.request).toHaveBeenLastCalledWith('kozue', DEFAULT_AI_SUPPORT));
  });
  it('keeps an unsaved draft on a save failure, then isolates it when switching accounts', async () => {
    const { rerender } = render(wrap('kozue'));
    fireEvent.change(await screen.findByLabelText('AIへの希望'), { target: { value: '本人だけの入力' } });
    mock.request.mockRejectedValueOnce(new Error('保存できませんでした'));
    fireEvent.click(screen.getByRole('button', { name: '保存して反映' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('AIへの希望')).toHaveValue('本人だけの入力');
    rerender(wrap('other'));
    expect(await screen.findByLabelText('AIへの希望')).toHaveValue('');
  });
});

it('preserves earlier freeform reference records while saving the new fields', async () => {
  mock.request.mockImplementation(async (_uid: string, next?: AISupportProfile) => next ?? { ...DEFAULT_AI_SUPPORT, referenceNotes: '以前の大切なメモ' });
  render(wrap('kozue'));
  expect(await screen.findByLabelText('以前の参考資料')).toHaveValue('以前の大切なメモ');
  fireEvent.change(screen.getByLabelText('MBTIのタイプ'), { target: { value: 'INFP' } });
  fireEvent.click(screen.getByRole('button', { name: '保存して反映' }));
  await screen.findByText(/保存しました/);
  expect(mock.request).toHaveBeenLastCalledWith('kozue', expect.objectContaining({ referenceNotes: '以前の大切なメモ', references: { natal: '', mbti: 'INFP', strengths: [] } }));
});

it('imports a pasted result in order and saves it through the existing profile operation', async () => {
  render(wrap('kozue'));
  const input = await screen.findByLabelText('ストレングスファインダーの結果を貼り付け');
  const strengths = ['最上志向','調和性','規律性','公平性','親密性','責任感'];
  fireEvent.change(input, { target: { value: JSON.stringify({ strengths }) } });
  fireEvent.click(screen.getByRole('button', { name: '順位に取り込む' }));
  expect(screen.getByLabelText('ストレングスファインダー 1位')).toHaveValue('最上志向');
  expect(screen.getByLabelText('ストレングスファインダー 5位')).toHaveValue('親密性');
  expect(screen.getByLabelText('ストレングスファインダー 6位以降')).toHaveValue('責任感');
  expect(mock.request.mock.calls.filter(call => call[1])).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '保存して反映' }));
  await screen.findByText(/保存しました/);
  expect(mock.request).toHaveBeenLastCalledWith('kozue', expect.objectContaining({ references: { natal:'', mbti:'', strengths } }));
  fireEvent.change(input, { target: { value: '{"strengths":' } });
  fireEvent.click(screen.getByRole('button', { name: '順位に取り込む' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('JSON');
  expect(screen.getByLabelText('ストレングスファインダー 1位')).toHaveValue('最上志向');
});
