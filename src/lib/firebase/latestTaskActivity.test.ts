import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ listen: vi.fn() }));
vi.mock('./config', () => ({getFirebaseDb: () => 'db'}));
vi.mock('firebase/firestore', () => ({
  collection: (_db:unknown, ...path:string[]) => path.join('/'),
  query: (...parts:unknown[]) => parts,
  where: (...args:unknown[]) => ['where',...args],
  orderBy: (...args:unknown[]) => ['orderBy',...args], limit: (n:number) => ['limit',n], onSnapshot:mock.listen,
}));
import { subscribeToLatestTaskActivity } from './latestTaskActivity';
beforeEach(() => vi.clearAllMocks());
it('uses one task-filtered latest result and handles missing records', () => {
  const stop = vi.fn(); mock.listen.mockReturnValue(stop); const receive=vi.fn(), fail=vi.fn();
  const dispose=subscribeToLatestTaskActivity('p','t',receive,fail);
  expect(mock.listen.mock.calls[0][0]).toEqual(['projects/p/activityLogs',['where','targetType','==','task'],['where','targetId','==','t'],['orderBy','createdAt','desc'],['limit',1]]);
  mock.listen.mock.calls[0][1]({docs:[]}); expect(receive).toHaveBeenLastCalledWith(null);
  dispose(); expect(stop).toHaveBeenCalledOnce();
});
it('falls back only for a missing index, sorts exact-target records and cleans up both listeners', () => {
  const stop=vi.fn();mock.listen.mockReturnValue(stop);const receive=vi.fn(),fail=vi.fn();
  const dispose=subscribeToLatestTaskActivity('p','t',receive,fail);
  mock.listen.mock.calls[0][2]({code:'failed-precondition'});
  expect(mock.listen.mock.calls[1][0]).toEqual(['projects/p/activityLogs',['where','targetId','==','t']]);
  const row=(id:string,targetType:string,date:string)=>({id,data:()=>({targetType,targetId:'t',createdAt:date,action:'complete'})});
  mock.listen.mock.calls[1][1]({docs:[row('old','task','2026-09-01'),row('wrong-type','list','2026-10-01'),row('new','task','2026-09-16')]});
  expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({id:'activity:new',title:'完了'}));
  dispose();expect(stop).toHaveBeenCalledTimes(2);
  receive.mockClear();mock.listen.mock.calls[1][1]({docs:[]});expect(receive).not.toHaveBeenCalled();expect(fail).not.toHaveBeenCalled();
});
it('does not mask permission failures with another query', () => {
  mock.listen.mockReturnValue(vi.fn());const fail=vi.fn();subscribeToLatestTaskActivity('p','t',vi.fn(),fail);
  const error={code:'permission-denied'};mock.listen.mock.calls[0][2](error);
  expect(fail).toHaveBeenCalledWith(error);expect(mock.listen).toHaveBeenCalledOnce();
});
