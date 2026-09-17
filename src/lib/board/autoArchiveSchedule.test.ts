import { describe, expect, it } from 'vitest';
import { autoArchiveDay, nextAutoArchiveMidnight } from './autoArchiveSchedule';

describe('auto archive Japanese calendar schedule', () => {
  it('changes the execution day at JST midnight, independently of UTC midnight', () => {
    expect(autoArchiveDay(new Date('2026-09-13T14:59:59.999Z'))).toBe('2026-09-13');
    expect(autoArchiveDay(new Date('2026-09-13T15:00:00.000Z'))).toBe('2026-09-14');
  });
  it('schedules the next midnight including year and leap-day boundaries', () => {
    for (const [from, to] of [['2026-12-31T23:59:59+09:00', '2027-01-01T00:00:00+09:00'], ['2028-02-28T12:00:00+09:00', '2028-02-29T00:00:00+09:00'], ['2026-09-14T00:00:00+09:00', '2026-09-15T00:00:00+09:00']]) {
      expect(nextAutoArchiveMidnight(new Date(from))).toBe(Date.parse(to));
    }
  });
});
