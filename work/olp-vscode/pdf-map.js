'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const pdfTask = require('./pdf-task');
const compact = value => value.normalize('NFKD').toLowerCase().replace(/đ/g,'d').replace(/[^a-z0-9]/g,'');
const short = value => value.replace(/^Olympic Sinh Viên \d{4}\s*-\s*Không chuyên\s*-\s*/iu,'');
async function extract(file) {
  if(pdfTask.isolated)return pdfTask.run('extract',{file});
  const assets = path.join(__dirname,'pdf');
  const { getDocument, GlobalWorkerOptions } = await import(pathToFileURL(path.join(assets,'pdf.min.mjs')).href);
  GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(assets,'pdf.worker.min.mjs')).href;
  const task = getDocument({ data:new Uint8Array(await fs.readFile(file)),isEvalSupported:false,cMapUrl:path.join(assets,'cmaps')+path.sep,cMapPacked:true,standardFontDataUrl:path.join(assets,'standard_fonts')+path.sep });
  try {
    const document=await task.promise, pages=[];
    for(let n=1;n<=document.numPages;n++) {
      const page=await document.getPage(n), viewport=page.getViewport({scale:1}), content=await page.getTextContent();
      const rows=require('./pdf-text').rowsFromItems(content.items,viewport),lines=rows.map(r=>r.text);
      pages.push({number:n,text:lines.join('\n'),lines,rows,height:viewport.height});page.cleanup();
    }
    return pages;
  } finally { await task.destroy(); }
}
function detect(pages,problems) {
  const starts = [], used = new Set();
  for(const page of pages) for(const row of page.rows ?? (page.lines ?? page.text.split('\n')).map(text=>({text,y:0}))) {
    const line=row.text;
    const heading=line.match(/^\s*(?:bài|bai|problem)\s*([A-Z]|\d+)\s*[.:\-–]?\s*(.*)$/iu);
    if(/^\s*(?:bài|bai)/iu.test(line)&&!/^\s*(?:bài|bai)\s*(?:[A-Z]|\d+)\s*[.:\-–]/iu.test(line))continue;
    if(!heading || /gi?y|GiB|MiB/i.test(line))continue;
    const title=compact(heading[2]);
    const matches=problems.filter(p=>{const name=compact(short(p.name));return name.length>=4 && (title.startsWith(name)||name.startsWith(title)&&title.length>=8);});
    if(matches.length!==1||used.has(matches[0].key))continue;
    starts.push({key:matches[0].key,start:page.number,top:Math.max(0,row.y-16),name:short(matches[0].name),heading:line.match(/^\s*(?:bài|bai|problem)\s*(?:[A-Z]|\d+)/iu)?.[0].trim(),headingNumber:heading[1],assignment:'automatic'});used.add(matches[0].key);
  }
  starts.sort((a,b)=>a.start-b.start || a.top-b.top);
  const confident=starts.length===problems.length && starts.every((s,i)=>!i||s.start>starts[i-1].start || s.start===starts[i-1].start && s.top>starts[i-1].top);
  if(problems.length===1&&!starts.length) return { confident:true,common:null,problems:{[problems[0].key]:{start:1,end:pages.length,confidence:'single-problem',name:short(problems[0].name)}} };
  const mapping={};
  for(const p of problems) {const i=starts.findIndex(s=>s.key===p.key),s=starts[i];mapping[p.key]=confident?{...s,end:starts[i+1]?.start===s.start?s.start:(starts[i+1]?.start??pages.length+1)-1,bottom:starts[i+1]?.start===s.start?starts[i+1].top:null,confidence:'title-heading'}:{start:1,end:pages.length,confidence:'fallback',name:short(p.name)};}
  return {confident,common:confident&&(starts[0].start>1||starts[0].top>50)?{start:1,end:starts[0].start,top:0,bottom:starts[0].top}:null,problems:mapping};
}
async function prepare(kitRoot,kit) {
  if(pdfTask.isolated&&kit.problems.some(p=>p.pdf)){const prepared=await pdfTask.run('prepare',{kitRoot,kit});for(const p of kit.problems)Object.assign(p,prepared.problems.find(item=>item.key===p.key));return;}
  const groups=new Map();
  for(const p of kit.problems) {try{const bytes=await fs.readFile(path.join(kitRoot,p.key,'De-bai.pdf')),key=require('./recording').sha(bytes);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);}catch{}}
  for(const group of groups.values()) {
    try {
      const pages=await extract(path.join(kitRoot,group[0].key,'De-bai.pdf')),mapping=detect(pages,group);
      for(const p of group) {delete p.pdfWarning;p.pages=mapping.problems[p.key];p.pdfShared=group.length>1;p.commonPages=mapping.common;p.pdfPages=pages.length;await fs.writeFile(path.join(kitRoot,p.key,'statement.txt'),statementText(pages,p));p.statementTextVersion=2;}
      for(const p of group)try{await renderOne(path.join(kitRoot,p.key),p,kit.problems);}catch(error){p.renderWarning=error.message;}
    } catch(error) {for(const p of group)p.pdfWarning='Không tách được PDF: '+error.message;}
  }
  await fs.writeFile(path.join(kitRoot,'pages.json'),JSON.stringify(Object.fromEntries(kit.problems.map(p=>[p.key,{pages:p.pages,common:p.commonPages,warning:p.pdfWarning}])),null,2));
}
function statementText(pages,p){return pages.filter(page=>page.number>=p.pages.start&&page.number<=p.pages.end).map(page=>`[Trang ${page.number}]\n${page.rows.filter(r=>r.y>=(page.number===p.pages.start?p.pages.top??0:0)&&r.y<(page.number===p.pages.end?p.pages.bottom??Infinity:Infinity)).map(r=>r.text).join('\n')}`).join('\n\n');}
// Upgrade text cached by older versions without discarding user-assigned crops.
async function refreshText(kitRoot,kit){
  if(kit.problems.every(p=>p.statementTextVersion===2))return;
  const groups=new Map();
  for(const p of kit.problems)try{const file=path.join(kitRoot,p.key,'De-bai.pdf'),relative=path.relative(await fs.realpath(kitRoot),await fs.realpath(file));if(relative.startsWith('..'+path.sep)||path.isAbsolute(relative))continue;const bytes=await fs.readFile(file),hash=require('./recording').sha(bytes);if(!groups.has(hash))groups.set(hash,[]);groups.get(hash).push(p);}catch{}
  for(const group of groups.values()){
    if(group.every(p=>p.statementTextVersion===2))continue;
    try{
      const pages=await extract(path.join(kitRoot,group[0].key,'De-bai.pdf')),mapping=detect(pages,group);
      for(const p of group){
        if(p.statementTextVersion===2)continue;
        const before=p.pages,detected=mapping.problems[p.key];p.pages=before?{...before,heading:before.heading??detected?.heading??null,headingNumber:before.headingNumber??detected?.headingNumber??null}:detected;
        if(p.rendered&&before&&['start','end','top','bottom'].every(k=>before[k]===p.pages[k]))p.rendered.range=JSON.stringify(p.pages);
        await fs.writeFile(path.join(kitRoot,p.key,'statement.txt'),statementText(pages,p));p.statementTextVersion=2;
      }
    }catch(error){for(const p of group)p.pdfWarning='Không làm mới được văn bản PDF: '+error.message;}
  }
}
async function renderOne(dir,problem,problems) {
  const file=path.join(dir,'De-bai.pdf');
  const content=pdfTask.isolated?await pdfTask.run('render',{file,problem,problems}):await require('./pdf-reader').renderDirect(file,problem,problems),images=[];
  await fs.mkdir(path.join(dir,'statement-pages'),{recursive:true});
  for(const image of content.images){const file='statement-pages/page-'+image.number+'.png';await fs.writeFile(path.join(dir,file),Buffer.from(image.uri.split(',')[1],'base64'));images.push({number:image.number,file});}
  delete problem.renderWarning;problem.rendered={range:JSON.stringify(problem.pages),images};
}
module.exports={extract,detect,prepare,refreshText,renderOne,short};
