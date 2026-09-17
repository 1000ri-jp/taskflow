import { beforeEach, expect, it, vi } from 'vitest';
const mock=vi.hoisted(()=>({list:vi.fn(),get:vi.fn(),set:vi.fn()}));
vi.mock('firebase/firestore',()=>({collection:()=>({id:'labels'}),doc:(_collection:unknown,id?:string)=>({id:id??'new-id'}),getDocs:mock.list,query:()=> 'labels-query',where:vi.fn(),serverTimestamp:()=>123,runTransaction:async(_db:unknown,run:(tx:unknown)=>unknown)=>run({get:mock.get,set:mock.set})}));
vi.mock('./config',()=>({getFirebaseDb:()=>({})}));
import { ensureMoaiLabel } from './moaiLabel';
beforeEach(()=>{vi.clearAllMocks();mock.list.mockResolvedValue({docs:[]});mock.get.mockResolvedValue({exists:()=>false});});
it('reuses an existing name and a concurrently created reserved label without writes',async()=>{
 mock.list.mockResolvedValueOnce({docs:[{id:'user-label'}]});expect(await ensureMoaiLabel('p')).toBe('user-label');
 expect(mock.get).not.toHaveBeenCalled();
 mock.get.mockResolvedValue({exists:()=>true,data:()=>({name:'モアイ'})});expect(await ensureMoaiLabel('p')).toBe('ai-moai');
 expect(mock.set).not.toHaveBeenCalled();
});
it('creates a normal project label and leaves a renamed reserved label intact',async()=>{
 expect(await ensureMoaiLabel('p')).toBe('ai-moai');expect(mock.set).toHaveBeenCalledWith({id:'ai-moai'},{name:'モアイ',color:'#64748b',projectId:'p',createdAt:123});
 mock.set.mockClear();mock.get.mockResolvedValue({exists:()=>true,data:()=>({name:'自分の名前'})});
 expect(await ensureMoaiLabel('p')).toBe('new-id');expect(mock.set).not.toHaveBeenCalledWith({id:'ai-moai'},expect.anything());
});
