import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { MEETING_ID,MEETING_PROPOSALS } from '@/lib/dashboard/meeting-proposals';
import { checklistItems } from '@/lib/dashboard/meeting-checklists';
import { MEETING_CHECKLIST_STORAGE_KEY,parseChecklistDraft,useMeetingChecklistStore } from './meetingChecklistStore';
const placement={projectId:'p',taskId:'t',title:'出展情報の準備'};
const entries=checklistItems(MEETING_PROPOSALS.find(p=>p.id==='EX-9')!);
describe('local checklist draft store',()=>{
  beforeEach(()=>{localStorage.removeItem(MEETING_CHECKLIST_STORAGE_KEY);useMeetingChecklistStore.setState({placements:{},items:{},persistenceFailed:false});});
  afterEach(()=>vi.restoreAllMocks());
  it('persists placement and individual checks without changing existing review keys',()=>{
    const write=vi.spyOn(Storage.prototype,'setItem');
    const store=useMeetingChecklistStore.getState();
    store.setPlacement('ex-submit',placement);
    store.setItem(entries[0].key,{checked:true,dueDate:'2026-09-13'});
    store.setItem(entries[1].key,{checked:false,dueDate:''});
    useMeetingChecklistStore.setState({placements:{},items:{}});
    store.hydrate();
    expect(useMeetingChecklistStore.getState().placements['ex-submit']).toEqual(placement);
    expect(useMeetingChecklistStore.getState().items[entries[0].key]).toEqual({checked:true,dueDate:'2026-09-13'});
    expect(useMeetingChecklistStore.getState().items[entries[1].key]?.checked).toBe(false);
    expect(write.mock.calls.every(([key])=>key===MEETING_CHECKLIST_STORAGE_KEY)).toBe(true);
  });
  it('resets only the chosen local entry and preserves checks when changing parents',()=>{
    const store=useMeetingChecklistStore.getState();
    store.setItem('EX-1',{checked:true});
    store.setItem('EX-3',{checked:true});
    store.setPlacement('ex-submit',placement);
    store.setPlacement('ex-submit',{...placement,taskId:'other'});
    expect(useMeetingChecklistStore.getState().items['EX-1'].checked).toBe(true);
    store.setItem('EX-3');store.setPlacement('ex-submit');
    expect(useMeetingChecklistStore.getState().items).toEqual({'EX-1':{checked:true}});
    expect(useMeetingChecklistStore.getState().placements).toEqual({});
  });
  it('rejects malformed, foreign-version, unknown and secret-bearing records',()=>{
    expect(parseChecklistDraft('broken')).toEqual({placements:{},items:{}});
    expect(parseChecklistDraft(JSON.stringify({meetingId:'old',placements:{'ex-submit':placement}}))).toEqual({placements:{},items:{}});
    const raw=JSON.stringify({meetingId:MEETING_ID,placements:{'ex-submit':{...placement,taskId:'../bad'}},items:{'TF-7':{checked:true},'EX-3':{checked:true,dueDate:'2026-02-31'}}});
    expect(parseChecklistDraft(raw)).toEqual({placements:{},items:{}});
    expect(useMeetingChecklistStore.getState().setPlacement('ex-submit',{...placement,title:'password: test-only'})).toBe(false);
    expect(useMeetingChecklistStore.getState().setItem('EX-9',{checked:true})).toBe(false);
  });
  it('keeps session changes and warns on storage failure',()=>{
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota');});
    useMeetingChecklistStore.getState().setItem('EX-1',{checked:true});
    expect(useMeetingChecklistStore.getState()).toMatchObject({persistenceFailed:true,items:{'EX-1':{checked:true}}});
  });
});
