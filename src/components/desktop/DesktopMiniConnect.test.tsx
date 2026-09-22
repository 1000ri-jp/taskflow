import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
const f = vi.hoisted(() => ({ parse: vi.fn(), encrypt: vi.fn(), login: vi.fn(), fetch: vi.fn() }));
vi.mock('@/lib/auth/miniPairing', () => ({ parseMiniPairingFragment: f.parse, miniPairingCode: () => 'ABCD-1234', validateMiniPairing: vi.fn(), encryptMiniCredential: f.encrypt }));
vi.mock('@/lib/firebase/auth', () => ({ signInWithGoogleForMini: f.login }));
import { DesktopMiniConnect } from './DesktopMiniConnect';
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('fetch', f.fetch);
  f.parse.mockReturnValue({ id: 'pairing' }); f.encrypt.mockResolvedValue({ ciphertext: 'encrypted-only' });
  f.login.mockResolvedValue({ user: { uid: 'u1', getIdToken: async () => 'firebase-proof' }, googleIdToken: 'never-send-plain-google-proof' });
  f.fetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'approved' }) });
});
describe('browser Mini confirmation', () => {
  it('requires explicit code confirmation before Google sign-in or approval', async () => {
    render(<DesktopMiniConnect />);
    const connect = await screen.findByRole('button', { name: 'Googleでログインして接続' });
    expect(connect).toBeDisabled(); expect(f.login).not.toHaveBeenCalled(); expect(f.fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(connect);
    await screen.findByText(/本人確認が完了しました/);
    expect(f.login).toHaveBeenCalledOnce();
    const options = f.fetch.mock.calls[0][1];
    expect(options.body).toContain('encrypted-only'); expect(options.body).not.toContain('never-send-plain-google-proof');
  });
  it('leaves a recoverable message when login or approval fails', async () => {
    f.login.mockRejectedValue(new Error('ログインを中止しました'));
    render(<DesktopMiniConnect />);
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Googleでログインして接続' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('ログインを中止しました'));
    expect(f.fetch).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Googleでログインして接続' })).toBeEnabled();
  });
});
