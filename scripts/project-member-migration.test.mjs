import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planProjectMembers } from './project-member-migration.mjs';
const p = {ownerId:'owner',memberIds:['owner','editor']};
const docs = [{id:'random-o',data:{userId:'owner',role:'admin',joinedAt:{_seconds:1}}},{id:'random-e',data:{userId:'editor',role:'editor',joinedAt:{_seconds:2}}}];
test('retains roles and metadata, migrates to UIDs, and is idempotent',()=>{
 const plan=planProjectMembers('p',p,docs);
 assert.equal(plan.writes.length,4);
 const next=plan.writes.filter(w=>w.operation==='set').map(({id,data})=>({id,data}));
 assert.deepEqual(next.map(x=>x.data),docs.map(x=>x.data));
 assert.equal(planProjectMembers('p',p,next).writes.length,0);
});
test('stops rather than deciding conflicting or missing privileges',()=>{
 assert.throws(()=>planProjectMembers('p',p,[...docs,{id:'other',data:{userId:'editor',role:'admin'}}]),/conflicting/);
 assert.throws(()=>planProjectMembers('p',p,docs.slice(0,1)),/missing/);
 assert.throws(()=>planProjectMembers('p',p,[...docs,{id:'orphan',data:{userId:'outsider',role:'admin'}}]),/absent/);
});
test('blocks destination collisions and detects concurrent role changes',()=>{
 assert.throws(()=>planProjectMembers('p',p,[{...docs[0],id:'editor'},docs[1]]),/collision/);
 const changed=docs.map(d=>d.data.userId==='editor'?{...d,data:{...d.data,role:'viewer'}}:d);
 assert.notEqual(planProjectMembers('p',p,docs).fingerprint,planProjectMembers('p',p,changed).fingerprint);
});
