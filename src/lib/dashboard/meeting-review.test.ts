import { describe, expect, it } from 'vitest';
import type { DashboardTask } from './brief';
import { MEETING_ACTIONS, MEETING_PROPOSALS } from './meeting-proposals';
import { MEETING_BUNDLES } from './meeting-bundles';
import { resolveReviewMatch, proposalOwnerNames, resolvedOwners, membersForProposal } from './meeting-review';

const project = { id:'p', name:'展示会出展', memberIds:['nao','ko','ka'] };
const users = [{id:'nao',displayName:'naofumi *'}, {id:'ko',displayName:'*こずえ'}, {id:'ka',displayName:'Kaori'}];
const proposal = MEETING_PROPOSALS.find(p => p.id === 'EX-7')!;
const task: DashboardTask = {
  id:'t',projectId:'p',projectName:'展示会出展',listId:'l',title:'出展情報提出',description:'',order:0,
  assigneeIds:[],labelIds:[],tagIds:[],dependsOnTaskIds:[],priority:null,startDate:null,dueDate:null,durationDays:null,isDueDateFixed:false,
  isCompleted:false,completedAt:null,isAbandoned:false,isArchived:false,archivedAt:null,archivedBy:null,
  createdBy:'u',createdAt:new Date(2026,8,1),updatedAt:new Date(2026,8,1),
};
describe('meeting review classification and grouping', () => {
  it('covers each action once across 13 bundles without changing its parent', () => {
    expect(MEETING_BUNDLES).toHaveLength(13);
    const ids = MEETING_BUNDLES.flatMap(b => b.children);
    expect(ids).toHaveLength(35);
    expect([...ids].sort()).toEqual(MEETING_ACTIONS.map(p=>p.id).sort());
    for (const bundle of MEETING_BUNDLES) expect(bundle.children.every(id=>MEETING_ACTIONS.find(p=>p.id===id)?.parentId===bundle.parentId)).toBe(true);
  });
  it('separates registration status from uncertain owner or deadline', () => {
    expect(resolveReviewMatch(proposal,[task],[project],true)).toMatchObject({group:'existing',confirmed:false});
    expect(resolveReviewMatch(proposal,[],[project],true)).toMatchObject({group:'new',confirmed:false});
    expect(resolveReviewMatch(proposal,[],[project],false).group).toBe('unresolved');
    expect(resolveReviewMatch(proposal,[],[],true).group).toBe('unresolved');
  });
  it('allows human confirmation of new or existing but never reuses inaccessible targets', () => {
    const target = {mode:'existing' as const,projectId:'p',taskId:'t'};
    expect(resolveReviewMatch(proposal,[task],[project],true,{mode:'new'})).toMatchObject({group:'new',confirmed:true,candidates:[]});
    expect(resolveReviewMatch(proposal,[task],[project],true,target)).toMatchObject({group:'existing',confirmed:true,candidates:[task]});
    for (const [tasks,projects] of [[[],[project]],[[{...task,isArchived:true}],[project]],[[task],[]],[[task],[{...project,isArchived:true}]]] as const) {
      expect(resolveReviewMatch(proposal,[...tasks],[...projects],true,target).group).toBe('unresolved');
    }
    expect(resolveReviewMatch(proposal,[task],[project],false,target).confirmed).toBe(false);
    expect(resolveReviewMatch(proposal,[{...task,isCompleted:true}],[project],true,target).notes.join('')).toContain('再開は自動で行いません');
  });
  it('expands each to exactly the three meeting attendees and resolves aliases', () => {
    expect(proposalOwnerNames('各自')).toEqual(['Naofumi Higashikawauchi','こずえ','脊古香織']);
    expect(resolvedOwners('各自',users).map(o=>o.userId)).toEqual(['nao','ko','ka']);
    expect(proposalOwnerNames('実装担当')).toEqual(['実装担当']);
    expect(proposalOwnerNames('こずえ・こずえ')).toEqual(['こずえ']);
  });
  it('does not guess duplicate identities or include nonmember users', () => {
    const directory = [...users,{id:'other',displayName:'Kozue'}];
    expect(resolvedOwners('こずえ',directory)[0]).toMatchObject({userId:null,status:'ambiguous'});
    expect(resolvedOwners('こずえ',directory,['ko'])[0].userId).toBe('ko');
    expect(resolvedOwners('不明',directory)[0].status).toBe('missing');
    expect(membersForProposal(proposal,[project],directory)).toEqual(users);
    expect(membersForProposal(proposal,[{...project,isArchived:true}],directory)).toEqual([]);
    expect(membersForProposal(proposal,[project],directory,{mode:'existing',projectId:'foreign',taskId:'x'})).toEqual([]);
  });
});
