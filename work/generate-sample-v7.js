'use strict';
const fs=require('node:fs'),path=require('node:path');
const {Recorder}=require('./olp-vscode/recording'),{exportSession}=require('./olp-vscode/archive'),timer=require('./olp-vscode/session');
async function generate(){
  const root=path.join(__dirname,'synthetic-v7-'+Date.now()),out=path.join(__dirname,'../outputs/sample-export-0.7.0');
  const kit={id:'synthetic',title:'SYNTHETIC OLP demonstration',problems:[{key:'A',name:'Synthetic addition',source:'A.cpp',tests:1,url:'https://oj.vnoi.info/problem/synthetic-addition',sampleSources:{1:'user-added'}}]};
  fs.mkdirSync(path.join(root,'A'),{recursive:true});fs.writeFileSync(path.join(root,'A','statement.txt'),'SYNTHETIC: read two integers, output their sum.\n');fs.writeFileSync(path.join(root,'A','mau-1.in'),'2 40\n');fs.writeFileSync(path.join(root,'A','mau-1.out'),'42\n');
  const stream='BT /F1 16 Tf 50 750 Td (Problem A. Synthetic addition) Tj 0 -30 Td (SYNTHETIC demonstration, not a real contest submission.) Tj 0 -30 Td (Read two integers; print their sum.) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];let pdf='%PDF-1.4\n';const offsets=[];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=(i+1)+' 0 obj\n'+objects[i]+'\nendobj\n';}const xref=Buffer.byteLength(pdf);pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';fs.writeFileSync(path.join(root,'A/De-bai.pdf'),pdf);kit.problems[0].pdf=true;await require('./olp-vscode/pdf-map').prepare(root,kit);
  const start=Date.parse('2026-11-15T02:00:00+07:00'),session=timer.start(kit,start,'synthetic-session');session.synthetic=true;
  const rec=new Recorder(root,session,start),at=n=>start+n;
  for(const [name,text]of [['A.cpp','// SYNTHETIC\r\n'],['input.txt','2 40\n'],['output.txt','']])rec.baseline('A/'+name,text,start);
  rec.focus('A','statement',at(1000));rec.milestone('A','first_statement',at(1000));rec.emit('statement_pages','A',{pages:[1]},at(1500));rec.focus('A','code',at(5000));
  const code='#include <iostream>\nint main(){long long a,b;std::cin>>a>>b;std::cout<<a+b<<"\\n";}\n// Xin chào 😀\n';
  rec.change('A/A.cpp',[{rangeOffset:14,rangeLength:0,text:code}],2,undefined,at(6000));let version=2;for(const c of '// thử\n')rec.change('A/A.cpp',[{rangeOffset:rec.shadow.get('A/A.cpp').length,rangeLength:0,text:c}],++version,undefined,at(6000+version*10));rec.save('A/A.cpp',version,at(6500));rec.snapshotAll('run',at(7000));
  rec.emit('compile_result','A',{sourceHash:require('./olp-vscode/recording').sha(rec.shadow.get('A/A.cpp')),ok:true,ms:300,diagnostics:[]},at(7300));rec.milestone('A','first_compile',at(7300));rec.milestone('A','first_clean_compile',at(7300));
  const refs={stdin:rec.asset('A/runs/1/stdin.txt','2 40\n'),stdout:rec.asset('A/runs/1/stdout.txt','42\n'),stderr:rec.asset('A/runs/1/stderr.txt',''),compile:rec.asset('A/runs/1/compile.txt','SYNTHETIC: simulated clean compile\n')};rec.asset('A/runs/1/meta.json',JSON.stringify({synthetic:true,exit:0,ms:12,refs}));rec.emit('run','A',{exit:0,status:'OK',ms:12,command:'A.exe',refs},at(7400));rec.snapshotAll('samples',at(8000));rec.emit('sample_result','A',{sample:1,verdict:'ĐÚNG',ms:12,refs},at(8100));rec.emit('samples','A',{passed:1,total:1},at(8200));rec.milestone('A','first_sample_pass',at(8200));
  rec.window(false,at(10000));rec.window(true,at(15000));rec.tick(2,at(18000));rec.touch(at(20000));rec.emit('mark','A',{text:'Synthetic lap: reviewed the boundary input',phase:'code'},at(21000));rec.snapshotAll('submission',at(22000));
  rec.asset('A/submissions/1000/source.cpp',rec.shadow.get('A/A.cpp'));rec.asset('A/submissions/1000/meta.json',JSON.stringify({language:'C++20',id:'1000',url:'https://oj.vnoi.info/submission/1000'}));
  timer.event(session,'sent',at(22000),{problem:'A',submission:'1000',url:'https://oj.vnoi.info/submission/1000',auto:true});rec.emit('sent','A',{submission:'1000',url:'https://oj.vnoi.info/submission/1000',language:'C++20'},at(22000));
  rec.milestone('A','first_submission',at(22000));timer.event(session,'verdict',at(24000),{problem:'A',submission:'1000',text:'AC',auto:true});rec.emit('verdict','A',{submission:'1000',text:'AC'},at(24000));rec.milestone('A','first_AC',at(24000));timer.finish(session,at(30000));rec.emit('session_end',null,{},at(30000));
  const result=exportSession(rec,session,out+'.zip',{now:at(30000),unpacked:out});
  // This specific deliverable is wholly generated. Remove obsolete generated
  // files from older sample formats, confined to this one outputs directory.
  const allowed=new Set([...result.manifest.files.map(f=>f.path),'manifest.json']);
  const expected=path.resolve(__dirname,'../outputs/sample-export-0.7.0');
  if(path.resolve(out)!==expected)throw Error('Unexpected synthetic output directory');
  function clean(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.resolve(dir,item.name);if(!file.startsWith(expected+path.sep))throw Error('Outside synthetic output');if(item.isDirectory())clean(file);else if(item.isFile()&&!allowed.has(path.relative(expected,file).replace(/\\/g,'/')))fs.unlinkSync(file);}}
  clean(expected);
  if(!result.manifest.integrity.ok)throw Error(JSON.stringify(result.manifest.integrity));console.log('synthetic export PASS: outputs/sample-export-0.7.0.zip');return {root,out,rec,session,result};
}
if(require.main===module)generate().catch(error=>{console.error(error);process.exitCode=1;});module.exports={generate};
