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

function multipleResponse() {
  return new Response(JSON.stringify({ consentVersion: 2, mode: 'production', maxProjects: 500, taskScopes: ['tasks:read', 'tasks:write'],
    projects: [{ id: 'editor', name: '架空編集', canWrite: true, canWork: true, canNotify: true }, { id: 'viewer', name: '架空閲覧', canWrite: false, canWork: false, canNotify: false }] }));
}
it('selects all currently visible read targets without also granting writes, AI work or events', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => multipleResponse()));
  render(<Consent interaction="fixture-interaction" />);
  const all = await screen.findByRole('button', { name: '現在閲覧できる全件を読み取り対象にする' });
  const approve = screen.getByRole('button', { name: '選択した範囲で30日間の接続を許可' });
  expect(approve).toBeDisabled(); fireEvent.click(all); expect(approve).toBeEnabled();
  for (const label of ['架空編集の読み取り', '架空閲覧の読み取り']) expect(screen.getByRole('checkbox', { name: label })).toBeChecked();
  for (const label of ['架空編集の書き込み', '架空編集のAI作業', '架空編集の更新通知']) expect(screen.getByRole('checkbox', { name: label })).not.toBeChecked();
  expect(screen.queryByRole('checkbox', { name: '架空閲覧の書き込み' })).not.toBeInTheDocument();
  expect(screen.getByText(/今後追加されるプロジェクトの自動許可/)).toHaveTextContent('無効');
  expect(screen.getByText(/今回同意する対象/)).toHaveTextContent('書き込み：なし');
});
it('removes dependent permissions when read/write consent is unchecked and submits exact explicit choices', async () => {
  const fetch = vi.fn().mockImplementation(async (_url, options) => options.method === 'POST' ? new Response('{}', { status: 403 }) : multipleResponse());
  vi.stubGlobal('fetch', fetch); render(<Consent interaction="fixture-interaction" />);
  fireEvent.click(await screen.findByRole('checkbox', { name: '架空編集の読み取り' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '架空編集の書き込み' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '架空編集のAI作業' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '架空編集の更新通知' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '架空編集の書き込み' }));
  expect(screen.getByRole('checkbox', { name: '架空編集のAI作業' })).not.toBeChecked();
  fireEvent.click(screen.getByRole('checkbox', { name: '架空編集の読み取り' }));
  expect(screen.getByRole('checkbox', { name: '架空編集の更新通知' })).not.toBeChecked();
  fireEvent.click(screen.getByRole('checkbox', { name: '架空閲覧の読み取り' }));
  fireEvent.click(screen.getByRole('button', { name: '選択した範囲で30日間の接続を許可' }));
  await screen.findByRole('alert');
  expect(JSON.parse(fetch.mock.calls.find(call => call[1].method === 'POST')![1].body)).toEqual({ interaction: 'fixture-interaction', approve: true, consentVersion: 2, projectIds: ['viewer'], writeProjectIds: [], aiProjectIds: [], eventProjectIds: [], includeFutureProjects: false });
});
it('invalidates old selection immediately when the interaction changes', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(multipleResponse()).mockReturnValueOnce(new Promise(() => {}));
  vi.stubGlobal('fetch', fetch); const view = render(<Consent interaction="one" />);
  fireEvent.click(await screen.findByRole('checkbox', { name: '架空編集の読み取り' }));
  view.rerender(<Consent interaction="two" />);
  expect(screen.queryByRole('button', { name: '選択した範囲で30日間の接続を許可' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '架空通知のテストを許可' })).toBeDisabled();
});
