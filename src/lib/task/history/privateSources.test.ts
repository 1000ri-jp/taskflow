import { describe, expect, it } from 'vitest';
import { emptyGoogleSource } from '@/lib/google/workspace/types';
import type { IncomingDecision } from '@/lib/secretary/incomingDecisions';
import { taskPrivateSources, type PrivateSourceContext } from './privateSources';
const now = '2026-09-12T02:00:00Z';
const context = (): PrivateSourceContext => ({ userId: 'u', email: 'u@example.com', allowedProject: true, checkedAt: now, sources: {
  gmail: { ...emptyGoogleSource(), connected: true, status: 'ready', fetchedAt: now, items: [
    { id: 'm', title: '本人の注文', text: 'private body', sourceName: '送り主', at: '2026-09-10T00:00:00Z', url: 'https://mail.google.com/mail/#all/m' },
    { id: 'unlinked', title: '別のメール', text: 'unrelated secret', sourceName: '送り主', at: now, url: '' },
  ] }, chat: emptyGoogleSource(),
} });
const decision = (patch: Partial<IncomingDecision> = {}): IncomingDecision => ({ key: JSON.stringify(['u', 'u@example.com', ['gmail:m']]), scope: 'older-scope', title: 'old private title', sources: [{ service: 'gmail', id: 'm', version: 'v1' }], related: [{ key: 'p/t', version: 'v1' }], status: 'linked', reason: 'old secret inference', trigger: '', reviewAt: null, updatedAt: now, operationId: 'op', fingerprint: 'fp', before: null, ...patch });
describe('current owner-only task sources', () => {
  it('exposes only explicitly linked current cache text, original date and separate linkage date', () => {
    const result = taskPrivateSources([decision()], context(), 'p/t');
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ text: 'private body', at: '2026-09-10T00:00:00Z', recordedAt: now, private: true });
    expect(JSON.stringify(result)).not.toMatch(/unrelated secret|old secret inference|old private title/);
  });
  it('withholds text after account replacement, project AI grant revocation and source selection removal', () => {
    const changedAccount = { ...context(), email: 'someone-else@example.com' };
    const denied = { ...context(), allowedProject: false };
    const narrowed = context(); narrowed.sources!.gmail.items = [];
    for (const ctx of [changedAccount, denied, narrowed]) {
      const result = taskPrivateSources([decision()], ctx, 'p/t');
      expect(result.entries).toEqual([]); expect(result.unavailableLinks).toBe(1);
      expect(JSON.stringify(result)).not.toContain('private body');
    }
  });
  it('does not call failed, stale, unconnected or partial reads a complete history', () => {
    for (const mode of ['error', 'stale', 'disconnected'] as const) {
      const ctx = context();
      if (mode === 'error') ctx.sources!.gmail.status = 'error';
      if (mode === 'stale') ctx.sources!.gmail.fetchedAt = '2026-09-01T00:00:00Z';
      if (mode === 'disconnected') ctx.sources!.gmail.connected = false;
      const result = taskPrivateSources([decision()], ctx, 'p/t');
      expect(result.entries).toEqual([]); expect(result.status).toBe('partial');
    }
    const partial = context(); partial.sources!.gmail.status = 'partial';
    expect(taskPrivateSources([decision()], partial, 'p/t')).toMatchObject({ status: 'partial', unavailableLinks: 0 });
  });
  it('keeps task and user boundaries, suppresses undone links and duplicate source ids', () => {
    const links = [decision(), decision({ key: JSON.stringify(['u', 'u@example.com', ['gmail:m', 'chat:c']]) }), decision({ status: 'cleared' })];
    expect(taskPrivateSources(links, context(), 'p/t').entries).toHaveLength(1);
    expect(taskPrivateSources(links, context(), 'p/other').entries).toHaveLength(0);
    expect(taskPrivateSources([decision({ key: JSON.stringify(['other', 'u@example.com', ['gmail:m']]) })], context(), 'p/t').entries).toHaveLength(0);
  });
});
