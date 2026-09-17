'use client';

import { useId, useState } from 'react';
import { addDays, startOfDay } from 'date-fns';
import { CalendarClock, CalendarDays, CircleHelp, Clock3, GripVertical, ListChecks, Pause, RefreshCw, Shuffle, Sunrise, TriangleAlert, UsersRound } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { HelpText, Prose } from '@/components/ui/typography';
import { AsyncState } from '@/components/ui/async-state';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { HistoryPane } from '@/components/common/HistoryPane';
import { TaskCalendarView } from '@/components/board/TaskCalendarView';
import { GanttChart } from '@/components/gantt/GanttChart';
import { TaskOutlineView } from '@/components/board/TaskOutlineView';
import { TaskAssignees, TaskDate, TaskPriority, TaskStatus } from '@/components/board/TaskViewFields';
import { CompanionBubble, GreetingContent } from '@/components/ai/CompanionBubble';
import { NeoBriefTaskHeading } from '@/components/dashboard/NeoBriefTaskRow';
import { DetailBody, DetailFrame, detailContent, detailHeader } from '@/components/ui/screen-layouts';
import type { DashboardTask } from '@/lib/dashboard/brief';
import type { TaskViewMember } from '@/components/board/TaskViewFields';
import type { Task } from '@/types';
import { TASK_STATUSES, taskStatus } from '@/lib/task/status';
import { guideDescription, guideLists, guideNames, guideTasks } from './fixtures';
import { guideNotifications, guideHistory } from './extendedFixtures';
import type { PreviewOptions } from './GuidePreview';
import styles from './ExtendedPreviews.module.css';

export const extendedSamples = ['search', 'notifications', 'calendar', 'calendar-task-create-trial', 'gantt', 'progress', 'frame-trial', 'table-trial', 'history-trial', 'neo-brief-row-trial', 'neo-brief-assignee-filter-trial', 'neo-shared-countdown-trial', 'neo-home-layout-trial', 'detail-header-spacing-trial', 'task-detail-subtask-order-trial', 'task-row-one-line-trial', 'task-structure-guidance-trial', 'subtask-view-alignment-trial', 'proposal-review-flow-trial', 'settings-dashboard-order-trial'];

