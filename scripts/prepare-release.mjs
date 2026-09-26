// Copy an explicit web build input set; preserve every original working file.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root=process.cwd();
const arg=process.argv[2];
if (!arg) throw new Error('Usage: npm run release:prepare -- NEW_OUTPUT_DIRECTORY');
const output=path.resolve(arg);
if (fs.existsSync(output)) throw new Error('Output already exists; create a new candidate instead of replacing it.');
const videos=JSON.parse(fs.readFileSync(path.join(root,'src/lib/help/videos.json'),'utf8'));
for (const video of videos) {
 const asset=path.join(root,'src/assets/help-videos',video.file);
 if (!fs.existsSync(asset) || !fs.statSync(asset).isFile() || fs.statSync(asset).size===0) {
  throw new Error(`Private help video is missing: ${video.file}. Restore the approved recordings before preparing a release; see docs/HELP_VIDEO_ASSETS.md.`);
 }
}
fs.mkdirSync(output,{recursive:true});
const source=path.join(output,'source'); fs.mkdirSync(source);
const entries=['src','public','package.json','package-lock.json','next.config.ts','tsconfig.json','postcss.config.mjs','apphosting.yaml','firebase.json','firestore.rules','firestore.indexes.json','storage.rules','scripts/run-next-build.mjs','scripts/run-task-automation-job.mjs','vitest.config.ts'];
const files=[];
function copy(relative) {
 const original=path.join(root,relative); const info=fs.lstatSync(original);
 if(info.isSymbolicLink()) throw new Error(`Symlink requires review: ${relative}`);
 if(info.isDirectory()) {for(const entry of fs.readdirSync(original).sort()) copy(path.join(relative,entry));return;}
 const content=fs.readFileSync(original); const destination=path.join(source,relative);
 fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,content);
 files.push({path:relative,sha256:crypto.createHash('sha256').update(content).digest('hex')});
}
for(const entry of entries) copy(entry);
const manifest={createdAt:new Date().toISOString(),baseCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),files};
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
fs.writeFileSync(path.join(output,'git-status.txt'),execFileSync('git',['status','--short','--branch']));
console.log(`${files.length} web build inputs copied to ${source}`);
console.log('Candidate is prepared, not deployed. Check manifest hashes before rollout.');
