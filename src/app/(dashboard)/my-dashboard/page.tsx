'use client';

import { KozueDashboard } from '@/components/dashboard/KozueDashboard';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/useAuth';

export default function MyDashboardPage() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-[1500px] space-y-4">
        <div>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="mt-2 h-4 w-32" />
        </div>
        <Skeleton className="h-[520px] rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    );
  }

  const displayName = user?.displayName?.split(' ')[0] || 'ユーザー';

  return <KozueDashboard displayName={displayName} />;
}
