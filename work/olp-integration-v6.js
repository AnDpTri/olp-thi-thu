'use strict';

// Chạy trong extension host thật của VS Code (xem run-olp-v6.ps1). VNOJ được thay bằng mock-vnoj.js,
// hộp thoại được bộ bọc test-boundary trả lời sẵn. Chạy thật g++ trên máy này.
//   OLP_TEST_PHASE=main     : bố cục, chạy, mẫu, nộp có kiểm tra mẫu, bảng điểm, đồng hồ, báo cáo, thi thử ngay
//   OLP_TEST_PHASE=migrate  : trạng thái do bản 0.5.1 tạo ra vẫn dùng được
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { basename, join, relative } = require('node:path');
const { spawnSync } = require('node:child_process');
const vscode = require('vscode');
const boundary = require('./test-boundary');
const { createMock, good } = require('./mock-vnoj');

const { ui } = boundary;
const production = 'https://oj.vnoi.info';
const base = Date.parse('2026-11-14T07:00:00Z');
const at = seconds => { ui.now = base + seconds * 1000; };
async function command(name, ...args) {
  const kit = boundary.context?.workspaceState.get('olp.practice.v1')?.kit;
  const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const session = boundary.context?.workspaceState.get('olp.practice.v1')?.sessions?.at(-1);
  const eventFile = kit && session && join(root,'OLP-'+kit.id,'.olp',session.id,'events.jsonl');
  const events = () => eventFile && fs.existsSync(eventFile) ? fs.readFileSync(eventFile,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  const checking = name === 'run' || name === 'runSamples';
  const before = checking ? events().at(-1)?.seq ?? 0 : 0;
  const expected = {};
  if (checking && kit) for (const p of kit.problems) {
    const uri = vscode.Uri.file(join(root,'OLP-'+kit.id,p.key,p.source));
    const doc = vscode.workspace.textDocuments.find(d=>d.uri.toString()===uri.toString());
    expected[p.key] = createHash('sha256').update(doc?.getText() ?? text(uri)).digest('hex');
  }
  const result = await vscode.commands.executeCommand('olp.' + name, ...args);
  if (checking) for (const e of events().filter(e=>e.seq>before&&e.type==='compile_result')) {
    assert.equal(e.sourceHash,expected[e.problem],name+': compiler source must equal the editor at command start: '+JSON.stringify(e));
  }
  return result;
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const config = () => vscode.workspace.getConfiguration('olp');
const setting = (key, value) => config().update(key, value, vscode.ConfigurationTarget.Global);
const clear = () => { for (const list of [ui.errors, ui.warnings, ui.infos, ui.opened, ui.statusMessages]) list.length = 0; };
const header = '#include <bits/stdc++.h>\nusing namespace std;\n';
const sum = (extra = '') => header + 'int main(){long long a,b;cin>>a>>b;cout<<a+b' + extra + '<<"\\n";}\n';
const codes = { A: 'p1', B: 'partial', C: 'pac', D: 'hold' };
const samples = {
  A: [{ input: '2 3\n', output: '5\n' }, { input: '10 20\n', output: '30\n' }],
  B: [{ input: '1 1\n', output: '2\n' }], C: [{ input: '1 1\n', output: '2\n' }], D: []
};
const names = { A: 'Đăng ký học phần', B: 'Đường đi', C: 'Ba số nguyên tố', D: 'Đố vui' };

async function waitFor(check, name, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await sleep(120);
  }
  throw new Error('Quá thời gian chờ: ' + name);
}

const journal = async () => { await command('copy'); return ui.clipboard; };
const waitJournal = (pattern, name) => waitFor(async () => pattern.test(await journal()), name);
const secret = () => boundary.context.secrets.get('olp.vnoj.sessionid');
const logStep = name => fs.appendFileSync(join(vscode.workspace.workspaceFolders[0].uri.fsPath, 'steps.log'), new Date().toISOString().slice(11, 19) + ' ' + name + '\n');
const text = uri => Buffer.from(fs.readFileSync(uri.fsPath)).toString('utf8');

async function setText(uri, value) {
  // WorkspaceEdit alone can edit a hidden document while the next command still
  // targets D (e.g. after its no-samples action). Select the intended solution.
  const key = basename(uri.fsPath).match(/^([A-D])\.cpp$/)?.[1];
  if (key) {
    await command('source',key);
    assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath,uri.fsPath,'setText source target');
  }
  const document = await vscode.workspace.openTextDocument(uri);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), value);
  assert(await vscode.workspace.applyEdit(edit));
  assert.equal(document.getText(),value,'setText must update the intended document');
  return document;
}

function layoutOf(kit) {
  const label = tab => tab.input instanceof vscode.TabInputText ? relative(kit.fsPath, tab.input.uri.fsPath).replace(/\\/g, '/')
    : tab.input instanceof vscode.TabInputWebview ? 'WEBVIEW' : tab.input instanceof vscode.TabInputTextDiff ? 'DIFF' : '?';
  return vscode.window.tabGroups.all.map(group => ({
    column: group.viewColumn, active: group.isActive,
    tabs: group.tabs.map(label).filter(item => item !== 'WEBVIEW' && (item === 'DIFF' || !item.startsWith('..')))
  })).sort((a, b) => a.column - b.column);
}

const A4 = [['A/A.cpp'], ['A/input.txt'], ['A/output.txt']];
const waitLayout = (kit, expected, name) => waitFor(() => JSON.stringify(layoutOf(kit).map(group => group.tabs)) === JSON.stringify(expected), name, 60000)
  .catch(error => { throw new Error(error.message + ' ' + JSON.stringify(layoutOf(kit))); });
const allKitTabs = kit => layoutOf(kit).flatMap(group => group.tabs);

