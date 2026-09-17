import { incomingSourceUsable } from '@/lib/secretary/incoming';
import type { IncomingDecision } from '@/lib/secretary/incomingDecisions';
import type { GoogleSource } from '@/lib/google/workspace/types';
import type { HistoryEntry, TaskHistoryPage } from './types';
export interface PrivateSourceContext {
  userId: string; email: string | null; allowedProject: boolean; checkedAt: string;
  sources?: Record<'gmail' | 'chat', GoogleSource>;
}
function belongsToAccount(decision: IncomingDecision, context: PrivateSourceContext) {
  try {
    // Existing secretary keys bind a linkage to its owner and Google account.
    // Current authorization is checked directly, rather than replaying old cached excerpts.
    const key: unknown = JSON.parse(decision.key);
    return Array.isArray(key) && key[0] === context.userId && key[1] === context.email;
  } catch { return false; }
}
/** Only explicitly linked, currently permitted sources belonging to this viewer are exposed. */
export function taskPrivateSources(decisions: IncomingDecision[], context: PrivateSourceContext, taskKey: string): NonNullable<TaskHistoryPage['privateSources']> {
  const linked = decisions.filter(d => d.status !== 'cleared' && d.related.some(r => r.key === taskKey));
  const entries = new Map<string, HistoryEntry>();
  let unavailableLinks = 0;
  for (const decision of linked) {
    if (!context.allowedProject || !belongsToAccount(decision, context)) { unavailableLinks++; continue; }
    let missing = false;
    for (const source of decision.sources) {
      const current = context.sources?.[source.service];
      const item = current && incomingSourceUsable(current, context.checkedAt) ? current.items.find(i => i.id === source.id) : undefined;
      if (!item) { missing = true; continue; }
      const key = `${source.service}:${source.id}`;
      entries.set(key, { id: key, kind: source.service, title: item.title,
        text: item.text.slice(0, 600), actor: item.sourceName, at: item.at || null,
        recordedAt: decision.updatedAt, url: item.url, private: true });
    }
    if (missing) unavailableLinks++;
  }
  const sources = context.allowedProject ? context.sources : undefined;
  const issues = ['本人が関連付けた連絡のうち、現在許可され取得できた範囲です。メール・Chatの全履歴ではありません。'];
  if (unavailableLinks) issues.push(`${unavailableLinks}件の関連付けは現在の取得範囲外です。共有済みのタスク状態は保持しています。`);
  if (!sources) issues.push('メール・Chatの接続またはAI利用の許可範囲を確認できません。');
  for (const [name, source] of Object.entries(sources ?? {})) {
    if (!source.connected) continue;
    const label = name === 'gmail' ? 'Gmail' : 'Chat';
    issues.push(`${label}: ${!incomingSourceUsable(source, context.checkedAt) ? '未取得・前回取得分は現在利用できません' : source.status === 'partial' ? '一部取得' : '選択範囲を取得'}${source.fetchedAt ? `（前回取得 ${source.fetchedAt}）` : ''}。`);
  }
  return { entries: [...entries.values()], unavailableLinks, issues,
    status: !sources ? 'unavailable' : unavailableLinks || Object.values(sources).some(s => s.connected && (s.status !== 'ready' || !incomingSourceUsable(s, context.checkedAt))) ? 'partial' : 'ready' };
}
