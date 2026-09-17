import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_COMPANION_SCHEDULE } from '@/lib/ai/companionSchedule';
import { previewCompanionGreeting, useCompanionSchedule, useCompanionScheduleSettings } from './useCompanionSchedule';

const key = (id = 'user-1') => `taskflow.companion.schedule.v1:${id}`;
const seenKey = (id = 'user-1') => `taskflow.companion.schedule-seen.v1:${id}`;
const defaults = () => structuredClone(DEFAULT_COMPANION_SCHEDULE);
const settle = () => act(async () => { await Promise.resolve(); });
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
function visibility(value: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-14T09:00:00+09:00'));
  localStorage.clear();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  let tail = Promise.resolve();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: vi.fn((_key: string, callback: () => boolean) => {
      const result = tail.then(callback); tail = result.then(() => undefined); return result;
    }),
  } });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('companion schedule settings in this browser', () => {
  it('keeps customized legacy settings intact and writes only the explicitly added day selection', () => {
    const legacy = { enabled: false, entries: [
      { id: 'mine', time: '09:30', message: '今日ものんびりいきましょう', enabled: true },
      { id: 'later', time: '18:15', message: '今日はここまで！', enabled: false },
    ] };
    const raw = JSON.stringify(legacy); localStorage.setItem(key(), raw);
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    const view = renderHook(() => useCompanionScheduleSettings('user-1'));
    expect(view.result.current.settings).toEqual(legacy);
    expect(view.result.current.settings.targetDays ?? ['weekday']).toEqual(['weekday']);
    expect(writes).not.toHaveBeenCalled(); expect(localStorage.getItem(key())).toBe(raw);
    act(() => view.result.current.saveSettings({ ...view.result.current.settings, targetDays: ['weekend', 'holiday'] }));
    expect(JSON.parse(localStorage.getItem(key())!)).toEqual({ ...legacy, targetDays: ['weekend', 'holiday'] });
  });
  it('synchronizes same-user saves and storage events while keeping accounts separate', () => {
    const first = renderHook(() => useCompanionScheduleSettings('user-1'));
    const second = renderHook(() => useCompanionScheduleSettings('user-1'));
    const other = renderHook(() => useCompanionScheduleSettings('user-2'));
    const edited = defaults(); edited.entries[0].message = '今日もよろしく';
    act(() => first.result.current.saveSettings(edited));
    expect(second.result.current.settings).toEqual(edited);
    expect(other.result.current.settings).toEqual(DEFAULT_COMPANION_SCHEDULE);
    const remote = { ...edited, enabled: false };
    act(() => { localStorage.setItem(key(), JSON.stringify(remote)); window.dispatchEvent(new StorageEvent('storage', { key: key() })); });
    expect(first.result.current.settings).toEqual(remote);
    expect(second.result.current.settings).toEqual(remote);
    expect(localStorage.getItem(key('user-2'))).toBeNull();
  });

  it('rejects invalid settings and duplicate enabled times with a useful message', () => {
    const { result } = renderHook(() => useCompanionScheduleSettings('user-1'));
    const invalid = defaults(); invalid.entries[0].time = '25:00';
    expect(() => result.current.saveSettings(invalid)).toThrow('時刻とメッセージ');
    const duplicate = defaults(); duplicate.entries[1].time = '09:00';
    expect(() => result.current.saveSettings(duplicate)).toThrow('同じ時刻の声かけは1件にまとめてください');
    expect(() => result.current.saveSettings({ ...defaults(), targetDays: [] })).toThrow('対象日を1つ以上選んでください');
    expect(localStorage.getItem(key())).toBeNull();
    duplicate.entries[1].enabled = false;
    act(() => result.current.saveSettings(duplicate));
    expect(result.current.settings).toEqual(duplicate);
  });

  it('throws on a failed save without publishing it, and recovers from malformed stored settings', () => {
    localStorage.setItem(key(), '{broken');
    const { result } = renderHook(() => useCompanionScheduleSettings('user-1'));
    expect(result.current.settings).toEqual(DEFAULT_COMPANION_SCHEDULE);
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => result.current.saveSettings({ ...defaults(), enabled: false })).toThrow('このブラウザに保存できませんでした');
    expect(result.current.settings.enabled).toBe(true);
    write.mockRestore();
  });
});

