import { jstDay, SecretaryError, taskText } from './engine';
import type { Interpretation, SecretaryTask } from './types';

export interface EvidenceOption {
  id: string;
  source: string;
  quote: string;
}

export interface ReviewOption {
  id: string;
  date: string;
  review: Exclude<Interpretation['review'], null>;
}

/** Ambiguous dates such as 9/16 or next week do not create a scheduling option. */
export function reviewOptions(task: SecretaryTask): ReviewOption[] {
  const options: ReviewOption[] = [];
  if (task.dueDate) {
    for (let leadDays = 0; leadDays <= 14; leadDays++) {
      const date = new Date(`${jstDay(task.dueDate)}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() - leadDays);
      options.push({ id: `r${options.length + 1}`, date: date.toISOString().slice(0, 10), review: { kind: 'due_date', leadDays } });
    }
  }
  for (const comment of task.comments) {
    for (const date of new Set(comment.content.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [])) {
      const parsed = new Date(`${date}T00:00:00Z`);
      if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date) {
        options.push({ id: `r${options.length + 1}`, date, review: { kind: 'comment_date', commentId: comment.id, date } });
      }
    }
  }
  return options;
}

export function resolveReviewReferences(raw: unknown, optionsByTask: Map<string, ReviewOption[]>): unknown {
  if (!Array.isArray(raw)) return raw;
  return raw.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.review === null) return value;
    const source = typeof value.review === 'string' && optionsByTask.get(value.key)?.find(option => option.id === value.review);
    if (!source) throw new SecretaryError('INVALID', '再確認日の根拠番号を確認できませんでした。再整理してください。');
    return { ...value, review: { ...source.review } };
  });
}

/** Model selects an excerpt; the server supplies the unchanged source text. */
export function evidenceOptions(task: SecretaryTask): EvidenceOption[] {
  const options: EvidenceOption[] = [];
  const sources = [{ source: 'task', content: taskText(task) }, ...task.comments.map(c => ({ source: c.id, content: c.content }))];
  for (const { source, content } of sources) {
    for (const line of content.split(/\r?\n/)) {
      for (let start = 0; start < line.length; start += 600) {
        const quote = line.slice(start, start + 600).trim();
        if (quote) options.push({ id: `e${options.length + 1}`, source, quote });
      }
    }
  }
  return options;
}

/** IDs are resolved only within the proposal's own task. No model-written quote is trusted. */
export function resolveEvidenceReferences(raw: unknown, optionsByTask: Map<string, EvidenceOption[]>): unknown {
  if (!Array.isArray(raw)) return raw;
  return raw.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const options = optionsByTask.get(value.key);
    if (!options || !Array.isArray(value.evidence)) return value;
    return { ...value, evidence: value.evidence.map((reference: unknown) => {
      if (!reference || typeof reference !== 'object' || Array.isArray(reference) ||
        Object.keys(reference).length !== 1 || !('id' in reference) || typeof reference.id !== 'string') {
        throw new SecretaryError('INVALID', '提案の根拠番号を確認できませんでした。再整理してください。');
      }
      const source = options.find(option => option.id === reference.id);
      if (!source) throw new SecretaryError('INVALID', '提案の根拠番号が対象タスクの原文に見つかりませんでした。再整理してください。');
      return { source: source.source, quote: source.quote };
    }) };
  });
}
