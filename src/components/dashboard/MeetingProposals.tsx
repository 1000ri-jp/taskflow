'use client';

import { useEffect, useState } from 'react';
import { Mic2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useProjects } from '@/hooks/useProjects';
import type { DashboardTask } from '@/lib/dashboard/brief';
import { MEETING_PROPOSALS, MEETING_ACTIONS, MEETING_IDEAS, MEETING_PARENTS, MEETING_CONFIRMATIONS, MEETING_DATE_NOTE, safeMeetingText, type MeetingProposal } from '@/lib/dashboard/meeting-proposals';
import { MEETING_REVIEW_STORAGE_KEY, useMeetingProposalStore, type ProposalEdits, type ReviewStatus } from '@/stores/meetingProposalStore';

import { useMeetingMembers } from '@/hooks/useMeetingMembers';
import { MEETING_BUNDLES } from '@/lib/dashboard/meeting-bundles';
import { MEETING_ATTENDEES, proposalOwnerNames, resolvedOwners, membersForProposal, resolveReviewMatch, type RegistrationGroup } from '@/lib/dashboard/meeting-review';
import { MeetingTaskComparison } from './MeetingTaskComparison';
import { checklistDestination, checklistItems, MEETING_PARENT_HINTS } from '@/lib/dashboard/meeting-checklists';
import { MEETING_CHECKLIST_STORAGE_KEY, useMeetingChecklistStore } from '@/stores/meetingChecklistStore';
import { MeetingChecklistPlacement } from './MeetingChecklistPlacement';
import { MeetingChecklistItems } from './MeetingChecklistItems';
import { ProjectIconBadge } from './ProjectIconBadge';

const compact = 'h-5 min-w-10 rounded px-1.5 text-[10px] font-bold leading-none';
const statusLabels: Record<ReviewStatus, string> = { pending: '未確認', adopted: '採用済（未反映）', held: '保留中', dismissed: '不要' };
const groupLabels = { existing: '登録済み候補', new: '新規候補', unresolved: '照合待ち' };
const groupStyles = { existing: 'bg-blue-50 text-blue-700', new: 'bg-emerald-50 text-emerald-700', unresolved: 'bg-amber-50 text-amber-800' };
const groupHeadings = { existing: '登録済みタスクを含む', new: '新規候補', unresolved: '照合待ち' };
const groups: RegistrationGroup[] = ['existing', 'new', 'unresolved'];

