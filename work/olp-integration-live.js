'use strict';

// Chạy trong extension host thật (xem olp-live-common.ps1). Hai chế độ:
//  - run({})                          : THẬT. fetch toàn cục không bị đổi hướng, đi thẳng tới https://oj.vnoi.info.
//                                       Hộp nhập sessionid là hộp VS Code thật, người dùng tự dán cookie.
//  - run({ mock: true, scenario })    : chỉ để kiểm chứng logic của bộ thử, VNOJ được thay bằng mock-vnoj.js.
// Bộ thử không bao giờ đọc context.secrets và không bao giờ nhìn thấy giá trị sessionid: hộp nhập được chuyển thẳng
// cho VS Code và kết quả trả thẳng cho tiện ích. Bộ ghi fetch chỉ giữ phương thức, origin, đường dẫn và mã trạng thái.
const assert = require('node:assert/strict');
const { appendFileSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const vscode = require('vscode');
const boundary = require('./test-boundary');

const { ui } = boundary;
const production = 'https://oj.vnoi.info';
const problemUrl = production + '/problem/icpc26_na_e';
const submitPath = '/problem/icpc26_na_e/submit';
const cookieTitle = 'Đăng nhập VNOJ bằng cookie';
const cookieWait = 5 * 60 * 1000;
const verdictWait = 4 * 60 * 1000;
const total = 10;

// Bài ICPC 2026 vòng Quốc gia - E "Easy Math" và lời giải C++ đúng, lấy nguyên văn từ live-test.js.
const source = `#include <bits/stdc++.h>
using namespace std;
int main() {
    int k;
    if (!(cin >> k)) return 0;
    int best = INT_MAX;
    for (int x = 100; x <= 999; x++) {
        for (int y = 100; y <= 999; y++) {
            if (y / 100 != k * (x % 10)) continue;
            int d[6] = {x / 100, x / 10 % 10, x % 10, y / 100, y / 10 % 10, y % 10};
            bool ok = true;
            for (int i = 0; i < 6; i++)
                for (int j = i + 1; j < 6; j++)
                    if (d[i] == d[j]) ok = false;
            if (ok) best = min(best, x + y);
        }
    }
    cout << best << "\\n";
}
`;

const command = (name, ...args) => vscode.commands.executeCommand('olp.' + name, ...args);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function waitFor(check, name, timeout) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await sleep(700);
  }
  throw new Error('Quá thời gian chờ: ' + name);
}

// Chỉ ghi phương thức, origin, đường dẫn (không query) và mã trạng thái. Không đọc header, không đọc thân.
function recorder(inner, log) {
  return async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
    const entry = { method: String(init?.method ?? input?.method ?? 'GET').toUpperCase(), origin: url.origin, path: url.pathname, status: 'ERR' };
    log.push(entry);
    const response = await inner(input, init);
    entry.status = response.status;
    return response;
  };
}

