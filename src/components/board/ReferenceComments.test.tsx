import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ post: vi.fn(), change: vi.fn(), comments: [] }));
vi.mock('@/hooks/useReferenceComments', () => ({ useReferenceComments: () => ({ ...mocks, loading: false, error: '', reload: vi.fn() }) }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: (selector: (value: unknown) => unknown) => selector({ user: { id: 'editor', displayName: 'Editor' } }) }));
vi.mock('@/lib/firebase/storage', () => ({ uploadReferenceAttachment: vi.fn() }));
vi.mock('@/lib/firebase/testMode', () => ({ isE2EMockAuthEnabled: () => false }));
vi.mock('@/components/task/AttachmentPreview', () => ({ AttachmentPreview: () => null }));
import { ReferenceComments } from './ReferenceComments';
const props = { projectId: 'p', referenceId: 'r', legacyComment: '既存コメント', canEdit: true, onDirtyChange: vi.fn(), onBusyChange: vi.fn() };
describe('reference comment composer', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('retains failed input and retries with the same post ID', async () => {
    mocks.post.mockRejectedValueOnce(new Error('接続できません')).mockResolvedValueOnce(undefined);
    render(<ReferenceComments {...props} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'コメントを書く' }), { target: { value: '追加する内容' } });
    fireEvent.click(screen.getByRole('button', { name: '投稿' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('接続できません');
    expect(screen.getByRole('textbox', { name: 'コメントを書く' })).toHaveValue('追加する内容');
    const first = mocks.post.mock.calls[0][0];
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
});
