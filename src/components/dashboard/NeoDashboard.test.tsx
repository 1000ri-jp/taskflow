import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NeoDashboard } from './NeoDashboard';
import { viewTask } from '@/test/taskViewFixtures';
import { useAuthStore } from '@/stores/authStore';

vi.mock('@/hooks/useRecentTaskChanges', async original => ({ ...await original<typeof import('@/hooks/useRecentTaskChanges')>(), useRecentTaskChanges: () => ({changes: ['done','older','child'].map((taskId,i)=>({projectId:'project-1',taskId,entry:{id:taskId,kind:'activity',title:'内容を更新',actor:'同僚',at:new Date(2026,8,15,21,30-i).toISOString(),private:false,changes:[{field:'dueDate',before:'2026-09-16',after:'2026-09-18'}]}})),isLoading:false,error:false,more:false}) }));

vi.mock('@/lib/task/organizationClient', () => ({ requestOrganization: vi.fn(async (body: { action: string }) => body.action === 'context' ? { members: [], lists: [] } : []) }));

const data = vi.hoisted(() => ({ tasks: [] as unknown[], allProjectTasks: [] as unknown[] }));
vi.mock('@/hooks/useMyTasks', () => ({ useMyTasks: () => ({ ...data, projects: [], projectTaskStatus: new Map([['project-1', { status: 'ready' }]]), isLoading: false, error: null }) }));
vi.mock('@/hooks/useMeetingMembers', () => ({ useMeetingMembers: () => ({ users: [{ id: 'me', displayName: '本人' }, { id: 'other', displayName: '同僚' }], isLoading: false, hasError: false }) }));
vi.mock('@/contexts/NotificationContext', () => ({ useNotifications: () => ({ notifications: [] }) }));
vi.mock('@/components/secretary/SecretaryPanel', () => ({ SecretaryPanel: () => <div>AI秘書</div> }));
vi.mock('@/lib/firebase/testMode', () => ({ isE2EMockAuthEnabled: () => true }));

vi.mock('./NeoWorkContinuation', () => ({ NeoWorkContinuation: ({ onList }: { onList: () => void }) => <div data-testid="neo-work-continuation"><button onClick={onList}>続きから一覧へ</button></div> }));

beforeEach(() => {
  useAuthStore.setState({ user: { id: 'me' } as NonNullable<ReturnType<typeof useAuthStore.getState>['user']> });
  const mine = { ...viewTask({ title: '自分の作業', assigneeIds: ['me'], dueDate: new Date() }), projectName: '展示会', listName: '給与振込設定', parentTitle: '振込設定' };
  const review = { ...mine, id: 'review', title: '原稿の確認依頼', taskKind: 'review_request', createdBy: 'other' };
  data.tasks = [mine, review]; data.allProjectTasks = [mine, review];
});

