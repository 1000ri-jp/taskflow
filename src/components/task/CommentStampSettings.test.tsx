import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CommentStampSettings } from './CommentStampSettings';
import { CommentReactions } from './CommentReactions';
import { deleteCustomStamp, fetchCommentReactions, fetchStampSettings, putCommentReaction, putStampSettings, uploadCustomStamp } from '@/lib/comments/client';
import { MAX_STAMP_IMAGE_BYTES, type CommentReaction, type CustomSeenStamp } from '@/lib/comments/reactions';
vi.mock('@/lib/comments/client', () => ({ deleteCustomStamp: vi.fn(), fetchCommentReactions: vi.fn(), fetchStampSettings: vi.fn(), putCommentReaction: vi.fn(), putStampSettings: vi.fn(), uploadCustomStamp: vi.fn(), stampSettingsKey: (uid: string) => ['comment-stamp-settings', uid] }));
vi.mock('@/lib/firebase/testMode', () => ({ isE2EMockAuthEnabled: () => false }));
const old: CustomSeenStamp = { id: 'custom_10000000-0000-0000-0000-000000000001', name: 'お花の合図', imageUrl: 'https://firebasestorage.googleapis.com/old.png' };
const nextImage = 'https://firebasestorage.googleapis.com/new.png';
const target = { projectId: 'p', taskId: 't', commentId: 'c' };
const createObjectURL = vi.fn(() => 'blob:stamp-preview');
const revokeObjectURL = vi.fn();
const file = () => new File(['image'], 'original.png', { type: 'image/png' });
function mount(withComment = false) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CommentStampSettings userId="alice" />{withComment && <CommentReactions userId="alice" authorId="bob" {...target} />}</QueryClientProvider>);
}
async function fill() {
  await screen.findByRole('button', { name: 'めるる' });
  fireEvent.click(screen.getByRole('button', { name: 'オリジナルを追加' }));
  fireEvent.change(screen.getByLabelText('画像'), { target: { files: [file()] } });
  fireEvent.change(screen.getByLabelText('名前'), { target: { value: 'うちのこ' } });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
  createObjectURL.mockReturnValue('blob:stamp-preview');
  vi.mocked(fetchStampSettings).mockResolvedValue({ seenStampId: 'cat', customStamps: [] });
  vi.mocked(fetchCommentReactions).mockResolvedValue({ reactions: [], own: null, partial: false });
});
afterEach(() => vi.unstubAllGlobals());
it('adds an image and name only on save, immediately selects it for comments, and keeps historical images', async () => {
  const historical: CommentReaction = { userId: 'bob', displayName: 'Bob', marks: { seen: { stampId: old.id, customStamp: old, at: '2026-09-13T00:00:00Z' } } };
  vi.mocked(fetchCommentReactions).mockResolvedValue({ reactions: [historical], own: null, partial: false });
  vi.mocked(uploadCustomStamp).mockImplementation(async (_, input) => ({ seenStampId: input.id, customStamps: [{ id: input.id, name: input.name, imageUrl: nextImage }] }));
  mount(true); await fill();
  expect(uploadCustomStamp).not.toHaveBeenCalled();
  expect(putStampSettings).not.toHaveBeenCalled();
  expect(revokeObjectURL).not.toHaveBeenCalled();
  expect(screen.getByAltText('追加するスタンプのプレビュー')).toHaveAttribute('src', 'blob:stamp-preview');
  fireEvent.click(screen.getByRole('button', { name: '追加して使う' }));
  const selected = await screen.findByRole('button', { name: 'うちのこ' });
  expect(selected).toHaveAttribute('aria-pressed', 'true');
  expect(selected.querySelector('img')).toHaveAttribute('src', nextImage);
  const ownButton = screen.getByRole('button', { name: '見たよを付ける' });
  expect(ownButton.querySelector('img')).toHaveAttribute('src', nextImage);
  expect(screen.getByLabelText('Bob：見たよ（お花の合図）').querySelector('img')).toHaveAttribute('src', old.imageUrl);
  const id = vi.mocked(uploadCustomStamp).mock.calls[0][1].id;
  vi.mocked(putCommentReaction).mockResolvedValue({ reaction: { userId: 'alice', displayName: 'Alice', marks: { seen: { stampId: id, customStamp: { name: 'うちのこ', imageUrl: nextImage }, at: '2026-09-13T00:00:00Z' } } } });
  fireEvent.click(ownButton);
  await screen.findByRole('button', { name: '見たよを取り消す' });
  expect(putCommentReaction).toHaveBeenCalledWith('alice', { ...target, kind: 'seen', active: true, stampId: id });
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:stamp-preview');
  expect(screen.getByLabelText('名前')).toHaveValue('');
});
it('retains an uncertain upload and retries the same id once despite repeated clicks', async () => {
  let reject!: (error: Error) => void;
  vi.mocked(uploadCustomStamp).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  mount(); await fill();
  const button = screen.getByRole('button', { name: '追加して使う' });
  fireEvent.click(button); fireEvent.click(button);
  await waitFor(() => expect(uploadCustomStamp).toHaveBeenCalledTimes(1));
  await act(async () => reject(new Error('通信を確認できませんでした。')));
  expect(await screen.findByRole('alert')).toHaveTextContent('入力を残しています');
  expect(screen.getByLabelText('名前')).toHaveValue('うちのこ');
  expect(screen.getByAltText('追加するスタンプのプレビュー')).toBeVisible();
  vi.mocked(uploadCustomStamp).mockImplementation(async (_, input) => ({ seenStampId: input.id, customStamps: [{ id: input.id, name: input.name, imageUrl: nextImage }] }));
  fireEvent.click(button);
  await screen.findByRole('button', { name: 'うちのこ' });
  expect(vi.mocked(uploadCustomStamp).mock.calls[0]).toEqual(vi.mocked(uploadCustomStamp).mock.calls[1]);
});
it.each([
  new File(['<svg/>'], 'vector.svg', { type: 'image/svg+xml' }),
  new File([new Uint8Array(MAX_STAMP_IMAGE_BYTES + 1)], 'large.png', { type: 'image/png' }),
])('refuses an unsupported or oversized image before upload', async image => {
  mount(); await screen.findByRole('button', { name: 'めるる' });
  fireEvent.click(screen.getByRole('button', { name: 'オリジナルを追加' }));
  fireEvent.change(screen.getByLabelText('画像'), { target: { files: [image] } });
  expect(await screen.findByRole('alert')).toHaveTextContent('2MB以下');
  fireEvent.change(screen.getByLabelText('名前'), { target: { value: '名前' } });
  expect(screen.getByRole('button', { name: '追加して使う' })).toBeDisabled();
  expect(createObjectURL).not.toHaveBeenCalled(); expect(uploadCustomStamp).not.toHaveBeenCalled();
});
it('preserves the catalog when choosing an existing emoji and shows a readable fallback for a missing image', async () => {
  vi.mocked(fetchStampSettings).mockResolvedValue({ seenStampId: old.id, customStamps: [old] });
  vi.mocked(putStampSettings).mockResolvedValue({ seenStampId: 'meruru', customStamps: [old] });
  mount();
  const stampButton = await screen.findByRole('button', { name: old.name });
  fireEvent.error(stampButton.querySelector('img')!);
  expect(within(stampButton).getByText('?')).toBeVisible();
  expect(stampButton).toHaveAccessibleName(old.name);
  fireEvent.click(screen.getByRole('button', { name: 'めるる' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'めるる' })).toHaveAttribute('aria-pressed', 'true'));
  expect(screen.getByRole('button', { name: old.name })).toBeVisible();
});
it('confirms custom stamp removal, supports cancellation, and updates the favorite without changing historical marks', async () => {
  vi.mocked(fetchStampSettings).mockResolvedValue({ seenStampId: old.id, customStamps: [old] });
  vi.mocked(fetchCommentReactions).mockResolvedValue({ reactions: [{ userId: 'bob', displayName: 'Bob', marks: { seen: { stampId: old.id, customStamp: old, at: '2026-09-13T00:00:00Z' } } }], own: null, partial: false });
  vi.mocked(deleteCustomStamp).mockResolvedValue({ seenStampId: 'wave', customStamps: [] });
  mount(true);
  const remove = await screen.findByRole('button', { name: `「${old.name}」を削除` });
  expect(screen.queryByRole('button', { name: '「手をふる」を削除' })).not.toBeInTheDocument();
  fireEvent.click(remove);
  expect(screen.getByRole('alertdialog')).toHaveTextContent('選択中のスタンプは「手をふる」に戻ります');
  fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
  expect(deleteCustomStamp).not.toHaveBeenCalled(); expect(putStampSettings).not.toHaveBeenCalled();
  fireEvent.click(remove); fireEvent.click(screen.getByRole('button', { name: '削除する' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  expect(deleteCustomStamp).toHaveBeenCalledWith('alice', old.id);
  expect(screen.queryByRole('button', { name: old.name })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '手をふる' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByLabelText('Bob：見たよ（お花の合図）').querySelector('img')).toHaveAttribute('src', old.imageUrl);
  expect(putCommentReaction).not.toHaveBeenCalled();
});
it('keeps a failed removal visible and allows an unchanged retry', async () => {
  vi.mocked(fetchStampSettings).mockResolvedValue({ seenStampId: old.id, customStamps: [old] });
  vi.mocked(deleteCustomStamp).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ seenStampId: 'wave', customStamps: [] });
  mount(); fireEvent.click(await screen.findByRole('button', { name: `「${old.name}」を削除` }));
  fireEvent.click(screen.getByRole('button', { name: '削除する' }));
  expect(await within(screen.getByRole('alertdialog')).findByRole('alert')).toHaveTextContent('もう一度');
  fireEvent.click(screen.getByRole('button', { name: '削除する' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  expect(vi.mocked(deleteCustomStamp).mock.calls).toEqual([['alice', old.id], ['alice', old.id]]);
});
