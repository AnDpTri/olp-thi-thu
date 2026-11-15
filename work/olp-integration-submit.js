'use strict';

// Chạy trong extension host thật (xem run-olp-submit.ps1). VNOJ được thay bằng mock-vnoj.js trên 127.0.0.1:
// chỉ fetch toàn cục của host thử nghiệm bị đổi hướng, extension đóng gói vẫn dùng đúng https://oj.vnoi.info.
const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const vscode = require('vscode');
const boundary = require('./test-boundary');
const { createMock, good } = require('./mock-vnoj');

const { ui } = boundary;
const production = 'https://oj.vnoi.info';
const base = Date.parse('2026-11-14T07:00:00Z');
const at = seconds => { ui.now = base + seconds * 1000; };
const command = (name, ...args) => vscode.commands.executeCommand('olp.' + name, ...args);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const codes = { A: 'p1', B: 'partial', C: 'captcha', D: 'toomany', E: 'hold' };
const problems = Object.entries(codes).map(([key, code]) => ({ key, url: production + '/problem/' + code }));

async function waitFor(check, name, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await sleep(150);
  }
  throw new Error('Quá thời gian chờ: ' + name);
}

const journal = async () => { await command('copy'); return ui.clipboard; };
const waitJournal = (pattern, name) => waitFor(async () => pattern.test(await journal()), name);
const secret = () => boundary.context.secrets.get('olp.vnoj.sessionid');
const clear = () => { ui.errors.length = 0; ui.warnings.length = 0; ui.infos.length = 0; ui.opened.length = 0; };

async function deliver(root) {
  const pending = command('companion');
  for (const [index, item] of problems.entries()) {
    let response;
    for (let attempt = 0; attempt < 40 && !response; attempt++) {
      response = await fetch('http://127.0.0.1:27177/', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'chrome-extension://test' },
        body: JSON.stringify({ url: item.url, name: 'Bài ' + item.key, tests: [{ input: '1\n', output: '2\n' }], batch: { id: 'b1', size: problems.length } })
      }).catch(() => undefined);
      if (!response) await sleep(100);
    }
    assert.equal(response?.status, 200, 'Companion bài ' + index);
  }
  ui.picks.push(items => items[0]);
  await pending;
  const folders = (await vscode.workspace.fs.readDirectory(root)).filter(([name]) => name.startsWith('OLP-'));
  assert.equal(folders.length, 1);
  return vscode.Uri.joinPath(root, folders[0][0]);
}

async function readReport(kit) {
  const [report] = (await vscode.workspace.fs.readDirectory(kit)).filter(([name]) => /^phien-.*\.md$/.test(name));
  assert(report, 'chưa có tệp báo cáo');
  return Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(kit, report[0]))).toString();
}

