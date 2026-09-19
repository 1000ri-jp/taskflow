import type { Project } from '@/types';

export const REQUEST_PROJECT = 'タスク管理ツール';
export const REQUEST_LIST = '要望';
export interface RequestTurn { role: 'user' | 'assistant'; content: string }
export type RequestPreparation =
  | { type: 'questions'; summary: string; questions: string[] }
  | { type: 'draft'; title: string; problem: string; desired: string; criteria: string[]; notes: string };

export function requestProject(projects: Pick<Project, 'id' | 'name' | 'isArchived'>[]): string {
  const matches = projects.filter(project => !project.isArchived && project.name.trim() === REQUEST_PROJECT);
  if (matches.length !== 1) throw new Error(matches.length ? '同じ名前のプロジェクトが複数あるため、送信先を確認できません。' : '「タスク管理ツール」プロジェクトを確認できません。');
  return matches[0].id;
}
export function parseRequestTurns(value: unknown): RequestTurn[] {
  if (!Array.isArray(value) || !value.length || value.length > 15) throw new Error('要望と回答を確認してください。');
  let length = 0;
  const turns = value.map((turn, index) => {
    if (!turn || typeof turn !== 'object' || Object.keys(turn).some(key => !['role', 'content'].includes(key)) || turn.role !== (index % 2 ? 'assistant' : 'user') || typeof turn.content !== 'string' || !turn.content.trim() || turn.content.length > 3000) throw new Error('要望と回答を確認してください。');
    length += turn.content.length;
    return { role: turn.role, content: turn.content } as RequestTurn;
  });
  if (turns.at(-1)?.role !== 'user' || length > 16000) throw new Error('要望を短くまとめてから、もう一度整理してください。');
  return turns;
}
export function parsePreparation(value: unknown): RequestPreparation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('整理結果を確認できませんでした。もう一度お試しください。');
  const raw = value as Record<string, unknown>;
  const text = (v: unknown, max: number, optional = false): v is string => typeof v === 'string' && (optional || !!v.trim()) && v.length <= max;
  const texts = (v: unknown): v is string[] => Array.isArray(v) && v.length >= 1 && v.length <= 5 && v.every(item => text(item, 300));
  if (raw.type === 'questions' && Object.keys(raw).every(key => ['type', 'summary', 'questions'].includes(key)) && text(raw.summary, 500) && texts(raw.questions) && raw.questions.length <= 3) return { type: 'questions', summary: raw.summary, questions: raw.questions };
  if (raw.type === 'draft' && Object.keys(raw).every(key => ['type', 'title', 'problem', 'desired', 'criteria', 'notes'].includes(key)) && text(raw.title, 32) && text(raw.problem, 1200) && text(raw.desired, 1200) && texts(raw.criteria) && text(raw.notes, 1000, true)) return { type: 'draft', title: raw.title, problem: raw.problem, desired: raw.desired, criteria: raw.criteria, notes: raw.notes };
  throw new Error('整理結果を確認できませんでした。もう一度お試しください。');
}
export function draftDescription(draft: Extract<RequestPreparation, { type: 'draft' }>): string {
  return [`困っていること\n${draft.problem}`, `実現したいこと\n${draft.desired}`, `できたかの確認\n${draft.criteria.map(item => `・${item}`).join('\n')}`, draft.notes && `補足・未確認\n${draft.notes}`].filter(Boolean).join('\n\n');
}
export function requestRecord(turns: RequestTurn[]): string {
  return turns.map((turn, index) => `${index === 0 ? '原文' : turn.role === 'user' ? '本人の回答' : 'モアイの確認'}\n${turn.content}`).join('\n\n');
}
