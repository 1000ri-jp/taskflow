import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppearanceProvider } from '@/components/providers/AppearanceProvider';
import { APPEARANCE_STORAGE_KEY, useAppearanceStore } from './appearanceStore';

describe('appearanceStore', () => {
  beforeEach(() => {
    localStorage.removeItem(APPEARANCE_STORAGE_KEY);
    useAppearanceStore.setState({ appearance: 'neo', hydrated: false, persistenceError: null });
    document.documentElement.removeAttribute('data-appearance');
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(['classic', 'ivory'])('starts with the same neo value before hydration, then restores %s', appearance => {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, appearance);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    expect(useAppearanceStore.getState().appearance).toBe('neo');
    expect(useAppearanceStore.getState().hydrated).toBe(false);
    useAppearanceStore.getState().hydrate();
    expect(useAppearanceStore.getState()).toMatchObject({ appearance, hydrated: true });
    expect(write).not.toHaveBeenCalled();
  });

  it.each([null, '', 'broken', '{"appearance":"classic"}', 'null'])('falls back to neo for unsupported storage: %s', value => {
    if (value !== null) localStorage.setItem(APPEARANCE_STORAGE_KEY, value);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    useAppearanceStore.getState().hydrate();
    expect(useAppearanceStore.getState().appearance).toBe('neo');
    expect(write).not.toHaveBeenCalled();
  });

  it('writes only the appearance key and can return to neo', () => {
    const write = vi.spyOn(Storage.prototype, 'setItem');
    useAppearanceStore.getState().setAppearance('classic');
    useAppearanceStore.getState().setAppearance('ivory');
    useAppearanceStore.getState().setAppearance('neo');
    expect(write.mock.calls).toEqual([[APPEARANCE_STORAGE_KEY, 'classic'], [APPEARANCE_STORAGE_KEY, 'ivory'], [APPEARANCE_STORAGE_KEY, 'neo']]);
    expect(useAppearanceStore.getState().appearance).toBe('neo');
  });

  it('keeps switching when reading or saving is blocked and recovers after a successful save', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    expect(() => useAppearanceStore.getState().hydrate()).not.toThrow();
    useAppearanceStore.getState().setAppearance('classic');
    useAppearanceStore.getState().hydrate();
    expect(useAppearanceStore.getState().appearance).toBe('classic');
    expect(useAppearanceStore.getState().persistenceError).toBeTruthy();
    write.mockRestore();
    useAppearanceStore.getState().setAppearance('neo');
    expect(useAppearanceStore.getState().persistenceError).toBeNull();
  });

  it.each(['classic', 'ivory'])('applies restored %s and locally selected design to html', appearance => {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, appearance);
    render(<AppearanceProvider><div>content</div></AppearanceProvider>);
    expect(document.documentElement.dataset.appearance).toBe(appearance);
    act(() => useAppearanceStore.getState().setAppearance('neo'));
    expect(document.documentElement.dataset.appearance).toBe('neo');
  });

  it('follows localStorage changes and deletion from other tabs without writing back', () => {
    const { unmount } = render(<AppearanceProvider><div /></AppearanceProvider>);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const dispatch = (key: string | null, newValue: string | null, storageArea: Storage = localStorage) => act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key, newValue, storageArea }));
    });
    dispatch(APPEARANCE_STORAGE_KEY, 'classic');
    expect(document.documentElement.dataset.appearance).toBe('classic');
    dispatch(APPEARANCE_STORAGE_KEY, 'ivory');
    expect(document.documentElement.dataset.appearance).toBe('ivory');
    dispatch('taskflow.other-preference', 'neo');
    dispatch(APPEARANCE_STORAGE_KEY, 'neo', sessionStorage);
    expect(useAppearanceStore.getState().appearance).toBe('ivory');
    dispatch(APPEARANCE_STORAGE_KEY, null);
    expect(document.documentElement.dataset.appearance).toBe('neo');
    dispatch(APPEARANCE_STORAGE_KEY, 'classic');
    dispatch(null, null);
    expect(document.documentElement.dataset.appearance).toBe('neo');
    expect(write).not.toHaveBeenCalled();
    unmount();
    dispatch(APPEARANCE_STORAGE_KEY, 'classic');
    expect(useAppearanceStore.getState().appearance).toBe('neo');
  });
});
