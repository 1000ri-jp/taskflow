'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { dashboardHref, useDashboardViewStore } from '@/stores/dashboardViewStore';

export default function DashboardEntry() {
  const router = useRouter();
  const { view, hydrated, hydrate } = useDashboardViewStore();
  useEffect(() => { if (!hydrated) hydrate(); }, [hydrate, hydrated]);
  useEffect(() => { if (hydrated) router.replace(dashboardHref(view)); }, [hydrated, view, router]);
  return <div role="status" aria-label="ダッシュボードを開いています" className="space-y-5"><Skeleton className="h-10 w-64" /><Skeleton className="h-64" /></div>;
}
