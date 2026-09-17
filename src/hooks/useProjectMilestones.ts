'use client';

import { useEffect, useState } from 'react';
import { createMilestone, updateMilestone, subscribeToProjectMilestones } from '@/lib/firebase/firestore';
import { useAuthStore } from '@/stores/authStore';
import type { Milestone } from '@/types';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';

export function useProjectMilestones(projectId: string) {
  const userId = useAuthStore(state => state.user?.id);
  const scope = `${userId ?? ''}:${projectId}`;
  const [state, setState] = useState<{ scope: string; milestones: Milestone[]; error: boolean }>({ scope: '', milestones: [], error: false });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (isE2EMockAuthEnabled()) {
      let active = true;
      const sync = () => { void import('@/lib/task/organizationMock').then(({ readOrganizationMock }) => { if (active) setState({ scope, milestones: readOrganizationMock(projectId).milestones ?? [], error: false }); }).catch(() => { if (active) setState({ scope, milestones: [], error: true }); }); };
      sync(); window.addEventListener('taskflow-work-updated', sync); window.addEventListener('storage', sync);
      return () => { active = false; window.removeEventListener('taskflow-work-updated', sync); window.removeEventListener('storage', sync); };
    }
    if (!userId || !projectId) return;
    return subscribeToProjectMilestones(projectId,
      milestones => setState({ scope, milestones, error: false }),
      () => setState({ scope, milestones: [], error: true }));
  }, [projectId, userId, scope]);
  const onSave = async (data: MilestoneInput, id?: string) => {
    if (!userId || !projectId || state.scope !== scope || state.error || !data.title.trim()) throw new Error('節目の保存準備ができていません');
    if (data.dueDate && !Number.isFinite(data.dueDate.getTime())) throw new Error('日付が不正です');
    const saved = { ...data, title: data.title.trim(), status: data.status ?? 'planned' as const, achievedAt: data.status === 'achieved' ? state.milestones.find(m => m.id === id)?.achievedAt ?? new Date() : null };
    if (isE2EMockAuthEnabled()) {
      const { mutateOrganizationMock } = await import('@/lib/task/organizationMock');
      return mutateOrganizationMock(projectId, state => {
        const entries = state.milestones ?? []; const previous = id ? entries.find(m => m.id === id) : null;
        if (id && !previous) throw new Error('節目が見つかりません');
        const next = { ...(previous ?? { id: crypto.randomUUID(), projectId, createdBy: userId, createdAt: new Date(), order: entries.length }), ...saved, updatedAt: new Date() } as Milestone;
        state.milestones = [...entries.filter(m => m.id !== next.id), next]; return next.id;
      });
    }
    if (id) { await updateMilestone(projectId, id, saved); return id; }
    return createMilestone(projectId, { ...saved, order: Math.max(-1, ...state.milestones.map(item => item.order)) + 1, createdBy: userId });
  };
  const onAdd = (data: MilestoneInput) => onSave(data);
  return { milestones: state.scope === scope ? state.milestones : [], isLoading: state.scope !== scope, error: state.scope === scope && state.error, selectedId, setSelectedId, onAdd, onSave };
}
export type MilestoneInput = Pick<Milestone, 'title' | 'description' | 'dueDate'> & Partial<Pick<Milestone, 'kind' | 'achievementCondition' | 'requiredTaskIds' | 'status'>>;
