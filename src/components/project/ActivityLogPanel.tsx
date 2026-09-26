'use client';
import type { ReactNode } from 'react';
import { changeLabel } from '@/lib/task/history/presentation';
import { compactRow } from '@/components/ui/density';

import { useActivityLog } from '@/hooks/useActivityLog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AsyncState } from '@/components/ui/async-state';
import { Badge } from '@/components/ui/badge';
import {
  Plus,
  Pencil,
  Trash2,
  ArrowRight,
  CheckCircle2,
  RotateCcw,
  UserPlus,
  UserMinus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { ja } from 'date-fns/locale';
import type { ActivityAction, ActivityLog } from '@/types';

interface ActivityLogPanelProps {
  projectId: string;
}

const actionConfig: Record<ActivityAction, { icon: typeof Plus; label: string; color: string }> = {
  create: { icon: Plus, label: '作成', color: 'text-green-600' },
  update: { icon: Pencil, label: '更新', color: 'text-blue-600' },
  delete: { icon: Trash2, label: '削除', color: 'text-red-600' },
  move: { icon: ArrowRight, label: '移動', color: 'text-purple-600' },
  complete: { icon: CheckCircle2, label: '完了', color: 'text-green-600' },
  reopen: { icon: RotateCcw, label: '再開', color: 'text-orange-600' },
  assign: { icon: UserPlus, label: '担当割当', color: 'text-blue-600' },
  unassign: { icon: UserMinus, label: '担当解除', color: 'text-gray-600' },
  add_member: { icon: UserPlus, label: 'メンバー追加', color: 'text-green-600' },
  remove_member: { icon: UserMinus, label: 'メンバー削除', color: 'text-red-600' },
};

export function ActivityLogItem({ log, context, details }: { log: ActivityLog; context?: ReactNode; details?: ReactNode }) {
  const config = actionConfig[log.action] || actionConfig.update;
  const Icon = config.icon;

  return (
    <div className={`${compactRow} flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3`}>
      <div className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted', config.color)}>
        <Icon className="h-3 w-3" />
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5">
        <p className="min-w-0 break-words text-sm">
          <span className="font-medium">{log.userName}</span>
          {' '}
          <span className="text-muted-foreground">が</span>
          {' '}
          <span className="font-medium">{log.targetName}</span>
          {' '}
          <span className="text-muted-foreground">を{config.label}</span>
        </p>
        {context}
        {details ?? (log.changes && log.changes.length > 0 && (
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
            {log.changes.map((change, i) => (
              <p key={i} className="min-w-0 break-words text-xs text-muted-foreground">
                {changeLabel(change.field)}:
                {change.oldValue && (
                  <span className="line-through"> {change.oldValue}</span>
                )}
                {change.newValue && (
                  <span className="font-medium"> {change.newValue}</span>
                )}
              </p>
            ))}
          </div>
        ))}
        <time dateTime={log.createdAt.toISOString()} title={log.createdAt.toLocaleString('ja-JP')} className="ml-auto shrink-0 text-xs text-muted-foreground">
          {formatDistanceToNow(log.createdAt, { addSuffix: true, locale: ja })}
        </time>
      </div>
      <Badge variant="outline" className="h-fit shrink-0 text-[10px]">
        {log.targetType === 'task' ? 'タスク' :
         log.targetType === 'list' ? 'リスト' :
         log.targetType === 'project' ? 'プロジェクト' :
         'メンバー'}
      </Badge>
    </div>
  );
}

export function ActivityLogPanel({ projectId }: ActivityLogPanelProps) {
  const { logs, isLoading, error, retry } = useActivityLog(projectId);

  if (error) return <AsyncState state="error" message="アクティビティを取得できません。" onRetry={retry} />;
  if (isLoading) return <AsyncState state="loading" message="アクティビティを読み込み中…" />;
  if (logs.length === 0) return <AsyncState state="empty" message="アクティビティはまだありません" />;

  return (
    <ScrollArea className="h-full">
      <div className="divide-y">
        {logs.map((log) => (
          <ActivityLogItem key={log.id} log={log} />
        ))}
      </div>
    </ScrollArea>
  );
}
