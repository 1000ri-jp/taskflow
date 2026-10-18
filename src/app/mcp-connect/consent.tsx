'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { SettingsLayout } from '@/components/ui/screen-layouts';
import { settingSelect, settingSelectionRow } from '@/components/ui/setting-field';
import { PageHeading, Prose } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

type ConsentProject = { id: string; name: string; canWrite?: boolean; canWork?: boolean; canNotify?: boolean };
type ConsentData = { uid: string; interaction: string; taskScopes: string[]; mode: 'test' | 'production'; client: 'chatgpt' | 'claude-code' | 'claude'; redirectHost?: string; projects: ConsentProject[]; consentVersion?: number; maxProjects: number };

export default function Consent({ interaction }: { interaction: string }) {
  const { firebaseUser, isLoading, signInForMcp } = useAuth();
  const [data, setData] = useState<ConsentData | null>(null);
  const [projectId, setProjectId] = useState('');
  const [readIds, setReadIds] = useState<string[]>([]);
  const [writeIds, setWriteIds] = useState<string[]>([]);
  const [aiIds, setAiIds] = useState<string[]>([]);
  const [eventIds, setEventIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const ready = data?.uid === firebaseUser?.uid && data?.interaction === interaction && Boolean(data);
  const taskRead = ready && data?.taskScopes.includes('tasks:read');
  const taskWrite = ready && data?.taskScopes.includes('tasks:write');
  const production = ready && data?.mode === 'production';
  const multiple = ready && data?.consentVersion === 2;
  const claudeCode = ready && data?.client === 'claude-code';
  const claude = ready && (data?.client === 'claude' || claudeCode);
  const clientName = claudeCode ? 'Claude Code' : claude ? 'Claude' : 'ChatGPT';
  const selectedNames = (ids: string[]) => data?.projects.filter(p => ids.includes(p.id)).map(p => p.name).join('、') || 'なし';
  function toggleRead(id: string, checked: boolean) {
    setReadIds(ids => checked ? [...ids, id] : ids.filter(value => value !== id));
    if (!checked) { setWriteIds(ids => ids.filter(value => value !== id)); setAiIds(ids => ids.filter(value => value !== id)); setEventIds(ids => ids.filter(value => value !== id)); }
  }
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
        if (active) {
          setData({ uid: firebaseUser.uid, interaction, taskScopes: Array.isArray(result.taskScopes) ? result.taskScopes : [], mode: result.mode === 'production' ? 'production' : 'test', client: result.client === 'claude-code' ? 'claude-code' : result.client === 'claude' ? 'claude' : 'chatgpt', redirectHost: result.redirectHost, projects: result.projects, consentVersion: result.consentVersion, maxProjects: result.maxProjects ?? 500 });
          setProjectId(''); setReadIds([]); setWriteIds([]); setAiIds([]); setEventIds([]); setError('');
        }
      } catch { if (active) { setData(null); setError('接続を確認できません。SlowthのGoogleアカウントで再ログインしてください。認可画面の期限が切れている場合は、接続元のアプリからやり直してください。'); } }
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
        body: JSON.stringify({ interaction, approve, ...(multiple ? { consentVersion: 2, projectIds: readIds,
          writeProjectIds: writeIds, aiProjectIds: aiIds, eventProjectIds: eventIds, includeFutureProjects: false } : { projectId }) }),
      });
      if (!response.ok) throw new Error();
      const result = await response.json();
      const next = new URL(result.redirect);
      if (next.origin !== window.location.origin || !next.pathname.startsWith('/api/oidc/')) throw new Error();
      window.location.assign(next.href);
    } catch { setError('接続を完了できません。接続元のアプリからやり直してください。'); setBusy(false); }
  }
  return <main className="mx-auto max-w-lg">
    <Card density="compact"><CardContent><SettingsLayout align="start">
    <PageHeading>{ready ? `${clientName}との接続確認` : '接続確認'}</PageHeading>
    <Prose>{!ready ? '接続許可の内容を確認中…' : multiple
      ? `選択したプロジェクトのタスク全項目・コメント・確認依頼と回答・サブタスク・チェックリスト・添付・共有履歴を${clientName}が読み取り、進捗を確認できます。認証は自動更新され、有効期間は最大30日間です。書き込み・AI作業${claude ? '' : '・更新通知'}は、下で個別に選んだプロジェクトだけに許可します。` + (taskWrite ? '書き込みには作成・編集・削除、確認への回答、完了・アーカイブ・復元を含みます。' : '') + `個人のメール本文は対象外です。${claude ? '' : 'ChatGPTで接続を解除できます。'}`
      : taskRead
      ? `「タスク管理ツール」のタスク全項目・コメント・確認依頼と回答・サブタスク・チェックリスト・添付・共有履歴を${clientName}が読み取ります。${taskWrite ? '作成、編集、確認への回答、完了、アーカイブと復元、繰り返し設定も許可します。操作はこのGoogleアカウントの権限で記録します。' : ''}${claude ? '' : '更新通知も継続します。'}有効期間は最大30日間です。個人のメール本文や他のプロジェクトにはアクセスしません。${claude ? '' : 'ChatGPTで接続を解除すると停止できます。'}`
      : production
      ? claude ? `${clientName}との接続を最大30日間許可します。タスク操作には追加の読み取り同意が必要です。更新通知は対象外です。` : '「タスク管理ツール」のタスク作成・変更・削除について、タイトルと完了状態をChatGPTのDotへ通知します。接続は最大30日間有効で、認証は自動更新されます。タスクの変更や他のプロジェクトへのアクセスは許可しません。ChatGPTで接続を解除すると通知を停止できます。'
      : '選択した1つのプロジェクトで、架空のタスク更新通知をテストします。有効期間は最大15分です。実タスクの読み取り・変更や、実際の更新通知は許可しません。'}</Prose>
    {ready && data?.redirectHost && <Prose>接続先のホスト：{data.redirectHost}</Prose>}
    {error && <Prose role="alert">{error}</Prose>}
    {isLoading ? <Prose>ログイン状態を確認中…</Prose> : !firebaseUser ?
      <Button className="w-full" onClick={reconnect} disabled={busy}>SlowthのGoogleアカウントでログイン</Button> : <>
        <Prose>接続するアカウント：{firebaseUser.email}</Prose>
        {error && !ready && <Button className="w-full" disabled={busy} onClick={reconnect}>SlowthのGoogleアカウントで再ログイン</Button>}
        {multiple ? <SettingsLayout align="start">
          <Prose>読み取り対象を選択してください。全件選択は、現在表示されているプロジェクトだけが対象です。</Prose>
          {!taskWrite && <Prose role="note">接続元が書き込み権限（tasks:write）を要求していないため、この接続では書き込みを選べません。書き込みが必要な場合は、接続元で接続を解除してから接続し直してください。</Prose>}
          <Button variant="outline" disabled={busy || !data?.projects.length || data.projects.length > data.maxProjects} onClick={() => setReadIds(data!.projects.map(p => p.id))}>現在閲覧できる全件を読み取り対象にする</Button>
          <Button variant="outline" disabled={busy || !readIds.length} onClick={() => { setReadIds([]); setWriteIds([]); setAiIds([]); setEventIds([]); }}>選択を解除</Button>
          {data!.projects.map(p => <Card key={p.id} density="compact"><CardContent><SettingsLayout align="start">
            <label className={settingSelectionRow}><Checkbox checked={readIds.includes(p.id)} disabled={busy} onCheckedChange={value => toggleRead(p.id, value === true)} aria-label={p.name + 'の読み取り'} />{p.name}：読み取り</label>
            <Prose className="break-all">{p.id}</Prose>
            {taskWrite && p.canWrite && <label className={settingSelectionRow}><Checkbox checked={writeIds.includes(p.id)} disabled={busy || !readIds.includes(p.id)} aria-label={p.name + 'の書き込み'} onCheckedChange={value => {
              setWriteIds(ids => value === true ? [...ids, p.id] : ids.filter(id => id !== p.id));
              if (value !== true) setAiIds(ids => ids.filter(id => id !== p.id));
            }} />タスク・子リソースの作成と変更を許可</label>}
            {taskWrite && !p.canWrite && <Prose>書き込み：選べません（閲覧専用、またはAI利用設定で対象外のプロジェクト）</Prose>}
            {taskWrite && p.canWork && <label className={settingSelectionRow}><Checkbox checked={aiIds.includes(p.id)} disabled={busy || !writeIds.includes(p.id)} aria-label={p.name + 'のAI作業'} onCheckedChange={value => setAiIds(ids => value === true ? [...ids, p.id] : ids.filter(id => id !== p.id))} />AIの計画・作業委任を許可</label>}
            {!claude && p.canNotify && <label className={settingSelectionRow}><Checkbox checked={eventIds.includes(p.id)} disabled={busy || !readIds.includes(p.id)} aria-label={p.name + 'の更新通知'} onCheckedChange={value => setEventIds(ids => value === true ? [...ids, p.id] : ids.filter(id => id !== p.id))} />タスク更新通知を許可</label>}
          </SettingsLayout></CardContent></Card>)}
          {!data?.projects.length && <Prose>現在選択できるプロジェクトはありません。</Prose>}
          {data!.projects.length > data!.maxProjects && <Prose role="alert">一度に許可できる対象は{data!.maxProjects}件です。省略せず、対象を個別に選択してください。</Prose>}
          <Prose>今後追加されるプロジェクトの自動許可：無効。対象追加には新しい接続での再同意が必要です。既存接続の許可は変更しません。AI作業は、この同意に加えて各プロジェクトのAI設定・実行環境の許可も必要です。{claude ? '' : '更新通知は現在の承認済みpilotだけで利用できます。'}</Prose>
          <Prose aria-live="polite">今回同意する対象：{readIds.length}件{'\n'}読み取り：{selectedNames(readIds)}{'\n'}書き込み：{selectedNames(writeIds)}{'\n'}AI作業：{selectedNames(aiIds)}{claude ? '' : `\n更新通知：${selectedNames(eventIds)}`}</Prose>
        </SettingsLayout> : <label className="block">{taskRead ? 'タスク操作のプロジェクト' : production ? '継続通知のプロジェクト' : '通知テストのプロジェクト'}
          <select className={cn(settingSelect, 'block w-full')} value={projectId} onChange={e => setProjectId(e.target.value)} disabled={!ready || busy}>
            <option value="">選択してください</option>
            {data?.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>}
        <SettingsLayout align="start">
          <Button className="w-full" disabled={!ready || (multiple ? !readIds.length || readIds.length > data!.maxProjects : !projectId) || busy} onClick={() => decide(true)}>{multiple ? '選択した範囲で30日間の接続を許可' : taskWrite ? '30日間のタスク読み書きを許可' : taskRead ? '30日間のタスク読み取りを許可' : production ? '30日間のタスク通知を許可' : '架空通知のテストを許可'}</Button>
          <Button className="w-full" variant="outline" disabled={!ready || busy} onClick={() => decide(false)}>許可しない</Button>
        </SettingsLayout>
      </>}
    </SettingsLayout></CardContent></Card>
  </main>;
}
