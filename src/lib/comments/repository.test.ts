import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transaction } from 'firebase-admin/firestore';
const fake = vi.hoisted(() => ({ data: new Map<string, Record<string, unknown>>(), writes: [] as string[], fail: false, loseAck: false, tail: Promise.resolve() as Promise<unknown> }));
vi.mock('@/lib/firebase/admin', () => {
  const ref = (path: string): object => ({ path, id: path.split('/').at(-1), collection: (part: string) => ref(`${path}/${part}`), doc: (part: string) => ref(`${path}/${part}`), limit: (limit: number) => ({ path, limit }), get: async () => snap(path), set: async (data: Record<string, unknown>) => { fake.data.set(path, data); fake.writes.push(path); } });
  const snap = (path: string) => ({ exists: fake.data.has(path), id: path.split('/').at(-1), data: () => structuredClone(fake.data.get(path)) });
  return { getAdminDb: () => ({ doc: ref, runTransaction: (fn: (tx: Transaction) => Promise<unknown>) => {
    const execute = async () => {
      const writes: { path: string; data?: Record<string, unknown> }[] = [];
      const tx = {
        get: async ({ path, limit }: { path: string; limit?: number }) => {
          if (typeof limit !== 'number') return snap(path);
          const docs = [...fake.data.keys()].filter(key => key.startsWith(`${path}/`) && key.split('/').length === path.split('/').length + 1).slice(0, limit).map(snap);
          return { docs, size: docs.length };
        },
        set: ({ path }: { path: string }, data: Record<string, unknown>) => writes.push({ path, data }),
        delete: ({ path }: { path: string }) => writes.push({ path }),
      };
      const result = await fn(tx as unknown as Transaction);
      if (fake.fail) throw new Error('offline');
      writes.forEach(({ path, data }) => { if (data) fake.data.set(path, structuredClone(data)); else fake.data.delete(path); fake.writes.push(path); });
      if (fake.loseAck) { fake.loseAck = false; throw new Error('ack lost'); }
      return result;
    };
    const result = fake.tail.then(execute); fake.tail = result.catch(() => {}); return result;
  } }) };
});
import { checkCustomStampRegistration, readReactions, readStampSettings, registerCustomStamp, removeCustomStamp, saveStampSettings, setReaction } from './repository';
import { stampImageUrl } from './stampImageIdentity';
import type { CustomSeenStamp, CustomSeenStampId } from './reactions';
const target = { projectId: 'p', taskId: 't', commentId: 'c' };
const input = { ...target, kind: 'seen', stampId: 'meruru', active: true };
const root = 'projects/p/tasks/t/comments/c';
beforeEach(() => {
  fake.data.clear(); fake.writes = []; fake.fail = false; fake.loseAck = false; fake.tail = Promise.resolve();
  fake.data.set('projects/p', { memberIds: ['alice', 'bob'] });
  fake.data.set('projects/p/tasks/t', { isCompleted: false, updatedAt: 'original' });
  fake.data.set(root, { content: '読んでね', updatedAt: 'original' });
  fake.data.set('users/alice', { displayName: 'Alice' }); fake.data.set('users/bob', { displayName: 'Bob' });
});

const settingsPath = 'users/alice/settings/commentStamps';
const uploadHash = 'a'.repeat(64);
const customId = (index = 1): CustomSeenStampId => `custom_00000000-0000-0000-0000-${String(index).padStart(12, '0')}`;
const custom = (index = 1): CustomSeenStamp => ({ id: customId(index), name: `お気に入り${index}`, imageUrl: stampImageUrl('project.appspot.com', 'alice', customId(index), '00000000-0000-0000-0000-000000000001') });