async function deliver(root, label) {
  const problems = Object.entries(codes).map(([key, code]) => ({ key, url: production + '/problem/' + code }));
  const pending = command('companion');
  for (const item of problems) {
    let response;
    for (let attempt = 0; attempt < 40 && !response; attempt++) {
      response = await fetch('http://127.0.0.1:27177/', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'chrome-extension://test' },
        body: JSON.stringify({
          url: item.url, name: 'Olympic Sinh Viên 2024 - Không chuyên - ' + names[item.key], tests: samples[item.key],
          batch: { id: label, size: problems.length }
        })
      }).catch(() => undefined);
      if (!response) await sleep(100);
    }
    assert.equal(response?.status, 200);
  }
  ui.picks.push(items => items[0]);
  await pending;
  const folders = (await vscode.workspace.fs.readDirectory(root)).filter(([name]) => name.startsWith('OLP-'));
  return vscode.Uri.joinPath(root, folders.map(([name]) => name).sort().at(-1));
}

// ---- Giai đoạn migrate: trạng thái kiểu 0.5.1 ----
exports.seed = function (context) {
  const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const kit = {
    id: 'old0501', title: 'Bộ đề cũ 0.5.1',
    problems: ['A', 'B'].map(key => ({ key, name: 'Bài ' + key, url: production + '/problem/' + codes[key], pdf: false, source: key + '.cpp', tests: 1 }))
  };
  for (const key of ['A', 'B']) {
    const dir = join(root, 'OLP-old0501', key);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(join(dir, key + '.cpp'), key === 'B' ? '// mã cũ của tôi\nint main(){}\n' : '');
    fs.writeFileSync(join(dir, 'input.txt'), '2 3\n');
    fs.writeFileSync(join(dir, 'output.txt'), '5\n');
    fs.writeFileSync(join(dir, 'mau-1.in'), '2 3\n');
    fs.writeFileSync(join(dir, 'mau-1.out'), '5\n');
  }
  const start = base - 3600 * 1000;
  const session = {
    id: 'oldsess', kit, start, deadline: start + 180 * 60000,
    events: [{ type: 'start', at: start }, { type: 'focus', at: start + 60000, problem: 'A' }, { type: 'phase', at: start + 60000, problem: 'A', phase: 'coding' },
      { type: 'sent', at: start + 600000, problem: 'A', submission: '77', url: production + '/submission/77', auto: true },
      { type: 'verdict', at: start + 660000, problem: 'A', text: 'WA 40/100', submission: '77', url: production + '/submission/77', auto: true }]
  };
  const ended = structuredClone(session);
  ended.id = 'oldend';
  ended.start -= 86400000;
  ended.deadline -= 86400000;
  ended.events.forEach(item => { item.at -= 86400000; });
  ended.end = ended.start + 120000;
  ended.events.push({ type: 'end', at: ended.end });
  ended.events = ended.events.filter(item => item.at <= ended.end);
  context.workspaceState.update('olp.practice.v1', { kit, sessions: [ended, session] });
};

