import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { organizationLabNotifications, useOrganizationLabNotifications } from './useOrganizationLabNotifications';
import { organizationMockKey, readOrganizationMock } from '@/lib/task/organizationMock';
import type { AllChildrenCompletionPolicy } from '@/lib/task/automationTypes';

const uid = 'e2e-mock-user';
const key = organizationMockKey('secretary-demo');
const now = new Date();
function workbench() {
  const work = readOrganizationMock();
  const parent = work.data.tasks['purchase-parent']; parent.dueDate = now;
  parent.completionPolicy = { kind: 'all_required_children', condition: '必要な全員が購入した', grantedBy: uid, grantedAt: now.toISOString(), required: [{ taskId: 'purchase-self', assigneeId: uid }, { taskId: 'purchase-peer', assigneeId: 'demo-colleague' }] } satisfies AllChildrenCompletionPolicy;
  work.data.tasks['purchase-self'].isCompleted = true;
  work.data.tasks['purchase-peer'].automation = { check: 'unavailable' };
  work.automationStates = { [uid]: { uid, revision: 1, automationEnabled: true, grants: [], reminders: [{ projectId: 'secretary-demo', taskId: 'purchase-parent', dueDate: now.toISOString(), notifiedSignature: 'pending', snoozedUntil: null, sequence: 0 }] } };
  return work;
}
beforeEach(() => { localStorage.removeItem(key); });

describe('read-only product reminders in the isolated workbench', () => {
  it('derives the existing notification shape without exposing mail or calling unavailable evidence unpaid', () => {
    const work = workbench(); const before = JSON.stringify(work);
    work.automationEvidence = { [uid]: [{ id: 'private-mail', source: 'gmail', version: 'v1', text: 'PRIVATE BODY', at: now.toISOString(), sender: 'private@example.test', authorId: uid, url: 'https://mail.google.com/private' }] };
    const notifications = organizationLabNotifications(work, uid, now);
    expect(notifications).toHaveLength(1); expect(notifications[0]).toMatchObject({ type: 'due_reminder', userId: uid, taskId: 'purchase-parent', data: { automation: true, pending: [{ taskId: 'purchase-peer', assigneeId: 'demo-colleague', check: 'unavailable' }] } });
    expect(notifications[0].message).toContain('1人分の完了が未確認'); expect(JSON.stringify(notifications)).not.toMatch(/PRIVATE BODY|private@example|mail.google.com|未購入/);
    delete work.automationEvidence; expect(JSON.stringify(work)).toBe(before);
  });
  it('follows snooze, completion, changed due date, policy removal and the authenticated owner', () => {
    const work = workbench(); const reminder = work.automationStates![uid].reminders[0];
    reminder.snoozedUntil = new Date(now.getTime() + 3600000).toISOString(); expect(organizationLabNotifications(work, uid, now)).toEqual([]);
    reminder.snoozedUntil = null; work.data.tasks['purchase-peer'].isCompleted = true; expect(organizationLabNotifications(work, uid, now)).toEqual([]);
    work.data.tasks['purchase-peer'].isCompleted = false; work.data.tasks['purchase-parent'].dueDate = new Date(now.getTime() + 7 * 86400000); expect(organizationLabNotifications(work, uid, now)).toEqual([]);
    work.data.tasks['purchase-parent'].dueDate = now; expect(organizationLabNotifications(work, 'demo-colleague', now)).toEqual([]);
    work.data.tasks['purchase-parent'].completionPolicy = null; expect(organizationLabNotifications(work, uid, now)).toEqual([]);
  });
  it('never seeds storage and reacts to the shared work update event without altering saved work', async () => {
    const { result } = renderHook(() => useOrganizationLabNotifications(true, uid));
    await act(async () => {}); expect(result.current.notifications).toEqual([]); expect(localStorage.getItem(key)).toBeNull();
    const work = workbench(); const saved = JSON.stringify(work);
    act(() => { localStorage.setItem(key, saved); window.dispatchEvent(new Event('taskflow-work-updated')); });
    await waitFor(() => expect(result.current.notifications).toHaveLength(1)); expect(localStorage.getItem(key)).toBe(saved);
    work.data.tasks['purchase-parent'].isCompleted = true;
    act(() => { localStorage.setItem(key, JSON.stringify(work)); window.dispatchEvent(new Event('taskflow-work-updated')); });
    expect(result.current.notifications).toEqual([]);
  });
});
