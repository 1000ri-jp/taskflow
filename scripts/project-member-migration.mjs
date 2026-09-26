import { createHash } from 'node:crypto';

const encode = value => JSON.stringify(value);
export function planProjectMembers(projectId, project, documents) {
  if (!project.ownerId || !Array.isArray(project.memberIds)) throw new Error(`${projectId}: missing owner/memberIds`);
  const byUser = new Map();
  for (const { id, data } of documents) {
    if (typeof data.userId !== 'string' || !data.userId || data.userId.includes('/') || !['admin','editor','viewer'].includes(data.role)) throw new Error(`${projectId}: invalid member ${id}`);
    const previous = byUser.get(data.userId);
    if (previous && encode(previous.data) !== encode(data)) throw new Error(`${projectId}: conflicting duplicate member ${data.userId}`);
    byUser.set(data.userId, { id, data });
  }
  // Do not guess roles or silently grant access to array-only members.
  for (const uid of project.memberIds) if (!byUser.has(uid)) throw new Error(`${projectId}: member record missing for ${uid}`);
  if (!byUser.has(project.ownerId) || byUser.get(project.ownerId).data.role !== 'admin') throw new Error(`${projectId}: owner admin record needs review`);
  for (const uid of byUser.keys()) if (!project.memberIds.includes(uid)) throw new Error(`${projectId}: member absent from memberIds: ${uid}`);
  const writes = [];
  for (const [uid, { data }] of byUser) {
    const destination = documents.find(item => item.id === uid);
    if (destination && destination.data.userId !== uid) throw new Error(`${projectId}: destination collision for ${uid}`);
    if (!destination) writes.push({ operation: 'set', id: uid, data });
  }
  for (const { id, data } of documents) if (id !== data.userId) writes.push({ operation: 'delete', id });
  if (writes.length > 450) throw new Error(`${projectId}: too many writes for one transaction`);
  const input = { ownerId: project.ownerId, memberIds: project.memberIds, documents: [...documents].sort((a,b) => a.id.localeCompare(b.id)) };
  return { projectId, fingerprint: createHash('sha256').update(encode(input)).digest('hex'), writes };
}
