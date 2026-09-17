/** undefined = use the creation default; [] = deliberately unassigned.
 * An unassigned parent is inherited as unassigned, never replaced by the project default.
 */
export function resolveTaskAssignees({ explicit, parent, defaultAssigneeId, listDefaultAssigneeId, memberIds }: {
  explicit?: readonly string[]; parent?: { assigneeIds: readonly string[] } | null;
  defaultAssigneeId?: string | null; listDefaultAssigneeId?: string | null; memberIds?: readonly string[];
}): string[] {
  if (explicit !== undefined) return [...new Set(explicit)];
  if (parent) return [...new Set(parent.assigneeIds)];
  const isMember = (id: string | null | undefined): id is string => !!id && (!memberIds || memberIds.includes(id));
  const selectedDefault = isMember(listDefaultAssigneeId) ? listDefaultAssigneeId : defaultAssigneeId;
  return isMember(selectedDefault) ? [selectedDefault] : [];
}
