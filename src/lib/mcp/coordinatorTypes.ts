/** Shared coordination contracts. Plans contain AI judgments, never inferred keyword rules. */
export type CoordinationKind = 'research' | 'draft' | 'implementation' | 'human';
export interface CoordinationCapability {
  id: string; name: string; kinds: Exclude<CoordinationKind, 'human'>[];
  executor: 'dot_native' | 'local_worker'; status: 'verified' | 'transport_required';
  availability: 'connected' | 'local_only'; evidence: string[];
  scope: { projectIds: string[]; sourceIds: string[] }; constraints: string[];
  transport: { type: 'mcp' | 'file_job'; supported: boolean; gap?: string };
  requiresHumanReview: boolean;
}
export interface CoordinationPolicy {
  enabled: boolean; mode: 'propose' | 'active'; aiMemberId: string;
  humanReviewers: string[]; humans: { id: string; skills: string[]; availability: string }[];
  capabilities: CoordinationCapability[]; maxLeaseSeconds: number; requireHumanReview: boolean;
}
export interface CoordinationExecutionInput {
  sourceId: string; files: { path: string; expectedSha256: string | null }[]; prompt: string;
  checks: { type: 'node_syntax' | 'node_test' | 'json_validate'; path: string }[]; reviewerIds?: string[];
}
export interface CoordinationWorkInput {
  id: string; title: string; description: string; kind: CoordinationKind;
  assigneeType: 'ai' | 'human'; assigneeId: string; capabilityId: string | null;
  dependsOn: string[]; acceptanceCriteria: string[]; taskId?: string; execution?: CoordinationExecutionInput;
}
export interface CoordinationPlanInput {
  inputFingerprint: string; rationale: string; works: CoordinationWorkInput[];
}
export interface CoordinationArtifact { label: string; url: string }
export interface CoordinationCheck { name: string; passed: boolean; detail: string }
export interface CoordinationCheckpointInput {
  work_id: string; lease_token: string; summary: string;
  artifacts?: CoordinationArtifact[]; checks?: CoordinationCheck[]; review_task_id?: string;
}
export interface CoordinationWaitInput { work_id: string; lease_token?: string; question: string; comment_id: string; comment_version: string }
export interface CoordinationResumeInput { work_id: string; answer_comment_id: string; answer_comment_version: string }
export type CoordinationWorkState = 'planned' | 'ready' | 'running' | 'waiting_human' | 'awaiting_review' | 'changes_requested' | 'done' | 'cancelled';
export interface CoordinationWork extends CoordinationWorkInput {
  taskId: string; existingTask: boolean; requiresHumanReview: boolean; executionRevision: number; needsReconciliation: boolean;
  invalidation: { workId: string; reason: string; at: string; evidence: { kind: 'comment' | 'review' | 'task'; id: string; version: string } | null } | null;
  previousReviewTaskIds: string[]; status: CoordinationWorkState;
  lease: { token: string; workerId: string; expiresAt: string } | null;
  startedAt: string | null; checkpoint: { summary: string; artifacts: CoordinationArtifact[]; checks: CoordinationCheck[]; at: string } | null;
  waiting: { question: string; commentId: string; commentVersion: string } | null;
  reviewTaskId: string | null; humanEvidence: { kind: 'comment' | 'review' | 'task'; id: string; version: string } | null;
}
export interface CoordinationPlan {
  id: string; parentTaskId: string; policyVersion: string; inputFingerprint: string; rationale: string;
  status: 'proposed' | 'active' | 'completed' | 'cancelled'; works: CoordinationWork[];
  reviewTaskIds: string[]; humanTaskIds: string[];
  createdAt: string; updatedAt: string; createdBy: string;
}
