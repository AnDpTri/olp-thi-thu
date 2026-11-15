'use strict';

// Model-level API checks. These are not a substitute for the real VS Code host / screenshots.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { makeLayout } = require('./olp-vscode/layout');
class Text { constructor(uri) { this.uri = uri; } }
class Diff { constructor(original, modified) { this.original = original; this.modified = modified; } }
const uri = name => ({ name, toString() { return name; } });
const groups = [];
let focused;
let layoutCalls = 0;
let editorFocusCalls = 0;
const fake = {
  TabInputText: Text, TabInputTextDiff: Diff,
  workspace: { textDocuments: [] },
  window: {
    tabGroups: { all: groups, async close(tabs) {
      for (const group of groups) group.tabs = group.tabs.filter(tab => !tabs.includes(tab));
    } },
    async showTextDocument(file, { viewColumn, preserveFocus }) {
      const group = groups[viewColumn - 1];
      if (!group.tabs.some(tab => tab.input instanceof Text && tab.input.uri.name === file.name)) {
        group.tabs.push({ input: new Text(file) });
      }
      if (!preserveFocus) focused = file.name;
    }
  },
  commands: { async executeCommand(name, plan) {
    if (name === 'workbench.action.focusActiveEditorGroup') { editorFocusCalls++; return; }
    assert.equal(name, 'vscode.setEditorLayout');
    layoutCalls++;
    const leaves = node => node.groups ? node.groups.flatMap(leaves) : [node];
    const count = leaves(plan).length;
    while (groups.length < count) groups.push({ viewColumn: groups.length + 1, tabs: [] });
    while (groups.length > count) groups[count - 1].tabs.push(...groups.pop().tabs);
  } }
};
const layout = makeLayout(fake);
const isKit = file => /^[ABCD]\//.test(file.name);
const open = (key, statement) => layout.arrange({
  isKit, solution: uri(key + '/code'), input: uri(key + '/input'), output: uri(key + '/output'), statement
});
const names = () => groups.map(group => group.tabs.map(tab => tab.input instanceof Text ? tab.input.uri.name : 'WEB'));
const tests = [];
const test = (name, body) => tests.push([name, body]);
test('plain layout focuses source, retains unrelated files, closes stale kit tabs', async () => {
  await open('A');
  assert.deepEqual(names(), [['A/code'], ['A/input'], ['A/output']]);
  assert.equal(focused, 'A/code');
  assert.equal(editorFocusCalls, 1, 'layout must explicitly focus the editor widget');
  groups[0].tabs.push({ input: new Text(uri('notes.md')) });
  await open('B');
  assert.deepEqual(names(), [['notes.md', 'B/code'], ['B/input'], ['B/output']]);
  assert.equal(focused, 'B/code');
  assert.equal(layoutCalls, 1, 'same layout reuses groups');
});
test('focus source after a run without rearranging groups', async () => {
  const before = layoutCalls, focusedBefore = editorFocusCalls;
  focused = 'B/output';
  await layout.focusSolution(uri('B/code'));
  assert.equal(focused, 'B/code');
  assert.equal(layoutCalls, before);
  assert.equal(editorFocusCalls, focusedBefore + 1);
});
test('output refresh writes LF once and awaits one buffer reload', async () => {
  const { writeOutput } = require('./olp-vscode/output-writer');
  const file = { fsPath: 'output.txt', toString: () => 'output.txt' };
  let content = '', writes = 0, reloads = 0;
  const document = { uri: file, getText: () => content, isDirty: false };
  await writeOutput({ textDocuments: [document] }, file, '5\n', { write: async (name, text) => {
    writes++; assert.equal(name, 'output.txt'); assert.equal(text, '5\n');
    setTimeout(() => { content = text; reloads++; }, 30);
  } });
  assert.equal(writes, 1); assert.equal(reloads, 1); assert.equal(content, '5\n');
  await assert.rejects(writeOutput({textDocuments:[document]},file,'6\n',{write:async()=>{},timeoutMs:1}),/output.txt/);
});
test('working layout never auto-opens a statement', async () => {
  let called=false;await open('A',()=>{called=true;});
  assert.equal(called,false);assert.equal(groups.length,3);
  assert.deepEqual(names(),[['notes.md','A/code'],['A/input'],['A/output']]);
});
let renders=new Map(),panels=[],reads=0,renderCount=0;
const moduleMock={exports:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'olp-vscode/statement-view.js'),'utf8'),{
  module:moduleMock,require(name){if(name==='./pdf-reader')return{shortName:n=>n,renderStatement:file=>{renderCount++;return new Promise(resolve=>renders.set(file,resolve));}};return require(name);}
});
const show=moduleMock.exports.makeStatementView({commands:{async executeCommand(name,plan){assert.equal(name,'vscode.setEditorLayout');assert.equal(plan.groups.length,1);}},window:{createWebviewPanel(type,title,options,webviewOptions){
 const panel={title,options,webviewOptions,active:false,visible:true,messages:[],webview:{onDidReceiveMessage(fn){panel.message=fn;},postMessage(message){panel.messages.push(message);return Promise.resolve(true);}},
 onDidDispose(fn){this.disposed=fn;},onDidChangeViewState(fn){this.state=fn;},dispose(){this.disposed?.();},reveal(column,preserveFocus){for(const p of panels)p.active=false;this.column=column;this.preserveFocus=preserveFocus;this.active=!preserveFocus;this.state?.({webviewPanel:this});}};panels.push(panel);return panel;
}}});
const content={images:[{number:1,uri:'data:image/png;base64,test'}],shared:false};
test('quiet rendering does not claim reading; real active/visible state does',async()=>{
 const loading=show('A.pdf',{key:'A',name:'<A>'},[],()=>reads++,{quiet:true});renders.get('A.pdf')(content);await loading;const panel=panels.at(-1);
 assert.equal(reads,0);assert.equal(show.problem(),undefined);assert(panel.webview.html.includes('&lt;A&gt;'));assert(panel.webviewOptions.retainContextWhenHidden);panel.active=true;panel.state({webviewPanel:panel});assert.equal(reads,1);assert.equal(show.problem(),'A');
});
test('late render cannot create a panel or steal newer statement focus',async()=>{
 const b=show('B.pdf',{key:'B',name:'B'},[],()=>{});const c=show('C.pdf',{key:'C',name:'C'},[],()=>{});renders.get('C.pdf')(content);await c;renders.get('B.pdf')(content);await b;
 assert.equal(show.problem(),'C');assert.equal(panels.at(-1).title,'C \u00b7 C');assert.equal(panels.length,2);
});
test('cached statement retains rendered webview and does not render again',async()=>{
 const count=renderCount,panel=panels.at(-1);await show('C.pdf',{key:'C',name:'C'},[],()=>{});assert.equal(renderCount,count);assert.equal(panels.at(-1),panel);
});
test('close cancels pending render without recreating a panel',async()=>{
 const loading=show('D.pdf',{key:'D',name:'D'},[],()=>{});const count=panels.length;show.close();renders.get('D.pdf')(content);await loading;assert.equal(panels.length,count);assert.equal(show.problem(),undefined);
});
test('statement header shows page range, reading clock and fallback assignment action',async()=>{
 const observed=[];show.observe((type,key,data)=>observed.push({type,key,data}));show.setReading('F',65000);
 const loading=show('F.pdf',{key:'F',name:'Fallback',pages:{start:1,end:7,confidence:'fallback'},pdfShared:true},[],()=>{});renders.get('F.pdf')(content);await loading;const panel=panels.at(-1);
 assert(panel.webview.html.includes('trang 1–7 của PDF chung'));assert(panel.webview.html.includes('00:01:05'));assert(panel.webview.html.includes('id="assign"'));panel.message({type:'assign'});assert(observed.some(e=>e.type==='assign'&&e.key==='F'));show.setReading('F',66000);assert.equal(panel.messages.at(-1).ms,66000);
});
(async () => {
  let failed = 0;
  for (const [name, body] of tests) {
    try { await body(); console.log('ok ' + name); }
    catch (error) { failed++; console.error('FAIL ' + name, error); }
  }
  console.log('layout-view model ' + (failed ? 'FAIL ' + failed : 'PASS ' + tests.length));
  process.exitCode = failed ? 1 : 0;
})();