export function MeetingProposals({ tasks, tasksLoading, tasksError, isSample = false }: { tasks: DashboardTask[]; tasksLoading: boolean; tasksError: Error | null; isSample?: boolean }) {
  const { projects, isLoading, error } = useProjects();
  const { reviews, hydrate, persistenceFailed, review, edit, reset, setTarget } = useMeetingProposalStore();
  const checklist = useMeetingChecklistStore();
  const [expandedBundles, setExpandedBundles] = useState<string[]>([]);
  const [filter, setFilter] = useState<RegistrationGroup | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProposalEdits | null>(null);
  const [editError, setEditError] = useState('');
  useEffect(() => {
    hydrate();
    const onStorage = (event: StorageEvent) => { if (event.key === MEETING_REVIEW_STORAGE_KEY) hydrate(); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [hydrate]);
  useEffect(() => {
    const hydrateChecklist = useMeetingChecklistStore.getState().hydrate;
    hydrateChecklist();
    const onStorage = (event: StorageEvent) => { if (event.key === MEETING_CHECKLIST_STORAGE_KEY) hydrateChecklist(); };
    window.addEventListener('storage',onStorage);
    return () => window.removeEventListener('storage',onStorage);
  }, []);
  const ready = !tasksLoading && !isLoading && !tasksError && !error && !isSample;
  const members = useMeetingMembers(projects, ready);
  const proposed = (proposal: MeetingProposal) => {
    const value = { ...proposal, ...reviews[proposal.id]?.edits };
    return { ...value, owner: proposalOwnerNames(value.owner).join('・') };
  };
  const match = (proposal: MeetingProposal) => resolveReviewMatch(proposed(proposal), tasks, projects, ready, reviews[proposal.id]?.target);
  const proposalBundle = (proposal: MeetingProposal) => MEETING_BUNDLES.find(b => b.children.includes(proposal.id));
  const destinationFor = (bundleId: string) => checklistDestination(bundleId,tasks,projects,ready,checklist.placements[bundleId]);
  const availableMembers = (proposal: MeetingProposal) => {
    const bundle = proposalBundle(proposal);
    const destination = bundle ? destinationFor(bundle.id) : undefined;
    return membersForProposal(proposal, projects, members.users, destination?.task ? {mode:'existing',projectId:destination.task.projectId,taskId:destination.task.id} : reviews[proposal.id]?.target);
  };
  const owners = (proposal: MeetingProposal) => resolvedOwners(proposed(proposal).owner, availableMembers(proposal), reviews[proposal.id]?.edits?.assigneeIds);
  const ownerNote = (proposal: MeetingProposal) => {
    const resolved = owners(proposal);
    return !resolved.length ? '担当未指定' : members.isLoading ? 'メンバー読み込み中' : resolved.every(o => o.status === 'matched') ? 'メンバー照合済み' : '担当名の照合が必要';
  };
  const bundles = MEETING_BUNDLES.map(bundle => {
    const children = MEETING_ACTIONS.filter(p => bundle.children.includes(p.id));
    const counts = { existing: 0, new: 0, unresolved: 0 };
    children.forEach(p => counts[match(p).group]++);
    const group: RegistrationGroup = counts.existing ? 'existing' : counts.unresolved ? 'unresolved' : 'new';
    return { ...bundle, children, counts, group };
  });
  const selected = MEETING_PROPOSALS.find(p => p.id === selectedId);
  const selectedMatch = selected ? match(selected) : null;
  const open = (proposal: MeetingProposal, editMode = false) => {
    setSelectedId(proposal.id);
    const value = proposed(proposal);
    setEditing(editMode ? { title: value.title, owner: value.owner, dueDate: value.dueDate, content: value.content, assigneeIds: reviews[proposal.id]?.edits?.assigneeIds } : null);
    setEditError('');
  };
  const reviewedCount = MEETING_ACTIONS.filter(p => reviews[p.id]?.status && reviews[p.id].status !== 'pending').length;
  const checklistControls = (proposal: MeetingProposal) => <MeetingChecklistItems proposal={proposed(proposal)} onDueDateChange={dueDate => {
    const value = proposed(proposal);
    edit(proposal.id,{title:value.title,owner:value.owner,content:value.content,dueDate,assigneeIds:reviews[proposal.id]?.edits?.assigneeIds});
  }} />;
  const actions = (proposal: MeetingProposal) => {
    if (proposal.kind === 'idea') return null;
    const status = reviews[proposal.id]?.status ?? 'pending';
    return <div className="flex flex-wrap items-center gap-1.5" aria-label={`${proposal.sourceId}の下書き操作`}>
      <Button type="button" size="sm" className={compact} aria-pressed={status === 'adopted'} title="このブラウザの下書きとして採用。TaskFlowには反映しません" onClick={() => {
        const value = proposed(proposal);
        const resolved = owners(proposal);
        const assigneeIds = resolved.length && resolved.every(o => o.userId) ? resolved.map(o => o.userId!) : undefined;
        if (edit(proposal.id, { title: value.title, owner: value.owner, dueDate: value.dueDate, content: value.content, assigneeIds })) review(proposal.id, 'adopted');
      }}>採用</Button>
      <Button type="button" size="sm" variant="outline" className={compact} onClick={() => open(proposal, true)}>直す</Button>
      <Button type="button" size="sm" variant="outline" className={compact} aria-pressed={status === 'held'} onClick={() => review(proposal.id, 'held')}>保留</Button>
      <Button type="button" size="sm" variant="ghost" className={compact} aria-pressed={status === 'dismissed'} onClick={() => review(proposal.id, 'dismissed')}>不要</Button>
      {status !== 'pending' && <button type="button" className="rounded text-xs text-muted-foreground underline focus-visible:ring-2" onClick={() => review(proposal.id, 'pending')}>未確認に戻す</button>}
    </div>;
  };
  return <section className="overflow-hidden rounded-2xl border border-blue-200 bg-white shadow-sm" aria-label="今日の朝会から">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-center gap-2"><Mic2 className="h-4 w-4 text-muted-foreground" /><h2 className="font-semibold tracking-tight">今日の朝会から</h2><Badge className="bg-blue-50 text-blue-700 hover:bg-blue-50">会議メモ v2・下書き</Badge></div>
      <p className="text-xs text-muted-foreground" role="status">確認済み {reviewedCount} / {MEETING_ACTIONS.length}件</p>
    </div>
    <div className="space-y-1 border-b bg-blue-50/40 px-5 py-3 text-xs text-muted-foreground">
      <p>新しい添付メモをAIで整理した固定の下書きです。毎日の会議取込・AI再生成は未接続。</p>
      <p className="text-amber-800">{MEETING_DATE_NOTE}</p>
      <p className="font-medium text-blue-800">採用・修正はこのブラウザだけに保存します。TaskFlowのタスクには反映されません。</p>
      <p>{MEETING_BUNDLES.length}チェックリスト・{MEETING_ACTIONS.length}件の提案。追加先の大タスクごとに整理し、子タスクの担当・期限・完了条件を保持します。</p>
      <p>作業チェックと個人別期限もテスト用にこのブラウザだけに保存します。実際の完了状態とは別です。大タスクの照合は候補なので、追加先を確認してください。</p>
      <p>「各自」は会議参加者3名を複数担当として展開します。登録済みの判定は候補のため、詳細で対応先・差分を確認してください。</p>
      {members.hasError && <p role="alert">担当者名を取得できませんでした。<button type="button" className="underline" onClick={members.refresh}>担当者を再取得</button></p>}
      <p>旧版の採用・修正履歴は保持し、新版には引き継ぎません。親4-1と親4-2を統合し、実施日確認を1件追加しています。</p>
      {!ready && <p role="status">{tasksError || error ? '取得エラーのため既存タスクの照合を保留しています。' : tasksLoading || isLoading ? '既存タスクを読み込み中です。' : '実データの照合待ちです。'}</p>}
      {persistenceFailed && <p role="alert" className="text-rose-700">ブラウザに保存できませんでした。操作はこの画面内だけに残ります。</p>}
      {checklist.persistenceFailed && <p role="alert" className="text-rose-700">チェックリストの下書きをブラウザに保存できませんでした。この画面内だけの変更です。</p>}
    </div>
    <details className="border-b bg-amber-50/40 px-5 py-3 text-xs">
      <summary className="cursor-pointer font-medium text-amber-800">確認待ち（{MEETING_CONFIRMATIONS.length}項目）</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5">{MEETING_CONFIRMATIONS.map(item => <li key={item}>{item}</li>)}</ul>
    </details>
    <div className="flex flex-wrap gap-2 border-b px-5 py-3" aria-label="登録状況で絞り込み">
      {(['all', ...groups] as const).map(group => <Button key={group} size="sm" variant={filter === group ? 'default' : 'outline'} aria-pressed={filter === group} onClick={() => setFilter(group)}>
        {group === 'all' ? 'すべて' : groupHeadings[group]}（{group === 'all' ? bundles.length : bundles.filter(b => b.group === group).length}）
      </Button>)}
    </div>
    <div className="divide-y">
      {groups.filter(group => filter === 'all' || filter === group).map(group => {
        const visible = bundles.filter(b => b.group === group);
        return <section key={group} aria-label={groupHeadings[group]}>
          <h3 className="border-b bg-neutral-50 px-5 py-2 text-xs font-semibold">{groupHeadings[group]} · {visible.length}まとまり</h3>
          {!visible.length && <p className="px-5 py-3 text-xs text-muted-foreground">該当するまとまりはありません。</p>}
          {visible.map(bundle => {
            const parent = MEETING_PARENTS.find(p => p.id === bundle.parentId);
            const destination = destinationFor(bundle.id);
            const destinationTitle = destination.title ?? parent?.title ?? '大タスク未指定';
            const listTitle = checklist.placements[bundle.id]?.title ?? bundle.title;
            const entries = bundle.children.flatMap(p => checklistItems(proposed(p)));
            const completed = entries.filter(entry => checklist.items[entry.key]?.checked).length;
            const expanded = expandedBundles.includes(bundle.id);
            const checked = bundle.children.filter(p => reviews[p.id] && reviews[p.id].status !== 'pending').length;
            const candidates = [...new Set(bundle.children.flatMap(p => match(p).candidates.map(t => safeMeetingText(t.title))))];
            const candidateProjects = !destination.task ? [...new Map((parent?.projects ?? []).flatMap(name => projects.filter(project => !project.isArchived && project.name.normalize('NFKC').trim().toLocaleLowerCase() === name.normalize('NFKC').trim().toLocaleLowerCase())).map(project => [project.id, project])).values()] : [];
            return <section key={bundle.id} aria-label={bundle.title} className="border-b last:border-b-0">
              <div className="grid gap-3 px-4 py-3 lg:grid-cols-[220px_minmax(0,1fr)] lg:px-5">
                <div className="min-w-0 space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">{safeMeetingText(destinationTitle)}</p>
                  <p className="flex items-center gap-1.5 break-words text-[11px] text-muted-foreground">{destination.task && (destination.task.projectIcon || destination.task.projectIconUrl) && <ProjectIconBadge icon={destination.task.projectIcon} iconUrl={destination.task.projectIconUrl} color={destination.task.projectColor} />}{candidateProjects.map(project => <ProjectIconBadge key={project.id} icon={project.icon} iconUrl={project.iconUrl} color={project.color} />)}{destination.task ? 'プロジェクト：' + safeMeetingText(destination.task.projectName) : MEETING_PARENT_HINTS[bundle.id] ? 'プロジェクト：未照合' : 'プロジェクト候補：' + (parent?.projects.map(safeMeetingText).join(' / ') ?? '未指定')}</p>
                  <p className="text-[11px] text-muted-foreground">{destination.state === 'selected' ? '追加先を指定済み（未反映）' : destination.state === 'candidate' ? '追加先の大タスク候補' : destination.state === 'loading' ? '大タスクを照合中' : destination.state === 'ambiguous' ? '同名の大タスクあり・要選択' : destination.state === 'missing' ? '追加先が見つかりません・要選択' : '追加先の大タスクは未指定'}</p>
                  <MeetingChecklistPlacement bundleId={bundle.id} title={bundle.title} tasks={tasks} projects={projects} ready={ready}/>
                </div>
                <div className="min-w-0 space-y-1">
                  <button type="button" className="flex w-full items-center justify-between gap-3 rounded text-left text-sm font-medium hover:text-blue-700 focus-visible:ring-2" aria-expanded={expanded} aria-label={bundle.title + 'の子タスクを表示'} onClick={() => setExpandedBundles(current => expanded ? current.filter(id => id !== bundle.id) : [...current, bundle.id])}>
                    <span>{listTitle}</span><span className="shrink-0 text-xs font-normal text-muted-foreground">{expanded ? '閉じる' : '子タスクを確認'}（{entries.length}項目）</span>
                  </button>
                  <div className="flex flex-wrap gap-2 text-[11px]">{groups.filter(g => bundle.counts[g]).map(g => <span key={g} className={groupStyles[g] + ' rounded px-1.5 py-0.5'}>{groupLabels[g]} {bundle.counts[g]}</span>)}<span className="text-muted-foreground">下書き確認 {checked}/{bundle.children.length}</span></div>
                  <p className="text-[11px] text-muted-foreground">チェックリスト · 作業チェック {completed}/{entries.length}（テスト）</p>
                  {!!candidates.length && <p className="truncate text-xs text-muted-foreground" title={candidates.join(' / ')}>登録済み候補：{candidates.join(' / ')}</p>}
                </div>
              </div>
              {expanded && <div className="divide-y border-t bg-slate-50/40">{bundle.children.map(proposal => {
                const value = proposed(proposal);
                const result = match(proposal);
                const status = reviews[proposal.id]?.status ?? 'pending';
                return <article key={proposal.id} aria-label={proposal.id + ' ' + value.title} className="grid gap-3 px-4 py-3 lg:grid-cols-[220px_minmax(0,1fr)] lg:px-5">
                  <div className="space-y-1"><Badge className={groupStyles[result.group]}>{groupLabels[result.group]}</Badge>{result.confirmed && <p className="text-[11px] text-blue-700">対応づけ確認済み</p>}<p className="text-[11px] text-muted-foreground">メモ {proposal.sourceId} · {proposal.priority}</p></div>
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                      <button type="button" className="min-w-0 rounded text-left text-sm font-medium hover:text-blue-700 hover:underline focus-visible:ring-2" onClick={() => open(proposal)}>{value.title}</button>{actions(proposal)}
                    </div>
                    <p className="break-words text-xs text-muted-foreground">担当：{value.owner || '未指定'}（{ownerNote(proposal)}） · {value.dueDate ? '期限 ' + value.dueDate : proposal.timing ? '期限要確認 · ' + proposal.timing : '期限未指定'}</p>
                    {checklistControls(proposal)}
                    <p className="text-xs text-muted-foreground">{statusLabels[status]}{reviews[proposal.id]?.edits && ' · 編集済'}{proposal.questions.length > 0 && ' · 要確認事項あり'} · 作業ステータス：{proposal.taskStatus}</p>
                  </div>
                </article>;
              })}</div>}
            </section>;
          })}
        </section>;
      })}
    </div>
    <div className="flex flex-wrap gap-4 border-t px-5 py-3 text-xs">
      <details className="min-w-0 flex-1"><summary className="cursor-pointer text-muted-foreground">検討候補（{MEETING_IDEAS.length}件・実行対象外）</summary><ul className="mt-2 space-y-2 text-muted-foreground">{MEETING_IDEAS.map(idea => <li key={idea.id}><button type="button" className="text-left text-blue-700 underline" onClick={() => open(idea)}>{idea.title}</button><p>親タスク：{MEETING_PARENTS.find(p => p.id === idea.parentId)?.title} · 優先度 {idea.priority}</p><p>{idea.dependencyConditions}</p></li>)}</ul></details>
    </div>
    <Dialog open={!!selected} onOpenChange={value => { if (!value) { setSelectedId(null); setEditing(null); } }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{editing ? '提案を直す' : '提案の詳細'} · メモ {selected?.sourceId}</DialogTitle><DialogDescription>新版の添付メモ由来（会議日未確定）。採用してもTaskFlow未反映です。要確認事項は採用・修正後も残ります。</DialogDescription></DialogHeader>
        {selected && selectedMatch && <div className="space-y-4 text-sm">
          {editing ? <form className="space-y-3" onSubmit={event => {
            event.preventDefault();
            if (!edit(selected.id, editing)) { setEditError('件名・内容と日付を確認してください。パスワード・トークンなど認証情報らしき内容は保存できません。'); return; }
            setEditing(null); setEditError('');
          }}>
            <label className="block space-y-1"><span>件名</span><Input required maxLength={160} value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} /></label>
            <label className="block space-y-1"><span>担当（未定なら空欄）</span><Input maxLength={100} value={editing.owner} onChange={e => setEditing({ ...editing, owner: e.target.value, assigneeIds: undefined })} /></label>
            <fieldset className="space-y-2 rounded-lg border p-3">
              <legend className="px-1 text-xs">担当者を複数選択</legend>
              <p className="text-xs text-muted-foreground">「各自」はこの会議の参加者3名です。未照合・同名の人は確認してください。</p>
              <Button type="button" size="sm" variant="outline" onClick={() => setEditing({ ...editing, owner: MEETING_ATTENDEES.map(p => p.name).join('・'), assigneeIds: undefined })}>会議参加者3名を入れる</Button>
              {availableMembers(selected).map(member => {
                const selectedIds = editing.assigneeIds ?? resolvedOwners(editing.owner, availableMembers(selected)).flatMap(o => o.userId ? [o.userId] : []);
                return <label key={member.id} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={selectedIds.includes(member.id)} onChange={event => {
                  const ids = event.target.checked ? [...selectedIds, member.id] : selectedIds.filter(id => id !== member.id);
                  const unresolvedNames = resolvedOwners(editing.owner, availableMembers(selected), editing.assigneeIds).filter(o => !o.userId && resolvedOwners(o.name, [member])[0]?.status !== 'matched').map(o => o.name);
                  const names = [...new Set([...availableMembers(selected).filter(m => ids.includes(m.id)).map(m => m.displayName), ...unresolvedNames])];
                  setEditing({ ...editing, owner: names.join('・'), assigneeIds: ids });
                }} />{safeMeetingText(member.displayName)}</label>;
              })}
              <p className="text-xs text-muted-foreground">現在の登録先候補のメンバーだけを表示。見つからない担当名は上の入力欄に残します。</p>
            </fieldset>
            <label className="block space-y-1"><span>期限（未確定なら空欄）</span><Input type="date" value={editing.dueDate} onChange={e => setEditing({ ...editing, dueDate: e.target.value })} /></label>
            <label className="block space-y-1"><span>提案内容</span><Textarea required rows={6} maxLength={10000} value={editing.content} onChange={e => setEditing({ ...editing, content: e.target.value })} /></label>
            {editError && <p role="alert" className="text-rose-700">{editError}</p>}
            <div className="flex flex-wrap gap-2"><Button type="submit">下書きを保存</Button><Button type="button" variant="outline" onClick={() => { setEditing(null); setEditError(''); }}>キャンセル</Button></div>
            <p className="text-xs text-muted-foreground">修正後は「未確認」に戻します。会議の元情報・時期条件は以下に残します。</p>
          </form> : <div className="space-y-2 rounded-lg border bg-blue-50/30 p-3">
            <h3 className="font-semibold">{proposed(selected).title}</h3>
            <p>登録先候補：{selected.projects.join(' / ')}</p>
            <p>担当：{proposed(selected).owner || '未指定'} ／ 期限：{proposed(selected).dueDate || (selected.timing ? '要確認' : '未指定')}</p>
            <p className="whitespace-pre-wrap break-words">{proposed(selected).content}</p>
            <p className="text-xs text-blue-700">{statusLabels[reviews[selected.id]?.status ?? 'pending']}{reviews[selected.id]?.edits && ' · 編集済'}</p>
            {actions(selected)}
          </div>}
          <div className="space-y-2 rounded-lg border p-3">
            <p>分類：{MEETING_PARENTS.find(p => p.id === selected.parentId)?.title}</p>
            {proposalBundle(selected) && <p>追加先：{safeMeetingText(destinationFor(proposalBundle(selected)!.id).task?.projectName ?? 'プロジェクト未確定')} ／ {safeMeetingText(destinationFor(proposalBundle(selected)!.id).title ?? '大タスク未指定')} ／ {checklist.placements[proposalBundle(selected)!.id]?.title ?? proposalBundle(selected)!.title}（チェックリスト）</p>}
            <p>優先度：{selected.priority} ／ 作業ステータス：{selected.taskStatus}（添付の記載）</p>
            <p><span className="font-medium">完了条件：</span>{selected.completion}</p>
            <p className="font-medium">依存タスク・前提（添付で明示）</p>
            {selected.dependencies.length ? <ul className="list-disc space-y-1 pl-5">{selected.dependencies.map(id => {
              const dependency = MEETING_PROPOSALS.find(p => p.id === id)!;
              return <li key={id}><button type="button" className="text-left text-blue-700 underline" onClick={() => open(dependency)}>{dependency.sourceId}：{dependency.title}</button></li>;
            })}</ul> : <p>{selected.dependencyConditions || '未指定'}</p>}
          </div>
          {selected.kind === 'action' && checklistControls(selected)}
          {selected.timing && <p><span className="font-medium">会議での時期・条件（日付は未確定）：</span>{selected.timing}</p>}
          {selected.kind === 'action' && <MeetingTaskComparison key={selected.id} proposal={proposed(selected)} result={selectedMatch} tasks={ready ? tasks.filter(t => !t.isArchived && projects.some(p => p.id === t.projectId && !p.isArchived)) : []} users={members.users} ready={ready} target={reviews[selected.id]?.target} onTarget={target => setTarget(selected.id, target)} />}
          {!!selected.questions.length && <div className="space-y-1 rounded-lg bg-amber-50 p-3"><h3 className="font-semibold">要確認（未解決）</h3>{selected.questions.map(question => <p key={question}>{question}</p>)}</div>}
          {!!selected.cautions.length && <div className="space-y-1"><h3 className="font-semibold">AI補足 · 会議の確定事項ではありません</h3>{selected.cautions.map(caution => <p key={caution}>{caution}</p>)}</div>}
          <details className="rounded-lg border p-3" open><summary className="cursor-pointer font-medium">元メモ {selected.sourceId}（新版の添付・整理済みメモ）</summary><p className="mt-2 whitespace-pre-wrap break-words">{safeMeetingText(selected.sourceExcerpt)}</p><p className="mt-2 text-xs text-muted-foreground">原音声・文字起こし原文との照合や、公式規約の確認はしていません。旧版の担当・期限・完了判断は補完していません。</p></details>
          {reviews[selected.id] && <button type="button" className="rounded text-xs text-muted-foreground underline focus-visible:ring-2" onClick={() => { reset(selected.id); setEditing(null); }}>この提案を元の下書きに戻す</button>}
          {persistenceFailed && <p role="alert" className="text-rose-700">ブラウザ保存に失敗しました。この画面内だけの変更です。</p>}
        </div>}
      </DialogContent>
    </Dialog>
  </section>;
}
