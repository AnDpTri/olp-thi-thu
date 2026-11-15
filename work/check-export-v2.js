'use strict';
const assert=require('node:assert/strict');
const ms=value=>{const m=value.match(/^(\d+):(\d+):(\d+)\.(\d{3})$/);assert(m,'Expected millisecond duration, got '+value);return ((+m[1]*60+ +m[2])*60+ +m[3])*1000+ +m[4];};
function report(report,summary){
  for(const [key,p]of Object.entries(summary.problems)){
    const row=report.split('\n').find(s=>s.startsWith('| '+key+' · '));assert(row,'Missing measured report row '+key);
    const cells=row.split('|').slice(1,-1).map(s=>s.trim());
    assert.equal(ms(cells[1]),p.totalMs,'report total '+key);
    const values=[['statement',5,p.timeMs.statement],['code',6,p.timeMs.code],['input',7,p.timeMs.input+p.timeMs.output],['none',8,p.timeMs.none],['other-file',13,p.timeMs['other-file']],['outside',14,p.timeMs.outside],['idle',15,p.timeMs.idle]];
    for(const [category,i,value]of values)if(summary.unavailableTimingCategories?.includes(category))assert.equal(cells[i],'—');else assert.equal(ms(cells[i]),value,'report category '+category+' '+key);
    assert.equal(values.reduce((n,[,i])=>n+(cells[i]==='—'?0:ms(cells[i])),0),p.totalMs);
  }
}
function check(files){
 const json=name=>JSON.parse(files.get(name)),manifest=json('manifest.json'),summary=json('summary.json');
 assert.equal(manifest.schemaVersion,2);assert(!('durationMs'in manifest.session));assert.equal(manifest.session.elapsedMs,summary.elapsedMs);assert.equal(manifest.session.limitMs,summary.limitMs);assert(['manual','expired',null].includes(manifest.session.endReason));assert(manifest.session.startedAt);
 assert.equal(manifest.legacy,summary.legacy);if(manifest.legacy)assert(manifest.missingData.length>0,'Legacy coverage must be explicit');
 assert.equal(Object.values(summary.problems).reduce((n,p)=>n+p.totalMs,summary.unassigned.totalMs),summary.elapsedMs);
 for(const p of [summary.overall,summary.unassigned,...Object.values(summary.problems)])assert.equal(Object.values(p.timeMs).reduce((n,v)=>{assert(Number.isInteger(v));return n+v;},0),p.totalMs);
 for(const [name,data]of files)assert(data.length,'Empty physical file '+name);
 report(files.get('report.md').toString(),summary);
 const table=require('./olp-vscode/observations').summaryMarkdown(summary);assert.equal(files.get('summary.md').toString(),table);assert(files.get('report.md').toString().includes(table));
 assert(files.has('SCHEMA.md'));assert(files.has('timeline/timeline.md'));
 for(const p of manifest.problems){const s=summary.problems[p.key];for(const field of ['key','name','vnojCode','url','originalHeading','originalNumber','language','finalVerdict','bestScore','submissionsCount'])assert.deepEqual(p[field],s[field],field);const statement=json('problems/'+p.key+'/statement.json');if(statement.source)assert(files.has(statement.source),'Missing statement source');assert(files.has('problems/'+p.key+'/worklog.md'));assert(p.samples.every(s=>['vnoj-html','companion','user-added','unknown'].includes(s.samplesSource)));}
 const pdfs=manifest.problems.map(p=>p.statement.source).filter(Boolean);if(new Set(pdfs).size<pdfs.length)assert(pdfs.some(p=>p.startsWith('statement/')));
 for(const [old,ref]of Object.entries(manifest.artifacts))if(ref.state==='empty')assert.equal(ref.path,null);else if(ref.state==='stored')assert(files.has(ref.path),'Missing resolved artifact '+old);
 for(const [name,data]of files)if(/\/runs\/.*\/meta.json$/.test(name)){assert(/\/run-\d{3,}-/.test(name));const meta=JSON.parse(data);assert('compile'in meta);for(const ref of Object.values(meta.refs))if(ref.state==='empty')assert.equal(ref.path,null);else assert(files.has(ref.path));}
 return {manifest,summary};
}
module.exports={check,report,ms};
