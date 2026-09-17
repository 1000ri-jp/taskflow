import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CommentReactions } from './CommentReactions';
import { CommentStampSettings } from './CommentStampSettings';
import { fetchCommentReactions, fetchStampSettings, putCommentReaction, putStampSettings } from '@/lib/comments/client';
import type { CommentReaction } from '@/lib/comments/reactions';
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => vi.unstubAllGlobals());
vi.mock('@/lib/comments/client', () => ({ fetchCommentReactions: vi.fn(), fetchStampSettings: vi.fn(), putCommentReaction: vi.fn(), putStampSettings: vi.fn(), uploadCustomStamp: vi.fn(), stampSettingsKey: (uid: string) => ['comment-stamp-settings', uid] }));
const target = { projectId: 'p', taskId: 't', commentId: 'c' };
const row = (userId: string): CommentReaction => ({ userId, displayName: userId, marks: { seen: { stampId: 'flower', at: '2026-09-11T00:00:00Z' } } });
const mount = (settings = false, authorId = 'bob') => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{settings ? <CommentStampSettings userId="alice" /> : <CommentReactions userId="alice" authorId={authorId} {...target} />}</QueryClientProvider>);
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fetchCommentReactions).mockResolvedValue({ own: null, reactions: [row('bob')], partial: false });
  vi.mocked(fetchStampSettings).mockResolvedValue({ seenStampId: 'cat' });
});
it('offers seen directly, uses a favorite, and changes only own reaction after an explicit click', async () => {
  vi.mocked(putCommentReaction).mockResolvedValue({ reaction: row('alice') });
  mount();
  expect(screen.getByRole('button', { name: '見たよを付ける' })).toBeVisible();
  expect(putCommentReaction).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByRole('button', { name: '見たよを付ける' })).toBeEnabled());
  expect(putCommentReaction).not.toHaveBeenCalled();
  expect(within(screen.getByLabelText('付いているスタンプ')).getByLabelText('bob：見たよ')).toBeVisible();
  expect(screen.queryByText('bob')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '見たよを付ける' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '見たよを取り消す' })).toBeEnabled());
  expect(putCommentReaction).toHaveBeenCalledWith('alice', { ...target, kind: 'seen', active: true, stampId: 'cat' });
  vi.mocked(putCommentReaction).mockResolvedValue({ reaction: null });
  fireEvent.click(screen.getByRole('button', { name: '見たよを取り消す' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '見たよを付ける' })).toBeEnabled());
  expect(screen.getByLabelText('bob：見たよ')).toBeVisible(); expect(screen.queryByLabelText('alice：見たよ')).not.toBeInTheDocument();
  expect(putCommentReaction).toHaveBeenLastCalledWith('alice', { ...target, kind: 'seen', active: false, stampId: 'flower' });
});
it('shows favorite failures beside the direct seen button and allows retry without opening the picker', async () => {
  vi.mocked(fetchStampSettings).mockRejectedValueOnce(new Error('offline'));
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('見たよの絵柄を取得できませんでした');
  expect(screen.getByRole('button', { name: '見たよを付ける' })).toBeDisabled();
  expect(putCommentReaction).not.toHaveBeenCalled();
  vi.mocked(fetchStampSettings).mockResolvedValue({ seenStampId: 'cat' });
  fireEvent.click(screen.getByRole('button', { name: '再取得' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '見たよを付ける' })).toBeEnabled());
  expect(putCommentReaction).not.toHaveBeenCalled();
});
it('guards rapid clicks and retries the same desired state after an uncertain response', async () => {
  let reject!: (error: Error) => void;
  vi.mocked(putCommentReaction).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  mount(); fireEvent.click(screen.getByRole('button', { name: 'スタンプを選ぶ' })); await waitFor(() => expect(screen.getByRole('button', { name: 'ありがとうを付ける' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'ありがとうを付ける' }));
  fireEvent.click(screen.getByRole('button', { name: 'ありがとうを付ける' }));
  await waitFor(() => expect(putCommentReaction).toHaveBeenCalledTimes(1));
  await act(async () => reject(new Error('ack lost')));
  expect(screen.getByRole('button', { name: 'やったねを付ける' })).toBeDisabled();
  vi.mocked(putCommentReaction).mockResolvedValue({ reaction: { ...row('alice'), marks: { thanks: { stampId: 'thanks', at: '2026-09-11T00:00:00Z' } } } });
  fireEvent.click(screen.getByRole('button', { name: '同じ操作を再試行' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'ありがとうを取り消す' })).toBeEnabled());
  expect(vi.mocked(putCommentReaction).mock.calls[0]).toEqual(vi.mocked(putCommentReaction).mock.calls[1]);
});
it('distinguishes failed reads from empty results and never writes just by opening', async () => {
  vi.mocked(fetchCommentReactions).mockRejectedValue(new Error('permission'));
  mount(); await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'スタンプを選ぶ' }));
  expect(screen.getByRole('button', { name: '見たよを付ける' })).toBeDisabled();
  expect(putCommentReaction).not.toHaveBeenCalled();
  vi.mocked(fetchCommentReactions).mockResolvedValue({ own: null, reactions: [], partial: false });
  fireEvent.click(screen.getByRole('button', { name: 'スタンプを再取得' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '見たよを付ける' })).toBeEnabled());
});
it('does not request offscreen comments', async () => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  try { mount(); await act(async () => {}); expect(fetchCommentReactions).not.toHaveBeenCalled(); expect(fetchStampSettings).not.toHaveBeenCalled(); }
  finally { vi.unstubAllGlobals(); }
});
it('saves a favorite only after an explicit choice and keeps failure visible', async () => {
  mount(true);
  await screen.findByRole('button', { name: 'めるる' });
  expect(putStampSettings).not.toHaveBeenCalled();
  vi.mocked(putStampSettings).mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(screen.getByRole('button', { name: 'めるる' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: 'ねこ' })).toHaveAttribute('aria-pressed', 'true');
  vi.mocked(putStampSettings).mockResolvedValue({ seenStampId: 'meruru' });
  fireEvent.click(screen.getByRole('button', { name: 'めるる' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'めるる' })).toHaveAttribute('aria-pressed', 'true'));
  expect(putStampSettings).toHaveBeenLastCalledWith('alice', 'meruru');
});

it.each([false, true])('hides self-seen controls and marks on own posts while preserving received stamps (legacy self-seen: %s)', async legacySelfSeen => {
  const own = legacySelfSeen ? row('alice') : null;
  vi.mocked(fetchCommentReactions).mockResolvedValue({ own, reactions: [row('bob'), ...(own ? [own] : [])], partial: false });
  mount(false, 'alice');
  expect(screen.queryByRole('button', { name: /見たよ/ })).not.toBeInTheDocument();
  expect(await screen.findByLabelText('bob：見たよ')).toBeVisible();
  expect(screen.queryByLabelText('alice：見たよ')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /見たよ/ })).not.toBeInTheDocument();
  expect(fetchStampSettings).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'スタンプを選ぶ' }));
  expect(screen.getByRole('button', { name: 'ありがとうを付ける' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'スタンプを再取得' })).toBeVisible();
  expect(screen.queryByRole('link', { name: '見たよの絵柄を選ぶ' })).not.toBeInTheDocument();
  expect(putCommentReaction).not.toHaveBeenCalled();
});
