'use client';

import { useAuth } from '@/hooks/useAuth';
import { Skeleton } from '@/components/ui/skeleton';
import { PersonalMemo } from '@/components/dashboard/PersonalMemo';
import { MyTasks } from '@/components/dashboard/MyTasks';
import { OverdueTasksAlert } from '@/components/dashboard/OverdueTasksAlert';
import { ProjectProgress } from '@/components/dashboard/ProjectProgress';
import { DashboardNavigation } from '@/components/dashboard/DashboardNavigation';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';

export function ClassicDashboard() {
  const { user, isLoading } = useAuth();


  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="mt-2 h-4 w-32" />
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-6">
      <DashboardNavigation current="classic" />
      {isE2EMockAuthEnabled() && <p className="text-xs text-amber-800">ローカル検証用・架空データ。</p>}
      {/* Welcome Section */}
      <div>
        <h1 className="text-2xl font-bold">
          おかえりなさい、{user?.displayName?.split(' ')[0] || 'ユーザー'}さん
        </h1>
        <p className="text-muted-foreground">
          今日も頑張りましょう
        </p>
      </div>

      {/* Overdue Tasks Alert */}
      <OverdueTasksAlert />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Personal Memo */}
        <PersonalMemo />

        {/* My Tasks */}
        <MyTasks />
      </div>

      {/* Project Progress */}
      <ProjectProgress />
    </div>
  );
}
