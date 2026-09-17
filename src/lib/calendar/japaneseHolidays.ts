import holidayJp from '@holiday-jp/holiday_jp';

// The pinned holiday-jp dataset includes full calendar years 1970–2050.
// It includes substitute/citizens' holidays and the 2020/2021 special dates.
// Future entries follow current rules; update the dependency if the law changes.
// Official dates: https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html
export const JAPANESE_HOLIDAY_YEAR_RANGE = Object.freeze({ first: 1970, last: 2050 });

const holidayDates = new Set(Object.keys(holidayJp.holidays));

/**
 * Checks a JST calendar date without using the browser's local timezone.
 * Invalid/unsupported dates throw: callers must skip scheduling, rather than
 * treating unavailable holiday data as an ordinary weekday or weekend.
 */
export function isJapaneseHoliday(dateKey: string): boolean {
  if (typeof dateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new RangeError('祝日の判定には YYYY-MM-DD 形式の日付が必要です。');
  }
  const date = new Date(`${dateKey}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== dateKey) {
    throw new RangeError('祝日の判定に指定された日付が存在しません。');
  }
  const year = date.getUTCFullYear();
  if (year < JAPANESE_HOLIDAY_YEAR_RANGE.first || year > JAPANESE_HOLIDAY_YEAR_RANGE.last) {
    throw new RangeError('祝日データの収録範囲外です。');
  }
  return holidayDates.has(dateKey);
}
