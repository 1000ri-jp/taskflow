import type { DashboardTask } from './brief';
import { matchMeetingProposal, type MeetingProposal, type ProposalMatch } from './meeting-proposals';

export type MeetingTarget = { mode: 'new' } | { mode: 'existing'; projectId: string; taskId: string };
export type RegistrationGroup = 'existing' | 'new' | 'unresolved';
export interface ReviewMatch extends ProposalMatch { group: RegistrationGroup; confirmed: boolean }
type ProjectScope = { id: string; name: string; isArchived?: boolean; memberIds?: string[] };
export interface MeetingMember { id: string; displayName: string; photoURL?: string | null }
const normalizedProject = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
const matchesProject = (proposal: MeetingProposal, name: string) => proposal.projects.some(p => normalizedProject(p) === normalizedProject(name));

export function resolveReviewMatch(proposal: MeetingProposal, tasks: DashboardTask[], projects: ProjectScope[], ready: boolean, target?: MeetingTarget): ReviewMatch {
  const auto = matchMeetingProposal(proposal, tasks, projects, ready);
  if (!ready) return { ...auto, group: 'unresolved', confirmed: false };
  if (target?.mode === 'new') return { ...auto, candidates: [], group: 'new', confirmed: true, notes: ['人の確認で「新規」として分類しました。まだ登録していません。'] };
  if (target?.mode === 'existing') {
    const task = tasks.find(t => t.projectId === target.projectId && t.id === target.taskId && !t.isArchived && projects.some(p => p.id === t.projectId && !p.isArchived));
    if (!task) return { category: '要確認', candidates: [], group: 'unresolved', confirmed: false, notes: ['対応づけたタスクを現在の参加プロジェクトで確認できません。対応先を選び直してください。'] };
    return { category: '更新候補', candidates: [task], group: 'existing', confirmed: true, notes: ['人の確認で登録済みタスクに対応づけました。まだ変更していません。', ...(task.isCompleted || task.isAbandoned ? ['既存タスクは完了・中止済みです。再開は自動で行いません。'] : [])] };
  }
  const projectFound = projects.some(p => !p.isArchived && matchesProject(proposal, p.name));
  return { ...auto, group: auto.candidates.length ? 'existing' : projectFound ? 'new' : 'unresolved', confirmed: false };
}

// "各自" refers to the three attendees of this meeting, not every company user.
export const MEETING_ATTENDEES = [
  { name: 'Naofumi Higashikawauchi', aliases: ['Naofumi Higashikawauchi', 'Naofumi', '東川内', '東川内さん'] },
  { name: 'こずえ', aliases: ['こずえ', 'こずえさん', 'Kozue'] },
  { name: '脊古香織', aliases: ['脊古香織', '脊古', '脊古さん', 'Kaori', 'かおり', '脊古（かおり）さん'] },
] as const;
const normalizeName = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[\s*＊]/g, '');
export function proposalOwnerNames(owner: string): string[] {
  if (owner.trim() === '各自') return MEETING_ATTENDEES.map(p => p.name);
  return [...new Set(owner.split(/[・、,／/\n]/).map(s => s.trim()).filter(Boolean))];
}
export function resolvedOwners(owner: string, users: MeetingMember[], explicitIds?: string[]) {
  const names = proposalOwnerNames(owner);
  return names.map(name => {
    const attendee = MEETING_ATTENDEES.find(p => p.aliases.some(alias => normalizeName(alias) === normalizeName(name)));
    const aliases: readonly string[] = attendee?.aliases ?? [name];
    const matches = users.filter(user => aliases.some(alias => normalizeName(alias) === normalizeName(user.displayName)) && (!explicitIds || explicitIds.includes(user.id)));
    return { name, userId: matches.length === 1 ? matches[0].id : null, status: matches.length === 1 ? 'matched' : matches.length > 1 ? 'ambiguous' : 'missing' };
  });
}
export function membersForProposal(proposal: MeetingProposal, projects: ProjectScope[], users: MeetingMember[], target?: MeetingTarget) {
  const ids = new Set(projects.filter(p => !p.isArchived && (target?.mode === 'existing' ? p.id === target.projectId : matchesProject(proposal, p.name))).flatMap(p => p.memberIds ?? []));
  return users.filter(u => ids.has(u.id));
}
