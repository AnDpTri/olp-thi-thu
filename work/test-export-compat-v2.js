'use strict';
// Format-only conversion of an already exported fixture; no VS Code/network.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const readZip=require('./read-test-zip'),{Recorder}=require('./olp-vscode/recording');
(async()=>{
 const input=path.resolve(process.argv[2]),project=path.resolve(__dirname,'..');assert(input.startsWith(project+path.sep),'Fixture must be inside project');
 const bytes=fs.readFileSync(input),files=readZip(bytes),old=JSON.parse(files.get('manifest.json'));assert.equal(old.schemaVersion,1);
 const root=path.join(__dirname,'export-compat-v2-'+Date.now()),kit={id:'compatibility',title:old.contest.title,problems:old.problems.map(p=>({...p}))},session={id:old.session.id,start:Date.parse(old.session.start),end:Date.parse(old.session.end),deadline:Date.parse(old.session.start)+old.session.durationMs,duration:old.session.durationMs,recordingVersion:1,kit,events:[]},log=path.join(root,'.olp',session.id);
 fs.mkdirSync(log,{recursive:true});
 for(const [name,data]of files){
   let relative;
   if(name.startsWith('timeline/')&&!name.endsWith('.md'))relative='.olp/'+session.id+'/'+name.slice(9);
   else if(/^problems\/[A-Z]\/runs\//.test(name)||/^problems\/[A-Z]\/submissions\//.test(name))relative='.olp/'+session.id+'/assets/'+name.slice(9);
   else if(/^problems\/[A-Z]\//.test(name)&&!name.includes('/code-history/')){const key=name[9],base=name.slice(11),p=kit.problems.find(p=>p.key===key);relative=key+'/'+(base==='statement.pdf'?'De-bai.pdf':base.startsWith('solution.')?p.source:base);}
   if(relative){const file=path.resolve(root,relative);assert(file.startsWith(root+path.sep));fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,data);}
 }
 const events=fs.readFileSync(path.join(log,'events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);session.events=events.map(e=>({...e,at:session.start+e.t}));
 for(const p of kit.problems)for(const name of [p.source,'input.txt','output.txt'])if(!fs.existsSync(path.join(root,p.key,name)))fs.writeFileSync(path.join(root,p.key,name),'');
 await require('./olp-vscode/pdf-map').prepare(root,kit);
 const recorder=new Recorder(root,session,session.end),out=path.join(root,'unpacked'),result=require('./olp-vscode/archive').exportSession(recorder,session,path.join(root,'converted.zip'),{now:session.end,unpacked:out});
 assert(result.manifest.integrity.ok,JSON.stringify(result.manifest.integrity));const converted=readZip(fs.readFileSync(path.join(root,'converted.zip')));require('./check-export-v2').check(converted);const replay=require(path.join(out,'tools/replay.js'));assert.deepEqual(replay.verify(),[]);
 assert(converted.has('statement/full.pdf'));assert(!converted.has('problems/A/statement.pdf'));assert(converted.get('problems/A/statement.txt').toString().includes('2 × 10^{5}'));
 assert.deepEqual(Buffer.from(replay.replay('A/A.cpp')),converted.get('problems/A/solution.cpp'));
 console.log('real archive schema-2 conversion PASS '+JSON.stringify({oldBytes:bytes.length,newBytes:fs.statSync(path.join(root,'converted.zip')).size,pdfCopies:[...converted.keys()].filter(n=>n.endsWith('.pdf')).length,directory:root}));
})().catch(e=>{console.error(e);process.exitCode=1;});