describe('personal original stamp catalog', () => {
  it('removes only the owner catalog entry, resets a removed favorite, and keeps historical reactions', async () => {
    await registerCustomStamp('alice', custom(2), uploadHash);
    await registerCustomStamp('alice', custom(), uploadHash);
    await setReaction('alice', { ...input, stampId: customId() });
    const before = structuredClone([...fake.data]); fake.writes = [];
    expect(await removeCustomStamp('bob', { id: customId() })).toEqual({ seenStampId: 'wave' });
    expect(fake.writes).toEqual([]);
    expect(await removeCustomStamp('alice', { id: customId() })).toEqual({ seenStampId: 'wave', customStamps: [custom(2)] });
    expect(fake.writes).toEqual([settingsPath]);
    before.filter(([path]) => path !== settingsPath).forEach(([path, data]) => expect(fake.data.get(path)).toEqual(data));
    expect((fake.data.get(settingsPath)?.customStamps as object[])[0]).toHaveProperty('requestHash', uploadHash);
    expect((await readReactions('bob', target, ['c'])).c.reactions[0].marks.seen?.customStamp?.imageUrl).toBe(custom().imageUrl);
    await expect(saveStampSettings('alice', { seenStampId: customId() })).rejects.toMatchObject({ status: 403 });
  });
  it('retries uncertain removal without overriding a newer favorite and retains data on failure', async () => {
    await registerCustomStamp('alice', custom(), uploadHash);
    fake.fail = true;
    await expect(removeCustomStamp('alice', { id: customId() })).rejects.toThrow('offline');
    expect((await readStampSettings('alice')).customStamps).toEqual([custom()]);
    fake.fail = false; fake.loseAck = true;
    await expect(removeCustomStamp('alice', { id: customId() })).rejects.toThrow('ack lost');
    await saveStampSettings('alice', { seenStampId: 'cat' }); fake.writes = [];
    expect(await removeCustomStamp('alice', { id: customId() })).toEqual({ seenStampId: 'cat', customStamps: [] });
    expect(fake.writes).toEqual([]);
  });
  it('rejects removal of built-ins and caller-supplied ownership without writing', async () => {
    await expect(removeCustomStamp('alice', { id: 'wave' })).rejects.toMatchObject({ status: 422 });
    await expect(removeCustomStamp('alice', { id: customId(), userId: 'bob' })).rejects.toMatchObject({ status: 422 });
    expect(fake.writes).toEqual([]);
  });
  it('registers and selects a personal image, preserving settings and hiding internal upload identity', async () => {
    fake.data.set(settingsPath, { seenStampId: 'meruru', otherSetting: 'keep' });
    expect(await registerCustomStamp('alice', custom(), uploadHash)).toEqual({ seenStampId: customId(), customStamps: [custom()] });
    expect(fake.data.get(settingsPath)?.otherSetting).toBe('keep');
    expect((fake.data.get(settingsPath)?.customStamps as object[])[0]).toHaveProperty('requestHash', uploadHash);
    expect(JSON.stringify(await readStampSettings('alice'))).not.toContain('requestHash');
    expect(await readStampSettings('bob')).toEqual({ seenStampId: 'wave' });
    expect(fake.writes).toEqual([settingsPath]);
  });
  it('keeps custom images when changing the favorite and does not allow another person to select them', async () => {
    await registerCustomStamp('alice', custom(), uploadHash);
    expect(await saveStampSettings('alice', { seenStampId: 'flower' })).toEqual({ seenStampId: 'flower', customStamps: [custom()] });
    await expect(saveStampSettings('bob', { seenStampId: customId() })).rejects.toMatchObject({ status: 403 });
    await expect(saveStampSettings('alice', { seenStampId: 'wave', customStamps: [] })).rejects.toMatchObject({ status: 422 });
    expect((await saveStampSettings('alice', { seenStampId: customId() })).seenStampId).toBe(customId());
  });
  it('preserves the original image snapshot for project members after the favorite/catalog changes', async () => {
    await registerCustomStamp('alice', custom(), uploadHash);
    await setReaction('alice', { ...input, stampId: customId() });
    await saveStampSettings('alice', { seenStampId: 'cat' });
    fake.data.set(settingsPath, { seenStampId: 'cat', customStamps: [] });
    const mark = (await readReactions('bob', target, ['c'])).c.reactions.find(row => row.userId === 'alice')?.marks.seen;
    expect(mark).toEqual(expect.objectContaining({ stampId: customId(), customStamp: { name: custom().name, imageUrl: custom().imageUrl } }));
    await setReaction('alice', { ...input, stampId: customId(), active: false });
    expect(fake.data.has(`${root}/reactions/alice`)).toBe(false);
  });
  it('refuses another user catalog or caller-supplied snapshot without writing a reaction', async () => {
    await registerCustomStamp('alice', custom(), uploadHash); fake.writes = [];
    await expect(setReaction('bob', { ...input, stampId: customId() })).rejects.toMatchObject({ status: 403 });
    await expect(setReaction('alice', { ...input, stampId: customId(), customStamp: { imageUrl: 'https://example.com' } })).rejects.toMatchObject({ status: 422 });
    expect(fake.writes).toEqual([]);
  });
  it('does not rewrite existing marks on a retry even if the favorite changes or catalog becomes unavailable', async () => {
    await registerCustomStamp('alice', custom(), uploadHash);
    fake.loseAck = true;
    await expect(setReaction('alice', { ...input, stampId: customId() })).rejects.toThrow('ack lost');
    const saved = structuredClone(fake.data.get(`${root}/reactions/alice`));
    fake.data.set(settingsPath, { customStamps: 'bad' }); fake.writes = [];
    expect(await setReaction('alice', { ...input, stampId: customId() })).toEqual(saved);
    expect(fake.writes).toEqual([]);
  });
  it('retries a lost registration acknowledgement without duplicates or overriding a later favorite', async () => {
    fake.loseAck = true;
    await expect(registerCustomStamp('alice', custom(), uploadHash)).rejects.toThrow('ack lost');
    await saveStampSettings('alice', { seenStampId: 'flower' }); fake.writes = [];
    expect(await checkCustomStampRegistration('alice', custom(), uploadHash)).toEqual({ seenStampId: 'flower', customStamps: [custom()] });
    expect(await registerCustomStamp('alice', custom(), uploadHash)).toEqual({ seenStampId: 'flower', customStamps: [custom()] });
    expect(fake.writes).toEqual([]);
    await expect(registerCustomStamp('alice', custom(), 'b'.repeat(64))).rejects.toMatchObject({ status: 409 });
    await expect(registerCustomStamp('alice', { ...custom(), name: '別の名前' }, uploadHash)).rejects.toMatchObject({ status: 409 });
  });
  it('checks the 20 item limit inside the transaction under concurrent registrations', async () => {
    for (let i = 1; i <= 19; i++) await registerCustomStamp('alice', custom(i), uploadHash);
    const results = await Promise.allSettled([registerCustomStamp('alice', custom(20), uploadHash), registerCustomStamp('alice', custom(21), uploadHash)]);
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
    expect((await readStampSettings('alice')).customStamps).toHaveLength(20);
    await expect(checkCustomStampRegistration('alice', custom(22), uploadHash)).rejects.toThrow('20点');
    expect(await registerCustomStamp('alice', custom(20), uploadHash)).toHaveProperty('seenStampId', customId(20));
  });
  it('reports invalid or missing image ownership as unavailable instead of losing a catalog', async () => {
    fake.data.set(settingsPath, { seenStampId: customId(), customStamps: [{ ...custom(), imageUrl: 'https://example.com/a.png' }] });
    await expect(readStampSettings('alice')).rejects.toMatchObject({ status: 503 });
    await expect(saveStampSettings('alice', { seenStampId: 'cat' })).rejects.toMatchObject({ status: 503 });
    await expect(registerCustomStamp('bob', custom(), uploadHash)).rejects.toMatchObject({ status: 422 });
    expect(fake.writes).toEqual([]);
  });
  it('leaves a failed catalog commit unchanged and accepts a later retry', async () => {
    fake.fail = true;
    await expect(registerCustomStamp('alice', custom(), uploadHash)).rejects.toThrow('offline');
    expect(fake.data.has(settingsPath)).toBe(false);
    fake.fail = false;
    expect((await registerCustomStamp('alice', custom(), uploadHash)).customStamps).toEqual([custom()]);
  });
});
describe('comment reactions with independent ownership', () => {
  it('keeps simultaneous reactions from two people and preserves all shared sources', async () => {
    const before = structuredClone([...fake.data]);
    await Promise.all([setReaction('alice', input), setReaction('bob', input)]);
    const read = await readReactions('alice', target, ['c']);
    expect(read.c.reactions.map(row => row.displayName).sort()).toEqual(['Alice', 'Bob']);
    expect(read.c.own?.userId).toBe('alice');
    expect(fake.writes).toEqual([`${root}/reactions/alice`, `${root}/reactions/bob`]);
    before.forEach(([path, data]) => expect(fake.data.get(path)).toEqual(data));
  });
  it('cancels only the authenticated user and selected kind; keeps thanks and the other person', async () => {
    await setReaction('alice', input); await setReaction('bob', input);
    await setReaction('alice', { ...input, kind: 'thanks', stampId: 'thanks' });
    await setReaction('alice', { ...input, active: false });
    expect((await readReactions('alice', target, ['c'])).c.own?.marks).toHaveProperty('thanks');
    expect(fake.data.get(`${root}/reactions/alice`)?.marks).not.toHaveProperty('seen');
    await setReaction('alice', { ...input, kind: 'thanks', stampId: 'thanks', active: false });
    expect(fake.data.has(`${root}/reactions/alice`)).toBe(false);
    expect(fake.data.has(`${root}/reactions/bob`)).toBe(true);
  });
  it('refuses spoofed owners, non-members, missing sources, path traversal, and invalid stamps', async () => {
    await expect(setReaction('alice', { ...input, userId: 'bob', active: false })).rejects.toThrow('操作');
    await expect(setReaction('outsider', input)).rejects.toMatchObject({ status: 403 });
    await expect(setReaction('alice', { ...input, projectId: '../p' })).rejects.toThrow('対象');
    await expect(setReaction('alice', { ...input, stampId: 'unregistered' })).rejects.toThrow('スタンプ');
    await expect(setReaction('alice', { ...input, commentId: 'deleted' })).rejects.toMatchObject({ status: 404 });
    await expect(readReactions('outsider', target, ['c'])).rejects.toMatchObject({ status: 403 });
    expect(fake.writes).toEqual([]);
  });
  it('supports membership documents and refuses a revoked membership on the next write', async () => {
    fake.data.set('projects/p/members/carol', { userId: 'carol' });
    await setReaction('carol', input);
    fake.data.delete('projects/p/members/carol');
    await expect(setReaction('carol', { ...input, active: false })).rejects.toMatchObject({ status: 403 });
  });
  it('retries add and remove after lost acknowledgement without duplication or changed timestamps', async () => {
    fake.loseAck = true;
    await expect(setReaction('alice', input)).rejects.toThrow('ack lost');
    const saved = structuredClone(fake.data.get(`${root}/reactions/alice`));
    await setReaction('alice', input); await setReaction('alice', input);
    expect(fake.data.get(`${root}/reactions/alice`)).toEqual(saved); expect(fake.writes).toHaveLength(1);
    fake.loseAck = true;
    await expect(setReaction('alice', { ...input, active: false })).rejects.toThrow('ack lost');
    await setReaction('alice', { ...input, active: false }); expect(fake.writes).toHaveLength(2);
  });
  it('does not mutate on commit failure', async () => {
    fake.fail = true; await expect(setReaction('alice', input)).rejects.toThrow('offline');
    expect(fake.writes).toEqual([]);
  });
  it('bounds batch reads, labels partial results, and still fetches the caller outside the limit', async () => {
    for (let i = 0; i < 205; i++) fake.data.set(`${root}/reactions/member${i}`, { displayName: 'member', marks: {} });
    await setReaction('alice', input);
    const { c } = await readReactions('alice', target, ['c']);
    expect(c.partial).toBe(true); expect(c.reactions).toHaveLength(201); expect(c.own?.userId).toBe('alice');
    await expect(readReactions('alice', target, Array.from({ length: 21 }, (_, i) => `c${i}`))).rejects.toThrow('20件');
  });
  it('saves favorite independently without changing historical reactions', async () => {
    expect(await readStampSettings('alice')).toEqual({ seenStampId: 'wave' });
    await setReaction('alice', input);
    await saveStampSettings('alice', { seenStampId: 'cat' });
    expect(await readStampSettings('alice')).toEqual({ seenStampId: 'cat' });
    expect(await readStampSettings('bob')).toEqual({ seenStampId: 'wave' });
    expect((await readReactions('alice', target, ['c'])).c.own?.marks.seen?.stampId).toBe('meruru');
    await expect(saveStampSettings('alice', { seenStampId: 'wave', userId: 'bob' })).rejects.toThrow();
  });
});
