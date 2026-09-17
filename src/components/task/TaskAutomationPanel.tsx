'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Task } from '@/types';
import { useAuthStore } from '@/stores/authStore';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { automationRequest } from '@/lib/task/automationClient';
import { CHECK_LABELS, STAGE_LABELS, type AutomationView, type TaskEvidenceRule } from '@/lib/task/automationTypes';
import { requiredChildrenState } from '@/lib/task/automationEngine';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export function TaskAutomationPanel({ task, tasks, users, compact = false }: { task: Task; tasks: Task[]; users: { id: string; displayName: string }[]; compact?: boolean }) {
  const uid = useAuthStore(s => s.user?.id);
  const [view, setView] = useState<AutomationView | null>(null);
  const [open, setOpen] = useState(false);
  const [loadStatus, setLoadStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<TaskEvidenceRule>(() => ({ projectId: task.projectId, taskId: task.id, enabled: true,
    subject: task.title, period: task.title.match(/\b20\d{2}\b/)?.[0] ?? (task.dueDate ?? task.startDate)?.getFullYear().toString() ?? '', person: users.find(u => u.id === task.assigneeIds[0])?.displayName ?? '', sender: '', criterion: 'purchase', allowExpectedDate: true, sources: ['gmail', 'comment'] }));
  const [editing, setEditing] = useState(false);
  const [policyDraft, setPolicyDraft] = useState<{ condition: string; required: { taskId: string; assigneeId: string }[]; expectedUpdatedAt: string } | null>(null);
  const condition = policyDraft?.condition ?? task.completionPolicy?.condition ?? task.description.split('完了条件：')[1]?.trim() ?? '';
  const selectedRequired = policyDraft?.required ?? task.completionPolicy?.required ?? [];
  const selected = selectedRequired.map(r => r.taskId);
  const taskUpdatedAt = task.updatedAt?.toISOString() ?? '';
  const editPolicy = (change: Partial<NonNullable<typeof policyDraft>>) => setPolicyDraft(previous => ({ condition, required: selectedRequired, expectedUpdatedAt: taskUpdatedAt, ...previous, ...change }));
  const operationLock = useRef(false);
  const [until, setUntil] = useState(''); const [mockText, setMockText] = useState('');
  const mock = isE2EMockAuthEnabled();
  const grant = view?.grants.find(g => g.rule.projectId === task.projectId && g.rule.taskId === task.id);
  const reminder = view?.reminders.find(r => r.projectId === task.projectId && r.taskId === task.id);
  const children = tasks.filter(t => t.projectId === task.projectId && t.parentTaskId === task.id && t.taskKind !== 'review_request' && !t.isArchived && !t.isAbandoned);
  const required = requiredChildrenState(task, tasks);
  const load = useCallback(async () => {
    try { const next = await automationRequest(); if (useAuthStore.getState().user?.id === uid) { setView(next); setError(''); setLoadStatus('ready'); } }
    catch (e) { setError(e instanceof Error ? e.message : '設定を取得できません。'); setLoadStatus('error'); }
  }, [uid]);
  useEffect(() => { void load(); window.addEventListener('taskflow-automation-updated', load); return () => window.removeEventListener('taskflow-automation-updated', load); }, [load]);
  const act = async (body: Record<string, unknown>): Promise<boolean> => {
    if (operationLock.current) return false;
    operationLock.current = true; setBusy(true); setError('');
    try {
      const next = await automationRequest(body);
      if (useAuthStore.getState().user?.id !== uid) return false;
      setView(next); setLoadStatus('ready'); window.dispatchEvent(new Event('taskflow-automation-updated')); window.dispatchEvent(new Event('taskflow-automation-request'));
      return true;
    } catch (e) { if (useAuthStore.getState().user?.id === uid) setError(e instanceof Error ? e.message : '反映できません。'); return false; }
    finally { operationLock.current = false; setBusy(false); }
  };
  const savePolicy = async (remove = false) => {
    if (!remove && selectedRequired.some(selected => {
      const child = children.find(t => t.id === selected.taskId);
      return !child || child.assigneeIds.length !== 1 || child.assigneeIds[0] !== selected.assigneeId;
    })) { setError('選択したサブタスク・担当が変わっています。入力を保持しています。現在のサブタスクを確認してください。'); return; }
    const saved = await act({ action: 'policy', projectId: task.projectId, taskId: task.id,
      expectedUpdatedAt: policyDraft?.expectedUpdatedAt ?? taskUpdatedAt,
      policy: remove ? null : { condition, required: selectedRequired } });
    if (saved) setPolicyDraft(null);
  };
  if (task.parentTaskId || task.taskKind === 'review_request' || task.isArchived || task.isAbandoned) return null;
  const settingStatus = loadStatus === 'error' ? '取得不可' : loadStatus === 'loading' ? '取得中' : grant?.rule.enabled || task.completionPolicy ? '設定済み' : '未設定';
  const Settings = compact ? 'div' : 'details';
  const content = <section aria-label="根拠からの自動更新" className={compact ? 'space-y-3 text-sm' : 'space-y-3 rounded-xl border p-3 text-sm'}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">{compact ? '自動確認の設定' : '根拠からの自動更新'}</h3>
      {(grant?.rule.enabled || task.completionPolicy) && <Button size="sm" variant="outline" disabled={busy} onClick={() => void act({ action: 'run' })}>確認を更新</Button>}
    </div>
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    {task.automation && <p>{task.automation.stage ? STAGE_LABELS[task.automation.stage] : '完了の根拠は未確認'} <span className="text-xs text-muted-foreground">・{CHECK_LABELS[task.automation.check]}</span></p>}
    {grant && <p className="text-xs text-muted-foreground">{grant.reason}{grant.checkedAt && `（確認 ${new Date(grant.checkedAt).toLocaleString('ja-JP')}）`}</p>}
    {required && <div className="space-y-2"><p className="font-medium">完了条件：{task.completionPolicy!.condition}</p>
      <ul className="space-y-2">{required.rows.map(row => <li key={row.taskId} className="flex flex-wrap justify-between gap-x-3 gap-y-1"><span>{users.find(u => u.id === row.assigneeId)?.displayName ?? '担当者'}：{row.complete ? '完了確認済み' : '完了をまだ確認できません'}</span>
        {!row.complete && <span className="text-xs text-muted-foreground">{row.task?.automation ? CHECK_LABELS[row.task.automation.check] : '完了チェックはまだ付いていません'}</span>}</li>)}</ul>
      {!required.complete && <p className="text-xs text-muted-foreground">必要なサブタスクの完了チェックで判定します。</p>}
      {reminder && !required.complete && <div className="space-y-2 rounded-lg bg-muted/40 p-2">
        <p className="text-xs">期限前日から未確認分を通知します。{reminder.snoozedUntil && `次の確認：${new Date(reminder.snoozedUntil).toLocaleString('ja-JP')}`}</p>
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => void act({ action: 'reminder', projectId: task.projectId, taskId: task.id, until: null })}>再通知</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void act({ action: 'reminder', projectId: task.projectId, taskId: task.id, until: new Date(Date.now() + 3600000).toISOString() })}>1時間後</Button>
          <Input type="datetime-local" aria-label="再通知の時刻" className="w-auto max-w-full" value={until} onChange={e => setUntil(e.target.value)} />
          <Button size="sm" variant="outline" disabled={busy || !until} onClick={() => void act({ action: 'reminder', projectId: task.projectId, taskId: task.id, until: new Date(until).toISOString() })}>時刻を指定</Button>
        </div>
      </div>}
    </div>}
    <Settings>{!compact && <summary className="cursor-pointer text-xs text-muted-foreground">{grant || task.completionPolicy ? '任せる条件・履歴' : '自動で確認する条件を設定'}</summary>}
      <div className={compact ? 'space-y-3' : 'mt-3 space-y-3'}>
        <p className="text-xs text-muted-foreground">自分が許可したGmailと自分のコメントを照合します。代理購入は対象者の名前が明記された根拠だけを扱います。メール本文は共有されません。</p>
        {grant?.rule.order && <div className="space-y-2"><p className="text-sm">{grant.rule.order.merchant} · {grant.rule.order.item}（{grant.rule.order.orderNumber}）</p><p className="text-xs">発送と到着予定を追跡します。期限・完了は変更しません。</p><Button size="sm" variant="outline" disabled={busy} onClick={()=>void act({action:'save',revision:view?.revision,rule:{...grant.rule,enabled:!grant.rule.enabled}})}>{grant.rule.enabled?'メールの追跡を止める':'メールの追跡を始める'}</Button></div>}
        {!grant?.rule.order && task.assigneeIds.length === 1 && <>
          {!editing ? <Button size="sm" variant="outline" disabled={!view} onClick={() => { if (grant) setForm(grant.rule); setEditing(true); }}>{grant ? '条件を変更・任せ直す' : 'このタスクの確認を任せる'}</Button> : <form className="space-y-2" onSubmit={e => { e.preventDefault(); void act({ action: 'save', revision: view?.revision, rule: { ...form, enabled: true } }).then(saved => { if (saved) setEditing(false); }); }}>
            <label className="block text-xs">商品・イベント名<Input required value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} placeholder="秋の展示会" /></label>
            <label className="block text-xs">対象の年・期間・注文番号<Input required value={form.period} onChange={e => setForm({ ...form, period: e.target.value })} placeholder="2026、または一意の注文番号" /></label>
            <label className="block text-xs">根拠に記載される対象者の名前<Input required value={form.person} onChange={e => setForm({ ...form, person: e.target.value })} /></label>
            <label className="block text-xs">購入先の送信元メールアドレス<Input type="email" required={form.sources.includes('gmail')} value={form.sender} onChange={e => setForm({ ...form, sender: e.target.value })} placeholder="tickets@example.jp" /></label>
            <label className="block text-xs">完了にする条件<select className="mt-1 w-full rounded-md border bg-background p-2 text-sm" value={form.criterion} onChange={e => setForm({ ...form, criterion: e.target.value as TaskEvidenceRule['criterion'] })}><option value="purchase">購入・必要な支払が完了</option><option value="registration">登録完了</option><option value="receipt">受取・配達完了</option></select></label>
            <div className="flex flex-wrap gap-3">{(['gmail', 'comment'] as const).map(source => <label key={source} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={form.sources.includes(source)} onChange={e => setForm({ ...form, sources: e.target.checked ? [...form.sources, source] : form.sources.filter(s => s !== source) })} />{source === 'gmail' ? '自分のGmail' : '自分のコメント'}</label>)}</div>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.allowExpectedDate} onChange={e => setForm({ ...form, allowExpectedDate: e.target.checked })} />到着予定が明記されたらタスクの日付も更新する</label>
            <p className="text-xs text-muted-foreground">明確な完了表現を照合します。曖昧な文章・取得漏れ・取消の疑いがある時は未確認に残します。</p>
            <Button size="sm" type="submit" disabled={busy || !view}>この条件で自動更新を許可</Button>
          </form>}
          {grant?.rule.enabled && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act({ action: 'save', revision: view?.revision, rule: { ...grant.rule, enabled: false } })}>自動更新を解除</Button>}
        </>}
        {(children.length > 0 || task.completionPolicy || policyDraft) && <details><summary className="cursor-pointer text-xs">全員分がそろったら親も完了する</summary><div className="mt-2 space-y-2">
          <label className="block text-xs">全員分の明示的な完了条件<Textarea value={condition} onChange={e => editPolicy({ condition: e.target.value })} placeholder="必要な全員が購入・支払を完了した" /></label>
          <p className="text-xs">必要なサブタスクを選択</p>
          {children.filter(t => t.assigneeIds.length === 1).map(child => <label key={child.id} className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={selected.includes(child.id)} onChange={e => editPolicy({ required: e.target.checked ? [...selectedRequired, { taskId: child.id, assigneeId: child.assigneeIds[0] }] : selectedRequired.filter(r => r.taskId !== child.id) })} /><span>{child.title}</span></label>)}
          {selectedRequired.filter(r => !children.some(child => child.id === r.taskId)).map(r => <label key={r.taskId} className="flex items-center gap-2 text-xs text-amber-700"><input type="checkbox" checked onChange={() => editPolicy({ required: selectedRequired.filter(selected => selected.taskId !== r.taskId) })} />選択していたサブタスク（現在参照できません）</label>)}
          {policyDraft && policyDraft.expectedUpdatedAt !== taskUpdatedAt && <div className="rounded border border-amber-200 p-2 text-xs">
            <p>親タスクが更新されました。入力中の条件は保持しています。</p>
            <p className="mt-1 break-words">現在の完了条件：{task.completionPolicy?.condition ?? '未設定'}</p>
            <p className="mt-1">現在の対象：{task.completionPolicy?.required.map(r => users.find(u => u.id === r.assigneeId)?.displayName ?? '担当者名は未取得').join('・') || '未設定'}</p>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => { editPolicy({ expectedUpdatedAt: taskUpdatedAt }); setError(''); }}>現在の内容を確認して入力を続ける</Button>
          </div>}
          <Button size="sm" disabled={busy || !condition.trim() || !selected.length} onClick={() => void savePolicy()}>この全員条件の自動判定を許可</Button>
          {task.completionPolicy && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void savePolicy(true)}>全員条件を解除</Button>}
        </div></details>}
        {grant && <ul className="space-y-2">{grant.records.slice(-5).reverse().map(record => <li key={record.id} className="rounded-md bg-muted/40 p-2 text-xs"><div>{STAGE_LABELS[record.stage]} ・根拠 {new Date(record.evidenceAt).toLocaleString('ja-JP')}</div><div className="flex flex-wrap items-center gap-3 text-muted-foreground"><span>反映 {new Date(record.at).toLocaleString('ja-JP')}</span><a className="underline" href={record.sourceUrl} target="_blank" rel="noreferrer">本人用の根拠</a>{!record.undone && grant.records.at(-1)?.id === record.id && <Button variant="ghost" size="sm" disabled={busy} onClick={() => void act({ action: 'undo', projectId: task.projectId, taskId: task.id, revision: view?.revision, recordId: record.id })}>反映を戻す</Button>}{record.undone && <span>取消済み</span>}</div></li>)}</ul>}
        <p className="text-xs text-muted-foreground">{view?.backgroundConfigured ? 'アプリを閉じている間も、設定済みの定期実行で確認します。' : '現在はアプリを開いている間と「確認を更新」で実行。閉じている間の定期実行は外部設定が必要です。'}</p>
        {mock && grant && <details><summary className="cursor-pointer text-xs text-amber-800">隔離テスト：架空の根拠を追加</summary><Textarea aria-label="架空の根拠" value={mockText} onChange={e => setMockText(e.target.value)} placeholder={`${grant.rule.subject} ${grant.rule.period} ${grant.rule.person} 購入完了`} /><Button size="sm" disabled={busy || !mockText} onClick={() => void act({ action: 'evidence', evidence: { id: crypto.randomUUID(), version: mockText, source: 'gmail', at: new Date().toISOString(), text: mockText, sender: grant.rule.sender, authorId: uid, url: '#mock-evidence' } })}>架空のメールを照合</Button></details>}
      </div>
    </Settings>
  </section>;
  if (!compact) return content;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button size="sm" variant="outline" className="h-8 gap-2 px-2" aria-label={`自動確認：${settingStatus}`}><span>自動確認</span><span className="text-xs text-muted-foreground">{settingStatus}</span></Button></PopoverTrigger>
    <PopoverContent align="end" aria-label="自動確認の設定" className="max-h-[min(70dvh,640px)] w-[min(480px,calc(100vw-2rem))] overflow-y-auto overscroll-contain p-3">{content}</PopoverContent>
  </Popover>;
}
