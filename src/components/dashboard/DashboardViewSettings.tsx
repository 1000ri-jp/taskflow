'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { DASHBOARDS, dashboardHref, useDashboardViewStore } from '@/stores/dashboardViewStore';
import { Button } from '@/components/ui/button';

export function DashboardViewSettings() {
  const { view, choose, hydrate, persistenceError } = useDashboardViewStore();
  useEffect(() => { hydrate(); }, [hydrate]);
  return <div className="space-y-3">
    <fieldset className="flex flex-wrap gap-3"><legend className="mb-2 text-sm">最初に開くダッシュボード</legend>
      {DASHBOARDS.map(item => <label key={item.id} className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"><input type="radio" name="dashboard-view" value={item.id} checked={view === item.id} onChange={() => choose(item.id)} />{item.name}</label>)}
    </fieldset>
    {persistenceError && <p role="status" className="text-xs text-amber-800">次回の表示を保存できません。この画面では選んだダッシュボードを開けます。</p>}
    <Button size="sm" variant="outline" asChild><Link href={dashboardHref(view)}>選んだ画面を開く</Link></Button>
  </div>;
}
