import { describe, expect, it } from 'vitest';
import { sortBoardTasks, type BoardSort } from './sort';
import type { Task } from '@/types';
const task = (id:string,day:number|null,isCompleted=false):Task => ({id,isCompleted,dueDate:day ? new Date(2026,8,day) : null,startDate:day ? new Date(2026,7,30-day) : null} as Task);
describe('board date sorting', () => {
  const tasks=[task('late',20),task('done',1,true),task('none',null),task('early',3),task('tie',3)];
  it.each<[BoardSort,string[]]>([
    ['manual',['late','none','early','tie','done']],
    ['due-asc',['early','tie','late','none','done']],
    ['due-desc',['late','early','tie','none','done']],
    ['start-asc',['late','early','tie','none','done']],
    ['start-desc',['early','tie','late','none','done']],
  ])('applies %s, keeps ties stable and completed tasks last', (mode,ids) => {
    const original=structuredClone(tasks);
    expect(sortBoardTasks(tasks,mode).map(t=>t.id)).toEqual(ids);
    expect(tasks).toEqual(original);
  });
  it('puts missing/invalid dates last even descending', () => {
    const invalid={...task('invalid',null),dueDate:new Date('invalid')};
    expect(sortBoardTasks([invalid,task('valid',2),task('missing',null)],'due-desc').map(t=>t.id)).toEqual(['valid','invalid','missing']);
    expect(sortBoardTasks([],'due-asc')).toEqual([]);
  });
});
