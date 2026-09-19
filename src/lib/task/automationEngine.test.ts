import { describe, expect, it } from 'vitest';
import type { Task } from '@/types';
import { getEffectiveDates } from '@/lib/utils/task';
import { completesCriterion, expectedDateSchedule, containsIdentity, recognizeEvidence, reminderDue, requiredChildrenState, selectEvidence } from './automationEngine';
import type { AutomationGrant, EvidenceStage, TaskEvidence, TaskEvidenceRule } from './automationTypes';
const rule: TaskEvidenceRule = { projectId: 'p', taskId: 'a', enabled: true, subject: '秋の展示会', period: '2026', person: '梢', sender: 'shop@example.test', sources: ['gmail', 'comment'], criterion: 'purchase', allowExpectedDate: true };
const evidence = (text: string, other: Partial<TaskEvidence> = {}): TaskEvidence => ({ id: 'm1', version: 'v1', source: 'gmail', at: '2026-09-12T01:00:00.000Z', text: `秋の展示会 2026 梢 ${text}`, sender: 'Shop <shop@example.test>', authorId: 'self', url: 'https://mail.google.com/mail/#all/1', ...other });
const grant = (other: Partial<AutomationGrant> = {}): AutomationGrant => ({ rule, uid: 'self', grantedAt: '2026-09-01T00:00:00.000Z', notBefore: '2026-09-01T00:00:00.000Z', connectionEpoch: '1', expectedTaskVersion: '1',
  check: 'unconfirmed', checkedAt: null, reason: '', latestEvidenceAt: null, stage: null, ownedCompletion: false, records: [], ...other });