function SearchPreview({ long, many, disabled, fetchState: initialState, variant }: PreviewOptions) {
  const [query, setQuery] = useState('案内');
  const [state, setState] = useState(initialState);
  const [partial, setPartial] = useState(variant === 'partial');
  const [index, setIndex] = useState(0);
  const [opened, setOpened] = useState('');
  const listId = useId();
  const candidates = [...guideTasks(long, many, false).map(task => ({ ...task, kind: 'タスク' })), { id: 'guide-search-project', title: '案内の準備プロジェクト（架空）', kind: 'プロジェクト' }];
  const matches = candidates.filter(item => item.title.includes(query.trim()));
  const results = state === 'ready' && query.trim() ? matches : [];
  const activeIndex = Math.min(index, Math.max(0, results.length - 1));
  return <div className="space-y-3">
    <label htmlFor={`${listId}-input`} className="mb-1 block text-sm font-medium">仕事・プロジェクトを検索（架空）</label>
    <Input id={`${listId}-input`} role="combobox" aria-autocomplete="list" aria-expanded={results.length > 0}
      aria-controls={listId} aria-activedescendant={results.length ? `${listId}-${activeIndex}` : undefined}
      aria-describedby={`${listId}-help`} disabled={disabled} value={query}
      onChange={e => { setQuery(e.target.value); setIndex(0); setOpened(''); }}
      onKeyDown={e => {
        if (['ArrowDown', 'ArrowUp'].includes(e.key) && results.length) {
          e.preventDefault();
          const next = (activeIndex + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
          setIndex(next); document.getElementById(`${listId}-${next}`)?.scrollIntoView?.({ block: 'nearest' });
        }
        if (e.key === 'Enter' && results[activeIndex]) { e.preventDefault(); setOpened(results[activeIndex].title); }
        if (e.key === 'Escape') { setQuery(''); setOpened(''); }
      }} />
    <HelpText id={`${listId}-help`}>上下キーで選び、Enterで架空の詳細を表示。Escで検索語を消します。</HelpText>
    {state !== 'ready' && <AsyncState state={state} message={state === 'loading' ? '検索対象を取得中…' : state === 'empty' ? '取得が完了しました。該当する仕事はありません。' : '検索対象を取得できませんでした。0件とは判定できません。'} onRetry={() => setState('ready')} />}
    {state === 'ready' && partial && <div role="alert" className="rounded-md border p-3 text-sm">一部のプロジェクトを取得できていません。表示は取得できた範囲だけです。<Button variant="outline" size="sm" disabled={disabled} onClick={() => setPartial(false)}>不足分を再取得</Button></div>}
    {state === 'ready' && <p role="status" className="text-sm">{!query.trim() ? '検索語を入力してください。' : results.length ? `${results.length}件${partial ? '（取得できた範囲）' : ''}` : partial ? '取得できた範囲に一致なし。全体の0件は未確認です。' : '取得完了・該当する仕事はありません。'}</p>}
    <ul id={listId} role="listbox" aria-label="架空の検索結果" className="divide-y rounded-md border">{results.map((task, i) => <li id={`${listId}-${i}`} key={task.id} role="option" aria-selected={activeIndex === i}
      className={`cursor-pointer p-3 text-sm break-words ${activeIndex === i ? 'bg-muted' : ''}`}
      onClick={() => { if (!disabled) { setIndex(i); setOpened(task.title); } }}>
      <span className="block font-medium">{task.title}</span><HelpText>案内の準備（架空）・{task.kind}</HelpText>
    </li>)}</ul>
    {opened && <section aria-label="検索から開いた架空の詳細" className="rounded-md border p-3"><Prose>{opened}</Prose><HelpText>この見本内で開きました。実画面への移動・保存はありません。</HelpText></section>}
  </div>;
}

function NotificationPreview({ long, many, disabled, fetchState: initialState }: PreviewOptions) {
  const items = guideNotifications(long, many);
  const [state, setState] = useState(initialState);
  const [selectedId, setSelectedId] = useState(items[0].id);
  const [readIds, setReadIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [failNext, setFailNext] = useState(true);
  const [opened, setOpened] = useState(false);
  const selected = items.find(item => item.id === selectedId)!;
  if (state !== 'ready') return <AsyncState state={state} message={state === 'loading' ? '通知を読み込み中…' : state === 'empty' ? '通知はありません。' : '通知を取得できませんでした。'} onRetry={() => setState('ready')} />;
  return <div className="space-y-3"><HelpText>共有の履歴枠を使用。選択・既読・再試行の内容は架空の試作です。</HelpText>
    <div className="flex h-[440px] min-w-0 rounded-lg border">
      <HistoryPane label="通知履歴（架空）" list={<ul>{items.map(item => <li key={item.id}><Button disabled={disabled} variant={selectedId === item.id ? 'secondary' : 'ghost'}
        aria-current={selectedId === item.id ? 'true' : undefined} className="h-auto w-full justify-start whitespace-normal p-3 text-left"
        onClick={() => { setSelectedId(item.id); setError(''); setOpened(false); }}>{!readIds.includes(item.id) ? '未読：' : '既読：'}{item.title}</Button></li>)}</ul>}>
        <section aria-label="架空の通知本文" className="min-h-0 space-y-3 overflow-y-auto p-3">
          <h3 className="text-sm font-semibold break-words">{selected.title}</h3><Prose>{selected.message}</Prose><HelpText>{selected.date}・案内の準備（架空）</HelpText>
          <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={disabled} onClick={() => setOpened(true)}>元の内容を表示</Button>
            <Button disabled={disabled || readIds.includes(selected.id)} onClick={() => {
              if (failNext) { setError('既読にできませんでした。選択と本文を残しています。もう一度試せます。'); setFailNext(false); }
              else { setReadIds(ids => [...ids, selected.id]); setError(''); }
            }}>{readIds.includes(selected.id) ? '既読' : error ? '既読を再試行' : '既読にする'}</Button></div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {readIds.includes(selected.id) && <p role="status" className="text-sm">見本内で既読にしました。</p>}
          {opened && <Card density="compact"><CardHeader><CardTitle>元の案内（架空）</CardTitle></CardHeader><CardContent><Prose>{guideDescription(long)}</Prose></CardContent></Card>}
        </section>
      </HistoryPane>
    </div>
  </div>;
}

function SpecialViewPreview(options: PreviewOptions) {
  const { sample, long, many, disabled, fetchState: initialState } = options;
  const [state, setState] = useState(initialState);
  const [opened, setOpened] = useState<string | null>(null);
  // Keep calendar examples in the current month without changing the shared calendar's clock.
  const [today] = useState(() => startOfDay(new Date()));
  const tasks = guideTasks(long, many, false).map((task, i) => ({
    ...task,
    startDate: addDays(today, i % 3),
    dueDate: addDays(today, i % 3 + 2),
    isCompleted: sample === 'calendar' ? i === 1 : task.isCompleted,
    completedAt: sample === 'calendar' ? i === 1 ? today : null : task.completedAt,
  }));
  const selected = tasks.find(task => task.id === opened);
  return <div className="min-w-0 space-y-3">
    <HelpText>{sample === 'progress' ? '進捗は共有Cardと状態名を使った構成見本です。実ビューの再現ではなく、列移動・業務フックは接続していません。' : '既存の専用ビューに架空データを渡した表示見本です。日付は閲覧日を基準にしています。作成・日付保存は接続していません。'}</HelpText>
    {state !== 'ready' ? <AsyncState state={state} message={state === 'loading' ? 'タスクを読み込み中…' : state === 'empty' ? 'この表示に該当するタスクはありません。' : 'タスクを取得できませんでした。'} onRetry={() => setState('ready')} /> :
      <fieldset disabled={disabled} className="min-w-0">
        {sample === 'calendar' && <TaskCalendarView tasks={tasks} lists={guideLists} names={guideNames} onTaskClick={setOpened} />}
        {sample === 'gantt' && <div className="h-[520px] min-w-0"><GanttChart tasks={tasks} lists={guideLists} labels={[]} onTaskClick={setOpened} /></div>}
        {sample === 'progress' && <div className="flex gap-3 overflow-x-auto pb-3" aria-label="架空の進捗列" tabIndex={0}>{TASK_STATUSES.map(status => <section key={status.id} className="w-64 shrink-0 space-y-3 rounded-md border p-3">
          <h3 className="text-sm font-semibold">{status.label}</h3>{tasks.filter(task => taskStatus(task, tasks) === status.id).map(task => <Card key={task.id} density="compact"><CardHeader><CardTitle><Button variant="ghost" className="h-auto w-full justify-start whitespace-normal p-0 text-left" onClick={() => setOpened(task.id)}>{task.title}</Button></CardTitle></CardHeader><CardContent><HelpText>架空のあや・案内の準備</HelpText></CardContent></Card>)}
          {!tasks.some(task => taskStatus(task, tasks) === status.id) && <HelpText>タスクなし</HelpText>}
        </section>)}</div>}
      </fieldset>}
    <Dialog open={!!selected} onOpenChange={open => { if (!open) setOpened(null); }}><DialogContent><DialogHeader><DialogTitle>架空タスクの確認</DialogTitle><DialogDescription>{selected?.title}</DialogDescription></DialogHeader><Prose>{selected?.description}</Prose><Button onClick={() => setOpened(null)}>閉じる</Button></DialogContent></Dialog>
  </div>;
}

function FrameTrial({ long, many, variant, disabled }: PreviewOptions) {
  const docked = variant !== 'overlay';
  const [bubble, setBubble] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const tasks = guideTasks(long, many, false).filter(task => filter !== 'open' || !task.isCompleted);
  const filters = <label className="flex flex-wrap items-center gap-2 text-sm">状態<select aria-label="架空の状態フィルター" disabled={disabled} className="max-w-full rounded border bg-background p-2" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">すべて</option><option value="open">未完了</option></select></label>;
  const launcher = <Button disabled={disabled} variant="outline" aria-label="架空モアイの声かけを開閉" aria-expanded={bubble} onClick={() => setBubble(!bubble)}>🗿 モアイ</Button>;
  return <div className="space-y-3"><HelpText>簡略化した画面枠で比較します。現在の保存位置や実ランチャーを再現するものではありません。</HelpText>
    <div className={styles.stage} data-frame-mode={docked ? 'dock' : 'overlay'}>
      <header className={styles.frameHeader}><h3 className="text-base font-semibold break-words">{long ? '初めての参加者へ向けた案内と当日の準備を関係者で確認するプロジェクト（架空）' : '案内の準備（架空）'}</h3>
        {docked ? <details><summary className="cursor-pointer py-2 text-sm">説明・フィルター（{filter === 'all' ? 'すべて' : '未完了'}）</summary><Prose>{guideDescription(long)}</Prose>{filters}</details> : <><Prose>{guideDescription(long)}</Prose>{filters}</>}
      </header>
      <div className={styles.frameBody} tabIndex={0} aria-label="架空の本文スクロール領域"><TaskOutlineView projectId="guide-project" viewerId="guide-aya" tasks={tasks} lists={guideLists} names={guideNames} onTaskClick={setDetail} /></div>
      {docked && bubble && <div className={styles.dockedBubble}><CompanionBubble variant="greeting"><GreetingContent message={guideDescription(long)} onDismiss={() => setBubble(false)} /></CompanionBubble></div>}
      <footer className={styles.frameFooter}><Button variant="outline" disabled={disabled} onClick={() => setDetail(tasks[0]?.id ?? 'guide-parent')}>末尾の内容を確認</Button>{docked && launcher}</footer>
      {!docked && <aside className={styles.floating}>{bubble && <CompanionBubble variant="greeting"><GreetingContent message={guideDescription(long)} onDismiss={() => setBubble(false)} /></CompanionBubble>}{launcher}</aside>}
    </div>
    <Dialog open={!!detail} onOpenChange={open => { if (!open) setDetail(null); }}><DialogContent><DialogHeader><DialogTitle>内容の確認（架空）</DialogTitle><DialogDescription>モーダルとモアイの位置を比較する未採用見本です。</DialogDescription></DialogHeader><Prose>{tasks.find(task => task.id === detail)?.title}</Prose><Button onClick={() => setDetail(null)}>閉じる</Button></DialogContent></Dialog>
  </div>;
}

function TableTrial({ long, many, variant, disabled }: PreviewOptions) {
  const tasks = guideTasks(long, many, false);
  const [opened, setOpened] = useState('');
  return <div className="space-y-3"><HelpText>既存の比較表は内部スクロールが採用済みです。以下は同じ架空の小表で「固定なし／名前列を固定」を比較する未採用案で、TaskTableViewそのものではありません。</HelpText>
    <div className={styles.tableScroll} tabIndex={0} aria-label="名前列の固定を比較する架空の表"><table className={styles.comparison} data-pinned={variant === 'pinned'}><thead><tr><th>タスク名</th><th>担当</th><th>期限</th><th>優先度</th><th>状態</th></tr></thead><tbody>{tasks.map(task => <tr key={task.id}><th scope="row"><Button variant="ghost" disabled={disabled} className="h-auto w-full justify-start whitespace-normal p-0 text-left" onClick={() => setOpened(task.title)}>{task.title}</Button></th><td>架空のあや</td><td>9月23日</td><td>中</td><td>{task.isCompleted ? '完了' : '未着手'}</td></tr>)}</tbody></table></div>
    <p role="status" className="text-sm break-words">{opened ? `選んだタスク：${opened}` : '右へスクロールして、行の名前と比較列が両方読めるか確認します。'}</p>
  </div>;
}

function HistoryTrial({ long, variant, disabled }: PreviewOptions) {
  const [opened, setOpened] = useState('');
  return <div className="space-y-3"><HelpText>業務名への置き換えと対象への入口を検討する未採用案です。内部名の現状は監査F07を参照します。</HelpText><ul className="divide-y rounded-md border p-3">{guideHistory(long).map(item => <li key={item.id} className="tf-compact-row space-y-2"><Prose>{item.label}：{item.description}</Prose><HelpText>9月16日・架空のあや</HelpText>{variant === 'link' && (item.deleted ? <HelpText>対象は削除済みのため開けません。</HelpText> : <Button variant="outline" disabled={disabled} onClick={() => setOpened(item.description)}>対象を見本内で開く</Button>)}</li>)}</ul>{opened && <section aria-label="履歴の対象（架空）" className="rounded border p-3"><Prose>{opened}</Prose></section>}</div>;
}

function NeoBriefRowTrial({ long, variant }: PreviewOptions) {
  const source = guideTasks(false, false, false)[0];
  const task: DashboardTask = {
    ...source,
    id: 'guide-neo-brief-row',
    title: long ? 'UPSIDER引落手続＠あおぞら銀行の確認と担当者への共有を今日中に済ませる（架空）' : 'UPSIDER引落手続＠あおぞら銀行',
    projectName: '総務（架空）',
    projectIcon: '総務',
    projectColor: '#334155',
    listName: 'その他',
    assigneeIds: ['guide-aya', 'guide-ren'],
    workProgress: 'not_started',
    startDate: null,
    dueDate: new Date('2026-09-16T23:00:00+09:00'),
  };
  const members: Record<string, TaskViewMember> = Object.fromEntries(Object.entries(guideNames).map(([id, displayName]) => [id, { id, displayName }]));
  return <div className="space-y-3">
    <HelpText>採用済み：Neoの「今日の仕事・期限」と「タスク一覧」の共有行は、上下余白が各2px、横余白20pxです。操作対象は最低32pxを保ち、内側の情報間隔は変えません。「今日の仕事・期限」の担当者アイコンは「仕事の続き」と同じ約24pxです。追加採用：タイトルと付随情報の間隔は保ち、付随情報のまとまり同士だけを狭めます。機能改善側の現在値gap-x-3／gap-x-2は実装参照で、数値自体は採用値ではありません。従来の塊間・アイコン間比較案も別に残します。</HelpText>
    <div className={styles.briefRowTrial} data-testid="neo-brief-row-trial">
      <div className={`${styles.briefRowAdopted} ${variant === 'previous-groups' ? styles.briefRowPreviousGroups : styles.briefRowMetadataGroupsTight}`} data-testid="neo-brief-row-layout">
        <NeoBriefTaskHeading task={task} now={new Date('2026-09-16T09:00:00+09:00')} members={members} names={guideNames} tasks={[task]} />
      </div>
    </div>
    <p className="text-xs text-muted-foreground">採用済み：上下各2px・横20px・操作対象の高さ最低32px、タイトルと付随情報の間隔を保ち付随情報のまとまり間を狭める方向。gap-x-3／gap-x-2は実装参照値で、独立採用寸法ではありません。</p>
  </div>;
}


function NeoBriefAssigneeFilterTrial({ long, many, disabled, variant }: PreviewOptions) {
  const self = { id: 'guide-aya', name: long ? '関係者への確認を担当する架空のあや' : '架空のあや', initial: 'あ', self: true, tone: 'bg-rose-100 text-rose-900' };
  const otherPeople = [
    { id: 'guide-ren', name: long ? '案内資料の準備を担当する架空のれん' : '架空のれん', initial: 'れ', tone: 'bg-sky-100 text-sky-900', self: false },
    { id: 'guide-michiru', name: long ? '展示会場の確認を担当する架空のみちる' : '架空のみちる', initial: 'み', tone: 'bg-violet-100 text-violet-900', self: false },
    { id: 'guide-madoka', name: long ? '参加者との連絡を担当する架空のまどか' : '架空のまどか', initial: 'ま', tone: 'bg-amber-100 text-amber-900', self: false },
    { id: 'guide-yui', name: long ? '写真共有を担当する架空のゆい' : '架空のゆい', initial: 'ゆ', tone: 'bg-emerald-100 text-emerald-900', self: false },
    { id: 'guide-sachi', name: long ? '配布物の確認を担当する架空のさち' : '架空のさち', initial: 'さ', tone: 'bg-pink-100 text-pink-900', self: false },
  ];
  const people = [self, ...otherPeople.slice(0, many ? 5 : 2).sort((a, b) => a.name.localeCompare(b.name, 'ja'))];
  const [selectedId, setSelectedId] = useState(self.id);
  const taskTitles = [
    long ? '参加者へ案内内容と集合時刻を共有して返答を確認する（架空）' : '案内の回答期限を確認する（架空）',
    '展示会場の最終チェックをする（架空）',
    '配布物の数を確認する（架空）',
    '関係者へ写真を共有する（架空）',
    '受付の準備を確認する（架空）',
    '終了後の記録をまとめる（架空）',
  ];
  const tasks = people.map((person, index) => ({ id: 'guide-brief-task-' + index, title: taskTitles[index], assigneeId: person.id, assigneeName: person.name }));
  const visibleTasks = selectedId === 'all' ? tasks : tasks.filter(task => task.assigneeId === selectedId);
  const selectedPerson = people.find(person => person.id === selectedId);
  const selectedLabel = selectedId === 'all' ? '全員' : (selectedPerson?.name ?? self.name) + (selectedPerson?.self ? '（自分）' : '');
  const compact = variant === 'compact';

  return <div className="min-w-0 space-y-3" data-testid="neo-brief-assignee-filter-trial">
    <HelpText>ガイド内だけの架空フィルター試作です。初期選択は自分、他の担当者は名前順、全員は最後に置きます。</HelpText>
    <section className="min-w-0 space-y-3 rounded-lg border p-3" aria-label="今日のブリーフィングを担当者で絞り込む見本">
      <h3 className="text-sm font-semibold">今日のブリーフィング</h3>
      <div role="group" aria-label="今日のブリーフィングの担当者" className="flex min-w-0 max-w-full flex-wrap items-center gap-1">
        {people.map(person => {
          const selected = selectedId === person.id;
          const accessibleName = person.self ? person.name + '・自分' : person.name;
          return <Button key={person.id} type="button" size="sm" variant={selected ? 'default' : 'ghost'} aria-label={accessibleName} aria-pressed={selected} title={accessibleName} disabled={disabled}
            className={compact ? 'h-8 min-w-0 max-w-40 gap-1.5 px-2' : 'h-auto min-h-8 min-w-0 max-w-full flex-wrap gap-1.5 whitespace-normal px-2 py-1 text-left'}
            onClick={() => setSelectedId(person.id)}>
            <Avatar aria-hidden="true" className="size-5 shrink-0 border border-background text-[9px]">
              <AvatarFallback className={person.tone}>{person.initial}</AvatarFallback>
            </Avatar>
            <span className={compact ? 'max-w-24 truncate' : 'min-w-0 break-words'}>{person.name}</span>
            {person.self && <span className="shrink-0 text-[10px] font-normal opacity-80">自分</span>}
          </Button>;
        })}
        <Button type="button" size="sm" variant={selectedId === 'all' ? 'default' : 'ghost'} aria-label="全員" aria-pressed={selectedId === 'all'} disabled={disabled} className="h-8 min-w-0 gap-1.5 px-2" onClick={() => setSelectedId('all')}>
          <UsersRound className="size-3.5 shrink-0" aria-hidden="true" />全員
        </Button>
      </div>
      <p role="status" className="text-xs text-muted-foreground">表示：{selectedLabel}</p>
      <ul className="divide-y rounded-md border" aria-label="絞り込み後の架空タスク">
        {visibleTasks.map(task => <li key={task.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 p-2 text-sm">
          <span className="min-w-0 flex-1 break-words">{task.title}</span>
          <span className="text-xs text-muted-foreground">{task.assigneeName}</span>
        </li>)}
      </ul>
    </section>
    <HelpText>名前は視覚表示し、各操作のアクセシブルな名前には省略前の架空の担当者名を含めます。アイコンは装飾扱いです。長い名前は表示名を折り返す案と省略する案を切り替えて確認します。選択結果とタスクはこの見本内だけで変わり、取得・保存はしません。</HelpText>
  </div>;
}


function NeoSharedCountdownTrial({ long, variant }: PreviewOptions) {
  const title = long
    ? '参加者への案内と会場準備の状況を関係者と確認する（架空）'
    : '展示準備の資料を確認する（架空）';
  const aligned = variant !== 'left-padding-reference';
  return <div className="min-w-0 space-y-3" data-testid="neo-shared-countdown-trial">
    <HelpText>採用済み：共通カウントダウンは表示専用です。「あとN日」や対象名からタスクへ移動しません。カード内側の左端とアイコンを揃え、アイコンと内容の間隔を上下の外側余白に揃えます。pl-3・py-3・gap-x-3（各12px）は現在の実装参照値で、数値そのものは独立採用していません。以前の左余白比較案も別に確認できます。</HelpText>
    <section aria-label="共通カウントダウン（架空）" data-testid="countdown-spacing-card" className={aligned ? styles.countdownAlignedTrial : 'grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 rounded-2xl border border-amber-200 bg-amber-50 py-3 pl-6 pr-5 text-amber-950 shadow-sm'}>
      <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-full bg-white text-amber-700 shadow-sm"><Clock3 className="size-4" /></span>
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-end gap-x-4 gap-y-1 text-sm">
        <span className="whitespace-nowrap text-lg font-bold tabular-nums">あと <span className="text-xl">7</span> 日</span>
        <span className="min-w-0 break-words font-medium leading-relaxed">{title} <span className="text-xs font-normal text-muted-foreground">（9/23）</span></span>
      </div>
    </section>
    <HelpText>{aligned ? 'カード全体は架空表示で、日数・タスク名はリンクやボタンではありません。間隔の関係を採用済み基準として示します。pl-3・py-3・gap-x-3は機能改善側の現在値を示す参照で、採用寸法ではありません。' : '以前の比較案：左余白を増やした24px（pl-6）表示です。採用済みの間隔関係との比較用で、現在の実装値ではありません。'}</HelpText>
  </div>;
}

function CalendarTaskCreateTrial({ long, disabled }: PreviewOptions) {
  const [selectedDate, setSelectedDate] = useState('');
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const dates = ['2026-09-21', '2026-09-22', '2026-09-23'];
  return <div className="min-w-0 space-y-3" data-testid="calendar-task-create-trial">
    <HelpText>日付選択からタスク追加ポップアップへつなぐ採用済みの流れを、ガイド内だけで確認する試作です。日付と入力はこの見本内だけに保持し、業務フォーム・通信・保存処理は使いません。</HelpText>
    <section className={styles.calendarCreateTrial} aria-label="日付からタスク追加を開く架空カレンダー">
      <h3>2026年9月</h3>
      <div className={styles.calendarCreateDates} role="group" aria-label="タスク追加日を選ぶ">
        {dates.map(date => <Button key={date} type="button" variant={selectedDate === date ? 'secondary' : 'outline'} disabled={disabled} aria-pressed={selectedDate === date} aria-label={`${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日を選択`} onClick={() => { setSelectedDate(date); setOpen(true); setMessage(''); }}>{Number(date.slice(8, 10))}日</Button>)}
      </div>
      <p className="text-xs text-muted-foreground">日付を押すと、その日を期限欄へ入れたタスク追加ポップアップを開きます。</p>
    </section>
    {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>{selectedDate ? `${Number(selectedDate.slice(5, 7))}月${Number(selectedDate.slice(8, 10))}日にタスクを追加（期限）` : 'タスク追加の見本'}</DialogTitle><DialogDescription>カレンダーで選んだ日付を期限欄へ引き継ぎます。入力・保存はガイド内の試作です。</DialogDescription></DialogHeader>
        <div className="grid min-w-0 gap-3">
          <label className="grid gap-1 text-sm">タスク名<Input aria-label="架空タスク名" disabled={disabled} value={title} onChange={event => setTitle(event.target.value)} placeholder={long ? '案内内容を確認する（架空）' : 'タスク名（架空）'} /></label>
          <label className="grid gap-1 text-sm">期限<Input type="date" aria-label="架空タスクの期限" disabled={disabled} value={selectedDate} onChange={event => setSelectedDate(event.target.value)} /></label>
          <p className="text-xs text-muted-foreground">選択した日付：{selectedDate || '未選択'}</p>
          <div className="flex flex-wrap gap-2"><Button type="button" variant="ghost" disabled={disabled} onClick={() => setOpen(false)}>キャンセル</Button><Button type="button" variant="outline" disabled={disabled} onClick={() => { setOpen(false); setMessage('見本内の入力を確認しました。タスクは保存していません。'); }}>入力例を確認して閉じる</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  </div>;
}

function TaskStructureGuidanceTrial({ long }: PreviewOptions) {
  const parentTitle = long ? '展示会の案内を準備する（架空）' : '会場案内を準備する（架空）';
  return <div className="min-w-0 space-y-3" data-testid="task-structure-guidance-trial">
    <HelpText>既存資料から分かるタスク・サブタスク・チェックリストの関係を説明し、根拠が足りないときは確認する採用済みの考え方を試作で示します。名称や件数だけで構造を決める一般ルールは追加しません。</HelpText>
    <article className={styles.taskStructureMoaiCard} aria-label="モアイの説明例（架空）">
      <h3><span aria-hidden="true">🗿</span> モアイの説明例</h3>
      <p className={styles.taskStructureParent}>親タスク：{parentTitle}</p>
      <div className={styles.taskStructureFacts}>
        <section aria-labelledby="task-structure-child-heading">
          <h4 id="task-structure-child-heading">サブタスク（実際の子タスク）</h4>
          <p>会場マップを確認する（架空）</p>
          <span>担当・状態・期限を持つTaskとして親タスクに紐づいています。</span>
        </section>
        <section aria-labelledby="task-structure-checklist-heading">
          <h4 id="task-structure-checklist-heading">親タスク内のチェックリスト</h4>
          <p>地図リンクを案内文へ追加する（架空）</p>
          <span>親タスクの詳細内にあるチェック項目です。</span>
        </section>
      </div>
      <p className={styles.taskStructureMoaiCopy}>この例では、会場マップの確認は子タスクとして、地図リンクの追記は親タスク内のチェックリストとして記録されています。チェック項目を子タスクへ変換せず、記録された関係をそのまま説明します。</p>
    </article>
    <section className={styles.taskStructureAmbiguous} aria-label="構造が不明なときの確認例">
      <h3>構造を判断する根拠が足りない例</h3>
      <p>「共有先を確認する」（架空）</p>
      <p>この一文だけでは、親タスク内のチェック項目か、別のTaskかは判断できません。モアイはどちらかに決めず、意図を確認します。</p>
    </section>
    <HelpText>独立した担当・期限などを分類基準として推測したり、データ構造を自動変更したりしません。実際の関係が資料から分からないときは確認を促す試作です。</HelpText>
  </div>;
}

type NeoHomeTrialTask = {
  id: string;
  title: string;
  dueDate: string;
  startDate?: string;
  priority: '高' | '中' | '低';
  workProgress?: 'started' | 'not_started';
  isCompleted?: boolean;
  workState?: { status: 'hold' | 'wait'; reason: string; resumeCondition: string };
  parentTitle?: string;
};

const NEO_HOME_TRIAL_TODAY = '2026-09-18';
const neoHomeTrialTasks: NeoHomeTrialTask[] = [
  { id: 'deadline-overdue-high', title: '案内の日付を確認する（架空）', dueDate: '2026-09-16', priority: '高', workProgress: 'started', startDate: '2026-09-15', parentTitle: '展示会の準備' },
  { id: 'deadline-overdue-medium', title: '配布資料を確認する（架空）', dueDate: '2026-09-17', priority: '中', workProgress: 'not_started', parentTitle: '展示会の準備' },
  { id: 'deadline-today-high', title: '参加者へ案内を送る（架空）', dueDate: '2026-09-18', priority: '高', workProgress: 'not_started' },
  { id: 'work-period-high', title: '会場の備品を確認する（架空）', dueDate: '2026-09-19', startDate: '2026-09-18', priority: '高', workProgress: 'started' },
  { id: 'work-period-medium', title: '受付表を整える（架空）', dueDate: '2026-09-20', startDate: '2026-09-16', priority: '中', workProgress: 'not_started' },
  { id: 'future-start-excluded', title: '開始前の資料を整える（対象外）', dueDate: '2026-09-19', startDate: '2026-09-19', priority: '高', workProgress: 'not_started' },
  { id: 'completed-excluded', title: '完了済みの案内を送る（対象外）', dueDate: '2026-09-17', startDate: '2026-09-15', priority: '高', workProgress: 'started', isCompleted: true },
  { id: 'held-existing-route', title: '返答を待つ（既存の保留例）', dueDate: '2026-09-20', startDate: '2026-09-16', priority: '中', workProgress: 'started', workState: { status: 'wait', reason: '返答待ち', resumeCondition: '返答が届いたら再開' } },
];

function groupNeoHomeTrialTasks(tasks: NeoHomeTrialTask[], today: string) {
  const eligible = tasks.filter(task => !task.isCompleted && !task.workState && task.dueDate && (!task.startDate || task.startDate <= today));
  const priority = { 高: 0, 中: 1, 低: 2 } as const;
  const byPriorityAndDue = (left: NeoHomeTrialTask, right: NeoHomeTrialTask) => priority[left.priority] - priority[right.priority]
    || left.dueDate.localeCompare(right.dueDate)
    || left.title.localeCompare(right.title, 'ja');
  const deadlines = eligible.filter(task => task.dueDate <= today)
    .sort((left, right) => Number(left.dueDate >= today) - Number(right.dueDate >= today) || byPriorityAndDue(left, right));
  const workPeriod = eligible.filter(task => !!task.startDate && task.startDate <= today && task.dueDate > today).sort(byPriorityAndDue);
  const paused = tasks.filter(task => !task.isCompleted && !!task.workState && !!task.dueDate);
  return { deadlines, workPeriod, paused };
}

function NeoHomeLayoutTrial({ long, many, disabled, variant }: PreviewOptions) {
  const [days, setDays] = useState(7);
  const [countdownMessage, setCountdownMessage] = useState('');
  const [proposalIndex, setProposalIndex] = useState(0);
  const [hasCurrentProposal, setHasCurrentProposal] = useState(true);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const proposalTitles = ['会場案内の確認を進める', '参加者への連絡を確認する', '準備資料の期限を確認する'];
  const records = [
    { state: '反映済み', title: '開催日の確認', description: '案内の日付を確認しました。' },
    { state: '保留', title: '配布資料の印刷', description: '部数が決まってから再確認します。' },
    { state: '見送り', title: '会場変更の提案', description: '今回は現在の会場を使います。' },
    { state: '反映済み', title: '担当の確認', description: '架空の担当者を見直しました。' },
    { state: '保留', title: '案内文の補足', description: '必要な情報がそろったら確認します。' },
  ].slice(0, many ? 5 : 3);
  const proposalHistory = [
    { date: '2026-09-17', state: '保留', title: '会場案内の追記', description: '会場図が届いた後に内容を見直します。' },
    { date: '2026-09-16', state: '反映済み', title: '集合時刻の変更', description: '案内の集合時刻を更新しました。' },
    { date: '2026-09-15', state: '見送り', title: '受付場所の変更', description: '今回は現在の受付場所を使います。' },
    { date: '2026-09-14', state: '反映済み', title: '担当の確認', description: '架空の担当者を見直しました。' },
    { date: '2026-09-13', state: '保留', title: '配布資料の印刷', description: '部数が決まってから再確認します。' },
  ].slice(0, many ? 5 : 3).sort((left, right) => right.date.localeCompare(left.date));
  const taskFixtures = neoHomeTrialTasks.map(task => task.id === 'deadline-overdue-high' && long
    ? { ...task, title: '参加者への案内と会場準備の状況を関係者と確認する（架空）' }
    : task);
  const { deadlines, workPeriod, paused } = groupNeoHomeTrialTasks(taskFixtures, NEO_HOME_TRIAL_TODAY);
  const selectedTask = taskFixtures.find(task => task.id === selectedTaskId);
  const dateLabel = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
  const renderTaskRows = (tasks: NeoHomeTrialTask[], group: 'deadline' | 'work-period') => <ul className={styles.neoHomeTaskList} aria-label={group === 'deadline' ? '期限の架空タスク' : '作業期間中の架空タスク'}>
    {tasks.map(task => <li key={task.id}>
      <button type="button" data-testid={`neo-home-task-${task.id}`} className={styles.neoHomeTaskRow} disabled={disabled} onClick={() => setSelectedTaskId(task.id)}>
        <span className={styles.neoHomeTaskTitle}>{task.title}</span>
        <span className={styles.neoHomeTaskMeta}>
          <span>優先度 {task.priority}</span>
          <span>{task.workProgress === 'started' ? '着手中' : '未着手'}</span>
          <span>{group === 'deadline' && task.dueDate < NEO_HOME_TRIAL_TODAY ? '期限超過' : group === 'deadline' ? '今日が期限' : '期限'} {dateLabel(task.dueDate)}</span>
          {task.parentTitle && <span aria-label={`親タスク: ${task.parentTitle}`}>{task.parentTitle}</span>}
        </span>
      </button>
    </li>)}
  </ul>;
  const currentRecord = records[historyIndex];
  return <div className={styles.neoHomeTrial} data-testid="neo-home-layout-trial">
    <HelpText>採用済み：見出しにアイコンを付けて少し大きくする、1行の予定は行内で上下中央に置く、カウントダウン更新操作を右端に置く、「ほかN件を見る」を表示したままにする。見出しのtext-lg（18px）とSunriseアイコンsize-5（20px）は実画面の現行表示に合わせた見本値で、独立した採用寸法ではありません。現在の提案がない場合は過去の判断・記録を1件ずつ共有compact Cardの枠で示し、反映済みの変更はモアイのコメントとして示します。提案がある場合の履歴表示は別バリエーションで確認できます。提案なし時の記録の順序・寸法は採用していません。タスク一覧の下端をパネル間の余白に揃える関係も示します。Cardのutility値や余白のpx値は採用寸法ではありません。操作とデータはこのガイド内だけです。</HelpText>

    <section className={styles.neoHomePanel} aria-labelledby="neo-home-briefing-heading">
      <h3 id="neo-home-briefing-heading" className={`${styles.neoHomeMajorHeading} text-lg`}><Sunrise aria-hidden="true" className="size-5" />今日のブリーフィング</h3>
    </section>

    <section className={styles.neoHomePanel} aria-labelledby="neo-home-calendar-heading">
      <h3 id="neo-home-calendar-heading" className={styles.neoHomeSectionHeading}><CalendarDays aria-hidden="true" />次の予定</h3>
      <div className={styles.neoCalendarRow} data-testid="neo-calendar-one-line">
        <span className={styles.neoCalendarTime}>19:00–20:00</span>
        <span className={styles.neoCalendarTitle}>{long ? '参加者への案内と会場準備の確認（架空）' : '展示会の準備を確認する（架空）'}</span>
        <span className={styles.neoCalendarDate}>9/18</span>
      </div>
    </section>

    <section className={styles.neoHomePanel} aria-labelledby="neo-calendar-height-heading" data-testid="neo-calendar-height-trial">
      <h3 id="neo-calendar-height-heading" className={styles.neoHomeSectionHeading}><CalendarDays aria-hidden="true" />時間割の高さ比較</h3>
      <p className="text-sm text-muted-foreground">下の30分予定枠は、上部の期限タスクカードを高さの基準にします。</p>
      <div className={styles.neoCalendarScaleGrid}>
        <div className={styles.neoCalendarScaleExample}><span>上部・期限タスクカード</span><div className={styles.neoCalendarScaleChip} data-testid="neo-deadline-height-reference">資料の確認（架空）</div></div>
        <div className={styles.neoCalendarScaleExample}><span>下部・30分の予定枠</span><div className={styles.neoCalendarScaleChip} data-testid="neo-30m-height-slot">13:00–13:30（架空）</div></div>
      </div>
      <HelpText>実装参照では両方25pxです。25pxは独立した採用寸法ではなく、期限カードに30分枠を合わせる関係を示します。</HelpText>
    </section>

    <section className={styles.neoCountdownPanel} aria-label="カウントダウン（架空）">
      <Clock3 aria-hidden="true" className={styles.neoCountdownIcon} />
      <div className="min-w-0"><p className="text-xs text-muted-foreground">あと</p><p className="text-lg font-semibold">{days}日・準備資料の確認（架空）</p></div>
      <Button type="button" size="sm" variant="outline" disabled={disabled} className={styles.neoCountdownUpdate} onClick={() => { setDays(value => Math.max(0, value - 1)); setCountdownMessage('見本内で更新しました。'); }}><RefreshCw aria-hidden="true" className="size-3.5" />カウントダウンを更新</Button>
      {countdownMessage && <span role="status" className="text-xs text-muted-foreground">{countdownMessage}</span>}
    </section>

    {variant === 'history-under-proposal' ? <section className={styles.neoHomePanel} aria-labelledby="neo-home-proposal-heading" data-testid="neo-home-proposal-history-trial">
      <div className={styles.neoHomePanelHeading}>
        <h3 id="neo-home-proposal-heading" className={styles.neoHomeSectionHeading}><CircleHelp aria-hidden="true" />モアイの提案</h3>
        {hasCurrentProposal && <span className="text-xs text-muted-foreground">{proposalIndex + 1} / {proposalTitles.length}件</span>}
      </div>
      {hasCurrentProposal ? <article className={styles.neoProposalCard} aria-label="提案（架空）">
        <p className="text-sm font-medium">{proposalTitles[proposalIndex]}（架空）</p>
        <Button type="button" size="sm" variant="outline" disabled={disabled} aria-label={`ほか${proposalTitles.length - 1}件を見る`} onClick={() => setProposalIndex(index => (index + 1) % proposalTitles.length)}>ほか{proposalTitles.length - 1}件を見る</Button>
        <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => setHasCurrentProposal(false)}>提案がない場合を試す</Button>
      </article> : <p className="text-sm text-muted-foreground">現在の提案なし</p>}
      <details className={styles.neoHistoryDisclosure} data-testid="neo-history-collapsed-list">
        <summary data-testid="neo-history-count-summary">これまでの判断・記録（{proposalHistory.length}件）</summary>
        <ul className={styles.neoHistoryList} aria-label="日付の新しい順に並ぶ架空の判断・記録">
          {proposalHistory.map(record => <li key={record.date + record.title}>
            <Card density="compact">
              <CardContent>
                <article className={styles.neoDecisionRow} data-testid="neo-history-record">
                  <span className={styles.neoDecisionState}>{record.state}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{record.title}（架空）</span>
                    {record.state === '反映済み' ? <span className={styles.neoDecisionComment}><span aria-hidden="true">🗿</span><span>モアイのコメント：{record.description}</span></span> : <span className="block text-xs text-muted-foreground">{record.description}</span>}
                  </span>
                  <time className="text-xs text-muted-foreground" dateTime={record.date}>{dateLabel(record.date)}</time>
                </article>
              </CardContent>
            </Card>
          </li>)}
        </ul>
      </details>
      <HelpText>採用済み：提案がある場合も、判断・記録の全件を新しい順で縦に並べ、初期状態は折りたたみます。各記録を共有compact Cardの枠で示し、反映済みの変更はモアイのコメントとして表示します。提案がない場合に1件ずつ表示する見本とは、表示条件を分けて確認します。Cardのutility値・寸法は独立した採用値ではありません。</HelpText>
    </section> : hasCurrentProposal ? <section className={styles.neoHomePanel} aria-labelledby="neo-home-proposal-heading">
      <div className={styles.neoHomePanelHeading}>
        <h3 id="neo-home-proposal-heading" className={styles.neoHomeSectionHeading}><CircleHelp aria-hidden="true" />モアイの提案</h3>
        <span className="text-xs text-muted-foreground">{proposalIndex + 1} / {proposalTitles.length}件</span>
      </div>
      <article className={styles.neoProposalCard} aria-label="提案（架空）">
        <p className="text-sm font-medium">{proposalTitles[proposalIndex]}（架空）</p>
        <Button type="button" size="sm" variant="outline" disabled={disabled} aria-label={`ほか${proposalTitles.length - 1}件を見る`} onClick={() => setProposalIndex(index => (index + 1) % proposalTitles.length)}>ほか{proposalTitles.length - 1}件を見る</Button>
        <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => setHasCurrentProposal(false)}>提案がない場合を試す</Button>
      </article>
    </section> : <section className={styles.neoHomePanel} aria-labelledby="neo-home-history-heading" data-testid="neo-home-history-empty-proposal">
      <div className={styles.neoHomePanelHeading}>
        <h3 id="neo-home-history-heading" className={styles.neoHomeSectionHeading}><Clock3 aria-hidden="true" />これまでの判断・記録</h3>
        <span className="text-xs text-muted-foreground">現在の提案なし</span>
      </div>
      <Card density="compact">
        <CardContent>
          <article className={styles.neoDecisionRow} aria-label="過去の判断・記録（架空）" data-testid="neo-history-current-record">
            <span className={styles.neoDecisionState}>{currentRecord.state}</span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{currentRecord.title}（架空）</span>
              {currentRecord.state === '反映済み' ? <span className={styles.neoDecisionComment}><span aria-hidden="true">🗿</span><span>モアイのコメント：{currentRecord.description}</span></span> : <span className="block text-xs text-muted-foreground">{currentRecord.description}</span>}
            </span>
          </article>
        </CardContent>
      </Card>
      <div className={styles.neoHistoryControls} aria-label="架空の過去記録を切り替える">
        <Button type="button" size="sm" variant="outline" disabled={disabled} aria-label="前の記録を表示" onClick={() => setHistoryIndex(index => (index - 1 + records.length) % records.length)}>前へ</Button>
        <span className="text-xs text-muted-foreground" data-testid="neo-history-position">{historyIndex + 1} / {records.length}件</span>
        <Button type="button" size="sm" variant="outline" disabled={disabled} aria-label="次の記録を表示" onClick={() => setHistoryIndex(index => (index + 1) % records.length)}>次へ</Button>
        <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => setHasCurrentProposal(true)}>提案がある場合へ戻す</Button>
      </div>
    </section>}

    <section className={styles.neoHomePanel} aria-labelledby="neo-home-task-heading">
      <h3 id="neo-home-task-heading" className={styles.neoHomeSectionHeading}><ListChecks aria-hidden="true" />今日の仕事・期限</h3>
      <HelpText>2026/9/18の架空データ。期限超過を先にし、各群は優先度・期限の順です。進捗と日付は保存済みの値を表示し、閲覧では変更しません。完了済み・開始日前のタスクは除外し、保留・待ちは「チームで保留・待ちにした仕事」の欄へ分けます。親タスク名は「親:」を付けずに表示します。タスク一覧の下端はパネル間の余白に揃える関係を示し、下端の具体的な余白値は採用基準にしません。</HelpText>
      <div className={styles.neoHomeTaskGroups}>
        <section className={styles.neoHomeTaskGroup} aria-labelledby="neo-home-deadlines-heading">
          <h4 id="neo-home-deadlines-heading">期限</h4>
          {renderTaskRows(deadlines, 'deadline')}
        </section>
        <section className={styles.neoHomeTaskGroup} aria-labelledby="neo-home-work-period-heading">
          <h4 id="neo-home-work-period-heading">作業期間中</h4>
          {renderTaskRows(workPeriod, 'work-period')}
        </section>
        <section className={styles.neoHomeTaskGroup} aria-labelledby="neo-home-paused-heading" data-testid="neo-home-paused-section">
          <h4 id="neo-home-paused-heading">チームで保留・待ちにした仕事</h4>
          <ul className={styles.neoHomeTaskList} aria-label="既存の保留・待ちにした架空タスク">
            {paused.map(task => <li key={task.id}>
              <button type="button" data-testid="neo-home-paused-existing-route" className={styles.neoHomeTaskRow} disabled={disabled} onClick={() => setSelectedTaskId(task.id)}>
                <span className={styles.neoHomeTaskTitle}>{task.title}</span>
                <span className={styles.neoHomeTaskMeta}>
                  <span>{task.workState?.status === 'hold' ? '保留' : '待ち'}：{task.workState?.reason}</span>
                  <span>再開の条件：{task.workState?.resumeCondition || '要確認'}</span>
                  <span>期限 {dateLabel(task.dueDate)}</span>
                </span>
              </button>
            </li>)}
          </ul>
        </section>
      </div>
    </section>
    <Dialog open={!!selectedTask} onOpenChange={open => { if (!open) setSelectedTaskId(null); }}>
      <DialogContent><DialogHeader><DialogTitle>架空タスクの確認</DialogTitle><DialogDescription>{selectedTask?.title}</DialogDescription></DialogHeader>
        <p>進捗：{selectedTask?.workProgress === 'started' ? '着手中' : '未着手'}</p>
        <p>期限：{selectedTask && dateLabel(selectedTask.dueDate)}</p>
        {selectedTask?.parentTitle && <p>親タスク：{selectedTask.parentTitle}</p>}
        <Button onClick={() => setSelectedTaskId(null)}>閉じる</Button>
      </DialogContent>
    </Dialog>
  </div>;
}

function SettingsDashboardOrderTrial({ disabled }: PreviewOptions) {
  const [dashboard, setDashboard] = useState<'Neo' | 'クラシック'>('Neo');
  return <div className={styles.settingsDashboardOrderTrial} data-testid="settings-dashboard-order-trial">
    <HelpText>採用済み：アプリ設定ページでは、ダッシュボードの選択をページ上部の最初の設定項目として表示します。下の選択操作は見本内だけで、保存しません。</HelpText>
    <section className={styles.settingsDashboardOrderPage} aria-label="アプリ設定の架空見本">
      <h3>設定</h3>
      <section className={styles.settingsDashboardSelection} aria-labelledby="settings-dashboard-order-heading">
        <h4 id="settings-dashboard-order-heading">ダッシュボードの選択</h4>
        <div role="group" aria-label="架空のダッシュボード選択">
          {(['Neo', 'クラシック'] as const).map(view => <Button key={view} type="button" size="sm" variant={dashboard === view ? 'default' : 'outline'} aria-pressed={dashboard === view} disabled={disabled} onClick={() => setDashboard(view)}>{view}</Button>)}
        </div>
      </section>
      <section className={styles.settingsDashboardOtherSection}><h4>その他の設定（架空）</h4><p>表示や通知の項目が続きます。</p></section>
    </section>
  </div>;
}

function SubtaskViewAlignmentTrial({ long, many, disabled }: PreviewOptions) {
  const rows = Array.from({ length: many ? 7 : 4 }, (_, index) => ({
    id: `guide-subtask-view-${index}`,
    title: long && index === 0 ? '参加者向けの案内と当日の準備を担当者と確認する（架空）' : `サブタスク ${index + 1}（架空）`,
    assignee: ['夕凜', '荒木麻友', '吉永珠生', '稲村忠', 'さちえばあちゃん', 'まどかじい', '自分'][index],
    status: index === 3 ? '完了' : '未完了',
    due: index < 3 ? '9/18' : '',
  }));
  return <div className={styles.subtaskViewsTrial} data-testid="subtask-view-alignment-trial">
    <HelpText>採用済み：プロジェクトを問わず、カンバンカード内で展開するサブタスク一覧は1件につき一つの視覚行にします。カンバンと進捗で同じ表示ルールを確認できる比較見本です。行はコンパクトにし、一覧枠の上下余白は保ちます。具体的な行高・余白値は独立した採用値ではありません。すべて架空データです。</HelpText>
    <div className={styles.subtaskViewsGrid}>
      {(['カンバン', '進捗'] as const).map(view => <section className={styles.subtaskViewPanel} key={view} aria-label={`${view}の架空サブタスク`}>
        <h3>{view}・サブタスク</h3>
        <p className="text-xs text-muted-foreground">展示準備（架空）・{rows.length}件</p>
        <ul className={styles.subtaskViewList} aria-label={`${view}のサブタスク一覧`}>
          {rows.map(row => <li key={row.id}><button type="button" disabled={disabled} draggable={!disabled} className={styles.subtaskViewRow} data-testid={`subtask-view-row-${view}`} aria-label={`${row.title}・${row.assignee}・${row.status}${row.due ? `・期限 ${row.due}` : ''}`}>
            <span className={styles.subtaskViewTitle}>{row.title}</span>
            <span className={styles.subtaskViewMeta}>{row.assignee}<span>{row.status}</span>{row.due && <span>期限 {row.due}</span>}</span>
          </button></li>)}
        </ul>
      </section>)}
    </div>
    <HelpText>2つの見本は同じ架空行・同じ行クラスを使います。行の compact 化と、リスト枠の上端・下端の余白は別に確認します。行の上下余白の数値は見本だけの具体化です。</HelpText>
  </div>;
}

function DetailHeaderSpacingTrial({ long }: PreviewOptions) {
  return <div className={styles.detailHeaderSpacingTrial} data-testid="detail-header-spacing-trial">
    <HelpText>採用済み：詳細ヘッダーの上側を少し広く、下側を少し狭くします。具体的な余白値は未採用です。下の20px/4pxはこのガイド見本だけの試作値です。</HelpText>
    <DetailFrame className={styles.detailHeaderFrame}>
      <header className={`${detailHeader} flex flex-col gap-1.5`} style={{ paddingBlock: '20px 4px' }}>
        <h3 className="text-base font-semibold leading-none tracking-tight">架空タスクの詳細</h3>
        <p className="text-sm text-muted-foreground">{long ? '参加者向けの案内と当日の準備を関係者で確認する説明（架空）。' : '展示準備の確認（架空）。'}</p>
      </header>
      <DetailBody><div className={detailContent}>
        <p className="text-xs font-semibold">タスク名</p><p>{long ? '参加者向けの案内と当日の準備を担当者と確認する（架空）' : '案内の準備（架空）'}</p>
        <p className="text-xs font-semibold">説明</p><p>{long ? '案内の内容を関係者と確認し、必要な情報がそろったら参加者へ共有します。' : '必要な項目を確認します。'}</p>
      </div></DetailBody>
      <div className="tf-detail-footer flex shrink-0 justify-end border-t py-3"><Button variant="ghost" disabled>閉じる</Button></div>
    </DetailFrame>
  </div>;
}

function TaskDetailSubtaskOrderTrial({ long, disabled }: PreviewOptions) {
  const [rows, setRows] = useState([
    { id: 'guide-detail-subtask-1', title: long ? '参加者向けの案内と当日の準備を関係者と確認する（架空）' : '参加者へ案内を送る（架空）', assignee: '夕凜', due: '9/18' },
    { id: 'guide-detail-subtask-2', title: '会場の備品を確認する（架空）', assignee: '荒木麻友', due: '9/19' },
    { id: 'guide-detail-subtask-3', title: '配布資料を整える（架空）', assignee: '吉永珠生', due: '' },
  ]);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  function reorder(id: string, targetIndex: number) {
    setRows(current => {
      const sourceIndex = current.findIndex(row => row.id === id);
      if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= current.length || sourceIndex === targetIndex) return current;
      const next = [...current];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  }
  return <div className={styles.taskDetailOrderTrial} data-testid="task-detail-subtask-order-trial">
    <HelpText>採用済み：詳細内のサブタスクはチェックリスト項目のようにドラッグハンドルとキーボードで並べ替えます。順番は親タスク側に保存し、子タスク自体の順序は変えません。順番保存後の「記録しました。」は詳細内に表示しません。ここでは見本内の順番だけを変え、通信・保存はしません。</HelpText>
    <DetailFrame className={styles.taskDetailOrderFrame}>
      <header className={`${detailHeader} flex flex-col gap-1.5`} style={{ paddingBlock: '20px 4px' }}>
        <h3 className="text-base font-semibold leading-none tracking-tight">架空タスクの詳細</h3>
        <p className="text-sm text-muted-foreground">案内の準備（架空）・サブタスクの順番を確認します。</p>
      </header>
      <DetailBody><div className={detailContent}>
        <h3 className="text-sm font-semibold">サブタスク</h3>
        <p className="text-xs text-muted-foreground">ドラッグ、またはハンドルへフォーカスしてSpace・上下キー・Spaceで順番を変更します。</p>
        <ul className={styles.subtaskOrderList} aria-label="並べ替える架空サブタスク">
          {rows.map((row, index) => <li key={row.id} className={styles.subtaskOrderRow} onDragOver={event => event.preventDefault()} onDrop={event => {
            event.preventDefault();
            const fromId = event.dataTransfer?.getData('text/plain') || movingId;
            if (fromId) { reorder(fromId, index); setMovingId(null); setAnnouncement(`${row.title}の前後で順番を変更しました（見本内）。`); }
          }}>
            <button type="button" className={styles.subtaskOrderHandle} disabled={disabled} draggable={!disabled} aria-label={`${row.title}を並べ替え`} aria-pressed={movingId === row.id} aria-describedby="task-detail-subtask-keyboard-help" onDragStart={event => {
              setMovingId(row.id);
              event.dataTransfer?.setData('text/plain', row.id);
            }} onDragEnd={() => setMovingId(null)} onKeyDown={event => {
              if (event.key === ' ' || event.key === 'Enter') {
                event.preventDefault();
                if (movingId === row.id) { setMovingId(null); setAnnouncement(`${row.title}を${index + 1}番目にしました（見本内）。`); }
                else { setMovingId(row.id); setAnnouncement(`${row.title}を移動中。上下キーで順番を選び、Spaceで確定します。`); }
              } else if (movingId === row.id && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
                event.preventDefault();
                const nextIndex = index + (event.key === 'ArrowUp' ? -1 : 1);
                reorder(row.id, nextIndex);
                setAnnouncement(`${row.title}を${Math.max(1, Math.min(rows.length, nextIndex + 1))}番目へ移動しました（見本内）。`);
              } else if (movingId === row.id && event.key === 'Escape') {
                event.preventDefault(); setMovingId(null); setAnnouncement('並べ替えを終了しました（見本内）。');
              }
            }}>
              <GripVertical aria-hidden="true" className="size-4" />
            </button>
            <span className={styles.subtaskOrderTitle}>{row.title}</span>
            <span className={styles.subtaskOrderMeta}>{row.assignee}<span>未完了</span>{row.due && <span>期限 {row.due}</span>}</span>
          </li>)}
        </ul>
        <p id="task-detail-subtask-keyboard-help" className="text-xs text-muted-foreground">サブタスクの順番は親の表示順として保存します。子タスク自体の順番は変更しません（架空データ）。</p>
      </div></DetailBody>
      <div className="tf-detail-footer flex shrink-0 justify-end border-t py-3"><Button variant="ghost" disabled>閉じる</Button></div>
    </DetailFrame>
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
  </div>;
}

function TaskRowOneLineTrial({ long, many, disabled }: PreviewOptions) {
  const source = guideTasks(false, false, false)[0];
  const title = long ? 'あおぞら銀行の引落手続を関係者へ共有して今日中に完了する（架空）' : '案内の準備を確認する（架空）';
  const rows: Array<{ task: Task; listName: string; moai: boolean }> = Array.from({ length: many ? 6 : 3 }, (_, index) => ({
    task: {
      ...source,
      id: `guide-one-line-${index}`,
      title: index === 0 ? title : long ? `${index + 1}. ${title}` : index === 1 ? 'UPSIDER引落手続＠あおぞら銀行' : '参加者向けの案内を仕上げる',
      priority: index === 1 ? 'high' : 'medium',
      assigneeIds: index % 2 === 0 ? ['guide-aya'] : ['guide-ren'],
      isCompleted: index === 2,
    },
    listName: index === 1 ? 'その他' : '天然石',
    moai: index < 2,
  }));
  const members: Record<string, TaskViewMember> = Object.fromEntries(Object.entries(guideNames).map(([id, displayName]) => [id, { id, displayName }]));
  const subtaskRows = Array.from({ length: many ? 7 : 4 }, (_, index) => ({
    id: `guide-subtask-one-line-${index}`,
    title: index === 0 ? 'サブタスク 1' : long && index === 1 ? '関係者へ確認内容を共有して返答を受け取る（架空）' : `サブタスク ${index + 1}`,
    assignee: ['夕凜', '荒木麻友', '吉永珠生', '稲村忠', 'さちえばあちゃん', 'まどかじい', '自分'][index],
    status: index === 0 ? '未完了' : index === 3 ? '完了' : '未完了',
    due: index === 0 ? '9/16' : '',
  }));
  const completedSubtask = subtaskRows.find(subtask => subtask.status === '完了');
  const [opened, setOpened] = useState<string | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  return <div className="space-y-3">
    <HelpText>カンバンカード内で展開するサブタスクは、プロジェクトを問わず1件1行にし、タイトル・担当者・状態・期限を同じ行に置きます。短い親タスク名を1行に収める案や付随情報の右横配置は別の試作です。タスクカードには「モアイ」の文字ラベルを表示せず、モアイ関連を示す採用済みの🗿アイコンは担当者アイコンの前に置きます。ドラッグ＆ドロップで動かす行は1件ずつ枠で囲みます。内容を開く同じ役割のタスク行は、控えめな行面hover・色の遷移・キーボードfocusを揃えます。リンク下線だけ、アイコン操作、選択中、危険操作は別扱いで、全ボタンへ一律適用しません。今回の限定採用は、タイトル行の内側を少し詰めながら外側summary枠の上下余白と行間を保つことです。見本の最小高24px・外枠px-2.5 py-1・行間mt-1 space-y-0.5はbde4実装の参照値で、共通採用寸法ではありません。長い日本語や狭い幅では情報を保って行内で折り返します。実画面・共通行部品はこのタスクでは変更していません。</HelpText>
    <div className={styles.taskRowOneLineTrial} data-testid="task-row-one-line-trial">
      <ul className="space-y-2" aria-label="一行表示を確認する架空のタスク一覧">
        {rows.map(({ task, listName, moai }) => <li key={task.id}>
          <button type="button" draggable={!disabled} data-dragging={dragged === task.id ? 'true' : undefined} disabled={disabled} className={styles.oneLineRow} aria-label={task.title} onClick={() => setOpened(task.id)} onDragStart={() => setDragged(task.id)} onDragEnd={() => setDragged(null)}>
            <span className={styles.oneLineTitle}>{task.title}</span>
            <span className={styles.oneLineMeta} aria-label="付随情報">
              <span className={styles.oneLineContext}>{listName}</span>
              <TaskStatus task={task} allTasks={rows.map(row => row.task)} />
              <TaskDate date={task.dueDate} />
              <TaskPriority task={task} />
              {moai && <span className={styles.oneLineMoai} aria-label="モアイ">🗿</span>}
              <TaskAssignees task={task} names={guideNames} members={members} compact maxVisible={2} />
            </span>
          </button>
        </li>)}
      </ul>
      <section className={styles.subtaskOneLineSection} data-testid="guide-subtask-summary-frame" aria-labelledby="subtask-one-line-heading">
        <div className={styles.subtaskOneLineHeading}>
          <h3 id="subtask-one-line-heading">サブタスク（1件1行）</h3>
          <span className="text-xs text-muted-foreground">架空の{subtaskRows.length}件・未完了{subtaskRows.filter(subtask => subtask.status === '未完了').length}件</span>
        </div>
        <ul className={styles.subtaskOneLineRows} aria-label="1件1行で表示する架空のサブタスク一覧">
          {subtaskRows.map(subtask => <li key={subtask.id}>
            <button type="button" draggable={!disabled} data-dragging={dragged === subtask.id ? 'true' : undefined} disabled={disabled} className={styles.oneLineRow + ' ' + styles.subtaskOneLineRow} data-testid="guide-subtask-row-24px" aria-label={subtask.title} onClick={() => setOpened(subtask.id)} onDragStart={() => setDragged(subtask.id)} onDragEnd={() => setDragged(null)}>
              <span className={styles.oneLineTitle}>{subtask.title}</span>
              <span className={styles.oneLineMeta} aria-label="サブタスクの付随情報">
                <span>{subtask.assignee}</span>
                <span>{subtask.status}</span>
                {subtask.due && <span>{subtask.due}</span>}
              </span>
            </button>
          </li>)}
        </ul>
        {completedSubtask && <details data-testid="guide-completed-subtasks-details">
          <summary className={styles.completedSubtaskSummary} data-testid="guide-completed-subtasks-summary">完了済み 1件</summary>
          <div className="mt-2 space-y-3">
            <button type="button" draggable={!disabled} data-dragging={dragged === completedSubtask.id ? 'true' : undefined} disabled={disabled} className={styles.oneLineRow + ' ' + styles.subtaskOneLineRow} aria-label={completedSubtask.title} onClick={() => setOpened(completedSubtask.id)} onDragStart={() => setDragged(completedSubtask.id)} onDragEnd={() => setDragged(null)}>
              <span className={styles.oneLineTitle}>{completedSubtask.title}</span>
              <span className={styles.oneLineMeta} aria-label="完了サブタスクの付随情報">
                <span>{completedSubtask.assignee}</span>
                <span>{completedSubtask.status}</span>
              </span>
            </button>
          </div>
        </details>}
      </section>
    </div>
    <HelpText>「完了済み 1件」のsummaryには下端の余白を持たせ、上のサブタスク見出しと同程度の高さに揃える案です。min-h-6と上下4px（合計24px）は機能改善側の具体化値で、§13.18の28pxサブタスク行とは別です。</HelpText>
    <HelpText>見本内で親タスクとサブタスクの各行を選べます。1行に収まる長さ、長文、狭幅の折り返し、付随情報の欠落がないかを確認します。</HelpText>
    {opened && <p role="status" className="text-sm">選択した架空タスク：{rows.find(row => row.task.id === opened)?.task.title ?? subtaskRows.find(subtask => subtask.id === opened)?.title}</p>}
  </div>;
}

type ProposalTrialPriority = 'now' | 'soon' | 'normal';
type ProposalTrialItem = {
  id: string;
  action: string;
  reason: string;
  priority: ProposalTrialPriority;
  priorityReason: string;
  target: string;
  changes: Array<{ label: string; before: string; after: string }>;
  detail: string;
  reappearanceReason?: string;
};

function ParentChildReviewTrial({ long, many, disabled, fetchState }: PreviewOptions) {
  const [surface, setSurface] = useState<'dashboard' | 'moai'>('moai');
  const [opened, setOpened] = useState('');
  const [localChoice, setLocalChoice] = useState('');
  const parentTitle = long ? '地域交流・秋の展示会を安全に開催するための準備と関係者確認（架空）' : '秋の展示会の準備（架空）';
  const subtasks = [
    long ? '展示会場へ搬入する架空の展示什器の受取日を関係者と確認する' : '展示什器の受取日を確認する',
    '展示会場の最終チェックをする',
    '設営後の写真を共有する',
  ].slice(0, many ? 3 : 2);
  const choices = ['サブタスクを完了にする', '親を着手に戻す', '1時間後'];

  if (fetchState === 'loading') return <div className={styles.proposalTrialEmpty} role="status">親タスクとサブタスクの状態を確認しています（架空データ）。</div>;
  if (fetchState === 'error') return <div className={styles.proposalTrialEmpty} role="alert">親タスクとサブタスクの状態を取得できませんでした。対象なしとは扱わず、確認できない状態です。</div>;
  if (fetchState === 'empty') return <div className={styles.proposalTrialEmpty} role="status">取得成功：親が完了し未完了の子タスクがある組み合わせはありません（架空データ）。</div>;

  return <div className="grid min-w-0 gap-3" data-testid="parent-child-review-trial">
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <label className="text-sm font-medium" htmlFor="parent-child-review-surface">表示例</label>
      <select id="parent-child-review-surface" className="max-w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={surface} disabled={disabled} onChange={event => setSurface(event.target.value as 'dashboard' | 'moai')}>
        <option value="dashboard">ダッシュボード</option>
        <option value="moai">モアイ</option>
      </select>
      <span className="text-xs text-muted-foreground">同じ確認を重ねて表示しません。</span>
    </div>
    {surface === 'dashboard' ? <article className={styles.proposalTrialCard} aria-label="ダッシュボードの事実カード（架空）" data-testid="parent-child-dashboard-card">
      <div className={styles.proposalTrialHeading}>
        <div className="min-w-0"><p className="text-xs text-muted-foreground">ダッシュボード上部（ガイド試作）</p><h3 className="break-words text-base font-semibold">完了状態の確認</h3></div>
        <span className={styles.proposalTrialPriority} data-tone="normal"><TriangleAlert className="size-4" aria-hidden="true" />事実を確認</span>
      </div>
      <section className={styles.proposalTrialChanges} aria-label="親と未完了サブタスク">
        <h4 className="text-xs font-semibold">親タスク</h4>
        <div className={styles.proposalTrialChange}><span>状態</span><span>{parentTitle} — 完了</span></div>
        <div className={styles.proposalTrialActions}>
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => setOpened(parentTitle)}>親の詳細（見本）</Button>
        </div>
        <h4 className="mt-2 text-xs font-semibold">未完了のサブタスク</h4>
        <ul className="grid min-w-0 gap-2" aria-label="各サブタスクの詳細へ進む架空リンク">
          {subtasks.map(title => <li className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border bg-background p-2" key={title}>
            <span className="min-w-0 flex-1 break-words">{title}</span>
            <span className="shrink-0 text-xs text-muted-foreground">未完了</span>
            <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setOpened(title)}>詳細（見本）</Button>
          </li>)}
        </ul>
      </section>
      <p className="text-xs text-muted-foreground">ダッシュボードは事実カードと各タスク詳細への入口を示します。質問・選択肢はここに重ねず、他画面で開くモアイ側に分けます。</p>
      {opened && <p className="text-xs text-muted-foreground" role="status">「{opened}」を見本内で開きました。画面遷移・通信・保存はしていません。</p>}
    </article> : <article className={styles.proposalTrialCard} aria-label="モアイの確認（架空）" data-testid="parent-child-moai-card">
      <p className="text-xs text-muted-foreground">ダッシュボード以外の画面で使う任意の確認（ガイド試作）</p>
      <details className="min-w-0 rounded-lg border bg-background" data-testid="parent-child-moai-details">
        <summary className="cursor-pointer break-words rounded-lg px-3 py-2.5 text-sm font-medium leading-snug hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring">
          {parentTitle} · 未完了サブタスク {subtasks.length}件
        </summary>
        <div className="grid min-w-0 gap-3 border-t p-3">
          <p className="break-words text-sm leading-relaxed">「{parentTitle}」は完了になっています。次のサブタスクも完了していますか？</p>
          <section className={styles.proposalTrialChanges} aria-label="モアイを開いた後に示す事実">
            <div className={styles.proposalTrialChange}><span>親</span><span>{parentTitle} — 完了</span></div>
            <h4 className="mt-1 text-xs font-semibold">未完了のサブタスク</h4>
            <ul className="grid min-w-0 gap-1.5" aria-label="架空の未完了サブタスク">
              {subtasks.map(title => <li className={styles.proposalTrialChange} key={title}><span>未完了</span><span>{title}</span></li>)}
            </ul>
          </section>
          <fieldset className="grid min-w-0 gap-2 rounded-md border p-3">
            <legend className="px-1 text-xs font-medium">選択肢例（表示文言・対応は未採用）</legend>
            <div className={styles.proposalTrialActions}>
              {choices.map(choice => <Button key={choice} size="sm" variant="outline" disabled={disabled} onClick={() => setLocalChoice(choice)}>{choice}</Button>)}
            </div>
          </fieldset>
          <p className="text-xs text-muted-foreground">実画面では本人が明示的に選ぶまで、保存も状態変更もしません。この見本は選択後も画面内表示だけです。</p>
          {localChoice && <p className="text-xs text-muted-foreground" role="status">「{localChoice}」を見本内で選びました。実データ・保存内容は変えていません。</p>}
        </div>
      </details>
    </article>}
    <p className="text-xs text-muted-foreground">架空データのみ。取得中・取得成功で対象なし・取得失敗は別表示です。実画面・通信・保存処理は変更していません。</p>
  </div>;
}

