import { afterEach, describe, expect, it, vi } from 'vitest';
import { acknowledgeArchive, hasAcknowledgedArchive } from './archiveNotice';

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });
describe('archive notice persistence', () => {
  it('remembers in this session even when storage can be read but is full', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    expect(hasAcknowledgedArchive('quota-user', 'task')).toBe(false);
    acknowledgeArchive('quota-user', 'task');
    expect(hasAcknowledgedArchive('quota-user', 'task')).toBe(true);
    expect(hasAcknowledgedArchive('quota-user', 'project')).toBe(false);
    expect(hasAcknowledgedArchive('another-user', 'task')).toBe(false);
    setItem.mockRestore();
    acknowledgeArchive('quota-user', 'task');
    localStorage.clear();
    expect(hasAcknowledgedArchive('quota-user', 'task')).toBe(false);
  });
});
