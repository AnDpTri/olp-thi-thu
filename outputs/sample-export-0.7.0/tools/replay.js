'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),cache=new Map();
const rows=name=>{if(!cache.has(name)){const file=path.join(root,'timeline',name+'.jsonl');cache.set(name,fs.existsSync(file)?fs.readFileSync(file,'utf8').split('\n').filter(Boolean).map(JSON.parse):[]);}return cache.get(name);};
const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
const blob=h=>{if(!/^[a-f0-9]{64}$/.test(h))throw Error('Invalid snapshot hash');return h===hash(Buffer.alloc(0))?'':fs.readFileSync(path.join(root,'timeline/blobs',h),'utf8');};
function apply(text,changes){for(const c of [...changes].sort((a,b)=>b.offset-a.offset)){if(text.slice(c.offset,c.offset+c.removed)!==c.removedText)throw Error('removedText mismatch');text=text.slice(0,c.offset)+c.text+text.slice(c.offset+c.removed);}return text;}
function replay(file,t=Infinity){const base=rows('snapshots').find(s=>s.file===file);if(!base||t<base.t)throw Error('No baseline at requested time: '+file);let text=blob(base.hash);for(const e of rows('edits').filter(e=>e.file===file&&e.type==='edit'&&e.seq>base.seq&&e.t<=t).sort((a,b)=>a.seq-b.seq))text=apply(text,e.changes);return text;}
function verify(){
 const failures=[],snapshots=rows('snapshots'),edits=rows('edits');
 for(const file of new Set(snapshots.map(s=>s.file))){
  const list=snapshots.filter(s=>s.file===file),base=list[0];let text;
  try{text=blob(base.hash);if(hash(Buffer.from(text))!==base.hash)failures.push({file,t:base.t,error:'initial snapshot hash mismatch'});}catch(e){failures.push({file,error:e.message});continue;}
  const stream=[...list.slice(1),...edits.filter(e=>e.file===file&&e.seq>base.seq)].sort((a,b)=>a.seq-b.seq);
  for(const e of stream)try{if(e.type==='edit')text=apply(text,e.changes);if(e.type==='snapshot'&&hash(Buffer.from(text))!==e.hash)failures.push({file,t:e.t,error:'snapshot hash mismatch'});}catch(error){failures.push({file,t:e.t,error:error.message});}
 }
 for(const f of JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))).files)try{const resolved=path.resolve(root,f.path);if(!resolved.startsWith(root+path.sep))throw Error('Outside archive');const bytes=fs.readFileSync(resolved);if(bytes.length!==f.bytes||hash(bytes)!==f.sha256)failures.push({file:f.path,error:'manifest hash/size mismatch'});}catch(e){failures.push({file:f.path,error:e.message});}
 return failures;
}
function snapshots(file){return rows('snapshots').filter(s=>!file||s.file===file);}
function submissions(outDir){const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))),list=[];for(const f of manifest.files){const m=f.path.match(/^problems\/([A-Z])\/submissions\/(\d+)\/(source\.[^/]+)$/);if(!m)continue;const metaFile=path.join(root,'problems',m[1],'submissions',m[2],'meta.json'),metadata=JSON.parse(fs.readFileSync(metaFile,'utf8'));list.push({problem:m[1],id:m[2],source:f.path,metadata});if(outDir){fs.mkdirSync(outDir,{recursive:true});const base=path.join(outDir,m[1]+'-'+m[2]);fs.copyFileSync(path.join(root,f.path),base+path.extname(m[3]));fs.writeFileSync(base+'.json',JSON.stringify(metadata,null,2));}}return list;}
if(require.main===module)try{const[action,file,t,out]=process.argv.slice(2);if(action==='verify'){const failures=verify();if(failures.length){console.error(JSON.stringify(failures,null,2));process.exitCode=1;}else console.log('replay.js VERIFY PASS');}else if(action==='timeline')process.stdout.write(fs.readFileSync(path.join(root,'timeline/timeline.md')));else if(action==='snapshots')console.log(JSON.stringify(snapshots(file),null,2));else if(action==='submissions')console.log(JSON.stringify(submissions(file??'reconstructed-submissions'),null,2));else if(action==='file'){const text=replay(file,t===undefined?Infinity:Number(t));if(out)fs.writeFileSync(out,text);else process.stdout.write(text);}else throw Error('Usage: replay.js verify | timeline | snapshots [file] | submissions [folder] | file A/A.cpp [milliseconds] [output]');}catch(e){console.error(e.message);process.exitCode=1;}
module.exports={replay,verify,apply,snapshots,submissions};
