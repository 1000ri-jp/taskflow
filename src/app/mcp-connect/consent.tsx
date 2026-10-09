'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SettingsLayout } from '@/components/ui/screen-layouts';
import { settingSelect } from '@/components/ui/setting-field';
import { PageHeading, Prose } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

export default function Consent({ interaction }: { interaction: string }) {
  const { firebaseUser, isLoading, signInForMcp } = useAuth();
  const [data, setData] = useState<{ uid: string; taskScopes: string[]; mode: 'test' | 'production'; projects: { id: string; name: string }[] } | null>(null);
  const [projectId, setProjectId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const ready = data?.uid === firebaseUser?.uid && Boolean(data);
  const taskRead = ready && data?.taskScopes.includes('tasks:read');
  const taskWrite = ready && data?.taskScopes.includes('tasks:write');
  const production = ready && data?.mode === 'production';
  useEffect(() => {
    let active = true;
    if (!firebaseUser) return;
    (async () => {
      try {
        const response = await fetch('/mcp-connect/consent?interaction=' + encodeURIComponent(interaction), {
          headers: { Authorization: 'Bearer ' + await firebaseUser.getIdToken(true) }, cache: 'no-store',
        });
        if (!response.ok) throw new Error();
        const result = await response.json();
        if (active) { setData({ uid: firebaseUser.uid, taskScopes: Array.isArray(result.taskScopes) ? result.taskScopes : [], mode: result.mode === 'production' ? 'production' : 'test', projects: result.projects }); setProjectId(''); setError(''); }
      } catch { if (active) { setData(null); setError('接続を確認できません。SlowthのGoogleアカウントで再ログインしてください。認可画面の期限が切れている場合は、ChatGPTからやり直してください。'); } }
    })();
    return () => { active = false; };
  }, [firebaseUser, interaction, attempt]);
  async function reconnect() {
    if (busy) return;
    setBusy(true);
    try { await signInForMcp(); setAttempt(value => value + 1); }
    catch { setError('Googleログインを完了できませんでした。'); }
    finally { setBusy(false); }
  }
  async function decide(approve: boolean) {
    if (!firebaseUser || busy || !ready) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/mcp-connect/consent', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await firebaseUser.getIdToken(true) },
        body: JSON.stringify({ interaction, approve, projectId }),
      });
      if (!response.ok) throw new Error();
      const result = await response.json();
      const next = new URL(result.redirect);
      if (next.origin !== window.location.origin || !next.pathname.startsWith('/api/oidc/')) throw new Error();
      window.location.assign(next.href);
    } catch { setError('接続を完了できません。ChatGPTからやり直してください。'); setBusy(false); }
  }
  return <main className="mx-auto max-w-lg">
    <Card density="compact"><CardContent><SettingsLayout align="start">
    <PageHeading>ChatGPTとの接続確認</PageHeading>
    <Prose>{!ready ? '接続許可の内容を確認中…' : taskRead
      ? `「タスク管理ツール」のタスク全項目・コメント・確認依頼と回答・サブタスク・チェックリスト・添付・共有履歴をChatGPTが読み取ります。${taskWrite ? '作成、編集、確認への回答、完了、アーカイブと復元、繰り返し設定も許可します。操作はこのGoogleアカウントの権限で記録します。' : ''}更新通知も継続します。有効期間は最大30日間です。個人のメール本文や他のプロジェクトにはアクセスしません。ChatGPTで接続を解除すると停止できます。`
      : production
      ? '「タスク管理ツール」のタスク作成・変更・削除について、タイトルと完了状態をChatGPTのDotへ通知します。接続は最大30日間有効で、認証は自動更新されます。タスクの変更や他のプロジェクトへのアクセスは許可しません。ChatGPTで接続を解除すると通知を停止できます。'
      : '選択した1つのプロジェクトで、架空のタスク更新通知をテストします。有効期間は最大15分です。実タスクの読み取り・変更や、実際の更新通知は許可しません。'}</Prose>
    {error && <Prose role="alert">{error}</Prose>}
    {isLoading ? <Prose>ログイン状態を確認中…</Prose> : !firebaseUser ?
      <Button className="w-full" onClick={reconnect} disabled={busy}>SlowthのGoogleアカウントでログイン</Button> : <>
        <Prose>接続するアカウント：{firebaseUser.email}</Prose>
        {error && !ready && <Button className="w-full" disabled={busy} onClick={reconnect}>SlowthのGoogleアカウントで再ログイン</Button>}
        <label className="block">{taskRead ? 'タスク操作のプロジェクト' : production ? '継続通知のプロジェクト' : '通知テストのプロジェクト'}
          <select className={cn(settingSelect, 'block w-full')} value={projectId} onChange={e => setProjectId(e.target.value)} disabled={!ready || busy}>
            <option value="">選択してください</option>
            {data?.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <SettingsLayout align="start">
          <Button className="w-full" disabled={!ready || !projectId || busy} onClick={() => decide(true)}>{taskWrite ? '30日間のタスク読み書きを許可' : taskRead ? '30日間のタスク読み取りを許可' : production ? '30日間のタスク通知を許可' : '架空通知のテストを許可'}</Button>
          <Button className="w-full" variant="outline" disabled={!ready || busy} onClick={() => decide(false)}>許可しない</Button>
        </SettingsLayout>
      </>}
    </SettingsLayout></CardContent></Card>
  </main>;
}
