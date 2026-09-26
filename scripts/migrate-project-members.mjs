// Dry-run by default. Apply only a previously reviewed, unchanged plan.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Firestore } from 'firebase-admin/firestore';
import { OAuth2Client } from 'google-auth-library';
import { planProjectMembers } from './project-member-migration.mjs';
import { encodeMemberValue } from './member-backup.mjs';
const args = process.argv.slice(2);
const value = key => args[args.indexOf(key) + 1];
if (!args.includes('--project') || !args.includes('--out')) throw new Error('Required: --project PROJECT --out NEW_DIRECTORY [--gcloud] [--apply --reviewed-plan FILE]');
const projectId = value('--project');
if (!/^[a-z][a-z0-9-]{4,62}$/.test(projectId)) throw new Error('Invalid explicit project ID');
if (process.env.FIRESTORE_EMULATOR_HOST && (!projectId.startsWith('demo-') || !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST))) {
  throw new Error('Emulator migrations require a demo project and loopback host.');
}
const output = path.resolve(value('--out'));
const apply = args.includes('--apply');
if (apply && !args.includes('--reviewed-plan')) throw new Error('--apply requires --reviewed-plan');
if (fs.existsSync(output)) throw new Error('Output directory must be new; preserve previous evidence.');
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const authClient = new OAuth2Client();
if (args.includes('--gcloud') && !process.env.FIRESTORE_EMULATOR_HOST) {
  authClient.setCredentials({ access_token: execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim() });
}
const db = new Firestore({ projectId, ...(args.includes('--gcloud') && !process.env.FIRESTORE_EMULATOR_HOST ? { authClient } : {}) });
const save = (name, data) => fs.writeFileSync(path.join(output, name), JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
const projects = await db.collection('projects').get();
const plans = [], conflicts = [], backup = [];
for (const project of projects.docs) {
  const members = await project.ref.collection('members').get();
  for (const member of members.docs) {
    if ((await member.ref.listCollections()).length) conflicts.push(`${project.id}: member subcollections require separate migration`);
  }
  const documents = members.docs.map(member => ({ id: member.id, data: member.data() }));
  backup.push({ projectId: project.id, project: { ownerId: project.data().ownerId, memberIds: project.data().memberIds }, documents: documents.map(doc => ({ id: doc.id, data: encodeMemberValue(doc.data) })) });
  try { plans.push(planProjectMembers(project.id, project.data(), documents)); }
  catch (error) { conflicts.push(error.message); }
}
save('members-before.json', { schema: 'member-backup-v1', projectId, projects: backup });
const plan = { projectId, plans, conflicts };
save('plan.json', plan);
console.log(JSON.stringify({ projectId, projects: projects.size, changes: plans.reduce((n,p) => n+p.writes.length,0), conflicts: conflicts.length, apply, output }));
if (conflicts.length) throw new Error('Resolve conflicts in plan.json before applying; no writes were made.');
if (apply) {
  const reviewed = JSON.parse(fs.readFileSync(value('--reviewed-plan'), 'utf8'));
  if (JSON.stringify(reviewed) !== JSON.stringify(plan)) throw new Error('Plan changed since review; no writes were made.');
  const completed = [];
  for (const expected of plans.filter(item => item.writes.length)) {
    const ref = db.collection('projects').doc(expected.projectId);
    await db.runTransaction(async tx => {
      const project = await tx.get(ref);
      const members = await tx.get(ref.collection('members'));
      const current = planProjectMembers(ref.id, project.data(), members.docs.map(doc => ({ id: doc.id, data: doc.data() })));
      if (current.fingerprint !== expected.fingerprint) throw new Error(`${ref.id}: concurrent change; stopped`);
      for (const write of current.writes) {
        const member = ref.collection('members').doc(write.id);
        if (write.operation === 'set') tx.set(member, write.data); else tx.delete(member);
      }
    });
    completed.push(ref.id); save('completed.json', completed);
  }
  console.log(`Applied ${completed.length} projects. Re-run dry-run to verify zero remaining changes.`);
}
await db.terminate();
