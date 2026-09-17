import { describe, expect, it } from 'vitest';
import { isJapaneseHoliday, JAPANESE_HOLIDAY_YEAR_RANGE } from './japaneseHolidays';

describe('Japanese holidays for companion scheduling', () => {
  // All dates published by the Cabinet Office, including non-holiday days:
  // https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html
  it.each([
    [2026, ['01-01', '01-12', '02-11', '02-23', '03-20', '04-29', '05-03', '05-04', '05-05', '05-06', '07-20', '08-11', '09-21', '09-22', '09-23', '10-12', '11-03', '11-23']],
    [2027, ['01-01', '01-11', '02-11', '02-23', '03-21', '03-22', '04-29', '05-03', '05-04', '05-05', '07-19', '08-11', '09-20', '09-23', '10-11', '11-03', '11-23']],
  ] as const)('matches the complete official %i calendar', (year, dates) => {
    const expected = new Set(dates.map(date => `${year}-${date}`));
    for (let day = Date.UTC(year, 0, 1); day < Date.UTC(year + 1, 0, 1); day += 86_400_000) {
      const key = new Date(day).toISOString().slice(0, 10);
      expect(isJapaneseHoliday(key), key).toBe(expected.has(key));
    }
  });

  it('includes substitute and citizens’ holidays independently of weekdays', () => {
    expect(isJapaneseHoliday('2026-05-06')).toBe(true);
    expect(isJapaneseHoliday('2026-09-22')).toBe(true);
    expect(isJapaneseHoliday('2023-02-11')).toBe(true); // Saturday holiday.
    expect(isJapaneseHoliday('2026-05-03')).toBe(true); // Sunday holiday.
    expect(isJapaneseHoliday('2026-09-12')).toBe(false); // Ordinary Saturday.
    expect(isJapaneseHoliday('2026-09-13')).toBe(false); // Ordinary Sunday.
    expect(isJapaneseHoliday('2026-09-14')).toBe(false); // Ordinary Monday.
  });

  it.each([
    ['2020', ['07-23', '07-24', '08-10'], ['07-20', '08-11', '10-12']],
    ['2021', ['07-22', '07-23', '08-08', '08-09'], ['07-19', '08-11', '10-11']],
  ])('uses the %s Olympic exceptions instead of the usual dates', (year, holidays, ordinaryDays) => {
    for (const day of holidays) expect(isJapaneseHoliday(`${year}-${day}`)).toBe(true);
    for (const day of ordinaryDays) expect(isJapaneseHoliday(`${year}-${day}`)).toBe(false);
  });

  it('includes the 2019 enthronement and surrounding citizens’ holidays', () => {
    for (const day of ['2019-04-30', '2019-05-01', '2019-05-02', '2019-10-22']) {
      expect(isJapaneseHoliday(day)).toBe(true);
    }
  });

  it('supports whole dataset years, including future dates and December after the last holiday', () => {
    expect(JAPANESE_HOLIDAY_YEAR_RANGE).toEqual({ first: 1970, last: 2050 });
    expect(isJapaneseHoliday('1970-01-01')).toBe(true);
    expect(isJapaneseHoliday('2050-01-01')).toBe(true);
    expect(isJapaneseHoliday('2050-12-31')).toBe(false);
    expect(isJapaneseHoliday('2028-02-29')).toBe(false);
  });

  it.each(['1969-12-31', '2051-01-01', '2099-01-01'])('rejects unsupported %s instead of reporting a non-holiday', date => {
    expect(() => isJapaneseHoliday(date)).toThrow(RangeError);
  });

  it.each(['', '2026-9-22', '2026/09/22', '2026-09-22T00:00:00+09:00', '2026-09-22 ', '2026-02-29', '2026-02-30', '2026-00-01', '2026-13-01', '2026-01-00'])('rejects invalid calendar key %s', date => {
    expect(() => isJapaneseHoliday(date)).toThrow(RangeError);
  });
});
