import { beforeEach, expect, it, vi } from 'vitest';
import { frequentRecipientIds, rememberRecipients } from './frequentRecipients';
beforeEach(() => localStorage.clear());
it('ranks distinct successful receipts by frequency then recency without counting retries twice', () => {
  rememberRecipients('u', 'p', 'one', ['a', 'a', 'b']);
  rememberRecipients('u', 'p', 'two', ['c', 'b']);
  rememberRecipients('u', 'p', 'one', ['a', 'b']);
  expect(frequentRecipientIds('u', 'p')).toEqual(['b', 'c', 'a']);
  expect(frequentRecipientIds('other', 'p')).toEqual([]);
  expect(frequentRecipientIds('u', 'other')).toEqual([]);
});
it('keeps a bounded recent history', () => {
  rememberRecipients('u', 'p', 'old', ['old']);
  for (let index = 0; index < 30; index++) rememberRecipients('u', 'p', `new-${index}`, ['new']);
  expect(frequentRecipientIds('u', 'p')).toEqual(['new']);
});
it('ignores corrupt or unavailable optional browser storage', () => {
  localStorage.setItem('taskflow-comment-recipients-v1:u:p', '{bad');
  expect(frequentRecipientIds('u', 'p')).toEqual([]);
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  try { expect(() => rememberRecipients('u', 'p', 'receipt', ['a'])).not.toThrow(); }
  finally { write.mockRestore(); }
});
