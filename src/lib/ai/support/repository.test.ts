// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AI_SUPPORT } from './profile';
import { readAISupportProfile, saveAISupportProfile } from './repository';
const mock = vi.hoisted(() => ({ docs: new Map<string, unknown>(), paths: [] as string[] }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => ({ doc: (path: string) => { mock.paths.push(path); return {
  get: async () => ({ exists: mock.docs.has(path), data: () => mock.docs.get(path) }), set: async (data: unknown) => { mock.docs.set(path, data); },
}; } }) }));
beforeEach(() => { mock.docs.clear(); mock.paths.length = 0; });
describe('owner-only support storage', () => {
  it('saves under the private settings subcollection and never modifies another owner or tasks', async () => {
    const profile = { ...DEFAULT_AI_SUPPORT, wishes: '次の一歩だけ' };
    await saveAISupportProfile('kozue', profile);
    expect(await readAISupportProfile('kozue')).toEqual(profile);
    expect(await readAISupportProfile('other')).toEqual(DEFAULT_AI_SUPPORT);
    expect([...mock.docs.keys()]).toEqual(['users/kozue/settings/aiSupport']);
    expect(mock.paths.every(path => /^users\/[^/]+\/settings\/aiSupport$/.test(path))).toBe(true);
  });
});
