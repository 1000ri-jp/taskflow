import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskAutomationPanel } from './TaskAutomationPanel';
import { viewTask } from '@/test/taskViewFixtures';
import type { AutomationGrant, AutomationView } from '@/lib/task/automationTypes';
const mock = vi.hoisted(() => ({ request: vi.fn(), uid: 'u' }));
vi.mock('@/lib/task/automationClient', () => ({ automationRequest: mock.request }));
vi.mock('@/lib/firebase/testMode', () => ({ isE2EMockAuthEnabled: () => false }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: Object.assign((selector: (state: { user: { id: string } }) => unknown) => selector({ user: { id: mock.uid } }), { getState: () => ({ user: { id: mock.uid } }) }) }));
const view: AutomationView = { revision: 3, grants: [], reminders: [], backgroundConfigured: false };
const task = viewTask({ id: 'parent', assigneeIds: ['u'], description: '完了条件：全員の支払完了', updatedAt: new Date('2026-09-01T00:00:00Z') });
const child = viewTask({ id: 'child', parentTaskId: task.id, title: '本人の購入', assigneeIds: ['u'] });
const users = [{ id: 'u', displayName: '本人' }];
beforeEach(() => { vi.resetAllMocks(); mock.uid = 'u'; mock.request.mockResolvedValue(view); });
const open = () => fireEvent.click(screen.getByText('自動で確認する条件を設定'));
const grant: AutomationGrant = {
  rule: { projectId: task.projectId, taskId: task.id, enabled: true, subject: '展示会', period: '2026', person: '本人', sender: '', criterion: 'purchase', allowExpectedDate: true, sources: ['comment'] },
  uid: 'u', grantedAt: '2026-09-01T00:00:00Z', notBefore: '2026-09-01T00:00:00Z', connectionEpoch: null,
  expectedTaskVersion: 'v1', check: 'unconfirmed', checkedAt: null, reason: '明確な根拠は未確認です。',
  latestEvidenceAt: null, stage: null, ownedCompletion: false, records: [],
};

describe('compact automation settings', () => {
  it('shows the loaded setting status and opens the existing region without another disclosure or request', async () => {
    let resolveRead!: (next: AutomationView) => void;
    mock.request.mockImplementationOnce(() => new Promise<AutomationView>(resolve => { resolveRead = resolve; }));
    render(<TaskAutomationPanel compact task={task} tasks={[task]} users={users} />);
    expect(screen.getByRole('button', { name: '自動確認：取得中' })).toBeVisible();
    expect(screen.queryByRole('region', { name: '根拠からの自動更新' })).not.toBeInTheDocument();
    await act(async () => resolveRead(view));

    fireEvent.click(screen.getByRole('button', { name: '自動確認：未設定' }));
    const region = screen.getByRole('region', { name: '根拠からの自動更新' });
    expect(within(region).getByRole('heading', { name: '自動確認の設定' })).toBeVisible();
    expect(within(region).getByRole('button', { name: 'このタスクの確認を任せる' })).toBeVisible();
    expect(within(region).queryByText('自動で確認する条件を設定')).not.toBeInTheDocument();
    expect(mock.request.mock.calls).toEqual([[]]);
  });

  it.each([
    { name: 'enabled for this task', grants: [grant], status: '設定済み' },
    { name: 'disabled for this task', grants: [{ ...grant, rule: { ...grant.rule, enabled: false } }], status: '未設定' },
    { name: 'enabled for another task', grants: [{ ...grant, rule: { ...grant.rule, taskId: 'another-task' } }], status: '未設定' },
  ])('shows the status when a rule is $name', async ({ grants, status }) => {
    mock.request.mockResolvedValue({ ...view, grants });
    render(<TaskAutomationPanel compact task={task} tasks={[task]} users={users} />);
    expect(await screen.findByRole('button', { name: `自動確認：${status}` })).toBeVisible();
  });

  it('counts an existing parent completion condition as configured', async () => {
    const parent = { ...task, completionPolicy: { kind: 'all_required_children' as const, condition: '全員の支払完了',
      required: [{ taskId: child.id, assigneeId: 'u' }], grantedBy: 'u', grantedAt: '2026-09-01T00:00:00Z' } };
    render(<TaskAutomationPanel compact task={parent} tasks={[parent, child]} users={users} />);
    expect(await screen.findByRole('button', { name: '自動確認：設定済み' })).toBeVisible();
  });

  it('reports failed retrieval without calling the setting unset or preventing inspection', async () => {
    mock.request.mockRejectedValue(new Error('設定を取得できません。'));
    render(<TaskAutomationPanel compact task={task} tasks={[task]} users={users} />);
    fireEvent.click(await screen.findByRole('button', { name: '自動確認：取得不可' }));
    expect(screen.getByRole('alert')).toHaveTextContent('設定を取得できません。');
    expect(screen.getByRole('button', { name: 'このタスクの確認を任せる' })).toBeDisabled();
    expect(mock.request.mock.calls).toEqual([[]]);
  });

  it('keeps an unsaved rule draft when closed and reopened without granting or refreshing anything', async () => {
    render(<TaskAutomationPanel compact task={task} tasks={[task]} users={users} />);
    fireEvent.click(await screen.findByRole('button', { name: '自動確認：未設定' }));
    fireEvent.click(screen.getByRole('button', { name: 'このタスクの確認を任せる' }));
    fireEvent.change(screen.getByLabelText('商品・イベント名'), { target: { value: '入力途中の展示会' } });
    fireEvent.change(screen.getByLabelText('対象の年・期間・注文番号'), { target: { value: '2026-予約A' } });
    fireEvent.keyDown(screen.getByRole('dialog', { name: '自動確認の設定' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('region', { name: '根拠からの自動更新' })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '自動確認：未設定' }));
    expect(screen.getByLabelText('商品・イベント名')).toHaveValue('入力途中の展示会');
    expect(screen.getByLabelText('対象の年・期間・注文番号')).toHaveValue('2026-予約A');
    expect(mock.request.mock.calls).toEqual([[]]);
  });

  it('keeps a selected parent condition across closing the popover', async () => {
    render(<TaskAutomationPanel compact task={task} tasks={[task, child]} users={users} />);
    fireEvent.click(await screen.findByRole('button', { name: '自動確認：未設定' }));
    fireEvent.click(screen.getByText('全員分がそろったら親も完了する'));
    fireEvent.click(screen.getByRole('checkbox', { name: child.title }));
    fireEvent.change(screen.getByLabelText('全員分の明示的な完了条件'), { target: { value: '入力中の全員条件' } });
    fireEvent.keyDown(screen.getByRole('dialog', { name: '自動確認の設定' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('region', { name: '根拠からの自動更新' })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '自動確認：未設定' }));
    fireEvent.click(screen.getByText('全員分がそろったら親も完了する'));
    expect(screen.getByRole('checkbox', { name: child.title })).toBeChecked();
    expect(screen.getByLabelText('全員分の明示的な完了条件')).toHaveValue('入力中の全員条件');
    expect(mock.request.mock.calls).toEqual([[]]);
  });
});

