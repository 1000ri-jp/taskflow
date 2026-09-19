import { blockers, hasCurrentEvidence, jstDay, REVIEW_POLICY_VERSION } from './engine';
import type { Proposal, SecretarySnapshot, SecretaryState, SecretaryTask } from './types';

const active = (task: SecretaryTask, snapshot: SecretarySnapshot) => task.assigneeIds.includes(snapshot.userId) && !task.isCompleted && !task.isAbandoned && !task.isArchived;
export function currentDecision(p: Proposal, snapshot: SecretarySnapshot) {
  const task = snapshot.tasks.find(t => t.key === p.key);
  return !!task && active(task, snapshot) && task.complete && snapshot.coverage.status !== 'partial'
    && task.context?.taskKind !== 'review_request' && p.policyVersion === REVIEW_POLICY_VERSION && !!p.decision
    && p.status === 'pending' && jstDay(p.createdAt) === jstDay(snapshot.checkedAt) && hasCurrentEvidence(p, snapshot);
}
/** Ordinary work comes from registered tasks, independently of AI availability. */
export function availableWork(state: SecretaryState, snapshot: SecretarySnapshot) {
  return snapshot.tasks.filter(task => active(task, snapshot) && task.context?.taskKind !== 'review_request'
    && task.checklistStatus === 'ready' && !blockers(task, snapshot, snapshot.checkedAt).length
    && !(task.startDate && task.dueDate && jstDay(task.startDate) > jstDay(task.dueDate))
    && !state.decisions.some(d => d.key === task.key && ['hold', 'wait', 'unneeded'].includes(d.disposition)))
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.key.localeCompare(b.key));
}
export function remainingWork(task: SecretaryTask, snapshot: SecretarySnapshot) {
  return {
    checks: (task.checklists ?? []).flatMap(list => list.items.filter(item => !item.isChecked).map(item => ({ ...item, listId: list.id }))),
    children: snapshot.tasks.filter(child => child.projectId === task.projectId && child.context?.parent?.taskId === task.taskId && !child.isCompleted && !child.isAbandoned && !child.isArchived && child.context?.taskKind !== 'review_request'),
  };
}
export function conflictingSchedules(snapshot: SecretarySnapshot) {
  return snapshot.tasks.filter(task => active(task, snapshot) && task.complete && task.startDate && task.dueDate
    && jstDay(task.startDate) > jstDay(task.dueDate));
}
