'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuthStore } from '@/stores/authStore';
import { completeMiniSignIn } from '@/lib/firebase/auth';
import { createMiniPairing, decryptMiniCredential, miniPairingCode, miniPairingFragment, type MiniPairing } from '@/lib/auth/miniPairing';

export function DesktopMiniLogin() {
  const loading = useAuthStore(state => state.isLoading);
  const [pairing, setPairing] = useState<MiniPairing | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    setPairing(null);
    setError('');
    setWaiting(false);
    void createMiniPairing().then(value => { if (!cancelled) setPairing(value); }).catch(() => {
      if (!cancelled) setError('接続を準備できませんでした。もう一度お試しください。');
    });
    return () => { cancelled = true; };
  }, [attempt, loading]);

  useEffect(() => {
    if (!pairing || !waiting) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (controller.signal.aborted) return;
      if (Date.now() >= pairing.request.expiresAt) {
        setError('接続の期限が切れました。「やり直す」から再開してください。');
        setWaiting(false); return;
      }
      try {
        const response = await fetch('/api/desktop-mini/auth', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', signal: controller.signal,
          body: JSON.stringify({ action: 'consume', id: pairing.request.id, secret: pairing.secret }),
        });
        const value = await response.json();
        if (!response.ok) throw new Error('Miniとの接続を確認できませんでした。やり直してください。');
        if (value.status === 'approved') {
          const credential = await decryptMiniCredential(pairing, value.envelope, value.uid);
          if (controller.signal.aborted) return;
          await completeMiniSignIn(credential.idToken, credential.uid);
          return;
        }
        timer = setTimeout(() => void poll(), 3000);
      } catch {
        if (!controller.signal.aborted) { setError('Miniにログインできませんでした。「やり直す」から再開してください。'); setWaiting(false); }
      }
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [pairing, waiting]);

  return <main className="flex min-h-screen items-center justify-center p-5"><Card>
    <CardHeader><CardTitle>TaskSlowth Miniにログイン</CardTitle><CardDescription>ブラウザで本人確認すると、このMiniに仕事が表示されます。</CardDescription></CardHeader>
    <CardContent className="space-y-3">
      {loading && <p role="status">ログイン状態を確認しています…</p>}
      {!loading && !pairing && !error && <p role="status">接続を準備しています…</p>}
      {pairing && <>
        <p>確認コード：<strong>{miniPairingCode(pairing.request)}</strong></p>
        <Button asChild><a href={`/desktop-mini/connect#${miniPairingFragment(pairing.request)}`} target="_blank" rel="noopener noreferrer" onClick={() => setWaiting(true)}>ブラウザでログイン</a></Button>
        {waiting && <p role="status">ブラウザに同じコードが表示されることを確認して接続してください。この画面は自動で切り替わります。</p>}
      </>}
      {error && <p role="alert">{error}</p>}
      {!loading && <Button variant="outline" onClick={() => setAttempt(value => value + 1)}>やり直す</Button>}
    </CardContent>
  </Card></main>;
}