describe('explicit task evidence', () => {
  it.each([
    ['申込受付', 'application'], ['登録完了', 'registered'], ['注文完了', 'ordered'], ['購入完了', 'paid'], ['支払完了', 'paid'],
    ['発送済み', 'shipped'], ['到着予定：2026年9月15日', 'expected'], ['受け取りました', 'received'], ['キャンセル完了', 'cancelled'], ['返金完了', 'refunded'],
  ])('distinguishes %s from other conditions', (text, stage) => expect(recognizeEvidence(rule, 'self', evidence(text))?.stage).toBe(stage));
  it.each(['申込受付', '注文完了', '発送済み', '到着予定：2026年9月15日'])('does not complete a purchase from %s', text => {
    expect(completesCriterion('purchase', recognizeEvidence(rule, 'self', evidence(text))!.stage)).toBe(false);
  });
  it.each(['paid', 'registered', 'shipped', 'expected'])('does not complete receipt from %s', stage => expect(completesCriterion('receipt', stage as EvidenceStage)).toBe(false));
  it('rejects wrong person, year, event and sender', () => {
    for (const text of ['秋の展示会 2025 梢 購入完了', '秋の展示会 2026 花子 購入完了', '春の展示会 2026 梢 購入完了', '秋の展示会 20260 梢 購入完了']) expect(recognizeEvidence(rule, 'self', evidence('', { text }))).toBeNull();
    expect(recognizeEvidence(rule, 'self', evidence('購入完了', { sender: 'shop@elsewhere.test' }))).toBeNull();
  });
  it('matches the named beneficiary even for proxy purchase, never a quantity', () => {
    expect(recognizeEvidence(rule, 'buyer', evidence('代理購入 購入完了'))?.stage).toBe('paid');
    expect(recognizeEvidence(rule, 'buyer', evidence('', { text: '秋の展示会 2026 2名分 購入完了' }))).toBeNull();
  });
  it.each(['購入完了していません', '購入してください', '購入完了する予定です', '支払完了の場合', '購入完了。まだ梢は未購入', '返金待ち', 'キャンセル申請', '購入済みですか？', '明日、購入完了予定です', 'さんへ。同僚の分は購入完了。梢さんの分は未確認です。'])('rejects incomplete/negative/conditional %s', text => expect(recognizeEvidence(rule, 'self', evidence(text))).toBeNull());
  it('requires own authorized comment author', () => {
    expect(recognizeEvidence(rule, 'self', evidence('購入しました', { source: 'comment', authorId: 'peer' }))).toBeNull();
    expect(recognizeEvidence(rule, 'self', evidence('購入しました', { source: 'comment' }))?.stage).toBe('paid');
  });
  it('does not link a named greeting to a different beneficiary in the same clause', () => {
    expect(recognizeEvidence(rule, 'self', evidence('へ、同僚の分は購入完了'))).toBeNull();
    expect(recognizeEvidence(rule, 'self', evidence('キャンセル完了連絡待ち'))).toBeNull();
    expect(recognizeEvidence(rule, 'self', evidence('payment not completed'))).toBeNull();
  });
  it('skips a lower-stage resend to reach a later refund', () => {
    expect(selectEvidence(grant({ stage: 'paid', latestEvidenceAt: '2026-09-11T00:00:00.000Z' }), [evidence('注文完了'), evidence('返金完了', { id: 'refund', at: '2026-09-13T00:00:00.000Z' })], '2026-09-14T00:00:00.000Z')?.stage).toBe('refunded');
  });
  it('extracts the delivery date rather than event/check date; invalid/ambiguous dates fail', () => {
    expect(recognizeEvidence(rule, 'self', evidence('到着予定：2026年9月15日'))?.expectedDate).toBe('2026-09-15');
    for (const text of ['到着予定：9月15日', '到着予定：2026年2月30日', '到着予定：2026年9月15日 到着予定：2026年9月16日']) expect(recognizeEvidence(rule, 'self', evidence(text))).toBeNull();
  });
  it('requires complete Latin identifier tokens', () => {
    expect(containsIdentity('order AB123 confirmed', 'AB12')).toBe(false);
    expect(containsIdentity('order AB12 confirmed', 'AB12')).toBe(true);
  });
  it('processes purchase then shipping in chronological order, retaining the purchase fact', () => {
    const earlier = evidence('購入完了'); const later = evidence('発送済み', { id: 'm2', at: '2026-09-13T01:00:00.000Z' });
    expect(selectEvidence(grant(), [later, earlier], '2026-09-14T00:00:00.000Z')?.stage).toBe('paid');
    expect(selectEvidence(grant({ stage: 'paid', latestEvidenceAt: earlier.at }), [later], '2026-09-14T00:00:00.000Z')?.stage).toBe('shipped');
  });
  it('does not replay processed versions, old or future facts, or regress after refund', () => {
    const e = evidence('購入完了');
    const record = { source: 'gmail', sourceId: e.id, sourceVersion: e.version } as AutomationGrant['records'][number];
    expect(selectEvidence(grant({ records: [record] }), [e], '2026-09-14T00:00:00.000Z')).toBeNull();
    expect(selectEvidence(grant(), [e], '2026-09-11T00:00:00.000Z')).toBeNull();
    expect(selectEvidence(grant({ stage: 'refunded' }), [e], '2026-09-14T00:00:00.000Z')).toBeNull();
    expect(selectEvidence(grant({ latestEvidenceAt: '2026-09-13T00:00:00.000Z' }), [e], '2026-09-14T00:00:00.000Z')).toBeNull();
  });
  it('holds contradictory facts at the same instant', () => expect(selectEvidence(grant(), [evidence('購入完了'), evidence('返金完了', { id: 'm2' })], '2026-09-14T00:00:00.000Z')).toBeNull());
});
describe('all required people and reminder', () => {
  const policy = { kind: 'all_required_children' as const, condition: '梢と同僚が各自の購入を完了した', required: [{ taskId: 'a', assigneeId: 'self' }, { taskId: 'b', assigneeId: 'peer' }], grantedBy: 'owner', grantedAt: '2026-09-12' };
  const children = [{ id: 'a', assigneeIds: ['self'], isCompleted: true }, { id: 'b', assigneeIds: ['peer'], isCompleted: false }] as Task[];
  it('does not propagate to an arbitrary parent; requires each named task and exact assignee', () => {
    expect(requiredChildrenState({}, children)).toBeNull();
    expect(requiredChildrenState({ completionPolicy: policy }, children)?.complete).toBe(false);
    expect(requiredChildrenState({ completionPolicy: policy }, children.map(t => ({ ...t, isCompleted: true })))?.complete).toBe(true);
    expect(requiredChildrenState({ completionPolicy: policy }, [{ ...children[0], assigneeIds: ['peer'] }, { ...children[1], isCompleted: true }])?.complete).toBe(false);
    expect(requiredChildrenState({ completionPolicy: policy }, [children[0]])?.complete).toBe(false);
  });
  it('starts on the previous JST date and honors snooze and missing due date', () => {
    expect(reminderDue('2026-09-14T03:00:00.000Z', '2026-09-12T14:59:00.000Z', null)).toBe(false);
    expect(reminderDue('2026-09-14T03:00:00.000Z', '2026-09-12T15:00:00.000Z', null)).toBe(true);
    expect(reminderDue('2026-09-14T03:00:00.000Z', '2026-09-12T15:00:00.000Z', '2026-09-13T01:00:00.000Z')).toBe(false);
    expect(reminderDue(null, '2026-09-12T15:00:00.000Z', null)).toBe(false);
  });
});

