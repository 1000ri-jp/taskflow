'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Inbox,
  ListFilter,
  ListTodo,
  Loader2,
  Mail,
  MessageSquare,
  PauseCircle,
  Sparkles,
  Target,
  Trophy,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useTaskFlowBrief } from '@/hooks/useTaskFlowBrief';
import { useDashboardComments } from '@/hooks/useDashboardComments';
import { commentPreview, type InboxComment } from '@/lib/dashboard/comments';
import type {
  DashboardBriefItem,
  DashboardBriefRow,
  DashboardBriefSource,
  DashboardUpcomingDay,
  DashboardTask,
} from '@/lib/dashboard/brief';
import type { DashboardCalendarDay } from '@/lib/dashboard/calendar';
import type { GoogleCalendarConnectionStatus } from '@/hooks/useGoogleCalendar';
import { cn } from '@/lib/utils';
import { useInboxDisplayStore, type InboxDisplaySettings as InboxDisplayOptions } from '@/stores/inboxDisplayStore';
import { InboxDisplaySettings } from './InboxDisplaySettings';
import { useProjects } from '@/hooks/useProjects';
import { useTargetProjectStore } from '@/stores/targetProjectStore';
import { TargetProjectSettings } from './TargetProjectSettings';
import { RecommendedTargets } from './RecommendedTargets';
import { TargetGoals } from './TargetGoals';
import { StaleProjectDisplaySettings } from './StaleProjectDisplaySettings';
import { useStaleProjectDisplayStore } from '@/stores/staleProjectDisplayStore';
import { useBriefDisplayStore, type BriefTaskScope } from '@/stores/briefDisplayStore';
import { filterStaleProjects } from '@/lib/dashboard/brief-display';
import { MeetLinkSettings } from './MeetLinkSettings';
import { SharedCountdown } from './SharedCountdown';
import { UPCOMING_RANGES } from '@/lib/dashboard/upcoming-range';
import { useUpcomingRangeStore } from '@/stores/upcomingRangeStore';
import { MeetingProposals } from './MeetingProposals';
import { sourceCommentHref } from '@/lib/task/commentSubmission';
import { ProjectIconBadge, PROJECT_BADGE_CLASS_NAME } from './ProjectIconBadge';

const sourceStyles: Record<DashboardBriefSource, string> = {
  MAIL: 'bg-rose-50 text-rose-700',
  CAL: 'bg-blue-50 text-blue-700',
  ToDo: 'bg-emerald-50 text-emerald-700',
  TF: 'bg-neutral-900 text-white',
  CK: 'bg-yellow-200 text-yellow-900',
};

const compactBadgeClassName = PROJECT_BADGE_CLASS_NAME;

const briefRows: DashboardBriefRow[] = [
  {
    label: '返信待ち・重要',
    tone: 'red',
    total: 5,
    items: [
      {
        source: 'MAIL',
        title: 'ココナラ：購入者から取引メッセージ',
        meta: '3時間未返信',
        action: '開く',
        urgent: true,
      },
      {
        source: 'TF',
        title: 'Kaoriのコメント「入稿データの形式は？」',
        meta: '展示会出展',
        action: '返信',
      },
    ],
  },
  {
    label: '今日の予定',
    tone: 'blue',
    total: 4,
    items: [
      { source: 'CAL', title: 'ココナラ講義', meta: '11:00–12:00' },
      { source: 'CAL', title: '重説内容確認まとめ', meta: '16:00' },
    ],
  },
  {
    label: '今日やる',
    tone: 'green',
    total: 4,
    items: [
      { source: 'ToDo', title: 'ヤマザキ税理士事務所修正', meta: '9:00', action: '開く' },
      {
        source: 'TF',
        title: 'チェックリストの作成',
        meta: '展示会出展・期限超過',
        action: '開く',
        urgent: true,
      },
    ],
  },
  {
    label: '確認待ち',
    tone: 'red',
    total: 1,
    items: [
      { source: 'CK', title: '確認依頼：鑑定書の内容', meta: 'ウリャマ', action: '確認する' },
    ],
  },
  {
    label: '3日動いていない',
    tone: 'amber',
    total: 3,
    items: [
      { source: 'TF', title: '文章生成調整の言語化', meta: '最終更新から3日', action: '続ける／やめる' },
      { source: 'TF', title: '展示会用パンフレット作成', meta: '展示会出展・最終更新から5日', badges: ['担当未定'], action: '担当を決める' },
    ],
  },
  {
    label: '要整理',
    tone: 'amber',
    total: 1,
    items: [
      { source: 'TF', title: 'ココナラモニター募集', meta: 'ウリャマ・今日更新', badges: ['担当未定', '期限未設定'], action: '整理する' },
    ],
  },
];

