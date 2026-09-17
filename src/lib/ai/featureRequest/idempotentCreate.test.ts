// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { createProjectTask } from '@/lib/firebase/admin-projects';
const fake = vi.hoisted(() => ({ data: new Map<string, Record<string, unknown>>(), creates: 0 }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => {
  const tasks = {
    get: async () => ({ docs: [...fake.data.entries()].map(([id, data]) => ({ id, data: () => data })) }),
    doc: (id: string) => ({ id, get: async () => ({ id, exists: fake.data.has(id), data: () => fake.data.get(id) }) }),
  };
  const lists = { orderBy: () => ({ get: async () => ({ docs: [{ id: 'requests', data: () => ({ name: '要望', order: 0 }) }] }) }) };
  return { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ memberIds: ['owner', 'other'], defaultAssigneeId: 'owner' }) }), collection: (name: string) => name === 'lists' ? lists : tasks }) }), runTransaction: async (callback: (transaction: unknown) => Promise<unknown>) => callback({ get: (ref: { get: () => Promise<unknown> }) => ref.get(), create: (ref: { id: string }, data: Record<string, unknown>) => { fake.creates++; fake.data.set(ref.id, data); } }) };
} }));
beforeEach(() => { fake.data.clear(); fake.creates = 0; });
it('creates once, returns the existing task after a lost response, and refuses changed-content or identity retries', async () => {
  const input = { listId: 'requests', title: '通知を改善', description: '説明' };
  const receipt = { taskId: 'request-test', fingerprint: 'same-content' };
  const first = await createProjectTask('p', 'owner', input, receipt);
  fake.data.get('request-test')!.title = '担当者が変更した名前';
  const retry = await createProjectTask('p', 'owner', input, receipt);
  expect(retry.task.id).toBe(first.task.id); expect(retry.task.title).toBe('担当者が変更した名前'); expect(fake.creates).toBe(1);
  await expect(createProjectTask('p', 'other', input, receipt)).rejects.toThrow('REQUEST_CONFLICT');
  await expect(createProjectTask('p', 'owner', input, { ...receipt, fingerprint: 'changed' })).rejects.toThrow('REQUEST_CONFLICT');
  expect(fake.creates).toBe(1);
});