describe('arrival date consistency with task scheduling',()=>{
  const scheduleTask={startDate:'2026-09-10T15:00:00.000Z',dueDate:'2026-09-20T03:00:00.000Z',durationDays:10,isDueDateFixed:false};
  it('fixes the authorized ETA and reconciles inclusive duration from the existing start date',()=>{
    expect(expectedDateSchedule(scheduleTask,'2026-09-15')).toEqual({ok:true,dueDate:'2026-09-15T03:00:00.000Z',isDueDateFixed:true,durationDays:5});
  });
  it('does not let duration or a dependency shift the authorized ETA in effective dates',()=>{
    const result=expectedDateSchedule(scheduleTask,'2026-09-15');if(!result.ok)throw new Error(result.reason);
    const task={id:'a',...scheduleTask,startDate:new Date(scheduleTask.startDate),dueDate:new Date(result.dueDate),durationDays:result.durationDays,isDueDateFixed:result.isDueDateFixed,dependsOnTaskIds:['dependency'],isCompleted:false} as Task;
    const dependency={id:'dependency',dueDate:new Date('2026-09-18T03:00:00Z'),isCompleted:false} as Task;
    const effective=getEffectiveDates(task,[task,dependency]);
    expect(effective.predictedEnd).toEqual(new Date('2026-09-15T03:00:00Z'));expect(effective.isDeadlineOverdue).toBe(true);
  });
  it('does not invent duration without a known start, while fixing the date',()=>{
    expect(expectedDateSchedule({...scheduleTask,startDate:null,durationDays:8},'2026-09-15')).toMatchObject({ok:true,isDueDateFixed:true,durationDays:8});
    expect(expectedDateSchedule({...scheduleTask,startDate:null,durationDays:null},'2026-09-15')).toMatchObject({ok:true,durationDays:null});
  });
  it('holds an ETA before the known JST start date as an explicit conflict',()=>{
    expect(expectedDateSchedule(scheduleTask,'2026-09-10')).toMatchObject({ok:false,reason:expect.stringContaining('開始日より前')});
  });
  it('uses day semantics even when the stored start has a late time of day',()=>{
    expect(expectedDateSchedule({...scheduleTask,startDate:'2026-09-15T14:00:00.000Z'},'2026-09-15')).toMatchObject({ok:true,durationDays:1});
  });
  it.each(['2026-02-30','unknown'])('rejects an invalid expected date %s',date=>{
    expect(expectedDateSchedule(scheduleTask,date).ok).toBe(false);
  });
});
