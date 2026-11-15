'use strict';
const { renderStatement, shortName } = require('./pdf-reader');
const { randomBytes } = require('node:crypto');
const escape = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clock=ms=>{const seconds=Math.floor(Math.max(0,ms)/1000);return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(n=>String(n).padStart(2,'0')).join(':');};
function pageLabel(problem,images){const first=problem.pages?.start??Math.min(...images.map(p=>p.number)),last=problem.pages?.end??Math.max(...images.map(p=>p.number));return 'trang '+first+(last===first?'':'–'+last)+(problem.pdfShared||problem.commonPages?' của PDF chung':' của PDF gốc');}
function makeStatementView(vscode) {
  const panels=new Map(),reading=new Map();let observe=()=>{},active,request=0;
  const show=async (file,problem,problems,onRead,{quiet=false}={})=>{
    const sequence=++request;
    const key=file+'|'+problem.key+'|'+JSON.stringify(problem.pages);
    let entry=panels.get(key);
    if(!entry){
      entry={problem:problem.key,onRead};panels.set(key,entry);
      entry.loading=renderStatement(file,problem,problems).then(content=>{entry.content=content;}).catch(error=>{panels.delete(key);throw error;});
    }
    entry.onRead=onRead;await entry.loading;if(!panels.has(key)||sequence!==request)return;
    await vscode.commands.executeCommand('vscode.setEditorLayout',{orientation:0,groups:[{}]});
    if(sequence!==request)return;
    if(!entry.panel){
        const panel=vscode.window.createWebviewPanel('olp.statement',problem.key==='common'?'Trang chung':problem.key+' · '+shortName(problem.name),{viewColumn:1,preserveFocus:true},{enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[]});
        entry.panel=panel;panel.webview.html=html(panel.title,entry.content,problem.pages?.confidence==='fallback'||Boolean(problem.pdfWarning),problem,reading.get(problem.key)??0);
        panel.onDidDispose(()=>{panels.delete(key);if(active===entry)active=undefined;observe('state',entry.problem,{active:false});});
        panel.onDidChangeViewState(({webviewPanel:p})=>{if(p.active&&p.visible){active=entry;void entry.onRead?.();}else if(active===entry)active=undefined;observe('state',entry.problem,{active:p.active&&p.visible});});
        panel.webview.onDidReceiveMessage(message=>{
          if(!panel.active||!panel.visible)return;
          if(message?.type==='pages'&&Array.isArray(message.pages))observe('pages',entry.problem,{pages:message.pages.filter(p=>Number.isInteger(p)&&p>=1&&p<=10000).slice(0,20)});
          if(message?.type==='touch')observe('touch',entry.problem,{});
          if(message?.type==='assign')observe('assign',entry.problem,{});
          if(message?.type==='ready')void panel.webview.postMessage?.({type:'reading',ms:reading.get(entry.problem)??0});
        });
    }
    entry.panel.reveal(1,quiet);
    if(entry.panel.active&&entry.panel.visible){active=entry;void entry.onRead?.();observe('state',entry.problem,{active:true});}
  };
  return Object.assign(show,{setReading:(problem,ms)=>{reading.set(problem,ms);for(const entry of panels.values())if(entry.problem===problem&&entry.panel?.active&&entry.panel.visible)void entry.panel.webview.postMessage?.({type:'reading',ms});},cancelReveal:()=>{request++;},close:()=>{request++;for(const e of panels.values())e.panel?.dispose();panels.clear();active=undefined;},problem:()=>active?.problem,active:()=>Boolean(active?.panel?.active&&active.panel.visible),observe:fn=>{observe=fn;},invalidate:()=>{request++;for(const e of panels.values())e.panel?.dispose();panels.clear();active=undefined;}});
}
function html(title,{images,shared},fallback,problem,reading){
  const nonce=randomBytes(16).toString('hex');
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'"><style>
body{margin:0;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font:14px/1.5 var(--vscode-font-family)}header{position:sticky;top:0;padding:10px 22px;background:var(--vscode-editor-background);border-bottom:1px solid var(--vscode-panel-border);display:flex;justify-content:space-between;gap:20px;z-index:1}h1{font-size:15px;margin:0}main{max-width:930px;margin:auto;padding:16px 24px}figure{margin:0 0 24px}img{display:block;width:100%;height:auto;background:white}figcaption{font-size:12px;text-align:right;color:var(--vscode-descriptionForeground)}.notice{padding:12px;border-left:3px solid var(--vscode-editorWarning-foreground)}
header{flex-wrap:wrap;gap:6px 20px}.meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;margin-top:3px;font-size:12px;color:var(--vscode-descriptionForeground)}#reading{font-variant-numeric:tabular-nums}button{font:inherit;border:0;padding:2px 8px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);cursor:pointer}button:hover{background:var(--vscode-button-secondaryHoverBackground)}
</style></head><body><header><div><h1>${escape(title)}</h1><div class="meta"><span>${escape(pageLabel(problem,images))}</span><span>Đọc đề: <span id="reading">${clock(reading)}</span></span>${fallback?'<button id="assign" type="button">Gán trang đề</button>':''}</div></div><span>Ctrl+Alt+D · Quay lại mã</span></header><main>${fallback||shared?'<p class="notice">Đang hiển thị PDF đầy đủ. Dùng OLP: Gán trang đề để chọn trang cho từng bài.</p>':''}${images.map(({number,uri})=>`<figure data-page="${number}"><img src="${uri}" alt="Trang ${number}"><figcaption>Trang ${number} của PDF gốc</figcaption></figure>`).join('')}</main><script nonce="${nonce}">
const vscode=acquireVsCodeApi();let timer;const visible=new Set();const send=()=>{clearTimeout(timer);timer=setTimeout(()=>vscode.postMessage({type:'pages',pages:[...visible].sort((a,b)=>a-b)}),250);};const observer=new IntersectionObserver(entries=>{for(const e of entries){const n=Number(e.target.dataset.page);if(e.isIntersecting)visible.add(n);else visible.delete(n);}send();},{threshold:0.01});document.querySelectorAll('figure').forEach(e=>observer.observe(e));let touched=0;for(const name of ['pointerdown','keydown','wheel','scroll'])addEventListener(name,()=>{if(Date.now()-touched>500){touched=Date.now();vscode.postMessage({type:'touch'});}},{passive:true});
addEventListener('message',event=>{if(event.data?.type==='reading'){const seconds=Math.floor(Math.max(0,Number(event.data.ms)||0)/1000);document.getElementById('reading').textContent=[Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(n=>String(n).padStart(2,'0')).join(':');}});document.getElementById('assign')?.addEventListener('click',()=>vscode.postMessage({type:'assign'}));vscode.postMessage({type:'ready'});
</script></body></html>`;
}
module.exports={makeStatementView,pageLabel,clock};
