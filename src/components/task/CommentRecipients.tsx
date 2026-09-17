'use client';
import { useState } from 'react';
import { Bell, Check, UsersRound } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { ControlHint } from '@/components/ui/control-hint';
import type { ChecklistMemberState } from './ChecklistItemAssignees';

export function CommentRecipients({ label, members, selected, onChange, frequentIds, disabled }: {
  label: string;
  members: ChecklistMemberState & { refresh: () => void };
  selected: string[];
  onChange: (ids: string[]) => void;
  frequentIds: string[];
  disabled: boolean;
}) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const rank = (id: string) => { const index = frequentIds.indexOf(id); return index < 0 ? Number.MAX_SAFE_INTEGER : index; };
  const ranked = [...members.users].sort((a, b) => rank(a.id) - rank(b.id));
  const quick = ranked.slice(0, 5);
  const extraSelected = selected.filter(id => !quick.some(member => member.id === id));
  const filtered = ranked.filter(member => member.displayName.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const toggle = (id: string) => { if (!disabled) onChange(selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id]); };
  const choice = (member: ChecklistMemberState['users'][number], compact: boolean) => <label key={member.id} className={compact ? 'relative inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border has-checked:border-blue-400 has-checked:bg-blue-50 has-disabled:cursor-default has-disabled:opacity-50' : 'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted has-disabled:opacity-50'}>
    <input type="checkbox" className={compact ? 'peer sr-only' : 'h-3.5 w-3.5'} aria-label={member.displayName} checked={selected.includes(member.id)} onChange={() => toggle(member.id)} disabled={disabled} />
    <Avatar className="h-6 w-6 shrink-0 peer-focus-visible:ring-2 peer-focus-visible:ring-ring"><AvatarImage src={member.photoURL || ''} alt="" /><AvatarFallback className="text-[10px]">{member.displayName.slice(0, 2)}</AvatarFallback></Avatar>
    {!compact && <span className="min-w-0 break-words">{member.displayName}</span>}
    {compact && selected.includes(member.id) && <Check aria-hidden="true" className="absolute -right-0.5 -bottom-0.5 h-3.5 w-3.5 rounded-full border border-background bg-blue-600 p-px text-white" />}
  </label>;
  return <fieldset disabled={disabled} aria-label={`${label}（複数可）`} className="min-w-0">
    <legend className="sr-only">{label}（複数可）</legend>
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Bell aria-hidden="true" className="h-3.5 w-3.5" />{label === '通知先' ? '通知' : label}</span>
      {members.isLoading ? <span role="status" className="text-xs">メンバーを読み込み中…</span> : members.hasError ? <span role="alert" className="text-xs text-destructive">メンバーを取得できません。<button type="button" disabled={disabled} className="ml-1 underline" onClick={members.refresh}>再試行</button></span> : <>
        {quick.map(member => <ControlHint key={member.id} label={member.displayName}>{choice(member, true)}</ControlHint>)}
        <Popover open={open && !disabled} onOpenChange={value => { setOpen(value); setSearch(''); }}>
          <PopoverTrigger asChild><button type="button" disabled={disabled} aria-label={`${label}をほかのメンバーから選ぶ`} title="よく使う5人を表示しています。他のメンバーはここから選べます。" className="inline-flex h-7 items-center gap-1 rounded-full border px-2 text-xs text-muted-foreground hover:bg-muted"><UsersRound className="h-3.5 w-3.5" /><span>{extraSelected.length ? `他 ${extraSelected.length}人選択` : 'ほか'}</span></button></PopoverTrigger>
          <PopoverContent align="start" className="w-72 space-y-2 p-3" aria-label={`${label}のメンバー選択`}>
            <p className="text-sm font-medium">{label}</p>
            <Input aria-label={`${label}の名前を検索`} placeholder="名前を検索" value={search} onChange={event => setSearch(event.target.value)} disabled={disabled} className="h-8" />
            <div className="flex gap-3 text-xs"><button type="button" disabled={disabled} className="underline" onClick={() => onChange(ranked.map(member => member.id))}>全員を選択</button><button type="button" disabled={disabled || !selected.length} className="underline" onClick={() => onChange([])}>選択を解除</button></div>
            <div className="max-h-56 overflow-y-auto">{filtered.map(member => choice(member, false))}{!filtered.length && <p className="py-2 text-xs text-muted-foreground">該当するメンバーがいません。</p>}</div>
            <p className="text-[10px] leading-relaxed text-muted-foreground">よく使う順は、このブラウザの投稿履歴から表示します。選択しただけでは通知しません。</p>
          </PopoverContent>
        </Popover>
        {!members.users.length && <span className="text-xs text-muted-foreground">選択できるメンバーがいません。</span>}
      </>}
    </div>
  </fieldset>;
}
