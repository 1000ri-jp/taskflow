import type { GoogleSource } from '@/lib/google/workspace/types';
import type { IncomingContext, IncomingReview } from './incoming';
import type { IncomingDecision } from './incomingDecisions';
export type Disposition = 'execute' | 'candidate' | 'hold' | 'wait' | 'unneeded' | 'complete';
export type Speech = 'request' | 'progress' | 'question' | 'idea' | 'hold' | 'reference';
export type Commitment = 'confirmed' | 'considering' | 'unknown';
export interface SourceComment { id: string; content: string; authorId: string; createdAt: string }
export interface TaskContext {
  projectDescription: string;
  parentState: 'unset' | 'ready' | 'missing';
  parent: { taskId: string; title: string; description: string; assigneeIds: string[]; isCompleted: boolean; isAbandoned: boolean } | null;
  milestoneState: 'unset' | 'ready' | 'missing' | 'not_requested';
  milestone: { kind?: 'date'|'achievement'; achievementCondition?: string; requiredTaskIds?: string[]; id: string; title: string; description: string; status: string; dueDate: string | null } | null;
  taskKind: 'task' | 'review_request' | 'decision';
  completionCriteria?: string;
  primaryAssigneeId?: string | null;
  workProgress?: string;
  review?: import('@/lib/task/workflow').ReviewCycle;
  sourceComment: { taskId: string; commentId: string } | null;
}
export interface SecretaryChecklist { id: string; title: string; items: { id: string; text: string; isChecked: boolean }[] }
export interface SecretaryTask {
  checklists?: SecretaryChecklist[];
  checklistStatus?: 'ready' | 'unavailable' | 'not_requested';
  workState?: import('@/types').TaskWorkState | null;
  key: string; projectId: string; taskId: string; projectName: string;
  title: string; description: string; listName: string; assigneeIds: string[];
  startDate: string | null; dueDate: string | null; isDueDateFixed: boolean;
  durationDays?: number | null;
  dependsOn: string[]; priority: string | null;
  isCompleted: boolean; isAbandoned: boolean; isArchived: boolean; completedAt: string | null;
  comments: SourceComment[]; complete: boolean; canWrite: boolean; version: string;
  context?: TaskContext;
}
export interface SecretarySnapshot {
  userId: string; checkedAt: string; signature: string; tasks: SecretaryTask[];
  calendar?: GoogleSource;
  incoming?: IncomingContext;
  coverage: { status: 'ready' | 'empty' | 'partial'; issues: string[]; projects: number; excludedProjects: number };
}
export interface Evidence { source: string; quote: string }
export type ReviewBasis = { kind: 'due_date'; leadDays: number } | { kind: 'comment_date'; commentId: string; date: string } | null;
export interface DecisionNeed { question: string; whyNow: string; consequence: string }
export interface Interpretation {
  decision?: DecisionNeed;
  key: string; speech: Speech; commitment: Commitment; disposition: Disposition;
  reason: string; trigger: string; review: ReviewBasis; uncertainties: string[];
  evidence: Evidence[]; duplicateOf: string | null; estimateMinutes: number | null;
}
export interface Proposal extends Interpretation {
  policyVersion?: number;
  relatedVersions: { key: string; version: string | null }[];
  id: string; sourceVersion: string; snapshotSignature: string; createdAt: string;
  reviewAt: string | null; status: 'pending' | 'accepted' | 'rejected' | 'applied' | 'undone';
}
export interface PersonalDecision {
  key: string; disposition: Disposition; reason: string; trigger: string;
  reviewAt: string | null; sourceVersion: string; updatedAt: string;
  correction: string | null; nonce: string;
  correctionPending?: boolean;
}
export interface TaskStatusPatch { isCompleted: boolean; isAbandoned: boolean; completedAt: string | null }
export interface TaskSchedulePatch { dueDate: string | null; durationDays: number | null; isDueDateFixed: boolean }
export type SecretaryTaskPatch = Partial<TaskStatusPatch & TaskSchedulePatch>;
export type SecretaryAction = 'accept' | 'next_week' | 'next_month' | 'reschedule' | 'unneeded' | 'correct' | 'complete' | 'cancel' | 'undo';
export interface SecretaryHistory {
  id: string; key: string; proposalId: string; action: SecretaryAction;
  at: string; beforeDecision: PersonalDecision | null; afterNonce: string;
  beforeTask: SecretaryTaskPatch | null; afterTask: SecretaryTaskPatch | null;
  afterVersion: string | null; undone: boolean;
}
export interface SecretaryState {
  reviewPolicyVersion?: number;
  schema: 1; revision: number; observedSignature: string | null; reviewedAt: string | null;
  proposals: Proposal[]; decisions: PersonalDecision[]; history: SecretaryHistory[];
  incomingReview?: IncomingReview;
  incomingDecisions?: IncomingDecision[];
}
export interface SecretaryView { snapshot: SecretarySnapshot; state: SecretaryState; needsReview: boolean; mode: 'live' | 'mock'; reviewWarnings?: string[]; incomingStorage?: { count: number; inactive: number; heldInactive: number } }
export interface ActionRequest { action: SecretaryAction; proposalId: string; revision: number; correction?: string; dueDate?: string; taskKey?: string; sourceVersion?: string }
export const emptySecretaryState = (): SecretaryState => ({ schema: 1, revision: 0, observedSignature: null, reviewedAt: null, proposals: [], decisions: [], history: [] });
