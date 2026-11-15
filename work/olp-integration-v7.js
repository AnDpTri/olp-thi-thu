'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const vscode=require('vscode'),boundary=require('./test-boundary'),{createMock,good}=require('./mock-vnoj'),readZip=require('./read-test-zip');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),command=(name,...args)=>vscode.commands.executeCommand('olp.'+name,...args);
const root=()=>vscode.workspace.workspaceFolders[0].uri.fsPath,config=()=>vscode.workspace.getConfiguration('olp'),setting=(k,v)=>config().update(k,v,vscode.ConfigurationTarget.Global);
let step='initialization';
const log=name=>{step=name;fs.appendFileSync(path.join(root(),'steps.log'),new Date().toISOString()+' '+name+'\n');};
async function wait(check,description,timeout=45000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await sleep(100);}throw Error('Step '+step+': timeout waiting for '+description+'\n'+JSON.stringify({errors:boundary.ui.errors,warnings:boundary.ui.warnings,tabs:tabs()},null,2));}
function tabs(){return vscode.window.tabGroups.all.map(g=>({column:g.viewColumn,active:g.isActive,tabs:g.tabs.map(t=>({label:t.label,kind:t.input.constructor.name,uri:t.input.uri?.fsPath}))}));}
const state=()=>boundary.context.workspaceState.get('olp.practice.v1'),kitRoot=()=>path.join(root(),'OLP-'+state().kit.id),logRoot=()=>path.join(kitRoot(),'.olp',state().sessions.at(-1).id);
const rows=name=>fs.readFileSync(path.join(logRoot(),name+'.jsonl'),'utf8').split('\n').filter(Boolean).map(JSON.parse);
function replayLog(file,untilSeq=Infinity){const snapshots=rows('snapshots'),base=snapshots.find(s=>s.file===file);assert(base,'Missing replay baseline '+file);let text=fs.readFileSync(path.join(logRoot(),'blobs',base.hash),'utf8');for(const e of rows('edits').filter(e=>e.type==='edit'&&e.file===file&&e.seq>base.seq&&e.seq<=untilSeq).sort((a,b)=>a.seq-b.seq))text=require('./olp-vscode/recording').apply(text,e.changes);return text;}
function diagnosticDump(){
 const dump={kit:state()?.kit,sessionId:state()?.sessions?.at(-1)?.id,errors:boundary.ui.errors,warnings:boundary.ui.warnings,tabs:tabs()};
 try{dump.logDirectory=logRoot();dump.logFiles=fs.readdirSync(logRoot(),{withFileTypes:true}).map(item=>({name:item.name,directory:item.isDirectory(),bytes:item.isDirectory()?undefined:fs.statSync(path.join(logRoot(),item.name)).size}));for(const name of ['events','edits'])dump[name+'Tail']=fs.readFileSync(path.join(logRoot(),name+'.jsonl'),'utf8').trimEnd().split('\n').slice(-20);}catch(error){dump.logError=error.message;}
 return JSON.stringify(dump,null,2);
}
const sum=extra=>'#include <iostream>\nint main(){long long a,b;std::cin>>a>>b;std::cout<<a+b'+(extra??'')+'<<"\\n";}\n';
function assertSourceFocus(label) {
 const expected=path.join(kitRoot(),'A','A.cpp');
 assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath,expected,label+': active editor must be solution; '+JSON.stringify({focused:vscode.window.state.focused,tabs:tabs()}));
 assert.equal(vscode.window.tabGroups.activeTabGroup.viewColumn,1,label+': solution must own the wide group');
}
async function type(text,{append=false,input=false}={}){
 await command(input?'testFile':'source','A',...(input?['input']:[]));
 const expected=path.join(kitRoot(),'A',input?'input.txt':'A.cpp');
 assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath,expected,'Before type, step '+step);
 const editor=vscode.window.activeTextEditor;
 if(append){const end=editor.document.positionAt(editor.document.getText().length);editor.selection=new vscode.Selection(end,end);}
 if(!append)await vscode.commands.executeCommand('editor.action.selectAll');
 const before=editor.document.getText(),selection=editor.selection;
 const after=append?before.slice(0,editor.document.offsetAt(selection.start))+text+before.slice(editor.document.offsetAt(selection.end)):text;
 await vscode.commands.executeCommand('type',{text});
 if(append){assert.notEqual(editor.document.getText(),before,'Append did not reach '+expected+'; step '+step);assert.equal(replayLog(input?'A/input.txt':'A/A.cpp'),editor.document.getText(),'Real editor auto-formatting must replay exactly');}
 else assert.equal(editor.document.getText(),after,'Typed text did not reach '+expected+'; step '+step+'; '+JSON.stringify({focused:vscode.window.state.focused,tabs:tabs()}));
 assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath,expected,'Editor changed during typing');
}
function assertCompileHash(expected) {
 const e=rows('events').findLast(e=>e.type==='compile_result'&&e.problem==='A');
 assert(e,'Missing A compile event');assert.equal(e.sourceHash,crypto.createHash('sha256').update(expected).digest('hex'),'Compile event must identify exact editor source: '+JSON.stringify(e));
}
function verifyArchive(file){
 const files=readZip(fs.readFileSync(file));const manifest=JSON.parse(files.get('manifest.json'));require('./check-export-v2').check(files);
 for(const e of manifest.files){assert(files.has(e.path),'Missing '+e.path);assert.equal(crypto.createHash('sha256').update(files.get(e.path)).digest('hex'),e.sha256,'Hash '+e.path);assert.equal(files.get(e.path).length,e.bytes,'Size '+e.path);}
 assert(manifest.integrity.ok,JSON.stringify(manifest.integrity));
 for(const[name,data]of files)assert(!data.includes(Buffer.from(good)),'Mock cookie leaked in '+name);
 const unpacked=path.join(root(),'export-unpacked');for(const[name,data]of files){const dest=path.join(unpacked,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,data);}
 const replay=require(path.join(unpacked,'tools/replay.js'));assert.deepEqual(replay.verify(),[]);
 assert.deepEqual(Buffer.from(replay.replay('A/A.cpp')),files.get('problems/A/solution.cpp'));
 return {files,manifest,summary:JSON.parse(files.get('summary.json')),unpacked};
}
async function main(){
 const mock=await createMock('https://oj.vnoi.info').start(),realFetch=globalThis.fetch;mock.control.combined=true;mock.control.requireAuth=true;mock.control.htmlSamples=true;
 const own=[];globalThis.fetch=(input,init)=>{const u=new URL(typeof input==='string'?input:input.url??String(input));if(/[\\/]extension[\\/](?:submit|vnoj|imports)\.js/.test(new Error().stack))own.push({origin:u.origin,method:init?.method??'GET',path:u.pathname});return realFetch(u.origin==='https://oj.vnoi.info'?mock.origin+u.pathname+u.search:u,init);};
 try{
  log('quick start: link + cookie only, authenticated GET retry, split shared PDF');
  await setting('idleSeconds',2);await setting('duration',10);await setting('timer.warnings',[9.98]);
  boundary.ui.inputs.push('https://oj.vnoi.info/contest/olp24',good);boundary.ui.infoReply=(message,...buttons)=>message.includes('ngay?')?buttons[0]:undefined;
  await command('quick');assert.equal(state().kit.problems.length,4);assert.equal(boundary.ui.inputs.length,0);assert.equal(boundary.ui.picks.length,0,'quick should default to C++ without language dialog');
  assert(state().kit.problems.every(p=>p.pages),'Missing PDF mapping after awaited quick import: '+JSON.stringify(state().kit,null,2));
  assert.deepEqual(state().kit.problems.map(p=>p.pages.start),[3,5,5,1],JSON.stringify(state().kit));
  assert(mock.log.some(e=>e.path==='/contest/olp24'&&!e.cookie),'Missing public GET');assert(mock.log.some(e=>e.path==='/contest/olp24'&&e.cookie),'Missing authenticated retry');
  assert.equal(vscode.window.tabGroups.all.length,3,JSON.stringify(tabs()));assert(vscode.window.activeTextEditor.document.uri.fsPath.endsWith('A.cpp'));
  log('real editor changes, undo/redo, snapshot replay input');
  await type(sum());for(const char of '// bước 😀\n')await type(char,{append:true});await vscode.commands.executeCommand('undo');await vscode.commands.executeCommand('redo');
  await sleep(300);assert(rows('edits').some(e=>e.type==='edit'&&e.file==='A/A.cpp'));assert(rows('edits').some(e=>e.undo));assert(rows('edits').some(e=>e.redo));
  log('statement active view-state, page message, cached toggle, all four problem ranges');
  for(const p of state().kit.problems){await command('source',p.key);await command('statement');assert.equal(vscode.window.tabGroups.all.length,1,'statement must occupy full editor');await sleep(1300);assert(vscode.window.tabGroups.all.flatMap(g=>g.tabs).some(t=>t.input instanceof vscode.TabInputWebview&&t.label.startsWith(p.key+' · ')));await wait(()=>rows('events').some(e=>e.type==='statement_pages'&&e.problem===p.key&&e.pages.length),'visible pages for '+p.key);const views=rows('events').filter(e=>e.type==='statement_pages'&&e.problem===p.key);assert(views.every(e=>e.pages.every(page=>page>=p.pages.start&&page<=p.pages.end)),JSON.stringify({problem:p,views}));await command('statement');assert.equal(vscode.window.tabGroups.all.length,3,'toggle must restore working view');}
  await command('source','A');await command('statement');const before=Date.now();await command('statement');await command('statement');assert(Date.now()-before<2500,'cached statement toggle unexpectedly slow');await sleep(1300);
  await wait(()=>rows('events').some(e=>e.type==='statement_pages'),'webview visible-page event');
  if(vscode.window.state.focused){assert(rows('events').some(e=>e.type==='activity'&&e.category==='statement'),'No reading interval while focused');}else{fs.appendFileSync(path.join(root(),'steps.log'),'NOTE: OS window unfocused; real event records outside. Focus/blur priority covered in pure tests.\n');assert(rows('events').some(e=>e.type==='window_blur'));}
  await command('statement');assertSourceFocus('statement toggle return');
  log('idle detection from absence of actual kit interaction');
  await sleep(3400);if(vscode.window.state.focused)assert(rows('events').some(e=>e.type==='idle_start'),'Idle start absent');
  await type('// resumed\n',{append:true});
  log('run, wrong sample and diff, add sample');
  await type(sum());const outputSeq=rows('edits').at(-1).seq;await command('run');assertSourceFocus('after run');assertCompileHash(sum());assert.equal(fs.readFileSync(path.join(kitRoot(),'A/output.txt'),'utf8'),'5\n');
  const outputEdits=rows('edits').filter(e=>e.seq>outputSeq&&e.type==='edit'&&e.file==='A/output.txt');assert.equal(outputEdits.length,1,'Run must generate one output edit: '+JSON.stringify(outputEdits));assert(outputEdits[0].generated,'Output reload must be marked generated');
  await type(sum('+1'));await command('runSamples');assertSourceFocus('after failing samples');assert(boundary.ui.warnings.some(s=>s.includes('SAI')),'Expected SAI after +1 program: '+JSON.stringify(boundary.ui.warnings));await command('diffSample','A',1);assert(vscode.window.tabGroups.all.find(g=>g.viewColumn===1)?.tabs.some(t=>t.input instanceof vscode.TabInputTextDiff),'Sample diff must open in wide left group');
  await command('source','A');await type(sum());await type('7 8\n',{input:true});await command('source','A');await command('run');assertSourceFocus('after second run');await command('addSample');assert.equal(fs.readFileSync(path.join(kitRoot(),'A/mau-2.out'),'utf8'),'15\n');
  await command('runSamples');assertSourceFocus('after passing samples');assert(rows('events').some(e=>e.type==='milestone'&&e.name==='first_sample_pass'));
  log('submission safety then exactly one POST; automatic verdict and source retention');
  await type(sum('+1'));await command('submit');assert.equal(mock.control.posts.length,0,'Failed samples submitted without approval');boundary.ui.warnReply=(_message,button)=>button;boundary.ui.picks.push(items=>items.find(i=>i.label==='C++20'));await command('submit');assert.equal(mock.control.posts.length,1);boundary.ui.warnReply=undefined;
  await wait(()=>rows('events').some(e=>e.type==='verdict'&&e.text==='AC'),'final verdict');
  boundary.ui.inputs.push('Vòng thứ nhất');await command('mark');await command('stuck');boundary.ui.inputs.push('ghi chú cho agent');await command('note');
  await wait(()=>rows('events').some(e=>e.type==='timer_warning'),'configured timer warning');
  assert(boundary.api.snapshot().some(r=>r.label.startsWith('A · ')&&r.children.some(c=>c.label==='Mốc thời gian')),'Missing milestone tree');
  log('end triggers automatic export; unzip, index, replay, timing, no secrets');
  await command('end');const file=boundary.ui.clipboard;assert(file.endsWith('.zip')&&fs.existsSync(file),'Expected ZIP path copied, got '+file);const result=verifyArchive(file);
  for(const name of ['README_AGENT.md','summary.json','report.md','timeline/events.jsonl','timeline/edits.jsonl','tools/replay.py','statement/full.pdf','problems/A/statement.txt','problems/A/code-history/index.md'])assert(result.files.has(name),'Missing '+name);
  assert.equal(result.manifest.problems[0].pages.start,3);assert.equal(result.summary.problems.A.submissions.length,1);assert(result.summary.problems.A.typing.inserted>50);assert(result.summary.problems.A.sampleRuns.fail>=1);const measured=Object.values(result.summary.overall.timeMs).reduce((a,b)=>a+b,0);assert(measured<=result.summary.durationMs&&measured>=result.summary.durationMs-2000,JSON.stringify(result.summary.overall.timeMs));assert(own.length>10&&own.every(e=>e.origin==='https://oj.vnoi.info'),JSON.stringify(own));assert.equal(mock.foreignLog.length,0);
  assert.equal(result.manifest.problems.filter(p=>p.statement.source==='statement/full.pdf').length,4);
  assert(result.files.get('problems/A/statement.txt').toString().includes('\u0110\u0102NG K\u00dd H\u1eccC PH\u1ea6N'));
  assert(result.files.get('problems/A/statement.txt').toString().includes('2 \u00d7 10^{5}'));
  assert.equal(result.manifest.problems[0].originalHeading,'B\u00e0i 2');
  assert.equal(result.manifest.problems[0].samples.find(s=>s.n===1).samplesSource,'vnoj-html');
  assert.equal(result.manifest.problems[0].samples.find(s=>s.n===2).samplesSource,'user-added');
  assert(result.summary.problems.A.sampleResults.fail>=1);assert.equal(result.summary.problems.A.finalVerdict,'AC');
  assert(rows('events').filter(e=>e.type==='mark').every(e=>e.text&&typeof e.phase==='string'));
  const reportOnDisk=fs.readFileSync(path.join(kitRoot(),'phien-'+state().sessions.at(-1).id+'.md'),'utf8');
  assert.equal(reportOnDisk,result.files.get('report.md').toString(),'In-editor report and ZIP report must agree');
  await command('copy');assert.equal(boundary.ui.clipboard,reportOnDisk,'Clipboard report must use the same model');
  fs.writeFileSync(path.join(root(),'export-path.txt'),file);
 }finally{globalThis.fetch=realFetch;mock.stop();}
}
async function crashPrepare(){
 log('crash prepare: local kit, real edit, saved checkpoint and fsynced edit');boundary.ui.picks.push(items=>items[0]);await command('local');await command('start');await command('source','A');await type(sum());await vscode.window.activeTextEditor.document.save();await type('// before crash 😀\n',{append:true});await vscode.window.activeTextEditor.document.save();
 fs.writeFileSync(path.join(root(),'crash-before.txt'),vscode.window.activeTextEditor.document.getText());await type('// unsaved-before-kill\n',{append:true});await sleep(100);
 const expected=vscode.window.activeTextEditor.document.getText(),lastSeq=rows('edits').at(-1).seq;assert(expected.includes('unsaved-before-kill'),'Editor did not receive unsaved marker');assert.equal(replayLog('A/A.cpp',lastSeq),expected,'Edit replay already differs BEFORE kill');
 fs.writeFileSync(path.join(root(),'crash-proof.json'),JSON.stringify({sessionId:state().sessions.at(-1).id,lastSeq,expected},null,2));fs.writeFileSync(path.join(root(),'crash.ready'),'ready');
}
async function crashResume(){
 log('crash resume: disk rollback is explicit; historical unsaved edits survive');
 const proof=JSON.parse(fs.readFileSync(path.join(root(),'crash-proof.json'),'utf8'));
 assert.equal(state().sessions.at(-1).id,proof.sessionId,'Resume selected a different session log');
 const saved=fs.readFileSync(path.join(root(),'crash-before.txt'),'utf8'),disk=fs.readFileSync(path.join(kitRoot(),'A/A.cpp'),'utf8');
 assert.equal(disk,saved,'Restart disk must contain the saved checkpoint');
 assert(!disk.includes('unsaved-before-kill'),'Unsaved marker must not magically appear on disk');
 assert(proof.expected.includes('unsaved-before-kill'));
 assert.equal(replayLog('A/A.cpp',proof.lastSeq),proof.expected,'Fsynced pre-kill edit sequence lost');
 await command('source','A');const reopened=vscode.window.activeTextEditor.document.getText();
 assert.equal(reopened,saved,'Reopened document must match actual saved disk in this isolated crash fixture');
 const baseline=rows('events').findLast(e=>e.type==='resume_baseline'&&e.file==='A/A.cpp');
 assert(baseline?.changed,'Missing explicit rollback baseline after crash: '+JSON.stringify(baseline));
 assert.equal(baseline.previousHash,crypto.createHash('sha256').update(proof.expected).digest('hex'));
 assert.equal(baseline.observedHash,crypto.createHash('sha256').update(reopened).digest('hex'));
 const checkpoint=rows('snapshots').findLast(e=>e.file==='A/A.cpp'&&e.reason==='resume');
 assert(checkpoint&&checkpoint.seq>baseline.seq,'Missing reopened-text resume snapshot');
 assert.equal(replayLog('A/A.cpp',checkpoint.seq),reopened,'Replay after resume baseline must reproduce reopened document');
 await type('\n// after resume',{append:true});const actual=vscode.window.activeTextEditor.document.getText();
 assert(actual.includes('after resume'));assert.equal(replayLog('A/A.cpp'),actual,'Post-resume editor must replay exactly');
 assert(rows('events').some(e=>e.type==='session_resume'));await command('end');
 const result=verifyArchive(boundary.ui.clipboard);assert(result.manifest.integrity.ok);
 assert.equal(result.files.get('problems/A/solution.cpp').toString(),actual,'Export must contain the real post-resume document');
}
exports.run=async function(){const phase=process.env.OLP_TEST_PHASE??'main';try{if(phase==='crash-prepare'){await crashPrepare();return;}if(phase==='crash-resume')await crashResume();else await main();fs.writeFileSync(path.join(root(),phase+'.result'),'PASS');}catch(error){const dump=error.stack+'\nSTEP: '+step+'\n'+diagnosticDump();fs.writeFileSync(path.join(root(),phase+'.result'),dump);console.error(dump);throw error;}};