const targets = [
  { project: '受託（ココナラ・自動化）', items: [{ text: '2商品を出品する', done: true }, { text: '提案10件を送る（いま6件）', done: false }] },
  { project: '診断パック', items: [{ text: 'A4提案書を作る', done: true }, { text: 'モニター募集開始→応募3人', done: false }] },
  { project: 'ウリャマ', items: [{ text: '鑑定書サンプル 2／3人分', done: true }, { text: '500円版の説明文を改稿', done: false }] },
];

const inboxItems = [
  { channel: 'gmail', sender: 'ココナラ', context: '取引メッセージ・3時間前', body: '「納品形式について質問です…」', action: 'Gmailへ' },
  { channel: 'gmail', sender: 'ヤマザキ税理士事務所', context: 'メール・昨日', body: '「修正版を添付します。ご確認ください」', action: 'Gmailへ' },
] as const;

const toneStyles = {
  red: 'bg-rose-50 text-rose-700',
  blue: 'bg-blue-50 text-blue-700',
  green: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
};

function SectionHeader({
  icon,
  title,
  badge,
  note,
  actions,
}: {
  icon: ReactNode;
  title: string;
  badge?: string;
  note?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-muted-foreground">{icon}</span>
          <h2 className="font-semibold tracking-tight">{title}</h2>
          {badge && <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-50">{badge}</Badge>}
        </div>
      </div>
      {note && <p className="text-xs text-muted-foreground sm:text-right">{note}</p>}
      {actions && <div className="shrink-0 self-start sm:self-auto">{actions}</div>}
    </div>
  );
}

function DashboardRow({ label, icon, tone, children, labelActions }: {
  label: string;
  icon: ReactNode;
  tone: keyof typeof toneStyles;
  children: ReactNode;
  labelActions?: ReactNode;
}) {
  return (
    <div className="grid gap-3 px-4 py-4 lg:grid-cols-[150px_minmax(0,1fr)] lg:px-5">
      <div>
        <span className={cn('inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold', toneStyles[tone])}>
          {icon}{label}
        </span>
        {labelActions && <div className="mt-1.5">{labelActions}</div>}
      </div>
      <div className="min-w-0 space-y-2">{children}</div>
    </div>
  );
}

function DashboardItem({ source, title, meta, badges, urgent, actions, singleLine = false, preserveMeta = false, messageHref, unavailableReason, projectIcon, projectIconUrl, projectColor, priority }: {
  source: DashboardBriefSource;
  title: string;
  meta?: string;
  badges?: string[];
  urgent?: boolean;
  actions?: ReactNode;
  singleLine?: boolean;
  preserveMeta?: boolean;
  messageHref?: string;
  unavailableReason?: string;
  projectIcon?: string;
  projectIconUrl?: string;
  projectColor?: string;
  priority?: DashboardBriefItem['priority'];
}) {
  const separatedMeta = singleLine && preserveMeta && Boolean(meta);
  const content = <>
    <span className={cn('font-medium', separatedMeta && 'min-w-0 truncate')}>{title}</span>
    {meta && <span className={cn('text-xs', separatedMeta ? 'min-w-0 break-words sm:max-w-[75%] sm:shrink-0' : 'ml-2', urgent ? 'font-semibold text-rose-600' : 'text-muted-foreground')}>・{meta}</span>}
    {badges?.map((badge) => <span key={badge} className="ml-1.5 inline-flex items-center rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-amber-800">{badge}</span>)}
  </>;
  const messageClassName = cn('min-w-0', separatedMeta ? 'grid gap-x-2 gap-y-0.5 sm:flex sm:items-baseline' : singleLine ? 'block truncate' : 'break-words');
  const tooltip = unavailableReason ?? (singleLine ? [title, meta].filter(Boolean).join('・') : undefined);
  return (
    <div className={cn('grid gap-2 text-sm', singleLine ? 'grid-cols-[auto_minmax(0,1fr)] items-center' : 'sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center')}>
      <SourceBadge source={source} projectIcon={projectIcon} projectIconUrl={projectIconUrl} projectColor={projectColor} priority={priority} />
      {messageHref
        ? <Link href={messageHref} title={tooltip} className={cn(messageClassName, 'rounded-sm hover:text-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600')}>{content}</Link>
        : <div className={messageClassName} title={tooltip} aria-disabled={unavailableReason ? true : undefined}>{content}</div>}
      {actions}
    </div>
  );
}

function SourceBadge({ source, projectIcon, projectIconUrl, projectColor, priority }: { source: DashboardBriefItem['source']; projectIcon?: string; projectIconUrl?: string; projectColor?: string; priority?: DashboardBriefItem['priority'] }) {
  if ((source === 'TF' || source === 'CK') && (projectIcon || projectIconUrl)) return <ProjectIconBadge icon={projectIcon} iconUrl={projectIconUrl} color={projectColor} priority={priority} />;
  return (
    <span className={cn('inline-flex w-fit shrink-0 items-center justify-self-start justify-center', compactBadgeClassName, sourceStyles[source])}>
      {source}
    </span>
  );
}

function briefRowIcon(label: string) {
  if (label === '返信待ち・重要') return <Mail className="h-4 w-4" />;
  if (label === '今日の予定') return <CalendarDays className="h-4 w-4" />;
  if (label === '確認待ち') return <CheckCircle2 className="h-4 w-4" />;
  if (label === '今日やる') return <ListTodo className="h-4 w-4" />;
  if (label === '要整理') return <ListFilter className="h-4 w-4" />;
  return <PauseCircle className="h-4 w-4" />;
}

function BriefAction({ item }: { item: DashboardBriefItem }) {
  if (!item.action) return null;

  const content = <>{item.action}<ArrowRight className="h-3 w-3" /></>;
  const className = 'inline-flex items-center gap-1 justify-self-start text-xs font-medium text-blue-700 sm:justify-self-end';

  if (item.href) {
    if (item.href.startsWith('http')) {
      return <a href={item.href} target="_blank" rel="noreferrer" className={className}>{content}</a>;
    }
    return <Link href={item.href} className={className}>{content}</Link>;
  }

  return <button type="button" className={className}>{content}</button>;
}

type DashboardCommentsState = ReturnType<typeof useDashboardComments>;
type InboxCommentDisplay = InboxComment & { task: DashboardTask };

function applyInboxCommentDisplay(item: DashboardBriefItem, comments: DashboardCommentsState): DashboardBriefItem {
  if (item.source !== 'CK' || !item.projectId || !item.sourceCommentId) return item;
  const inboxItem = comments.items.find((candidate) => candidate.projectId === item.projectId && candidate.comment.id === item.sourceCommentId);
  if (!inboxItem) return item;
  return {
    ...item,
    title: commentPreview(inboxItem.comment),
    meta: formatInboxCommentMeta(inboxItem),
    href: sourceCommentHref(inboxItem.task.projectId, inboxItem.task.id, inboxItem.comment.id),
  };
}

function formatInboxCommentMeta(item: Pick<InboxCommentDisplay, 'comment' | 'authorName' | 'listName' | 'task'>): string {
  return `${item.authorName} ／ ${item.task.projectName} ／ ${item.listName}・${format(item.comment.createdAt, 'yyyy/M/d H:mm')}`;
}

function BriefSection({
  rows,
  isLoading,
  isSample,
  calendarStatus,
  calendarError,
  onConnectCalendar,
  taskScope,
  onTaskScopeChange,
}: {
  rows: DashboardBriefRow[];
  isLoading: boolean;
  isSample: boolean;
  calendarStatus: GoogleCalendarConnectionStatus;
  calendarError: string | null;
  onConnectCalendar: () => Promise<void>;
  taskScope: BriefTaskScope;
  onTaskScopeChange: (scope: BriefTaskScope) => void;
}) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const { hiddenProjectIds, hydrate } = useStaleProjectDisplayStore();
  useEffect(() => { hydrate(); }, [hydrate]);
  const replyRow = rows.find((row) => row.label === '返信待ち・重要');
  const displayedRows = replyRow && rows.some((row) => row.label === '今日の予定')
    ? rows.filter((row) => row !== replyRow).flatMap((row) => row.label === '今日の予定' ? [row, replyRow] : [row])
    : rows;

  const toggleRow = (label: string) => {
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-blue-200 bg-white shadow-sm">
      <SectionHeader
        icon={<Sparkles className="h-4 w-4" />}
        title="今日のブリーフ"
        badge={isSample ? '表示サンプル' : 'TaskFlow実データ'}
        actions={<div className="flex flex-wrap items-center gap-2"><div className="flex items-center gap-1 rounded-md border border-blue-100 bg-blue-50/50 px-1.5 py-1 text-xs"><button type="button" aria-label="担当：自分のみ" aria-pressed={taskScope === 'mine'} className={cn('rounded px-2 py-0.5', taskScope === 'mine' ? 'bg-white font-semibold text-blue-800 shadow-sm' : 'text-blue-700 hover:bg-white/70')} onClick={() => onTaskScopeChange('mine')}>自分のみ</button><button type="button" aria-label="担当：全員" aria-pressed={taskScope === 'all'} className={cn('rounded px-2 py-0.5', taskScope === 'all' ? 'bg-white font-semibold text-blue-800 shadow-sm' : 'text-blue-700 hover:bg-white/70')} onClick={() => onTaskScopeChange('all')}>全員</button></div><MeetLinkSettings /></div>}
      />
      {isLoading && (
        <div className="flex items-center gap-2 border-b px-5 py-3 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />TaskFlowのデータを読み込んでいます
        </div>
      )}
      {!isSample && calendarStatus !== 'connected' && (
        <div className="flex flex-col gap-3 border-b bg-blue-50/60 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-blue-950">Googleカレンダーを読み取り専用で表示</p>
            <p className="mt-0.5 text-xs text-blue-800">
              {calendarError ?? '予定の作成・変更は行いません。接続情報はこの画面を閉じるまでだけ保持します。'}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 border-blue-200 bg-white text-blue-800 hover:bg-blue-100"
            onClick={() => void onConnectCalendar()}
            disabled={calendarStatus === 'connecting'}
          >
            {calendarStatus === 'connecting' ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <CalendarDays className="mr-2 h-3.5 w-3.5" />
            )}
            {calendarStatus === 'error' ? 'もう一度接続' : 'Googleカレンダーを接続'}
          </Button>
        </div>
      )}
      <div className="divide-y">
        {displayedRows.map((sourceRow) => {
          const row = isSample ? sourceRow : filterStaleProjects(sourceRow, hiddenProjectIds);
          const hiddenItemCount = sourceRow.label === '3日動いていない'
            ? Math.max(0, sourceRow.total - row.total)
            : 0;
          const isExpanded = expandedRows.has(row.label);
          const initialVisibleCount = row.label === '今日やる' ? 10 : 3;
          const visibleItems = isExpanded ? row.items : row.items.slice(0, initialVisibleCount);
          const inlineTaskLinks = ['今日やる', '確認待ち', '3日動いていない', '要整理'].includes(row.label);
          const preservesInlineMeta = ['今日やる', '確認待ち'].includes(row.label);

          return (
            <DashboardRow key={row.label} label={row.label} icon={briefRowIcon(row.label)} tone={row.tone}
              labelActions={!isSample && row.label === '3日動いていない' ? <StaleProjectDisplaySettings /> : undefined}>
              {hiddenItemCount > 0 && (
                <p className="text-xs text-muted-foreground">
                  表示設定で{hiddenItemCount}タスクを非表示中（表示中 {row.total}タスク）
                </p>
              )}
              {visibleItems.map((item, index) => (
                <DashboardItem key={`${row.label}-${item.href ?? item.title}-${index}`} {...item}
                  singleLine={inlineTaskLinks}
                  preserveMeta={preservesInlineMeta}
                  messageHref={inlineTaskLinks ? item.href : undefined}
                  actions={inlineTaskLinks ? undefined : <BriefAction item={item} />} />
              ))}
              {row.items.length > initialVisibleCount && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  aria-expanded={isExpanded}
                  onClick={() => toggleRow(row.label)}
                >
                  {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  {isExpanded ? '表示を戻す' : `すべて表示（${row.total}件）`}
                </button>
              )}
            </DashboardRow>
          );
        })}
      </div>
    </section>
  );
}

