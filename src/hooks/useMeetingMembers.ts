'use client';

import { useEffect, useState } from 'react';
import { getUsersByIds } from '@/lib/firebase/firestore';
import type { MeetingMember } from '@/lib/dashboard/meeting-review';

export function useMeetingMembers(projects: { memberIds?: string[]; isArchived?: boolean }[], enabled: boolean) {
  const key = enabled ? JSON.stringify([...new Set(projects.filter(p => !p.isArchived).flatMap(p => p.memberIds ?? []))].sort()) : '[]';
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; users: MeetingMember[]; error: boolean }>({ key: '', users: [], error: false });
  useEffect(() => {
    let active = true;
    const ids: string[] = JSON.parse(key);
    // Promise boundary keeps cleanup effective even if the set of IDs is empty.
    Promise.resolve().then(() => ids.length ? getUsersByIds(ids) : []).then(users => {
      if (active) setState({ key, users: users.filter(u => ids.includes(u.id)).map(u => {
        const member: MeetingMember = { id: u.id, displayName: u.displayName };
        if (u.photoURL) member.photoURL = u.photoURL;
        return member;
      }), error: false });
    }).catch(() => { if (active) setState({ key, users: [], error: true }); });
    return () => { active = false; };
  }, [key, attempt]);
  return { users: state.key === key && enabled ? state.users : [], isLoading: enabled && state.key !== key, hasError: enabled && state.key === key && state.error, refresh: () => { setState({ key: '', users: [], error: false }); setAttempt(a => a + 1); } };
}
