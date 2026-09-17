import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Providers } from './index';
import type { ReactNode } from 'react';

const state = vi.hoisted(() => ({ path: '/ui-guide', initialize: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => state.path }));
vi.mock('@/lib/firebase/config', () => ({ initializeFirestore: state.initialize }));
vi.mock('@/lib/firebase/testMode', () => ({ isE2EMockAuthEnabled: () => false }));
vi.mock('./AppearanceProvider', () => ({ AppearanceProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('./QueryProvider', () => ({ QueryProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('./AuthProvider', () => ({ AuthProvider: ({ children }: { children: ReactNode }) => <div data-testid="auth">{children}</div> }));
vi.mock('@/components/task/TaskAutomationRunner', () => ({ TaskAutomationRunner: () => <div>task automation</div> }));
vi.mock('@/components/board/AutoArchiveRunner', () => ({ AutoArchiveRunner: () => <div>auto archive</div> }));

describe('guide provider boundary', () => {
  it.each(['/ui-guide', '/ui-guide/preview'])('does not mount business providers at %s', path => {
    state.path = path; state.initialize.mockClear();
    render(<Providers>架空の見本</Providers>);
    expect(screen.getByText('架空の見本')).toBeInTheDocument();
    expect(screen.queryByTestId('auth')).not.toBeInTheDocument();
    expect(screen.queryByText('task automation')).not.toBeInTheDocument();
    expect(screen.queryByText('auto archive')).not.toBeInTheDocument();
    expect(state.initialize).not.toHaveBeenCalled();
  });
  it('retains all business providers for actual screens', () => {
    state.path = '/neo'; state.initialize.mockResolvedValue(undefined);
    render(<Providers>実画面</Providers>);
    expect(screen.getByTestId('auth')).toBeInTheDocument();
    expect(screen.getByText('task automation')).toBeInTheDocument();
    expect(screen.getByText('auto archive')).toBeInTheDocument();
    expect(state.initialize).toHaveBeenCalledOnce();
  });
});
