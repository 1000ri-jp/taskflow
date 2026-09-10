'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import type { DashboardTask } from '@/lib/dashboard/brief';
import { safeMeetingText, type MeetingProposal } from '@/lib/dashboard/meeting-proposals';
import type { MeetingMember, MeetingTarget, ReviewMatch } from '@/lib/dashboard/meeting-review';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const priorityLabels = { high: '高', medium: '中', low: '低' };
export function MeetingTaskComparison({ proposal, result, tasks, users, ready, target, onTarget }: {
  proposal: MeetingProposal; result: ReviewMatch; tasks: DashboardTask[]; users: MeetingMember[]; ready: boolean;
  target?: MeetingTarget; onTarget: (target?: MeetingTarget) => void;
}) {
  const [search, setSearch] = useState('');
  const query = search.trim().toLocaleLowerCase();
  const found = query ? tasks.filter(t => !t.isArchived && `${t.title} ${t.projectName}`.toLocaleLowerCase().includes(query)).slice(0, 10) : [];
  return <section aria-label="登録済みタスクとの比較" className="space-y-3">
    <h3 className="font-semibold">登録済みタスクとの比較</h3>
    <p className="text-xs text-muted-foreground">自動照合は候補です。対応づけの確認だけを保存し、タスクの更新・新規登録は行いません。</p>
    {result.notes.map(note => <p key={note} className="text-xs">{note}</p>)}
    {result.candidates.map(task => <div key={`${task.projectId}/${task.id}`} className="space-y-3 rounded-lg border p-3">
      <p className="font-medium">登録済み：{safeMeetingText(task.title)}</p>
      <p className="text-xs text-muted-foreground">{safeMeetingText(task.projectName)} · {task.isCompleted ? '完了' : task.isAbandoned ? '中止' : '未完了'}</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th className="p-1">項目</th><th className="p-1">登録済み</th><th className="p-1">今回の提案</th></tr></thead><tbody>
        <tr className="border-t"><th className="p-1">件名</th><td className="p-1">{safeMeetingText(task.title)}</td><td className="p-1">{proposal.title}{task.title !== proposal.title && <span className="ml-1 text-amber-700">（異なります）</span>}</td></tr>
        <tr className="border-t"><th className="p-1">担当</th><td className="p-1">{task.assigneeIds.length ? task.assigneeIds.map(id => safeMeetingText(users.find(u => u.id === id)?.displayName ?? '名前未取得')).join('・') : '未指定'}</td><td className="p-1">{proposal.owner || '未指定（変更案なし）'}</td></tr>
        <tr className="border-t"><th className="p-1">期限</th><td className="p-1">{task.dueDate ? format(task.dueDate, 'yyyy-MM-dd') : '未設定'}</td><td className="p-1">{proposal.dueDate || (proposal.timing ? `${proposal.timing}（日付要確認）` : '未指定（変更案なし）')}</td></tr>
        <tr className="border-t"><th className="p-1">優先度</th><td className="p-1">{task.priority ? priorityLabels[task.priority] : '未指定'}</td><td className="p-1">{proposal.priority}</td></tr>
      </tbody></table></div>
      <p className="text-xs text-muted-foreground">既存の説明本文は認証情報の混入を避けるため非表示。既存タスクID：{task.id}</p>
      <Button type="button" size="sm" variant="outline" disabled={!ready} onClick={() => onTarget({ mode: 'existing', projectId: task.projectId, taskId: task.id })}>{result.confirmed ? 'この対応づけを確認済み' : 'この登録済みタスクに対応づける'}</Button>
    </div>)}
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" disabled={!ready} onClick={() => onTarget({ mode: 'new' })}>別の新規タスクとして扱う</Button>
      {target && <Button type="button" variant="ghost" size="sm" onClick={() => onTarget(undefined)}>対応づけを自動照合に戻す</Button>}
    </div>
    <details className="rounded-lg border p-3"><summary className="cursor-pointer text-xs">別の登録済みタスクを探す</summary>
      <Input aria-label="登録済みタスクを検索" className="mt-2" placeholder="タスク名・プロジェクト名" value={search} disabled={!ready} onChange={e => setSearch(e.target.value)} />
      {query && <ul className="mt-2 space-y-2 text-xs">{found.map(task => <li key={`${task.projectId}/${task.id}`}><button type="button" className="text-left text-blue-700 underline" onClick={() => { onTarget({ mode: 'existing', projectId: task.projectId, taskId: task.id }); setSearch(''); }}>{safeMeetingText(task.title)} ／ {safeMeetingText(task.projectName)}</button></li>)}{!found.length && <li>一致する登録済みタスクはありません。</li>}</ul>}
      <p className="mt-1 text-xs text-muted-foreground">現在参加しているプロジェクトから最大10件を表示します。</p>
    </details>
  </section>;
}
