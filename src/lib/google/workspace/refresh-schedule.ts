const JAPAN_TIME_ZONE = 'Asia/Tokyo';
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** The calendar refresh slots are fixed in Japan time, including midnight. */
export const FIXED_GOOGLE_REFRESH_HOURS = [8, 12, 16, 24] as const;
export const FIXED_GOOGLE_REFRESH_LABEL = '8時・12時・16時・24時（日本時間）';

const japanClock = new Intl.DateTimeFormat('en-US', {
  timeZone: JAPAN_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function partValues(date: Date) {
  const parts = Object.fromEntries(japanClock.formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/**
 * Return milliseconds until the next fixed refresh slot, strictly after `now`.
 * The wall-clock calculation keeps the schedule stable even when the browser
 * itself is running in a different timezone.
 */
export function nextFixedGoogleRefreshDelay(now = new Date()): number {
  if (!Number.isFinite(now.getTime())) return 0;
  const parts = partValues(now);
  const dayStart = Date.UTC(parts.year, parts.month - 1, parts.day);
  const wallNow = dayStart + ((parts.hour * 60 + parts.minute) * 60 + parts.second) * 1000 + now.getMilliseconds();
  for (const hour of FIXED_GOOGLE_REFRESH_HOURS) {
    const candidate = dayStart + hour * 60 * MINUTE_MS;
    if (candidate > wallNow) return candidate - wallNow;
  }
  return dayStart + DAY_MS + 8 * 60 * MINUTE_MS - wallNow;
}

export function fixedGoogleRefreshClock(date = new Date()): string {
  const parts = partValues(date);
  return `${parts.hour}:${String(parts.minute).padStart(2, '0')}`;
}
