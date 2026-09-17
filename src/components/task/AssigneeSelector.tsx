'use client';

import { useState, useEffect } from 'react';
import { User, UserPlus, X, Check } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ControlHint } from '@/components/ui/control-hint';
import { cn } from '@/lib/utils';
import { getUsersByIds } from '@/lib/firebase/firestore';
type AssigneePerson = { id: string; displayName: string; photoURL?: string | null; email?: string };

interface AssigneeSelectorProps {
  compact?: boolean;
  membersOverride?: AssigneePerson[];
  assigneeIds: string[];
  projectMemberIds: string[];
  onUpdate: (assigneeIds: string[]) => void;
}

export function AssigneeSelector({
  compact = true,
  membersOverride,
  assigneeIds,
  projectMemberIds,
  onUpdate,
}: AssigneeSelectorProps) {
  const [loadedMembers, setMembers] = useState<AssigneePerson[]>([]);
  const [loadedAssignees, setAssignees] = useState<AssigneePerson[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const members = membersOverride ?? loadedMembers;
  const assignees = membersOverride ? membersOverride.filter(member => assigneeIds.includes(member.id)) : loadedAssignees;

  // Fetch project members
  useEffect(() => {
    if (membersOverride) return;
    if (projectMemberIds.length > 0) {
      getUsersByIds(projectMemberIds).then(setMembers);
    }
  }, [projectMemberIds, membersOverride]);

  // Fetch current assignees
  useEffect(() => {
    if (membersOverride) return;
    let isMounted = true;
    if (assigneeIds.length > 0) {
      getUsersByIds(assigneeIds).then((users) => {
        if (isMounted) setAssignees(users);
      });
    } else {
      Promise.resolve().then(() => {
        if (isMounted) setAssignees([]);
      });
    }
    return () => {
      isMounted = false;
    };
  }, [assigneeIds, membersOverride]);

  const compactAssignees = assigneeIds.map(id => {
    const person = assignees.find(person => person.id === id) ?? members.find(person => person.id === id);
    return { id, person, name: person?.displayName.trim() || '名前を確認できないメンバー' };
  });
  const assigneeNames = compactAssignees.map(person => person.name).join('、');

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const handleToggleAssignee = (userId: string) => {
    const newAssigneeIds = assigneeIds.includes(userId)
      ? assigneeIds.filter((id) => id !== userId)
      : [...assigneeIds, userId];
    onUpdate(newAssigneeIds);
  };

  const handleRemoveAssignee = (userId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newAssigneeIds = assigneeIds.filter((id) => id !== userId);
    onUpdate(newAssigneeIds);
  };

  return (
    <div className={cn('flex min-w-0 items-center gap-2 text-sm', compact ? 'shrink-0' : 'py-2')}>
      {!compact && <User className="h-4 w-4 shrink-0 text-muted-foreground" />}
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        {compact ? <ControlHint label={assigneeIds.length ? `担当者（${assigneeIds.length}人）` : '担当者を追加'} description={assigneeIds.length ? assigneeNames : undefined}>
          <PopoverTrigger asChild>
            <button type="button" aria-label={assigneeIds.length ? `担当者（${assigneeIds.length}人）: ${assigneeNames}` : '担当者を追加'} className={cn('inline-flex h-8 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring', assigneeIds.length > 0 ? 'px-0.5' : 'w-8')}>
              {assigneeIds.length ? <span className="flex -space-x-2" aria-hidden="true">
                {compactAssignees.slice(0, 3).map(({ id, person, name }) => <Avatar key={id} className="h-7 w-7 border-2 border-background" title={name}>
                  <AvatarImage src={person?.photoURL || ''} alt={name} />
                  <AvatarFallback className="text-[10px] text-foreground">{person?.displayName.trim() ? getInitials(person.displayName) : '?'}</AvatarFallback>
                </Avatar>)}
                {assigneeIds.length > 3 && <span className="relative inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-background bg-muted text-[10px] font-medium text-foreground">+{assigneeIds.length - 3}</span>}
              </span> : <UserPlus aria-hidden="true" className="h-4 w-4" />}
            </button>
          </PopoverTrigger>
        </ControlHint> : <PopoverTrigger asChild>
          <div className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left">
            {assignees.length > 0 ? (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {assignees.map((assignee) => (
                  <div
                    key={assignee.id}
                    className="flex max-w-full items-center gap-1.5 rounded-full bg-muted py-0.5 pl-0.5 pr-2"
                  >
                    <Avatar className="h-6 w-6">
                      <AvatarImage src={assignee.photoURL || ''} alt={assignee.displayName} />
                      <AvatarFallback className="text-xs">
                        {getInitials(assignee.displayName)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="truncate text-sm" title={assignee.displayName}>{assignee.displayName}</span>
                    <button
                      type="button"
                      onClick={(e) => handleRemoveAssignee(assignee.id, e)}
                      className="rounded-full p-0.5 hover:bg-muted-foreground/20"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <span className="text-muted-foreground">担当者を追加</span>
            )}
          </div>
        </PopoverTrigger>}
        <PopoverContent className="w-64 p-2" align="start" aria-label="担当者を選択">
          <p className="mb-2 px-2 text-sm font-medium">担当者を選択</p>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {members.length > 0 ? (
              members.map((member) => (
                <button
                  key={member.id}
                  onClick={() => handleToggleAssignee(member.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors hover:bg-muted',
                    assigneeIds.includes(member.id) && 'bg-muted'
                  )}
                >
                  <Avatar className="h-7 w-7">
                    <AvatarImage src={member.photoURL || ''} alt={member.displayName} />
                    <AvatarFallback className="text-xs">
                      {getInitials(member.displayName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 text-left">
                    <p className="font-medium">{member.displayName}</p>
                    <p className="text-xs text-muted-foreground">{member.email}</p>
                  </div>
                  {assigneeIds.includes(member.id) && (
                    <Check className="h-4 w-4 text-primary" />
                  )}
                </button>
              ))
            ) : (
              <p className="px-2 py-4 text-center text-sm text-muted-foreground">
                プロジェクトメンバーがいません
              </p>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
