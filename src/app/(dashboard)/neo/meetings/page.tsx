'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { MeetingIntake } from '@/components/dashboard/MeetingIntake';
import { useMyTasks } from '@/hooks/useMyTasks';

export default function MeetingChangesPage() {
  const { projects, allProjectTasks, isLoading, error } = useMyTasks();
  return <main className="mx-auto max-w-4xl space-y-5 pb-10">
    <Link href="/neo" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden="true" />ダッシュボード</Link>
    <div><h1 className="text-2xl font-semibold">会議から仕事を更新</h1><p className="mt-2 text-sm text-muted-foreground">メモ全体をプロジェクト横断で照合し、既存タスクへの追記・進捗更新と新しい仕事に仕分けます。</p></div>
    {isLoading && <p role="status" className="text-sm text-muted-foreground">プロジェクトとタスクを取得中…</p>}
    {error && <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">プロジェクトかタスクを取得できません。再読み込みして取得できてから続けてください。</p>}
    <MeetingIntake projects={projects} tasks={allProjectTasks} disabled={isLoading || !!error} />
  </main>;
}
