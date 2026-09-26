import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ references: [] as unknown[], create: vi.fn(), update: vi.fn(), archive: vi.fn(), canEdit: true }));
vi.mock('@/hooks/useListReferences', () => ({ useListReferences: () => ({ ...mocks, isLoading: false, error: null }), isSafeReferenceUrl: () => true }));
vi.mock('@/hooks/useProjects', () => ({ useProject: () => ({ project: { ownerId: 'editor' }, members: [] }) }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: { id: mocks.canEdit ? 'editor' : 'viewer' } }) }));
vi.mock('@/lib/firebase/testMode', () => ({ isE2EMockAuthEnabled: () => false }));
vi.mock('@/lib/firebase/storage', () => ({ uploadReferenceAttachment: vi.fn() }));
vi.mock('./ReferenceComments', () => ({ ReferenceComments: ({ legacyBody, legacyComment }: { legacyBody: string; legacyComment: string }) => <section aria-label="コメント履歴">{legacyBody}{legacyComment}</section> }));
vi.mock('@/components/task/AttachmentPreview', () => ({ AttachmentPreview: () => null }));
import { ListReferencesPanel } from './ListReferencesPanel';
const reference = { id: 'r', title: '出展ガイド', body: '説明 https://example.com', comment: '既存のコメント', links: [], attachments: [], updatedAt: new Date(0) };
describe('list reference detail', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.references = [reference]; mocks.canEdit = true; mocks.update.mockResolvedValue(undefined); });
  it('opens comments from the whole title card and keeps previous information first', () => {
    render(<ListReferencesPanel projectId="p" listId="l" />);
    expect(screen.queryByText('既存のコメント')).not.toBeInTheDocument();
    expect(screen.queryByText(/説明 https/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '出展ガイド' }));
    expect(screen.getByRole('region', { name: 'コメント履歴' })).toHaveTextContent('説明 https://example.com既存のコメント');
    expect(screen.queryByText('このリストの添付・コメント')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'タイトル・添付を編集' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保管' })).toHaveTextContent('');
    expect(screen.queryByRole('textbox', { name: 'タイトル' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '説明' })).not.toBeInTheDocument();
  });
  it('opens creation from header paperclip without an empty related-information section', () => {
    mocks.references = [];
    render(<ListReferencesPanel projectId="p" listId="l" renderTrigger={trigger => <header>{trigger}</header>} />);
    const trigger = screen.getByRole('button', { name: '関連情報を追加' });
    expect(trigger.closest('header')).not.toBeNull();
    expect(trigger.textContent).toBe('');
    expect(screen.queryByRole('region', { name: 'このリストの関連情報' })).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.getByRole('textbox', { name: 'タイトル' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '説明' })).not.toBeInTheDocument();
  });
  it('edits the title without overwriting the previous information or comment', async () => {
    render(<ListReferencesPanel projectId="p" listId="l" />);
    fireEvent.click(screen.getByRole('button', { name: '出展ガイド' }));
    fireEvent.click(screen.getByRole('button', { name: '出展ガイドのタイトルを編集' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'タイトル' }), { target: { value: '新しいタイトル' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('r', { title: '新しいタイトル' }, reference.updatedAt));
    expect(screen.getByRole('region', { name: 'コメント履歴' })).toHaveTextContent(reference.body);
  });
  it('allows another reference from the paperclip and opens each title independently', () => {
    mocks.references = [reference, { ...reference, id: 'r2', title: '会場マップ', body: '2件目の説明', comment: '2件目のコメント' }];
    render(<ListReferencesPanel projectId="p" listId="l" />);
    fireEvent.click(screen.getByRole('button', { name: '関連情報を追加' }));
    expect(screen.getByRole('textbox', { name: 'タイトル' })).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    fireEvent.click(screen.getByRole('button', { name: '会場マップ' }));
    expect(screen.getByRole('region', { name: 'コメント履歴' })).toHaveTextContent('2件目の説明2件目のコメント');
    expect(screen.getByRole('region', { name: 'コメント履歴' })).not.toHaveTextContent('既存のコメント');
  });
  it('viewer can read detail but cannot edit it', () => {
    mocks.canEdit = false;
    render(<ListReferencesPanel projectId="p" listId="l" />);
    fireEvent.click(screen.getByRole('button', { name: '出展ガイド' }));
    expect(screen.queryByRole('button', { name: '出展ガイドのタイトルを編集' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保管' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'コメント履歴' })).toHaveTextContent('既存のコメント');
  });
});
