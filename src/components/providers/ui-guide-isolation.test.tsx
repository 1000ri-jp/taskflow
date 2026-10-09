import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Providers } from './index';
import type { ReactNode } from 'react';

const state = vi.hoisted(() => ({ path: '/ui-guide', initialize: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => state.path }));
vi.mock('@/lib/firebase/config', () => ({ initializeFirestore: state.initialize }));
vi.mock('@/lib/firebase/testMode', () => ({ isE2EMockAuthEnabled: () => false }));
vi.mock('./AppearanceProvider', () => ({ AppearanceProvider: ({ children }: { children: ReactNode }) => <div data-testid="appearance">{children}</div> }));
vi.mock('./QueryProvider', () => ({ QueryProvider: ({ children }: { children: ReactNode }) => <div data-testid="query">{children}</div> }));
vi.mock('./AuthProvider', () => ({ AuthProvider: ({ children }: { children: ReactNode }) => <div data-testid="auth">{children}</div> }));
vi.mock('@/components/task/TaskAutomationRunner', () => ({ TaskAutomationRunner: () => <div>task automation</div> }));
vi.mock('@/components/board/AutoArchiveRunner', () => ({ AutoArchiveRunner: () => <div>auto archive</div> }));

beforeEach(() => {
  state.path = '/neo';
  state.initialize.mockReset().mockResolvedValue(undefined);
});

describe('provider isolation boundaries', () => {
  it.each(['/ui-guide', '/ui-guide/preview'])('does not mount business providers at %s', path => {
    state.path = path;
    render(<Providers>架空の見本</Providers>);
    expect(screen.getByText('架空の見本')).toBeInTheDocument();
    expect(screen.getByTestId('appearance')).toBeInTheDocument();
    expect(screen.queryByTestId('query')).not.toBeInTheDocument();
    expect(screen.queryByTestId('auth')).not.toBeInTheDocument();
    expect(screen.queryByText('task automation')).not.toBeInTheDocument();
    expect(screen.queryByText('auto archive')).not.toBeInTheDocument();
    expect(state.initialize).not.toHaveBeenCalled();
  });
  it.each(['/mcp-connect', '/mcp-connect/', '/mcp-connect/approve'])('mounts only authentication for OAuth consent at %s', path => {
    state.path = path;
    render(<Providers>接続の同意</Providers>);
    expect(screen.getByTestId('auth')).toHaveTextContent('接続の同意');
    expect(screen.queryByTestId('appearance')).not.toBeInTheDocument();
    expect(screen.queryByTestId('query')).not.toBeInTheDocument();
    expect(screen.queryByText('task automation')).not.toBeInTheDocument();
    expect(screen.queryByText('auto archive')).not.toBeInTheDocument();
    expect(state.initialize).not.toHaveBeenCalled();
  });
  it.each(['/desktop-mini', '/desktop-mini/task'])('retains desktop auth and data without dashboard runners at %s', path => {
    state.path = path;
    render(<Providers>ミニ画面</Providers>);
    expect(screen.getByTestId('appearance')).toBeInTheDocument();
    expect(screen.getByTestId('query')).toBeInTheDocument();
    expect(screen.getByTestId('auth')).toHaveTextContent('ミニ画面');
    expect(screen.queryByText('task automation')).not.toBeInTheDocument();
    expect(screen.queryByText('auto archive')).not.toBeInTheDocument();
    expect(state.initialize).not.toHaveBeenCalled();
  });
  it.each(['/neo', '/projects/fictional/board', '/mcp-connectivity'])('retains all business providers for actual screens at %s', path => {
    state.path = path;
    render(<Providers>実画面</Providers>);
    expect(screen.getByTestId('appearance')).toBeInTheDocument();
    expect(screen.getByTestId('query')).toBeInTheDocument();
    expect(screen.getByTestId('auth')).toBeInTheDocument();
    expect(screen.getByText('task automation')).toBeInTheDocument();
    expect(screen.getByText('auto archive')).toBeInTheDocument();
    expect(state.initialize).toHaveBeenCalledOnce();
  });
  it('removes dashboard runners on consent navigation and restores them on return', () => {
    const view = render(<Providers>画面</Providers>);
    expect(screen.getByText('task automation')).toBeInTheDocument();
    expect(screen.getByText('auto archive')).toBeInTheDocument();
    state.initialize.mockClear();

    state.path = '/mcp-connect/approve';
    view.rerender(<Providers>接続の同意</Providers>);
    expect(screen.getByTestId('auth')).toHaveTextContent('接続の同意');
    expect(screen.queryByText('task automation')).not.toBeInTheDocument();
    expect(screen.queryByText('auto archive')).not.toBeInTheDocument();
    expect(state.initialize).not.toHaveBeenCalled();

    state.path = '/neo';
    view.rerender(<Providers>実画面</Providers>);
    expect(screen.getByText('task automation')).toBeInTheDocument();
    expect(screen.getByText('auto archive')).toBeInTheDocument();
    expect(state.initialize).toHaveBeenCalledOnce();
  });
});
