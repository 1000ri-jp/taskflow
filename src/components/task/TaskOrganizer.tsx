'use client';

import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { PreviewChanges } from './PreviewChanges';
export { PreviewChanges } from './PreviewChanges';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { MovableDialogContent } from '@/components/ui/movable-dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAISettingsStore } from '@/stores/aiSettingsStore';
import { requestOrganization } from '@/lib/task/organizationClient';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { organizationLabels, type OrganizationReconsideration, type OrganizationAnalysis, type OrganizationMultiAnalysis, type OrganizationContext, type OrganizationDraft, type OrganizationPreview, type OrganizationSource } from '@/lib/task/organizationTypes';
import { DraftComparison, draftTitle, OrganizationDraftEditor, type OrganizationTaskOption } from './OrganizationDraftEditor';

type Props = { projectId?: string; projects?: { id: string; name: string }[]; projectName?: string; tasks: OrganizationTaskOption[]; source?: OrganizationSource; initialDraft?: OrganizationDraft; initialRecord?: OrganizationPreview; label?: string; disabled?: boolean; open?: boolean; onOpenChange?: (open: boolean) => void; notice?: ReactNode };
type Row = { id: number; projectId: string; requiresBasis?: boolean; draft: OrganizationDraft; sourceKey: string; basis?: OrganizationAnalysis['basis']; selected: boolean; confirmed: boolean; preview?: OrganizationPreview; beforeTasks?: OrganizationTaskOption[]; state: 'ready' | 'applied' | 'held' | 'skipped' | 'failed'; clarifications?: string[]; error?: string; stale?: boolean };
const statusLabels = { pending: '反映前', held: '保留', applied: '反映済み', undone: '取消済み', skipped: '見送り' };
const emptyContext: OrganizationContext = { members: [], lists: [] };
const recordKey = (preview: OrganizationPreview) => JSON.stringify([preview.projectId, preview.id]);
const emptySource: OrganizationSource = { kind: 'manual', id: 'manual', title: '手入力のメモ', text: '', occurredAt: null };
const emptyDraft = (): OrganizationDraft => ({ kind: 'update', taskIds: [], reason: '本人が内容と反映先を指定', quote: '', description: '' });
const sourceKey = (source: OrganizationSource) => JSON.stringify(source);
const needsConfirmation = (draft: OrganizationDraft) => !!draft.confirmationPoints?.length || ['tentative', 'idea'].includes(draft.speech ?? '');
const errorText = (error: unknown) => error instanceof Error ? error.message : '取得・反映できませんでした。';
const conflict = (error: unknown) => error !== null && typeof error === 'object' && 'status' in error && error.status === 409;
const dateInput = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(Date.parse(value) + 9 * 3600000).toISOString().slice(0, 16) : '';

export function TaskOrganizer(props: Props) {
  // An external project/source change must unmount all old previews and pending callbacks.
  return <OrganizerSession key={JSON.stringify([props.projectId, props.projects?.map(project => project.id).sort(), props.source, props.initialDraft, props.initialRecord?.id])} {...props} />;
}

