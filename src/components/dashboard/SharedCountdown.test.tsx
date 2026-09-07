import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SharedCountdown, isLocalCountdownPreview } from './SharedCountdown';
import type { DashboardTask } from '@/lib/dashboard/brief';
import type { SharedCountdownData } from '@/lib/dashboard/countdown';

const auth = vi.hoisted(() => ({ firebaseUser: { uid: 'a' } as { uid: string } | null }));
const hook = vi.hoisted(() => ({ data: { status: 'unset', target: null, task: null, revision: 0 } as SharedCountdownData | undefined, error: null as Error | null, isLoading: false, isSaving: false, refresh: vi.fn(), save: vi.fn() }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: (selector: (state: typeof auth) => unknown) => selector(auth) }));
vi.mock('@/hooks/useSharedCountdown', () => ({ useSharedCountdown: () => hook }));
const task = { id: 't', projectId: 'p', projectName: '展示会', title: '出展準備', dueDate: new Date('2026-09-23T00:00:00+09:00'), isCompleted: false, isAbandoned: false, isArchived: false } as DashboardTask;
const props = { tasks: [task, { ...task, id: 'done', title: '完了したタスク', isCompleted: true }, { ...task, id: 'no-date', title: '期限なし', dueDate: null }], tasksLoading: false, tasksError: null };
const open = () => fireEvent.click(screen.getByRole('button', { name: '共通カウントダウンの設定' }));
describe('SharedCountdown', () => {
  it('enables browser-only settings on the local development test server, never production', () => {
    expect(isLocalCountdownPreview('development', 'localhost', '3002')).toBe(true);
    expect(isLocalCountdownPreview('development', '127.0.0.1', '3002')).toBe(true);
    expect(isLocalCountdownPreview('production', 'localhost', '3002')).toBe(false);
    expect(isLocalCountdownPreview('development', 'localhost', '3001')).toBe(false);
    expect(isLocalCountdownPreview('development', 'example.com', '3002')).toBe(false);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.setSystemTime(new Date('2026-09-03T09:00:00+09:00'));
    auth.firebaseUser = { uid: 'a' };
    hook.data = { status: 'unset', target: null, task: null, revision: 0 };
    hook.error = null; hook.isLoading = false; hook.isSaving = false;
    hook.save.mockResolvedValue(undefined);
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  it('previews eligible tasks and saves only IDs after explicit confirmation', async () => {
    render(<SharedCountdown {...props} />);
    expect(screen.getByRole('region', { name: '共通カウントダウン' })).toHaveClass('w-full', 'max-w-[640px]', 'justify-self-end');
    open();
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '全員共通で保存' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /出展準備/ }));
    expect(screen.getByText('あと20日')).toBeInTheDocument();
    expect(hook.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '全員共通で保存' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(hook.save).toHaveBeenCalledExactlyOnceWith({ target: { projectId: 'p', taskId: 't' }, revision: 0 });
  });
  it('allows unsaved preview while authentication is deferred, but never falls back to local storage', () => {
    hook.data = undefined; hook.error = new Error('credentials');
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    render(<SharedCountdown {...props} />);
    open();
    fireEvent.click(screen.getByRole('radio', { name: /出展準備/ }));
    expect(screen.getByText('あと20日')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '全員共通で保存' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(hook.save).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled();
    storage.mockRestore();
  });
  it('shows current task data, preserves the opening revision, and keeps conflicts visible', async () => {
    hook.data = { status: 'ready', target: { projectId: 'p', taskId: 't' }, revision: 2, task: { title: '出展準備', projectName: '展示会', dueDate: task.dueDate!.toISOString(), isCompleted: false, isAbandoned: false } };
    const { rerender } = render(<SharedCountdown {...props} />);
    expect(screen.getByRole('link', { name: /あと20日.*出展準備/ })).toHaveAttribute('href', '/projects/p/board?task=t');
    open();
    hook.data = { ...hook.data, revision: 3 };
    rerender(<SharedCountdown {...props} />);
    hook.save.mockRejectedValue(new Error('ほかの人が設定を変更しました。'));
    fireEvent.click(screen.getByRole('button', { name: '設定を解除' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('ほかの人'));
    expect(hook.save).toHaveBeenCalledWith({ target: null, revision: 2 });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
  it('does not expose a restricted target, and drops the picker when accounts change', () => {
    hook.data = { status: 'restricted', target: null, task: null, revision: 1 };
    const { rerender } = render(<SharedCountdown {...props} />);
    expect(screen.getByText('共有タスクの閲覧権限がありません。')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    open();
    fireEvent.change(screen.getByRole('textbox', { name: 'カウントダウンのタスクを検索' }), { target: { value: '別のプロジェクト' } });
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    auth.firebaseUser = { uid: 'b' };
    rerender(<SharedCountdown {...props} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    auth.firebaseUser = null;
    rerender(<SharedCountdown {...props} />);
    expect(screen.getByText('カウントダウンはログイン後に表示されます。')).toBeInTheDocument();
  });
});
