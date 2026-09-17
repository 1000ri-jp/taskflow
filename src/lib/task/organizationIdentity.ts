import type { OrganizationBasis, OrganizationDraft, OrganizationSource } from './organizationTypes';
import { OrganizationError, type OrganizationData, type OrganizationWrite } from './organizationEngine';

export function canonicalOrganizationValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(canonicalOrganizationValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalOrganizationValue(item)]));
  return value;
}
export async function organizationFingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalOrganizationValue(value)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
export const organizationSourceFingerprint = (source: OrganizationSource) => organizationFingerprint({
  kind: source.kind, text: source.text.replace(/\r\n?/g, '\n').trim(),
  occurredAt: source.occurredAt ? new Date(source.occurredAt).toISOString() : null,
  ...(source.kind === 'incoming' ? { incoming: source.incoming } : {}),
});
export function organizationChangeContent(draft: OrganizationDraft) {
  const { reason, quote, speech, confirmationPoints, aiSuggested, ...change } = draft;
  void reason; void quote; void speech; void confirmationPoints; void aiSuggested;
  return { ...change, taskIds: [...change.taskIds].sort(), ...(change.assigneeIds ? { assigneeIds: [...new Set(change.assigneeIds)].sort() } : {}),
    ...(change.kind === 'update' ? { descriptionMode: change.descriptionMode ?? 'append' } : {}) };
}

/** New task placement is computed again after unrelated creations; all actual
 * task content and all changes to existing rows must still match the preview. */
export function organizationComparableWrites(writes: readonly OrganizationWrite[]) {
  return writes.map(write => {
    if (write.before !== null || write.path.split('/').length !== 2) return write;
    const { order, ...after } = write.after;
    void order;
    return { ...write, after };
  });
}

/** The graph component read by the planner, including newly attached children. */
export function organizationScopeIds(data: Pick<OrganizationData, 'tasks'>, ids: readonly string[]): string[] {
  const result = new Set(ids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, task] of Object.entries(data.tasks)) {
      const policy = task.completionPolicy as { required?: { taskId?: string }[] } | undefined;
      const links = [task.parentTaskId, ...(Array.isArray(task.dependsOnTaskIds) ? task.dependsOnTaskIds : []),
        ...(Array.isArray(policy?.required) ? policy.required.map(item => item.taskId) : [])].filter((value): value is string => typeof value === 'string' && !!value);
      if (!result.has(id) && !links.some(link => result.has(link))) continue;
      for (const value of [id, ...links]) if (!result.has(value)) { result.add(value); changed = true; }
    }
  }
  return [...result].sort();
}
export function organizationScope(data: Pick<OrganizationData, 'tasks' | 'children' | 'defaultAssigneeId' | 'listDefaultAssigneeIds' | 'listIds'>, ids: readonly string[]) {
  const scope = organizationScopeIds(data, ids);
  return { defaultAssigneeId: data.defaultAssigneeId ?? null,
    listDefaultAssigneeIds: data.listDefaultAssigneeIds ?? {}, listIds: data.listIds,
    tasks: Object.fromEntries(scope.map(id => [id, data.tasks[id] ?? null])),
    children: Object.fromEntries(Object.entries(data.children).filter(([path]) => scope.includes(path.split('/')[1]))) };
}
export async function createOrganizationBasis(projectId: string, source: OrganizationSource, data: Pick<OrganizationData, 'tasks' | 'children'>): Promise<OrganizationBasis> {
  const tasks = await Promise.all(Object.entries(data.tasks).map(async ([id, task]) => {
    const children = (kind: string) => Object.fromEntries(Object.entries(data.children).filter(([path]) => path.startsWith(`tasks/${id}/${kind}/`)));
    const [taskVersion, commentsVersion, checklistsVersion] = await Promise.all([
      organizationFingerprint(task), organizationFingerprint(children('comments')), organizationFingerprint(children('checklists')),
    ]);
    return [id, { taskVersion, commentsVersion, checklistsVersion }] as const;
  }));
  return { schema: 1, projectId, sourceFingerprint: await organizationSourceFingerprint(source), tasks: Object.fromEntries(tasks) };
}
export async function organizationBasisMatches(basis: OrganizationBasis, projectId: string, source: OrganizationSource, data: Pick<OrganizationData, 'tasks' | 'children'>, ids: readonly string[]): Promise<boolean> {
  if (!basis || basis.schema !== 1 || basis.projectId !== projectId || !basis.tasks || typeof basis.tasks !== 'object' || Array.isArray(basis.tasks)
    || Object.keys(basis.tasks).length > 200 || basis.sourceFingerprint !== await organizationSourceFingerprint(source)) return false;
  const current = await createOrganizationBasis(projectId, source, { tasks: Object.fromEntries(organizationScopeIds(data, ids).filter(id => data.tasks[id]).map(id => [id, data.tasks[id]])), children: data.children });
  return organizationScopeIds(data, ids).every(id => JSON.stringify(canonicalOrganizationValue(basis.tasks[id] ?? null)) === JSON.stringify(canonicalOrganizationValue(current.tasks[id] ?? null)));
}
export async function assertOrganizationBasis(projectId: string, source: OrganizationSource, data: Pick<OrganizationData, 'tasks' | 'children'>, draft: OrganizationDraft, rawBasis: unknown): Promise<void> {
  if (rawBasis === undefined) return; // A manually entered proposal has no analysis snapshot.
  if (!await organizationBasisMatches(rawBasis as OrganizationBasis, projectId, source, data, [...draft.taskIds, ...(draft.targetTaskId ? [draft.targetTaskId] : [])])) {
    throw new OrganizationError('分析後に対象の仕事・コメント・手順が更新されました。最新の情報で照合し直してください。',409);
  }
}
