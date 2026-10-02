// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { initializeApp } from 'firebase/app';
import { collection, doc, getFirestore, serverTimestamp } from 'firebase/firestore';
import { stampTaskWrite as serverStamp } from './changeStamp.server';
import { stampTaskWrite as clientStamp } from './changeStamp.client';
import { descriptionVersion } from '@/lib/ai/descriptionOperations';
import { canonicalOrganizationValue } from './organizationIdentity';
import { automationHash } from './automationRepository';

describe('task commit markers', () => {
  it('uses server transforms for root writes and overwrites copied markers without changing business fields', () => {
    const updatedAt = new Date(1); const before = { title: 'task', updatedAt, apiChangedAt: Timestamp.fromMillis(0) };
    const after = serverStamp({ path: 'projects/p/tasks/t' }, before);
    expect((after.apiChangedAt as unknown as FieldValue).isEqual(FieldValue.serverTimestamp())).toBe(true);
    expect(after.updatedAt).toBe(updatedAt); expect(before.apiChangedAt).toBeInstanceOf(Timestamp);
    expect(serverStamp({ path: 'projects/p/tasks' }, { title: 'new' })).toHaveProperty('apiChangedAt');
    for (const path of ['projects/p/tasks/t/comments/c', 'projects/p/tasks/t/checklists/c', 'projects/p/activityLogs/l', 'projects/p']) expect(serverStamp({ path }, before)).toBe(before);
  });
  it('uses real browser SDK reference paths and its serverTimestamp transform', () => {
    const db = getFirestore(initializeApp({ projectId: 'demo-change-stamp', apiKey: 'example', appId: 'example' }, 'change-stamp-test'));
    for (const ref of [collection(db, 'projects/p/tasks'), doc(db, 'projects/p/tasks/t')]) expect(clientStamp(ref, { updatedAt: 'keep' })).toEqual({ updatedAt: 'keep', apiChangedAt: serverTimestamp() });
    const data = { content: 'comment' }; expect(clientStamp(doc(db, 'projects/p/tasks/t/comments/c'), data)).toBe(data);
  });
  it('keeps integration metadata out of undo and approval work versions', () => {
    const task = { title: 'work', updatedAt: new Date(1), isCompleted: false };
    const marked = { ...task, apiChangedAt: Timestamp.fromMillis(10) };
    expect(descriptionVersion(marked)).toBe(descriptionVersion(task));
    expect(canonicalOrganizationValue(marked)).toEqual(canonicalOrganizationValue(task));
    expect(automationHash(marked)).toBe(automationHash(task));
    expect(descriptionVersion({ ...marked, title: 'edit' })).not.toBe(descriptionVersion(task));
  });
});
