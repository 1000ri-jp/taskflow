export type EvidenceStage = 'in_production' | 'application' | 'registered' | 'ordered' | 'paid' | 'shipped' | 'expected' | 'received' | 'cancelled' | 'refunded';
export type CompletionCriterion = 'tracking' | 'purchase' | 'registration' | 'receipt';
export type AutomationCheck = 'confirmed' | 'unconfirmed' | 'partial' | 'unavailable' | 'conflict' | 'revoked';
/** Shared facts only. Private message text, IDs and URLs stay in the owner's secretary document. */
export interface TaskAutomationSummary {
  merchant?: string; sourceCommentId?: string;
  stage: EvidenceStage | null; check: AutomationCheck; checkedAt: string;
  evidenceAt: string | null; ownerId: string; expectedDate: string | null;
}
export interface AllChildrenCompletionPolicy {
  kind: 'all_required_children'; condition: string;
  required: { taskId: string; assigneeId: string }[];
  grantedBy: string; grantedAt: string;
  /** Owned completion can be reopened; a manual completion is never claimed. */
  completedByAutomation?: boolean;
  completedVersion?: string;
}
export interface TaskEvidenceRule {
  order?: import('./purchase/types').PurchaseIdentity;
  projectId: string; taskId: string; enabled: boolean;
  subject: string; period: string; person: string; sender: string;
  criterion: CompletionCriterion; allowExpectedDate: boolean;
  sources: ('gmail' | 'comment')[];
}
export interface TaskEvidence {
  id: string; version: string; source: 'gmail' | 'comment';
  at: string; text: string; sender: string; authorId: string; url: string;
}
export interface EvidenceResult {
  evidence: TaskEvidence; stage: EvidenceStage; expectedDate: string | null;
}
export interface AutomationWorkSnapshot {
  automation?: TaskAutomationSummary | null;
  isCompleted: boolean; completedAt: string | null; dueDate: string | null;
  /** Optional so records created before ETA schedule consistency remain readable. */
  isDueDateFixed?: boolean; durationDays?: number | null;
}
export interface AutomationRecord {
  expectedDate?: string | null;
  ruleVersion?: string;
  id: string; at: string; source: 'gmail' | 'comment'; sourceId: string; sourceVersion: string;
  evidenceAt: string; sourceUrl: string; stage: EvidenceStage;
  before: AutomationWorkSnapshot;
  after: AutomationWorkSnapshot;
  afterVersion: string; undone: boolean;
}
export interface AutomationGrant {
  rule: TaskEvidenceRule; uid: string; grantedAt: string; notBefore: string;
  connectionEpoch: string | null; expectedTaskVersion: string;
  check: AutomationCheck; checkedAt: string | null; reason: string;
  latestEvidenceAt: string | null; stage: EvidenceStage | null;
  ownedCompletion: boolean; records: AutomationRecord[];
}
export interface AutomationReminder {
  projectId: string; taskId: string; dueDate: string; snoozedUntil: string | null;
  notifiedSignature: string | null; sequence: number;
}
export interface AutomationState {
  automationEnabled: boolean; revision: number; uid: string;
  grants: AutomationGrant[]; reminders: AutomationReminder[];
}
export interface AutomationView {
  revision: number; grants: AutomationGrant[];
  reminders: AutomationReminder[]; backgroundConfigured: boolean;
}
export const STAGE_LABELS: Record<EvidenceStage, string> = {
  in_production: '印刷中', application: '申込受付', registered: '登録完了', ordered: '注文成立', paid: '支払・購入完了',
  shipped: '発送済み', expected: '到着予定', received: '受取済み', cancelled: '取消', refunded: '返金',
};
export const CHECK_LABELS: Record<AutomationCheck, string> = {
  confirmed: '確認済み', unconfirmed: '明確な根拠は未確認', partial: '取得範囲の一部',
  unavailable: '取得できません', conflict: '編集後のため自動更新を停止', revoked: '許可を確認できません',
};
