'use client';

import { UserRound } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { checklistAssigneeKey, useChecklistAssigneeStore, type ChecklistAssigneeScope } from '@/stores/checklistAssigneeStore';

export interface ChecklistMemberState {
  users: { id: string; displayName: string; photoURL?: string | null }[];
  isLoading: boolean;
  hasError: boolean;
}
export function ChecklistItemAssignees({ scope, itemText, members, disabled }: {
  scope: ChecklistAssigneeScope; itemText: string; members: ChecklistMemberState; disabled: boolean;
}) {
  const { byItem, hydrated, persistenceFailed, setAssignees } = useChecklistAssigneeStore();
  const ids = byItem[checklistAssigneeKey(scope)] ?? [];
  const selected = members.users.filter(member => ids.includes(member.id));
  const unknown = ids.filter(id => !members.users.some(member => member.id === id));
  const label = selected.length ? selected.map(member => member.displayName).join('・') + (unknown.length ? `・他${unknown.length}名` : '') : ids.length ? `担当${ids.length}名（照合待ち）` : '担当者を指定';
  const visibleIds = ids.slice(0, 4);
  return <Popover>
    <PopoverTrigger asChild>
      <button type="button" disabled={disabled || !hydrated || !scope[0]} aria-label={`${itemText}の担当者（このブラウザのみ）`}
        title={label}
        className="inline-flex shrink-0 items-center gap-0.5 rounded p-0.5 text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50">
        {visibleIds.length > 0 ? <>
          {visibleIds.map(id => {
            const member = members.users.find(item => item.id === id);
            return <Avatar key={id} className="h-6 w-6 border-2 border-background" title={member?.displayName ?? '名前未取得'}>
              <AvatarImage src={member?.photoURL || ''} alt="" />
              <AvatarFallback aria-hidden="true"><UserRound className="h-3.5 w-3.5" /></AvatarFallback>
            </Avatar>;
          })}
          {ids.length > visibleIds.length && <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-background bg-muted text-[10px] font-medium">+{ids.length - visibleIds.length}</span>}
        </> : <UserRound className="h-4 w-4" />}
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-72 space-y-3" aria-label={`${itemText}の担当者設定`}>
      <p className="text-sm font-medium">項目の担当者（複数選択）</p>
      <p className="text-xs text-muted-foreground">このブラウザだけに保存します。共有タスクへの反映・通知はありません。</p>
      {members.isLoading ? <p role="status" className="text-xs">メンバーを読み込み中…</p> : members.hasError ? <p role="alert" className="text-xs text-destructive">メンバーを取得できません。タスクを開き直してください。</p> : <div className="max-h-52 space-y-1 overflow-y-auto">
        {members.users.map(member => <label key={member.id} className="flex items-center gap-2 rounded p-2 text-sm hover:bg-muted">
          <Checkbox checked={ids.includes(member.id)} onCheckedChange={checked => setAssignees(scope, checked === true ? [...ids, member.id] : ids.filter(id => id !== member.id))} />
          <span>{member.displayName}</span>
        </label>)}
        {!members.users.length && <p className="text-xs text-muted-foreground">選択できるプロジェクトメンバーはいません。</p>}
      </div>}
      {!members.isLoading && !members.hasError && unknown.length > 0 && <p className="text-xs text-muted-foreground">現在のメンバー一覧にいない担当者が{unknown.length}名います。</p>}
      {persistenceFailed && <p role="alert" className="text-xs text-destructive">ブラウザに保存できません。この画面内のみ保持しています。</p>}
      <Button type="button" size="sm" variant="ghost" disabled={!ids.length} onClick={() => setAssignees(scope, [])}>担当者を解除</Button>
    </PopoverContent>
  </Popover>;
}
