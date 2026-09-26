import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReferenceComment } from '@/types';
const mocks = vi.hoisted(() => ({ post: vi.fn(), change: vi.fn(), comments: [] as ReferenceComment[] }));
vi.mock('@/hooks/useReferenceComments', () => ({ useReferenceComments: () => ({ ...mocks, loading: false, error: '', reload: vi.fn() }) }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: (selector: (value: unknown) => unknown) => selector({ user: { id: 'editor', displayName: 'Editor' } }) }));
vi.mock('@/lib/firebase/storage', () => ({ uploadReferenceAttachment: vi.fn() }));
vi.mock('@/lib/firebase/testMode', () => ({ isE2EMockAuthEnabled: () => false }));
vi.mock('@/lib/firebase/firestore', () => ({ getUsersByIds: vi.fn().mockResolvedValue([{ id: 'older-user', displayName: '以前の投稿者', photoURL: null }]) }));
vi.mock('@/components/task/AttachmentPreview', () => ({ AttachmentPreview: () => null }));
import { ReferenceComments } from './ReferenceComments';
const props = { projectId: 'p', referenceId: 'r', legacyBody: 'https://example.com/guide', legacyLinks: [], legacyComment: '既存コメント', onLegacyBodyChange: vi.fn(), canEdit: true, onDirtyChange: vi.fn(), onBusyChange: vi.fn() };
describe('reference comment composer', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.comments = []; });
  it('retains failed input and retries with the same post ID', async () => {
    mocks.post.mockRejectedValueOnce(new Error('接続できません')).mockResolvedValueOnce(undefined);
    render(<ReferenceComments {...props} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'コメントを書く' }), { target: { value: '追加する内容' } });
    fireEvent.click(screen.getByRole('button', { name: '投稿' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('接続できません');
    expect(screen.getByRole('textbox', { name: 'コメントを書く' })).toHaveValue('追加する内容');
    const first = mocks.post.mock.calls[0][0];
    expect(first.authorLabel).toBe('Editor');
    fireEvent.click(screen.getByRole('button', { name: '同じ投稿を再試行' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'コメントを書く' })).toHaveValue(''));
    expect(mocks.post.mock.calls[1][0]).toEqual(first);
    expect(screen.getByText('既存コメント')).toBeInTheDocument();
  });
  it('locks during submission, preventing a second concurrent post', async () => {
    let finish!: () => void;
    mocks.post.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    render(<ReferenceComments {...props} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'コメントを書く' }), { target: { value: '一度だけ' } });
    fireEvent.click(screen.getByRole('button', { name: '投稿' }));
    fireEvent.click(screen.getByRole('button', { name: '投稿中…' }));
    expect(mocks.post).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'コメントを書く' })).toHaveValue(''));
  });
  it('viewer sees legacy history without a composer', () => {
    render(<ReferenceComments {...props} canEdit={false} />);
    expect(screen.getByText('既存コメント')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
  it('shows previous information as the first clickable comment and allows editing it', async () => {
    props.onLegacyBodyChange.mockResolvedValue(undefined);
    render(<ReferenceComments {...props} />);
    const link = screen.getByRole('link', { name: 'https://example.com/guide' });
    expect(link).toHaveAttribute('href', 'https://example.com/guide');
    expect(link.closest('article')).toHaveTextContent('最初のコメント');
    fireEvent.click(screen.getByRole('button', { name: '最初のコメントを編集' }));
    fireEvent.change(screen.getByRole('textbox', { name: '最初のコメントを編集' }), { target: { value: 'https://example.com/new' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(props.onLegacyBodyChange).toHaveBeenCalledWith('https://example.com/new'));
    expect(screen.getByRole('link', { name: 'https://example.com/new' })).toHaveAttribute('href', 'https://example.com/new');
  });
  it('keeps a Japanese explanation after a URL outside the link target', () => {
    render(<ReferenceComments {...props} legacyBody="https://tokyosupifes.com/list.html（詳細情報）" />);
    expect(screen.getByRole('link', { name: 'https://tokyosupifes.com/list.html' })).toHaveAttribute('href', 'https://tokyosupifes.com/list.html');
    expect(screen.getByText('（詳細情報）')).toBeVisible();
  });
  it('shows the author and posting time for new comments', () => {
    mocks.comments = [{ id: 'c', referenceId: 'r', authorId: 'editor', authorLabel: 'Kozue', content: '新しい情報', attachments: [], createdAt: new Date(2026, 8, 24, 21, 30), updatedAt: new Date(2026, 8, 24, 21, 30) }];
    render(<ReferenceComments {...props} />);
    expect(screen.getByText('Kozue')).toBeVisible();
    expect(screen.getByText('新しい情報')).toBeVisible();
    expect(screen.getByText('9/24 21:30')).toBeVisible();
  });
  it('resolves the author of an older comment without a saved display name', async () => {
    mocks.comments = [{ id: 'old', referenceId: 'r', authorId: 'older-user', content: '以前の投稿', attachments: [], createdAt: new Date(2026, 8, 24, 20), updatedAt: new Date(2026, 8, 24, 20) }];
    render(<ReferenceComments {...props} />);
    expect(await screen.findByText('以前の投稿者')).toBeVisible();
  });
});
