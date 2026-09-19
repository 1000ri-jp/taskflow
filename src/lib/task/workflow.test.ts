import { describe, it, expect } from 'vitest';
import { planWorkflow, reviewOutcome, taskVersion, type WorkflowAction } from './workflow';
import { taskSituation } from './history/presentation';
import type { Task } from '@/types';
const now = new Date('2026-09-13T00:00:00Z');
const base = (id: string, extra: Partial<Task> = {}): Task => ({ id, projectId: 'p', title: id, description: '', assigneeIds: ['worker'], dependsOnTaskIds: [], isCompleted: false, isArchived: false, isAbandoned: false, updatedAt: now, createdAt: now, ...extra } as Task);
const parent = base('work');
const request = (policy: 'any'|'all' = 'any') => base('review', { taskKind: 'review_request', parentTaskId: parent.id, assigneeIds: ['a','b'], review: { policy, round: 1, request: '初稿PDFの確認', attachments: [], requestedAt: now.toISOString(), responses: {}, nextTaskId: 'release' } });
const input = (t: Task, action: WorkflowAction, note = '') => ({ id: 'event-1', expectedVersion: taskVersion(t), action, note });
describe('work events', () => {
 it('approves once without overwriting workers or completing the parent, and hands off to the chosen next task', () => {
   const r = request(), release = base('release', { assigneeIds: ['publisher'] });
   const result = planWorkflow(r, [parent,r,release], 'a', input(r,'approve'), now);
   expect(result.patch.isCompleted).toBe(true); expect(result.recipients).toEqual(['worker','publisher']); expect(result.nextTaskId).toBe('release');
   expect(result.patch).not.toHaveProperty('assigneeIds'); expect(parent.isCompleted).toBe(false);
   expect(() => planWorkflow({ ...r, ...result.patch }, [parent], 'b', input(r,'approve'), now)).toThrow('返答済み');
 });
 it('requires every reviewer under all policy, ignoring responses from former reviewers', () => {
   let r = request('all'); r.review!.responses.outsider = { outcome:'approved', note:'', at:now.toISOString() };
   const first = planWorkflow(r, [parent,r], 'a', input(r,'approve'), now); r = { ...r, ...first.patch };
   expect(r.isCompleted).toBe(false); expect(first.recipients).toEqual([]);
   expect(() => planWorkflow(r, [parent,r], 'a', input(r,'approve'), now)).toThrow('記録済み');
   const last = planWorkflow(r, [parent,r], 'b', input(r,'approve'), now); expect(last.patch.isCompleted).toBe(true);
   expect(reviewOutcome({ review:r.review, assigneeIds:[] })).toBe('pending');
 });
 it('returns work to the worker on changes, resets approval on explicit resubmission, and records the next round', () => {
   let r = request('all'); r = { ...r, ...planWorkflow(r, [parent,r], 'a', input(r,'request_changes','連絡先を修正'), now).patch };
   expect(taskSituation(parent, [parent,r], { worker:'A',a:'B',b:'C' }, []).next).toContain('A：修正');
   expect(taskSituation(r, [parent,r], { worker:'A' }, []).situation).toBe('修正待ち');
   expect(() => planWorkflow(r, [parent,r], 'a', input(r,'resubmit','修正版'), now)).toThrow('作業担当');
   const result = planWorkflow(r, [parent,r], 'worker', input(r,'resubmit','修正版 https://example.test/v2.pdf'), now);
   expect(result.patch.review).toMatchObject({ round:2, responses:{}, request:expect.stringContaining('修正版') }); expect(result.recipients).toEqual(['a','b']);
 });
 it('blocks stale, unassigned, empty change requests and missing parent without writes', () => {
   const r = request();
   expect(() => planWorkflow(r,[parent,r],'a',{...input(r,'approve'),expectedVersion:'old'},now)).toThrow('情報が変わ');
   expect(() => planWorkflow(r,[parent,r],'other',input(r,'approve'),now)).toThrow('確認する人');
   expect(() => planWorkflow(r,[parent,r],'a',input(r,'request_changes'),now)).toThrow('修正して');
   expect(() => planWorkflow(r,[r],'a',input(r,'approve'),now)).toThrow('対象');
   expect(() => planWorkflow(r,[parent,r],'a',input(r,'complete'),now)).toThrow('確認依頼');
 });
 it('blocks completion with unknown prerequisites and open reviews, and keeps zero work explicitly incomplete', () => {
   expect(() => planWorkflow({...parent,dependsOnTaskIds:['missing']},[parent],'worker',input(parent,'complete'),now)).toThrow('前提');
   expect(() => planWorkflow(parent,[parent,request()],'worker',input(parent,'complete'),now)).toThrow('返答');
   expect(planWorkflow(parent,[parent],'worker',input(parent,'start'),now).patch).toEqual({workProgress:'started'});
 });
 it('makes primary assignee optional but restricts it to existing workers, keeping review kind intact', () => {
   const details = { completionCriteria:'確認済みPDF', primaryAssigneeId:'worker', taskKind:'decision' as const, milestoneId:null };
   expect(planWorkflow(parent,[parent],'worker',{...input(parent,'configure'),details},now).patch).toMatchObject(details);
   expect(() => planWorkflow(parent,[parent],'worker',{...input(parent,'configure'),details:{...details,primaryAssigneeId:'outsider'}},now)).toThrow('主担当');
   const r=request(); expect(planWorkflow(r,[parent,r],'a',{...input(r,'configure'),details:{...details,primaryAssigneeId:null}},now).patch).not.toHaveProperty('taskKind');
 });
});

