import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import Consent from './consent';

const auth = vi.hoisted(() => ({ getIdToken: vi.fn(), signIn: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({
  firebaseUser: user, isLoading: false, signInForMcp: auth.signIn,
}) }));
const user = { uid: 'fixture-user', email: 'fixture@1000ri.jp', getIdToken: auth.getIdToken };

beforeEach(() => {
  vi.clearAllMocks();
  auth.getIdToken.mockResolvedValue('fixture-id-token');
  auth.signIn.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

it('refreshes Firebase credentials before fetching the authorized projects', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ projects: [{ id: 'fixture-project', name: '架空プロジェクト' }] })));
  vi.stubGlobal('fetch', fetch);
  render(<Consent interaction="fixture-interaction" />);
  await screen.findByRole('option', { name: '架空プロジェクト' });
  expect(auth.getIdToken).toHaveBeenCalledWith(true);
  expect(fetch).toHaveBeenCalledWith('/mcp-connect/consent?interaction=fixture-interaction', expect.objectContaining({ cache: 'no-store' }));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'fixture-project' } });
  expect(screen.getByRole('button', { name: '架空通知のテストを許可' })).toBeEnabled();
});

it('lets a signed-in user recover from denied consent by signing in again', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response('{}', { status: 403 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ projects: [{ id: 'fixture-project', name: '架空プロジェクト' }] })));
  vi.stubGlobal('fetch', fetch);
  render(<Consent interaction="fixture-interaction" />);
  fireEvent.click(await screen.findByRole('button', { name: 'SlowthのGoogleアカウントで再ログイン' }));
  await screen.findByRole('option', { name: '架空プロジェクト' });
  expect(auth.signIn).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(auth.getIdToken.mock.calls).toEqual([[true], [true]]);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('keeps consent disabled when Google sign-in fails and reports the failure', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 403 })));
  auth.signIn.mockRejectedValue(new Error('fixture canceled'));
  render(<Consent interaction="fixture-interaction" />);
  fireEvent.click(await screen.findByRole('button', { name: 'SlowthのGoogleアカウントで再ログイン' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Googleログインを完了できませんでした。'));
  expect(screen.getByRole('button', { name: '架空通知のテストを許可' })).toBeDisabled();
});

it('shows production data destination, thirty-day consent, and the selected project', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ mode: 'production', projects: [{ id: 'fixture-project', name: 'タスク管理ツール' }] }))));
  render(<Consent interaction="fixture-interaction" />);
  await screen.findByRole('option', { name: 'タスク管理ツール' });
  expect(screen.getByText(/ChatGPTのDotへ通知/)).toHaveTextContent('最大30日間');
  const approve = screen.getByRole('button', { name: '30日間のタスク通知を許可' });
  expect(approve).toBeDisabled(); fireEvent.change(screen.getByRole('combobox'), { target: { value: 'fixture-project' } });
  expect(approve).toBeEnabled(); expect(screen.queryByRole('button', { name: '架空通知のテストを許可' })).not.toBeInTheDocument();
});
