// Copy an explicit web build input set; preserve every original working file.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function prepareRelease(rootDirectory, outputDirectory) {
 const root=fs.realpathSync(rootDirectory);
 if (!outputDirectory) throw new Error('Usage: npm run release:prepare -- NEW_OUTPUT_DIRECTORY');
 const output=path.resolve(outputDirectory);
 if (fs.existsSync(output)) throw new Error('Output already exists; create a new candidate instead of replacing it.');
 // Resolve existing ancestors too, so a directory symlink cannot put private
 // recordings back inside the public checkout or a copied input tree.
 let ancestor=path.dirname(output);
 while (!fs.existsSync(ancestor)) ancestor=path.dirname(ancestor);
 const resolvedOutput=path.resolve(fs.realpathSync(ancestor),path.relative(ancestor,output));
 if (resolvedOutput===root || resolvedOutput.startsWith(root+path.sep)) {
  throw new Error('Release output must be outside the repository, in private storage.');
 }
 const catalogContent=fs.readFileSync(path.join(root,'src/lib/help/videos.json'));
 const catalogDigest=crypto.createHash('sha256').update(catalogContent).digest('hex');
 const videos=JSON.parse(catalogContent.toString('utf8'));
 if (!Array.isArray(videos) || videos.length===0) throw new Error('Private help video catalog is empty or invalid.');
 const approvedVideos=new Map();
 for (const video of videos) {
  if (typeof video.file!=='string' || path.basename(video.file)!==video.file || !video.file.endsWith('.mp4') || !/^[a-f0-9]{64}$/.test(video.sha256 ?? '') || approvedVideos.has(video.file)) {
   throw new Error('Private help video catalog contains an invalid or duplicate recording.');
  }
  const asset=path.join(root,'src/assets/help-videos',video.file);
  if (!fs.existsSync(asset) || !fs.lstatSync(asset).isFile() || fs.lstatSync(asset).size===0) {
   throw new Error(`Private help video is missing or not a regular file: ${video.file}. Restore the approved recordings; see docs/HELP_VIDEO_ASSETS.md.`);
  }
  if (crypto.createHash('sha256').update(fs.readFileSync(asset)).digest('hex')!==video.sha256) {
   throw new Error(`Private help video checksum differs: ${video.file}. Restore the approved recording; see docs/HELP_VIDEO_ASSETS.md.`);
  }
  approvedVideos.set(video.file,video.sha256);
 }
 fs.mkdirSync(output,{recursive:true,mode:0o700});
 const source=path.join(output,'source'); fs.mkdirSync(source,{mode:0o700});
 const entries=['src','public','licenses','package.json','package-lock.json','next.config.ts','tsconfig.json','postcss.config.mjs','apphosting.yaml','firebase.json','firestore.rules','firestore.indexes.json','storage.rules','scripts/run-next-build.mjs','scripts/run-task-automation-job.mjs','scripts/generate-task-contract.mjs','scripts/mcp-events','vitest.config.ts'];
 const files=[];
 function copy(relative) {
  const original=path.join(root,relative); const info=fs.lstatSync(original);
  if(info.isSymbolicLink()) throw new Error(`Symlink requires review: ${relative}`);
  if(info.isDirectory()) {
   const children=relative===path.join('src','assets','help-videos') ? [...approvedVideos.keys()].sort() : fs.readdirSync(original).sort();
   for(const entry of children) copy(path.join(relative,entry));
   return;
  }
  if(!info.isFile()) throw new Error(`Not a regular source file: ${relative}`);
  const content=fs.readFileSync(original);
  const digest=crypto.createHash('sha256').update(content).digest('hex');
  if(relative===path.join('src','lib','help','videos.json') && digest!==catalogDigest) {
   throw new Error('Private help video catalog changed while preparing.');
  }
  if(path.dirname(relative)===path.join('src','assets','help-videos') && digest!==approvedVideos.get(path.basename(relative))) {
   throw new Error(`Private help video changed while preparing: ${relative}`);
  }
  const destination=path.join(source,relative);
  fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,content);
  files.push({path:relative,sha256:digest});
 }
 for(const entry of entries) copy(entry);
 const manifest={createdAt:new Date().toISOString(),baseCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),files};
 fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
 fs.writeFileSync(path.join(output,'git-status.txt'),execFileSync('git',['status','--short','--branch'],{cwd:root}),{mode:0o600});
 return {source,manifest};
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const {source,manifest}=prepareRelease(process.cwd(),process.argv[2]);
 console.log(`${manifest.files.length} web build inputs copied to ${source}`);
 console.log('Candidate is prepared, not deployed. Check manifest hashes before rollout.');
}
