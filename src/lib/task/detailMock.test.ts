import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actTaskDetailsMock, readTaskDetailsMock, submitTaskCommentMock } from './detailMock';
import { organizationMockKey, readOrganizationMock, mutateOrganizationMock } from './organizationMock';
import type { CommentSubmission } from './commentSubmission';
import { sortedChecklistItems } from '@/lib/utils/checklist';
beforeEach(() => {
  localStorage.removeItem(organizationMockKey('test-detail-project'));
  vi.stubGlobal('navigator', { locks: { request: async (_name: string, action: () => unknown) => action() } });
});
describe('shared isolated detail data', () => {
  it('persists an edited item name and refuses a stale rename in the isolated store', async () => {
    const project = 'test-detail-project';
    await actTaskDetailsMock(project, 'draft', { kind: 'addChecklist', title: '手順' });
    const id = readTaskDetailsMock(project, 'draft').checklists[0].id;
    await actTaskDetailsMock(project, 'draft', { kind: 'addItem', id, itemId: 'a', text: '箱' });
    await actTaskDetailsMock(project, 'draft', { kind: 'toggleItem', id, itemId: 'a', isChecked: true });
    await actTaskDetailsMock(project, 'draft', { kind: 'editItemText', id, itemId: 'a', text: '梱包箱', expectedText: '箱' });
    expect(readTaskDetailsMock(project, 'draft').checklists[0].items).toEqual([{ id: 'a', text: '梱包箱', isChecked: true, order: 0 }]);
    await expect(actTaskDetailsMock(project, 'draft', { kind: 'editItemText', id, itemId: 'a', text: '古い画面から変更', expectedText: '箱' })).rejects.toThrow('項目名が変更されています');
    expect(readTaskDetailsMock(project, 'draft').checklists[0].items[0].text).toBe('梱包箱');
  });
  it('edits and reorders mock checklist items without using Firebase', async () => {
    await actTaskDetailsMock('test-detail-project', 'draft', { kind: 'addChecklist', title: '手順' });
    const id = readTaskDetailsMock('test-detail-project', 'draft').checklists[0].id;
    await actTaskDetailsMock('test-detail-project', 'draft', { kind: 'addItem', id, text: 'A' });
    await actTaskDetailsMock('test-detail-project', 'draft', { kind: 'addItem', id, text: 'B' });
    const [a, b] = readTaskDetailsMock('test-detail-project', 'draft').checklists[0].items;
    await actTaskDetailsMock('test-detail-project', 'draft', { kind: 'moveItem', id, itemId: b.id, targetId: a.id });
    expect(readTaskDetailsMock('test-detail-project', 'draft').checklists[0].items.map(i => i.text)).toEqual(['B', 'A']);
  });
  it('reorders mock subtasks on the parent without changing child task fields', async () => {
    const project = 'test-detail-project';
    let originalChildren: unknown[] = [];
    await mutateOrganizationMock(project, state => {
      const base = state.data.tasks.draft;
      state.data.tasks['child-a'] = { ...base, title: 'A', parentTaskId: 'draft', order: 5, dueDate: new Date('2026-09-20') };
      state.data.tasks['child-b'] = { ...base, title: 'B', parentTaskId: 'draft', order: 2, dueDate: new Date('2026-09-15') };
      originalChildren = [structuredClone(state.data.tasks['child-a']), structuredClone(state.data.tasks['child-b'])];
    });
    await actTaskDetailsMock(project, 'draft', { kind: 'moveSubtasks', expectedIds: ['child-b', 'child-a'], orderedIds: ['child-a', 'child-b'] });
    expect(readTaskDetailsMock(project, 'draft').task?.subtaskOrderIds).toEqual(['child-a', 'child-b']);
    const after = readOrganizationMock(project).data.tasks;
    expect([after['child-a'], after['child-b']]).toEqual(originalChildren);
    await expect(actTaskDetailsMock(project, 'draft', { kind: 'moveSubtasks', expectedIds: ['child-b', 'child-a'], orderedIds: ['child-a', 'child-b'] })).rejects.toThrow('変更されています');
  });
  it('keeps display grouping separate from saved order and rejects cross-group mock moves', async () => {
    const project = 'test-detail-project';
    await actTaskDetailsMock(project, 'draft', { kind: 'addChecklist', title: '手順' });
    const id = readTaskDetailsMock(project, 'draft').checklists[0].id;
    await actTaskDetailsMock(project, 'draft', { kind: 'editChecklist', id, data: { items: [
      { id: 'a', text: 'キービジュアル', isChecked: false, order: 10 },
      { id: 'b', text: '動画', isChecked: false, order: 20 },
    ] } });
    await actTaskDetailsMock(project, 'draft', { kind: 'toggleItem', id, itemId: 'a' });
    const afterCheck = readTaskDetailsMock(project, 'draft').checklists[0].items;
    expect(afterCheck.map(item => [item.id, item.order])).toEqual([['a', 10], ['b', 20]]);
    expect(sortedChecklistItems(afterCheck).map(item => item.id)).toEqual(['b', 'a']);
    await expect(actTaskDetailsMock(project, 'draft', { kind: 'moveItem', id, itemId: 'a', targetId: 'b' })).rejects.toThrow('同じ状態');
    expect(readTaskDetailsMock(project, 'draft').checklists[0].items).toEqual(afterCheck);
  });
  it('persists date-only deadlines and preserves them through sibling additions, checks, moves and deletions', async () => {
    const project='test-detail-project';
    await actTaskDetailsMock(project,'draft',{kind:'addChecklist',title:'期限付き手順'});
    const id=readTaskDetailsMock(project,'draft').checklists[0].id;
    await actTaskDetailsMock(project,'draft',{kind:'addItem',id,itemId:'a',text:'シール'});
    await actTaskDetailsMock(project,'draft',{kind:'addItem',id,itemId:'b',text:'箱'});
    await actTaskDetailsMock(project,'draft',{kind:'setItemDueDate',id,itemId:'a',dueDate:'2028-02-29'});
    await actTaskDetailsMock(project,'draft',{kind:'setItemDueDate',id,itemId:'b',dueDate:'2028-03-01'});
    await actTaskDetailsMock(project,'draft',{kind:'addItem',id,itemId:'c',text:'テープ'});
    await actTaskDetailsMock(project,'draft',{kind:'toggleItem',id,itemId:'a',isChecked:true});
    await actTaskDetailsMock(project,'draft',{kind:'toggleItem',id,itemId:'a',isChecked:true});
    await actTaskDetailsMock(project,'draft',{kind:'moveItem',id,itemId:'c',targetId:'b'});
    await actTaskDetailsMock(project,'draft',{kind:'removeItem',id,itemId:'c'});
    let items=readTaskDetailsMock(project,'draft').checklists[0].items;
    expect(items.find(item=>item.id==='a')).toMatchObject({text:'シール',isChecked:true,dueDate:'2028-02-29'});
    expect(items.find(item=>item.id==='b')).toMatchObject({text:'箱',isChecked:false,dueDate:'2028-03-01'});
    await actTaskDetailsMock(project,'draft',{kind:'setItemDueDate',id,itemId:'a',dueDate:null});
    items=readTaskDetailsMock(project,'draft').checklists[0].items;
    expect(items.find(item=>item.id==='a')?.dueDate).toBeNull();expect(items.find(item=>item.id==='b')?.dueDate).toBe('2028-03-01');
  });
  it('rejects invalid dates, missing items and wrong task scope without changing the saved mock', async () => {
    const project='test-detail-project';
    await actTaskDetailsMock(project,'draft',{kind:'addChecklist',title:'手順'});
    const id=readTaskDetailsMock(project,'draft').checklists[0].id;
    await actTaskDetailsMock(project,'draft',{kind:'addItem',id,itemId:'a',text:'シール'});
    const before=localStorage.getItem(organizationMockKey(project));
    await expect(actTaskDetailsMock(project,'draft',{kind:'setItemDueDate',id,itemId:'a',dueDate:'2026-02-29'})).rejects.toThrow();
    await expect(actTaskDetailsMock(project,'draft',{kind:'setItemDueDate',id,itemId:'deleted',dueDate:null})).rejects.toThrow();
    await expect(actTaskDetailsMock(project,'purchase-parent',{kind:'setItemDueDate',id,itemId:'a',dueDate:'2026-09-14'})).rejects.toThrow();
    expect(localStorage.getItem(organizationMockKey(project))).toBe(before);
    expect(readTaskDetailsMock(project,'draft').checklists[0].items[0]).not.toHaveProperty('dueDate');
    await mutateOrganizationMock(project,state=>{state.data.tasks.draft.isArchived=true;});
    const archived=localStorage.getItem(organizationMockKey(project));
    await expect(actTaskDetailsMock(project,'draft',{kind:'setItemDueDate',id,itemId:'a',dueDate:'2026-09-14'})).rejects.toThrow();
    expect(localStorage.getItem(organizationMockKey(project))).toBe(archived);
  });
  it('reuses the comment submission id for retries and preserves separate review completion', async () => {
    const submission: CommentSubmission = { id: 'same-submission', projectId: 'test-detail-project', taskId: 'draft', authorId: 'e2e-mock-user', authorName: '本人', content: '確認お願いします', notifyIds: [], attachments: [], purpose: 'review_request', review: { content: '本文の確認', assigneeIds: ['demo-colleague'], dueDate: null } };
    expect((await submitTaskCommentMock(submission)).alreadySubmitted).toBe(false);
    expect((await submitTaskCommentMock(submission)).alreadySubmitted).toBe(true);
    const state = readOrganizationMock('test-detail-project');
    expect(Object.values(state.data.children)).toHaveLength(1); expect(state.activityLogs).toHaveLength(1);
    expect(state.data.tasks['review-same-submission']).toBeUndefined();
    expect(state.data.tasks.draft.reviewRequests).toMatchObject({'review-same-submission':{commentId:'same-submission',assigneeIds:['demo-colleague']}});
    expect(state.data.tasks.draft.isCompleted).toBe(false);
  });
});