const proposalTrialItems: ProposalTrialItem[] = [
  {
    id: 'proposal-due-today',
    action: '今日の回答期限に間に合わせる',
    reason: '今日中に回答しないと、先方への連絡が次の作業へ遅れます。',
    priority: 'now',
    priorityReason: '今日が回答期限',
    target: '案内の準備（架空）・2件',
    changes: [
      { label: '担当', before: '未設定', after: '架空のあや' },
      { label: '期限', before: '9月20日', after: '9月16日' },
    ],
    detail: '回答する人を決め、期限を今日に合わせる提案です。確認や採用を押す前に、対象と変更内容を読めます。',
  },
  {
    id: 'proposal-blocked',
    action: '止まっている後続作業を進める',
    reason: 'この判断で、案内資料の印刷準備が止まっています。',
    priority: 'soon',
    priorityReason: 'この判断で後続作業が止まっています',
    target: '案内資料の印刷準備（架空）',
    changes: [
      { label: '担当', before: '架空のれん', after: '架空のあや' },
      { label: '期限', before: '9月23日', after: '変更なし' },
    ],
    detail: '担当の引き継ぎだけを提案しています。期限や進捗を閲覧切替で変更することはありません。',
    reappearanceReason: '待っていた見積もりが届きました',
  },
  {
    id: 'proposal-normal',
    action: '都合のよいときに候補を比較する',
    reason: '急ぐ根拠はなく、次の打ち合わせまでに見ておけば足ります。',
    priority: 'normal',
    priorityReason: '都合のよいときに確認できます',
    target: '会場候補の比較（架空）',
    changes: [
      { label: '担当', before: '架空のあや', after: '変更なし' },
      { label: '期限', before: '未設定', after: '変更なし' },
    ],
    detail: '未確認期間の長さだけで緊急扱いにしない例です。詳細から根拠を読んでから選べます。',
  },
  {
    id: 'proposal-follow-up',
    action: '参加者への確認文を整える',
    reason: '同じ内容の言い換えではなく、確認する対象が変わっています。',
    priority: 'normal',
    priorityReason: '都合のよいときに確認できます',
    target: '参加者向けの案内（架空）',
    changes: [
      { label: '担当', before: '架空のれん', after: '変更なし' },
      { label: '期限', before: '9月23日', after: '変更なし' },
    ],
    detail: '候補の言い換えを新着として増やさず、対象が異なるものだけを一覧に残します。',
  },
];

