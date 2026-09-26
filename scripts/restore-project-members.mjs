// Restore only unchanged migration output; never erase later membership edits.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Firestore } from 'firebase-admin/firestore';
import { OAuth2Client } from 'google-auth-library';
import { decodeMemberValue } from './member-backup.mjs';
import { planProjectMembers } from './project-member-migration.mjs';
const args=process.argv.slice(2), value=key=>args[args.indexOf(key)+1];
if (!['--project','--backup','--out'].every(key=>args.includes(key))) throw new Error('Required: --project PROJECT --backup FILE --out NEW_DIRECTORY [--gcloud] [--apply --reviewed-plan FILE]');
const projectId=value('--project'), output=path.resolve(value('--out')), apply=args.includes('--apply');
if (!/^[a-z][a-z0-9-]{4,62}$/.test(projectId)) throw new Error('Invalid explicit project ID');
if (process.env.FIRESTORE_EMULATOR_HOST && (!projectId.startsWith('demo-') || !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST))) throw new Error('Emulator restore requires demo project and loopback host.');
if (apply && !args.includes('--reviewed-plan')) throw new Error('Apply requires a reviewed plan');
const backup=JSON.parse(fs.readFileSync(value('--backup'),'utf8'));
if (backup.schema!=='member-backup-v1'||backup.projectId!==projectId) throw new Error('Backup project/schema mismatch');
if (fs.existsSync(output)) throw new Error('Use a new output directory');
fs.mkdirSync(output,{recursive:true,mode:0o700});
const save=(name,data)=>fs.writeFileSync(path.join(output,name),JSON.stringify(data,null,2)+'\n',{mode:0o600});
const authClient=new OAuth2Client();
if(args.includes('--gcloud')&&!process.env.FIRESTORE_EMULATOR_HOST) authClient.setCredentials({access_token:execFileSync('gcloud',['auth','print-access-token'],{encoding:'utf8'}).trim()});
const db=new Firestore({projectId,...(args.includes('--gcloud')&&!process.env.FIRESTORE_EMULATOR_HOST?{authClient}:{})});
function planRestore(original,project,documents) {
 const previous=original.documents.map(doc=>({id:doc.id,data:decodeMemberValue(doc.data)}));
 const before=planProjectMembers(original.projectId,original.project,previous);
 const current=planProjectMembers(original.projectId,project,documents);
 if(current.fingerprint===before.fingerprint) return {...current,writes:[]};
 const canonical=[...new Map(previous.map(doc=>[doc.data.userId,{id:doc.data.userId,data:doc.data}])).values()];
 const migrated=planProjectMembers(original.projectId,original.project,canonical);
 if(current.fingerprint!==migrated.fingerprint) throw new Error(`${original.projectId}: membership changed after migration; manual review required`);
 const writes=previous.map(doc=>({operation:'set',...doc}));
 for(const doc of documents) if(!previous.some(item=>item.id===doc.id)) writes.push({operation:'delete',id:doc.id});
 if(writes.length>450) throw new Error('Restore exceeds transaction limit');
 return {...current,writes};
}
const plans=[];
for(const original of backup.projects) {
 const ref=db.collection('projects').doc(original.projectId), project=await ref.get(), members=await ref.collection('members').get();
 for(const member of members.docs) if((await member.ref.listCollections()).length) throw new Error('Member subcollections need separate review');
 plans.push(planRestore(original,project.data(),members.docs.map(doc=>({id:doc.id,data:doc.data()}))));
}
const plan={projectId,plans};save('plan.json',plan);
console.log(JSON.stringify({projectId,projects:plans.length,writes:plans.reduce((n,p)=>n+p.writes.length,0),apply,output}));
if(apply) {
 if(JSON.stringify(JSON.parse(fs.readFileSync(value('--reviewed-plan'),'utf8')))!==JSON.stringify(plan)) throw new Error('Restore plan changed; no writes made');
 const completed=[];
 for(const expected of plans.filter(p=>p.writes.length)) {
  const ref=db.collection('projects').doc(expected.projectId), original=backup.projects.find(p=>p.projectId===expected.projectId);
  await db.runTransaction(async tx=>{
   const project=await tx.get(ref), members=await tx.get(ref.collection('members'));
   const current=planRestore(original,project.data(),members.docs.map(doc=>({id:doc.id,data:doc.data()})));
   if(current.fingerprint!==expected.fingerprint) throw new Error('Concurrent membership change; stopped');
   for(const write of current.writes) if(write.operation==='set') tx.set(ref.collection('members').doc(write.id),write.data);else tx.delete(ref.collection('members').doc(write.id));
  });
  completed.push(ref.id);save('completed.json',completed);
 }
}
await db.terminate();
