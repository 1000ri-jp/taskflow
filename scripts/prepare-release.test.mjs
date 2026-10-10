import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { prepareRelease } from './prepare-release.mjs';

function fixture(t) {
 const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'taskflow-release-test-')));
 const root=path.join(directory,'checkout');
 const output=path.join(directory,'candidate');
 fs.mkdirSync(root);
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 function write(relative,content='fixture') {
  const destination=path.join(root,relative);
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  fs.writeFileSync(destination,content);
 }
 for(const file of ['package.json','package-lock.json','next.config.ts','tsconfig.json','postcss.config.mjs','apphosting.yaml','firebase.json','firestore.rules','firestore.indexes.json','storage.rules','vitest.config.ts','scripts/run-next-build.mjs','scripts/run-task-automation-job.mjs','scripts/generate-task-contract.mjs','scripts/mcp-events/task-fields.generated.mjs','scripts/mcp-events/oidc-provider.mjs','licenses/Unicode-LICENSE.txt','public/file.svg','src/app/api/mcp/route.js']) write(file);
 const video=Buffer.from('fictional approved recording');
 const digest=crypto.createHash('sha256').update(video).digest('hex');
 write('src/lib/help/videos.json',JSON.stringify([{id:'guide',file:'guide.mp4',sha256:digest}]));
 write('src/assets/help-videos/guide.mp4',video);
 write('src/assets/help-videos/unapproved.mp4','unapproved recording');
 write('.env.local','private fixture secret');
 execFileSync('git',['init','--quiet'],{cwd:root});
 execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','--quiet','--allow-empty','-m','fixture'],{cwd:root});
 return {root,output,video,digest,write};
}

test('candidate contains MCP build inputs, attribution and exactly approved recordings',t=>{
 const {root,output,video,digest}=fixture(t);
 const {source,manifest}=prepareRelease(root,output);
 assert.deepEqual(fs.readFileSync(path.join(source,'src/assets/help-videos/guide.mp4')),video);
 const paths=manifest.files.map(file=>file.path);
 for(const expected of ['scripts/generate-task-contract.mjs','scripts/mcp-events/task-fields.generated.mjs','scripts/mcp-events/oidc-provider.mjs','licenses/Unicode-LICENSE.txt']) assert.ok(paths.includes(expected),expected);
 assert.equal(manifest.files.find(file=>file.path==='src/assets/help-videos/guide.mp4').sha256,digest);
 assert.equal(fs.existsSync(path.join(source,'src/assets/help-videos/unapproved.mp4')),false);
 assert.equal(fs.existsSync(path.join(source,'.env.local')),false);
 assert.equal(fs.statSync(output).mode & 0o777,0o700);
 assert.ok(fs.existsSync(path.join(output,'manifest.json')));
});

test('a different nonempty recording is rejected before creating the candidate',t=>{
 const {root,output,write}=fixture(t);
 write('src/assets/help-videos/guide.mp4','wrong recording');
 assert.throws(()=>prepareRelease(root,output),/checksum differs/);
 assert.equal(fs.existsSync(output),false);
});

test('missing recordings and video symlinks are rejected',t=>{
 const {root,output,write}=fixture(t);
 const asset=path.join(root,'src/assets/help-videos/guide.mp4');
 fs.unlinkSync(asset);
 assert.throws(()=>prepareRelease(root,output),/missing or not a regular file/);
 write('recording.mp4','outside approved location');
 fs.symlinkSync(path.join(root,'recording.mp4'),asset);
 assert.throws(()=>prepareRelease(root,output),/missing or not a regular file/);
 assert.equal(fs.existsSync(output),false);
});

test('recording changes between preflight and copying do not produce a valid manifest',t=>{
 const {root,output}=fixture(t);
 const asset=path.join(root,'src/assets/help-videos/guide.mp4');
 const original=fs.readFileSync;
 let reads=0;
 fs.readFileSync=function(file,...args) {
  if(file===asset && ++reads===2) return Buffer.from('changed after preflight');
  return original.call(this,file,...args);
 };
 try {
  assert.throws(()=>prepareRelease(root,output),/changed while preparing/);
  assert.equal(fs.existsSync(path.join(output,'manifest.json')),false);
 } finally {fs.readFileSync=original;}
});

test('output inside the checkout, including through a directory symlink, is rejected',t=>{
 const {root,output}=fixture(t);
 assert.throws(()=>prepareRelease(root,path.join(root,'src/candidate')),/outside the repository/);
 const alias=path.join(path.dirname(output),'alias');
 fs.symlinkSync(root,alias);
 assert.throws(()=>prepareRelease(root,path.join(alias,'public/candidate')),/outside the repository/);
 assert.equal(fs.existsSync(path.join(root,'src/candidate')),false);
 assert.equal(fs.existsSync(path.join(root,'public/candidate')),false);
});

test('catalog changes between approval checks and copying cannot complete a manifest',t=>{
 const {root,output}=fixture(t);
 const catalog=path.join(root,'src/lib/help/videos.json');
 const original=fs.readFileSync;
 let reads=0;
 fs.readFileSync=function(file,...args) {
  if(file===catalog && ++reads===2) return Buffer.from('[]');
  return original.call(this,file,...args);
 };
 try {
  assert.throws(()=>prepareRelease(root,output),/catalog changed while preparing/);
  assert.equal(fs.existsSync(path.join(output,'manifest.json')),false);
 } finally {fs.readFileSync=original;}
});

test('an existing candidate is preserved without replacing its contents',t=>{
 const {root,output}=fixture(t);
 fs.mkdirSync(output);
 fs.writeFileSync(path.join(output,'keep.txt'),'keep this candidate');
 assert.throws(()=>prepareRelease(root,output),/Output already exists/);
 assert.equal(fs.readFileSync(path.join(output,'keep.txt'),'utf8'),'keep this candidate');
});
