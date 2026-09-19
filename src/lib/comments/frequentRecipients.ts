interface Usage { receiptId: string; ids: string[] }
const key = (userId: string, projectId: string) => `taskflow-comment-recipients-v1:${userId}:${projectId}`;
function readUsage(userId: string, projectId: string): Usage[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(key(userId, projectId)) ?? '[]');
    return Array.isArray(data) ? data.filter((item): item is Usage => !!item && typeof item.receiptId === 'string' && Array.isArray(item.ids) && item.ids.every((id: unknown) => typeof id === 'string')).slice(0, 30) : [];
  } catch { return []; }
}
export function frequentRecipientIds(userId: string, projectId: string): string[] {
  const usage = readUsage(userId, projectId);
  const counts = new Map<string, number>();
  usage.forEach(item => item.ids.forEach(id => counts.set(id, (counts.get(id) ?? 0) + 1)));
  // Map insertion order resolves equal counts by most recent use.
  return [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)!);
}
export function rememberRecipients(userId: string, projectId: string, receiptId: string, ids: string[]) {
  if (!ids.length) return;
  const usage = readUsage(userId, projectId);
  if (usage.some(item => item.receiptId === receiptId)) return;
  try { localStorage.setItem(key(userId, projectId), JSON.stringify([{ receiptId, ids: [...new Set(ids)].slice(0, 50) }, ...usage].slice(0, 30))); }
  catch { /* Optional ordering must never turn a successful post into an error. */ }
}
