const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function autoArchiveDay(now: Date): string {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

export function nextAutoArchiveMidnight(now: Date): number {
  return (Math.floor((now.getTime() + JST_OFFSET_MS) / DAY_MS) + 1) * DAY_MS - JST_OFFSET_MS;
}
