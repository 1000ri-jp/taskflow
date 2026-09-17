export type OrganizationKind = 'update' | 'create' | 'parent_child' | 'new_parent' | 'related' | 'dependency' | 'checklist' | 'merge' | 'complete' | 'cancel' | 'hold' | 'wait' | 'resume';
export interface OrganizationBasis {
  schema: 1;
  projectId: string;
  sourceFingerprint: string;
  tasks: Record<string, { taskVersion: string; commentsVersion: string; checklistsVersion: string }>;
}
export interface OrganizationSource {
  kind: 'meeting' | 'manual' | 'existing' | 'incoming';
  id: string;
  title: string;
  text: string;
  occurredAt: string | null;
  version?: string;
  incoming?: { service: 'gmail' | 'chat'; id: string; version: string; connectionEpoch?: string };
}
export interface OrganizationDraft {
  aiSuggested?: boolean;
  kind: OrganizationKind;
  taskIds: string[];
  targetTaskId?: string;
  title?: string;
  description?: string;
  descriptionMode?: 'append' | 'replace';
  confirmationPoints?: string[];
  speech?: 'decision' | 'request' | 'report' | 'tentative' | 'idea';
  workState?: { reason: string; resumeCondition: string; reviewAt: string | null };
  assigneeIds?: string[];
  dueDate?: string | null;
  listId?: string;
  checklist?: string[];
  reason: string;
  quote: string;
}
export interface OrganizationPreview {
  aiSuggested?: boolean;
  checklist?: string[];
  id: string;
  projectId: string;
  kind: OrganizationKind;
  status: 'pending' | 'held' | 'applied' | 'undone' | 'skipped';
  reason: string;
  sourceTitle: string;
  quote: string;
  changes: { taskId: string; title: string; summary: string; before?: string; after?: string; fields?: { field: string; before: unknown; after: unknown }[] }[];
  warnings: string[];
  clarifications?: string[];
  canApply?: boolean;
  createdAt: string;
  /** Private review timing; never changes the shared task's status or dates. */
  followUp?: OrganizationFollowUp;
  reappearedReason?: string;
}
export type OrganizationFollowUp =
  | { kind: 'at'; at: string; triggeredAt?: string }
  | { kind: 'when'; condition: string };
export interface OrganizationReconsideration {
  source: OrganizationSource;
  draft: OrganizationDraft;
  preview: OrganizationPreview;
}
export interface OrganizationAnalysis { drafts: OrganizationDraft[]; issues: string[]; basis?: OrganizationBasis }
export interface OrganizationMultiAnalysis {
  proposals: { projectId: string; draft: OrganizationDraft }[];
  bases: Record<string, OrganizationBasis>;
  issues: string[];
}
export const organizationLabels: Record<OrganizationKind, string> = {
  update: '既存の仕事を変更', create: '新しい仕事', parent_child: '親子にする', new_parent: '新しい親でまとめる',
  related: '関連付ける', dependency: '前提の仕事にする', checklist: 'チェックリストへ追加', merge: '重複を統合',
  complete: '完了にする', cancel: '中止にする', hold: '保留にする', wait: '返事・素材を待つ', resume: '保留・待ちを解除',
};

export interface OrganizationContext {defaultAssigneeId?: string | null;members:{id:string;displayName:string}[];lists:{id:string;name:string}[]}

export const organizationCriteria = `同じ成果物・対象・期間・完了条件の情報追加はupdate。個別担当/期限/完了確認のある仕事はcreate（既存親ならtargetTaskId）。同じ担当の細かな手順はchecklist。一つの成果をまとめる親はnew_parent。既存親と子はparent_child。別々に完了する仕事はrelated、先に完了する前提はdependency。成果物・担当・対象期間・完了条件まで同じ重複のみmerge。同名だけで統合しない。未決定の相談・推測は提案を作らずissuesへ。担当の候補・推測は確定したassigneeIdsに入れない。明示された担当者だけassigneeIdsに入れ、意図的な担当未設定だけ空配列にする。担当・期限が不明ならフィールド自体を省略し、任意の必須入力を増やさない。各自の購入のように各人の成立が必要なら個人ごとに独立したcreate（assigneeIdsは1人）。申込受付/支払完了/購入/発送/到着予定/受取を混同しない。`;

/** Context that changes an organization decision even when the title and description stay identical. */
export function organizationTaskVersion(tasks: {id:string;assigneeIds?:string[];dueDate?:Date|string|null;startDate?:Date|string|null;taskKind?:string;parentTaskId?:string|null;dependsOnTaskIds?:string[];relatedTaskIds?:string[];isCompleted?:boolean}[]):string {
  const date=(value:Date|string|null|undefined)=>value instanceof Date?value.toISOString():value??null;
  return JSON.stringify([...tasks].sort((a,b)=>a.id.localeCompare(b.id)).map(t=>[t.id,[...(t.assigneeIds??[])].sort(),date(t.dueDate),date(t.startDate),t.taskKind??'task',t.parentTaskId||null,[...(t.dependsOnTaskIds??[])].sort(),[...(t.relatedTaskIds??[])].sort(),!!t.isCompleted]));
}