describe('scheduled companion greeting lifecycle', () => {
  it('applies a changed day selection immediately while retaining the same-day seen marker', async () => {
    vi.setSystemTime(new Date('2026-09-12T09:00:00+09:00'));
    const view = renderHook(() => ({ ...useCompanionSchedule('user-1'), ...useCompanionScheduleSettings('user-1') }));
    await settle(); expect(view.result.current.greeting).toBeNull();
    act(() => view.result.current.saveSettings({ ...defaults(), targetDays: ['weekend'] })); await settle();
    expect(view.result.current.greeting?.message).toBe('おはようございます');
    act(() => view.result.current.saveSettings({ ...defaults(), targetDays: ['weekday'] })); await settle();
    expect(view.result.current.greeting).toBeNull();
    act(() => view.result.current.saveSettings({ ...defaults(), targetDays: ['weekend', 'holiday'] })); await settle();
    expect(view.result.current.greeting).toBeNull();
    expect(Object.keys(JSON.parse(localStorage.getItem(seenKey())!))).toEqual(['2026-09-12:morning']);
  });
  it('appears at the minute boundary once, including after a reload', async () => {
    vi.setSystemTime(new Date('2026-09-14T08:59:59+09:00'));
    const first = renderHook(() => useCompanionSchedule('user-1'));
    await settle(); expect(first.result.current.greeting).toBeNull();
    await advance(1010);
    expect(first.result.current.greeting?.message).toBe('おはようございます');
    act(() => first.result.current.dismiss());
    first.unmount();
    const second = renderHook(() => useCompanionSchedule('user-1'));
    await settle();
    expect(second.result.current.greeting).toBeNull();
    expect(Object.keys(JSON.parse(localStorage.getItem(seenKey())!))).toEqual(['2026-09-14:morning']);
  });

  it('lets only one mounted tab claim a greeting, including StrictMode effect replay', async () => {
    const first = renderHook(() => useCompanionSchedule('user-1'), { wrapper: StrictMode });
    const second = renderHook(() => useCompanionSchedule('user-1'), { wrapper: StrictMode });
    await settle();
    expect([first.result.current.greeting, second.result.current.greeting].filter(Boolean)).toHaveLength(1);
  });

  it('waits for an unread-notice bubble before claiming the recent greeting', async () => {
    const view = renderHook(({ blocked }) => useCompanionSchedule('user-1', { blocked }), { initialProps: { blocked: true } });
    await settle(); expect(view.result.current.greeting).toBeNull();
    expect(localStorage.getItem(seenKey())).toBeNull();
    view.rerender({ blocked: false }); await settle();
    expect(view.result.current.greeting?.message).toBe('おはようございます');
  });

  it('checks when visible again but never delivers a missed old greeting', async () => {
    visibility('hidden');
    const view = renderHook(() => useCompanionSchedule('user-1'));
    await settle(); expect(localStorage.getItem(seenKey())).toBeNull();
    vi.setSystemTime(new Date('2026-09-14T09:06:00+09:00'));
    act(() => visibility('visible')); await settle();
    expect(view.result.current.greeting).toBeNull();
    act(() => visibility('hidden'));
    vi.setSystemTime(new Date('2026-09-14T12:02:00+09:00'));
    act(() => visibility('visible')); await settle();
    expect(view.result.current.greeting?.message).toBe('お昼ですよ');
  });

  it.each(['hidden', 'blocked'])('discards a stale displayed greeting after being %s and picks the current one', async (reason) => {
    const view = renderHook(({ blocked }) => useCompanionSchedule('user-1', { blocked }), { initialProps: { blocked: false } });
    await settle(); expect(view.result.current.greeting?.message).toBe('おはようございます');
    if (reason === 'hidden') act(() => visibility('hidden')); else view.rerender({ blocked: true });
    vi.setSystemTime(new Date('2026-09-14T17:00:00+09:00'));
    if (reason === 'hidden') act(() => visibility('visible')); else view.rerender({ blocked: false });
    await settle();
    expect(view.result.current.greeting?.message).toBe('今日もお疲れ様でした');
  });

  it('pauses the thirty-second timeout and resumes its remaining time', async () => {
    const view = renderHook(({ paused }) => useCompanionSchedule('user-1', { paused }), { initialProps: { paused: false } });
    await settle(); await advance(10000);
    view.rerender({ paused: true }); await advance(60000);
    expect(view.result.current.greeting).not.toBeNull();
    view.rerender({ paused: false }); await advance(19999);
    expect(view.result.current.greeting).not.toBeNull();
    await advance(1); expect(view.result.current.greeting).toBeNull();
  });

  it('stops timers when switched off and does not revive a previously shown greeting', async () => {
    const view = renderHook(() => ({ ...useCompanionSchedule('user-1'), ...useCompanionScheduleSettings('user-1') }));
    await settle(); expect(view.result.current.greeting).not.toBeNull();
    act(() => view.result.current.saveSettings({ ...defaults(), enabled: false }));
    await advance(0); expect(view.result.current.greeting).toBeNull(); expect(vi.getTimerCount()).toBe(0);
    act(() => view.result.current.saveSettings(defaults())); await settle();
    expect(view.result.current.greeting).toBeNull();
    view.unmount(); await advance(0); expect(vi.getTimerCount()).toBe(0);
  });

  it('previews on a disabled weekend without recording a notice or carrying it to another user', async () => {
    vi.setSystemTime(new Date('2026-09-13T09:00:00+09:00'));
    localStorage.setItem(key(), JSON.stringify({ ...defaults(), enabled: false }));
    const view = renderHook(({ userId }) => useCompanionSchedule(userId), { initialProps: { userId: 'user-1' } });
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    act(() => previewCompanionGreeting('user-2', '別の人')); expect(view.result.current.greeting).toBeNull();
    act(() => previewCompanionGreeting('user-1', '  プレビュー  '));
    expect(view.result.current.greeting).toMatchObject({ preview: true, message: 'プレビュー' });
    expect(writes).not.toHaveBeenCalled();
    view.rerender({ userId: 'user-2' }); view.rerender({ userId: 'user-1' });
    await settle(); expect(view.result.current.greeting).toBeNull();
  });

  it('uses the stored ownership check without Web Locks', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    const first = renderHook(() => useCompanionSchedule('user-1'));
    const second = renderHook(() => useCompanionSchedule('user-1'));
    await advance(40);
    expect([first.result.current.greeting, second.result.current.greeting].filter(Boolean)).toHaveLength(1);
  });

  it('releases an undisplayed fallback claim on StrictMode replay and cancels pending timers on unmount', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    const view = renderHook(() => useCompanionSchedule('user-1'), { wrapper: StrictMode });
    await advance(40); expect(view.result.current.greeting?.message).toBe('おはようございます');
    const pending = renderHook(() => useCompanionSchedule('user-2'));
    pending.unmount(); await advance(0);
    expect(JSON.parse(localStorage.getItem(seenKey('user-2'))!)).toEqual({});
    view.unmount(); await advance(0); expect(vi.getTimerCount()).toBe(0);
  });

  it('does not display when it cannot persist the claim', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const view = renderHook(() => useCompanionSchedule('user-1'));
    await settle(); expect(view.result.current.greeting).toBeNull();
  });

  it('does not claim from a lock callback that resolves after unmount', async () => {
    let run: (() => boolean) | undefined;
    Object.defineProperty(navigator, 'locks', { configurable: true, value: {
      request: vi.fn((_key: string, callback: () => boolean) => new Promise<boolean>(resolve => { run = () => { const result = callback(); resolve(result); return result; }; })),
    } });
    const view = renderHook(() => useCompanionSchedule('user-1'));
    view.unmount();
    expect(run?.()).toBe(false);
    await settle(); expect(localStorage.getItem(seenKey())).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  });
});