async function migrate() {
  const root = vscode.workspace.workspaceFolders[0].uri;
  const kit = vscode.Uri.joinPath(root, 'OLP-old0501');
  const api = boundary.api;
  const step = logStep;
  at(0);
  await vscode.extensions.getExtension('olp-local.olp-practice').activate();
  step('phiên 0.5.1 được khôi phục');
  const rows = api.snapshot();
  assert(rows.some(row => row.label === 'Bộ đề cũ 0.5.1' && row.description === 'Đang thi'), JSON.stringify(rows.map(row => row.label)));
  const a = rows.find(row => row.label.startsWith('A · '));
  assert.match(a.description, /^40 · /, 'bảng điểm lấy từ sự kiện cũ: ' + a.description);
  assert(a.children.some(child => child.label === 'Bài nộp' && child.children[0].description === 'WA 40/100'));
  assert.match(api.status().board, /^A 40 {2}B –$/);
  step('output.txt cũ giữ nguyên; tệp lời giải rỗng nhận template; tệp có mã không bị ghi đè');
  assert.equal(text(vscode.Uri.joinPath(kit, 'A', 'A.cpp')), '');
  await command('source', 'A');
  const template = text(vscode.Uri.joinPath(kit, 'A', 'A.cpp'));
  assert.match(template, /Bộ đề cũ 0\.5\.1 · Bài A: Bài A/);
  assert.match(template, /sync_with_stdio/);
  assert.equal(text(vscode.Uri.joinPath(kit, 'A', 'output.txt')), '5\n', 'output.txt cũ phải được giữ');
  await command('source', 'B');
  assert.equal(text(vscode.Uri.joinPath(kit, 'B', 'B.cpp')), '// mã cũ của tôi\nint main(){}\n');
  const stateAfter = boundary.context.workspaceState.get('olp.practice.v1');
  assert.equal(stateAfter.kit.problems.every(problem => problem.templated), true);
  assert.deepEqual(stateAfter.runs, {});
  step('chạy mã mẫu trên kit cũ, báo cáo phiên cũ không có thời lượng riêng');
  await setText(vscode.Uri.joinPath(kit, 'A', 'A.cpp'), sum());
  at(30);
  await command('run', { problem: stateAfter.kit.problems[0] });
  assert.equal(text(vscode.Uri.joinPath(kit, 'A', 'output.txt')), '5\n');
  assert.deepEqual(ui.errors, [], JSON.stringify(ui.errors));
  const report = await journal();
  assert.match(report, /Thời lượng 01:00:30\.000 \/ 03:00:00\.000/);
  assert.match(report, /Chạy input\.txt · xong/);
  assert.match(report, /Bắt đầu 2026-11-14 13:00:00 \(UTC\+07:00/);
  const old = (await (async () => { ui.picks.push(items => items.at(-1)); await command('history'); return vscode.window.activeTextEditor.document.getText(); })());
  assert.match(old, /Thời lượng 00:02:00\.000 \/ 03:00:00\.000/, 'phiên cũ đã kết thúc; actual report:\n'+old);
  assert(old.includes('phiên cũ – không có nhật ký chi tiết'),'Missing legacy label; actual report:\n'+old);
  assert(!old.includes('NaN'),'Invalid legacy report:\n'+old);
  const oldRow=old.split('\n').find(line=>line.startsWith('| A · ')).split('|').slice(1,-1).map(s=>s.trim());
  assert.equal(oldRow[1],'00:01:00.000','Legacy A total from old focus journal:\n'+old);
  assert.equal(oldRow[6],'00:01:00.000','Legacy A coding from old phase journal:\n'+old);
  assert.equal(oldRow[14],'—','Unobserved outside time is unknown, not zero');
  assert.equal(oldRow[15],'—','Unobserved idle time is unknown, not zero');
  await command('copy');assert.equal(ui.clipboard,old,'History copy must target the viewed old session');
  step('xuất phiên cũ: journal còn nguyên, thiếu dữ liệu rõ ràng, không thay recorder phiên đang chạy');
  await command('export');const legacyZip=ui.clipboard;assert(legacyZip.endsWith('.zip')&&fs.existsSync(legacyZip),'Legacy export did not produce ZIP: '+legacyZip);
  const legacyFiles=require('./read-test-zip')(fs.readFileSync(legacyZip)),legacyManifest=JSON.parse(legacyFiles.get('manifest.json'));
  require('./check-export-v2').check(legacyFiles);assert.equal(legacyManifest.session.id,'oldend');assert.equal(legacyManifest.legacy,true);assert(legacyManifest.missingData.length>0);assert.equal(legacyManifest.session.elapsedMs,120000);assert.equal(legacyManifest.session.limitMs,180*60000);
  assert.equal(legacyManifest.problems[0].files['A.cpp'].state,'unavailable');assert(!legacyFiles.has('problems/A/solution.cpp'),'Do not mislabel current source as old session source');assert(legacyFiles.has('timeline/legacy-journal.jsonl'));
  const unpack=join(root.fsPath,'legacy-export-unpacked');for(const [name,data]of legacyFiles){const target=join(unpack,name);fs.mkdirSync(require('node:path').dirname(target),{recursive:true});fs.writeFileSync(target,data);}assert.deepEqual(require(join(unpack,'tools/replay.js')).verify(),[],'Legacy ZIP must pass replay/manifest verification');
  assert.equal(boundary.context.workspaceState.get('olp.practice.v1').sessions.at(-1).id,'oldsess');assert.equal(boundary.context.workspaceState.get('olp.practice.v1').sessions.at(-1).end,undefined,'Viewing/exporting history must not end the live session');
  const liveEdits=join(kit.fsPath,'.olp','oldsess','edits.jsonl'),beforeSeq=JSON.parse(fs.readFileSync(liveEdits,'utf8').trim().split('\n').at(-1)).seq;
  await setText(vscode.Uri.joinPath(kit,'A','A.cpp'),sum()+'// continue after history export\n');
  assert(fs.readFileSync(liveEdits,'utf8').trim().split('\n').map(JSON.parse).some(e=>e.seq>beforeSeq&&e.type==='edit'&&e.file==='A/A.cpp'),'Legacy export must preserve live edit recording');
  at(60);
  await command('end');
  await waitFor(() => fs.readdirSync(kit.fsPath).some(name => name === 'phien-oldsess.md'), 'báo cáo ghi khi kết thúc');
  assert.match(text(vscode.Uri.joinPath(kit, 'phien-oldsess.md')), /Thời lượng 01:01:00\.000 \/ 03:00:00\.000/);
}

// ---- Giai đoạn main ----
async function main() {
  const root = vscode.workspace.workspaceFolders[0].uri;
  const api = boundary.api;
  const mock = await createMock(production).start();
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
    if (/[\\/]extension[\\/](?:submit|vnoj|imports)\.js/.test(new Error().stack)) seen.push({ origin: url.origin, method: String(init?.method ?? 'GET').toUpperCase(), path: url.pathname });
    return realFetch(url.origin === production ? mock.origin + url.pathname + url.search : url, init);
  };
  const step = logStep;
  try {
    const extension = vscode.extensions.getExtension('olp-local.olp-practice');
    await extension.activate();
    assert.equal(extension.packageJSON.version, '0.7.0');
    const registered = await vscode.commands.getCommands(true);
    for (const id of ['olp.run', 'olp.runSamples', 'olp.addSample', 'olp.template', 'olp.quick', 'olp.switch', 'olp.stuck', 'olp.note', 'olp.stop', 'olp.layout']) assert(registered.includes(id), id);
    await setting('export.auto', false);
    await setting('submit.checkSamples', true);
    await setting('run.timeoutMs', 5000);

    step('chuẩn bị bộ đề qua Companion (4 bài, A có 2 mẫu, D không có mẫu)');
    at(0);
    const kit = await deliver(root, 'b1');
    const dir = key => vscode.Uri.joinPath(kit, key);
    const pdf = fs.readFileSync(join(__dirname, 'olp-preview', 'De-OLP-2024-Khong-chuyen.pdf'));
    fs.writeFileSync(join(dir('A').fsPath, 'De-bai.pdf'), pdf);
    for (const key of 'ABCD') {
      assert.equal(text(vscode.Uri.joinPath(dir(key), 'output.txt')), '', 'output.txt khởi tạo trống, không còn là kết quả mong đợi');
      assert.equal(text(vscode.Uri.joinPath(dir(key), 'input.txt')), samples[key][0]?.input ?? '');
    }
    assert.equal(text(vscode.Uri.joinPath(dir('A'), 'mau-2.out')), '30\n');

    step('template: tệp mới theo mẫu, có chỗ giữ đã điền, con trỏ đặt đúng lần mở đầu');
    const template = text(vscode.Uri.joinPath(dir('A'), 'A.cpp'));
    assert.match(template, /^\/\/ Bộ đề VNOJ · Bài A: Đăng ký học phần\n#include <bits\/stdc\+\+\.h>/);
    assert.match(template, /ios_base::sync_with_stdio\(false\);\n {4}cin\.tie\(nullptr\);\n {4}\n {4}return 0;/);
    assert(!template.includes('${'));
    const stateBefore = boundary.context.workspaceState.get('olp.practice.v1');
    const cursor = stateBefore.kit.problems[0].cursor;
    assert.deepEqual(cursor, { line: 7, character: 4 });
    await command('start');
    at(10);
    await command('source', 'A');
    const editor = vscode.window.activeTextEditor;
    assert(editor.document.uri.fsPath.endsWith('A.cpp'));
    assert.deepEqual([editor.selection.active.line, editor.selection.active.character], [7, 4]);
    assert.equal(boundary.context.workspaceState.get('olp.practice.v1').kit.problems[0].cursor, undefined);
    await command('template');
    const templateFile = vscode.window.activeTextEditor.document.uri;
    assert(templateFile.fsPath.endsWith('template.cpp'));
    assert.equal(vscode.window.activeTextEditor.document.getText().replace(/\r\n/g, '\n'), require('./olp-vscode/template').defaults.cpp);
    await command('source', 'A');

    step('bố cục bài A (có PDF): 3 nhóm, lời giải | đề | input | output, tiêu điểm ở lời giải');
    await waitLayout(kit, A4, 'tab đề');
    let layout = layoutOf(kit);
    assert.deepEqual(layout.map(group => group.tabs), [['A/A.cpp'], ['A/input.txt'], ['A/output.txt']], JSON.stringify(layout));
    assert.equal(layout[0].active, true);
    assert.equal(vscode.window.tabGroups.activeTabGroup.viewColumn, layout[0].column);
    assert(vscode.window.activeTextEditor.document.uri.fsPath.endsWith('A.cpp'));

    step('theo dõi tiêu điểm thật: mở tự động không tạo mốc đọc đề, bấm vào nhóm mới ghi');
    let report = await journal();
    assert.match(report, /\+00:00:10.*A.*Chuyển bài/);
    assert.match(report, /\+00:00:10.*A.*Viết mã/);
    assert.doesNotMatch(report, /Đọc \/ phân tích đề/, 'đề tự mở không được ghi là đang đọc');
    assert.doesNotMatch(report, /Thử input\/output/);
    at(20);
    await command('statement');
    await waitJournal(/\+00:00:20.*A.*Đọc \/ phân tích đề/, 'tiêu điểm vào đề');
    at(30);
    await command('statement');
    await vscode.commands.executeCommand('workbench.action.focusSecondEditorGroup');
    await waitJournal(/\+00:00:30.*A.*Thử input\/output/, 'tiêu điểm vào input.txt');
    at(40);
    await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
    await waitJournal(/\+00:00:40.*A.*Viết mã/, 'tiêu điểm về lời giải');

    step('chuyển sang B (không PDF): dùng lại nhóm, còn 3 nhóm, không còn tệp của A, đề đóng');
    at(50);
    await command('switch', 2);
    layout = layoutOf(kit);
    assert.deepEqual(layout.map(group => group.tabs), [['B/B.cpp'], ['B/input.txt'], ['B/output.txt']], JSON.stringify(layout));
    assert.equal(layout[0].active, true);
    assert(vscode.window.activeTextEditor.document.uri.fsPath.endsWith('B.cpp'));
    assert.match(await journal(), /\+00:00:50.*B.*Chuyển bài/);

    step('trở lại A bằng olp.source: 3 nhóm, không chồng tab');
    at(60);
    await command('source', 'A');
    await waitLayout(kit, A4, 'tab đề lần hai');
    layout = layoutOf(kit);
    assert.deepEqual(layout.map(group => group.tabs), [['A/A.cpp'], ['A/input.txt'], ['A/output.txt']], JSON.stringify(layout));
    await command('switch', 3);
    await command('switch', 1);
    await waitLayout(kit, A4, 'tab đề lần ba');
    assert.equal(allKitTabs(kit).filter(t=>t!=='WEBVIEW').length, 3, JSON.stringify(layoutOf(kit)));

    step('olp.layout.auto = false: chỉ mở tệp lời giải, không đổi nhóm');
    await setting('layout.auto', false);
    await command('switch', 4);
    assert(vscode.window.activeTextEditor.document.uri.fsPath.endsWith('D.cpp'));
    await setting('layout.auto', true);
    await command('switch', 1);
    await waitLayout(kit, A4, 'tab đề sau khi bật lại');
    assert.deepEqual(layoutOf(kit).map(group => group.tabs), [['A/A.cpp'], ['A/input.txt'], ['A/output.txt']], JSON.stringify(layoutOf(kit)));

    step('chạy đúng: lưu mã chưa lưu, biên dịch thật, ghi output.txt và làm mới tab output');
    at(100);
    const aDoc = await setText(vscode.Uri.joinPath(dir('A'), 'A.cpp'), sum());
    assert(aDoc.isDirty);
    clear();
    await command('run');
    assert(!aDoc.isDirty, 'phải lưu lời giải trước khi chạy');
    assert.equal(text(vscode.Uri.joinPath(dir('A'), 'output.txt')), '5\n');
    const outDoc = vscode.workspace.textDocuments.find(item => item.uri.fsPath.endsWith(join('A', 'output.txt')));
    assert.equal(outDoc.getText(), '5\n', 'tab output phải hiện kết quả mới');
    assert(!outDoc.isDirty);
    assert(ui.statusMessages.some(item => /Bài A: chạy xong .* mã thoát 0 → output\.txt/.test(item)), JSON.stringify(ui.statusMessages));
    assert.deepEqual([ui.errors, ui.warnings], [[], []]);
    assert(fs.existsSync(join(kit.fsPath, 'build', 'A.exe')), 'binary nằm trong thư mục build của bộ đề');
    assert(!fs.existsSync(join(dir('A').fsPath, 'A.exe')), 'không để binary cạnh mã nguồn');
    assert.match(api.snapshot().find(row => row.label.startsWith('A · ')).children.find(row => row.label === 'Chạy với input.txt').description, /^✓ /);

    step('sai đáp án: chạy vẫn xong, chạy mẫu báo SAI, mở khác biệt');
    at(110);
    await setText(vscode.Uri.joinPath(dir('A'), 'A.cpp'), sum('+1'));
    clear();
    await command('run');
    assert.equal(text(vscode.Uri.joinPath(dir('A'), 'output.txt')), '6\n');
    clear();
    await command('runSamples');
    assert(ui.warnings.some(item => /Bài A: 0\/2 test mẫu đúng\. mau-1 SAI dòng 1: mong đợi "5", nhận "6"/.test(item)), JSON.stringify(ui.warnings));
    let tree = api.snapshot().find(row => row.label.startsWith('A · '));
    const group = tree.children.find(row => row.label === 'Chạy test mẫu');
    assert.equal(group.description, '0/2 đúng');
    assert.deepEqual(group.children.map(row => row.label + ' ' + row.description.split(' · ')[0]), ['mau-1 SAI', 'mau-2 SAI']);
    await command('diffSample', 'A', 1);
    const diff = vscode.window.tabGroups.all.flatMap(item => item.tabs).find(tab => tab.input instanceof vscode.TabInputTextDiff);
    assert(diff, 'phải mở tab so sánh');
    assert(diff.input.original.fsPath.endsWith('mau-1.out'));
    assert(diff.input.modified.fsPath.endsWith('A.mau-1.actual.txt'));
    assert.equal(text(diff.input.modified), '6\n');
    assert.deepEqual(layoutOf(kit).map(item => item.column), [1, 2, 3]);
    await command('source', 'A');
    await waitFor(() => !layoutOf(kit).some(item => item.tabs.includes('DIFF')), 'đóng tab khác biệt cũ');

    step('lỗi biên dịch: chẩn đoán trong Problems, báo lỗi, đưa con trỏ tới lỗi đầu tiên');
    at(120);
    clear();
    await setText(vscode.Uri.joinPath(dir('A'), 'A.cpp'), header + 'int main(){\n  int a = ;\n}\n');
    await command('run');
    const aUri = vscode.Uri.joinPath(dir('A'), 'A.cpp');
    const found = vscode.languages.getDiagnostics(aUri);
    assert(found.some(item => item.severity === vscode.DiagnosticSeverity.Error && item.range.start.line === 3), JSON.stringify(found.map(item => [item.range.start.line, item.message])));
    assert(ui.errors.some(item => /Bài A lỗi biên dịch .*A\.cpp:4/.test(item)), JSON.stringify(ui.errors));
    assert.equal(vscode.window.activeTextEditor.selection.active.line, 3);
    assert(vscode.window.activeTextEditor.document.uri.fsPath.endsWith('A.cpp'));
    clear();
    await command('runSamples');
    assert(ui.errors.some(item => /lỗi biên dịch/.test(item)));
    await setText(aUri, sum());
    await command('run');
    assert.deepEqual(vscode.languages.getDiagnostics(aUri).filter(item => item.severity === vscode.DiagnosticSeverity.Error), []);

    step('lỗi lúc chạy (RTE)');
    at(130);
    clear();
    await setText(aUri, header + 'int main(){int *p=nullptr; volatile int x=*p; cout<<x;}\n');
    await command('run');
    assert(ui.warnings.some(item => /Bài A lỗi lúc chạy \(RTE\): mã thoát/.test(item)), JSON.stringify(ui.warnings));
    assert.deepEqual(ui.errors, []);

    step('vòng lặp vô hạn: quá giờ, bị giết');
    at(140);
    clear();
    await setting('run.timeoutMs', 800);
    await setText(aUri, header + 'int main(){volatile long long x=0; while(true) x++;}\n');
    const t0 = Date.now();
    await command('run');
    assert(Date.now() - t0 < 15000, 'quá lâu: ' + (Date.now() - t0));
    assert(ui.warnings.some(item => /Bài A TLE: quá 800 ms, đã dừng chương trình/.test(item)), JSON.stringify(ui.warnings));
    await sleep(400);
    assert.doesNotMatch(spawnSync('tasklist', ['/FI', 'IMAGENAME eq A.exe', '/NH'], { encoding: 'utf8' }).stdout, /A\.exe/);
    clear();
    await runStop(aUri);
    await setting('run.timeoutMs', 5000);

    step('thiếu trình biên dịch: báo cách đặt đường dẫn, không ném lỗi');
    clear();
    await setting('cpp.compiler', 'khong-co-g++-nay');
    await setText(aUri, sum());
    await command('run');
    assert(ui.errors.some(item => /Không tìm thấy "khong-co-g\+\+-nay".*olp\.cpp\.compiler/.test(item)), JSON.stringify(ui.errors));
    await setting('cpp.compiler', undefined);

    step('chạy mẫu đúng; lưu input/output hiện tại thành test mẫu; bài không có mẫu');
    at(150);
    clear();
    await command('runSamples');
    assert(ui.infos.some(item => /Bài A: 2\/2 test mẫu ĐÚNG/.test(item)), JSON.stringify(ui.infos));
    await setText(vscode.Uri.joinPath(dir('A'), 'input.txt'), '7 8\n');
    await command('run');
    await command('addSample');
    assert.equal(text(vscode.Uri.joinPath(dir('A'), 'mau-3.in')), '7 8\n');
    assert.equal(text(vscode.Uri.joinPath(dir('A'), 'mau-3.out')), '15\n');
    clear();
    await command('runSamples');
    assert(ui.infos.some(item => /3\/3 test mẫu ĐÚNG/.test(item)), JSON.stringify(ui.infos));
    await setText(vscode.Uri.joinPath(dir('A'), 'input.txt'), '');
    clear();
    await command('addSample');
    assert(ui.errors.some(item => /input\.txt đang trống/.test(item)), JSON.stringify(ui.errors));
    clear();
    await command('runSamples', { problem: boundary.context.workspaceState.get('olp.practice.v1').kit.problems[3] });
    assert(ui.infos.some(item => /Bài D chưa có test mẫu.*PDF/.test(item)), JSON.stringify(ui.infos));
    clear();
    await setting('run.timeoutMs', 800);
    const loopsOnSecond = await setText(aUri, header + 'int main(){long long a,b;cin>>a>>b; if(a==10) {volatile long long x=0; while(true) x++;} cout<<a+b<<"\\n";}\n');
    const sampleEvents = join(kit.fsPath,'.olp',boundary.context.workspaceState.get('olp.practice.v1').sessions.at(-1).id,'events.jsonl');
    const compileBefore = fs.readFileSync(sampleEvents,'utf8').trim().split('\n').map(JSON.parse).at(-1).seq;
    await command('runSamples', { problem: boundary.context.workspaceState.get('olp.practice.v1').kit.problems[0] });
    const freshCompile = fs.readFileSync(sampleEvents,'utf8').trim().split('\n').map(JSON.parse).find(e=>e.seq>compileBefore&&e.type==='compile_result'&&e.problem==='A');
    assert(freshCompile,'TLE test must produce a fresh A compile event, not inspect an old tree result');
    assert.equal(freshCompile.sourceHash,createHash('sha256').update(loopsOnSecond.getText()).digest('hex'));
    tree = api.snapshot().find(row => row.label.startsWith('A · '));
    assert.deepEqual(tree.children.find(row => row.label === 'Chạy test mẫu').children.map(row => row.description.split(' · ')[0]), ['ĐÚNG', 'TLE', 'ĐÚNG']);
    await setting('run.timeoutMs', 5000);
    await setText(aUri, sum());
    const events = await journal();
    assert.match(events, /Chạy test mẫu · 0\/2 đúng/);
    assert.match(events, /Lỗi biên dịch/);
    assert.match(events, /Chạy input\.txt · RTE/);
    assert.match(events, /Chạy input\.txt · TLE/);

    step('đăng nhập: cookie là lựa chọn đầu tiên');
    clear();
    let labels;
    ui.picks.push(items => { labels = items.map(item => item.label); return undefined; });
    await command('login');
    assert.deepEqual(labels, ['Dán cookie sessionid', 'Tên đăng nhập và mật khẩu']);
    ui.picks.push(items => items[0]);
    ui.inputs.push(good);
    await command('login');
    assert.equal(await secret(), good);

    step('đổi đáp án mẫu phải kiểm tra lại dù mã không đổi; sửa mã khi chọn ngôn ngữ thì không POST');
    const submitA = { problem: { key: 'A', url: production + '/problem/p1' } };
    await setText(aUri, sum());
    await command('runSamples');
    const expectedUri = vscode.Uri.joinPath(dir('A'), 'mau-1.out');
    fs.writeFileSync(expectedUri.fsPath, '999\n');
    clear();
    await command('submit', submitA);
    assert(ui.warnings.some(item => /Test mẫu đang sai/.test(item)), JSON.stringify(ui.warnings));
    assert.deepEqual(mock.control.posts, []);
    fs.writeFileSync(expectedUri.fsPath, '5\n');
    clear();
    ui.picks.push(async items => {
      await setText(aUri, sum('+2'));
      return items.find(item => item.label === 'C++20');
    });
    await command('submit', submitA);
    assert(ui.warnings.some(item => /Mã đã thay đổi/.test(item)), JSON.stringify(ui.warnings));
    assert.deepEqual(mock.control.posts, []);
    await boundary.context.globalState.update('olp.vnoj.languages', undefined);

    step('nộp A khi mã sai mẫu: hỏi một lần, không nộp khi bỏ qua; nộp khi bấm Vẫn nộp');
    at(300);
    await setText(aUri, sum('+1'));
    clear();
    const target = key => ({ problem: { key, url: production + '/problem/' + codes[key] } });
    await command('submit', target('A'));
    assert(ui.warnings.some(item => /Test mẫu đang sai, vẫn nộp\? Bài A: 0\/3 đúng/.test(item)), JSON.stringify(ui.warnings));
    assert.deepEqual(mock.control.posts, [], 'không được nộp khi chưa đồng ý');
    clear();
    ui.warnReply = (_message, button) => button;
    ui.picks.push(items => items.find(item => item.label === 'C++20'));
    at(310);
    await command('submit', target('A'));
    assert(ui.warnings.some(item => /Test mẫu đang sai, vẫn nộp\?/.test(item)));
    assert.deepEqual(mock.control.posts, ['p1']);
    ui.warnReply = undefined;
    await waitJournal(/Kết quả \(lấy từ VNOJ\) · #1000 · AC/, 'verdict AC bài A');

    step('nộp lại khi mã đã đúng hết: không hỏi; mã mới chưa chạy mẫu thì chạy rồi mới nộp');
    at(330);
    await setText(aUri, sum());
    await command('runSamples');
    clear();
    at(340);
    await command('submit', target('A'));
    assert.deepEqual(ui.warnings, [], 'mẫu đúng hết cho đúng mã này thì không hỏi');
    assert.deepEqual(mock.control.posts, ['p1', 'p1']);
    const samplesBefore = (await journal()).match(/Chạy test mẫu/g).length;
    await setText(aUri, sum() + '// đổi mã\n');
    at(350);
    await command('submit', target('A'));
    assert.equal((await journal()).match(/Chạy test mẫu/g).length, samplesBefore + 1, 'mã đổi nên phải chạy mẫu lại trước khi nộp');
    assert.deepEqual(mock.control.posts, ['p1', 'p1', 'p1']);
    assert.deepEqual(ui.warnings, []);

    step('tắt olp.submit.checkSamples: nộp thẳng');
    await setting('submit.checkSamples', false);
    await setText(aUri, sum('+1'));
    at(360);
    await command('submit', target('A'));
    assert.deepEqual(mock.control.posts, ['p1', 'p1', 'p1', 'p1']);
    await setting('submit.checkSamples', true);
    await setText(aUri, sum());

    step('bảng điểm và cây: B được 40, A AC, bài nộp có mã, link, kết quả');
    at(370);
    await setText(vscode.Uri.joinPath(dir('B'), 'B.cpp'), sum());
    await command('submit', target('B'));
    await waitJournal(/\| B \| Kết quả \(lấy từ VNOJ\) · #1004 · WA 40\/100/, 'verdict B');
    await waitFor(() => api.status().board === 'A ✓  B 40  C –  D –', 'bảng điểm', 5000);
    tree = api.snapshot();
    const rowA = tree.find(row => row.label.startsWith('A · '));
    assert.match(rowA.description, /^✓ · /);
    const subs = rowA.children.find(row => row.label === 'Bài nộp');
    assert.equal(subs.description, 'AC');
    assert.equal(subs.children.length, 4);
    assert.match(subs.children[3].label, /^\+00:05:1\d · #1000$/);
    assert.equal(subs.children[3].description, 'AC');
    assert.match(tree.find(row => row.label.startsWith('B · ')).description, /^40 · /);
    assert.match(api.status().clock, /^\$\(watch\) OLP \d\d:\d\d:\d\d$/);
    assert.match(api.status().run, /Chạy/);
    assert.match(api.status().submit, /Nộp/);

    step('kết quả chưa về: dòng bài nộp chờ, lấy lại kết quả sau khi VNOJ chấm xong');
    at(400);
    await command('submit', target('D'));
    assert.deepEqual(mock.control.posts.slice(-1), ['hold']);
    tree = api.snapshot();
    const pending = tree.find(row => row.label.startsWith('D · ')).children.find(row => row.label === 'Bài nộp').children[0];
    assert.equal(pending.description, 'đang chờ chấm…');
    assert.equal(pending.contextValue, 'olp.pending');
    assert.match(api.status().board, /D …$/);
    await command('logout');
    await sleep(500);
    ui.picks.push(items => items[0]);
    ui.inputs.push(good);
    await command('login');
    mock.control.released = true;
    await command('refetch', { submission: { key: 'D', id: '1005', url: production + '/submission/1005' } });
    await waitFor(() => api.status().board === 'A ✓  B 40  C –  D 55', 'D có kết quả sau khi lấy lại', 15000);
    assert.equal(api.snapshot().find(row => row.label.startsWith('D · ')).children.find(row => row.label === 'Bài nộp').children[0].contextValue, 'olp.submission');

    step('cookie hết hạn: hỏi thẳng hộp dán cookie, không qua danh sách lựa chọn');
    mock.control.expired = true;
    clear();
    at(420);
    ui.warnReply = (_message, button) => button;
    const originalInput = boundary.vscode.window.showInputBox;
    boundary.vscode.window.showInputBox = options => { mock.control.expired = false; return originalInput(options); };
    ui.inputs.push(good);
    const picksBefore = ui.picks.length;
    await command('submit', target('B'));
    ui.warnReply = undefined;
    assert(ui.warnings.some(item => /hết hạn/.test(item)), JSON.stringify(ui.warnings));
    assert.equal(ui.picks.length, picksBefore);
    assert.equal(await secret(), good, 'hộp cookie đã nhận cookie mới');

    step('Bị kẹt và ghi chú vào nhật ký');
    at(430);
    await command('source', 'C');
    await command('stuck');
    ui.inputs.push('thử quy hoạch động theo đoạn');
    at(440);
    await command('note');
    const noted = await journal();
    assert.match(noted, /\+00:07:10\.\d{3} \| .*\| C \| Ghi mốc · Bị kẹt \|/);
    assert.match(noted, /\+00:07:20\.\d{3} \| .*\| C \| Ghi mốc · thử quy hoạch động theo đoạn \|/);

    step('đồng hồ: cảnh báo 60/30/10/5 phút, màu thanh trạng thái');
    clear();
    const tick = () => sleep(1500);
    await tick();
    assert(!ui.warnings.some(item => /Còn \d+ phút/.test(item)));
    at(120 * 60);
    await tick();
    assert(ui.warnings.some(item => /Còn 60 phút · A ✓/.test(item)), JSON.stringify(ui.warnings));
    assert.equal(api.status().background, undefined);
    at(150 * 60);
    await tick();
    assert(ui.warnings.some(item => /Còn 30 phút/.test(item)));
    at(171 * 60);
    await tick();
    assert(ui.warnings.some(item => /Còn 10 phút/.test(item)));
    assert.equal(api.status().background, 'statusBarItem.warningBackground');
    assert.match(api.status().clock, /OLP 00:09:00$/);
    at(176 * 60);
    await tick();
    assert(ui.warnings.some(item => /Còn 5 phút/.test(item)));
    assert.equal(api.status().background, 'statusBarItem.errorBackground');
    assert.equal(ui.warnings.filter(item => /Còn \d+ phút/.test(item)).length, 4);
    await tick();
    assert.equal(ui.warnings.filter(item => /Còn \d+ phút/.test(item)).length, 4, 'mỗi mốc chỉ báo một lần');
    at(177 * 60 + 30);
    await tick();
    assert.equal(api.status().background, 'statusBarItem.errorBackground');

    step('kết thúc: báo cáo ghi tệp, mở bên cạnh, tự sao chép, giờ địa phương');
    at(178 * 60);
    clear();
    ui.clipboard = '';
    await command('end');
    await waitFor(() => ui.clipboard.includes('# Thi thử OLP'), 'clipboard nhận báo cáo');
    const written = (await vscode.workspace.fs.readDirectory(kit)).map(([name]) => name).find(name => /^phien-.*\.md$/.test(name));
    assert(written);
    const body = text(vscode.Uri.joinPath(kit, written));
    assert.equal(ui.clipboard, body);
    assert(ui.infos.some(item => /Đã kết thúc phiên\..*sao chép vào clipboard/.test(item)), JSON.stringify(ui.infos));
    await waitFor(() => vscode.window.tabGroups.all.flatMap(item => item.tabs).some(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.fsPath.endsWith(written)), 'tệp báo cáo được mở');
    assert.match(body, /- Bắt đầu 2026-11-14 14:00:00 \(UTC\+07:00, giờ địa phương\)/);
    assert.match(body, /Thời lượng 02:58:00\.000 \/ 03:00:00\.000/);
    assert.doesNotMatch(body, /T\d\d:\d\d:\d\dZ/);
    assert.match(body, /\| A · [^|]*\| [\d:.]+ \| 4 \| AC \| \+00:05:1\d\.\d{3} \| [\d:.]+ \| [\d:.]+ \| [\d:.]+ \| [\d:.]+ \| \d+ \| \d+ \| \d+ \| \d+ \|/);
    const rowReport = body.split('\n').find(line => line.startsWith('| A · ')).split('|').map(item => item.trim());
    const [runs, good3, bad3, compileErrors] = rowReport.slice(10, 14).map(Number);
    assert(runs >= 5 && good3 >= 2 && bad3 >= 1 && compileErrors >= 2, rowReport.join(' | '));
    assert.match(body, /\| A \| \+00:05:10\.\d{3} \| 2026-11-14 14:05:10 \| #1000 \| https:\/\/oj\.vnoi\.info\/submission\/1000 \| AC \|/);
    assert.match(body, /\| B \| \+00:06:10\.\d{3} \| 2026-11-14 14:06:10 \| #1004 \|.* \| WA 40\/100 \|/);
    assert.match(body, /\| D \| \+00:06:40\.\d{3} \| 2026-11-14 14:06:40 \| #1005 \|.* \| TLE 55\/100 \|/);
    assert.match(body, /\| \+00:00:10\.\d{3} \| 2026-11-14 14:00:10 \| A \| Chuyển bài \|/);

    step('thi thử ngay: dán link, mở bài A với bố cục, hỏi bắt đầu một cú bấm, thời lượng theo cài đặt');
    clear();
    ui.clipboard = 'văn bản không phải link';
    at(0);
    const link = production + '/problem/p1';
    ui.inputs.push(link);
    ui.infoReply = (message, ...buttons) => { ui.asked = message; return buttons[0]; };
    await setting('duration', 90);
    await command('quick');
    assert.equal(ui.asked, 'OLP · Bắt đầu 90 phút ngay?');
    const quickKit = (await vscode.workspace.fs.readDirectory(root)).map(([name]) => name).filter(name => name.startsWith('OLP-')).sort();
    assert.equal(quickKit.length, 2);
    const newest = quickKit.find(name => name !== basename(kit.fsPath));
    const second = vscode.Uri.joinPath(root, newest);
    assert.deepEqual(layoutOf(second).map(group => group.tabs), [['A/A.cpp'], ['A/input.txt'], ['A/output.txt']], JSON.stringify(layoutOf(second)));
    const latest = boundary.context.workspaceState.get('olp.practice.v1').sessions.at(-1);
    assert.equal(latest.deadline - latest.start, 90 * 60000);
    assert.equal(latest.kit.title, 'Easy Math');
    assert.deepEqual(boundary.context.globalState.get('olp.recentLinks'), [link]);
    assert.equal(ui.picks.length, 0, 'ngôn ngữ đã nhớ nên không hỏi lại');
    await command('end');
    await waitFor(() => ui.infos.some(item => /Đã kết thúc phiên/.test(item)), 'kết thúc phiên thi thử ngay');
    ui.infoReply = undefined;
    let linkLabels;
    ui.picks.push(items => { linkLabels = items.map(item => item.label); return undefined; });
    await command('quick');
    assert.deepEqual(linkLabels, ['$(history) problem/p1', '$(add) Dán link khác…']);
    await setting('duration', undefined);

    step('mạng: chỉ tới production (đã đổi hướng sang mock) và loopback; chỉ POST nộp bài');
    // VS Code tự gọi dịch vụ thử nghiệm của nó qua fetch toàn cục; những địa chỉ đó không phải của tiện ích.
    const own = item => item.origin === production;
    assert(seen.every(own), JSON.stringify(seen.filter(item => !own(item))));
    assert(seen.filter(item => item.origin === production).every(item => /^\/(problem\/[\w-]+(\/submit|\/pdf)?|widgets\/single_submission|submission\/\d+|$)/.test(item.path) || item.path === '/'), JSON.stringify(seen.filter(item => item.origin === production).map(item => item.path)));
    const posts = seen.filter(item => item.origin === production && item.method === 'POST');
    assert(posts.length >= 6 && posts.every(item => /^\/problem\/[\w-]+\/submit$/.test(item.path)), JSON.stringify(posts));
    assert.equal(mock.foreignLog.length, 0);
  } finally {
    globalThis.fetch = realFetch;
    mock.stop();
  }
}

// Dừng giữa chừng bằng olp.stop trong khi chương trình vòng lặp vô hạn đang chạy.
async function runStop(uri) {
  await setting('run.timeoutMs', 60000);
  const finished = command('run');
  await waitFor(() => boundary.api.status().run.includes('Dừng'), 'nút Dừng hiện ra');
  await sleep(500);
  await command('stop');
  await finished;
  assert(ui.infos.some(item => /Đã dừng chương trình bài A/.test(item)), JSON.stringify(ui.infos));
  assert(boundary.api.status().run.includes('Chạy'));
  void uri;
}

exports.run = async function () {
  const root = vscode.workspace.workspaceFolders[0].uri;
  const result = join(root.fsPath, process.env.OLP_TEST_PHASE + '.result');
  try {
    if (process.env.OLP_TEST_PHASE === 'migrate') await migrate();
    else await main();
    writeResult(result, 'PASS');
  } catch (error) {
    const state=boundary.context.workspaceState.get('olp.practice.v1');
    const dump={kit:state?.kit,errors:ui.errors,warnings:ui.warnings,infos:ui.infos,active:vscode.window.activeTextEditor?.document.uri.fsPath};
    try {
      const dir=join(root.fsPath,'OLP-'+state.kit.id,'.olp',state.sessions.at(-1).id);
      dump.logDirectory=dir;dump.logFiles=fs.readdirSync(dir);
      for(const name of ['events','edits'])dump[name+'Tail']=fs.readFileSync(join(dir,name+'.jsonl'),'utf8').trim().split('\n').slice(-20);
    } catch(e) {dump.logError=e.message;}
    writeResult(result, error.stack + '\n' + JSON.stringify(dump,null,2));
    throw error;
  }
};

function writeResult(file, content) {
  fs.writeFileSync(file, content);
}
