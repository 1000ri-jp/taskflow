'use client';

import { useEffect, useState } from 'react';
import { requestOrganization } from '@/lib/task/organizationClient';
import type { OrganizationPreview } from '@/lib/task/organizationTypes';

type Snapshot = { key: string; records: OrganizationPreview[]; failed: boolean };
export function useOrganizationRecords(userId: string | null, projectIds: string[], enabled = true) {
  const key = JSON.stringify([userId, enabled ? [...new Set(projectIds)].sort() : []]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const [uid, ids] = JSON.parse(key) as [string | null, string[]];
    if (!uid || !ids.length) return;
    let cancelled = false; let running = false; let queued = false;
    const refresh = async () => {
      if (running) { queued = true; return; }
      if (cancelled) return;
      running = true;
      const results = await Promise.allSettled(ids.map(projectId => requestOrganization<OrganizationPreview[]>({ action: 'list', projectId })));
      if (!cancelled) setSnapshot({ key, failed: results.some(result => result.status === 'rejected'), records: results.flatMap((result, index) => result.status === 'fulfilled' ? result.value.filter(item => item.projectId === ids[index]) : []) });
      running = false;
      if (queued && !cancelled) { queued = false; void refresh(); }
    };
    const visible = () => { if (document.visibilityState !== 'hidden') void refresh(); };
    void refresh();
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('taskflow-organization-updated', visible);
    window.addEventListener('taskflow-work-updated', visible);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('taskflow-organization-updated', visible);
      window.removeEventListener('taskflow-work-updated', visible);
    };
  }, [key, revision]);
  const current = snapshot?.key === key ? snapshot : null;
  return { records: current?.records ?? [], failed: current?.failed ?? false, loading: enabled && !!userId && projectIds.length > 0 && !current, refresh: () => setRevision(value => value + 1) };
}