exports.run = async function (options = {}) {
  const mockMode = options.mock === true;
  const scenario = options.scenario ?? 'ok';
  const root = vscode.workspace.workspaceFolders[0].uri;
  const base = dirname(root.fsPath);
  const logFile = join(base, 'live.log');
  const resultFile = join(base, 'live.result');
  const stepFile = join(base, 'live.step');
  const say = text => { appendFileSync(logFile, text + '\n', 'utf8'); console.log('[live-test] ' + text); };

  const requests = [];
  const realFetch = globalThis.fetch;
  let mock;
  if (mockMode) {
    const { createMock } = require('./mock-vnoj');
    mock = await createMock(production).start();
    mock.control.pdf = scenario === 'pdf';
    if (scenario === 'wa') mock.control.outcome = ['WA', '40 / 100'];
    globalThis.fetch = recorder((input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
      return realFetch(url.origin === production ? mock.origin + url.pathname + url.search : url, init);
    }, requests);
  } else {
    globalThis.fetch = recorder(realFetch, requests);
  }

  // Các hộp thoại: mọi thứ đều có đáp án dựng sẵn, trừ hộp sessionid (thật khi chạy live).
  const picks = [];
  const unexpected = [];
  const cookie = { shown: false, timedOut: false };
  const window = boundary.vscode.window;
  window.showQuickPick = async items => {
    const pick = picks.shift();
    if (!pick) { unexpected.push('quick pick: ' + JSON.stringify((await items).map(item => item.label ?? String(item)))); return undefined; }
    return pick(await items);
  };
  window.showInputBox = async (options, token) => {
    if (options?.title === cookieTitle) {
      cookie.shown = true;
      if (mockMode) {
        const value = scenario === 'badcookie' ? 'deadbeefdeadbeefdeadbeefdeadbeef' : require('./mock-vnoj').good;
        assert.equal(await options.validateInput?.(value), undefined);
        return value;
      }
      const cancel = new vscode.CancellationTokenSource();
      token?.onCancellationRequested?.(() => cancel.cancel());
      const timer = setTimeout(() => { cookie.timedOut = true; cancel.cancel(); }, cookieWait);
      try {
        // Chuyển thẳng cho VS Code: bộ thử không giữ, không in, không kiểm tra giá trị.
        return await vscode.window.showInputBox(options, cancel.token);
      } finally {
        clearTimeout(timer);
        cancel.dispose();
      }
    }
    if (options?.title === 'Tải đề VNOJ') {
      assert.equal(await options.validateInput?.(problemUrl), undefined);
      return problemUrl;
    }
    unexpected.push('input box: ' + options?.title);
    return undefined;
  };

  let current = 0;
  let finished = false;
  const state = {};
  const journal = async () => { await command('copy'); return ui.clipboard; };
  const user = () => boundary.context.globalState.get('olp.vnoj.user');
  const menuLabels = async () => {
    let labels;
    picks.push(items => { labels = items.map(item => item.label); return undefined; });
    await command('menu');
    return labels;
  };
  async function step(number, name, action) {
    current = number;
    writeFileSync(stepFile, String(number));
    const before = { errors: ui.errors.length, unexpected: unexpected.length };
    try {
      const detail = await action();
      assert.equal(unexpected.length, before.unexpected, 'Hộp thoại ngoài dự kiến: ' + unexpected.slice(before.unexpected).join('; '));
      assert.equal(ui.errors.length, before.errors, 'Tiện ích báo lỗi: ' + ui.errors.slice(before.errors).join(' | '));
      say('[' + number + '/' + total + '] ' + name + ' ... OK' + (detail ? ' — ' + detail : ''));
    } catch (error) {
      say('[' + number + '/' + total + '] ' + name + ' ... LỖI — ' + (error.message ?? error).toString().split('\n')[0]);
      throw error;
    }
  }

  async function readReport(kit) {
    const [report] = (await vscode.workspace.fs.readDirectory(kit)).filter(([name]) => /^phien-.*\.md$/.test(name));
    assert(report, 'chưa có tệp báo cáo');
    return Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(kit, report[0]))).toString();
  }

  try {
    await step(1, 'Khởi động tiện ích', async () => {
      const extension = vscode.extensions.getExtension('olp-local.olp-practice');
      await extension.activate();
      const list = await vscode.commands.getCommands(true);
      for (const id of ['olp.login', 'olp.logout', 'olp.import', 'olp.submit', 'olp.start', 'olp.end', 'olp.copy']) assert(list.includes(id), id);
      assert.equal(user(), undefined, 'hồ sơ thử nghiệm phải chưa đăng nhập');
      return 'phiên bản ' + extension.packageJSON.version + (mockMode ? ' (CHẾ ĐỘ MOCK: ' + scenario + ')' : ', mạng thật tới ' + production);
    });

    await step(2, 'Đăng nhập bằng cookie sessionid dán vào hộp VS Code', async () => {
      if (!mockMode) say('    Đang chờ bạn dán sessionid trong cửa sổ VS Code (tối đa 5 phút) ...');
      picks.push(items => items.find(item => item.label === 'Dán cookie sessionid'));
      await command('login');
      assert(cookie.shown, 'hộp "' + cookieTitle + '" không hiện ra');
      assert(!cookie.timedOut, 'Hết 5 phút chờ cookie. Dừng, không nộp bài nào.');
      if (!user()) {
        const reason = ui.errors.at(-1);
        throw new Error(reason ?? 'Không đăng nhập được (bạn đã hủy hộp nhập cookie?). Dừng, không nộp bài nào.');
      }
      state.user = user();
      assert(ui.infos.some(item => item.includes('Đã đăng nhập VNOJ với tài khoản ' + state.user)), 'thiếu thông báo đăng nhập');
      assert((await menuLabels()).includes('Đăng xuất VNOJ'), 'menu chưa hiện Đăng xuất VNOJ');
      return 'tài khoản ' + state.user;
    });

    await step(3, 'Chuẩn bị bộ đề bằng olp.import (link một bài, chọn C++)', async () => {
      picks.push(items => items.find(item => item.label === 'C++'));
      await command('import');
      const folders = (await vscode.workspace.fs.readDirectory(root)).filter(([name]) => name.startsWith('OLP-'));
      assert.equal(folders.length, 1, 'phải có đúng một thư mục OLP-*');
      state.kit = vscode.Uri.joinPath(root, folders[0][0]);
      await vscode.workspace.fs.stat(vscode.Uri.joinPath(state.kit, 'A', 'A.cpp'));
      assert(ui.infos.some(item => item.includes('Đã chuẩn bị 1 bài')), JSON.stringify(ui.infos));
      const pdf = await vscode.workspace.fs.stat(vscode.Uri.joinPath(state.kit, 'A', 'De-bai.pdf')).then(() => true, () => false);
      const message = ui.infos.find(item => item.includes('Đã chuẩn bị 1 bài'));
      if (mockMode) assert.equal(pdf, scenario === 'pdf');
      return folders[0][0] + '/A/A.cpp, ' + (pdf ? 'có' : 'không có') + ' PDF cục bộ (' + message.replace(/^OLP · /, '') + ')';
    });

    await step(4, 'Bắt đầu phiên 180 phút', async () => {
      await command('start');
      assert.match(await journal(), /\| Bắt đầu \|/);
      return 'phiên chạy, đồng hồ thật';
    });

    await step(5, 'Đặt lời giải vào editor, KHÔNG lưu', async () => {
      await command('source', 'A');
      const editor = vscode.window.activeTextEditor;
      assert(editor && editor.document.uri.fsPath.endsWith('A.cpp'), 'editor đang mở không phải A.cpp');
      // 0.6.0: tệp lời giải mới chứa template, nên thay toàn bộ nội dung bằng lời giải; đĩa vẫn giữ template.
      const onDiskBefore = Buffer.from(await vscode.workspace.fs.readFile(editor.document.uri)).toString();
      assert.match(onDiskBefore, /sync_with_stdio/, 'tệp mới phải có template');
      assert(await editor.edit(edit => edit.replace(new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(editor.document.getText().length)), source)));
      assert(editor.document.isDirty, 'tài liệu phải ở trạng thái chưa lưu');
      const onDisk = Buffer.from(await vscode.workspace.fs.readFile(editor.document.uri)).toString();
      assert.equal(onDisk, onDiskBefore, 'tệp trên đĩa phải còn nguyên template');
      return source.length + ' ký tự trong buffer chưa lưu, tệp trên đĩa còn template';
    });

    await step(6, 'Nộp bài bằng olp.submit (một lần duy nhất, C++20) và mốc "sent" tự động', async () => {
      const chosen = {};
      picks.push(items => {
        const item = items.find(entry => entry.label === 'C++20');
        chosen.labels = items.map(entry => entry.label);
        if (item) { chosen.label = item.label; chosen.id = item.option.id; }
        return item;
      });
      await command('submit', { problem: { key: 'A', url: problemUrl } });
      assert(chosen.label, 'không có ngôn ngữ "C++20" trong form; có: ' + chosen.labels);
      assert.deepEqual(ui.warnings, [], 'cảnh báo: ' + ui.warnings.join(' | '));
      const sent = (await journal()).match(/Đã nộp \(tự động\) · #(\d+) · (https:\/\/oj\.vnoi\.info\/submission\/\d+)/);
      assert(sent, 'chưa có mốc "Đã nộp (tự động)" trong nhật ký');
      [, state.id, state.url] = sent;
      assert(ui.infos.some(item => item.includes('Đã nộp bài A (#' + state.id + ', C++20)')), 'thiếu thông báo đã nộp');
      assert.equal(requests.filter(item => item.method === 'POST' && item.path === submitPath).length, 1);
      return 'ngôn ngữ ' + chosen.label + ' (id ' + chosen.id + '), bài nộp #' + state.id + ' ' + state.url;
    });

    await step(7, 'Chờ kết quả tự động (polling thật), phải là AC', async () => {
      if (!mockMode) say('    Đang chờ VNOJ chấm (tối đa ~3 phút) ...');
      const pattern = new RegExp('Kết quả \\(lấy từ VNOJ\\) · #' + state.id + ' · (.+?) · ' + escapeRegExp(state.url));
      const verdict = await waitFor(async () => {
        const late = ui.infos.find(item => item.includes('chưa chấm xong sau 3 phút')) ??
          ui.warnings.find(item => item.includes('Không lấy được kết quả'));
        if (late) throw new Error(late);
        return (await journal()).match(pattern);
      }, 'kết quả của #' + state.id, verdictWait);
      state.verdict = verdict[1];
      const polls = requests.filter(item => item.path === '/widgets/single_submission').length;
      assert.equal(state.verdict, 'AC', 'kết quả là "' + state.verdict + '", không phải AC');
      await waitFor(() => ui.infos.some(item => item.includes('Bài A: AC (#' + state.id + ')')), 'thông báo AC', 10000);
      return 'AC sau ' + polls + ' lần hỏi, mốc "Kết quả (lấy từ VNOJ)" đã ghi';
    });

    await step(8, 'Kết thúc phiên, kiểm tra báo cáo Markdown (olp.copy và tệp)', async () => {
      await command('end');
      assert(ui.infos.some(item => item.includes('Đã kết thúc phiên')), 'thiếu thông báo kết thúc');
      const copied = await journal();
      assert(ui.infos.some(item => item.includes('Đã sao chép báo cáo Markdown')));
      const written = await readReport(state.kit);
      for (const [name, text] of [['olp.copy', copied], ['tệp báo cáo', written]]) {
        assert(text.includes('#' + state.id), name + ': thiếu mã bài nộp');
        assert(text.includes(state.url), name + ': thiếu liên kết bài nộp');
        assert(text.includes('Đã nộp (tự động) · #' + state.id), name + ': thiếu mốc nộp tự động');
        assert(text.includes('Kết quả (lấy từ VNOJ) · #' + state.id + ' · AC'), name + ': thiếu mốc kết quả AC');
        assert.match(text, /\| A · .*? \| [\d:.]+ \| 1 \| AC \|/, name + ': dòng bài A phải có 1 lần nộp và AC');
        assert.match(text, /\| Kết thúc \|/, name + ': thiếu mốc Kết thúc');
      }
      return 'cả hai báo cáo có #' + state.id + ', liên kết, 1 lần nộp và AC';
    });

    await step(9, 'Đăng xuất (olp.logout) và giao diện hiện chưa đăng nhập', async () => {
      assert((await menuLabels()).includes('Đăng xuất VNOJ'));
      await command('logout');
      assert.equal(user(), undefined, 'olp.vnoj.user vẫn còn');
      assert(ui.infos.some(item => item.includes('Đã đăng xuất VNOJ khỏi VS Code')));
      const labels = await menuLabels();
      assert(labels.includes('Đăng nhập VNOJ') && !labels.includes('Đăng xuất VNOJ'), 'menu: ' + labels);
      finished = true;
      return 'menu hiện "Đăng nhập VNOJ", tên tài khoản đã xóa';
    });

    await step(10, 'Kiểm tra yêu cầu mạng', async () => {
      const bad = requests.filter(item => item.origin !== production);
      assert.equal(bad.length, 0, 'yêu cầu tới origin khác: ' + bad.map(item => item.origin).join());
      const posts = requests.filter(item => item.method === 'POST');
      assert.deepEqual(posts.map(item => item.path), [submitPath], 'POST: ' + posts.map(item => item.path));
      assert.equal(posts.filter(item => item.path === '/accounts/logout/').length, 0);
      assert.equal(posts.filter(item => item.path === '/accounts/login/').length, 0);
      if (mockMode) { assert.deepEqual(mock.control.posts, ['icpc26_na_e']); assert.equal(mock.foreignLog.length, 0); }
      return requests.length + ' yêu cầu, tất cả tới ' + production + '; đúng 1 POST (' + submitPath + '), không POST đăng nhập/đăng xuất';
    });

    writeFileSync(resultFile, 'PASS');
  } catch (error) {
    say('    Danh sách yêu cầu mạng đã ghi (phương thức, đường dẫn, trạng thái):');
    for (const item of requests) say('      ' + item.method + ' ' + item.origin + item.path + ' -> ' + item.status);
    if (!requests.length) say('      (không có)');
    if (ui.errors.length || ui.warnings.length) say('    Thông báo lỗi/cảnh báo: ' + JSON.stringify({ errors: ui.errors, warnings: ui.warnings }));
    writeFileSync(resultFile, 'FAIL ' + current);
    throw error;
  } finally {
    if (!finished) await cleanup();
    globalThis.fetch = realFetch;
    mock?.stop();
    // Bỏ phần chưa lưu để cửa sổ đóng được mà không hỏi lưu.
    for (const document of vscode.workspace.textDocuments.filter(item => item.isDirty)) {
      await vscode.window.showTextDocument(document);
      await vscode.commands.executeCommand('workbench.action.files.revert');
    }
    await sleep(1000);
  }

  // Xóa cookie đã lưu trong hồ sơ thử nghiệm nếu bước đăng xuất chưa chạy (cookie dán không gây POST phía máy chủ).
  async function cleanup() {
    try { if (user()) await command('logout'); } catch { /* bỏ qua */ }
  }
};
