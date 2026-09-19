import { describe, expect, it } from 'vitest';
import { fixedGoogleRefreshClock, nextFixedGoogleRefreshDelay } from './refresh-schedule';

const minute = 60_000;

describe('fixed Google calendar refresh schedule', () => {
  it.each([
    ['2026-09-16T07:59:00+09:00', minute],
    ['2026-09-16T08:00:00+09:00', 4 * 60 * minute],
    ['2026-09-16T12:00:00+09:00', 4 * 60 * minute],
    ['2026-09-16T16:00:00+09:00', 8 * 60 * minute],
    ['2026-09-16T23:59:00+09:00', minute],
    ['2026-09-17T00:00:00+09:00', 8 * 60 * minute],
    ['2026-09-16T22:49:00Z', 11 * minute],
  ])('schedules the next slot after %s', (value, expected) => {
    expect(nextFixedGoogleRefreshDelay(new Date(value))).toBe(expected);
  });

  it('uses Japan time for the displayed clock', () => {
    expect(fixedGoogleRefreshClock(new Date('2026-09-16T23:49:00Z'))).toBe('8:49');
  });

  it('does not schedule an invalid date', () => {
    expect(nextFixedGoogleRefreshDelay(new Date('invalid'))).toBe(0);
  });
});
