import { describe, expect, it } from 'vitest';
import { occurrenceDate, nextRecurrence, repeatTask, repeatChecklist, validRecurrence, civilDate, type TaskRecurrence } from './recurrence';
import type { Task } from '@/types';
const rule:TaskRecurrence={seriesId:'series',occurrence:0,unit:'month',interval:1,anchorDate:'2026-01-31',endDate:null,listId:'todo'};
describe('recurring task dates',()=>{
 it('returns to the original day after a short month',()=>{expect(occurrenceDate(rule,1)).toBe('2026-02-28');expect(occurrenceDate(rule,2)).toBe('2026-03-31');});
 it('retains leap-day intent across years',()=>{const r={...rule,unit:'year' as const,anchorDate:'2024-02-29'};expect(occurrenceDate(r,1)).toBe('2025-02-28');expect(occurrenceDate(r,4)).toBe('2028-02-29');});
 it('handles daily and weekly intervals over year boundaries',()=>{expect(occurrenceDate({...rule,unit:'day',interval:2,anchorDate:'2026-12-31'},1)).toBe('2027-01-02');expect(occurrenceDate({...rule,unit:'week',interval:2,anchorDate:'2026-12-31'},1)).toBe('2027-01-14');});
 it('uses Japan calendar days for date and Firestore inputs',()=>{const d=new Date('2026-09-12T15:00:00Z');expect(civilDate(d)).toBe('2026-09-13');expect(civilDate({toDate:()=>d})).toBe('2026-09-13');});
 it('stops after the inclusive end date and rejects malformed rules',()=>{expect(nextRecurrence({...rule,endDate:'2026-02-28'})?.dueDate).toBe('2026-02-28');expect(nextRecurrence({...rule,endDate:'2026-02-27'})).toBeNull();for(const patch of [{interval:0},{interval:1.5},{unit:'bad'},{anchorDate:'2026-02-30'},{seriesId:'../other'}])expect(validRecurrence({...rule,...patch})).toBe(false);});
 it('copies task work without carrying completion, dependency, approval or automation state',()=>{
  const source={id:'old',projectId:'p',listId:'done',title:'給与計算',description:'手順',assigneeIds:['worker'],labelIds:[],tagIds:[],order:2,createdBy:'worker',dueDate:new Date('2026-01-31T00:00:00+09:00'),startDate:new Date('2026-01-29T00:00:00+09:00'),isCompleted:true,completedAt:new Date(),dependsOnTaskIds:['last-month'],completionPolicy:{},automation:{},recurrence:rule} as unknown as Task;
  const next=repeatTask(source,new Date())!;
  expect(next.task).toMatchObject({title:'給与計算',description:'手順',assigneeIds:['worker'],listId:'todo',isCompleted:false,workProgress:'not_started',dependsOnTaskIds:[],recurrence:{occurrence:1}});
  expect(civilDate(next.task.startDate)).toBe('2026-02-26');expect(next.task.automation).toBeUndefined();expect(next.task.completionPolicy).toBeUndefined();expect(source.isCompleted).toBe(true);
  expect(repeatChecklist({title:'確認',items:[{id:'item',text:'確認する',isChecked:true,order:0,dueDate:'2026-01-30'}]},next.id,28,new Date()).items[0]).toMatchObject({isChecked:false,dueDate:'2026-02-27'});
 });
});