function priorityMeta(priority: ProposalTrialPriority) {
  if (priority === 'now') return { label: '今', icon: TriangleAlert, tone: 'now' } as const;
  if (priority === 'soon') return { label: '近いうち', icon: Clock3, tone: 'soon' } as const;
  return { label: '通常', icon: CalendarClock, tone: 'normal' } as const;
}

function ProposalReviewFlowTrial(options: PreviewOptions) {
  if (options.variant === 'parent-child-review') return <ParentChildReviewTrial {...options} />;
  return <ProposalReviewListTrial {...options} />;
}

function ProposalReviewListTrial({ long, many, disabled }: PreviewOptions) {
  const items = proposalTrialItems.slice(0, many ? proposalTrialItems.length : 3).map(item => long ? {
    ...item,
    action: `${item.action}。関係者へ共有する内容を確認する`,
    reason: `${item.reason} 長い日本語でも、対象・変更・詳細の順序を保ったまま折り返します。`,
  } : item);
  const [currentId, setCurrentId] = useState(items[0].id);
  const [viewedIds, setViewedIds] = useState<string[]>([items[0].id]);
  const [deferredIds, setDeferredIds] = useState<string[]>([]);
  const [laterMessage, setLaterMessage] = useState('');
  const [result, setResult] = useState('');
  const [showDetail, setShowDetail] = useState(false);
  const available = items.filter(item => !deferredIds.includes(item.id));
  const current = available.find(item => item.id === currentId) ?? available[0];
  const currentIndex = current ? available.findIndex(item => item.id === current.id) : -1;
  const meta = current ? priorityMeta(current.priority) : null;
  const PriorityIcon = meta?.icon;

  const choose = (item: ProposalTrialItem) => {
    setCurrentId(item.id);
    setViewedIds(ids => ids.includes(item.id) ? ids : [...ids, item.id]);
    setLaterMessage('');
    setResult('');
    setShowDetail(false);
  };
  const viewOther = () => {
    if (!available.length) return;
    const next = available.find(item => !viewedIds.includes(item.id)) ?? available[(currentIndex + 1) % available.length];
    const cycleComplete = available.every(item => viewedIds.includes(item.id));
    choose(next);
    if (cycleComplete) setViewedIds([next.id]);
  };
  const viewPrevious = () => {
    if (currentIndex < 0 || available.length < 2) return;
    choose(available[(currentIndex - 1 + available.length) % available.length]);
  };
  const defer = () => {
    if (!current) return;
    const deferredId = current.id;
    setDeferredIds(ids => [...ids, deferredId]);
    setLaterMessage('');
    const next = available.find(item => item.id !== deferredId && !viewedIds.includes(item.id)) ?? available.find(item => item.id !== deferredId);
    if (next) {
      choose(next);
      setResult('今は決めないにしました。通常の候補から外し、一覧には残しています（架空データ）。');
    } else {
      setCurrentId('');
      setResult('今は決めないにしました。通常の候補から外し、一覧には残しています（架空データ）。');
    }
  };
  return <div className={styles.proposalFlowTrial} data-testid="proposal-review-flow-trial">
    <HelpText>優先度は期限・依存関係など確認できる事実で示し、未確認期間だけでは急ぎません。閲覧切替は判断・期限・進捗を変更せず、同程度の候補は一巡まで繰り返しません。すべて架空データで、保存・通知・条件検知はありません。</HelpText>
    <div className={styles.proposalTrialToolbar} aria-label="提案の閲覧切替">
      <span className="text-sm font-medium">モアイの提案</span>
      <span className="text-xs tabular-nums text-muted-foreground">{current ? `${currentIndex + 1} / ${available.length}件` : '0件'}</span>
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Shuffle className="size-3" aria-hidden="true" />一巡まで重複なし</span>
      <span className="ml-auto flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={disabled || available.length < 2} onClick={viewPrevious}>前へ</Button>
        <Button size="sm" variant="outline" disabled={disabled || available.length < 2} onClick={viewOther}>ほかの件を見る</Button>
      </span>
    </div>
    {!current ? <div className={styles.proposalTrialEmpty} role="status"><ListChecks className="size-4" aria-hidden="true" />いま確認が必要なことはありません。あとで選んだ提案は一覧から戻れます。</div> : <article className={styles.proposalTrialCard} aria-label={`提案の試作: ${current.action}`}>
      {current.reappearanceReason && <p className={styles.proposalTrialReappearance}><Clock3 className="size-3.5" aria-hidden="true" />再表示理由：{current.reappearanceReason}</p>}
      <div className={styles.proposalTrialHeading}>
        <div className="min-w-0"><p className="text-xs text-muted-foreground">{current.target}</p><h3 className="break-words text-base font-semibold">{current.action}</h3></div>
        {meta && PriorityIcon && <span className={styles.proposalTrialPriority} data-tone={meta.tone}><PriorityIcon className="size-4" aria-hidden="true" />{meta.label}：{current.priorityReason}</span>}
      </div>
      <p className="break-words text-sm">{current.reason}</p>
      <section className={styles.proposalTrialChanges} aria-label="対象と主な変更"><h4 className="text-xs font-semibold">対象と主な変更（操作前に確認）</h4>{current.changes.map(change => <div className={styles.proposalTrialChange} key={change.label}><span>{change.label}</span><span>{change.before} → {change.after}</span></div>)}</section>
      {showDetail && <section className={styles.proposalTrialDetails} aria-label="提案の詳細"><p className="text-xs font-semibold">詳細</p><p className="mt-1 whitespace-pre-wrap break-words text-sm">{current.detail}</p></section>}
      <div className={styles.proposalTrialActions}>
        <Button size="sm" disabled={disabled} onClick={() => setResult(`「${current.action}」を見本内で反映しました。採用・保存はしていません。`)}>この提案を反映する</Button>
        <Button size="sm" variant="outline" disabled={disabled} onClick={defer}><Pause className="size-3.5" aria-hidden="true" />今は決めない</Button>
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => { setLaterMessage('指定した日時になりました（見本内の再表示理由）。'); setResult('9月23日に知らせる設定を選びました。未選択の定期確認は設定していません。'); }}>9月23日に知らせる</Button>
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => { setLaterMessage('待っていた見積もりが届きました（見本内の再表示理由）。'); setResult('「見積もりが届いたら知らせる」を選びました。条件検知・通知は見本内では行いません。'); }}>見積もりが届いたら知らせる</Button>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setShowDetail(open => !open)}><CircleHelp className="size-3.5" aria-hidden="true" />{showDetail ? '詳細を短くする' : 'どういうこと？'}</Button>
      </div>
      {laterMessage && <p className="break-words text-xs text-primary" role="status">{laterMessage}</p>}
      {result && <p className="break-words text-xs text-muted-foreground" role="status">{result}</p>}
    </article>}
    <p className="text-xs text-muted-foreground">「今は決めない」は進捗の保留ではなく通常候補から外すだけです。日時・条件は本人が選んだ場合だけ記録する案で、理解前でも「ほかの件を見る」から移れます。</p>
  </div>;
}

