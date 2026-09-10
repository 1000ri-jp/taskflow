import type { DashboardTask } from './brief';
import { MEETING_ACTIONS, type MeetingProposal } from './meeting-proposals';
import { MEETING_ATTENDEES, proposalOwnerNames } from './meeting-review';

export interface ChecklistPlacement { projectId: string; taskId: string; title: string }
export interface ChecklistDraftItem { checked: boolean; dueDate?: string }
export type ChecklistProject = { id: string; name: string; isArchived?: boolean; memberIds?: string[] };
// These two event assignments were explicitly clarified by the user.
export const MEETING_PARENT_HINTS: Record<string, { title: string; aliases: string[] }> = {
  'ex-submit': { title: '東京ゲームダンジョン', aliases: ['東京ゲームダンジョン'] },
  'ex-attend': { title: '東京ゲームショウ', aliases: ['東京ゲームショウ', '東京ゲームショー', '東京ゲームショウ2026', '東京ゲームショー2026'] },
};
const normalize = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s*＊]/g, '');
export function accessibleChecklistTasks(tasks: DashboardTask[], projects: ChecklistProject[]) {
  return tasks.filter(t => !t.isArchived && projects.some(p => !p.isArchived && p.id === t.projectId));
}
export function checklistDestination(bundleId: string, tasks: DashboardTask[], projects: ChecklistProject[], ready: boolean, placement?: ChecklistPlacement) {
  const hint = MEETING_PARENT_HINTS[bundleId];
  if (!ready) return { state: 'loading', title: hint?.title, task: undefined, candidates: [] as DashboardTask[] };
  const accessible = accessibleChecklistTasks(tasks, projects);
  if (placement) {
    const task = accessible.find(t => t.id === placement.taskId && t.projectId === placement.projectId);
    return { state: task ? 'selected' : 'missing', title: task?.title ?? hint?.title, task, candidates: task ? [task] : [] };
  }
  const candidates = hint ? accessible.filter(t => hint.aliases.some(alias => normalize(alias) === normalize(t.title))) : [];
  const task = candidates.length === 1 ? candidates[0] : undefined;
  return { state: task ? 'candidate' : candidates.length ? 'ambiguous' : hint ? 'missing' : 'unset', title: task?.title ?? hint?.title, task, candidates };
}
export function checklistItems(proposal: MeetingProposal, owner = proposal.owner) {
  if (proposal.id !== 'EX-9') return [{ key: proposal.id, owner, label: proposal.title }];
  const entries = proposalOwnerNames(owner).map(name => {
    const attendee = MEETING_ATTENDEES.find(person => person.aliases.some(alias => normalize(alias) === normalize(name)));
    const identity = attendee?.name ?? name;
    return { key: 'EX-9/person/' + encodeURIComponent(normalize(identity)), owner: name, label: name + '：チケット購入' };
  });
  return [...new Map(entries.map(entry => [entry.key,entry])).values()];
}
const ids = new Set(MEETING_ACTIONS.filter(p => p.id !== 'EX-9').map(p => p.id));
export const validChecklistItemKey = (key: string) => ids.has(key) || (key.startsWith('EX-9/person/') && key.length > 12 && key.length <= 400 && !/[\s]/.test(key));
export function validChecklistDate(value: unknown): value is string {
  return typeof value === 'string' && (!value || (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value));
}