it('preserves the previous round and validates resubmitted files without changing the worker', () => {
  const first = request();
  const r = { ...first, ...planWorkflow(first, [parent, first], 'a', input(first, 'request_changes', '会場を修正'), now).patch };
  const file = { id: 'file-v2', name: '修正版.pdf', url: 'https://example.test/v2.pdf', type: 'application/pdf', size: 100 };
  const result = planWorkflow(r, [parent, r], 'worker', { ...input(r, 'resubmit', '会場を修正しました'), attachments: [file] }, now);
  expect(result.patch.review).toMatchObject({ round: 2, attachments: [file], responses: {}, previousRound: { round: 1, request: '初稿PDFの確認', responses: { a: { outcome: 'changes_requested', note: '会場を修正' } } } });
  expect(result.patch).not.toHaveProperty('assigneeIds');
  expect(() => planWorkflow(r, [parent, r], 'worker', { ...input(r, 'resubmit', '修正版'), attachments: [{ ...file, url: 'javascript:alert(1)' }] }, now)).toThrow('添付情報');
  expect(() => planWorkflow(r, [parent, r], 'worker', { ...input(r, 'resubmit', '修正版'), attachments: Array(11).fill(file) }, now)).toThrow('10件');
  expect(() => planWorkflow(first, [parent, first], 'a', { ...input(first, 'approve'), attachments: [file] }, now)).toThrow('再提出');
});

it('allows only the latest approving actor to add a correction with a reason and rejects stale rounds', () => {
 const r0 = request();
 const r = {...r0, ...planWorkflow(r0,[parent,r0],'a',input(r0,'approve'),now).patch};
 expect(() => planWorkflow(r,[parent,r],'b',input(r,'correct_approval','見直し'),now)).toThrow('本人');
 expect(() => planWorkflow(r,[parent,r],'a',input(r,'correct_approval'),now)).toThrow('理由');
 const later = {...request(),id:'later',review:{...request().review!,requestedAt:'2026-09-14T00:00:00Z'}};
 expect(() => planWorkflow(r,[parent,r,later],'a',input(r,'correct_approval','見直し'),now)).toThrow('新しい確認');
 const corrected = planWorkflow(r,[parent,r],'a',input(r,'correct_approval','会場を再確認'),now);
 expect(corrected.patch).toMatchObject({isCompleted:false,review:{responses:{},correctedApproval:{by:'a',previousResponse:{outcome:'approved'}}}});
 expect(corrected.patch).not.toHaveProperty('assigneeIds');
 expect(() => planWorkflow(r,[{...parent,isCompleted:true},r],'a',input(r,'correct_approval','見直し'),now)).toThrow('確認対象');
});
