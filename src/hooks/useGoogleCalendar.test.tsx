import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGoogleCalendar } from './useGoogleCalendar';
import { fetchGoogleCalendarEvents, GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE } from '@/lib/google/calendar';
import { GoogleAuthProvider, reauthenticateWithPopup } from 'firebase/auth';

vi.mock('@/stores/authStore', () => ({ useAuthStore: () => ({ firebaseUser: { uid: 'a', email: 'a@1000ri.jp' } }) }));
vi.mock('@/lib/google/calendar', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/google/calendar')>(), fetchGoogleCalendarEvents: vi.fn() }));
vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class {
    addScope = vi.fn();
    setCustomParameters = vi.fn();
    static credentialFromResult() { return { accessToken: 'test-only-token' }; }
  },
  reauthenticateWithPopup: vi.fn(),
}));
describe('Google Calendar upcoming window', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 3, 12)); vi.mocked(fetchGoogleCalendarEvents).mockResolvedValue([]); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  it('only connects explicitly and fetches today through the end of day five with read-only scope', async () => {
    const { result } = renderHook(() => useGoogleCalendar());
    expect(fetchGoogleCalendarEvents).not.toHaveBeenCalled();
    await act(async () => { await result.current.connect(); });
    expect(fetchGoogleCalendarEvents).toHaveBeenCalledExactlyOnceWith({ accessToken: 'test-only-token', timeMin: new Date(2026, 8, 3), timeMax: new Date(2026, 8, 8, 23, 59, 59, 999) });
    const provider = vi.mocked(reauthenticateWithPopup).mock.calls[0][1] as GoogleAuthProvider;
    expect(provider.addScope).toHaveBeenCalledWith(GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE);
    expect(result.current.status).toBe('connected');
  });
});