function OrganizerSession({ projectId, projects, projectName, tasks, source: initialSource = emptySource, initialDraft, initialRecord, label = '仕事を整理・反映', disabled = false, open: controlledOpen, onOpenChange, notice }: Props) {
  const multi = projects !== undefined;
  const scopes = projects ?? (projectId ? [{ id: projectId, name: projectName ?? projectId }] : []);
  const projectIds = [...new Set(scopes.map(project => project.id))];
  const defaultProjectId = projectId ?? projectIds[0] ?? '';
  const projectLabel = (id: string) => scopes.find(project => project.id === id)?.name ?? id;
  const projectTasks = (id: string) => tasks.filter(task => task.projectId === id || !multi && !task.projectId);
  const rowProjects = useRef<Record<number, string>>(initialDraft ? { 0: defaultProjectId } : {});
  const [bases, setBases] = useState<OrganizationMultiAnalysis['bases']>({});
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = onOpenChange ?? setLocalOpen;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [source, setSource] = useState(initialSource);
  const currentSource = useRef(sourceKey(initialSource));
  const active = useRef(true);
  const locked = useRef(false);
  const nextId = useRef(1);
  const [rows, setRows] = useState<Row[]>(initialDraft ? [{ id: 0, projectId: defaultProjectId, draft: initialDraft, sourceKey: sourceKey(initialSource), selected: false, confirmed: false, state: 'ready' }] : []);
  const [issues, setIssues] = useState<string[]>([]);
  const [analyzed, setAnalyzed] = useState(false);
  const [contexts, setContexts] = useState<Record<string, OrganizationContext>>({});
  const [contextErrors, setContextErrors] = useState<Record<string, string>>({});
  const contextReady = projectIds.some(id => !!contexts[id]);
  const [records, setRecords] = useState<OrganizationPreview[]>([]);
  const [record, setRecord] = useState<OrganizationPreview | null>(initialRecord ?? null);
  const [original, setOriginal] = useState<OrganizationSource | null>(null);
  const provider = useAISettingsStore(state => state.provider);
  const model = useAISettingsStore(state => state.getActiveModel());
  const mock = isE2EMockAuthEnabled();
  const key = sourceKey(source);
  const mayWrite = !disabled && contextReady && !busy;
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const updateRow = (id: number, patch: Partial<Row>) => { if (active.current) setRows(values => values.map(row => row.id === id ? { ...row, ...patch } : row)); };
  const remember = (preview: OrganizationPreview) => { if (active.current) setRecords(values => [...values.filter(item => recordKey(item) !== recordKey(preview)), preview]); };
  const changeSource = (next: OrganizationSource) => {
    currentSource.current = sourceKey(next); setSource(next); setBases({}); setIssues([]); setAnalyzed(false); setRecord(null); setOriginal(null); setError('');
    setRows(values => values.map(row => ['applied', 'held', 'skipped'].includes(row.state) ? row : { ...row, basis: undefined, preview: undefined, selected: false, confirmed: false, stale: true }));
  };
  const work = async (run: () => Promise<void>) => {
    if (locked.current || disabled) return;
    locked.current = true; setBusy(true); setError('');
    try { await run(); } catch (reason) { if (active.current) setError(errorText(reason)); }
    finally { locked.current = false; if (active.current) setBusy(false); }
  };
  const refreshContext = async () => {
    const results = await Promise.all(projectIds.map(async id => ({ id, result: await Promise.allSettled([
      requestOrganization<OrganizationContext>({ action: 'context', projectId: id }),
      requestOrganization<OrganizationPreview[]>({ action: 'list', projectId: id }),
    ]) })));
    if (!active.current) return;
    const nextContexts: Record<string, OrganizationContext> = {};
    const failures: Record<string, string> = {};
    const histories: OrganizationPreview[] = [];
    for (const { id, result } of results) {
      if (result[0].status === 'fulfilled') nextContexts[id] = result[0].value;
      else failures[id] = errorText(result[0].reason);
      if (result[1].status === 'fulfilled') histories.push(...result[1].value.filter(item => item.projectId === id));
      else failures[id] = [failures[id], `記録を取得できません：${errorText(result[1].reason)}`].filter(Boolean).join(' ');
    }
    setContexts(nextContexts); setContextErrors(failures);
    setRecord(current => current ? histories.find(item => recordKey(item) === recordKey(current)) ?? null : null);
    setRecords(values => [...values.filter(item => results.some(result => result.id === item.projectId && result.result[1].status === 'rejected')), ...histories]);
  };
  const refreshOnOpen = useEffectEvent(() => { void work(refreshContext); });
  useEffect(() => {
    if (open && !disabled) refreshOnOpen();
  }, [open, disabled]);
  const analyze = () => work(async () => {
    if (source.kind === 'incoming' || !projectIds.length) return;
    const requestedSource = source; const requestedKey = key;
    const result = multi
      ? await requestOrganization<OrganizationMultiAnalysis>({ action: 'analyze_many', projectIds, source: requestedSource, provider, model })
      : await requestOrganization<OrganizationAnalysis>({ action: 'analyze', projectId: defaultProjectId, source: requestedSource, provider, model });
    if (!active.current || currentSource.current !== requestedKey) return;
    const assignments = 'proposals' in result ? result.proposals : result.drafts.map(draft => ({ projectId: defaultProjectId, draft }));
    const nextBases = 'bases' in result ? result.bases : result.basis ? { [defaultProjectId]: result.basis } : {};
    const unknown = assignments.some(proposal => !projectIds.includes(proposal.projectId));
    const proposed: Row[] = assignments.filter(proposal => projectIds.includes(proposal.projectId)).map(({ projectId: id, draft }) => {
      const rowId = nextId.current++; rowProjects.current[rowId] = id;
      const missingBasis = multi && nextBases[id]?.projectId !== id;
      return { id: rowId, projectId: id, draft, sourceKey: requestedKey, basis: nextBases[id], requiresBasis: multi, selected: false, confirmed: false,
        state: missingBasis ? 'failed' : 'ready', ...(missingBasis ? { stale: true, error: '分析時の情報を確認できません。再照合してください。' } : {}) };
    });
    setBases(nextBases);
    setRows(values => [...values.filter(row => row.state !== 'ready').map(row => row.state === 'failed' ? { ...row, stale: true } : row), ...proposed]);
    setIssues([...result.issues, ...(unknown ? ['許可されたプロジェクトに対応しない提案を除外しました。'] : [])]); setAnalyzed(true); setRecord(null); setOriginal(null);
    // Each private preview is independent; one unavailable task must not hide other proposals.
    await Promise.all(proposed.map(row => runRow(row, 'preview')));
  });
  const edit = (row: Row, draft: OrganizationDraft) => updateRow(row.id, { draft, preview: undefined, beforeTasks: undefined, selected: false, confirmed: false, state: 'ready', error: undefined });
  const changeProject = (row: Row, id: string) => {
    if (!projectIds.includes(id) || id === row.projectId) return;
    const draft = { ...row.draft, taskIds: [] };
    delete draft.targetTaskId; delete draft.assigneeIds; delete draft.listId;
    rowProjects.current[row.id] = id;
    const missingBasis = row.requiresBasis && bases[id]?.projectId !== id;
    updateRow(row.id, { projectId: id, draft, basis: bases[id], preview: undefined, beforeTasks: undefined, selected: false, confirmed: false, clarifications: undefined,
      state: 'ready', stale: !!missingBasis, error: missingBasis ? '変更先の分析情報を確認できません。再照合してください。' : 'プロジェクトを変更しました。反映先・担当・列を確認し、変更後の姿を確認してください。' });
  };
  const fresh = (row: Row) => active.current && currentSource.current === row.sourceKey && rowProjects.current[row.id] === row.projectId && projectIds.includes(row.projectId) && !row.stale;
  const checkedPreview = (preview: OrganizationPreview, id: string) => {
    if (preview.projectId !== id) throw new Error('反映先のプロジェクトが一致しません。再取得してください。');
    return preview;
  };
  const previewRow = async (row: Row) => {
    if (!fresh(row)) throw new Error('資料が変わりました。再照合してから反映してください。');
    const draft = { ...row.draft, taskIds: row.draft.taskIds.length ? row.draft.taskIds : row.draft.targetTaskId ? [row.draft.targetTaskId] : [] };
    if (!contexts[row.projectId]) throw new Error('反映先の情報を取得できません。反映先を再取得してください。');
    const beforeTasks = structuredClone(projectTasks(row.projectId));
    const preview = await requestOrganization<OrganizationPreview>({ action: 'preview', projectId: row.projectId, source, draft, ...(row.basis ? { basis: row.basis } : {}), ...(row.confirmed ? { confirmed: true } : {}) });
    if (!fresh(row)) return null;
    checkedPreview(preview, row.projectId);
    updateRow(row.id, { preview, beforeTasks, clarifications: preview.clarifications, error: undefined }); remember(preview);
    return preview;
  };
  const runRow = async (row: Row, action: 'preview' | 'apply' | 'hold' | 'skip') => {
    if (!fresh(row)) return;
    if (action === 'apply' && (!row.preview || row.preview.canApply !== true || needsConfirmation(row.draft) && !row.confirmed)) return;
    try {
      const preview = action === 'preview' ? await previewRow(row) : row.preview ?? await previewRow(row);
      if (!preview || !fresh(row)) return;
      if (['applied', 'held', 'skipped'].includes(preview.status)) { updateRow(row.id, { preview, state: preview.status as Row['state'], selected: false }); return; }
      if (!preview.changes.length) { updateRow(row.id, { state: 'skipped', selected: false, error: '既存の内容と同じため、変更は不要です。' }); return; }
      if (action === 'preview' || action === 'apply' && !row.preview) { updateRow(row.id, { state: 'ready' }); return; }
      if (action === 'apply' && (preview.canApply !== true || needsConfirmation(row.draft) && !row.confirmed)) { updateRow(row.id, { state: 'ready', selected: false, error: '確認事項を確認し、必要な修正を済ませてください。' }); return; }
      const result = await requestOrganization<OrganizationPreview>({ action, projectId: row.projectId, id: preview.id });
      if (!active.current) return;
      checkedPreview(result, row.projectId); remember(result); updateRow(row.id, { preview: result, state: result.status === 'applied' ? 'applied' : result.status === 'held' ? 'held' : result.status === 'skipped' ? 'skipped' : 'ready', selected: false, error: undefined });
    } catch (reason) { updateRow(row.id, { state: 'failed', selected: false, error: errorText(reason), stale: conflict(reason) }); }
  };
  const selected = rows.filter(row => !!contexts[row.projectId] && row.selected && row.sourceKey === key && !row.stale && !['applied', 'held', 'skipped'].includes(row.state));
  const batch = () => work(async () => { for (const row of selected) { if (!fresh(row)) break; await runRow(row, 'apply'); } });
  const stale = rows.some(row => !['applied', 'held', 'skipped'].includes(row.state) && (row.sourceKey !== key || row.stale));
  const showOriginal = (preview: OrganizationPreview) => work(async () => { const result = await requestOrganization<OrganizationSource>({ action: 'source', projectId: preview.projectId, id: preview.id }); if (active.current) setOriginal(result); });
  const reconsider = (preview: OrganizationPreview) => work(async () => {
    const result = await requestOrganization<OrganizationReconsideration>({ action: 'reconsider', projectId: preview.projectId, id: preview.id });
    if (!active.current) return;
    checkedPreview(result.preview, preview.projectId);
    const replacedIds = rows.filter(row => row.preview && recordKey(row.preview) === recordKey(preview)).map(row => row.id);
    changeSource(result.source); remember(result.preview);
    const id = nextId.current++; rowProjects.current[id] = preview.projectId;
    setRows(values => [...values.filter(row => !replacedIds.includes(row.id)), {
      id, projectId: preview.projectId, draft: result.draft, sourceKey: sourceKey(result.source), selected: false, confirmed: false,
      preview: result.preview, beforeTasks: structuredClone(projectTasks(preview.projectId)), state: 'ready', clarifications: result.preview.clarifications,
    }]);
  });
  const renderRow = (row: Row) => {
    const rowStale = row.sourceKey !== key || row.stale;
    const terminal = ['applied', 'held', 'skipped'].includes(row.state);
    const points = [...new Set([...(row.draft.confirmationPoints ?? []), ...(row.clarifications ?? [])])];
    if (needsConfirmation(row.draft) && !points.length) points.push('相談・案としての発言です。決定した内容か確認してください。');
    const context = contexts[row.projectId] ?? emptyContext;
    const rowTasks = projectTasks(row.projectId);
    const rowMayWrite = mayWrite && !!contexts[row.projectId];
    const comparisonTasks = row.beforeTasks ?? rowTasks;
    const title = draftTitle(row.draft, comparisonTasks);
    return <article key={JSON.stringify([row.projectId, row.id])} aria-label={`整理案: ${title}`} className="space-y-2 rounded-xl border p-3">
      <div className="flex flex-wrap items-center gap-2"><h3 className="min-w-0 flex-1 break-words text-sm font-semibold">{title}</h3><span className="text-xs text-muted-foreground">{row.draft.kind === 'update' && row.draft.description !== undefined && row.draft.descriptionMode !== 'replace' ? '既存の仕事に追記・変更' : organizationLabels[row.draft.kind]}{terminal ? ` · ${row.preview?.status === 'undone' ? '取消済み' : row.state === 'applied' ? '反映済み' : row.state === 'held' ? '提案を保留' : row.preview?.changes.length === 0 ? '変更不要' : '見送り'}` : row.state === 'failed' ? ' · 結果を確認できません' : ''}</span></div>
      {multi && <div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-medium">{projectLabel(row.projectId)}</span>{!terminal && <label className="ml-auto">反映先プロジェクト<select className="ml-2 max-w-full rounded border bg-background p-1" value={row.projectId} disabled={busy || disabled || row.sourceKey !== key} onChange={event => changeProject(row, event.target.value)}>{scopes.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}</div>}
      {!row.preview?.changes.some(change => change.fields?.length) && <DraftComparison draft={row.draft} tasks={comparisonTasks} context={context} />}
      {row.preview && <PreviewChanges preview={row.preview} tasks={comparisonTasks} context={context} compact />}
      <details className="text-xs"><summary className="cursor-pointer py-1 text-muted-foreground">根拠を見る</summary><p className="my-2 whitespace-pre-wrap break-words">{row.draft.reason}</p>{row.draft.quote && <blockquote className="whitespace-pre-wrap break-words border-l-2 pl-2">{row.draft.quote}</blockquote>}{row.draft.workState && <p className="mt-2">{row.draft.workState.reason}{row.draft.workState.resumeCondition && ` · 再開条件: ${row.draft.workState.resumeCondition}`}{row.draft.workState.reviewAt && ` · 見直し: ${row.draft.workState.reviewAt}`}</p>}</details>
      {!terminal && <>
        <OrganizationDraftEditor draft={row.draft} tasks={rowTasks} context={context} disabled={!rowMayWrite || !!rowStale} onChange={draft => edit(row, draft)} />
        {points.length > 0 && <div className="space-y-2 rounded border border-amber-200 p-2 text-xs"><p className="font-medium">確認してから反映</p><ul className="list-disc space-y-1 pl-4">{points.map(point => <li key={point}>{point}</li>)}</ul><label className="flex items-start gap-2"><input type="checkbox" disabled={!rowMayWrite || !!rowStale} checked={row.confirmed} onChange={event => { const next = { ...row, confirmed: event.target.checked, preview: undefined, selected: false, error: undefined }; updateRow(row.id, next); void work(() => runRow(next, 'preview')); }} /><span>確認事項を確認し、必要な修正を済ませました</span></label></div>}
        {rowStale && <p className="text-xs text-amber-800">資料または仕事が変わりました。再照合が必要です。</p>}
        <div className="flex flex-wrap items-center gap-2"><label className="mr-auto flex items-center gap-2 text-xs"><input type="checkbox" aria-label={`${title}を選択`} disabled={!rowMayWrite || !!rowStale || points.length > 0 && !row.confirmed || (!row.preview || row.preview.canApply !== true)} checked={row.selected} onChange={event => updateRow(row.id, { selected: event.target.checked })} />反映する</label>
          <Button type="button" size="sm" variant="outline" disabled={!rowMayWrite || !!rowStale} onClick={() => void work(() => runRow(row, 'preview'))}>変更後の姿を確認</Button>
          <Button type="button" size="sm" disabled={!rowMayWrite || !!rowStale || points.length > 0 && !row.confirmed || (!row.preview || row.preview.canApply !== true)} onClick={() => void work(() => runRow(row, 'apply'))}>採用して反映</Button>
          <Button type="button" size="sm" variant="ghost" disabled={!rowMayWrite || !!rowStale} onClick={() => void work(() => runRow(row, 'skip'))}>見送る</Button>
          <Button type="button" size="sm" variant="ghost" disabled={!rowMayWrite || !!rowStale} onClick={() => void work(() => runRow(row, 'hold'))}>提案を保留</Button>
        </div>
      </>}
      {row.error && <p role={row.state === 'failed' ? 'alert' : 'status'} className="break-words text-xs text-amber-800">{row.error}</p>}
      {row.preview && <AppliedTaskLinks preview={row.preview} />}
      {row.preview && terminal && <div className="flex flex-wrap gap-2"><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void showOriginal(row.preview!)}>元の資料を開く</Button>{row.state === 'applied' ? <Button type="button" variant="outline" size="sm" disabled={!rowMayWrite} onClick={() => void work(async () => { const result = await requestOrganization<OrganizationPreview>({ action: 'undo', projectId: row.projectId, id: row.preview!.id }); remember(result); updateRow(row.id, { preview: result, state: 'skipped', error: '反映を戻しました。' }); })}>反映を戻す</Button> : <Button type="button" variant="ghost" size="sm" disabled={!rowMayWrite} onClick={() => void reconsider(row.preview!)}>最新の仕事と照合し直す</Button>}</div>}
    </article>;
  };
  return <>
    {controlledOpen === undefined && <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => setOpen(true)}>{label}</Button>}
    <Dialog open={open} onOpenChange={setOpen}>{open && <MovableDialogContent title="仕事の整理と反映" description="タスク・サブタスク・チェックリストの使い分けも、根拠がある場合にモアイが提案理由で説明します。変更は確認して採用するまで保存しません。">
      <div className="space-y-4">
        {notice}
        {multi ? <p className="break-words text-sm font-medium">対象：AIがプロジェクトを仕分け</p> : projectName && <p className="break-words text-sm font-medium">対象：{projectName}</p>}
        {mock && <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">架空のデータ・分析例です。反映先はこのブラウザだけです。</p>}
        {records.some(item => item.status === 'pending' && !rows.some(row => row.preview && recordKey(row.preview) === recordKey(item))) && <section aria-label="反映前の整理案" className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <h3 className="text-sm font-semibold">反映前の整理案</h3>
          <ul className="space-y-1">{records.filter(item => item.status === 'pending' && !rows.some(row => row.preview && recordKey(row.preview) === recordKey(item))).map(item => <li key={recordKey(item)}><button type="button" className="w-full rounded p-1 text-left text-xs hover:bg-white" onClick={() => { setRecord(item); setOriginal(null); }}><span className="mr-2 text-amber-800">{statusLabels[item.status]}</span>{item.changes[0]?.title ?? item.sourceTitle}{multi && <span className="ml-2 text-muted-foreground">{projectLabel(item.projectId)}</span>}</button></li>)}</ul>
        </section>}
        {record && <section aria-label="保存済みの整理記録" className="space-y-2 rounded border p-3 text-xs"><p>{multi && `${projectLabel(record.projectId)} · `}{statusLabels[record.status]} · {record.sourceTitle}</p><PreviewChanges preview={record} tasks={projectTasks(record.projectId)} context={contexts[record.projectId] ?? emptyContext} compact /><AppliedTaskLinks preview={record} /><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void showOriginal(record)}>元の資料を開く</Button>{['pending', 'held', 'skipped', 'undone'].includes(record.status) && <Button type="button" size="sm" variant="outline" disabled={!mayWrite || !contexts[record.projectId]} onClick={() => void reconsider(record)}>最新の仕事と照合し直す</Button>}{record.status === 'applied' && <Button type="button" size="sm" variant="outline" disabled={!mayWrite || !contexts[record.projectId]} onClick={() => void work(async () => { const result = await requestOrganization<OrganizationPreview>({ action: 'undo', projectId: record.projectId, id: record.id }); if (active.current) { remember(result); setRecord(result); setRows(values => values.map(row => row.preview && recordKey(row.preview) === recordKey(result) ? { ...row, preview: result, state: 'skipped', error: '反映を戻しました。' } : row)); } })}>反映を戻す</Button>}</section>}
        {source.kind === 'incoming' ? <p className="rounded border bg-amber-50 p-3 text-xs">元の連絡は本人用です。共有するのは、下の「追記・新しい仕事の内容」に本人が指定した内容だけです。</p> : <fieldset disabled={busy || disabled} className="space-y-2 rounded-xl border p-3">
          <label className="block text-xs">資料の名前<Input value={source.title} maxLength={200} onChange={event => changeSource({ ...source, title: event.target.value })} /></label>
          {source.kind === 'meeting' && <label className="block text-xs">会議日時（不明なら空欄・日本時間）<Input type="datetime-local" value={dateInput(source.occurredAt)} onChange={event => { const value = event.target.value; changeSource({ ...source, occurredAt: value && Number.isFinite(Date.parse(`${value}:00+09:00`)) ? new Date(`${value}:00+09:00`).toISOString() : null }); }} /></label>}
          {source.kind !== 'existing' && <><label className="block text-xs">文字起こし・メモ<Textarea rows={5} value={source.text} maxLength={40000} onChange={event => changeSource({ ...source, text: event.target.value })} /></label><label className="block text-xs text-muted-foreground">テキストファイルを読み込む<input className="mt-1 block w-full text-xs" type="file" accept=".txt,.md,text/plain,text/markdown" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void work(async () => { if (!/\.(txt|md)$/i.test(file.name)) throw new Error('txtまたはmdのファイルを選んでください。'); if (file.size > 160000) throw new Error('ファイルは160KBまでです。'); const text = await file.text(); if (text.length > 40000) throw new Error('文字起こしは4万文字までです。'); if (active.current) changeSource({ ...source, id: file.name, title: file.name.slice(0, 200), text }); }); }} /></label></>}
          {mock && source.kind === 'meeting' && <Button type="button" size="sm" variant="outline" onClick={() => void work(async () => { const example = await requestOrganization<OrganizationSource>(multi ? { action: 'example_many', projectIds } : { action: 'example', projectId: defaultProjectId }); if (active.current) changeSource(example); })}>会議の例を入れる</Button>}
        </fieldset>}
        <div className="flex flex-wrap gap-2">{source.kind !== 'incoming' && <Button type="button" disabled={busy || disabled || !projectIds.length || !source.text.trim()} size="sm" onClick={() => void analyze()}>{busy ? '処理中…' : stale || analyzed ? '再照合' : 'AIで既存の仕事と照合'}</Button>}<Button type="button" size="sm" variant="outline" disabled={!mayWrite} onClick={() => { const id = nextId.current++; const project = projectIds.find(id => !!contexts[id]) ?? defaultProjectId; rowProjects.current[id] = project; setRows(values => [...values, { id, projectId: project, draft: emptyDraft(), sourceKey: key, selected: false, confirmed: false, state: 'ready' }]); }}>自分で整理案を指定</Button></div>
        {stale && <p role="status" className="text-xs text-amber-800">古い案は反映できません。再照合すると、今の資料と仕事から変更案を作り直します。</p>}
        {issues.length > 0 && <details className="text-xs"><summary className="cursor-pointer text-amber-800">照合で分かったこと・見送った内容（{issues.length}件）</summary><ul className="mt-2 list-disc space-y-1 pl-5">{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></details>}
        {analyzed && !rows.some(row => row.sourceKey === key && !['applied', 'held', 'skipped'].includes(row.state)) && <p className="text-sm text-muted-foreground">今の資料から追加で反映する変更案はありません。</p>}
        {rows.some(row => row.state === 'ready') && <section aria-label="対応する変更案" className="space-y-3">{rows.filter(row => row.state === 'ready').map(renderRow)}</section>}
        {rows.length > 0 && <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground">選択した{selected.length}件を順に反映します。反映できない案があっても、ほかの案は続けます。</p><Button type="button" size="sm" disabled={!mayWrite || selected.length === 0} onClick={() => void batch()}>選択済みを反映（{selected.length}件）</Button></div>}
        {rows.some(row => row.state !== 'ready') && <section aria-label="案ごとの結果" className="space-y-3"><h3 className="text-sm font-semibold">案ごとの結果</h3>{rows.filter(row => row.state !== 'ready').map(renderRow)}</section>}
        {busy && <p role="status" className="text-xs text-muted-foreground">処理中です。案ごとに結果を表示します。</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {Object.entries(contextErrors).map(([id, message]) => <p key={id} role="alert" className="text-sm text-destructive">{multi ? `${projectLabel(id)}：` : ''}{message}</p>)}
        {(!contextReady || Object.keys(contextErrors).length > 0) && !busy && <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => void work(refreshContext)}>反映先を再取得</Button>}
        {records.length > 0 && <details className="text-xs"><summary className="cursor-pointer">採用・保留の記録（{records.length}件）</summary><div className="mt-2 space-y-2">{[...records].reverse().map(item => <button type="button" key={recordKey(item)} className="block w-full rounded border p-2 text-left" onClick={() => { setRecord(item); setOriginal(null); }}>{multi && `${projectLabel(item.projectId)} · `}{statusLabels[item.status]} · {item.changes[0]?.title ?? item.sourceTitle} · {organizationLabels[item.kind]}</button>)}</div></details>}

        {original && <details open className="rounded border p-3 text-xs"><summary className="cursor-pointer">元の資料：{original.title}</summary>{original.occurredAt && <p className="my-2">資料日時：{new Date(original.occurredAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}</p>}<p className="mt-2 whitespace-pre-wrap break-words">{original.text}</p></details>}
      </div>
    </MovableDialogContent>}</Dialog>
  </>;
}


function AppliedTaskLinks({ preview }: { preview: OrganizationPreview }) {
  if (preview.status !== 'applied') return null;
  const changes = [...new Map(preview.changes.map(change => [change.taskId, change])).values()];
  return <nav aria-label="反映したタスク" className="flex flex-wrap gap-x-3 gap-y-1">{changes.map(change => <Link key={change.taskId} prefetch={false} href={`/projects/${encodeURIComponent(preview.projectId)}/board?task=${encodeURIComponent(change.taskId)}`} aria-label={`タスクを開く: ${change.title}`} className="break-words text-xs text-primary underline underline-offset-2">タスクを開く{changes.length > 1 && `：${change.title}`}</Link>)}</nav>;
}
