import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useGoogleCalendar } from './useGoogleCalendar';
import { emptyGoogleWorkspace } from '@/lib/google/workspace/types';
import { useGoogleWorkspace } from './useGoogleWorkspace';
vi.mock('./useGoogleWorkspace', () => ({ useGoogleWorkspace: vi.fn() }));
afterEach(cleanup);
describe('Persistent Google Calendar display', () => {
  it('restores saved events on mount without another consent popup', () => {
    const data = emptyGoogleWorkspace(true); const connect = vi.fn();
    data.sources.calendar = { connected: true, fetchedAt: '2026-09-10T00:00:00Z', attemptedAt: '2026-09-10T00:00:00Z', status: 'ready', error: null,
      items: [{ id: 'e', title: 'saved event', at: '2026-09-10T00:00:00+09:00', end: '2026-09-11T00:00:00+09:00', allDay: true, text: '', url: 'https://calendar.google.com/', sourceName: 'primary' }] };
    vi.mocked(useGoogleWorkspace).mockReturnValue({ data, connect, loading: false, error: null } as unknown as ReturnType<typeof useGoogleWorkspace>);
    const { result } = renderHook(() => useGoogleCalendar());
    expect(result.current.status).toBe('connected');
    expect(result.current.events[0].start).toEqual(new Date('2026-09-09T15:00:00Z'));
    expect(connect).not.toHaveBeenCalled();
  });
  it('keeps the prior events with an explicit refresh error', () => {
    const data = emptyGoogleWorkspace(true);
    data.sources.calendar = { ...data.sources.calendar, connected: true, fetchedAt: '2026-09-10T00:00:00Z', status: 'error', error: '再接続が必要です。' };
    vi.mocked(useGoogleWorkspace).mockReturnValue({ data, loading: false, error: null } as unknown as ReturnType<typeof useGoogleWorkspace>);
    const { result } = renderHook(() => useGoogleCalendar());
    expect(result.current.status).toBe('connected'); expect(result.current.error).toBe('再接続が必要です。');
  });
});
