'use client';

import { UserRound } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ControlHint } from '@/components/ui/control-hint';
import type { User } from '@/types';

export type ProjectMemberProfile = Pick<User, 'id' | 'displayName'> & Partial<Pick<User, 'photoURL'>>;

export function ProjectMembers({ memberIds: ids, members = [] }: {
  memberIds: readonly string[];
  members?: readonly ProjectMemberProfile[];
}) {
  const memberIds = [...new Set(ids)];
  const memberById = new Map(members.map(member => [member.id, member]));
  const memberName = (id: string) => memberById.get(id)?.displayName || '名前未取得';
  return (
    <div className="flex min-h-7 min-w-0 items-start gap-2 text-sm text-muted-foreground" role="group" aria-label={`参加メンバー: ${memberIds.length ? memberIds.map(memberName).join('、') : 'なし'}`}>
      <span className="inline-flex shrink-0 items-center gap-1 py-1 tabular-nums"><UserRound className="h-3.5 w-3.5" aria-hidden="true" />{memberIds.length}人</span>
      <div className="flex min-w-0 flex-wrap items-center gap-0">
      {memberIds.slice(0, 10).map(id => <ControlHint key={id} label={memberName(id)}><Avatar tabIndex={0} aria-label={memberName(id)} className="h-7 w-7 border-2 border-background">
        <AvatarImage src={memberById.get(id)?.photoURL || ''} alt="" />
        <AvatarFallback aria-hidden="true"><UserRound className="h-4 w-4" /></AvatarFallback>
      </Avatar></ControlHint>)}
      {memberIds.length > 10 && <ControlHint label={`ほか${memberIds.length - 10}人`} description={memberIds.slice(10).map(memberName).join('、')}><span tabIndex={0} aria-label={`ほか${memberIds.length - 10}人`} className="flex h-7 min-w-7 items-center justify-center rounded-full border-2 border-background bg-muted px-1 text-[10px] font-medium">+{memberIds.length - 10}</span></ControlHint>}
      </div>
    </div>
  );
}
