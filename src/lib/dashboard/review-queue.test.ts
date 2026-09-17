import { beforeEach, describe, expect, it } from 'vitest';
import type { DashboardTask } from './brief';
import type { OrganizationPreview } from '@/lib/task/organizationTypes';
import { organizationAttention, orderReviewItems, reviewTaskAttention } from './review-queue';

const now = new Date(2026, 8, 12, 12);

describe('review queue attention and order', () => {
  beforeEach(() => sessionStorage.clear());

  it('uses factual deadline or dependency evidence for attention', () => {
    expect(reviewTaskAttention({ dueDate: now, review: undefined }, now)).toMatchObject({ level: 'now', icon: 'deadline', reason: '今日が回答期限' });
    expect(reviewTaskAttention({ dueDate: new Date(2026, 8, 14), review: undefined }, now)).toMatchObject({ level: 'soon', icon: 'deadline', reason: '2日後が回答期限' });
    expect(reviewTaskAttention({ dueDate: null, review: { nextTaskId: 'next' } } as DashboardTask, now)).toMatchObject({ level: 'soon', icon: 'blocked' });
    expect(reviewTaskAttention({ dueDate: null, review: undefined }, now)).toMatchObject({ level: 'normal', icon: 'suggestion' });
  });

  it('keeps organization deadline reasons separate from ordinary suggestions', () => {
    const record = { changes: [{ fields: [{ field: 'dueDate', before: null, after: '2026-09-12' }] }] } as unknown as OrganizationPreview;
    expect(organizationAttention(record, now)).toMatchObject({ level: 'now', reason: '今日が回答期限' });
    expect(organizationAttention({ changes: [{ fields: [{ field: 'dependsOnTaskIds', before: [], after: ['t'] }] }] } as unknown as OrganizationPreview, now)).toMatchObject({ level: 'soon', icon: 'blocked' });
  });

  it('orders urgent groups first, keeps each item once, and advances the browsing round', () => {
    const items = [
      { id: 'normal', dueDate: null },
      { id: 'today', dueDate: now },
      { id: 'soon', dueDate: new Date(2026, 8, 14) },
      { id: 'later', dueDate: new Date(2026, 8, 20) },
    ];
    const attention = (item: typeof items[number]) => reviewTaskAttention({ dueDate: item.dueDate, review: undefined }, now);
    const first = orderReviewItems(items, 'test-round', item => item.id, attention);
    expect(first[0].id).toBe('today');
    expect(new Set(first.map(item => item.id)).size).toBe(items.length);
    expect(sessionStorage.getItem('taskflow-review-round:test-round')).toBe('1');
    const second = orderReviewItems(items, 'test-round', item => item.id, attention);
    expect(new Set(second.map(item => item.id)).size).toBe(items.length);
    expect(sessionStorage.getItem('taskflow-review-round:test-round')).toBe('2');
  });
});
