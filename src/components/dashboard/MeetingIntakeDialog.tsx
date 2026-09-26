'use client';

import { useMyTasks } from '@/hooks/useMyTasks';
import type { ReactNode } from 'react';
import { MeetingIntake } from './MeetingIntake';

// Mounted on the first request, then retained so closing the popup keeps its draft.
export default function MeetingIntakeDialog({ open, onOpenChange, trigger }: { open: boolean; onOpenChange: (open: boolean) => void; trigger?: ReactNode }) {
  const { projects, allProjectTasks, isLoading, error } = useMyTasks();
  const notice = error
    ? <p role="alert" className="text-xs text-amber-800">仕事を取得できません：{error.message}</p>
    : isLoading ? <p role="status" className="text-xs text-muted-foreground">仕事を読み込み中…</p> : null;
  return <MeetingIntake projects={projects} tasks={allProjectTasks} disabled={isLoading || !!error} launcherOnly presentation="popover" trigger={trigger} open={open} onOpenChange={onOpenChange} notice={notice} />;
}
