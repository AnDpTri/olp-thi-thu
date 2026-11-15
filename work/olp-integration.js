'use strict';

const assert = require('node:assert/strict');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const vscode = require('vscode');
const { ui } = require('./test-boundary');
const {createMock}=require('./mock-vnoj');

const base = Date.parse('2026-11-14T07:00:00Z');
const deadline = base + 180 * 60 * 1000;
const at = seconds => { ui.now = base + seconds * 1000; };
const command = (name, ...args) => vscode.commands.executeCommand('olp.' + name, ...args);
const url = 'https://oj.vnoi.info/contest/olp_kc25';
const first = 'https://oj.vnoi.info/problem/olp_kc25_cpencils';
const second = 'https://oj.vnoi.info/problem/olp_kc25_delivery';

exports.run = async function () {
  const root = vscode.workspace.workspaceFolders[0].uri;
  const artifact = join(root.fsPath, 'test-metadata.json');
  const check = join(root.fsPath, process.env.OLP_TEST_PHASE + '.result');
  const mock=await createMock('https://oj.vnoi.info').start(),realFetch=globalThis.fetch,network=[];mock.control.practice=true;let injected=false;
  globalThis.fetch=async(input,init)=>{const url=new URL(typeof input==='string'?input:input.url??String(input));if(url.origin!=='https://oj.vnoi.info')return realFetch(input,init);const entry={method:init?.method??'GET',path:url.pathname};network.push(entry);assert.equal(entry.method,'GET','Practice fixture must never POST to VNOJ');try{if(!injected&&url.pathname==='/contest/olp_kc25'){injected=true;throw new TypeError('fetch failed',{cause:Object.assign(new Error('Synthetic connection reset'),{code:'ECONNRESET'})});}const response=await realFetch(mock.origin+url.pathname+url.search,init);entry.status=response.status;return response;}catch(error){entry.cause=error.cause?.code??error.code??error.name;throw error;}};
  try {
    if (process.env.OLP_TEST_PHASE === 'restore') ui.now = deadline + 60000;
    await vscode.extensions.getExtension('olp-local.olp-practice').activate();
    await vscode.workspace.getConfiguration('olp').update('export.auto',false,vscode.ConfigurationTarget.Global);
    if (process.env.OLP_TEST_PHASE === 'restore') {
      await command('copy');
      const kit = JSON.parse(readFileSync(artifact, 'utf8')).expiringKit;
      const report = await readReport(kit);
      assert.equal(report, ui.clipboard);
      assert.match(report, /Thời lượng 03:00:00\.000 \/ 03:00:00\.000/);
      // 0.6.0: báo cáo dùng giờ địa phương (máy thử ở UTC+07:00) thay vì UTC.
      assert.match(report, /\|\s+\+03:00:00\.\d{3}\s+\|\s+2026-11-14 17:00:00\s+\|\s+—\s+\|\s+Hết giờ/);
      assert.match(report, /UTC\+07:00/);
      assert.equal((report.match(/Hết giờ/g) ?? []).length, 1);
      assert(ui.warnings.some(message => message.includes('Hết 180 phút')));
    } else {
      ui.inputs.push(url);
      ui.picks.push(items => items[0]);
      await command('import');
      assert.deepEqual(ui.errors, []);
      assert.equal(network.filter(e=>e.path==='/contest/olp_kc25').length,2,'Public GET must retry exactly once after injected ECONNRESET');
      const [kit] = (await folders(root));
      assert(kit);
      for (const key of ['A', 'B', 'C', 'D']) {
        const pdf = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(kit, key, 'De-bai.pdf'));
        assert.match(Buffer.from(pdf.subarray(0, 5)).toString(), /^%PDF-$/);
        for (const file of ['input.txt', 'output.txt']) {
          assert.equal((await vscode.workspace.fs.readFile(vscode.Uri.joinPath(kit, key, file))).length, 0);
        }
      }
      at(0);
      await command('start');
      at(9);
      const problemA = { problem: { key: 'A', url: first } };
      await command('statement', problemA);
      await command('copy');
      assert.match(ui.clipboard, /\+00:00:09.*A.*Chuyển bài/);
      assert.match(ui.clipboard, /\+00:00:09.*A.*Đọc \/ phân tích đề/);
      assert.equal(ui.opened.length, 0);
      assert(vscode.window.tabGroups.all.some(group =>
        group.tabs.some(tab => tab.label === 'A · Bút chì màu' && tab.input instanceof vscode.TabInputWebview)));
      at(19);
      await command('source', 'A');
      const editor = vscode.window.activeTextEditor;
      const source = '// mã dùng cho kiểm thử cục bộ\n';
      assert(await editor.edit(edit => edit.insert(new vscode.Position(0, 0), source)));
      at(23);
      await command('submitBrowser');
      assert.equal(ui.clipboard, editor.document.getText());
      assert(ui.clipboard.replace(/\r\n/g, '\n').startsWith(source));
      assert.match(ui.clipboard, /sync_with_stdio/); // t?p m?i ch?a template t? 0.6.0
      assert(await editor.document.save());
      assert.deepEqual(ui.opened, [first + '/submit']);
      await command('copy');
      assert.match(ui.clipboard, /\+00:00:23.*A.*Mở trang nộp/);
      assert.doesNotMatch(ui.clipboard, /Đã nộp \(tự xác nhận\)/);
      at(30);
      await command('sent');
      at(32);
      ui.picks.push(() => 'AC');
      await command('verdict');
      at(68);
      await command('source', 'B');
      await command('copy');
      assert.match(ui.clipboard, /\+00:01:08.*B.*Chuyển bài/);
      const problemB = { problem: { key: 'B', url: second } };
      at(75);
      await command('analysis', problemB);
      at(81);
      const output = vscode.Uri.joinPath(kit, 'B', 'output.txt');
      await vscode.workspace.fs.writeFile(output, Buffer.from('107\n'));
      await command('testFile', 'B', 'output');
      const reloadDeadline=Date.now()+5000;while(vscode.window.activeTextEditor.document.getText()!=='107\n'&&Date.now()<reloadDeadline)await new Promise(resolve=>setTimeout(resolve,50));
      assert.equal(vscode.window.activeTextEditor.document.getText(), '107\n');
      at(90);
      await command('source', 'B');
      at(100);
      ui.picks.push(items => items.at(-1));
      ui.inputs.push('40/100');
      await command('verdict', problemB);
      at(149);
      await command('end');
      await command('copy');
      const report = await readReport(kit.fsPath);
      assert.equal(report, ui.clipboard);
      assert.match(report, /Thời lượng 00:02:29\.000 \/ 03:00:00\.000/);

      const session=require('./test-boundary').context.workspaceState.get('olp.practice.v1').sessions.at(-1);
      const logDir=join(kit.fsPath,'.olp',session.id),rows=name=>require('node:fs').existsSync(join(logDir,name+'.jsonl'))?readFileSync(join(logDir,name+'.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
      const observed=require('./olp-vscode/archive').metrics(rows('events'),rows('edits'),session,base+149000);
      require('./check-export-v2').report(report,observed);
      assert.equal(observed.problems.A.finalVerdict,'AC');assert.equal(observed.problems.B.finalVerdict,'40/100');

      await receiveCompanion(root);
      const expiringKit = (await folders(root)).find(item => item.fsPath !== kit.fsPath);
      assert(expiringKit);
      const sample = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(expiringKit, 'A', 'mau-1.in'));
      assert.equal(Buffer.from(sample).toString(), '42\n');
      const input = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(expiringKit, 'A', 'input.txt'));
      const outputSample = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(expiringKit, 'A', 'output.txt'));
      assert.equal(Buffer.from(input).toString(), '42\n');
      // 0.6.0: output.txt là kết quả lần chạy gần nhất nên bắt đầu trống; kết quả mong đợi chỉ nằm ở mau-1.out.
      assert.equal(Buffer.from(outputSample).toString(), '');
      assert.equal(Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(expiringKit, 'A', 'mau-1.out'))).toString(), '7\n');
      at(0);
      await command('start');
      writeFileSync(artifact, JSON.stringify({ expiringKit: expiringKit.fsPath }));
    }
    assert.deepEqual(ui.errors, []);
    writeFileSync(check, 'PASS');
  } catch (error) {
    writeFileSync(check, error.stack + '\n' + JSON.stringify({errors:ui.errors,network,cause:error.cause?.code??error.code},null,2));
    throw error;
  } finally {
    writeFileSync(join(root.fsPath,'network.log'),network.map(e=>JSON.stringify(e)).join('\n')+'\n');globalThis.fetch=realFetch;mock.stop();
  }
};

async function folders(root) {
  return (await vscode.workspace.fs.readDirectory(root))
    .filter(([name, type]) => name.startsWith('OLP-') && type === vscode.FileType.Directory)
    .map(([name]) => vscode.Uri.joinPath(root, name));
}

async function readReport(folder) {
  const root = vscode.Uri.file(folder);
  const [report] = (await vscode.workspace.fs.readDirectory(root)).filter(([name]) => /^phien-.*\.md$/.test(name));
  assert(report);
  return Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, report[0]))).toString();
}

async function receiveCompanion(root) {
  const importPromise = command('companion');
  let response;
  for (let attempt = 0; attempt < 30 && !response; attempt++) {
    response = await fetch('http://127.0.0.1:27177/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'chrome-extension://test' },
      body: JSON.stringify({ url: first, name: 'Bài A', tests: [{ input: '42\n', output: '7\n' }] })
    }).catch(() => undefined);
    if (!response) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(response?.status, 200);
  ui.picks.push(items => items[0]);
  await importPromise;
  assert.equal((await folders(root)).length, 2);
}
