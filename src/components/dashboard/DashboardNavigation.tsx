'use client';

import { useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { Settings2 } from 'lucide-react';
import { useDashboardViewStore, type DashboardView } from '@/stores/dashboardViewStore';

export function DashboardNavigation({ current, trailing, showSettingsLink = true, trailingAlign = 'end' }: { current: DashboardView; trailing?: ReactNode; showSettingsLink?: boolean; trailingAlign?: 'start' | 'end' }) {
  const { choose, persistenceError } = useDashboardViewStore();
  useEffect(() => { choose(current); }, [choose, current]);
  return <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
    {showSettingsLink && <Link href="/settings#dashboard-view" className="inline-flex items-center gap-1.5 rounded-md py-1 text-xs text-muted-foreground hover:text-foreground"><Settings2 className="size-3.5" aria-hidden="true" />画面の設定</Link>}
    {trailing && <div className={trailingAlign === 'end' ? 'ml-auto' : undefined}>{trailing}</div>}
    {persistenceError && <p role="status" className="w-full text-xs text-amber-800">この画面は使えますが、次回の表示を保存できませんでした。</p>}
  </div>;
}
