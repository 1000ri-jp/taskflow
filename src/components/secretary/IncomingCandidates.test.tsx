import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IncomingCandidates, incomingCandidatesStatus } from './IncomingCandidates';
import { emptySecretaryState, type SecretaryView } from '@/lib/secretary/types';
import { emptyGoogleSource } from '@/lib/google/workspace/types';
const now = '2026-09-10T10:00:00.000Z';
function view(): SecretaryView {
  return { mode: 'live', needsReview: true, state: emptySecretaryState(), snapshot: { userId: 'u', signature: 'tasks', checkedAt: now, tasks: [], coverage: { status: 'empty', issues: [], projects: 0, excludedProjects: 0 },
    incoming: { signature: 'scope', email: 'test@1000ri.jp', selections: { gmail: ['受信トレイ'], chat: [] }, sources: { gmail: { ...emptyGoogleSource(), connected: true, status: 'partial', fetchedAt: now }, chat: emptyGoogleSource() } } } };
}
afterEach(cleanup);
describe('Incoming candidate review UI', () => {
  it('keeps not-yet-reviewed, partial and failed states distinct from zero candidates', () => {
    const value = view(); const component = render(<IncomingCandidates view={value} />);
    expect(screen.getByRole('status')).toHaveTextContent('未整理 · 「AIで整理」で確認');
    expect(screen.getByRole('status')).toHaveTextContent('Gmail：一部取得');
    expect(screen.getByRole('status')).toBeVisible();
    expect(screen.queryByText('取得範囲に確認候補なし')).not.toBeInTheDocument();
    value.snapshot.incoming!.sources.gmail.status = 'error'; component.rerender(<IncomingCandidates view={value} />);
    expect(screen.getByRole('status')).toHaveTextContent('未確認 · Google連携を確認');
    expect(screen.getByRole('status')).toHaveTextContent('Gmail：取得エラー');
    expect(screen.getByText(/取得失敗・今回の整理対象外/)).not.toBeVisible();
  });
  it('shows a one-line scoped empty result and opens times, scope and limits only on request', () => {
    const value = view(); value.state.incomingReview = { signature: 'scope', reviewedAt: now, candidates: [], counts: { gmail: 0, chat: 0 } };
    render(<IncomingCandidates view={value} />);
    expect(screen.getByRole('status')).toHaveTextContent('取得範囲に確認候補なし');
    expect(screen.getByRole('status')).toHaveTextContent('Gmail：一部取得');
    expect(screen.getByText(/未取得の連絡は未確認/)).not.toBeVisible();
    expect(screen.getByText(/最終整理/)).not.toBeVisible();
    expect(screen.getByText(/各サービスの新しい順/)).not.toBeVisible();
    expect(screen.getByText('連絡の取得範囲')).toHaveTextContent(/^連絡の取得範囲$/);
    fireEvent.click(screen.getByText('連絡の取得範囲'));
    expect(screen.getByText(/未取得の連絡は未確認/)).toBeVisible();
    expect(screen.getByText(/最終整理/)).toBeVisible();
    expect(screen.getByText(/各サービスの新しい順/)).toBeVisible();
    expect(screen.getByText(/対象：受信トレイ/)).toBeVisible();
  });
  it.each([
    { source: { connected: false }, expected: '未確認 · Google連携を確認' },
    { source: { status: 'selection_required' as const, fetchedAt: null }, expected: 'Gmail：対象未選択' },
    { source: { status: 'pending' as const, fetchedAt: null }, expected: 'Gmail：未取得' },
    { source: { status: 'ready' as const, fetchedAt: '2026-09-10T06:00:00.000Z' }, expected: 'Gmail：情報が古い・更新が必要' },
  ])('keeps unavailable data distinct from an empty review: $expected', ({ source, expected }) => {
    const value = view(); Object.assign(value.snapshot.incoming!.sources.gmail, source);
    value.state.incomingReview = { signature: 'scope', reviewedAt: now, candidates: [], counts: { gmail: 0, chat: 0 } };
    render(<IncomingCandidates view={value} />);
    expect(screen.getByRole('status')).toHaveTextContent(expected);
    expect(screen.getByRole('status')).not.toHaveTextContent('確認候補なし');
  });
  it('renders escaped exact evidence, source links and more candidates without action controls', () => {
    const value = view(); value.state.incomingReview = { signature: 'scope', reviewedAt: now, counts: { gmail: 4, chat: 0 }, candidates: Array.from({ length: 4 }, (_, i) => ({
      id: `c${i}`, title: `連絡${i}`, kind: 'reply', reason: '返信済みか確認', uncertainties: ['未確認'], deadline: '9月12日', matchedTaskKeys: [],
      evidence: [{ service: 'gmail', id: `m${i}`, title: '原稿', at: now, sourceName: '架空の送信者', quote: '<script>9月12日まで</script>', url: `https://mail.google.com/mail/#all/t${i}` }],
    })) };
    const { container } = render(<IncomingCandidates view={value} />);
    expect(screen.getAllByRole('article')).toHaveLength(3); expect(container.querySelector('script')).toBeNull();
    fireEvent.click(screen.getAllByText(/原文・元の連絡を確認/)[0]);
    expect(screen.getAllByRole('link', { name: '元のメールを開く' })[0]).toHaveAttribute('href', 'https://mail.google.com/mail/#all/t0');
    expect(screen.queryByRole('button', { name: 'それで' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '残りの連絡候補1件を見る' }));
    expect(screen.getAllByRole('article')).toHaveLength(4);
    value.snapshot.incoming!.signature = 'different-scope';
    cleanup(); render(<IncomingCandidates view={value} />);
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
  it('keeps personal actions accessible without acting when details open', () => {
    const value = view(); const onAction = vi.fn();
    value.state.incomingReview = { signature: 'scope', reviewedAt: now, counts: { gmail: 1, chat: 0 }, candidates: [{
      id: 'c1', title: '原稿の返信済みか確認', kind: 'reply', reason: '修正への返答を確認', uncertainties: [], deadline: null, matchedTaskKeys: [],
      evidence: [{ service: 'gmail', id: 'm1', title: '原稿', at: now, sourceName: '架空の送信者', quote: '返信をお願いします', url: 'https://mail.google.com/mail/#all/t1' }],
    }] };
    render(<IncomingCandidates view={value} onAction={onAction} />);
    expect(screen.getByRole('status')).toHaveTextContent('確認候補 1件');
    expect(screen.getByRole('button', { name: '返信案' })).toBeVisible();
    expect(screen.getByRole('button', { name: '対応済み' })).not.toBeVisible();
    fireEvent.click(screen.getByText('整理', { exact: true }));
    expect(screen.getByRole('button', { name: '対応済み' })).toBeVisible();
    expect(screen.getByRole('button', { name: '保留' })).toBeVisible();
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保留' }));
    expect(onAction).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kind: 'incoming', action: 'hold', candidateId: 'c1', revision: value.state.revision }));
  });
  it('keeps the shared Google heading concise while retaining coverage in a mock heading', () => {
    const value = view();
    expect(incomingCandidatesStatus(value, { includeCoverage: false })).toBe('メール・Chat：未整理 · 「AIで整理」で確認');
    expect(incomingCandidatesStatus(value)).toContain('Gmail：一部取得');
    value.state.incomingReview = { signature: 'scope', reviewedAt: now, counts: { gmail: 0, chat: 0 }, candidates: [] };
    expect(incomingCandidatesStatus(value, { includeCoverage: false })).toBe('メール・Chat：取得範囲に確認候補なし');
    value.snapshot.incoming!.sources.gmail.status = 'error';
    expect(incomingCandidatesStatus(value)).toContain('Gmail：取得エラー');
    expect(incomingCandidatesStatus(value, { includeCoverage: false })).toBe('メール・Chat：未確認 · Google連携を確認');
    expect(incomingCandidatesStatus(value)).not.toContain('確認候補なし');
    delete value.snapshot.incoming;
    expect(incomingCandidatesStatus(value)).toBeNull();
    value.incomingStorage = { count: 2, inactive: 2, heldInactive: 1 };
    expect(incomingCandidatesStatus(value)).toBe('メール・Chat：取得対象外の記録 2件');
  });
  it('embeds candidates, actions and exact source links under one Google disclosure without a duplicate header', () => {
    const value = view(); const onAction = vi.fn();
    value.state.incomingReview = { signature: 'scope', reviewedAt: now, counts: { gmail: 1, chat: 0 }, candidates: [{
      id: 'c1', title: '原稿の返信確認', kind: 'reply', reason: '返答の依頼があります', uncertainties: [], deadline: null, matchedTaskKeys: [],
      evidence: [{ service: 'gmail', id: 'm1', title: '原稿', at: now, sourceName: '架空の送信者', quote: '原稿への返答をお願いします', url: 'https://mail.google.com/mail/#all/t1' }],
    }] };
    render(<details><summary>Google連携・取得状況 {incomingCandidatesStatus(value)}</summary><IncomingCandidates embedded view={value} onAction={onAction} /></details>);
    const heading = screen.getByText(/Google連携・取得状況/);
    expect(heading).toHaveTextContent('確認候補 1件');
    expect(heading).toHaveTextContent('Gmail：一部取得');
    expect(heading).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'メール・Chat' })).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('原稿の返信確認')).not.toBeVisible();
    expect(screen.getByText('連絡の取得範囲')).not.toBeVisible();
    fireEvent.click(heading);
    expect(screen.getByText('原稿の返信確認')).toBeVisible();
    expect(screen.getByText('連絡の取得範囲')).toBeVisible();
    fireEvent.click(screen.getByText(/原文・元の連絡を確認/));
    expect(screen.getByRole('link', { name: '元のメールを開く' })).toHaveAttribute('href', 'https://mail.google.com/mail/#all/t1');
    expect(screen.getByText('原稿への返答をお願いします')).toBeVisible();
    fireEvent.click(screen.getByText('整理', { exact: true }));
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '対応済み' }));
    expect(onAction).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kind: 'incoming', action: 'done', candidateId: 'c1', revision: value.state.revision }));
  });
  it('keeps inactive records and their delete action inside an optional disclosure', () => {
    const value = view(); const onAction = vi.fn(); delete value.snapshot.incoming;
    value.incomingStorage = { count: 3, inactive: 3, heldInactive: 1 };
    render(<IncomingCandidates view={value} onAction={onAction} />);
    const remove = screen.getByRole('button', { name: '取得対象外の記録を削除（保留を含む）' });
    expect(remove).not.toBeVisible();
    fireEvent.click(screen.getByText('連絡の保存記録 3件'));
    expect(remove).toBeVisible(); expect(onAction).not.toHaveBeenCalled();
    fireEvent.click(remove);
    expect(onAction).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kind: 'incoming', action: 'forget_inactive', revision: value.state.revision }));
  });
});
