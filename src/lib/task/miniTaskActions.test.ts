import { describe, expect, it } from 'vitest';
import { replaceTaskCalendarDay } from './miniTaskActions';

describe('replaceTaskCalendarDay', () => {
  it('changes only the Japan calendar day and preserves the due time', () => {
    const selected = new Date('2026-09-23T00:00:00+09:00');
    const current = new Date('2026-09-24T08:00:00.123+09:00');

    expect(replaceTaskCalendarDay(selected, current).toISOString()).toBe('2026-09-22T23:00:00.123Z');
  });

  it('uses Japan midnight when a task has no existing date', () => {
    expect(replaceTaskCalendarDay(new Date('2026-09-23T17:00:00Z'), null).toISOString()).toBe('2026-09-23T15:00:00.000Z');
  });
});
