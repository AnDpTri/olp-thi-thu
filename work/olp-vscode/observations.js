'use strict';
const timer=require('./session');
const categories=['statement','code','input','output','other-file','none','outside','idle'];
const duration=ms=>timer.clock(ms)+'.'+String(Math.max(0,Math.floor(ms))%1000).padStart(3,'0');
const clean=v=>String(v??'').replace(/[\r\n|]/g,' ');
const legacyLabel='phiên cũ – không có nhật ký chi tiết';
function legacyActivities(session,cutoff){
  const rows=[];let problem=null;
  for(const e of [...(session.events??[])].sort((a,b)=>a.at-b.at)){
    const t=Math.max(0,Math.floor(e.at-session.start));if(t>=cutoff)continue;
    if(e.type==='focus'){problem=e.problem;rows.push({t,seq:-2,problem,category:'none',estimated:true});}
    if(e.type==='phase'){problem=e.problem;rows.push({t,seq:-2,problem,category:({analysis:'statement',coding:'code',testing:'input'})[e.phase]??'none',estimated:true});}
  }
  return rows;
}
function identity(p,standing={},events=[]){
  const last=events.findLast(e=>e.type==='verdict'&&e.problem===p.key);
  return {sourceFile:p.key+'/'+p.source,key:p.key,name:p.name??p.key,vnojCode:p.url?.match(/\/problem\/([^/?#]+)/)?.[1]??null,url:p.url??null,originalHeading:p.pages?.heading??null,originalNumber:p.pages?.headingNumber??null,language:({cpp:'C++',c:'C',py:'Python',java:'Java'})[p.source?.split('.').at(-1)]??null,finalVerdict:last?.text??standing.best?.text??null,bestScore:standing.best?.points??null,accepted:Boolean(standing.best?.ac),submissionsCount:standing.sent??0};
}
function metrics(events,edits,session,now){
  const end=Math.max(0,Math.floor(Math.min(session.end??now,session.deadline)-session.start));
  const empty=()=>({totalMs:0,timeMs:Object.fromEntries(categories.map(k=>[k,0])),milestones:{},laps:[],runs:0,sampleRuns:{pass:0,fail:0},sampleResults:{total:0,pass:0,fail:0,verdicts:{}},compileErrors:0,submissions:[],verdicts:[],typing:{inserted:0,deleted:0,pasteLike:0,undo:0,redo:0},minutes:{},idleGaps:[]});
  const problems=Object.fromEntries(session.kit.problems.map(p=>[p.key,empty()])),overall=empty(),unassigned=empty(),visits=[];
  const journal=(session.events??[]).map(e=>({...e,t:Math.max(0,Math.floor(e.at-session.start))}));
  const first=events.find(e=>e.type==='session_start')?.t??events.find(e=>e.type==='activity')?.t;
  // Normal recording can start a few ms after timer.start while VS Code saves
  // state. That bootstrap delay is not evidence of a pre-upgrade session.
  const legacy=journal.length>0&&(first===undefined||!session.recordingVersion&&first>0&&(!Number.isFinite(session.duration)||journal.some(e=>['focus','phase'].includes(e.type)&&e.t<first))),legacyPrefixMs=legacy?Math.min(end,first??end):0,legacyOnly=legacy&&legacyPrefixMs===end;
  const unavailableTimingCategories=legacyOnly?['output','other-file','outside','idle']:[];
  const activities=[{t:0,seq:-3,problem:null,category:'none'},...legacyActivities(session,legacyPrefixMs),...(legacyPrefixMs<end&&legacy?[{t:legacyPrefixMs,seq:-1,problem:null,category:'none'}]:[]),...events.filter(e=>e.type==='activity'&&e.t<=end)].sort((a,b)=>a.t-b.t||a.seq-b.seq);
  for(let i=0;i<activities.length;i++){
    const e=activities[i],start=Math.max(0,Math.floor(e.t)),stop=Math.min(end,Math.floor(activities[i+1]?.t??end)),ms=Math.max(0,stop-start),category=categories.includes(e.category)?e.category:'none';
    if(!ms)continue;
    for(const target of [overall,problems[e.problem]??unassigned]){
      target.totalMs+=ms;target.timeMs[category]+=ms;
      if(category==='idle')target.idleGaps.push({start,end:stop,ms});
      for(let m=Math.floor(start/60000);m<=Math.floor(stop/60000);m++){const n=Math.max(0,Math.min(stop,(m+1)*60000)-Math.max(start,m*60000));if(n){target.minutes[m]??={};target.minutes[m][category]=(target.minutes[m][category]??0)+n;}}
    }
    visits.push({t:start,end:stop,problem:problems[e.problem]?e.problem:null,category,...(e.estimated?{estimated:true}:{})});
  }
  const canonicalType=t=>t==='compile'?'compile_result':t;
  const records=legacy?[...journal.filter(e=>(legacyOnly||e.t<legacyPrefixMs)&&!events.some(r=>r.problem===e.problem&&r.t===e.t&&canonicalType(r.type)===canonicalType(e.type))),...events]:events.length?events:journal;
  for(const e of records)for(const target of [overall,problems[e.problem]??unassigned]){
    if(e.type==='milestone')target.milestones[(e.problem?e.problem+':':'')+e.name]=e.t;
    if(e.type==='mark')target.laps.push({t:e.t,problem:e.problem,phase:e.phase??null,label:e.text??''});
    if(e.type==='run')target.runs++;
    if(e.type==='samples')target.sampleRuns[e.total>0&&e.total===e.passed?'pass':'fail']++;
    if(e.type==='sample_result'){target.sampleResults.total++;target.sampleResults[e.verdict==='ĐÚNG'?'pass':'fail']++;target.sampleResults.verdicts[e.verdict]=(target.sampleResults.verdicts[e.verdict]??0)+1;}
    if(e.type==='compile_result'&&!e.ok||e.type==='compile')target.compileErrors++;
    if(e.type==='sent')target.submissions.push({t:e.t,id:e.submission,url:e.url,language:e.language??null});
    if(e.type==='verdict'){target.verdicts.push({t:e.t,id:e.submission,verdict:e.text});if(/^AC(?:$|\s)/.test(e.text)&&target.firstAC===undefined)target.firstAC=e.t;}
  }
  for(const e of edits.filter(e=>e.type==='edit'&&e.reason!=='external'&&!e.generated))for(const target of [overall,problems[e.problem]??unassigned]){
    for(const c of e.changes){target.typing.inserted+=c.text.length;target.typing.deleted+=c.removed;if(c.pasteLike)target.typing.pasteLike++;}if(e.undo)target.typing.undo++;if(e.redo)target.typing.redo++;
  }
  const standing=timer.standing(session);
  for(const p of session.kit.problems){const target=problems[p.key];Object.assign(target,identity(p,standing[p.key],records));target.result=standing[p.key];target.submissionsCount=Math.max(target.submissions.length,target.submissionsCount);}
  overall.result={board:timer.board(session),acceptedProblems:Object.values(standing).filter(p=>p.best?.ac).length};
  for(const target of [overall,unassigned,...Object.values(problems)]){target.idleGaps.sort((a,b)=>b.ms-a.ms);target.activityStrip=Object.entries(target.minutes).map(([minute,ms])=>({minute:Number(minute),category:Object.keys(ms).sort((a,b)=>ms[b]-ms[a])[0],ms}));}
  return {synthetic:Boolean(session.synthetic),legacy,legacyOnly,legacyPrefixMs,unavailableTimingCategories,durationMs:end,elapsedMs:end,limitMs:session.deadline-session.start,timingCoverage:legacy?(legacyOnly?'legacy-journal':'partial-legacy-journal'):'recorded',overall,unassigned,problems,visits};
}
function summaryMarkdown(summary){
  const lines=['# Tóm tắt phiên'+(summary.synthetic?' — SYNTHETIC / DỮ LIỆU GIẢ LẬP':''),'','Thời lượng '+duration(summary.elapsedMs)+' / '+duration(summary.limitMs)+'; cùng dữ liệu với report.md và summary.json.','','| Bài | Tổng | Đọc đề | Viết mã | Input | Output | Tệp khác | Chưa gán | Ngoài VS Code | Không thao tác | Chạy | Lượt mẫu đúng/sai | Từng mẫu đúng/sai |','| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |'];
  if(summary.legacy){lines.splice(2,0,legacyLabel+'; '+(summary.legacyOnly?'thời gian theo bài/phase được tính theo các mốc cũ. Idle/ngoài VS Code không biết (—), không phải bằng 0.':'phần trước '+duration(summary.legacyPrefixMs)+' tính theo mốc cũ; phần sau dùng quan sát mới.'));lines[lines.length-2]=lines[lines.length-2].replace('| Input |','| Input / I/O cũ (gộp) |');}
  for(const [key,p] of [...Object.entries(summary.problems),['Không gán bài',summary.unassigned],['Toàn phiên',summary.overall]])lines.push('| '+[key,duration(p.totalMs),...categories.map(k=>summary.unavailableTimingCategories?.includes(k)?'—':duration(p.timeMs[k])),p.runs,p.sampleRuns.pass+'/'+p.sampleRuns.fail,p.sampleResults.pass+'/'+p.sampleResults.fail].join(' | ')+' |');
  lines.push('','Đơn vị hiển thị HH:MM:SS.mmm, dữ liệu gốc là ms nguyên. Tổng các loại của một bài bằng Tổng; tổng các bài + Không gán bài bằng thời lượng phiên. Lượt mẫu là batch; Từng mẫu là kết quả từng test. Mốc AC tính từ đầu phiên, không phải đồng hồ riêng của bài.','','Mốc tự động (ms từ đầu phiên):','```json',JSON.stringify(Object.fromEntries(Object.entries(summary.problems).map(([k,p])=>[k,p.milestones])),null,2),'```');
  return lines.join('\n')+'\n';
}
const reportMarkdown=(session,summary,now)=>timer.markdown(session,now,undefined,summary);
module.exports={categories,duration,identity,metrics,summaryMarkdown,reportMarkdown,clean,legacyLabel};