function UpcomingSection({
  days,
  calendarDays,
  isLoading,
  isCalendarConnected,
}: {
  days: DashboardUpcomingDay[];
  calendarDays: DashboardCalendarDay[];
  isLoading: boolean;
  isCalendarConnected: boolean;
}) {
  const { dayCount, hydrate, setDayCount, persistenceFailed } = useUpcomingRangeStore();
  useEffect(() => { hydrate(); }, [hydrate]);
  return (
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <SectionHeader
        icon={<CalendarDays className="h-4 w-4" />}
        title={`直近${dayCount}日`}
        badge={isCalendarConnected ? 'TF ＋ Googleカレンダー' : 'TaskFlow実データ'}
        actions={<div className="flex flex-col items-end gap-1">
          <div role="group" aria-label="直近の表示期間" className="inline-flex gap-1 rounded-md border bg-muted/30 p-0.5">
            {UPCOMING_RANGES.map((value) => <Button key={value} size="sm" variant={dayCount === value ? 'default' : 'ghost'} className="h-7 px-3 text-xs" aria-pressed={dayCount === value} onClick={() => setDayCount(value)}>{value}日</Button>)}
          </div>
          {persistenceFailed && <span role="status" className="text-xs text-amber-700">この画面でのみ有効です。</span>}
        </div>}
      />
      {isLoading && (
        <div className="flex items-center gap-2 border-b px-5 py-3 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />TaskFlowのタスクを読み込んでいます
        </div>
      )}
      <div className={cn('grid md:grid-cols-3', dayCount === 5 && 'xl:grid-cols-5')}>
        {days.slice(0, dayCount).map((day, index) => (
          <div key={day.dayOffset} className={cn('min-w-0 space-y-3 px-5 py-4', index > 0 && 'border-t', index % 3 !== 0 && 'md:border-l', index < 3 && 'md:border-t-0', dayCount === 5 && 'xl:border-t-0', dayCount === 5 && index > 0 && 'xl:border-l')}>
            <div>
              <p className="text-xs font-medium text-muted-foreground">{day.label}</p>
              <p className="font-semibold">{format(day.date, 'M/d（E）', { locale: ja })}</p>
            </div>
            <div className="space-y-2">
              {calendarDays
                .find((calendarDay) => calendarDay.dayOffset === day.dayOffset)
                ?.events.map((event) => {
                  const content = (
                    <>
                      <SourceBadge source="CAL" />
                      <span className="min-w-0">
                        <span className="block font-medium">{event.title}</span>
                        <span className="block text-xs text-muted-foreground">
                          {event.isAllDay
                            ? '終日'
                            : `${format(event.start, 'H:mm')}–${format(event.end, 'H:mm')}`}
                        </span>
                      </span>
                    </>
                  );

                  return event.htmlLink ? (
                    <a
                      key={`cal-${event.id}`}
                      href={event.htmlLink}
                      target="_blank"
                      rel="noreferrer"
                      className="grid grid-cols-[auto_1fr] items-start gap-2 rounded-md py-1 text-sm hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {content}
                    </a>
                  ) : (
                    <div key={`cal-${event.id}`} className="grid grid-cols-[auto_1fr] items-start gap-2 py-1 text-sm">
                      {content}
                    </div>
                  );
                })}
              {day.tasks.map((task) => (
                <Link
                  key={`${task.id}-${task.href}`}
                  href={task.href}
                  className="grid grid-cols-[auto_1fr] items-start gap-2 rounded-md py-1 text-sm hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <SourceBadge source="TF" projectIcon={task.projectIcon} projectIconUrl={task.projectIconUrl} projectColor={task.projectColor} priority={task.priority} />
                  <span className="min-w-0">
                    <span className="block font-medium">{task.title}</span>
                    <span className="block text-xs text-muted-foreground">{task.projectName}</span>
                  </span>
                </Link>
              ))}
              {!isLoading &&
                day.tasks.length === 0 &&
                (!isCalendarConnected ||
                  calendarDays.find((calendarDay) => calendarDay.dayOffset === day.dayOffset)?.events.length === 0) && (
                <p className="text-sm text-muted-foreground">
                  {isCalendarConnected ? '予定・期限タスクなし' : 'TaskFlowの期限タスクなし'} 🎉
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TargetsSection({ tasks, tasksLoading, tasksError }: { tasks: DashboardTask[]; tasksLoading: boolean; tasksError: Error | null }) {
  const { projects, isLoading, error } = useProjects();
  const { selectedProjectIds, hydrate } = useTargetProjectStore();
  useEffect(() => { hydrate(); }, [hydrate]);
  const visibleProjects = projects.filter((project) => selectedProjectIds?.includes(project.id));
  const columnCount = Math.min(visibleProjects.length, 3);

  return (
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm" aria-label="今月の的">
      <SectionHeader icon={<Target className="h-4 w-4" />} title="今月の的" badge={selectedProjectIds === null ? '表示サンプル' : '自動おすすめ'}
        actions={<TargetProjectSettings projects={projects} isLoading={isLoading} hasError={Boolean(error)} />} />
      {selectedProjectIds !== null && <p className="border-b px-5 py-2 text-xs text-muted-foreground">期限・優先度・開始日・依存関係から各プロジェクト最大3件を自動抽出しています（AI接続前の暫定表示）。</p>}
      {selectedProjectIds === null ? <div className="grid md:grid-cols-3">
        {targets.map((target, index) => (
          <div key={target.project} className={cn('px-5 py-4', index > 0 && 'border-t md:border-l md:border-t-0')}>
            <p className="mb-3 text-sm font-semibold">{target.project}</p>
            <div className="space-y-2.5">
              {target.items.map((item) => (
                <div key={item.text} className="flex items-start gap-2 text-sm">
                  <span className={cn('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border', item.done ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-gray-300')}>
                    {item.done && <Check className="h-3 w-3" />}
                  </span>
                  <span className={item.done ? 'text-muted-foreground line-through' : ''}>{item.text}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div> : isLoading ? <p className="px-5 py-4 text-sm text-muted-foreground">プロジェクトを読み込み中…</p>
        : error ? <p role="alert" className="px-5 py-4 text-sm text-rose-700">プロジェクトを読み込めませんでした。選択内容は保持しています。</p>
        : visibleProjects.length > 0 ? <div className={cn('grid bg-white', columnCount === 2 && 'md:grid-cols-2', columnCount === 3 && 'md:grid-cols-3')}>
          {visibleProjects.map((project, index) => (
            <div key={project.id} className={cn('min-w-0 px-5 py-4', index > 0 && 'border-t', index < columnCount && 'md:border-t-0', index % columnCount !== 0 && 'md:border-l')}>
              <p className="mb-2 break-words text-sm font-semibold">{project.name}</p>
              <RecommendedTargets projectId={project.id} tasks={tasks} isLoading={tasksLoading} error={tasksError} />
              <Link href={`/projects/${project.id}/board`} className="mt-3 inline-flex items-center gap-1 text-xs text-blue-700">プロジェクトを開く<ArrowRight className="h-3 w-3" /></Link>
            </div>
          ))}
        </div> : <p className="px-5 py-4 text-sm text-muted-foreground">
          {selectedProjectIds.length === 0 ? '表示するプロジェクトがありません。「プロジェクトを選択」で選んでください。' : '選択したプロジェクトは現在表示できません。「プロジェクトを選択」で選び直せます。'}
        </p>}
    </section>
  );
}

function ScoreSection() {
  return (
    <section className="overflow-hidden rounded-2xl border border-amber-200 bg-amber-50/30 shadow-sm" aria-label="今週のスコア（表示サンプル）">
      <SectionHeader icon={<Trophy className="h-4 w-4" />} title="今週のスコア" badge="表示サンプル・未連携" />
      <p className="border-b bg-amber-50/60 px-5 py-2 text-xs text-amber-900">
        数値はレイアウト確認用の固定サンプルです。売上・レビュー・金額データには接続していません。
      </p>
      <div className="grid bg-white md:grid-cols-3">
        <div className="space-y-2 px-5 py-5">
          <p className="text-xs font-medium text-muted-foreground">積算売上（9月〜）</p>
          <div className="flex items-end gap-2"><strong className="text-3xl">¥32,000</strong><span className="pb-1 text-xs font-semibold text-emerald-700">＋8,000 今週</span></div>
          <div className="flex h-10 items-end gap-1" aria-label="積算売上のサンプルグラフ">
            {[10, 16, 23, 31, 39].map((height) => <span key={height} className="w-3 rounded-t bg-amber-400" style={{ height }} />)}
          </div>
        </div>
        <div className="space-y-3 border-t px-5 py-5 md:border-l md:border-t-0">
          <p className="text-xs font-medium text-muted-foreground">ココナラ レビュー</p>
          <p><strong className="text-3xl">4</strong><span className="text-muted-foreground"> ／15件</span><span className="ml-2 text-xs font-semibold text-emerald-700">＋1</span></p>
          <div className="h-2 overflow-hidden rounded-full bg-gray-100"><div className="h-full w-[27%] rounded-full bg-emerald-500" /></div>
          <p className="text-xs text-muted-foreground">15件で価格改定を検討</p>
        </div>
        <div className="space-y-3 border-t px-5 py-5 md:border-l md:border-t-0">
          <p className="text-xs font-medium text-muted-foreground">動いているお金（列の合計・自動）</p>
          <div className="flex flex-wrap gap-3 text-sm"><span>対応中 <strong>¥3,000</strong></span><span>提案中 <strong>¥98,000</strong></span></div>
          <p className="text-sm">モニター判定まで <strong>あと33日</strong></p>
        </div>
      </div>
      <div className="border-t bg-white px-5 py-3 text-xs text-muted-foreground">経路別：ココナラ自動化 ¥21,000・占い ¥3,000・note等 ¥8,000　未入金 ¥0</div>
    </section>
  );
}

function InboxSection({ settings, comments, isSample }: { settings: InboxDisplayOptions; comments: DashboardCommentsState; isSample: boolean }) {
  const groups = [
    { key: 'gmail', label: 'Gmail', source: 'MAIL', tone: 'red', icon: <Mail className="h-4 w-4" /> },
  ] as const;

  return (
    <section className="overflow-hidden rounded-2xl border border-blue-200 bg-white shadow-sm" aria-label="受信箱">
      <SectionHeader icon={<Inbox className="h-4 w-4" />} title="受信箱" badge={settings.comments ? 'コメント：TaskFlow実データ' : undefined} actions={<InboxDisplaySettings />} />
      <div className="divide-y">
        {groups.filter((group) => settings[group.key]).map((group) => (
          <DashboardRow key={group.key} label={group.label} icon={group.icon} tone={group.tone}>
            <p className="text-xs text-muted-foreground">Gmailは表示サンプルです。実際のメールは未連携です。</p>
            {inboxItems.filter((item) => item.channel === group.key).map((item) => (
              <DashboardItem key={`${item.sender}-${item.context}`} source={group.source} title={item.body} singleLine
                meta={`${item.sender} ／ ${item.context}`}
                unavailableReason="Gmailは表示サンプルです。実際のメールは未連携のため開けません。" />
            ))}
          </DashboardRow>
        ))}
        {settings.comments && (
          <DashboardRow label="コメント" icon={<MessageSquare className="h-4 w-4" />} tone="blue">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">参加中プロジェクトの最新10件・本文抜粋（完了を含む・アーカイブを除く）{comments.updatedAt && `・取得 ${format(comments.updatedAt, 'H:mm')}`}</p>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={comments.refresh} disabled={comments.isLoading || isSample}>コメントを更新</Button>
            </div>
            {isSample ? <p className="text-sm text-muted-foreground">ログインすると実際のコメントを表示します。</p>
              : <>
                {comments.isLoading && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />コメントを読み込み中…</p>}
                {comments.hasError && <p role="alert" className="text-sm text-rose-700">一部のプロジェクト・コメントを取得できませんでした。表示は取得できた分のみです。「コメントを更新」で再確認できます。</p>}
                {comments.errorDetail && <p className="text-xs text-rose-700">{comments.errorDetail}</p>}
                {comments.metadataIncomplete && <p className="text-xs text-muted-foreground">一部の投稿者名・列名を取得できませんでした。</p>}
                {!comments.isLoading && !comments.hasError && comments.items.length === 0 && <p className="text-sm text-muted-foreground">コメントはまだありません。</p>}
                {comments.items.map(({ key, comment, authorName, listName, task }) => (
                  <DashboardItem key={key} source="TF" title={commentPreview(comment)} singleLine preserveMeta
                    meta={formatInboxCommentMeta({ comment, authorName, listName, task })}
                    messageHref={sourceCommentHref(task.projectId, task.id, comment.id)} projectIcon={task.projectIcon} projectIconUrl={task.projectIconUrl} projectColor={task.projectColor} priority={task.priority} />
                ))}
              </>}
          </DashboardRow>
        )}
        {settings.googleChat && (
          <DashboardRow label="Google Chat" icon={<MessageSquare className="h-4 w-4" />} tone="green">
            <p className="text-sm text-muted-foreground">Google Chatは未連携です。メッセージはまだ取得していません。</p>
          </DashboardRow>
        )}
        {!Object.values(settings).some(Boolean) && (
          <p className="px-5 py-4 text-sm text-muted-foreground">表示する項目がありません。「表示設定」で選択してください。</p>
        )}
      </div>
    </section>
  );
}

export function KozueDashboard({ displayName }: { displayName: string }) {
  const todayDate = new Date();
  const today = format(todayDate, 'yyyy.M.d EEEE', { locale: ja });
  const {
    allProjectTasks,
    tasksError,
    data: briefData,
    upcomingDays,
    upcomingCalendarDays,
    isLoading: isBriefLoading,
    areTasksLoading,
    calendarStatus,
    calendarError,
    connectCalendar,
    isSample,
  } = useTaskFlowBrief(useBriefDisplayStore((state) => state.taskScope));
  const { taskScope, hydrate: hydrateBriefDisplay, setTaskScope } = useBriefDisplayStore();
  useEffect(() => { hydrateBriefDisplay(); }, [hydrateBriefDisplay]);
  const { settings: inboxSettings, hydrate: hydrateInbox } = useInboxDisplayStore();
  useEffect(() => { hydrateInbox(); }, [hydrateInbox]);
  const comments = useDashboardComments(allProjectTasks, areTasksLoading, tasksError, inboxSettings.comments && !isSample);
  const displayedBriefRows = briefData?.rows ?? briefRows;
  const briefRowsWithInboxComments = displayedBriefRows.map((row) => row.label === '確認待ち'
    ? { ...row, items: row.items.map((item) => applyInboxCommentDisplay(item, comments)) }
    : row);

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-4 pb-12">
      <header
        aria-label={`${displayName}さんのマイ画面`}
        className="grid gap-3 py-1 sm:grid-cols-[minmax(220px,auto)_1fr] sm:items-stretch"
      >
        <div className="flex items-center py-2 pr-2">
          <h1>
            <time dateTime={format(todayDate, 'yyyy-MM-dd')} aria-label={today} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span aria-hidden="true" className="whitespace-nowrap text-3xl font-medium leading-none tracking-tight text-neutral-950 tabular-nums sm:text-4xl">{format(todayDate, 'yyyy.M.d')}</span>
              <span aria-hidden="true" className="whitespace-nowrap text-xs font-medium text-orange-700">{format(todayDate, 'EEEE', { locale: ja })}</span>
            </time>
          </h1>
        </div>
        <SharedCountdown tasks={allProjectTasks} tasksLoading={areTasksLoading} tasksError={tasksError} />
      </header>

      <BriefSection
        rows={briefRowsWithInboxComments}
        isLoading={isBriefLoading}
        isSample={isSample}
        calendarStatus={calendarStatus}
        calendarError={calendarError}
        onConnectCalendar={connectCalendar}
        taskScope={taskScope}
        onTaskScopeChange={setTaskScope}
      />
      <UpcomingSection
        days={upcomingDays}
        calendarDays={upcomingCalendarDays}
        isLoading={areTasksLoading}
        isCalendarConnected={calendarStatus === 'connected'}
      />
      <TargetsSection tasks={allProjectTasks} tasksLoading={areTasksLoading} tasksError={tasksError} />
      <TargetGoals tasks={allProjectTasks} tasksLoading={areTasksLoading} tasksError={tasksError} />
      <ScoreSection />
      <InboxSection settings={inboxSettings} comments={comments} isSample={isSample} />
      <MeetingProposals tasks={allProjectTasks} tasksLoading={areTasksLoading} tasksError={tasksError} isSample={isSample} />
    </div>
  );
}
