'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { subscribeToProjectMilestones } from '@/lib/firebase/firestore';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import type { Milestone, Project } from '@/types';
import type { CountdownMilestone } from '@/lib/dashboard/countdown';

export function useCountdownMilestones(projects: Pick<Project, 'id' | 'name'>[]) {
  const userId = useAuthStore(state => state.firebaseUser?.uid);
  const key = JSON.stringify([userId, projects.map(p => p.id).sort()]);
  const scope = useMemo(() => ({ key }), [key]);
  const [state, setState] = useState<{ scope: typeof scope | null; items: Map<string, Milestone[]>; errors: Map<string, Error> }>({ scope: null, items: new Map(), errors: new Map() });
  useEffect(() => {
    if (!userId) return;
    let active = true;
    const ids = (JSON.parse(scope.key) as [string, string[]])[1];
    const receive = (id: string, items: Milestone[], error?: Error) => {
      if (!active) return;
      setState(previous => {
        const itemsMap = new Map(previous.scope === scope ? previous.items : []);
        const errors = new Map(previous.scope === scope ? previous.errors : []);
        itemsMap.set(id, items); errors.delete(id); if (error) errors.set(id, error);
        return { scope, items: itemsMap, errors };
      });
    };
    if (isE2EMockAuthEnabled()) {
      const sync = () => { void import('@/lib/task/organizationMock').then(({ readOrganizationMock }) => ids.forEach(id => receive(id, readOrganizationMock(id).milestones ?? []))).catch(error => ids.forEach(id => receive(id, [], error))); };
      sync(); window.addEventListener('taskflow-work-updated', sync); window.addEventListener('storage', sync);
      return () => { active = false; window.removeEventListener('taskflow-work-updated', sync); window.removeEventListener('storage', sync); };
    }
    const stops = ids.map(id => subscribeToProjectMilestones(id, items => receive(id, items), error => receive(id, [], error)));
    return () => { active = false; stops.forEach(stop => stop()); };
  }, [scope, userId]);
  const milestones: CountdownMilestone[] = state.scope === scope ? projects.flatMap(project => (state.items.get(project.id) ?? []).map(item => ({ ...item, projectId: project.id, projectName: project.name }))) : [];
  return { milestones, isLoading: Boolean(userId) && projects.length > 0 && (state.scope !== scope || state.items.size < projects.length), error: state.scope === scope ? state.errors.values().next().value ?? null : null };
}
