import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KozueDashboard } from './KozueDashboard';
import { DEFAULT_INBOX_DISPLAY, INBOX_DISPLAY_STORAGE_KEY, useInboxDisplayStore } from '@/stores/inboxDisplayStore';
import { TARGET_PROJECT_STORAGE_KEY, useTargetProjectStore } from '@/stores/targetProjectStore';
import { STALE_PROJECT_DISPLAY_STORAGE_KEY, useStaleProjectDisplayStore } from '@/stores/staleProjectDisplayStore';
import { emptyMeetLinks, LEGACY_MEET_LINK_STORAGE_KEY, MEET_LINK_STORAGE_KEY, useMeetLinkStore } from '@/stores/meetLinkStore';
import { UPCOMING_RANGE_STORAGE_KEY, useUpcomingRangeStore } from '@/stores/upcomingRangeStore';
import { TARGET_TASK_STORAGE_KEY, useTargetTaskStore } from '@/stores/targetTaskStore';
import type { DashboardTask } from '@/lib/dashboard/brief';

const recommendationTaskState = vi.hoisted(() => ({ tasks: [] as DashboardTask[] }));

const projectState = vi.hoisted(() => ({
  projects: [{ id: 'project-a', name: '表示するプロジェクトA' }, { id: 'project-b', name: '表示するプロジェクトB' }],
  isLoading: false,
  error: null as Error | null,
}));

const commentState = vi.hoisted(() => ({
  items: [
    { key: 'real-comment', taskId: 'task-live', projectId: 'project-a', comment: { id: 'real-comment', content: '実際の確認コメント', createdAt: new Date(2026, 8, 3, 9), attachments: [] }, authorName: '確認担当者', listName: '展示会の準備', task: { id: 'task-live', projectId: 'project-a', projectName: '実プロジェクト', projectColor: '#123456', projectIcon: '🧭', title: '実タスク' } },
    { key: 'review-comment', taskId: 'task-source', projectId: 'project-a', comment: { id: 'review-comment', content: '確認依頼の元コメント', createdAt: new Date(2026, 8, 3, 8), attachments: [] }, authorName: '依頼者', listName: '展示会の準備', task: { id: 'task-source', projectId: 'project-a', projectName: '実プロジェクト', title: '元タスク' } },
  ],
  isLoading: false, hasError: false, metadataIncomplete: false, updatedAt: new Date(2026, 8, 3, 10), refresh: vi.fn(),
}));
vi.mock('@/hooks/useDashboardComments', () => ({ useDashboardComments: () => commentState }));

vi.mock('@/hooks/useMeetingMembers', () => ({ useMeetingMembers: () => ({ users: [], isLoading: false, hasError: false, refresh: vi.fn() }) }));
vi.mock('@/hooks/useProjects', () => ({ useProjects: () => projectState }));

vi.mock('@/hooks/useTaskFlowBrief', () => ({
  useTaskFlowBrief: () => ({
    allProjectTasks: recommendationTaskState.tasks, tasksError: null,
    data: {
      rows: [{
        label: '返信待ち・重要', tone: 'red', total: 0,
        items: [{ source: 'CK', title: '返信確認サンプル' }],
      }, {
        label: '今日の予定', tone: 'blue', total: 1,
        items: [{ source: 'CAL', title: '予定確認サンプル' }],
      }, {
        label: '今日やる',
        tone: 'green',
        total: 11,
        items: Array.from({ length: 11 }, (_, index) => ({
          source: 'TF',
          title: `確認タスク${index + 1}`,
          meta: `表示するプロジェクトA・期限超過 ${index + 1}日`,
          action: '開く',
          href: `/projects/test-project/board?task=task-${index + 1}`,
        })),
      }, {
        label: '3日動いていない', tone: 'amber', total: 5,
        items: ['project-a', 'project-a', 'project-a', 'project-b', 'project-b'].map((projectId, index) => ({
          source: 'TF', projectId, title: `停止タスク${index + 1}`, action: '続ける／やめる', href: `/projects/${projectId}/board?task=stale-${index}`,
        })),
      }, {
        label: '確認待ち', tone: 'red', total: 1,
        items: [{ source: 'CK', projectId: 'project-a', sourceCommentId: 'review-comment', title: '確認待ちサンプル', action: '確認する', href: '/projects/test-project/board?task=review-task' }],
      }, {
        label: '要整理', tone: 'amber', total: 1,
        items: [{ source: 'TF', title: '要整理サンプル', action: '整理する', href: '/projects/test-project/board?task=organize-task' }],
      }],
    },
    upcomingDays: [{
      dayOffset: 1,
      label: '明日',
      date: new Date(2026, 8, 4),
      tasks: [{
        id: 'upcoming-task',
        title: '明日の確認タスク',
        projectName: '確認プロジェクト',
        href: '/projects/test-project/board?task=upcoming-task',
      }],
    }, ...Array.from({ length: 4 }, (_, index) => ({ dayOffset: index + 2, label: `${index + 2}日後`, date: new Date(2026, 8, index + 5), tasks: index < 2 ? [] : [{ id: `day-${index + 2}`, title: `${index + 2}日後の確認タスク`, projectName: '確認プロジェクト', href: `/projects/test-project/board?task=day-${index + 2}` }] }))],
    upcomingCalendarDays: [],
    isLoading: false,
    areTasksLoading: false,
    calendarStatus: 'idle',
    calendarError: null,
    connectCalendar: vi.fn(),
    isSample: false,
  }),
}));

