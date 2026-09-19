import { describe, expect, it } from 'vitest';
import { viewTask } from '@/test/taskViewFixtures';
import { continuationContext, continuationTasks, uniqueMaterials } from './continuation';

const parent = viewTask({ id: 'work', assigneeIds: ['worker'] });
const review = viewTask({ id: 'review', taskKind: 'review_request', parentTaskId: 'work', assigneeIds: ['reviewer'], review: { round: 1, policy: 'any', request: '初稿を確認', attachments: [], responses: {}, requestedAt: '2026-09-13T00:00:00Z', nextTaskId: 'print' } });
const next = viewTask({ id: 'print', assigneeIds: ['printer'] });
describe('work continuation from shared facts', () => {
  it('offers response only to the reviewer, and shows the worker who is waiting', () => {
    const tasks = [parent, review, next];
    expect(continuationContext(parent, tasks, 'worker')).toMatchObject({ canReview: false, canResubmit: false, review });
    expect(continuationContext(review, tasks, 'reviewer').canReview).toBe(true);
    expect(continuationTasks(tasks, 'reviewer')).toEqual([review]);
  });
  it('returns correction to the worker even when the review belongs to somebody else', () => {
    const revised = { ...review, review: { ...review.review!, responses: { reviewer: { outcome: 'changes_requested' as const, note: '会場を修正', at: '2026-09-13T01:00:00Z' } } } };
    expect(continuationTasks([parent, revised, next], 'worker')[0]).toBe(revised);
    expect(continuationContext(revised, [parent, revised], 'worker').canResubmit).toBe(true);
  });
  it('uses an explicit approved handoff, never a pending or superseded approval', () => {
    expect(continuationContext(next, [parent, review, next], 'printer').handoffs).toEqual([]);
    const approved = { ...review, isCompleted: true, review: { ...review.review!, responses: { reviewer: { outcome: 'approved' as const, note: '', at: '2026-09-13T01:00:00Z' } } } };
    expect(continuationContext(next, [parent, approved, next], 'printer').handoffs).toEqual([approved]);
    expect(continuationContext(next, [parent, { ...approved, isCompleted: false, review: { ...approved.review, responses: {} } }, next], 'printer').handoffs).toEqual([]);
  });
  it('does not use another project or a missing/completed parent to authorize a response', () => {
    expect(continuationContext(review, [review, { ...parent, projectId: 'other' }], 'reviewer').canReview).toBe(false);
    expect(continuationContext(review, [review, { ...parent, isCompleted: true }], 'reviewer').canReview).toBe(false);
    expect(continuationTasks([{ ...review, isArchived: true }], 'reviewer')).toEqual([]);
  });
  it('deduplicates registered materials and excludes executable links', () => {
    const file = { id: 'file', url: 'https://example.test/v1.pdf', name: '初稿.pdf', type: 'application/pdf', size: 1 };
    expect(uniqueMaterials([file, { ...file, id: 'duplicate' }, { ...file, id: 'bad', url: 'javascript:alert(1)' }])).toEqual([{ ...file, id: 'duplicate' }]);
  });
});