describe('automation editing preserves entered work', () => {
  it('keeps the rule form and values after failed saving, and closes only after successful saving', async () => {
    render(<TaskAutomationPanel task={task} tasks={[task]} users={users} />); open();
    const start = screen.getByRole('button', { name: 'このタスクの確認を任せる' });
    await waitFor(() => expect(start).not.toBeDisabled()); fireEvent.click(start);
    const subject = screen.getByLabelText('商品・イベント名'); fireEvent.change(subject, { target: { value: '展示会' } });
    mock.request.mockRejectedValueOnce(new Error('保存できません。入力は保持してください。'));
    fireEvent.submit(screen.getByRole('button', { name: 'この条件で自動更新を許可' }).closest('form')!);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('保存できません'));
    expect(screen.getByLabelText('商品・イベント名')).toHaveValue('展示会');
    fireEvent.submit(screen.getByRole('button', { name: 'この条件で自動更新を許可' }).closest('form')!);
    await waitFor(() => expect(screen.queryByLabelText('商品・イベント名')).not.toBeInTheDocument());
  });
  it('rejects a child removed during editing instead of throwing or silently dropping it', async () => {
    const { rerender } = render(<TaskAutomationPanel task={task} tasks={[task, child]} users={users} />); open();
    fireEvent.click(screen.getByText('全員分がそろったら親も完了する'));
    fireEvent.click(screen.getByRole('checkbox', { name: child.title }));
    fireEvent.change(screen.getByLabelText('全員分の明示的な完了条件'), { target: { value: '自分が記入した条件' } });
    rerender(<TaskAutomationPanel task={task} tasks={[task]} users={users} />);
    const calls = mock.request.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'この全員条件の自動判定を許可' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('サブタスク・担当が変わっています'));
    expect(mock.request).toHaveBeenCalledTimes(calls); expect(screen.getByLabelText('全員分の明示的な完了条件')).toHaveValue('自分が記入した条件');
  });
  it('retains the parent version from the start of editing when live updates arrive', async () => {
    const { rerender } = render(<TaskAutomationPanel task={task} tasks={[task, child]} users={users} />); open();
    fireEvent.click(screen.getByText('全員分がそろったら親も完了する'));
    fireEvent.click(screen.getByRole('checkbox', { name: child.title }));
    fireEvent.change(screen.getByLabelText('全員分の明示的な完了条件'), { target: { value: '入力中の条件' } });
    const changed = { ...task, updatedAt: new Date('2026-09-12T00:00:00Z') };
    rerender(<TaskAutomationPanel task={changed} tasks={[changed, child]} users={users} />);
    mock.request.mockRejectedValueOnce(new Error('親タスクが更新されています。'));
    fireEvent.click(screen.getByRole('button', { name: 'この全員条件の自動判定を許可' }));
    await waitFor(() => expect(mock.request).toHaveBeenCalledWith(expect.objectContaining({ action: 'policy', expectedUpdatedAt: task.updatedAt.toISOString() })));
    expect(screen.getByLabelText('全員分の明示的な完了条件')).toHaveValue('入力中の条件');
    expect(screen.getByText('親タスクが更新されました。入力中の条件は保持しています。')).toBeInTheDocument();
  });
});

it('prefills existing task facts without granting automation or inventing an email sender',async()=>{
 const parent={...task,title:'2026年 秋の展示会'};render(<TaskAutomationPanel compact task={parent} tasks={[parent]} users={users}/>);fireEvent.click(await screen.findByRole('button',{name:'自動確認：未設定'}));fireEvent.click(screen.getByRole('button',{name:'このタスクの確認を任せる'}));
 expect(screen.getByLabelText('商品・イベント名')).toHaveValue(parent.title);expect(screen.getByLabelText('対象の年・期間・注文番号')).toHaveValue('2026');expect(screen.getByLabelText('根拠に記載される対象者の名前')).toHaveValue('本人');expect(screen.getByLabelText('購入先の送信元メールアドレス')).toHaveValue('');expect(mock.request.mock.calls).toEqual([[]]);
});
