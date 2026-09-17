import { create } from 'zustand';

export type DashboardView = 'classic' | 'overview' | 'neo';
export const DASHBOARD_VIEW_KEY = 'taskflow.dashboardView.v1';
export const DASHBOARDS = [
  { id: 'classic', name: '旧版', menuName: 'ダッシュボード（旧版）', href: '/classic' },
  { id: 'overview', name: '新版', menuName: 'ダッシュボード（新版）', href: '/my-dashboard' },
  { id: 'neo', name: 'Neo', menuName: 'Neo', href: '/neo' },
] as const;

function parseView(value: string | null): DashboardView {
  return DASHBOARDS.some(item => item.id === value) ? value as DashboardView : 'classic';
}

export const useDashboardViewStore = create<{
  view: DashboardView;
  hydrated: boolean;
  persistenceError: boolean;
  hydrate: () => void;
  choose: (view: DashboardView) => void;
}>(set => ({
  view: 'classic', hydrated: false, persistenceError: false,
  hydrate: () => {
    try { set({ view: parseView(localStorage.getItem(DASHBOARD_VIEW_KEY)), hydrated: true, persistenceError: false }); }
    catch { set({ hydrated: true, persistenceError: true }); }
  },
  choose: view => {
    let persistenceError = false;
    try { localStorage.setItem(DASHBOARD_VIEW_KEY, view); } catch { persistenceError = true; }
    set({ view, hydrated: true, persistenceError });
  },
}));

export function dashboardHref(view: DashboardView) {
  return DASHBOARDS.find(item => item.id === view)!.href;
}
