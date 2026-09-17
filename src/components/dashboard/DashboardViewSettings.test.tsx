import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DashboardViewSettings } from './DashboardViewSettings';
import { DASHBOARD_VIEW_KEY, useDashboardViewStore } from '@/stores/dashboardViewStore';

beforeEach(() => { localStorage.setItem(DASHBOARD_VIEW_KEY, 'neo'); useDashboardViewStore.setState({ view: 'classic', hydrated: false, persistenceError: false }); });
describe('dashboard selection in settings', () => {
  it('restores the existing choice and keeps every legacy route available', () => {
    render(<DashboardViewSettings />);
    expect(screen.getByRole('radio', { name: 'Neo' })).toBeChecked();
    expect(screen.getByRole('link', { name: '選んだ画面を開く' })).toHaveAttribute('href', '/neo');
    fireEvent.click(screen.getByRole('radio', { name: '新版' }));
    expect(localStorage.getItem(DASHBOARD_VIEW_KEY)).toBe('overview');
    expect(screen.getByRole('link')).toHaveAttribute('href', '/my-dashboard');
    fireEvent.click(screen.getByRole('radio', { name: '旧版' }));
    expect(screen.getByRole('link')).toHaveAttribute('href', '/classic');
  });
});
