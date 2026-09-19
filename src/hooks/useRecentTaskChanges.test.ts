import { expect, it } from 'vitest';
import { recordedTaskChange, recentChangedTasks } from './useRecentTaskChanges';
import { viewTask } from '@/test/taskViewFixtures';
const task = (id:string, updatedAt=new Date('2026-09-16'))=>({...viewTask({id,updatedAt}),projectName:'案件'});
const record = (id:string, at:string)=>recordedTaskChange('project-1',id,{targetType:'task',targetId:id,action:'update',createdAt:new Date(at),userName:'Kozue',changes:[{field:'dueDate',oldValue:'2026-09-15',newValue:'2026-09-18'}]})!;
it('orders only recorded changes, ignoring more recent task saves without any event and deduplicating by full task identity',()=>{
  const early=record('early','2026-09-14'),late=record('late','2026-09-15');
  const rows=recentChangedTasks([early,late,{...late,entry:{...late.entry,at:'2026-09-13'}}],[task('early',new Date('2026-09-18')),task('late'),task('unrecorded',new Date('2026-09-20'))]);
  expect(rows.map(row=>row.task.id)).toEqual(['late','early']);
  expect(recentChangedTasks([{...late,projectId:'another'}],[task('late')])).toEqual([]);
});
it('omits timestamp-only, equal-value, unknown edits, and unrelated records; preserves actual creates',()=>{
  const base={targetType:'task',targetId:'t',createdAt:new Date('2026-09-15'),action:'update'};
  expect(recordedTaskChange('p','e',base)).toBeNull();
  expect(recordedTaskChange('p','e',{...base,changes:[{field:'dueDate',oldValue:'same',newValue:'same'}]})).toBeNull();
  expect(recordedTaskChange('p','e',{...base,targetType:'project'})).toBeNull();
  expect(recordedTaskChange('p','e',{...base,action:'create'})?.entry.title).toBe('タスクを作成');
});