describe('Neo dashboard task views', () => {
  it('shows actual changes in recorded order with list context and history access', () => {
    const updatedAt = new Date(2026, 8, 15, 21, 30);
    const done = { ...viewTask({ id: 'done', title: '図面作成', isCompleted: true, completedAt: new Date(2026, 8, 14), updatedAt, dueDate: new Date(2026, 8, 13) }), projectName: '委託', listName:'書類' };
    const older = { ...viewTask({ id: 'older', title: '次の準備', updatedAt: new Date(2026, 8, 15, 20), workProgress: 'started' }), projectName: '委託', listName:'書類' };
    data.allProjectTasks = [older, done, { ...older, id: 'child', title: '図面の確認', parentTaskId: 'done', parentTitle: '図面作成' }];
    render(<NeoDashboard />);
    fireEvent.click(screen.getByRole('button', { name: /^タスク$/ }));
    fireEvent.click(screen.getByRole('button', {name: '自分の担当'}));
    expect(screen.getByRole('link', { name: /自分の作業/ })).toHaveAttribute('href', '/projects/project-1/board?task=task-1');
    fireEvent.click(screen.getByRole('button', { name: '最近の更新' }));
    const rows = within(screen.getByRole('region', { name: 'タスク一覧' })).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('図面作成');
    const link = within(rows[0]).getByRole('link');
    expect(link).toHaveAttribute('href', '/projects/project-1/board?task=done&history=1');
    expect(within(link).getByText('9/15 21:30')).toHaveAttribute('datetime', updatedAt.toISOString());
    expect(within(link).getByText('書類')).toBeVisible();
    expect(within(link).getByText('期限：2026/9/16 → 2026/9/18')).toBeVisible();
    expect(within(link).getByText(/同僚/)).toBeVisible();
    expect(screen.queryByText(/履歴を開くと/)).not.toBeInTheDocument();
    expect(within(rows[1]).getByText('次の準備')).toBeVisible();
    expect(screen.queryByText(/直近の変更は記録なし/)).not.toBeInTheDocument();
    // Child URLs open their parent with the child highlighted; do not label parent history as the child's history.
    const child = within(rows[2]).getByRole('link');
    expect(child).toHaveAttribute('href', '/projects/project-1/board?task=child');
    expect(within(child).getByText('図面作成')).toBeVisible();
  });

  it('starts with the briefing and countdown visible, with AI consultation kept in Moai', () => {
    render(<NeoDashboard />);
    const nav = within(screen.getByRole('group', { name: 'タスクの表示' }));
    expect(nav.getAllByRole('button')).toHaveLength(4);
    expect(nav.getByRole('button', { name: '今日' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('neo-work-continuation')).toBeVisible();
    expect(screen.getByRole('region', { name: '次の予定' })).toBeVisible();
    const briefing = screen.getByRole('region', { name: '今日のブリーフィング' });
    const requests = within(briefing).getByRole('region', { name: '依頼内容' });
    expect(screen.getAllByRole('region', { name: '依頼内容' })).toHaveLength(1);
    expect(screen.queryByRole('region', { name: '今返答が必要なこと' })).not.toBeInTheDocument();
    const todayWork = within(briefing).getByRole('region', { name: '今日の仕事・期限' });
    expect(todayWork).toHaveTextContent('自分の作業');
    expect(within(todayWork).getByRole('region', { name: '期限' })).toHaveTextContent('今日が期限');
    expect(within(requests).getByRole('link', { name: /原稿の確認依頼/ })).toHaveAttribute('href', '/projects/project-1/board?task=review');
    expect(screen.getByTestId('neo-morning-brief')).toBeVisible();
    expect(screen.getByRole('region', { name: '共通カウントダウン' })).toBeVisible();
    expect(screen.queryByText('AI秘書')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'AIで状況を整理' })).not.toBeInTheDocument();
    fireEvent.click(nav.getByRole('button', { name: 'カレンダー' }));
    expect(screen.queryByText('AI秘書')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '画面の設定' })).not.toBeInTheDocument();
  });

  it('shares the same compact, interactive row between the task list and today briefing', () => {
    render(<NeoDashboard />);
    const nav = within(screen.getByRole('group', { name: 'タスクの表示' }));
    fireEvent.click(nav.getByRole('button', { name: /^タスク$/ }));
    const taskListRow = screen.getByRole('link', { name: /自分の作業/ });
    expect(taskListRow).toHaveClass('tf-compact-row', 'py-0.5', 'px-5', 'transition-colors', 'hover:bg-muted/60', 'focus-visible:outline-2');
    expect(taskListRow.firstElementChild).toHaveClass('min-h-8');
    expect(taskListRow).toHaveTextContent('給与振込設定');
    expect(taskListRow).toHaveTextContent('振込設定');
    expect(taskListRow).not.toHaveTextContent(/親[:：]/);
    expect(taskListRow).toHaveTextContent(/期限/);
    expect(within(taskListRow).queryByLabelText('未完了')).not.toBeInTheDocument();

    fireEvent.click(nav.getByRole('button', { name: '今日' }));
    const briefing = within(screen.getByRole('region', { name: '今日の仕事・期限' }));
    const briefingRow = briefing.getByRole('link', { name: /自分の作業/ });
    expect(briefingRow.className).toBe(taskListRow.className);
    expect(briefingRow).toHaveTextContent('給与振込設定');
    expect(briefingRow).toHaveTextContent('振込設定');
    expect(briefingRow).not.toHaveTextContent(/親[:：]/);
    expect(briefingRow).toHaveTextContent(/期限/);
    expect(briefingRow).toHaveAttribute('href', taskListRow.getAttribute('href'));
  });

  it('opens the combined daily agenda from Today and returns to the selected job', () => {
    render(<NeoDashboard />);
    fireEvent.click(screen.getByRole('button', { name: '今日の予定を見る' }));
    const agenda = screen.getByRole('dialog');
    expect(within(agenda).getByText('自分の作業')).toBeVisible();
    fireEvent.click(within(agenda).getAllByRole('button', { name: '仕事の続きへ' })[0]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('neo-work-continuation')).toBeVisible();
    expect(screen.getByRole('button', { name: '今日' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('switches calendar/list without losing the selected filter and keeps the deadline shortcut', () => {
    render(<NeoDashboard />);
    const nav = within(screen.getByRole('group', { name: 'タスクの表示' }));
    fireEvent.click(screen.getByRole('button', { name: /^タスク$/ }));
    fireEvent.click(screen.getByRole('button', { name: '最近の更新' }));
    fireEvent.click(nav.getByRole('button', { name: 'カレンダー' }));
    expect(screen.getByRole('region', { name: '予定と期限のカレンダー' })).toBeVisible();
    expect(document.querySelector('time[aria-label]')).toBeVisible();
    expect(screen.getAllByRole('region', { name: '共通カウントダウン' })).toHaveLength(1);
    expect(screen.queryByText('AI秘書')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '最近の更新' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^タスク$/ }));
    expect(screen.getByRole('button', { name: '最近の更新' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('time[aria-label]')).toBeVisible();
    expect(screen.getAllByRole('region', { name: '共通カウントダウン' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /今日までの期限/ }));
    expect(screen.getByRole('button', { name: /^今日まで$/ })).toHaveAttribute('aria-pressed', 'true');
  });
});


it('gives AI proposals their own purpose, without completed work, ordinary filters or duplicate navigation', async () => {
  render(<NeoDashboard />);
  const nav = within(screen.getByRole('group', { name: 'タスクの表示' }));
  fireEvent.click(nav.getByRole('button', { name: 'モアイの提案' }));
  const proposals = screen.getByRole('region', { name: 'モアイの提案' });
  expect(within(proposals).getByText('いま判断が必要な提案はありません。')).toBeVisible();
  expect(within(proposals).getByRole('button', { name: 'メモから提案を作る' })).toBeVisible();
  expect(screen.queryByRole('button', { name: '最近の更新' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'メモから' })).not.toBeInTheDocument();
  expect(document.querySelector('time[aria-label]')).toBeVisible();
  expect(nav.getAllByRole('button')).toHaveLength(4);
  fireEvent.click(screen.getByRole('button', { name: /^タスク$/ }));
  expect(screen.getByRole('button', { name: '自分の担当' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByRole('region', { name: 'モアイの提案' })).not.toBeInTheDocument();
});