exports.run = async function () {
  const root = vscode.workspace.workspaceFolders[0].uri;
  const result = join(root.fsPath, 'submit.result');
  const mock = await createMock(production).start();
  const realFetch = globalThis.fetch;
  const seenUrls = [];
  // Chỉ test host: đổi hướng đúng origin sản xuất sang mock, mọi origin khác đi thẳng.
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
    if (/[\\/]extension[\\/](?:submit|vnoj|imports)\.js/.test(new Error().stack)) seenUrls.push(url.origin);
    return realFetch(url.origin === production ? mock.origin + url.pathname + url.search : url, init);
  };
  const step = name => console.log('[submit-test] ' + name);
  try {
    await vscode.extensions.getExtension('olp-local.olp-practice').activate();
    // 0.6.0: nộp có kiểm tra test mẫu; bộ thử này nộp mã giả nên tắt (bước kiểm tra mẫu có bộ thử riêng: olp-integration-v6.js).
    await vscode.workspace.getConfiguration('olp').update('submit.checkSamples', false, vscode.ConfigurationTarget.Global);
    const pkg = vscode.extensions.getExtension('olp-local.olp-practice').packageJSON;
    step('phiên bản ' + pkg.version);
    const list = await vscode.commands.getCommands(true);
    for (const id of ['olp.login', 'olp.logout', 'olp.submit', 'olp.submitBrowser', 'olp.language']) assert(list.includes(id), id);

    at(0);
    const kit = await deliver(root);
    for (const key of Object.keys(codes)) {
      await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(kit, key, key + '.cpp'), Buffer.from('// bài ' + key + '\nint main(){}\n'));
    }
    await command('start');
    const target = key => ({ problem: { key, url: production + '/problem/' + codes[key] } });

    step('chưa đăng nhập: submit chỉ nhắc đăng nhập');
    at(10);
    await command('submit', target('A'));
    assert(ui.warnings.some(item => item.includes('Chưa đăng nhập VNOJ')));
    assert.equal(mock.control.posts.length, 0);
    assert.equal(ui.opened.length, 0);
    clear();

    step('đăng nhập bằng mật khẩu: sai rồi đúng');
    ui.picks.push(items => items.find(item => item.label === 'Tên đăng nhập và mật khẩu'));
    ui.inputs.push('nguyen-an', 'bad password');
    await command('login');
    assert(ui.errors.some(item => item.includes('sai')), JSON.stringify(ui.errors));
    assert.equal(await secret(), undefined);
    clear();
    ui.picks.push(items => items.find(item => item.label === 'Tên đăng nhập và mật khẩu'));
    ui.inputs.push('nguyen-an', 'correct horse');
    await command('login');
    assert.deepEqual(ui.errors, []);
    assert(ui.infos.some(item => item.includes('nguyen-an')), JSON.stringify(ui.infos));
    assert.equal(await secret(), good);
    assert(!JSON.stringify(boundary.context.globalState.keys().map(key => boundary.context.globalState.get(key))).includes('correct horse'));
    clear();

    step('đăng xuất (phiên do tiện ích tạo nên có POST phía máy chủ)');
    const logoutsBefore = mock.log.filter(item => item.method === 'POST' && item.path === '/accounts/logout/').length;
    await command('logout');
    assert.equal(await secret(), undefined);
    assert.equal(mock.log.filter(item => item.method === 'POST' && item.path === '/accounts/logout/').length, logoutsBefore + 1);
    clear();

    step('đăng nhập bằng cookie dán, rồi đăng xuất không POST phía máy chủ');
    ui.picks.push(items => items.find(item => item.label === 'Dán cookie sessionid'));
    ui.inputs.push(good);
    await command('login');
    assert(ui.infos.some(item => item.includes('nguyen-an')));
    assert.equal(await secret(), good);
    await command('logout');
    assert.equal(mock.log.filter(item => item.method === 'POST' && item.path === '/accounts/logout/').length, logoutsBefore + 1);
    clear();

    step('tài khoản 2FA: gợi ý dán cookie');
    ui.warnReply = (_message, button) => button;
    ui.picks.push(items => items.find(item => item.label === 'Tên đăng nhập và mật khẩu'));
    ui.inputs.push('tfa', 'pw', good);
    await command('login');
    ui.warnReply = undefined;
    assert(ui.warnings.some(item => item.includes('2FA')), JSON.stringify(ui.warnings));
    assert(ui.infos.some(item => item.includes('nguyen-an')));
    assert.equal(await secret(), good);
    clear();

    step('nộp A: sửa chưa lưu, chọn C++20, ghi mốc tự động, polling ra AC');
    at(60);
    await command('source', 'A');
    const editor = vscode.window.activeTextEditor;
    assert(await editor.edit(edit => edit.insert(new vscode.Position(0, 0), '// CHUA-LUU-ABC\n')));
    ui.picks.push(items => items.find(item => item.label === 'C++20'));
    await command('submit', target('A'));
    assert.deepEqual(ui.errors, []);
    assert.deepEqual(mock.control.posts, ['p1']);
    const first = mock.submissions.get('1000');
    assert.equal(first.language, '2');
    assert.match(first.source, /CHUA-LUU-ABC/);
    assert(ui.infos.some(item => item.includes('Đã nộp bài A (#1000')));
    assert.deepEqual(boundary.context.globalState.get('olp.vnoj.languages'), { cpp: '2' });
    await waitJournal(/Kết quả \(lấy từ VNOJ\) · #1000 · AC · https:\/\/oj\.vnoi\.info\/submission\/1000/, 'verdict AC');
    assert.match(ui.clipboard, /\+00:01:00.*A.*Đã nộp \(tự động\) · #1000 · https:\/\/oj\.vnoi\.info\/submission\/1000/);
    await waitFor(() => ui.infos.some(item => item.includes('Bài A: AC (#1000)')), 'thông báo AC');

    step('nộp lại A: ngôn ngữ đã nhớ, không hỏi lại');
    clear();
    at(120);
    await command('submit', target('A'));
    assert.deepEqual(mock.control.posts, ['p1', 'p1']);
    assert.equal(mock.submissions.get('1001').language, '2');
    await command('language');
    assert.equal(boundary.context.globalState.get('olp.vnoj.languages'), undefined);

    step('nhấp đúp B: chỉ một POST; điểm một phần WA 40/100');
    clear();
    at(180);
    ui.picks.push(items => items[0]);
    await Promise.all([command('submit', target('B')), command('submit', target('B'))]);
    assert.equal(mock.control.posts.filter(item => item === 'partial').length, 1);
    assert.equal(mock.submissions.get('1002').language, '1');
    await waitJournal(/\| B \| .*Kết quả \(lấy từ VNOJ\) · #1002 · WA 40\/100/, 'verdict WA 40/100');
    await waitFor(() => ui.warnings.some(item => item.includes('Bài B: WA 40/100')), 'thông báo WA');

    step('D: quá nhiều bài chờ chấm (429), không ghi mốc nộp');
    clear();
    at(200);
    await command('submit', target('D'));
    assert(ui.errors.some(item => item.includes('quá nhiều')), JSON.stringify(ui.errors));
    assert.doesNotMatch(await journal(), /\| D \| Đã nộp/);
    clear();

    step('C: captcha, quay về mở trình duyệt và sao chép mã');
    at(210);
    await command('submit', target('C'));
    assert.deepEqual(ui.errors, []);
    assert.deepEqual(ui.opened, [production + '/problem/captcha/submit']);
    assert.equal(ui.clipboard.replace(/\r\n/g, '\n'), '// bài C\nint main(){}\n');
    assert(ui.infos.some(item => item.includes('captcha')));
    assert.match(await journal(), /\+00:03:30.*C.*Mở trang nộp/);
    clear();

    step('olp.submitBrowser giữ hành vi cũ');
    at(220);
    await command('submitBrowser', target('D'));
    assert.deepEqual(ui.opened, [production + '/problem/toomany/submit']);
    assert.match(await journal(), /\+00:03:40.*D.*Mở trang nộp/);
    assert.doesNotMatch(ui.clipboard, /\| D \| Đã nộp/);
    clear();

    step('phiên hết hạn: xoá secret, nhắc đăng nhập, không POST');
    mock.control.expired = true;
    const postsBefore = mock.control.posts.length;
    at(230);
    await command('submit', target('A'));
    assert(ui.warnings.some(item => item.includes('hết hạn')), JSON.stringify(ui.warnings));
    assert.equal(await secret(), undefined);
    assert.equal(mock.control.posts.length, postsBefore);
    mock.control.expired = false;
    clear();
    ui.picks.push(items => items.find(item => item.label === 'Dán cookie sessionid'));
    ui.inputs.push(good);
    await command('login');
    assert.equal(await secret(), good);
    clear();

    step('E: kết quả đến sau khi phiên đã kết thúc vẫn được ghi');
    at(240);
    ui.picks.push(items => items[0]);
    await command('submit', target('E'));
    assert(mock.control.posts.includes('hold'));
    at(300);
    await command('end');
    const ended = await journal();
    assert.match(ended, /Kết thúc/);
    assert.doesNotMatch(ended, /#1003 · TLE/);
    mock.control.released = true;
    await waitFor(async () => /\| E \| Kết quả \(lấy từ VNOJ\) · #1003 · TLE 55\/100/.test(await readReport(kit)), 'verdict sau giờ');
    const report = await readReport(kit);
    assert(report.indexOf('| Kết thúc |') < report.lastIndexOf('TLE 55/100'));
    assert.match(report, /A · [^|]*\| [\d:.]+ \| 2 \| AC \| \+00:01:/);
    assert.match(report, /B · [^|]*\| [\d:.]+ \| 1 \| WA 40\/100 \|/);
    assert.match(report, /E · [^|]*\| [\d:.]+ \| 1 \| TLE 55\/100 \|/);
    assert.match(report, /D · [^|]*\| [\d:.]+ \| 0 \| — \|/);

    assert.equal(mock.foreignLog.length, 0);
    assert(seenUrls.includes(production), 'No extension traffic attributed by stack boundary');
    assert(seenUrls.every(origin => origin === production), seenUrls.join());
    assert.deepEqual(ui.errors, []);
    step('xong');
    writeFileSync(result, 'PASS');
  } catch (error) {
    writeFileSync(result, error.stack + '\n' + JSON.stringify({ errors: ui.errors, warnings: ui.warnings, infos: ui.infos, opened: ui.opened }));
    throw error;
  } finally {
    globalThis.fetch = realFetch;
    mock.stop();
  }
};
