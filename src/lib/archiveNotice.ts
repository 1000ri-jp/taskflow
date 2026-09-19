type ArchiveKind = 'task' | 'project';
const sessionAcknowledged = new Set<string>();
const key = (userId: string, kind: ArchiveKind) => `taskflow.archiveNotice.v1:${kind}:${userId}`;

export function hasAcknowledgedArchive(userId: string | undefined, kind: ArchiveKind) {
  if (!userId) return false;
  try { return localStorage.getItem(key(userId, kind)) === 'acknowledged' || sessionAcknowledged.has(key(userId, kind)); }
  catch { return sessionAcknowledged.has(key(userId, kind)); }
}

export function acknowledgeArchive(userId: string | undefined, kind: ArchiveKind) {
  if (!userId) return;
  try {
    localStorage.setItem(key(userId, kind), 'acknowledged');
    sessionAcknowledged.delete(key(userId, kind));
  } catch { sessionAcknowledged.add(key(userId, kind)); }
}
