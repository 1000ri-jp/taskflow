import { isJapaneseHoliday } from '@/lib/calendar/japaneseHolidays';

export type CompanionScheduleTargetDay = 'weekday' | 'weekend' | 'holiday';

export type CompanionScheduleSettings = {
  enabled: boolean;
  targetDays?: CompanionScheduleTargetDay[];
  entries: Array<{ id: string; time: string; message: string; enabled: boolean }>;
};

export const DEFAULT_COMPANION_SCHEDULE: CompanionScheduleSettings = {
  enabled: true,
  targetDays: ['weekday'],
  entries: [
    { id: 'morning', time: '09:00', message: 'おはようございます', enabled: true },
    { id: 'lunch', time: '12:00', message: 'お昼ですよ', enabled: true },
    { id: 'afternoon', time: '13:00', message: '午後もがんばりましょう', enabled: true },
    { id: 'evening', time: '17:00', message: '今日もお疲れ様でした', enabled: true },
  ],
};

export function validateCompanionScheduleSettings(value: unknown): value is CompanionScheduleSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const settings = value as Record<string, unknown>;
  if (typeof settings.enabled !== 'boolean' || !Array.isArray(settings.entries) || settings.entries.length > 12) return false;
  if (settings.targetDays !== undefined && (!Array.isArray(settings.targetDays) || settings.targetDays.length < 1
    || settings.targetDays.some(day => !['weekday', 'weekend', 'holiday'].includes(day))
    || new Set(settings.targetDays).size !== settings.targetDays.length)) return false;
  const ids = new Set<string>();
  for (const value of settings.entries) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const entry = value as Record<string, unknown>;
    if (typeof entry.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(entry.id) || ids.has(entry.id)
      || typeof entry.time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(entry.time)
      || typeof entry.message !== 'string' || entry.message.trim().length < 1 || entry.message.trim().length > 120
      || typeof entry.enabled !== 'boolean') return false;
    ids.add(entry.id);
  }
  return true;
}

type CompanionGreeting = { id: string; message: string; key: string; scheduledAt: number; expiresAt: number };
const DAY_MS = 86_400_000;
const JST_OFFSET_MS = 9 * 3_600_000;
const GREETING_WINDOW_MS = 5 * 60_000;
function matchesTargetDay(settings: CompanionScheduleSettings, date: Date) {
  const kind: CompanionScheduleTargetDay = isJapaneseHoliday(date.toISOString().slice(0, 10)) ? 'holiday'
    : date.getUTCDay() >= 1 && date.getUTCDay() <= 5 ? 'weekday' : 'weekend';
  return (settings.targetDays ?? ['weekday']).includes(kind);
}

export function currentCompanionGreeting(settings: CompanionScheduleSettings, now: Date): CompanionGreeting | null {
  if (!validateCompanionScheduleSettings(settings) || !settings.enabled || !(now instanceof Date) || !Number.isFinite(now.getTime())) return null;
  const nowMs = now.getTime();
  const currentDay = Math.floor((nowMs + JST_OFFSET_MS) / DAY_MS);
  try { if (!matchesTargetDay(settings, new Date(currentDay * DAY_MS))) return null; }
  catch { return null; } // Unknown holiday dates must never fall back to ordinary weekdays.
  let latest: CompanionGreeting | null = null;
  // A recent entry can cross midnight only when both dates are selected target days.
  for (const day of [currentDay, currentDay - 1]) {
    const date = new Date(day * DAY_MS);
    if (day !== currentDay) {
      try { if (!matchesTargetDay(settings, date)) continue; }
      catch { continue; }
    }
    for (const entry of settings.entries) {
      if (!entry.enabled) continue;
      const [hour, minute] = entry.time.split(':').map(Number);
      const scheduledAt = day * DAY_MS - JST_OFFSET_MS + (hour * 60 + minute) * 60_000;
      const expiresAt = scheduledAt + GREETING_WINDOW_MS;
      if (scheduledAt > nowMs || expiresAt < nowMs || latest && latest.scheduledAt >= scheduledAt) continue;
      latest = { id: entry.id, message: entry.message.trim(), key: `${date.toISOString().slice(0, 10)}:${entry.id}`, scheduledAt, expiresAt };
    }
  }
  return latest;
}
