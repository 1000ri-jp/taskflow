import { expect, it } from 'vitest';
import { availableWork, currentDecision, remainingWork, conflictingSchedules } from './now';
import { createMockSecretary, mockView, reviewMock } from './mock';
const now='2026-09-15T01:00:00Z';
const view=()=>mockView(reviewMock(createMockSecretary('me',now),'me',now),'me',now);
it('keeps remaining work as work, and a real date inversion as a date issue',()=>{
 const v=view(), t=v.snapshot.tasks.find(t=>t.taskId==='ready')!;
 t.checklists=[{id:'l',title:'準備',items:[{id:'a',text:'持ちもの',isChecked:false},{id:'b',text:'注文',isChecked:true}]}];
 expect(remainingWork(t,v.snapshot).checks.map(i=>i.text)).toEqual(['持ちもの']);
 expect(availableWork(v.state,v.snapshot).map(t=>t.key)).toContain(t.key);
 t.startDate='2026-09-20T00:00:00+09:00';t.dueDate='2026-09-16T00:00:00+09:00';
 expect(conflictingSchedules(v.snapshot)).toEqual([t]);
 expect(availableWork(v.state,v.snapshot).map(t=>t.key)).not.toContain(t.key);
});
it('requires current supported decisions and expires yesterday without fabricating another question',()=>{
 const v=view(), p=v.state.proposals.find(p=>p.key==='secretary-demo/draft')!;
 expect(currentDecision(p,v.snapshot)).toBe(false);
 p.policyVersion=2;p.decision={whyNow:'本日発注',question:'通常便か速達か',consequence:'選んだ便で発注'};
 expect(currentDecision(p,v.snapshot)).toBe(true);
 v.snapshot.checkedAt='2026-09-16T00:00:00+09:00';expect(currentDecision(p,v.snapshot)).toBe(false);
});
it('does not call missing checklists complete or treat formal requests as ordinary work',()=>{
 const v=view(),t=v.snapshot.tasks.find(t=>t.taskId==='ready')!;
 t.checklistStatus='unavailable';expect(availableWork(v.state,v.snapshot).map(t=>t.key)).not.toContain(t.key);
 t.checklistStatus='ready';t.context={...t.context!,taskKind:'review_request'};
 expect(availableWork(v.state,v.snapshot).map(t=>t.key)).not.toContain(t.key);
});
