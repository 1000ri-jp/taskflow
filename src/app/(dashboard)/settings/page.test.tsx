import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import SettingsPage from './page';

const auth = vi.hoisted(() => ({ user: { id: 'u' } as { id: string } | null }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: (selector: (state: typeof auth) => unknown) => selector(auth) }));
vi.mock('@/components/board/AutoArchiveSettings', () => ({ AutoArchiveSettings: ({ projectId }: { projectId?: string }) => <div data-testid="auto-archive-settings" data-project-id={projectId ?? 'default'} /> }));
vi.mock('@/components/task/CommentStampSettings', () => ({ CommentStampSettings: () => null }));
vi.mock('@/components/secretary/SecretaryRefreshSettings', () => ({ SecretaryRefreshSettings: () => null }));
vi.mock('@/components/dashboard/DashboardViewSettings', () => ({ DashboardViewSettings: () => null }));
vi.mock('@/components/ai/CompanionScheduleSettings', () => ({ CompanionScheduleSettings: () => null }));
afterEach(() => vi.restoreAllMocks());
it('mounts the common server-backed archive form only for the signed-in account', () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { rerender } = render(<SettingsPage />);
  expect(screen.getByTestId('auto-archive-settings')).toHaveAttribute('data-project-id', 'default');
  expect(screen.getByRole('link', { name: 'Google連携を開く' })).toHaveAttribute('href', '/settings/google');
  auth.user = null; rerender(<SettingsPage />);
  expect(screen.queryByTestId('auto-archive-settings')).not.toBeInTheDocument();
  expect(consoleError.mock.calls.flat().join(' ')).not.toContain('Encountered two children with the same key');
});

it('places the dashboard selector first after the settings heading', () => {
  const { container } = render(<SettingsPage />);
  const settings = container.querySelector('[data-ui-pattern="settings"]');
  const dashboardCard = settings?.querySelector('#dashboard-view');

  expect(settings?.children[0]).toHaveTextContent('設定');
  expect(dashboardCard).toBe(settings?.children[1]);
});