describe('KozueDashboard integration', () => {
  beforeEach(() => {
    recommendationTaskState.tasks = [];
    localStorage.removeItem(TARGET_TASK_STORAGE_KEY);
    useTargetTaskStore.setState({ selections: [], persistenceFailed: false });
    localStorage.removeItem(UPCOMING_RANGE_STORAGE_KEY);
    useUpcomingRangeStore.setState({ dayCount: 3, persistenceFailed: false });
    localStorage.removeItem(MEET_LINK_STORAGE_KEY);
    localStorage.removeItem(LEGACY_MEET_LINK_STORAGE_KEY);
    useMeetLinkStore.setState({ links: emptyMeetLinks(), persistenceFailed: false });
    localStorage.removeItem(STALE_PROJECT_DISPLAY_STORAGE_KEY);
    useStaleProjectDisplayStore.setState({ hiddenProjectIds: [] });
    localStorage.removeItem(TARGET_PROJECT_STORAGE_KEY);
    useTargetProjectStore.setState({ selectedProjectIds: null });
    projectState.projects = [{ id: 'project-a', name: '表示するプロジェクトA' }, { id: 'project-b', name: '表示するプロジェクトB' }];
    projectState.isLoading = false;
    projectState.error = null;
    commentState.isLoading = false;
    commentState.hasError = false;
    localStorage.removeItem(INBOX_DISPLAY_STORAGE_KEY);
    useInboxDisplayStore.setState({ settings: { ...DEFAULT_INBOX_DISPLAY } });
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 3, 10));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('preserves the date, replaces trivia with countdown, and keeps upcoming days below the brief', () => {
    render(<KozueDashboard displayName="Kozue" />);

    expect(screen.getByLabelText('2026.9.3 木曜日')).toHaveAttribute('datetime', '2026-09-03');
    expect(screen.getByText('2026.9.3')).toBeVisible();
    expect(screen.getByText('木曜日')).toBeVisible();
    expect(screen.queryByText('今日のへぇ')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '共通カウントダウン' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '共通カウントダウン' })).toHaveClass('w-full', 'max-w-[640px]', 'justify-self-end');
    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings.slice(0, 3).map((heading) => heading.textContent)).toEqual(['今日のブリーフ', '直近3日', '今月の的']);
  });

  it('includes the year and leaves single-digit months and days unpadded', () => {
    vi.setSystemTime(new Date(2027, 0, 2, 10));
    render(<KozueDashboard displayName="Kozue" />);
    expect(screen.getByLabelText('2027.1.2 土曜日')).toHaveAttribute('datetime', '2027-01-02');
    expect(screen.getByText('2027.1.2')).toBeVisible();
  });

  it('switches between three and five days and restores the chosen display period', () => {
    render(<KozueDashboard displayName="Kozue" />);
    const picker = screen.getByRole('group', { name: '直近の表示期間' });
    expect(within(picker).getByRole('button', { name: '3日' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('4日後の確認タスク')).not.toBeInTheDocument();
    fireEvent.click(within(picker).getByRole('button', { name: '5日' }));
    expect(screen.getByRole('heading', { name: '直近5日' })).toBeInTheDocument();
    expect(within(picker).getByRole('button', { name: '5日' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('link', { name: /4日後の確認タスク/ })).toHaveAttribute('href', '/projects/test-project/board?task=day-4');
    expect(screen.getByRole('link', { name: /5日後の確認タスク/ })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(UPCOMING_RANGE_STORAGE_KEY)!)).toBe(5);
    expect(screen.getByText('3日動いていない')).toBeInTheDocument();
    cleanup();
    render(<KozueDashboard displayName="Kozue" />);
    expect(screen.getByRole('heading', { name: '直近5日' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '3日' }));
    expect(screen.getByRole('heading', { name: '直近3日' })).toBeInTheDocument();
    expect(screen.queryByText('5日後の確認タスク')).not.toBeInTheDocument();
  });

  it('hides project tasks only in the stale row, preserves other sections, and can restore all', () => {
    render(<KozueDashboard displayName="Kozue" />);
    const staleRow = screen.getByText('3日動いていない').parentElement!.parentElement!;
    expect(within(staleRow).getByText('停止タスク1')).toBeInTheDocument();
    expect(within(staleRow).queryByText('停止タスク4')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '3日動いていないの表示設定' }));
    const settings = screen.getByRole('dialog');
    expect(within(settings).getByRole('checkbox', { name: '表示するプロジェクトA' })).toBeChecked();
    fireEvent.click(within(settings).getByRole('checkbox', { name: '表示するプロジェクトA' }));
    expect(within(staleRow).queryByText('停止タスク1')).not.toBeInTheDocument();
    expect(within(staleRow).getByText('停止タスク4')).toBeInTheDocument();
    expect(within(staleRow).queryByRole('button', { name: /すべて表示/ })).not.toBeInTheDocument();
    expect(screen.getByText('確認タスク1')).toBeInTheDocument();
    expect(screen.getByText('明日の確認タスク')).toBeInTheDocument();
    expect(screen.getByText('実際の確認コメント')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(STALE_PROJECT_DISPLAY_STORAGE_KEY)!)).toEqual(['project-a']);
    fireEvent.click(within(settings).getByRole('button', { name: 'すべて非表示' }));
    expect(within(staleRow).getByText('表示中の停止タスクはありません')).toBeInTheDocument();
    expect(within(staleRow).getByText('表示設定で5タスクを非表示中（表示中 0タスク）')).toBeInTheDocument();
    const staleSettingsButton = screen.getByRole('button', { name: '3日動いていないの表示設定' });
    expect(staleSettingsButton).toHaveTextContent('2プロジェクト非表示');
    expect(staleSettingsButton).not.toHaveTextContent('表示設定');
    fireEvent.click(within(settings).getByRole('button', { name: 'すべて表示' }));
    expect(within(staleRow).getByRole('button', { name: 'すべて表示（5件）' })).toBeInTheDocument();
    fireEvent.click(within(staleRow).getByRole('button', { name: 'すべて表示（5件）' }));
    expect(within(staleRow).getByText('停止タスク5')).toBeInTheDocument();
  });

  it('restores per-project exclusions on reload and reflects project renames in settings', () => {
    localStorage.setItem(STALE_PROJECT_DISPLAY_STORAGE_KEY, '["project-a"]');
    projectState.projects[0].name = 'プロジェクトAの新しい名前';
    render(<KozueDashboard displayName="Kozue" />);
    expect(screen.queryByText('停止タスク1')).not.toBeInTheDocument();
    expect(screen.getByText('停止タスク4')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '3日動いていないの表示設定' }));
    expect(screen.getByRole('checkbox', { name: 'プロジェクトAの新しい名前' })).not.toBeChecked();
  });

  it('keeps saved exclusions when the project list fails', () => {
    localStorage.setItem(STALE_PROJECT_DISPLAY_STORAGE_KEY, '["project-a"]');
    projectState.error = new Error('offline');
    render(<KozueDashboard displayName="Kozue" />);
    fireEvent.click(screen.getByRole('button', { name: '3日動いていないの表示設定' }));
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('設定は保持しています');
    expect(useStaleProjectDisplayStore.getState().hiddenProjectIds).toEqual(['project-a']);
  });

  it('keeps task detail links on the current prototype origin', () => {
    render(<KozueDashboard displayName="Kozue" />);

    expect(screen.getByRole('link', { name: /明日の確認タスク/ })).toHaveAttribute(
      'href', '/projects/test-project/board?task=upcoming-task'
    );
    expect(screen.getByRole('link', { name: '確認タスク1・表示するプロジェクトA・期限超過 1日' })).toHaveAttribute(
      'href', '/projects/test-project/board?task=task-1'
    );
  });

  it('uses the inbox layout for due tasks and compact task links for stale tasks, with no right-side actions', () => {
    render(<KozueDashboard displayName="Kozue" />);
    const dueRow = screen.getByText('今日やる').parentElement!.parentElement!;
    const staleRow = screen.getByText('3日動いていない').parentElement!.parentElement!;
    for (const row of [dueRow, staleRow]) {
      const links = within(row).getAllByRole('link');
      expect(links).toHaveLength(row === dueRow ? 10 : 3);
      for (const link of links) {
        expect(link.parentElement).toHaveClass('grid-cols-[auto_minmax(0,1fr)]');
      }
      expect(within(row).queryByText('開く')).not.toBeInTheDocument();
      expect(within(row).queryByText('続ける／やめる')).not.toBeInTheDocument();
    }
    const dueLink = within(dueRow).getByRole('link', { name: '確認タスク1・表示するプロジェクトA・期限超過 1日' });
    expect(dueLink).not.toHaveClass('truncate');
    expect(within(dueLink).getByText('確認タスク1')).toHaveClass('min-w-0', 'truncate');
    const dueMeta = within(dueLink).getByText(/表示するプロジェクトA・期限超過 1日/);
    expect(dueMeta).toHaveClass('sm:shrink-0', 'break-words');
    expect(dueMeta).not.toHaveClass('truncate');
    for (const link of within(staleRow).getAllByRole('link')) expect(link).toHaveClass('truncate');
    expect(within(staleRow).getByRole('link', { name: '停止タスク1' })).toHaveAttribute('href', '/projects/project-a/board?task=stale-0');
    fireEvent.click(within(dueRow).getByRole('button', { name: 'すべて表示（11件）' }));
    expect(within(within(dueRow).getByRole('link', { name: /確認タスク11/ })).getByText('確認タスク11')).toHaveClass('truncate');
    expect(within(staleRow).getByRole('button', { name: '3日動いていないの表示設定' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Meetリンク1の設定' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Meetリンク2の設定' })).toBeInTheDocument();
  });

  it('places replies immediately below the schedule without changing its content', () => {
    render(<KozueDashboard displayName="Kozue" />);
    const scheduleRow = screen.getByText('今日の予定').parentElement!.parentElement!;
    const replyRow = screen.getByText('返信待ち・重要').parentElement!.parentElement!;
    expect(scheduleRow.nextElementSibling).toBe(replyRow);
    expect(within(scheduleRow).getByText('予定確認サンプル')).toBeInTheDocument();
    expect(within(replyRow).getByText('返信確認サンプル')).toBeInTheDocument();
    expect(within(replyRow).getByText('CK')).toHaveClass('bg-yellow-200', 'text-yellow-900');
    expect(replyRow.nextElementSibling).toContainElement(screen.getByText('今日やる'));
  });

  it('uses the same task-link layout for confirmation and organization rows', () => {
    render(<KozueDashboard displayName="Kozue" />);

    for (const [label, title, href, action] of [
      ['確認待ち', '確認待ちサンプル', '/projects/project-a/board?task=task-source&comment=review-comment', '確認する'],
      ['要整理', '要整理サンプル', '/projects/test-project/board?task=organize-task', '整理する'],
    ] as const) {
      const row = screen.getByText(label).parentElement!.parentElement!;
      expect(within(row).getByRole('link', { name: label === '確認待ち' ? /確認依頼の元コメント/ : title })).toHaveAttribute('href', href);
      expect(within(row).queryByText(action)).not.toBeInTheDocument();
    }
  });

  it('uses the inbox comment content and context for confirmation waiting items', () => {
    render(<KozueDashboard displayName="Kozue" />);
    const confirmRow = screen.getByText('確認待ち').parentElement!.parentElement!;
    const item = within(confirmRow).getByRole('link', { name: /確認依頼の元コメント/ });
    const meta = within(item).getByText(/依頼者 ／ 実プロジェクト ／ 展示会の準備/);
    expect(item).not.toHaveClass('truncate');
    expect(within(item).getByText('確認依頼の元コメント')).toHaveClass('min-w-0', 'truncate');
    expect(meta).toHaveTextContent('依頼者 ／ 実プロジェクト ／ 展示会の準備・2026/9/3 8:00');
    expect(meta).toHaveClass('sm:shrink-0', 'break-words');
    expect(meta).not.toHaveClass('truncate');
    expect(item).toHaveAttribute('href', '/projects/project-a/board?task=task-source&comment=review-comment');
    expect(within(confirmRow).queryByText('確認待ちサンプル')).not.toBeInTheDocument();
  });

  it('selects real projects for targets and persists the selection without reusing sample goals', () => {
    render(<KozueDashboard displayName="Kozue" />);
    const targets = screen.getByRole('region', { name: '今月の的' });
    expect(within(targets).getByText('表示サンプル')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '今月の的に表示するプロジェクトを選択' }));
    const picker = screen.getByRole('dialog');
    fireEvent.click(within(picker).getByRole('checkbox', { name: '表示するプロジェクトA' }));
    expect(within(targets).getByText('表示するプロジェクトA')).toBeInTheDocument();
    expect(within(targets).queryByText('表示するプロジェクトB')).not.toBeInTheDocument();
    expect(within(targets).queryByText('2商品を出品する')).not.toBeInTheDocument();
    expect(within(targets).getByText('今月おすすめする未完了タスクはありません。')).toBeInTheDocument();
    expect(within(targets).getByText('自動おすすめ')).toBeInTheDocument();
    expect(within(targets).queryByRole('button', { name: '表示するプロジェクトAの的を選択' })).not.toBeInTheDocument();
    expect(within(targets).getByRole('link', { name: 'プロジェクトを開く' })).toHaveAttribute('href', '/projects/project-a/board');
    expect(JSON.parse(localStorage.getItem(TARGET_PROJECT_STORAGE_KEY)!)).toEqual(['project-a']);
    fireEvent.click(within(picker).getByRole('button', { name: 'すべて選択' }));
    expect(within(targets).getAllByRole('link')).toHaveLength(2);
    fireEvent.click(within(picker).getByRole('button', { name: 'すべて外す' }));
    expect(within(targets).getByText(/表示するプロジェクトがありません/)).toBeInTheDocument();
    fireEvent.click(within(picker).getByRole('button', { name: 'サンプル表示に戻す' }));
    expect(within(targets).getByText('2商品を出品する')).toBeInTheDocument();
  });

  it('shows three automatic recommendations, ignores legacy manual choices, and reflects task completion', () => {
    localStorage.setItem(TARGET_PROJECT_STORAGE_KEY, '["project-a"]');
    const legacy = JSON.stringify([{ month: '2026-09', projectId: 'project-a', taskIds: ['d'] }]);
    localStorage.setItem(TARGET_TASK_STORAGE_KEY, legacy);
    recommendationTaskState.tasks = ['a', 'b', 'c', 'd'].map((id) => ({
      id, projectId: 'project-a', projectName: '表示するプロジェクトA', listId: 'list-a', title: `おすすめ${id}`,
      description: '', order: 0, assigneeIds: [], labelIds: [], tagIds: [], dependsOnTaskIds: [], priority: null,
      dueDate: null, startDate: null, durationDays: null, isDueDateFixed: false, isCompleted: false, completedAt: null,
      isAbandoned: false, isArchived: false, archivedAt: null, archivedBy: null, createdBy: 'user-a', createdAt: new Date(), updatedAt: new Date(),
    }));
    const { rerender } = render(<KozueDashboard displayName="Kozue" />);
    const targets = screen.getByRole('region', { name: '今月の的' });
    expect(within(targets).getAllByRole('link', { name: /おすすめ/ })).toHaveLength(3);
    expect(within(targets).queryByText('おすすめd')).not.toBeInTheDocument();
    expect(within(targets).queryByRole('button', { name: '表示するプロジェクトAの的を選択' })).not.toBeInTheDocument();
    expect(within(targets).getByText(/AI接続前の暫定表示/)).toBeVisible();
    recommendationTaskState.tasks = recommendationTaskState.tasks.map((task) => task.id === 'a' ? { ...task, isCompleted: true } : task);
    rerender(<KozueDashboard displayName="Kozue" />);
    expect(within(targets).queryByText('おすすめa')).not.toBeInTheDocument();
    expect(within(targets).getByText('おすすめd')).toBeVisible();
    expect(localStorage.getItem(TARGET_TASK_STORAGE_KEY)).toBe(legacy);
  });

  it('restores selected IDs, reflects renames, and does not replace unavailable projects with samples', () => {
    localStorage.setItem(TARGET_PROJECT_STORAGE_KEY, '["project-b"]');
    const { rerender } = render(<KozueDashboard displayName="Kozue" />);
    const targets = screen.getByRole('region', { name: '今月の的' });
    expect(within(targets).queryByText('表示するプロジェクトA')).not.toBeInTheDocument();
    expect(within(targets).getByText('表示するプロジェクトB')).toBeInTheDocument();
    projectState.projects = [{ id: 'project-b', name: '変更されたプロジェクト名' }];
    rerender(<KozueDashboard displayName="Kozue" />);
    expect(within(targets).getByText('変更されたプロジェクト名')).toBeInTheDocument();
    projectState.projects = [];
    rerender(<KozueDashboard displayName="Kozue" />);
    expect(within(targets).getByText(/選択したプロジェクトは現在表示できません/)).toBeInTheDocument();
    expect(useTargetProjectStore.getState().selectedProjectIds).toEqual(['project-b']);
    expect(within(targets).queryByText('表示サンプル')).not.toBeInTheDocument();
  });

  it('keeps project selection intact during loading and errors', () => {
    localStorage.setItem(TARGET_PROJECT_STORAGE_KEY, '["project-a"]');
    projectState.isLoading = true;
    const { rerender } = render(<KozueDashboard displayName="Kozue" />);
    const targets = screen.getByRole('region', { name: '今月の的' });
    expect(within(targets).getByText('プロジェクトを読み込み中…')).toBeInTheDocument();
    projectState.isLoading = false;
    projectState.error = new Error('offline');
    rerender(<KozueDashboard displayName="Kozue" />);
    expect(within(targets).getByRole('alert')).toHaveTextContent('選択内容は保持しています');
    expect(useTargetProjectStore.getState().selectedProjectIds).toEqual(['project-a']);
  });

  it('expands and collapses the brief without changing task data', () => {
    render(<KozueDashboard displayName="Kozue" />);

    expect(screen.queryByText('確認タスク11')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'すべて表示（11件）' }));
    expect(screen.getByText('確認タスク11')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '表示を戻す' }));
    expect(screen.queryByText('確認タスク11')).not.toBeInTheDocument();
  });

  it('stacks inbox and meeting full-width and shares the brief row layout', () => {
    render(<KozueDashboard displayName="Kozue" />);
    const brief = screen.getByRole('heading', { name: '今日のブリーフ' }).closest('section')!;
    const inbox = screen.getByRole('region', { name: '受信箱' });
    const meeting = screen.getByRole('region', { name: '今日の朝会から' });
    expect(inbox.parentElement).toBe(brief.parentElement);
    expect(inbox.nextElementSibling).toBe(meeting);
    const rowClass = 'lg:grid-cols-[150px_minmax(0,1fr)]';
    for (const section of [brief, inbox, meeting]) {
      expect(section).toHaveClass('border-blue-200');
      expect(section.getElementsByClassName(section === meeting ? 'lg:grid-cols-[220px_minmax(0,1fr)]' : rowClass).length).toBeGreaterThan(0);
    }
    expect(within(inbox).getByText('コメント：TaskFlow実データ')).toBeInTheDocument();
    expect(within(meeting).getByText('会議メモ v2・下書き')).toBeInTheDocument();
    expect(within(meeting).getByText(/TaskFlowのタスクには反映されません/)).toBeInTheDocument();
    expect(within(meeting).queryAllByRole('article')).toHaveLength(0);
    expect(within(meeting).getAllByRole('button', { name: /の子タスクを表示$/ })).toHaveLength(13);
  });

  it('labels the weekly score as fixed sample data that is not connected', () => {
    render(<KozueDashboard displayName="Kozue" />);
    const targets = screen.getByRole('region', { name: '今月の的' });
    const goals = screen.getByRole('region', { name: '達成目標' });
    const score = screen.getByRole('region', { name: '今週のスコア（表示サンプル）' });
    expect(within(targets).queryByRole('region', { name: '達成目標' })).not.toBeInTheDocument();
    expect(targets.nextElementSibling).toBe(goals);
    expect(goals.nextElementSibling).toBe(score);
    expect(goals).toHaveClass('rounded-2xl', 'border', 'shadow-sm');
    expect(within(score).getByText('表示サンプル・未連携')).toBeInTheDocument();
    expect(within(score).getByText(/数値はレイアウト確認用の固定サンプルです/)).toHaveTextContent(
      '売上・レビュー・金額データには接続していません。'
    );
  });

  it('matches every meeting action button to the compact source badges', () => {
    render(<KozueDashboard displayName="Kozue" />);
    const meeting = screen.getByRole('region', { name: '今日の朝会から' });
    const inbox = screen.getByRole('region', { name: '受信箱' });
    const badges = within(inbox).getAllByText('MAIL');
    fireEvent.click(within(meeting).getByRole('button', { name: '出展情報の準備・提出の子タスクを表示' }));
    const buttons = within(meeting).getAllByRole('button', { name: /^(採用|直す|保留|不要)$/ });
    expect(buttons).toHaveLength(28);
    for (const element of [...badges, ...buttons]) {
      expect(element).toHaveClass('h-5', 'min-w-10', 'rounded', 'px-1.5', 'text-[10px]', 'font-bold', 'leading-none');
    }
    for (const button of buttons) {
      expect(button).toBeEnabled();
      expect(button.parentElement).toHaveClass('gap-1.5');
    }
  });

  it('filters the inbox through settings without hiding the brief or meeting', () => {
    render(<KozueDashboard displayName="Kozue" />);
    const inbox = screen.getByRole('region', { name: '受信箱' });
    fireEvent.click(screen.getByRole('button', { name: '受信箱の表示設定' }));
    expect(screen.getByRole('checkbox', { name: 'Gmail' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Google Chat' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Gmail' }));
    expect(within(inbox).queryByText('「納品形式について質問です…」')).not.toBeInTheDocument();
    expect(within(inbox).getByText('実際の確認コメント')).toBeInTheDocument();
    expect(within(inbox).getByText('コメント：TaskFlow実データ')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'コメント' }));
    expect(within(inbox).getByText(/表示する項目がありません/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Google Chat' }));
    expect(within(inbox).queryByText(/表示する項目がありません/)).not.toBeInTheDocument();
    expect(within(inbox).getByText('Google Chatは未連携です。メッセージはまだ取得していません。')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '今日のブリーフ' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '出展情報の準備・提出の子タスクを表示' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(INBOX_DISPLAY_STORAGE_KEY)!)).toEqual({ gmail: false, comments: false, googleChat: true });
    fireEvent.click(screen.getByRole('button', { name: '初期設定に戻す' }));
    expect(within(inbox).getByText('コメント：TaskFlow実データ')).toBeInTheDocument();
    expect(within(inbox).queryByText(/Google Chatは未連携/)).not.toBeInTheDocument();
  });

  it('restores the selected channels when the dashboard is opened again', () => {
    localStorage.setItem(INBOX_DISPLAY_STORAGE_KEY, JSON.stringify({ gmail: false, comments: true, googleChat: true }));
    render(<KozueDashboard displayName="Kozue" />);
    const inbox = screen.getByRole('region', { name: '受信箱' });
    expect(within(inbox).queryByText('「納品形式について質問です…」')).not.toBeInTheDocument();
    expect(within(inbox).getByText('実際の確認コメント')).toBeInTheDocument();
    expect(within(inbox).getByText(/Google Chatは未連携/)).toBeInTheDocument();
  });

  it('shows real comments with their context and a same-origin task link, not the old sample', () => {
    render(<KozueDashboard displayName="Kozue" />);
    const inbox = screen.getByRole('region', { name: '受信箱' });
    expect(within(inbox).getByText('実際の確認コメント')).toBeInTheDocument();
    expect(within(inbox).getByText(/確認担当者 ／ 実プロジェクト ／ 展示会の準備/)).toHaveTextContent('2026/9/3 9:00');
    expect(within(inbox).queryByText(/「実タスク」/)).not.toBeInTheDocument();
    const message = within(inbox).getByRole('link', { name: /実際の確認コメント/ });
    expect(within(message.parentElement!).getByText('🧭')).toBeInTheDocument();
    expect(within(message.parentElement!).getByText('🧭')).toHaveClass('bg-neutral-900', 'text-white');
    expect(message).toHaveAttribute('href', '/projects/project-a/board?task=task-live&comment=real-comment');
    expect(message).not.toHaveClass('truncate');
    expect(within(message).getByText('実際の確認コメント')).toHaveClass('min-w-0', 'truncate');
    expect(within(message).getByText(/確認担当者 ／ 実プロジェクト/)).toHaveClass('sm:shrink-0', 'break-words');
    expect(within(message).getByText(/確認担当者 ／ 実プロジェクト/)).not.toHaveClass('truncate');
    expect(message.parentElement).toHaveClass('grid-cols-[auto_minmax(0,1fr)]');
    expect(message).toContainElement(within(inbox).getByText(/確認担当者 ／ 実プロジェクト/));
    expect(within(inbox).queryByText('タスクへ')).not.toBeInTheDocument();
    expect(within(inbox).queryByText('Gmailへ')).not.toBeInTheDocument();
    expect(within(inbox).getByText('「納品形式について質問です…」').parentElement).toHaveAttribute('aria-disabled', 'true');
    expect(within(inbox).queryByText(/144タイプ/)).not.toBeInTheDocument();
    expect(within(inbox).getByText(/Gmailは表示サンプル/)).toBeInTheDocument();
    fireEvent.click(within(inbox).getByRole('button', { name: 'コメントを更新' }));
    expect(commentState.refresh).toHaveBeenCalled();
  });

  it('uses the same source-comment route in confirmation waiting and the inbox', () => {
    render(<KozueDashboard displayName="Kozue" />);
    const confirmation = within(screen.getByText('確認待ち').parentElement!.parentElement!)
      .getByRole('link', { name: /確認依頼の元コメント/ });
    const inbox = screen.getByRole('region', { name: '受信箱' });
    const sourceComment = within(inbox).getByRole('link', { name: /当日持ちもの|確認依頼の元コメント/ });

    expect(confirmation).toHaveAttribute('href', '/projects/project-a/board?task=task-source&comment=review-comment');
    expect(sourceComment).toHaveAttribute('href', '/projects/project-a/board?task=task-source&comment=review-comment');
  });

  it('keeps only the second Meet link in the brief header without connecting the calendar', () => {
    localStorage.setItem(MEET_LINK_STORAGE_KEY, JSON.stringify([{ name: '朝会', url: 'https://meet.google.com/abc-defg-hij' }, { name: '打ち合わせ', url: 'https://meet.google.com/lookup/team' }]));
    render(<KozueDashboard displayName="Kozue" />);
    const briefHeader = screen.getByRole('heading', { name: '今日のブリーフ' }).closest('section')!.firstElementChild!;
    const meet = within(briefHeader as HTMLElement).getByRole('link', { name: '打ち合わせ' });
    expect(meet).toHaveAttribute('href', 'https://meet.google.com/lookup/team');
    expect(meet).toHaveAttribute('target', '_blank');
    expect(within(briefHeader as HTMLElement).queryByRole('link', { name: '朝会' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Googleカレンダーを接続' })).toBeInTheDocument();
  });

  it('distinguishes a failed read from an empty inbox', () => {
    commentState.hasError = true;
    render(<KozueDashboard displayName="Kozue" />);
    const inbox = screen.getByRole('region', { name: '受信箱' });
    expect(within(inbox).getByRole('alert')).toHaveTextContent('取得できた分のみ');
    expect(within(inbox).queryByText('コメントはまだありません。')).not.toBeInTheDocument();
  });
});
