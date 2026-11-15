'use strict';
const fs=require('node:fs'),path=require('node:path');
const {zip}=require('./zip'),{sha,verify,timestamp,apply}=require('./recording'),timer=require('./session');
const {metrics,summaryMarkdown,reportMarkdown,duration}=require('./observations');
function diff(before,after,name){const a=before.split('\n'),b=after.split('\n');return '--- a/'+name+'\n+++ b/'+name+'\n@@ -1,'+a.length+' +1,'+b.length+' @@\n'+a.map(s=>'-'+s).join('\n')+'\n'+b.map(s=>'+'+s).join('\n')+'\n';}
function worklog(rec,session,legacyPrefixMs=0){
  const ignored=new Set(['selection','kit_file_changed','focus','save']);
  const journal=(session?.events??[]).filter(e=>e.at-session.start<=legacyPrefixMs).map((e,i,a)=>({...e,t:e.at-session.start,seq:i-a.length,type:'legacy_'+e.type}));
  const stream=[...(legacyPrefixMs?journal:[]),...rec.events,...rec.edits].filter(e=>!ignored.has(e.type)).sort((a,b)=>a.seq-b.seq),lines=[],state=new Map();
  for(const s of rec.snapshots)if(!state.has(s.file))state.set(s.file,fs.readFileSync(path.join(rec.dir,'blobs',s.hash),'utf8'));
  const put=(e,text)=>lines.push({problem:e.problem,line:'+'+duration(e.t)+' '+(e.problem??'—')+' · '+text});
  for(let i=0;i<stream.length;i++){
    const e=stream[i];
    if(e.type==='activity'){const values=[e.category];while(stream[i+1]?.type==='activity'&&stream[i+1].problem===e.problem&&Math.floor(stream[i+1].t/1000)===Math.floor(e.t/1000))values.push(stream[++i].category);put(e,'Hoạt động: '+values.filter((v,i,a)=>!i||v!==a[i-1]).join(' → '));continue;}
    if(e.type==='edit'){
      const burst=[e];while(stream[i+1]?.type==='edit'&&stream[i+1].file===e.file&&stream[i+1].t-burst.at(-1).t<2000)burst.push(stream[++i]);
      const inserted=[],removed=[],ranges=[];let failure='';
      for(const b of burst){const before=state.get(b.file)??'';for(const c of b.changes){const line=before.slice(0,c.offset).split('\n').length;ranges.push(line,line+Math.max(c.text.split('\n').length,c.removedText.split('\n').length)-1);inserted.push(c.text);removed.push(c.removedText);}try{state.set(b.file,apply(before,b.changes));}catch(err){failure=' REPLAY ERROR: '+err.message;}}
      const preview=parts=>{const text=parts.join('');return JSON.stringify(text.slice(0,300))+(text.length>300?'… ['+text.length+' UTF-16 units]':'');};
      put(e,'Sửa '+e.file+' · dòng '+Math.min(...ranges)+'–'+Math.max(...ranges)+' · '+burst.length+' lượt; chèn '+preview(inserted)+'; xóa '+preview(removed)+failure);continue;
    }
    if(e.type==='run'||e.type==='sample_result')put(e,(e.sample?'Mẫu '+e.sample:'Chạy input.txt')+': '+(e.verdict??e.status??'')+' · exit '+(e.exit??'—')+' · '+Math.round(e.ms??0)+' ms');
    else if(e.type==='compile_result')put(e,'Biên dịch: '+(e.ok?'OK':'CE')+(e.cached?' (cache đã xác minh)':'')+' · '+Math.round(e.ms??0)+' ms · SHA256 '+(e.sourceHash??'unknown'));
    else if(e.type==='mark')put(e,'Ghi mốc/ghi chú ['+(e.phase??'unknown')+']: '+(e.text??''));
    else put(e,e.type+' '+JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k])=>!['seq','t','ts','type','problem','refs'].includes(k)))));
  }
  return lines;
}
function exportSession(recorder,session,destination,{now=Date.now(),unpacked}={}){
  recorder.snapshotAll(session.end===undefined?'export':'end',now);recorder.emit('export',null,{filename:path.basename(destination)},now);
  const files=new Map(),add=(name,value)=>{const bytes=Buffer.isBuffer(value)?value:Buffer.from(value);if(bytes.length)files.set(name,bytes);return {path:bytes.length?name:null,bytes:bytes.length,state:bytes.length?'stored':'empty'};};
  const json=(name,value)=>add(name,JSON.stringify(value,null,2));
  const integrity=verify(recorder),summary=metrics(recorder.events,recorder.edits,session,now),artifacts={};
  const missingData=summary.legacy?['Observed focus/visibility/window/idle intervals before '+summary.legacyPrefixMs+' ms: only old journal estimates are available.','Character edits and full snapshots before the upgrade are unavailable.','Exact historical run artifacts, individual-sample results and submitted source may be unavailable; see file/sourceState descriptors.','PDFs and samples without historical hashes are current kit copies, not proof of session-time contents.']:[];
  const firstProblem=session.kit.problems[0],firstSourceBase=recorder.snapshots.find(s=>s.file===firstProblem.key+'/'+firstProblem.source&&s.t<=summary.elapsedMs);
  const example=Math.floor(((firstSourceBase?.t??0)+summary.elapsedMs)/2);let readme=`# OLP practice evidence archive\n${session.synthetic?'SYNTHETIC DEMONSTRATION — NOT A REAL ATTEMPT\n':''}${summary.legacy?'\n**phiên cũ – không có nhật ký chi tiết**: historical timing uses old journal estimates. Idle/outside and pre-upgrade edits/sources are not known; inspect legacy/missingData in manifest.\n':''}
Read SCHEMA.md for all fields, timing definitions, reconstruction and caveats. Suggested order: manifest.json → summary.md/json → report.md → timeline/timeline.md → problems/A/worklog.md and code-history/index.md. Raw events/edits and both replay tools are authoritative for reconstruction; integrity reports missing data/divergences.

Time: elapsed is wall time since session start, bounded by end/deadline; limit is the contest allowance. A problem's total is its allocated intervals: statement (active visible PDF), code, input, output, other-file, none (no observed surface), outside (unfocused VS Code/unknown crash gap), idle (focused but no observed interaction for the configured threshold). Outside overrides idle, then the focused surface. Each problem's categories sum to its total; problems plus unassigned sum to elapsed. All three reports use these same integer-ms values, displayed as HH:MM:SS.mmm. Idle/outside describe observations, not attention.

Contest: ${session.kit.title}; ${session.kit.problems.length} independent problems, limit ${duration(summary.limitMs)}. Judge verdicts/partial scores are recorded; other scoring rules are unknown. PNG statement-pages are the authoritative rendered statement; statement.txt is a convenience and mathematical layout may still lose meaning. Shared PDFs live once in statement/; each problem's statement.json specifies pages/crop/assignment.

All paths are archive-relative. Run artifacts and exact submitted sources live under problems/X; raw timeline references resolve via manifest.artifacts. Empty files are omitted (state=empty in metadata); empty snapshot blobs are implicit SHA256 of empty UTF-8. Legacy data gaps are explicit. Events are self-recorded interaction proxies, not proof of attention. No cookies, sessions, request headers or deliberate usernames beyond public VNOJ handles are exported. User-authored kit text can itself be sensitive; inspect before sharing. No upload/telemetry.

From the extracted folder (time ${example} ms is inside this session):
\`\`\`text
node tools/replay.js file ${session.kit.problems[0].key}/${session.kit.problems[0].source} ${example} source.cpp
python tools/replay.py file ${session.kit.problems[0].key}/${session.kit.problems[0].source} ${example} source-python.cpp
node tools/replay.js submissions reconstructed-submissions
python tools/replay.py submissions reconstructed-submissions-python
node tools/replay.js snapshots
python tools/replay.py snapshots
node tools/replay.js verify
python tools/replay.py verify
node tools/replay.js timeline
\`\`\`
Submission commands write exact retained sources and metadata for every submission (including duplicate source texts). See SCHEMA.md for the difference between event-time replay and exact submitted bytes.
`;
  if(summary.legacy&&!firstSourceBase)readme=readme.replace(/^(?:node|python) tools\/replay\.(?:js|py) file .*\n/gm,'')+'\nHistorical text is unavailable: file replay inside this session has no baseline. Any post-session observations do not prove historical text; consult timeline/legacy-journal.jsonl for the old journal.\n';
  add('README_AGENT.md',readme);add('SCHEMA.md',fs.readFileSync(path.join(__dirname,'SCHEMA.md')));
  json('summary.json',summary);add('summary.md',summaryMarkdown(summary));add('report.md',reportMarkdown(session,summary,now));
  for(const name of ['events','edits','snapshots'])add('timeline/'+name+'.jsonl',recorder[name].map(e=>JSON.stringify(e)).join('\n')+(recorder[name].length?'\n':''));
  if(summary.legacy)add('timeline/legacy-journal.jsonl',(session.events??[]).map(e=>JSON.stringify(e)).join('\n')+'\n');
  for(const s of recorder.snapshots)try{add('timeline/blobs/'+s.hash,fs.readFileSync(path.join(recorder.dir,'blobs',s.hash)));}catch{integrity.ok=false;integrity.missing.push({file:s.file,hash:s.hash,error:'Snapshot blob unavailable'});}
  const narrative=worklog(recorder,session,summary.legacyPrefixMs);add('timeline/timeline.md','# Work log\n\n'+(summary.legacy?'phiên cũ – không có nhật ký chi tiết; legacy_* lines come from the old journal.\n\n':'')+narrative.map(r=>r.line).join('\n\n')+'\n');
  const pdfGroups=new Map();
  for(const p of session.kit.problems){const file=path.join(recorder.root,p.key,'De-bai.pdf');if(!recorder.relative(file)||!fs.existsSync(file))continue;const bytes=fs.readFileSync(file),hash=sha(bytes);if(!pdfGroups.has(hash))pdfGroups.set(hash,{bytes,problems:[]});pdfGroups.get(hash).problems.push(p.key);}
  let shared=0;for(const [hash,g]of pdfGroups){g.file=g.problems.length>1?'statement/full'+(shared++?'-'+hash.slice(0,10):'')+'.pdf':'problems/'+g.problems[0]+'/statement.pdf';add(g.file,g.bytes);}
  const metadata=[];
  for(const p of session.kit.problems){
    const base='problems/'+p.key+'/',dir=path.join(recorder.root,p.key),fileIndex={};
    for(const name of [p.source,'input.txt','output.txt']){const file=p.key+'/'+name;if(summary.legacy&&!recorder.snapshots.some(s=>s.file===file&&s.t<=summary.elapsedMs)){fileIndex[name]={path:null,bytes:null,state:'unavailable',reason:'No session-time snapshot; current/post-session text is not historical evidence'};continue;}if(!recorder.relative(path.join(dir,name))){integrity.ok=false;integrity.missing.push({file,error:'Outside kit'});continue;}fileIndex[name]=add(base+(name===p.source?'solution'+path.extname(p.source):name),recorder.shadow.get(file)??(fs.existsSync(path.join(dir,name))?fs.readFileSync(path.join(dir,name)):''));}
    const group=[...pdfGroups.values()].find(g=>g.problems.includes(p.key));
    const statement={source:group?.file??null,pages:p.pages?{start:p.pages.start,end:p.pages.end}:null,crop:{top:p.pages?.top??null,bottom:p.pages?.bottom??null,units:'PDF points; viewport scale 1, top origin; top applies first page, bottom last page'},confidence:p.pages?.confidence??'unknown',assignment:p.pages?.assignment??(p.pages?.confidence==='manual'?'manual':'automatic'),originalHeading:p.pages?.heading??null,originalNumber:p.pages?.headingNumber??null,commonPages:p.commonPages??null,warning:p.pdfWarning??p.renderWarning??null};
    if(summary.legacy)statement.currentKitCopy=true;
    json(base+'statement.json',statement);
    const statementText=fs.existsSync(path.join(dir,'statement.txt'))?fs.readFileSync(path.join(dir,'statement.txt')):null;
    add(base+'statement.txt',statementText?.length?statementText:'Statement text unavailable. PNG pages/PDF are authoritative.\n');
    if(p.rendered&&p.rendered.range===JSON.stringify(p.pages))for(const image of p.rendered.images??[])if(/^statement-pages\/page-\d+\.png$/.test(image.file)&&recorder.relative(path.join(dir,image.file))&&fs.existsSync(path.join(dir,image.file)))add(base+image.file,fs.readFileSync(path.join(dir,image.file)));
    const samples=[];
    for(const name of fs.existsSync(dir)?fs.readdirSync(dir):[]){const n=name.match(/^mau-(\d+)\.in$/)?.[1];if(!n||!recorder.relative(path.join(dir,name)))continue;const sample={n:Number(n),samplesSource:p.sampleSources?.[n]??'unknown',verified:false,provenance:p.sampleSource??null,originalHashes:p.sampleHashes?.[n]??null,hashes:{}};for(const ext of ['in','out']){const name='mau-'+n+'.'+ext;if(fs.existsSync(path.join(dir,name))&&recorder.relative(path.join(dir,name))){const bytes=fs.readFileSync(path.join(dir,name));sample[ext]=add(base+'samples/'+name,bytes);sample.hashes[ext]=sha(bytes);}}sample.matchesImported=sample.originalHashes?sample.hashes.in===sample.originalHashes.in&&sample.hashes.out===sample.originalHashes.out:null;sample.verified=['vnoj-html','companion'].includes(sample.samplesSource)&&sample.matchesImported===true;samples.push(sample);}
    if(summary.legacy)for(const sample of samples)sample.currentKitCopy=true;
    json(base+'samples/meta.json',{samples});
    const snaps=recorder.snapshots.filter(s=>s.file===p.key+'/'+p.source&&(!summary.legacy||s.t<=summary.elapsedMs)),index=['# Code history',''];
    if(!snaps.length&&summary.legacy)index.push('phiên cũ – không có nhật ký chi tiết. Historical source/snapshots are unavailable; the current kit solution is deliberately not presented as the old solution.');
    else if(new Set(snaps.map(s=>s.hash)).size<=1)index.push('Unchanged since the initial/template snapshot. No redundant code-history snapshots/diffs emitted. Full baseline and all checkpoints remain in timeline/snapshots.jsonl.');
    else {index.push('| t (ms) | reason | lines changed (whole-file diff) | snapshot | diff |','| ---: | --- | ---: | --- | --- |');let previous='',lastHash,n=0;for(const s of snaps){if(s.hash===lastHash)continue;lastHash=s.hash;try{const text=fs.readFileSync(path.join(recorder.dir,'blobs',s.hash),'utf8'),file='snapshots/'+String(++n).padStart(3,'0')+'-'+s.t+'-'+s.reason.replace(/[^a-z0-9-]/gi,'_')+path.extname(p.source),entry=add(base+'code-history/'+file,text),d='diffs/'+String(n).padStart(3,'0')+'.diff';add(base+'code-history/'+d,diff(previous,text,p.source));index.push('| '+[s.t,s.reason,previous.split('\n').length+text.split('\n').length,entry.path?'[snapshot]('+file+')':'empty text','[diff]('+d+')'].join(' | ')+' |');previous=text;}catch{index.push('| '+s.t+' | '+s.reason+' | — | MISSING | — |');}}}
    add(base+'code-history/index.md',index.join('\n')+'\n');add(base+'worklog.md','# '+p.key+' · '+(p.name??p.key)+'\n\n'+narrative.filter(r=>r.problem===p.key).map(r=>r.line).join('\n\n')+'\n');
    metadata.push({...Object.fromEntries(['sourceFile','key','name','vnojCode','url','originalHeading','originalNumber','language','finalVerdict','bestScore','accepted','submissionsCount'].map(k=>[k,summary.problems[p.key][k]])),pages:p.pages??null,statement,samples,files:fileIndex});
  }
  function asset(old,dest){if(!old)return {path:null,bytes:0,state:'empty'};const relative=typeof old==='string'?old:old.path;if(!relative)return {path:null,bytes:old.bytes??0,state:'empty'};if(artifacts[relative])return artifacts[relative];const file=path.resolve(recorder.dir,'assets',relative);if(!file.startsWith(path.resolve(recorder.dir,'assets')+path.sep))throw Error('Outside assets');if(!fs.existsSync(file)){integrity.ok=false;integrity.missing.push({file:relative,error:'Missing asset'});return {path:null,state:'missing'};}const entry=add(dest,fs.readFileSync(file));artifacts[relative]=entry;return entry;}
  const compileEvents=recorder.events.filter(e=>e.type==='compile_result'),used=new Set(),jobs=[];
  for(const e of recorder.events.filter(e=>['run','sample_result'].includes(e.type))){const compile=compileEvents.findLast(c=>c.problem===e.problem&&c.seq<e.seq);if(compile)used.add(compile.seq);jobs.push({e,compile});}
  for(const c of compileEvents)if(!used.has(c.seq))jobs.push({e:{...c,type:'compile_only',status:c.ok?'OK':'CE'},compile:c});
  const orders={};for(const {e,compile}of jobs.sort((a,b)=>a.e.seq-b.e.seq)){
    const order=orders[e.problem]=(orders[e.problem]??0)+1,verdict=e.verdict==='ĐÚNG'?'AC':e.verdict==='SAI'?'WA':e.verdict??e.status??'unknown',base='problems/'+e.problem+'/runs/run-'+String(order).padStart(3,'0')+'-'+(e.sample?'sample-'+e.sample:e.type==='compile_only'?'compile':'input')+'-'+verdict.replace(/[^a-z0-9-]/gi,'_')+'/';
    const refs={};for(const name of ['stdin','stdout','stderr'])refs[name]=asset(e.refs?.[name],base+name+'.txt');
    const compiled=compile?{...compile,ms:Math.round(compile.ms??0),output:asset(compile.output??e.refs?.compile,base+'compile.txt')}:null;
    if(e.refs?.compile)asset(e.refs.compile,compiled?.output?.path??base+'compile.txt');
    const meta={...e,ms:e.ms===undefined?null:Math.round(e.ms),refs,compile:compiled};delete meta.artifacts;if(e.type==='compile_only')for(const k of ['output','diagnostics','sourceHash','ok','cached'])delete meta[k];const metaRef=json(base+'meta.json',meta);
    const oldBase=e.artifacts??(e.refs?.stdin?.path?path.posix.dirname(e.refs.stdin.path)+'/':null);if(oldBase)artifacts[oldBase+'meta.json']=metaRef;
  }
  // Submission metadata is one record with the final verdict; preserve exact bytes.
  const assetsRoot=path.join(recorder.dir,'assets');
  function submissions(dir,prefix=''){if(!fs.existsSync(dir))return;for(const item of fs.readdirSync(dir,{withFileTypes:true})){const rel=prefix+item.name,file=path.join(dir,item.name);if(item.isDirectory())submissions(file,rel+'/');else if(/^[A-Z]\/submissions\//.test(rel)){if(item.name==='meta.json'){const meta=JSON.parse(fs.readFileSync(file,'utf8')),key=rel[0],verdict=recorder.events.findLast(e=>e.type==='verdict'&&e.problem===key&&String(e.submission)===String(meta.id));if(meta.source)meta.source=asset(meta.source,'problems/'+meta.source).path;const entry=json('problems/'+rel,{...meta,verdict:verdict?.text??meta.verdict??null,verdictAt:verdict?.t??null});artifacts[rel]=entry;}else asset(rel,'problems/'+rel);}}}
  submissions(assetsRoot);
  if(summary.legacy)for(const [key,p]of Object.entries(summary.problems))for(const s of p.submissions){if(!/^\d+$/.test(String(s.id)))continue;const file='problems/'+key+'/submissions/'+s.id+'/meta.json';if(!files.has(file))json(file,{id:s.id,url:s.url??null,language:s.language,legacy:true,source:null,sourceState:'unavailable',verdict:p.verdicts.findLast(v=>v.id===s.id)?.verdict??null});}
  add('tools/replay.js',fs.readFileSync(path.join(__dirname,'replay.js')));add('tools/replay.py',fs.readFileSync(path.join(__dirname,'replay.py')));
  const manifest={schemaVersion:2,extensionVersion:'0.7.0',synthetic:Boolean(session.synthetic),legacy:summary.legacy,missingData,session:{id:session.id,limitMs:summary.limitMs,elapsedMs:summary.elapsedMs,startedAt:timestamp(session.start),endedAt:session.end===undefined?null:timestamp(session.end),endReason:session.end===undefined?null:(session.events.some(e=>e.type==='expired')?'expired':'manual')},contest:{title:session.kit.title},problems:metadata,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,utcOffsetMinutes:-new Date(session.start).getTimezoneOffset(),integrity,artifacts,limitations:['Self-recorded interaction proxies, not proof of attention.','PNG pages are authoritative; PDF text is a convenience.','Older sessions have no edit history before 0.7.0.','Crash/closed-window gaps counted outside with unknown activity.'],files:[...files].map(([file,data])=>({path:file,bytes:data.length,sha256:sha(data),description:file.split('/')[0]}))};
  json('manifest.json',manifest);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination+'.tmp',zip([...files]));fs.renameSync(destination+'.tmp',destination);
  if(unpacked){
    // Refresh only files indexed by our previous generated manifest, never
    // arbitrary user files or any directory outside this explicit destination.
    const previous=path.join(unpacked,'manifest.json'),base=path.resolve(unpacked)+path.sep;
    if(fs.existsSync(previous)){const old=JSON.parse(fs.readFileSync(previous));for(const item of old.files??[]){const dest=path.resolve(unpacked,item.path);if(!dest.startsWith(base))throw Error('Outside unpacked export');if(!files.has(item.path)&&fs.existsSync(dest)&&fs.statSync(dest).isFile())fs.unlinkSync(dest);}}
    for(const [name,data]of files){const target=path.join(unpacked,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,data);}
  }
  return {destination,manifest,summary};
}
module.exports={exportSession,metrics,summaryMarkdown,reportMarkdown,diff,worklog};