export function ExtendedPreview(options: PreviewOptions) {
  switch (options.sample) {
    case 'search': return <SearchPreview {...options} />;
    case 'notifications': return <NotificationPreview {...options} />;
    case 'calendar': case 'gantt': case 'progress': return <SpecialViewPreview {...options} />;
    case 'calendar-task-create-trial': return <CalendarTaskCreateTrial {...options} />;
    case 'frame-trial': return <FrameTrial {...options} />;
    case 'table-trial': return <TableTrial {...options} />;
    case 'history-trial': return <HistoryTrial {...options} />;
    case 'neo-brief-row-trial': return <NeoBriefRowTrial {...options} />;
    case 'neo-brief-assignee-filter-trial': return <NeoBriefAssigneeFilterTrial {...options} />;
    case 'neo-shared-countdown-trial': return <NeoSharedCountdownTrial {...options} />;
    case 'neo-home-layout-trial': return <NeoHomeLayoutTrial {...options} />;
    case 'detail-header-spacing-trial': return <DetailHeaderSpacingTrial {...options} />;
    case 'task-detail-subtask-order-trial': return <TaskDetailSubtaskOrderTrial {...options} />;
    case 'task-row-one-line-trial': return <TaskRowOneLineTrial {...options} />;
    case 'task-structure-guidance-trial': return <TaskStructureGuidanceTrial {...options} />;
    case 'subtask-view-alignment-trial': return <SubtaskViewAlignmentTrial {...options} />;
    case 'proposal-review-flow-trial': return <ProposalReviewFlowTrial {...options} />;
    case 'settings-dashboard-order-trial': return <SettingsDashboardOrderTrial {...options} />;
    default: return null;
  }
}
