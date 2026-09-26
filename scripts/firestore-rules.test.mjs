import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';
const address = process.env.FIRESTORE_EMULATOR_HOST;
if (!address || !/^127\.0\.0\.1:\d+$/.test(address)) throw new Error('A loopback Firestore emulator is required.');
const port = Number(address.split(':')[1]);
const env=await initializeTestEnvironment({projectId:'demo-taskflow-release',firestore:{host:'127.0.0.1',port,rules:fs.readFileSync(new URL('../firestore.rules', import.meta.url),'utf8')}});
let passed=0;
const check=async(name,fn)=>{await fn();passed++;console.log('PASS '+name)};
try {
 await env.withSecurityRulesDisabled(async c=>{
  const db=c.firestore();
  await setDoc(doc(db,'projects/p'),{ownerId:'owner',memberIds:['owner','admin','editor','viewer','legacy'],isArchived:false});
  for(const role of ['admin','editor','viewer']) await setDoc(doc(db,`projects/p/members/${role}`),{userId:role,role});
  await setDoc(doc(db,'projects/p/references/existing'),{title:'Synthetic reference',listId:'l',projectId:'p'});
  await setDoc(doc(db,'projects/p/tasks/task'),{title:'Synthetic task',isCompleted:false});
 });
 for(const role of ['owner','admin','editor','viewer','legacy','outsider','external','anonymous']) {
  const db=role==='anonymous'?env.unauthenticatedContext().firestore():env.authenticatedContext(role,{email:`${role}@${role==='external'?'example.com':'1000ri.jp'}`,email_verified:true}).firestore();
  const readAllowed=['owner','admin','editor','viewer','legacy'].includes(role);
  const writeAllowed=['owner','admin','editor'].includes(role);
  await check(`${role} reference read ${readAllowed?'allowed':'denied'}`,()=> (readAllowed?assertSucceeds:assertFails)(getDoc(doc(db,'projects/p/references/existing'))));
  const target=doc(db,`projects/p/references/${role}`);
  await check(`${role} reference create ${writeAllowed?'allowed':'denied'}`,()=> (writeAllowed?assertSucceeds:assertFails)(setDoc(target,{title:'Synthetic',projectId:'p',listId:'l'})));
  await check(`${role} reference update ${writeAllowed?'allowed':'denied'}`,()=> (writeAllowed?assertSucceeds:assertFails)(updateDoc(doc(db,'projects/p/references/existing'),{title:role})));
  await check(`${role} reference delete ${writeAllowed?'allowed':'denied'}`,()=> (writeAllowed?assertSucceeds:assertFails)(deleteDoc(target)));
 }
 console.log(`${passed} reference permission checks passed`);
 const userDb = uid => env.authenticatedContext(uid,{email:`${uid}@1000ri.jp`,email_verified:true}).firestore();
 for (const uid of ['viewer','editor','outsider']) {
  const db=userDb(uid);
  await check(`${uid} cannot self-promote`,()=>assertFails(setDoc(doc(db,`projects/p/members/${uid}`),{userId:uid,role:'admin'})));
  await check(`${uid} cannot take ownership`,()=>assertFails(updateDoc(doc(db,'projects/p'),{ownerId:uid})));
  await check(`${uid} cannot rewrite access array`,()=>assertFails(updateDoc(doc(db,'projects/p'),{memberIds:[uid]})));
 }
 for (const uid of ['owner','admin']) {
  const db=userDb(uid);
  const batch=writeBatch(db);
  batch.set(doc(db,`projects/p/members/invited-${uid}`),{userId:`invited-${uid}`,role:'editor'});
  batch.update(doc(db,'projects/p'),{memberIds:['owner','admin','editor','viewer','legacy',`invited-${uid}`]});
  await check(`${uid} can atomically invite`,()=>assertSucceeds(batch.commit()));
  await check(`${uid} cannot create random-ID members`,()=>assertFails(setDoc(doc(db,'projects/p/members/random'),{userId:'someone',role:'editor'})));
  await check(`${uid} cannot demote owner`,()=>assertFails(setDoc(doc(db,'projects/p/members/owner'),{userId:'owner',role:'viewer'})));
  await check(`${uid} cannot remove owner`,()=>assertFails(deleteDoc(doc(db,'projects/p/members/owner'))));
 }
 const creator=userDb('creator');
 await check('creator can create own project',()=>assertSucceeds(setDoc(doc(creator,'projects/new'),{ownerId:'creator',memberIds:['creator']})));
 await check('creator can add UID admin record',()=>assertSucceeds(setDoc(doc(creator,'projects/new/members/creator'),{userId:'creator',role:'admin'})));
 await check('creator cannot impersonate another owner',()=>assertFails(setDoc(doc(creator,'projects/forged'),{ownerId:'owner',memberIds:['creator']})));
 // Verify the actual migration CLI on isolated, realistic legacy documents.
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async c=>{
  const db=c.firestore();
  await setDoc(doc(db,'projects/legacy'),{ownerId:'owner',memberIds:['owner','editor']});
  await setDoc(doc(db,'projects/legacy/members/random-owner'),{userId:'owner',role:'admin',joinedAt:new Date('2026-01-01')});
  await setDoc(doc(db,'projects/legacy/members/random-editor'),{userId:'editor',role:'editor',joinedAt:new Date('2026-01-02')});
 });
 const temp=fs.mkdtempSync(path.join(tmpdir(),'taskflow-member-rehearsal-'));
 const cli=new URL('./migrate-project-members.mjs',import.meta.url);
 const run=(folder,extra=[])=>execFileSync(process.execPath,[cli.pathname,'--project','demo-taskflow-release','--out',path.join(temp,folder),...extra],{env:{...process.env,FIRESTORE_EMULATOR_HOST:address},encoding:'utf8'});
 run('before');
 const before=JSON.parse(fs.readFileSync(path.join(temp,'before/plan.json'),'utf8'));
 assert.equal(before.plans[0].writes.length,4);
 run('applied',['--apply','--reviewed-plan',path.join(temp,'before/plan.json')]);
 run('after');
 assert.equal(JSON.parse(fs.readFileSync(path.join(temp,'after/plan.json'),'utf8')).plans[0].writes.length,0);
 await check('migrated editor retains reference write access',()=>assertSucceeds(setDoc(doc(userDb('editor'),'projects/legacy/references/r'),{title:'test'})));
 await check('migrated editor cannot self-promote',()=>assertFails(updateDoc(doc(userDb('editor'),'projects/legacy/members/editor'),{role:'admin'})));
 const restore=new URL('./restore-project-members.mjs',import.meta.url);
 const restoreRun=(folder,extra=[])=>execFileSync(process.execPath,[restore.pathname,'--project','demo-taskflow-release','--backup',path.join(temp,'before/members-before.json'),'--out',path.join(temp,folder),...extra],{env:{...process.env,FIRESTORE_EMULATOR_HOST:address},encoding:'utf8'});
 restoreRun('restore-plan');
 restoreRun('restored',['--apply','--reviewed-plan',path.join(temp,'restore-plan/plan.json')]);
 run('after-restore');
 const restored=JSON.parse(fs.readFileSync(path.join(temp,'after-restore/plan.json'),'utf8'));
 assert.deepEqual(restored,before);
 console.log(`${passed} permission checks, migration and lossless restore rehearsal passed`);
} finally {await env.cleanup();}
