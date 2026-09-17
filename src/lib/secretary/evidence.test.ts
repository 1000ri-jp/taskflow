import { describe, expect, it } from 'vitest';
import { evidenceOptions, resolveEvidenceReferences, resolveReviewReferences, reviewOptions } from './evidence';
import { taskText, validateInterpretations } from './engine';
import { createMockSecretary, mockInterpretations, mockView } from './mock';

const now = '2026-09-10T01:00:00.000Z';
const snapshot = () => mockView(createMockSecretary('u', now), 'u', now).snapshot;

describe('Secretary source excerpt references', () => {
  it('keeps every excerpt exact and bounded, including long lines and CRLF', () => {
    const task = snapshot().tasks[0];
    task.comments[0].content = `  原文のまま\r\n${'長い日本語'.repeat(250)}\n\n末尾  `;
    const options = evidenceOptions(task);
    expect(new Set(options.map(o => o.id)).size).toBe(options.length);
    for (const option of options) {
      expect(option.quote.length).toBeGreaterThan(0);
      expect(option.quote.length).toBeLessThanOrEqual(600);
      const original = option.source === 'task' ? taskText(task) : task.comments.find(c => c.id === option.source)!.content;
      expect(original).toContain(option.quote);
    }
    expect(options.some(o => o.quote === '原文のまま')).toBe(true);
  });
  it('restores original evidence and passes the existing scope and quotation checks', () => {
    const s = snapshot(); const base = mockInterpretations(s)[0];
    const task = s.tasks.find(t => t.key === base.key)!;
    const options = evidenceOptions(task);
    const selected = options.find(o => o.source === base.evidence[0].source && o.quote.includes(base.evidence[0].quote))!;
    const raw = [{ ...base, evidence: [{ id: selected.id }] }];
    const resolved = resolveEvidenceReferences(raw, new Map([[task.key, options]]));
    expect(validateInterpretations(resolved, s)[0].evidence).toEqual([{ source: selected.source, quote: selected.quote }]);
    expect(raw[0].evidence).toEqual([{ id: selected.id }]);
  });
  it('rejects invented references and model-written text instead of substituting evidence', () => {
    const s = snapshot(); const task = s.tasks[0]; const options = new Map([[task.key, evidenceOptions(task)]]);
    for (const reference of [{ id: 'nonexistent' }, { id: 'e1', quote: 'invented' }, { source: 'task', quote: 'invented' }, null]) {
      expect(() => resolveEvidenceReferences([{ key: task.key, evidence: [reference] }], options)).toThrow('根拠番号');
    }
  });
  it('resolves the same ID within its own task and never uses another task as evidence', () => {
    const s = snapshot(); const [a, b] = s.tasks; const oa = evidenceOptions(a), ob = evidenceOptions(b);
    const options = new Map([[a.key, oa], [b.key, ob]]);
    expect(resolveEvidenceReferences([{ key: b.key, evidence: [{ id: 'e1' }] }], options)).toEqual([
      { key: b.key, evidence: [{ source: ob[0].source, quote: ob[0].quote }] },
    ]);
    const foreign = { ...mockInterpretations(s)[0], key: 'outside/task', evidence: [{ id: 'e1' }] };
    expect(() => validateInterpretations(resolveEvidenceReferences([foreign], options), s)).toThrow();
  });
  it('offers only valid exact comment dates and bounded due-date offsets', () => {
    const task = snapshot().tasks[0];
    task.dueDate = '2026-09-16T00:00:00Z';
    task.comments = [{ ...task.comments[0], content: '9/16発送。来週確認。2026-02-30は誤記。2026-09-18に返信予定。' }];
    const options = reviewOptions(task);
    expect(options).toHaveLength(16);
    expect(options[0]).toMatchObject({ date: '2026-09-16', review: { kind: 'due_date', leadDays: 0 } });
    expect(options[14]).toMatchObject({ date: '2026-09-02', review: { kind: 'due_date', leadDays: 14 } });
    expect(options[15]).toMatchObject({ date: '2026-09-18', review: { kind: 'comment_date', date: '2026-09-18' } });
    task.dueDate = null;
    task.comments[0].content = '9/16発送。来週確認。';
    expect(reviewOptions(task)).toEqual([]);
  });
  it('restores a selected review date and rejects invented or model-written dates', () => {
    const s = snapshot(); const base = mockInterpretations(s)[0];
    const task = s.tasks.find(t => t.key === base.key)!;
    const choices = reviewOptions(task); const options = new Map([[task.key, choices]]);
    const resolved = resolveReviewReferences([{ ...base, review: choices[0].id }], options);
    expect(validateInterpretations(resolved, s)[0].review).toEqual(choices[0].review);
    expect(resolveReviewReferences([{ ...base, review: null }], options)).toEqual([{ ...base, review: null }]);
    for (const review of ['missing', { kind: 'comment_date', date: '2026-09-16', commentId: 'invented' }, undefined]) {
      expect(() => resolveReviewReferences([{ ...base, review }], options)).toThrow('根拠番号');
    }
  });
});
