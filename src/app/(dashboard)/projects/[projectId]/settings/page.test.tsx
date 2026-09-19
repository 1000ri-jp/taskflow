import { subscribeToArchivedTasks } from '@/lib/firebase/firestore';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProjectSettingsPage from './page';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  archive: vi.fn(),
  remove: vi.fn(),
  update: vi.fn(),
  addMember: vi.fn(),
  removeMember: vi.fn(),
  updateRole: vi.fn(),
  project: {
    id: 'project-1',
    name: 'テストプロジェクト',
    description: '説明',
    color: '#3b82f6',
    icon: '📁',
    urls: [],
    isArchived: false,
  },
  members: [],
}));

vi.mock('@/components/board/AutoArchivePreviewSettings', () => ({ AutoArchivePreviewSettings: ({ projectId }: { projectId: string }) => <div data-testid="auto-archive-settings" data-project-id={projectId} /> }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: (selector: (state: { user: { id: string } }) => unknown) => selector({ user: { id: 'u' } }) }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ projectId: 'project-1' }),
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock('@/hooks/useProjects', () => ({
  useProject: () => ({
    project: mocks.project,
    members: mocks.members,
    isLoading: false,
    update: mocks.update,
    archive: mocks.archive,
    remove: mocks.remove,
    addMember: mocks.addMember,
    removeMember: mocks.removeMember,
    updateRole: mocks.updateRole,
  }),
}));

vi.mock('@/lib/firebase/firestore', () => ({
  getUsersByIds: vi.fn().mockResolvedValue([]),
  getAllUsers: vi.fn(() => new Promise(() => {})),
  subscribeToArchivedTasks: vi.fn(() => vi.fn()),
  restoreTask: vi.fn(),
  deleteTask: vi.fn(),
}));

vi.mock('@/lib/firebase/storage', () => ({
  deleteProjectIcon: vi.fn(),
  uploadProjectIconBlob: vi.fn(),
  uploadProjectHeaderImageBlob: vi.fn(),
  deleteProjectHeaderImage: vi.fn(),
}));

describe('ProjectSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear();
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('alert', vi.fn());
    mocks.project.isArchived = false;
  });

  it('archives the project and returns to the projects page', async () => {
    mocks.archive.mockResolvedValue(undefined);
    render(<ProjectSettingsPage />);
    expect(screen.getByTestId('auto-archive-settings')).toHaveAttribute('data-project-id', 'project-1');

    fireEvent.click(screen.getByRole('button', { name: 'アーカイブ' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('この確認は初回のみ'));
    await waitFor(() => expect(mocks.archive).toHaveBeenCalledOnce());
    expect(mocks.push).toHaveBeenCalledWith('/projects');
  });

  it('skips the notice after the first successful project archive', async () => {
    mocks.archive.mockResolvedValue(undefined);
    const { unmount } = render(<ProjectSettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'アーカイブ' }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalled());
    unmount();
    vi.mocked(confirm).mockClear();
    render(<ProjectSettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'アーカイブ' }));
    await waitFor(() => expect(mocks.archive).toHaveBeenCalledTimes(2));
    expect(confirm).not.toHaveBeenCalled();
  });

  it('does not archive when confirmation is cancelled', () => {
    vi.mocked(confirm).mockReturnValue(false);
    render(<ProjectSettingsPage />);

    fireEvent.click(screen.getByRole('button', { name: 'アーカイブ' }));

    expect(mocks.archive).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('does not allow an active project to be deleted', () => {
    render(<ProjectSettingsPage />);

    expect(screen.getByRole('button', { name: '削除' })).toBeDisabled();
    expect(screen.getByText('削除するには先にプロジェクトをアーカイブしてください')).toBeVisible();
  });

  it('deletes an archived project and returns to the projects page', async () => {
    mocks.project.isArchived = true;
    mocks.remove.mockResolvedValue(undefined);
    render(<ProjectSettingsPage />);

    fireEvent.click(screen.getByRole('button', { name: '削除' }));

    expect(confirm).toHaveBeenCalledWith(
      'このプロジェクトを完全に削除しますか？この操作は取り消せません。'
    );
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledOnce());
    expect(mocks.push).toHaveBeenCalledWith('/projects');
  });
});

it('shows archive failure instead of zero, retains basic input and retries without writing', async () => {
  vi.clearAllMocks(); mocks.project.isArchived = false;
  let receive!: Parameters<typeof subscribeToArchivedTasks>[1];
  let fail!: NonNullable<Parameters<typeof subscribeToArchivedTasks>[2]>;
  vi.mocked(subscribeToArchivedTasks).mockImplementation((_id, next, error) => { receive = next; fail = error!; return vi.fn(); });
  render(<ProjectSettingsPage />);
  expect(screen.queryByText('アーカイブ済みのタスクはありません')).not.toBeInTheDocument();
  await waitFor(() => expect(fail).toBeDefined());
  const input = screen.getByDisplayValue('テストプロジェクト');
  fireEvent.change(input, { target: { value: '未保存の長い日本語のプロジェクト名' } });
  act(() => fail(new Error('missing-index')));
  expect(screen.getByRole('alert')).toHaveTextContent('アーカイブ済みタスクを取得できませんでした');
  expect(screen.queryByText(/復元できます（0件）/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '再取得' }));
  await waitFor(() => expect(subscribeToArchivedTasks).toHaveBeenCalledTimes(2));
  act(() => receive([]));
  expect(screen.getByText('アーカイブ済みのタスクはありません')).toBeInTheDocument();
  expect(input).toHaveValue('未保存の長い日本語のプロジェクト名');
  expect(mocks.update).not.toHaveBeenCalled();
});
