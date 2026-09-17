import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GuidePreview, type PreviewOptions } from './GuidePreview';
import { UIGuide } from './UIGuide';
import PreviewPage from '@/app/ui-guide/preview/page';

const options: PreviewOptions = { sample: 'setting', long: true, many: false, disabled: false, selected: false, fetchState: 'ready', variant: 'standard' };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });


describe('guide adoption and implementation labels', () => {
  it('shows adopted scope separately from the feature task implementation report', () => {
    render(<GuidePreview {...options} sample="neo-brief-row-trial" />);
    expect(screen.getByText('ガイド内の試作・一部採用あり')).toBeInTheDocument();
    expect(screen.getByText(/採用済み範囲：NeoMorningBrief/)).toBeInTheDocument();
    expect(screen.getByText(/実画面への反映：前回の各4pxは実装・関連検証済み。最新の各2pxはメイン側bde4で実装・検証済み/)).toBeInTheDocument();
  });
});

describe('UI guide isolated interactions', () => {
  it('retains the edited value after failure, prevents repeat saves and retries without a request', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    render(<GuidePreview {...options} />);
    const select = screen.getByLabelText('主担当（新規タスクの初期値）');
    fireEvent.change(select, { target: { value: 'guide-ren' } });
    fireEvent.click(screen.getByRole('button', { name: '主担当を保存' }));
    expect(screen.getByRole('button', { name: '保存中…' })).toBeDisabled();
    await act(() => vi.advanceTimersByTimeAsync(900));
    expect(screen.getByRole('alert')).toHaveTextContent('保存できませんでした');
    expect(select).toHaveValue('guide-ren');
    fireEvent.click(screen.getByRole('button', { name: '主担当を保存' }));
    await act(() => vi.advanceTimersByTimeAsync(900));
    expect(screen.getByRole('status')).toHaveTextContent('保存しました');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('distinguishes load failure from empty and retries to show fake rows', () => {
    render(<GuidePreview {...options} sample="outline" fetchState="error" />);
    expect(screen.getByRole('alert')).toHaveTextContent('タスクを取得できませんでした');
    fireEvent.click(screen.getByRole('button', { name: '再取得' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getAllByText(/架空/).length).toBeGreaterThan(0);
  });

  it('can reopen the same fake task after closing its detail', () => {
    render(<GuidePreview {...options} sample="outline" long={false} />);
    const row = screen.getByRole('button', { name: '参加者向けの案内を仕上げる' });
    fireEvent.click(row);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(row);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('does not enable saves in read-only mode', () => {
    render(<GuidePreview {...options} disabled />);
    expect(screen.getByLabelText('主担当（新規タスクの初期値）')).toBeDisabled();
    expect(screen.getByRole('button', { name: '主担当を保存' })).toBeDisabled();
  });
});


describe('UI guide spacing controls reach their preview', () => {
  it('applies bubble padding through the preview URL and removes the override on reset', async () => {
    const guide = render(<UIGuide initialSample="bubble" />);
    fireEvent.click(screen.getByText('余白を試す'));
    expect(screen.queryByRole('slider', { name: '行の上下余白' })).not.toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: 'カードの上下余白' })).not.toBeInTheDocument();
    const slider = screen.getByRole('slider', { name: '吹き出しの内側余白' });
    expect(slider).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: '試作モード' }));
    fireEvent.change(slider, { target: { value: '24' } });
    const query = () => Object.fromEntries(new URL(guide.container.querySelector('iframe')!.src).searchParams);
    expect(query()).toMatchObject({ sample: 'bubble', bubbleSpace: '24' });
    expect(query()).not.toHaveProperty('cardSpace');
    expect(query()).not.toHaveProperty('rowSpace');
    const preview = render(await PreviewPage({ searchParams: Promise.resolve(query()) }));
    expect(preview.container.querySelector('[data-bubble-variant]')).toHaveStyle({ padding: '24px' });
    fireEvent.click(screen.getByRole('button', { name: '採用済み基準に戻す' }));
    expect(query()).not.toHaveProperty('bubbleSpace');
    preview.rerender(await PreviewPage({ searchParams: Promise.resolve(query()) }));
    expect(preview.container.querySelector('[data-bubble-variant]')?.getAttribute('style')).toBeNull();
    expect(slider).toBeDisabled();
  });

  it('offers compact-card padding only for the compact variant and ends trial when changing specimens', () => {
    render(<UIGuide initialSample="card" />);
    fireEvent.change(screen.getByRole('combobox', { name: 'バリエーション' }), { target: { value: 'compact' } });
    fireEvent.click(screen.getByText('余白を試す'));
    expect(screen.getByRole('slider', { name: 'カードの上下余白' })).toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: '行の上下余白' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: '試作モード' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'バリエーション' }), { target: { value: 'standard' } });
    expect(screen.queryByText('余白を試す')).not.toBeInTheDocument();
    expect(document.querySelector('iframe')?.src).not.toContain('cardSpace');
    fireEvent.change(screen.getByRole('combobox', { name: 'バリエーション' }), { target: { value: 'compact' } });
    fireEvent.click(screen.getByText('余白を試す'));
    expect(screen.getByRole('checkbox', { name: '試作モード' })).not.toBeChecked();
  });
});
