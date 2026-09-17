import { describe, expect, it } from 'vitest';
import { currentCompanionGreeting, DEFAULT_COMPANION_SCHEDULE, validateCompanionScheduleSettings, type CompanionScheduleSettings, type CompanionScheduleTargetDay } from './companionSchedule';

const entry = (changes: Partial<CompanionScheduleSettings['entries'][number]> = {}) => ({ id: 'morning', time: '09:00', message: 'おはようございます', enabled: true, ...changes });
const settings = (...entries: CompanionScheduleSettings['entries']): CompanionScheduleSettings => ({ enabled: true, entries });
const current = (time: string, value = DEFAULT_COMPANION_SCHEDULE) => currentCompanionGreeting(value, new Date(time));

describe('companion schedule validation', () => {
  it('provides four enabled default greetings at the agreed times with stable IDs', () => {
    expect(validateCompanionScheduleSettings(DEFAULT_COMPANION_SCHEDULE)).toBe(true);
    expect(DEFAULT_COMPANION_SCHEDULE).toEqual({ enabled: true, targetDays: ['weekday'], entries: [
      entry(), entry({ id: 'lunch', time: '12:00', message: 'お昼ですよ' }),
      entry({ id: 'afternoon', time: '13:00', message: '午後もがんばりましょう' }), entry({ id: 'evening', time: '17:00', message: '今日もお疲れ様でした' }),
    ] });
  });
  it('allows zero to twelve entries, trimmed message lengths and safe unique IDs', () => {
    expect(validateCompanionScheduleSettings(settings())).toBe(true);
    expect(validateCompanionScheduleSettings(settings(...Array.from({ length: 12 }, (_, i) => entry({ id: `entry_${i}-x` }))))).toBe(true);
    expect(validateCompanionScheduleSettings(settings(entry({ id: 'x'.repeat(80), message: ` ${'あ'.repeat(120)} `, time: '23:59' })))).toBe(true);
    expect(validateCompanionScheduleSettings(settings(entry({ time: '00:00', message: ' a ' })))).toBe(true);
  });
  it.each(['9:00', '09:0', '24:00', '12:60', '09:00:00', ' 09:00', '09:00 ', '０９:００', '-1:00'])('rejects invalid time %s', time => {
    expect(validateCompanionScheduleSettings(settings(entry({ time })))).toBe(false);
  });
  it('rejects duplicate or unsafe IDs, blank or oversized messages and invalid switches', () => {
    const invalid: unknown[] = [null, [], {}, { enabled: 'true', entries: [] }, { enabled: true, entries: 'bad' }, settings(...Array.from({ length: 13 }, (_, i) => entry({ id: `x${i}` }))), settings(entry(), entry()),
      ...['', 'a/b', 'a:b', ' a', 'x'.repeat(81)].map(id => settings(entry({ id }))),
      ...['', '\n\t ', 'あ'.repeat(121)].map(message => settings(entry({ message }))), settings(entry({ enabled: 1 as never })), settings(null as never), settings(entry({ time: undefined as never }))];
    for (const value of invalid) expect(validateCompanionScheduleSettings(value)).toBe(false);
  });
  it('accepts legacy settings and valid day selections, but rejects empty or invalid selections', () => {
    expect(validateCompanionScheduleSettings(settings(entry({ time: '08:45', message: '変更済みの声かけ', enabled: false })))).toBe(true);
    for (const targetDays of [['weekday'], ['weekend', 'holiday'], ['weekday', 'weekend', 'holiday']]) {
      expect(validateCompanionScheduleSettings({ ...settings(entry()), targetDays })).toBe(true);
    }
    for (const targetDays of [[], ['unknown'], ['weekday', 'weekday'], 'weekday', null, [1]]) {
      expect(validateCompanionScheduleSettings({ ...settings(entry()), targetDays })).toBe(false);
    }
  });
});

