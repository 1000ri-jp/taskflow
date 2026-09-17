import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyGoogleWorkspace, type GoogleSource, type GoogleWorkspaceView } from '@/lib/google/workspace/types';
import { GoogleWorkspaceSummary } from './GoogleWorkspacePanel';

const google = vi.hoisted(() => ({
  data: undefined as GoogleWorkspaceView | undefined, loading: false, busy: false, error: null as string | null,
  refreshMinutes: 15, refresh: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), select: vi.fn(), request: vi.fn(),
}));
vi.mock('@/hooks/useGoogleWorkspace', () => ({ useGoogleWorkspace: () => google }));
vi.mock('@/components/secretary/SecretaryRefreshSettings', () => ({ SecretaryRefreshSettings: () => null }));

const fetchedAt = '2026-09-12T01:00:00.000Z';
function readyWorkspace() {
  const data = emptyGoogleWorkspace(true);
  for (const source of Object.values(data.sources)) Object.assign(source, { connected: true, status: 'ready', fetchedAt });
  data.sources.gmail.items = [1, 2].map(id => ({ id: `mail-${id}`, title: '確認依頼', text: '架空のメール',
    at: fetchedAt, url: `https://example.test/mail/${id}`, sourceName: '検証用' }));
  return data;
}
const summary = () => screen.getByText('Google連携・取得状況').closest('summary')!;
const expectNoActions = () => {
  for (const action of [google.refresh, google.connect, google.disconnect, google.select, google.request]) expect(action).not.toHaveBeenCalled();
};
beforeEach(() => {
  vi.clearAllMocks(); google.data = readyWorkspace(); google.loading = false; google.busy = false;
  google.error = null; google.refreshMinutes = 15;
});

