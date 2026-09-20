import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExtendedPreview, extendedSamples } from './ExtendedPreviews';
import { GuidePreview, type PreviewOptions } from './GuidePreview';
import { UIGuide } from './UIGuide';

// Fail if a specimen mounts the business wrappers, including through a future refactor.
vi.mock('@/components/task/TaskCreationForm', () => ({ TaskCreationForm: () => { throw new Error('business creation mounted'); } }));
vi.mock('@/components/board/TaskCard', () => ({ TaskCard: () => { throw new Error('business task card mounted'); } }));
vi.mock('@/hooks/useNotifications', () => ({ useNotifications: () => { throw new Error('notification subscription mounted'); } }));
vi.mock('@/hooks/useTaskWorkflow', () => ({ useTaskWorkflow: () => { throw new Error('task workflow mounted'); } }));

const options: PreviewOptions = { sample: 'search', long: false, many: false, disabled: false, selected: false, fetchState: 'ready', variant: 'standard' };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('additional isolated guide specimens', () => {
  it('keeps incomplete retrieval distinct from no results, retries and supports keyboard selection', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    render(<ExtendedPreview {...options} variant="partial" />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: '該当しない名前' } });
    expect(screen.getByRole('status')).toHaveTextContent('全体の0件は未確認');
    fireEvent.click(screen.getByRole('button', { name: '不足分を再取得' }));
    expect(input).toHaveValue('該当しない名前');
    expect(screen.getByRole('status')).toHaveTextContent('取得完了');
    fireEvent.change(input, { target: { value: '' } });
    expect(input).not.toHaveAttribute('aria-activedescendant');
    fireEvent.change(input, { target: { value: '案内' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const active = document.getElementById(input.getAttribute('aria-activedescendant')!);
    expect(active).toHaveAttribute('aria-selected', 'true');
    expect(active).toHaveTextContent('プロジェクト');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('region', { name: '検索から開いた架空の詳細' })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves the selected notification after read failure and retries without persistence', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    render(<ExtendedPreview {...options} sample="notifications" />);
    fireEvent.click(screen.getByRole('button', { name: /未読：2/ }));
    fireEvent.click(screen.getByRole('button', { name: '既読にする' }));
    expect(screen.getByRole('alert')).toHaveTextContent('選択と本文を残しています');
    expect(screen.getByRole('button', { name: /未読：2/ })).toHaveAttribute('aria-current', 'true');
    fireEvent.click(screen.getByRole('button', { name: '既読を再試行' }));
    expect(screen.getByRole('status')).toHaveTextContent('見本内で既読');
    expect(screen.getByRole('button', { name: /既読：2/ })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  });

  it.each(extendedSamples)('renders %s without business hooks, requests or storage writes', sample => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    render(<GuidePreview {...options} sample={sample} long many />);
    expect(screen.getByText(/^(既存表示の参考見本|ガイド内の試作・(?:未採用|一部採用あり))$/)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  });

  it('uses existing calendar period controls without mounting task creation', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-21T09:00:00+09:00'));
    render(<ExtendedPreview {...options} sample="calendar" />);
    fireEvent.click(screen.getByRole('button', { name: '週' }));
    expect(screen.getByRole('button', { name: '週' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    const calendarRows = screen.getAllByRole('button').filter(button => /^(?:開始|期限) (?:完了|未完了) /.test(button.getAttribute('aria-label') ?? ''));
    const completedRow = calendarRows.find(button => /^(?:開始|期限) 完了 /.test(button.getAttribute('aria-label') ?? ''));
    const incompleteRow = calendarRows.find(button => /^(?:開始|期限) 未完了 /.test(button.getAttribute('aria-label') ?? ''));
    expect(completedRow).toBeDefined();
    expect(incompleteRow).toBeDefined();
    fireEvent.click(completedRow!);
    expect(screen.getByRole('dialog')).toHaveTextContent('架空タスクの確認');
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    fireEvent.click(incompleteRow!);
    expect(screen.getByRole('dialog')).toHaveTextContent('架空タスクの確認');
  });

  it('carries a selected calendar date into a local task-add popup and keeps cancel non-persistent', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    render(<ExtendedPreview {...options} sample="calendar-task-create-trial" />);
    fireEvent.click(screen.getByRole('button', { name: '9月22日を選択' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByRole('heading', { name: '9月22日にタスクを追加（期限）' })).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByLabelText('架空タスクの期限')).toHaveValue('2026-09-22');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'キャンセル' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '9月22日を選択' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '入力例を確認して閉じる' }));
    expect(screen.getByRole('status')).toHaveTextContent('タスクは保存していません');
    expect(fetch).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  });

  it('renders evidence-based Task/subtask/checklist guidance without guessing an unclear structure', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    render(<ExtendedPreview {...options} sample="task-structure-guidance-trial" long />);
    const card = screen.getByRole('article', { name: 'モアイの説明例（架空）' });
    expect(card).toHaveTextContent('展示会の案内を準備する（架空）');
    expect(card).toHaveTextContent('サブタスク（実際の子タスク）');
    expect(card).toHaveTextContent('担当・状態・期限を持つTaskとして親タスクに紐づいています');
    expect(card).toHaveTextContent('親タスク内のチェックリスト');
    expect(card).toHaveTextContent('チェック項目を子タスクへ変換せず');
    expect(screen.getByRole('region', { name: '構造が不明なときの確認例' })).toHaveTextContent('どちらかに決めず、意図を確認します');
    expect(fetch).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  });

  it('opens and closes the frame dialog and the docked bubble locally', () => {
    render(<ExtendedPreview {...options} sample="frame-trial" variant="dock" />);
    fireEvent.click(screen.getByRole('button', { name: '架空モアイの声かけを開閉' }));
    fireEvent.click(screen.getByRole('button', { name: '声かけを閉じる' }));
    expect(screen.queryByRole('button', { name: '声かけを閉じる' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '末尾の内容を確認' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '閉じる' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not offer navigation for a deleted history target', () => {
    render(<ExtendedPreview {...options} sample="history-trial" variant="link" />);
    expect(screen.getByText('対象は削除済みのため開けません。')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '対象を見本内で開く' })).toHaveLength(3);
  });

  it('keeps the self option first, named people in the middle, and all last with accessible names', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    render(<ExtendedPreview {...options} sample="neo-brief-assignee-filter-trial" long many variant="wrap" />);
    const group = screen.getByRole('group', { name: '今日のブリーフィングの担当者' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map(button => button.getAttribute('aria-label'))).toEqual([
      '関係者への確認を担当する架空のあや・自分',
      '案内資料の準備を担当する架空のれん',
      '参加者との連絡を担当する架空のまどか',
      '写真共有を担当する架空のゆい',
      '展示会場の確認を担当する架空のみちる',
      '配布物の確認を担当する架空のさち',
      '全員',
    ]);
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'true');
    expect(buttons.at(-1)).toHaveAttribute('aria-pressed', 'false');
    expect(within(group).queryByRole('img')).not.toBeInTheDocument();
    const michiru = within(group).getByRole('button', { name: '展示会場の確認を担当する架空のみちる' });
    fireEvent.click(michiru);
    expect(michiru).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('表示：展示会場の確認を担当する架空のみちる');
    const list = screen.getByRole('list', { name: '絞り込み後の架空タスク' });
    expect(within(list).getByText('受付の準備を確認する（架空）')).toBeInTheDocument();
    expect(within(list).queryByText('参加者へ案内内容と集合時刻を共有して返答を確認する（架空）')).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('matches the adopted brief assignee avatar size and keeps the shared countdown display-only', () => {
    render(<ExtendedPreview {...options} sample="neo-brief-row-trial" />);
    expect(screen.getByText(/担当者アイコンは「仕事の続き」と同じ約24px/)).toBeInTheDocument();
    const assignees = screen.getByTestId('task-assignees-icons');
    expect(assignees.querySelector('.h-6.w-6')).toBeTruthy();
    const countdown = render(<ExtendedPreview {...options} sample="neo-shared-countdown-trial" variant="left-padding-reference" long />);
    const card = screen.getByRole('region', { name: '共通カウントダウン（架空）' });
    expect(card).toHaveClass('pl-6');
    expect(card).toHaveTextContent('あと 7 日');
    expect(card).toHaveTextContent('参加者への案内と会場準備の状況を関係者と確認する（架空）');
    expect(within(card).queryByRole('link')).not.toBeInTheDocument();
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
    expect(countdown.container.querySelectorAll('a, button')).toHaveLength(0);
  });

  it('keeps the Neo brief title-to-metadata gap and narrows only attached metadata groups in the trial', () => {
    render(<ExtendedPreview {...options} sample="neo-brief-row-trial" />);
    expect(screen.getByTestId('neo-brief-row-layout').className).toContain('briefRowMetadataGroupsTight');
    expect(screen.getAllByText(/gap-x-3／gap-x-2は実装参照/)).toHaveLength(2);
    const attached = screen.getByTestId('neo-brief-row-layout').querySelector('p > span:nth-child(2)');
    expect(attached).toHaveClass('gap-x-2');
    expect(screen.getByTestId('neo-brief-row-layout').querySelector('p')).toHaveClass('gap-x-3');
  });

  it('shows the countdown spacing relationship while keeping the card informational only', () => {
    const { container } = render(<ExtendedPreview {...options} sample="neo-shared-countdown-trial" variant="aligned-spacing" long />);
    const card = screen.getByRole('region', { name: '共通カウントダウン（架空）' });
    expect(card.className).toContain('countdownAlignedTrial');
    expect(screen.getAllByText(/pl-3・py-3・gap-x-3/)).toHaveLength(2);
    expect(screen.getByText(/間隔の関係を採用済み基準/)).toBeInTheDocument();
    expect(within(card).queryByRole('link')).not.toBeInTheDocument();
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
    expect(container.querySelectorAll('a, button')).toHaveLength(0);
  });

  it('shows Neo home layout directions in a guide-only specimen', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    render(<ExtendedPreview {...options} sample="neo-home-layout-trial" />);
    const briefingHeading = screen.getByRole('heading', { name: '今日のブリーフィング' });
    expect(briefingHeading).toBeInTheDocument();
    expect(briefingHeading).toHaveClass('text-lg');
    expect(briefingHeading.querySelector('svg')).toHaveClass('size-5', 'lucide-sunrise');
    expect(screen.getByTestId('neo-calendar-one-line').className).toContain('neoCalendarRow');
    expect(screen.getByRole('button', { name: 'カウントダウンを更新' }).className).toContain('neoCountdownUpdate');
    const more = screen.getByRole('button', { name: 'ほか2件を見る' });
    expect(more.closest('details')).toBeNull();
    expect(screen.queryByTestId('neo-home-history-empty-proposal')).not.toBeInTheDocument();
    expect(screen.queryByText(/モアイが照合した変更案です/)).not.toBeInTheDocument();
    fireEvent.click(more);
    expect(screen.getByText('2 / 3件')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '提案がない場合を試す' }));
    const history = screen.getByTestId('neo-home-history-empty-proposal');
    const currentRecord = within(history).getByTestId('neo-history-current-record');
    expect(within(history).getByText('1 / 3件')).toBeInTheDocument();
    expect(within(history).getAllByRole('article')).toHaveLength(1);
    expect(currentRecord.className).toContain('neoDecisionRow');
    expect(currentRecord.closest('[data-slot="card"]')).toHaveAttribute('data-density', 'compact');
    expect(within(currentRecord).getByText(/モアイのコメント：案内の日付を確認しました/)).toBeInTheDocument();
    fireEvent.click(within(history).getByRole('button', { name: '次の記録を表示' }));
    expect(within(history).getByText('2 / 3件')).toBeInTheDocument();
    expect(within(history).getAllByRole('article')).toHaveLength(1);
    expect(within(history).queryByText(/モアイのコメント/)).not.toBeInTheDocument();
    fireEvent.click(within(history).getByRole('button', { name: '提案がある場合へ戻す' }));
    expect(screen.queryByTestId('neo-home-history-empty-proposal')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'カウントダウンを更新' }));
    expect(screen.getByRole('status')).toHaveTextContent('見本内で更新しました');
    expect(fetch).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('keeps the new proposal-history presentation separate from the adopted no-proposal view', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    render(<ExtendedPreview {...options} sample="neo-home-layout-trial" variant="history-under-proposal" many />);
    const panel = screen.getByTestId('neo-home-proposal-history-trial');
    expect(within(panel).getByRole('article', { name: '提案（架空）' })).toBeInTheDocument();
    const details = within(panel).getByTestId('neo-history-collapsed-list');
    expect(details).not.toHaveAttribute('open');
    expect(within(details).getByText('これまでの判断・記録（5件）')).toBeInTheDocument();
    fireEvent.click(within(details).getByTestId('neo-history-count-summary'));
    const dates = [...details.querySelectorAll('time')].map(time => time.getAttribute('dateTime'));
    expect(dates).toEqual(['2026-09-17', '2026-09-16', '2026-09-15', '2026-09-14', '2026-09-13']);
    expect(within(details).getAllByTestId('neo-history-record')).toHaveLength(5);
    const historyList = within(details).getByRole('list', { name: '日付の新しい順に並ぶ架空の判断・記録' });
    expect(historyList.className).toContain('neoHistoryList');
    expect(historyList.querySelectorAll(':scope > li [data-testid="neo-history-record"]')).toHaveLength(5);
    expect([...historyList.querySelectorAll('[data-testid="neo-history-record"]')].every(record => record.closest('[data-slot="card"]')?.getAttribute('data-density') === 'compact')).toBe(true);
    expect(within(details).getByText(/モアイのコメント：案内の集合時刻を更新しました/)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  });

  it('shows read-only Neo deadline and work-period groups with preserved progress and parent title', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    render(<ExtendedPreview {...options} sample="neo-home-layout-trial" many />);
    const deadlines = screen.getByRole('list', { name: '期限の架空タスク' });
    const workPeriod = screen.getByRole('list', { name: '作業期間中の架空タスク' });
    const deadlineRows = within(deadlines).getAllByRole('button');
    const workRows = within(workPeriod).getAllByRole('button');
    expect(deadlineRows.map(row => row.getAttribute('data-testid'))).toEqual([
      'neo-home-task-deadline-overdue-high',
      'neo-home-task-deadline-overdue-medium',
      'neo-home-task-deadline-today-high',
    ]);
    expect(workRows.map(row => row.getAttribute('data-testid'))).toEqual([
      'neo-home-task-work-period-high',
      'neo-home-task-work-period-medium',
    ]);
    const overdue = screen.getByTestId('neo-home-task-deadline-overdue-high');
    expect(overdue).toHaveTextContent('期限超過 9/16');
    expect(overdue).toHaveTextContent('着手中');
    expect(overdue).toHaveTextContent('展示会の準備');
    expect(overdue).not.toHaveTextContent('親:');
    expect(screen.getByTestId('neo-home-task-deadline-today-high')).toHaveTextContent('今日が期限 9/18');
    expect(screen.getByTestId('neo-home-task-work-period-high')).toHaveTextContent('着手中');
    expect(screen.getByTestId('neo-home-task-work-period-medium')).toHaveTextContent('未着手');
    expect(screen.queryByText('開始前の資料を整える（対象外）')).not.toBeInTheDocument();
    expect(screen.queryByText('完了済みの案内を送る（対象外）')).not.toBeInTheDocument();
    const paused = screen.getByTestId('neo-home-paused-section');
    expect(within(paused).getByRole('heading', { name: 'チームで保留・待ちにした仕事' })).toBeInTheDocument();
    const pausedTask = within(paused).getByTestId('neo-home-paused-existing-route');
    expect(pausedTask).toHaveTextContent('返答を待つ（既存の保留例）');
    expect(pausedTask).toHaveTextContent('待ち：返答待ち');
    expect(pausedTask).toHaveTextContent('再開の条件：返答が届いたら再開');
    expect(within(deadlines).queryByText('返答を待つ（既存の保留例）')).not.toBeInTheDocument();
    expect(within(workPeriod).queryByText('返答を待つ（既存の保留例）')).not.toBeInTheDocument();

    fireEvent.click(overdue);
    expect(screen.getByRole('dialog')).toHaveTextContent('進捗：着手中');
    expect(screen.getByRole('dialog')).toHaveTextContent('期限：9/16');
    expect(overdue).toHaveTextContent('着手中');
    expect(overdue).toHaveTextContent('期限超過 9/16');
    expect(fetch).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('keeps the guide 30-minute schedule slot at the deadline chip reference height', () => {
    render(<ExtendedPreview {...options} sample="neo-home-layout-trial" />);
    const deadline = screen.getByTestId('neo-deadline-height-reference');
    const slot = screen.getByTestId('neo-30m-height-slot');
    expect(slot.className).toBe(deadline.className);
    expect(screen.getByText(/25pxは独立した採用寸法ではなく/)).toBeInTheDocument();
  });

  it('matches compact, one-item-per-row subtask presentation between Kanban and Progress', () => {
    render(<ExtendedPreview {...options} sample="subtask-view-alignment-trial" many />);
    const kanbanRows = screen.getAllByTestId('subtask-view-row-カンバン');
    const progressRows = screen.getAllByTestId('subtask-view-row-進捗');
    expect(kanbanRows).toHaveLength(7);
    expect(progressRows).toHaveLength(7);
    expect(kanbanRows[0].className).toBe(progressRows[0].className);
    expect(kanbanRows[0]).toHaveAccessibleName(/サブタスク 1（架空）・夕凜・未完了・期限 9\/18/);
    const lists = screen.getAllByRole('list', { name: /のサブタスク一覧/ });
    expect(lists).toHaveLength(2);
    expect(lists.every(list => list.className.includes('subtaskViewList'))).toBe(true);
    expect(screen.getByText(/具体的な行高・余白値は独立した採用値ではありません/)).toBeInTheDocument();
  });

  it('shows seven Kanban card subtasks as independent one-per-item rows', () => {
    render(<ExtendedPreview {...options} sample="task-row-one-line-trial" many />);
    const list = screen.getByRole('list', { name: '1件1行で表示する架空のサブタスク一覧' });
    expect(within(list).getAllByRole('button')).toHaveLength(7);
    expect(list.querySelectorAll(':scope > li')).toHaveLength(7);
    expect([...list.querySelectorAll(':scope > li')].every(item => item.querySelectorAll('button').length === 1)).toBe(true);
    expect(within(list).getByRole('button', { name: 'サブタスク 1' })).toHaveTextContent('夕凜');
    expect(screen.getByText(/プロジェクトを問わず1件1行/)).toBeInTheDocument();
  });

  it('keeps detail-header spacing as a guide-only directional trial', () => {
    render(<ExtendedPreview {...options} sample="detail-header-spacing-trial" long />);
    const header = screen.getByRole('heading', { name: '架空タスクの詳細' }).closest('.tf-detail-header');
    expect(header).toHaveStyle({ paddingBlock: '20px 4px' });
    expect(screen.getByText(/上側を少し広く、下側を少し狭く/)).toBeInTheDocument();
    expect(screen.getByText(/具体的な余白値は未採用/)).toBeInTheDocument();
  });

  it('demonstrates guide-only subtask reordering with drag and keyboard while preserving task boundaries', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    render(<ExtendedPreview {...options} sample="task-detail-subtask-order-trial" />);
    const list = screen.getByRole('list', { name: '並べ替える架空サブタスク' });
    const initial = within(list).getAllByRole('button');
    expect(initial).toHaveLength(3);
    expect(initial[0]).toHaveAttribute('draggable', 'true');
    expect(initial.map(button => button.getAttribute('aria-label'))).toEqual([
      '参加者へ案内を送る（架空）を並べ替え',
      '会場の備品を確認する（架空）を並べ替え',
      '配布資料を整える（架空）を並べ替え',
    ]);
    expect(screen.getByRole('heading', { name: '架空タスクの詳細' }).closest('.tf-detail-header')).toHaveStyle({ paddingBlock: '20px 4px' });
    fireEvent.keyDown(initial[0], { key: ' ' });
    fireEvent.keyDown(initial[0], { key: 'ArrowDown' });
    fireEvent.keyDown(initial[0], { key: ' ' });
    expect(within(list).getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual([
      '会場の備品を確認する（架空）を並べ替え',
      '参加者へ案内を送る（架空）を並べ替え',
      '配布資料を整える（架空）を並べ替え',
    ]);
    expect(screen.getByText(/順番は親タスク側に保存し、子タスク自体の順序は変えません/)).toBeInTheDocument();
    expect(screen.getByText(/「記録しました。」は詳細内に表示しません/)).toBeInTheDocument();
    expect(screen.queryByText(/^記録しました。$/)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveClass('sr-only');
    expect(fetch).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('keeps task metadata on the right, marks Moai rows and frames draggable items in the guide trial', () => {
    render(<ExtendedPreview {...options} sample="task-row-one-line-trial" many />);
    const taskList = screen.getByRole('list', { name: '一行表示を確認する架空のタスク一覧' });
    const moai = within(taskList).getByRole('button', { name: '案内の準備を確認する（架空）' });
    expect(moai).toHaveAttribute('draggable', 'true');
    expect(screen.getAllByLabelText('付随情報')).toHaveLength(6);
    expect(screen.getAllByText('🗿')).toHaveLength(2);
    expect(within(moai).queryByText('モアイ')).not.toBeInTheDocument();
    expect(within(moai).getByLabelText('モアイ')).toHaveTextContent('🗿');
    expect(screen.getByRole('heading', { name: 'サブタスク（1件1行）' })).toBeInTheDocument();
    expect(screen.getAllByLabelText('サブタスクの付随情報')).toHaveLength(7);
    const activeSubtaskList = screen.getByRole('list', { name: '1件1行で表示する架空のサブタスク一覧' });
    expect(within(activeSubtaskList).getAllByRole('button', { name: /^サブタスク/ })).toHaveLength(7);
    expect(screen.getAllByTestId('guide-subtask-row-24px')).toHaveLength(7);
    expect(screen.getByTestId('guide-subtask-summary-frame').className).toContain('subtaskOneLineSection');
    expect(activeSubtaskList.className).toContain('subtaskOneLineRows');
    expect(screen.getByRole('button', { name: 'サブタスク 1' }).className).toContain('subtaskOneLineRow');
    const firstSubtask = screen.getByRole('button', { name: 'サブタスク 1' });
    expect(within(firstSubtask).getByText('夕凜')).toBeInTheDocument();
    expect(within(firstSubtask).getByText('未完了')).toBeInTheDocument();
    expect(within(firstSubtask).getByText('9/16')).toBeInTheDocument();
    expect(screen.getByText(/最小高24px.*外枠px-2.5 py-1.*共通採用寸法ではありません/)).toBeInTheDocument();
    const completedDetails = screen.getByTestId('guide-completed-subtasks-details');
    const completedSummary = within(completedDetails).getByTestId('guide-completed-subtasks-summary');
    expect(completedDetails).not.toHaveAttribute('open');
    expect(completedSummary).toHaveTextContent('完了済み 1件');
    expect(completedSummary.className).toMatch(/completedSubtaskSummary/);
    expect(within(completedDetails).getByText('サブタスク 4')).not.toBeVisible();
    fireEvent.click(completedSummary);
    expect(completedDetails).toHaveAttribute('open');
    expect(within(completedDetails).getByText('サブタスク 4')).toBeVisible();
    expect(screen.getByText(/min-h-6と上下4px（合計24px）は機能改善側の具体化値/)).toBeInTheDocument();
    fireEvent.dragStart(moai);
    expect(moai).toHaveAttribute('data-dragging', 'true');
    fireEvent.dragEnd(moai);
    expect(moai).not.toHaveAttribute('data-dragging');
  });

  it('places the adopted dashboard selector first in the guide-only settings sample', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    render(<ExtendedPreview {...options} sample="settings-dashboard-order-trial" />);
    const page = screen.getByRole('region', { name: 'アプリ設定の架空見本' });
    const sections = [...page.querySelectorAll(':scope > section')];
    expect(sections.map(section => section.getAttribute('aria-labelledby'))).toEqual(['settings-dashboard-order-heading', null]);
    const group = within(page).getByRole('group', { name: '架空のダッシュボード選択' });
    const neo = within(group).getByRole('button', { name: 'Neo' });
    expect(neo).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(group).getByRole('button', { name: 'クラシック' }));
    expect(within(group).getByRole('button', { name: 'クラシック' })).toHaveAttribute('aria-pressed', 'true');
    expect(fetch).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('lets the proposal trial browse without deciding and keeps later choices local', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    render(<ExtendedPreview {...options} sample="proposal-review-flow-trial" />);
    expect(screen.getByText('1 / 3件')).toBeInTheDocument();
    expect(screen.getByRole('article')).toHaveTextContent('今日が回答期限');
    fireEvent.click(screen.getByRole('button', { name: 'ほかの件を見る' }));
    expect(screen.getByText('2 / 3件')).toBeInTheDocument();
    expect(screen.getByRole('article')).toHaveTextContent('待っていた見積もりが届きました');
    fireEvent.click(screen.getByRole('button', { name: 'どういうこと？' }));
    expect(screen.getByRole('region', { name: '提案の詳細' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '今は決めない' }));
    expect(screen.getByRole('article')).toHaveTextContent('通常の候補から外し、一覧には残しています');
    fireEvent.click(screen.getByRole('button', { name: '9月23日に知らせる' }));
    expect(screen.getByRole('article')).toHaveTextContent('指定した日時になりました');
    expect(fetch).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  });

  it('keeps the Moai entry collapsed until opened and makes option examples local only', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    render(<ExtendedPreview {...options} sample="proposal-review-flow-trial" variant="parent-child-review" many />);
    const card = screen.getByRole('article', { name: 'モアイの確認（架空）' });
    const details = within(card).getByTestId('parent-child-moai-details');
    expect(details).not.toHaveAttribute('open');
    expect(within(details).getByText('秋の展示会の準備（架空） · 未完了サブタスク 3件')).toBeInTheDocument();
    expect(within(details).getByText(/次のサブタスクも完了していますか/)).not.toBeVisible();
    expect(screen.queryByTestId('parent-child-dashboard-card')).not.toBeInTheDocument();

    fireEvent.click(within(details).getByText('秋の展示会の準備（架空） · 未完了サブタスク 3件'));
    expect(details).toHaveAttribute('open');
    expect(within(details).getByText(/次のサブタスクも完了していますか/)).toBeInTheDocument();
    expect(within(details).getByText('展示什器の受取日を確認する')).toBeInTheDocument();
    expect(within(details).getByText('展示会場の最終チェックをする')).toBeInTheDocument();
    expect(within(details).getByText('設営後の写真を共有する')).toBeInTheDocument();
    expect(within(details).getByText('選択肢例（表示文言・対応は未採用）')).toBeInTheDocument();
    fireEvent.click(within(details).getByRole('button', { name: 'サブタスクを完了にする' }));
    expect(within(details).getByRole('status')).toHaveTextContent('実データ・保存内容は変えていません');
    expect(fetch).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('shows only the dashboard fact card and direct-detail examples when that surface is selected', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    render(<ExtendedPreview {...options} sample="proposal-review-flow-trial" variant="parent-child-review" />);
    fireEvent.change(screen.getByLabelText('表示例'), { target: { value: 'dashboard' } });
    const card = screen.getByRole('article', { name: 'ダッシュボードの事実カード（架空）' });
    expect(card).toHaveTextContent('秋の展示会の準備（架空） — 完了');
    expect(card).toHaveTextContent('展示什器の受取日を確認する');
    expect(card).toHaveTextContent('展示会場の最終チェックをする');
    expect(within(card).getByRole('button', { name: '親の詳細（見本）' })).toBeInTheDocument();
    expect(within(card).getAllByRole('button', { name: '詳細（見本）' })).toHaveLength(2);
    expect(screen.queryByTestId('parent-child-moai-card')).not.toBeInTheDocument();
    expect(screen.queryByText(/次のサブタスクも完了していますか/)).not.toBeInTheDocument();
    expect(screen.getByText('同じ確認を重ねて表示しません。')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('distinguishes confirmed no-match from failed or pending retrieval', () => {
    const props = { ...options, sample: 'proposal-review-flow-trial', variant: 'parent-child-review' };
    const { rerender } = render(<ExtendedPreview {...props} fetchState="loading" />);
    expect(screen.getByRole('status')).toHaveTextContent('状態を確認しています');
    rerender(<ExtendedPreview {...props} fetchState="error" />);
    expect(screen.getByRole('alert')).toHaveTextContent('対象なしとは扱わず');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    rerender(<ExtendedPreview {...props} fetchState="empty" />);
    expect(screen.getByRole('status')).toHaveTextContent('取得成功');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });



  it('keeps specimen trial, user adoption and screen implementation as separate states', () => {
    const { unmount } = render(<UIGuide initialSample="neo-brief-row-trial" />);
    expect(screen.getByText('ガイド内の試作・一部採用あり')).toBeInTheDocument();
    expect(screen.getByLabelText('見本・採用・実画面の状態')).toHaveTextContent('複合見本全体：ガイド内の試作');
    expect(screen.getByLabelText('見本・採用・実画面の状態')).toHaveTextContent('ユーザー採用：NeoMorningBrief');
    expect(screen.getByLabelText('見本・採用・実画面の状態')).toHaveTextContent('実画面への反映：前回の各4pxは実装・関連検証済み。最新の各2pxはメイン側bde4で実装・検証済み');
    unmount();
    render(<UIGuide initialSample="task-row-one-line-trial" />);
    expect(screen.getByLabelText('見本・採用・実画面の状態')).toHaveTextContent('カンバンカード内で展開するサブタスク一覧');
    expect(screen.getByLabelText('見本・採用・実画面の状態')).toHaveTextContent(/§13\.24のカンバン「完了済み N件」summaryだけにpy-1を追加/);
    expect(screen.getByLabelText('見本・採用・実画面の状態')).toHaveTextContent(/全プロジェクトの展開サブタスク1件1行適用・確認/);
  });

  it('exposes retrieval states and the limited parent-child review variant in the guide controls', () => {
    render(<UIGuide initialSample="proposal-review-flow-trial" />);
    expect(screen.getByLabelText('取得状態')).toBeInTheDocument();
    expect(screen.getByLabelText('バリエーション')).toHaveValue('standard');
    expect(screen.getByRole('option', { name: '親完了・未完了サブタスクの確認' })).toBeInTheDocument();
  });

  it('opens additional specimens while generated usage is pending and labels trials explicitly', () => {
    render(<UIGuide initialSample="frame-trial" />);
    expect(screen.getByLabelText('見本・採用・実画面の状態')).toHaveTextContent('複合見本全体：ガイド内の試作ユーザー採用：なし実画面への反映：なし');
    const link = screen.getByRole('link', { name: 'この条件の見本だけを別タブで開く' });
    expect(link).toHaveAttribute('href', expect.stringContaining('sample=frame-trial'));
  });
});