describe('current companion greeting in Japan time', () => {
  it.each<[string, CompanionScheduleTargetDay]>([
    ['2026-09-14', 'weekday'], ['2026-09-12', 'weekend'],
    ['2026-09-22', 'holiday'], // National holiday between Respect for the Aged Day and the autumnal equinox.
    ['2026-05-06', 'holiday'], // Substitute holiday.
    ['2026-05-03', 'holiday'], // A Sunday holiday belongs only to the holiday category.
  ])('classifies %s exclusively as %s', (day, selected) => {
    for (const target of ['weekday', 'weekend', 'holiday'] as const) {
      const actual = current(`${day}T09:00:00+09:00`, { ...DEFAULT_COMPANION_SCHEDULE, targetDays: [target] });
      if (target === selected) expect(actual?.key).toBe(`${day}:morning`);
      else expect(actual).toBeNull();
    }
  });
  it('combines selected categories with OR and treats missing targetDays as weekdays', () => {
    const combined: CompanionScheduleSettings = { ...DEFAULT_COMPANION_SCHEDULE, targetDays: ['weekday', 'holiday'] };
    expect(current('2026-09-14T09:00:00+09:00', combined)).not.toBeNull();
    expect(current('2026-09-22T09:00:00+09:00', combined)).not.toBeNull();
    expect(current('2026-09-12T09:00:00+09:00', combined)).toBeNull();
    const legacy = settings(entry({ time: '08:45', message: 'いつもの声かけ' }));
    expect(current('2026-09-14T08:45:00+09:00', legacy)?.message).toBe('いつもの声かけ');
    expect(current('2026-09-22T08:45:00+09:00', legacy)).toBeNull();
    expect(legacy).toEqual(settings(entry({ time: '08:45', message: 'いつもの声かけ' })));
  });
  it('carries a late entry across midnight only when both day categories are selected', () => {
    const late: CompanionScheduleSettings = { ...settings(entry({ time: '23:59' })), targetDays: ['weekday', 'weekend'] };
    expect(current('2026-09-12T00:01:00+09:00', late)?.key).toBe('2026-09-11:morning');
    expect(current('2026-09-12T00:01:00+09:00', { ...late, targetDays: ['weekend'] })).toBeNull();
    const holiday: CompanionScheduleSettings = { ...late, targetDays: ['weekend', 'holiday'] };
    expect(current('2026-09-21T00:01:00+09:00', holiday)?.key).toBe('2026-09-20:morning');
    expect(current('2026-09-21T00:01:00+09:00', { ...holiday, targetDays: ['holiday'] })).toBeNull();
  });
  it('stays quiet outside known holiday years without discarding a known current day at the lower boundary', () => {
    const allDays: CompanionScheduleSettings = { ...DEFAULT_COMPANION_SCHEDULE, targetDays: ['weekday', 'weekend', 'holiday'] };
    expect(current('1969-12-31T09:00:00+09:00', allDays)).toBeNull();
    expect(current('2051-01-01T09:00:00+09:00', allDays)).toBeNull();
    expect(current('1970-01-01T09:00:00+09:00', { ...allDays, targetDays: ['holiday'] })?.key).toBe('1970-01-01:morning');
  });
  it('includes the exact scheduled time and five-minute boundary, never a future or expired entry', () => {
    expect(current('2026-09-14T08:59:59.999+09:00')).toBeNull();
    const atNine = current('2026-09-14T09:00:00+09:00');
    expect(atNine).toEqual({ id: 'morning', message: 'おはようございます', key: '2026-09-14:morning', scheduledAt: Date.parse('2026-09-14T00:00:00Z'), expiresAt: Date.parse('2026-09-14T00:05:00Z') });
    expect(current('2026-09-14T09:05:00+09:00')).toEqual(atNine);
    expect(current('2026-09-14T09:05:00.001+09:00')).toBeNull();
  });
  it('uses JST regardless of the timestamp input offset or local weekday', () => {
    const midnight = settings(entry({ time: '00:01' }));
    expect(current('2026-09-13T15:01:00Z', midnight)?.key).toBe('2026-09-14:morning'); // Sunday UTC, Monday JST.
    expect(current('2026-09-13T08:01:00-07:00', midnight)?.key).toBe('2026-09-14:morning');
    expect(current('2026-09-14T00:01:00+09:00', midnight)?.scheduledAt).toBe(Date.parse('2026-09-13T15:01:00Z'));
  });
  it('returns only the newest currently relevant entry, not a backlog of missed greetings', () => {
    const value = settings(entry({ id: 'earlier', time: '09:00' }), entry({ id: 'latest', time: '09:03', message: ' 最新です ' }), entry({ id: 'future', time: '09:05' }));
    expect(current('2026-09-14T09:04:00+09:00', value)).toMatchObject({ id: 'latest', message: '最新です', key: '2026-09-14:latest' });
    expect(current('2026-09-14T16:00:00+09:00')).toBeNull();
    expect(current('2026-09-14T17:01:00+09:00')?.id).toBe('evening');
  });
  it('keeps a previous weekday entry across midnight for five minutes with its original scheduled-day key', () => {
    const value = settings(entry({ time: '23:59' }));
    expect(current('2026-09-15T00:01:00+09:00', value)).toMatchObject({ key: '2026-09-14:morning', scheduledAt: Date.parse('2026-09-14T14:59:00Z') });
    expect(current('2026-09-15T00:04:00+09:00', value)?.key).toBe('2026-09-14:morning');
    expect(current('2026-09-15T00:04:00.001+09:00', value)).toBeNull();
    expect(current('2026-10-01T00:01:00+09:00', value)?.key).toBe('2026-09-30:morning');
  });
  it('never shows on a weekend or carries a Sunday entry into Monday', () => {
    for (const time of ['2026-09-12T09:00:00+09:00', '2026-09-13T09:00:00+09:00']) expect(current(time)).toBeNull();
    const late = settings(entry({ time: '23:59' }));
    expect(current('2026-09-12T00:01:00+09:00', late)).toBeNull(); // Friday greeting, Saturday now.
    expect(current('2026-09-14T00:01:00+09:00', late)).toBeNull(); // Sunday greeting, Monday now.
  });
  it('renews the key each scheduled day and keeps same-time choices stable in configured order', () => {
    expect(current('2026-09-14T09:00:00+09:00')?.key).toBe('2026-09-14:morning');
    expect(current('2026-09-15T09:00:00+09:00')?.key).toBe('2026-09-15:morning');
    expect(current('2026-09-14T09:00:00+09:00', settings(entry({ id: 'first' }), entry({ id: 'second' })))?.id).toBe('first');
  });
  it('returns nothing for disabled, invalid or empty settings and invalid dates', () => {
    expect(current('2026-09-14T09:00:00+09:00', { ...DEFAULT_COMPANION_SCHEDULE, enabled: false })).toBeNull();
    expect(current('2026-09-14T09:00:00+09:00', settings(entry({ enabled: false })))).toBeNull();
    expect(current('2026-09-14T09:00:00+09:00', settings())).toBeNull();
    expect(current('2026-09-14T09:00:00+09:00', settings(entry({ time: '99:00' })))).toBeNull();
    expect(current('invalid')).toBeNull();
    expect(currentCompanionGreeting(null as never, new Date())).toBeNull();
  });
  it('does not mutate settings, messages, entry order or the input date', () => {
    const value = settings(entry({ id: 'later', time: '09:04', message: ' 後です ' }), entry());
    const before = structuredClone(value);
    Object.freeze(value); Object.freeze(value.entries); value.entries.forEach(Object.freeze);
    const now = new Date('2026-09-14T09:04:00+09:00'); const nowMs = now.getTime();
    expect(currentCompanionGreeting(value, now)?.message).toBe('後です');
    expect(value).toEqual(before); expect(now.getTime()).toBe(nowMs);
  });
});