describe('Google workspace summary disclosure', () => {
  it('preserves the default summary with counts, refresh and interval visible', () => {
    render(<GoogleWorkspaceSummary />);
    expect(screen.getByText('Gmail：2件取得済み')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Googleの情報を更新' })).toBeVisible();
    expect(screen.getByText(/自動取得：15分ごと/)).toBeVisible();
    expect(screen.queryByText('Google連携・取得状況')).not.toBeInTheDocument();
    expectNoActions();
  });

  it('keeps counts and controls inside the disclosure and changes no retrieval behavior on open or close', () => {
    render(<GoogleWorkspaceSummary collapsible />);
    expect(summary()).toHaveTextContent(/^Google連携・取得状況$/);
    expect(screen.getByText('Gmail：2件取得済み')).not.toBeVisible();
    expect(screen.getByText(/自動取得：15分ごと/)).not.toBeVisible();
    expect(screen.getByRole('button', { name: 'Googleの情報を更新' })).not.toBeVisible();
    fireEvent.click(summary());
    expect(screen.getByText('Gmail：2件取得済み')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Googleの情報を更新' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Google連携' })).toHaveAttribute('href', '/settings/google');
    expect(screen.getByText(/自動取得：15分ごと/)).toBeVisible();
    fireEvent.click(summary());
    expect(screen.getByText('Gmail：2件取得済み')).not.toBeVisible();
    expectNoActions();
  });

  it('keeps candidate status beside retrieval problems while children and Google settings share its disclosure', () => {
    const action = vi.fn();
    google.data!.sources.gmail.status = 'partial';
    render(<GoogleWorkspaceSummary collapsible extraStatus="メール・Chat：確認候補 2件"><p>原稿の返信確認</p><a href="https://mail.google.com/mail/#all/t1">元のメール</a><button onClick={action}>連絡の整理</button><label>Googleの取得間隔<input defaultValue="15" /></label></GoogleWorkspaceSummary>);
    expect(summary()).toHaveTextContent('確認候補 2件');
    expect(summary()).toHaveTextContent('一部取得');
    expect(screen.getByText('原稿の返信確認')).not.toBeVisible();
    expect(screen.getByRole('link', { name: '元のメール' })).not.toBeVisible();
    expect(screen.getByText('Googleの取得間隔')).not.toBeVisible();
    fireEvent.click(summary());
    expect(screen.getByText('原稿の返信確認')).toBeVisible();
    expect(screen.getByRole('link', { name: '元のメール' })).toHaveAttribute('href', 'https://mail.google.com/mail/#all/t1');
    expect(screen.getByText('Googleの取得間隔')).toBeVisible();
    expect(action).not.toHaveBeenCalled();
    expectNoActions();
    fireEvent.click(screen.getByRole('button', { name: '連絡の整理' }));
    expect(action).toHaveBeenCalledOnce();
    fireEvent.click(summary());
    expect(screen.getByText('原稿の返信確認')).not.toBeVisible();
    expect(summary()).toHaveTextContent('確認候補 2件');
    expectNoActions();
  });

  it('also renders supplied candidate status and children in the non-collapsible summary', () => {
    render(<GoogleWorkspaceSummary extraStatus="メール・Chat：未整理"><p>連絡の取得範囲</p></GoogleWorkspaceSummary>);
    expect(screen.getByRole('status')).toHaveTextContent('メール・Chat：未整理');
    expect(screen.getByText('連絡の取得範囲')).toBeVisible();
    expectNoActions();
  });

  it.each<{ patch: Partial<GoogleSource>; status: string }>([
    { patch: { connected: false, status: 'disconnected', fetchedAt: null }, status: '未接続' },
    { patch: { status: 'selection_required', fetchedAt: null }, status: '取得対象が未選択' },
    { patch: { status: 'pending', fetchedAt: null }, status: '未取得' },
    { patch: { status: 'ready', fetchedAt: null }, status: '未取得' },
    { patch: { status: 'partial' }, status: '一部取得' },
    { patch: { status: 'error', fetchedAt: null }, status: '取得エラー' },
    { patch: { status: 'error' }, status: '更新失敗・前回の情報' },
  ])('shows $status while closed, independently of cached item counts', ({ patch, status }) => {
    Object.assign(google.data!.sources.gmail, patch);
    render(<GoogleWorkspaceSummary collapsible />);
    expect(summary()).toHaveTextContent(status);
    expect(summary()).not.toHaveTextContent('2件');
    expectNoActions();
  });

  it('keeps different coverage issues visible together, without repeating shared statuses', () => {
    google.data!.sources.calendar.status = 'partial';
    google.data!.sources.gmail.status = 'partial';
    google.data!.sources.chat.connected = false;
    render(<GoogleWorkspaceSummary collapsible />);
    expect(summary()).toHaveTextContent('一部取得 ／ 未接続');
    expect(summary().textContent?.match(/一部取得/g)).toHaveLength(1);
    expectNoActions();
  });

  it('shows a failed workspace retrieval even with prior ready data', () => {
    google.error = '現在のGoogle情報を取得できません。';
    render(<GoogleWorkspaceSummary collapsible />);
    expect(summary()).toHaveTextContent('取得エラー');
    fireEvent.click(summary());
    expect(screen.getByRole('alert')).toHaveTextContent(google.error);
    expectNoActions();
  });

  it('distinguishes initial loading from information that remains unverified', () => {
    google.data = undefined; google.loading = true;
    const { rerender } = render(<GoogleWorkspaceSummary collapsible />);
    expect(summary()).toHaveTextContent('確認中');
    google.loading = false;
    rerender(<GoogleWorkspaceSummary collapsible />);
    expect(summary()).toHaveTextContent('未確認');
    expectNoActions();
  });

  it('shows updating and setup availability without hiding existing coverage gaps', () => {
    google.busy = true; google.data!.configured = false; google.data!.sources.gmail.status = 'partial';
    render(<GoogleWorkspaceSummary collapsible />);
    expect(summary()).toHaveTextContent('更新中 ／ 連携準備中 ／ 一部取得');
    fireEvent.click(summary());
    expect(screen.getByRole('button', { name: '確認中…' })).toBeDisabled();
    expectNoActions();
  });

  it('only invokes the existing refresh action when the opened refresh button is explicitly pressed', () => {
    render(<GoogleWorkspaceSummary collapsible />);
    fireEvent.click(summary());
    expectNoActions();
    fireEvent.click(screen.getByRole('button', { name: 'Googleの情報を更新' }));
    expect(google.refresh).toHaveBeenCalledOnce();
    expect(google.connect).not.toHaveBeenCalled();
  });
});
