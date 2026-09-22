import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MiniWindowControls } from './MiniWindowControls';
import { MINI_WINDOW_PREFERENCE_KEY, miniWindowBridge } from '@/hooks/useMiniWindowPreference';

beforeEach(() => {
  localStorage.removeItem(MINI_WINDOW_PREFERENCE_KEY);
  window.dispatchEvent(new StorageEvent('storage', { key: MINI_WINDOW_PREFERENCE_KEY }));
  vi.spyOn(miniWindowBridge, 'open').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('sends show then hide once each, retaining the choice across panel mounts', () => {
  const { unmount } = render(<MiniWindowControls />);
  const toggle = screen.getByRole('switch');
  expect(toggle).not.toBeChecked();
  expect(miniWindowBridge.open).not.toHaveBeenCalled();
  fireEvent.click(toggle);
  expect(toggle).toBeChecked();
  expect(miniWindowBridge.open).toHaveBeenCalledExactlyOnceWith(true);
  expect(localStorage.getItem(MINI_WINDOW_PREFERENCE_KEY)).toBe('true');
  unmount(); render(<MiniWindowControls />);
  expect(screen.getByRole('switch')).toBeChecked();
  fireEvent.click(screen.getByRole('switch'));
  expect(screen.getByRole('switch')).not.toBeChecked();
  expect(miniWindowBridge.open).toHaveBeenNthCalledWith(2, false);
  expect(miniWindowBridge.open).toHaveBeenCalledTimes(2);
});
it('syncs another tab without sending native commands', () => {
  render(<MiniWindowControls />);
  act(() => { localStorage.setItem(MINI_WINDOW_PREFERENCE_KEY, 'true'); window.dispatchEvent(new StorageEvent('storage', { key: MINI_WINDOW_PREFERENCE_KEY })); });
  expect(screen.getByRole('switch')).toBeChecked();
  expect(miniWindowBridge.open).not.toHaveBeenCalled();
});
it('still toggles when preference storage is blocked', () => {
  render(<MiniWindowControls />);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  fireEvent.click(screen.getByRole('switch'));
  expect(screen.getByRole('switch')).toBeChecked();
  fireEvent.click(screen.getByRole('switch'));
  expect(screen.getByRole('switch')).not.toBeChecked();
  expect(miniWindowBridge.open).toHaveBeenNthCalledWith(2, false);
});
