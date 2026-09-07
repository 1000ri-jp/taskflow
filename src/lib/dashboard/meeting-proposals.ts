import type { DashboardTask } from './brief';
import { MEETING_PROPOSALS } from './meeting-memo-v2';
export { MEETING_PROPOSALS, MEETING_PARENTS, MEETING_CONFIRMATIONS } from './meeting-memo-v2';

export const MEETING_ID = 'meeting-date-unconfirmed-v2';
export const MEETING_DATE_NOTE = '会議日：2026/9/2との記載 ／ 録音日時：2026/9/3 08:58 JST。会議日・実施日・公式期限は確認待ち。';
export interface MeetingProposal {
  id: string;
  parentId: string;
  sourceId: string;
  sourceRefs: string[];
  title: string;
  projects: string[];
  owner: string;
  dueDate: string;
  timing: string;
  content: string;
  completion: string;
  dependencies: string[];
  dependencyConditions: string;
  priority: 'P1' | 'P2' | 'P3' | '未指定';
  taskStatus: string;
  kind: 'action' | 'idea';
  sourceExcerpt: string;
  questions: string[];
  cautions: string[];
  aliases: string[];
  reason: string;
}
export const MEETING_ACTIONS = MEETING_PROPOSALS.filter(p => p.kind === 'action');
export const MEETING_IDEAS = MEETING_PROPOSALS.filter(p => p.kind === 'idea');
export const FOCUS_PROPOSAL_IDS = ['EX-1', 'EX-3', 'MO-date'];

// Supplementary guard, not a general-purpose secret scanner. Existing task
// descriptions are never rendered in the proposal UI.
export function containsMeetingSecret(value: string): boolean {
  return /(?:password|passwd|pwd|パスワード|暗証番号|api[_ -]?key|access[_ -]?token|secret|認証情報)\s*[:=：]\s*\S+|Bearer\s+[\w.+/=-]+|-----BEGIN[\s\S]*PRIVATE KEY-----|\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{8,}|https?:\/\/[^\s/@:]+:[^\s/@]+@/i.test(value);
}
export const safeMeetingText = (value: string) => containsMeetingSecret(value) ? '認証情報の可能性があるため非表示' : value;
export type ProposalCategory = '新規候補' | '更新候補' | '要確認' | '検討候補' | '照合待ち';
export interface ProposalMatch { category: ProposalCategory; candidates: DashboardTask[]; notes: string[] }
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');

export function matchMeetingProposal(proposal: MeetingProposal, tasks: DashboardTask[], projects: { id: string; name: string; isArchived?: boolean }[], ready: boolean): ProposalMatch {
  if (proposal.kind === 'idea') return { category: '検討候補', candidates: [], notes: ['実行タスクにはしません。コアの表示改善が完了するまで実装しない候補です。'] };
  if (!ready) return { category: '照合待ち', candidates: [], notes: ['既存タスクを取得できるまで、新規／更新を判定しません。'] };
  const projectIds = new Set(projects.filter(p => !p.isArchived && proposal.projects.some(name => normalize(name) === normalize(p.name))).map(p => p.id));
  if (!projectIds.size) return { category: '要確認', candidates: [], notes: ['登録先候補のプロジェクトが見つかりません。プロジェクトを確認してください。'] };
  const aliases = [proposal.title, ...proposal.aliases].map(normalize).filter(Boolean);
  const candidates = tasks.filter(task => projectIds.has(task.projectId) && !task.isArchived && aliases.some(alias => {
    const title = normalize(task.title);
    return title === alias || (alias.length >= 6 && title.includes(alias));
  }));
  const notes: string[] = [];
  if (candidates.length > 1) notes.push('既存候補が複数あります。更新対象を確認してください。');
  if (candidates.some(task => task.isCompleted || task.isAbandoned)) notes.push('完了・中止済みの候補が含まれます。再開や再登録は自動で行いません。');
  if (proposal.parentId === 'MO' && candidates.some(task => /ココナラ|3名/.test(task.title))) notes.push('既存の募集条件と新版の人数・料金・販売先が同じかを確認してください。複数の提案が同じタスクに一致しても自動統合しません。');
  if (!candidates.length) notes.push('題名照合で一致する既存タスクは見つかりません。別の題名の重複がないか確認が必要です。');
  const needsConfirmation = proposal.questions.length > 0 || !proposal.owner || proposal.projects.length > 1 || candidates.length > 1 || candidates.some(t => t.isCompleted || t.isAbandoned);
  return { category: needsConfirmation ? '要確認' : candidates.length ? '更新候補' : '新規候補', candidates, notes };
}
