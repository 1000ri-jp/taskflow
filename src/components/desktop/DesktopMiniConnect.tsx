'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { encryptMiniCredential, miniPairingCode, parseMiniPairingFragment, validateMiniPairing, type MiniPairingRequest } from '@/lib/auth/miniPairing';
import { signInWithGoogleForMini } from '@/lib/firebase/auth';

export function DesktopMiniConnect() {
  const [request, setRequest] = useState<MiniPairingRequest | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    try { setRequest(parseMiniPairingFragment(window.location.hash)); }
    catch { setError('Miniの「ブラウザでログイン」から開いてください。接続の有効期限は5分です。'); }
  }, []);
  const connect = async () => {
    if (!request || !confirmed || busy || connected) return;
    setBusy(true); setError('');
    try {
      validateMiniPairing(request);
      // Google OAuth stays in the normal browser. Only its short-lived ID
      // credential is encrypted to the initiating Mini's ephemeral public key.
      const { user, googleIdToken } = await signInWithGoogleForMini();
      const envelope = await encryptMiniCredential(request, { idToken: googleIdToken, uid: user.uid });
      const response = await fetch('/api/desktop-mini/auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
        body: JSON.stringify({ action: 'approve', request, envelope }),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || 'Miniと接続できませんでした。');
      setConnected(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'ログインできませんでした。'); }
    finally { setBusy(false); }
  };
  return <main className="flex min-h-screen items-center justify-center p-5"><Card>
    <CardHeader><CardTitle>TaskSlowth Miniと接続</CardTitle><CardDescription>自分で開いたMiniだけを接続してください。</CardDescription></CardHeader>
    <CardContent className="space-y-3">
      {connected ? <p role="status">本人確認が完了しました。Miniに戻ってください。接続できない場合は、Miniの「やり直す」から再開できます。</p> : request && <>
        <p>確認コード：<strong>{miniPairingCode(request)}</strong></p>
        <label className="flex items-center gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />自分のMiniに同じコードが表示されています</label>
        <p>ログインしたアカウントの仕事を、このMiniでも表示・更新できるようにします。人から送られた接続リンクは承認しないでください。</p>
        <Button disabled={!confirmed || busy} onClick={() => void connect()}>{busy ? '接続中…' : 'Googleでログインして接続'}</Button>
      </>}
      {error && <p role="alert">{error}</p>}
    </CardContent>
  </Card></main>;
}
