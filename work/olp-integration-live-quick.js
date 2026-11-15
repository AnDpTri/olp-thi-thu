'use strict';
// Runs ONLY in the isolated host created by Invoke-OlpLive. Never invokes submit/login/end.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const vscode = require('vscode'), boundary = require('./test-boundary');
const { guard, sensitiveFiles, safe } = require('./live-quick-tools');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const command = (name, ...args) => vscode.commands.executeCommand('olp.' + name, ...args);
exports.run = async function(options = {}) {
  const fixture = vscode.workspace.workspaceFolders[0].uri.fsPath, base = path.dirname(fixture);
  const out = path.resolve(__dirname, '../outputs/live-quick');
  fs.mkdirSync(out, { recursive: true });
  const report = { mode: options.mock ? 'mock' : 'live', startedAt: new Date().toISOString(), result: 'RUNNING', requests: [], problems: [], screenshots: [], warnings: [], errors: [], limitations: [
    'No request headers/bodies or secret storage read by the test. Request paths omit queries.',
    'Authentication retry inferred from status sequences; product does not expose per-request authentication metadata.',
    'Splitting confidence/ranges are reported, not a correctness assertion. Limits unavailable unless stored by the product.',
    'Only extension networking modules are traced; VS Code internal services and user browser traffic are outside this boundary.'
  ] };
  const say = text => fs.appendFileSync(path.join(base, 'live.log'), safe(text) + '\n');
  const save = () => {
    report.warnings = boundary.ui.warnings.map(safe); report.errors = boundary.ui.errors.map(safe);
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    const lines = ['# Thi thử ngay — ' + report.result, '', '- Chế độ: ' + report.mode, '- Bắt đầu: ' + report.startedAt,
      '- Kỳ thi: ' + (report.contest?.title ?? '(chưa tải)'), '- Số bài: ' + report.problems.length,
      '- Tài khoản hiển thị: ' + (report.account ?? '(chưa đăng nhập)'), '- Kết luận: ' + (report.reason ?? ''), '- Tệp đề: ' + (report.copiedKit ?? '(chưa có)'),
      '- Timer: ' + JSON.stringify(report.timer ?? null), '- Bố cục: ' + JSON.stringify(report.layout ?? null), '',
      '## Đề đã tải'];
    for (const p of report.problems) lines.push('', '### ' + p.key + ' · ' + p.name, '- VNOJ: ' + p.code + ' · ' + p.url,
      '- Nguồn: ' + p.source + '; trang: ' + JSON.stringify(p.pages) + '; tổng trang PDF: ' + p.pdfPageCount,
      '- Trang đã dựng: ' + p.renderedPages.join(', '), '- Giới hạn: ' + JSON.stringify(p.limits),
      '- Số mẫu: ' + p.sampleCount + '; kích thước (byte): ' + JSON.stringify(p.samples), '- Tab đề: ' + p.statementTab,
      '- Cảnh báo: ' + p.warnings.join(' | '), '', 'Trích statement.txt:', '', '```text', p.textPreview, '```');
    lines.push('', '## GET / trạng thái và dấu hiệu retry', '', '| Pha | Phương thức | Đường dẫn | HTTP |', '| --- | --- | --- | --- |');
    for (const r of report.requests) lines.push(`| ${r.phase} | ${r.method} | ${r.path} | ${r.status} |`);
    lines.push('', JSON.stringify(report.fetchStatusSequences ?? []), '', '## Thao tác nộp do người dùng', '', JSON.stringify(report.manualSubmissions ?? []), '', '## Cảnh báo / lỗi', ...report.warnings, ...report.errors, '', '## Phạm vi / giới hạn', ...report.limitations.map(s => '- ' + s), '', '## Ảnh', ...report.screenshots.map(s => '- [' + s + '](' + s + ')'));
    fs.writeFileSync(path.join(out, 'report.md'), safe(lines.join('\n')) + '\n');
  };
  let mock, manual = false, sequence = 0, cookieShown = false, cookieTimedOut = false;
  const realFetch = globalThis.fetch, win = boundary.vscode.window;
  const oldUI = { showInputBox: win.showInputBox, showQuickPick: win.showQuickPick, showInformationMessage: win.showInformationMessage };
  const state = () => boundary.context.workspaceState.get('olp.practice.v1');
  const tabs = () => vscode.window.tabGroups.all.map(g => ({ column: g.viewColumn, active: g.isActive, tabs: g.tabs.map(t => ({ label: t.label, file: t.input.uri?.fsPath, type: t.input.constructor.name })) }));
  async function capture(name) {
    const current = ++sequence;
    fs.writeFileSync(path.join(fixture, 'stage.json'), JSON.stringify({ sequence: current, name }));
    const end = Date.now() + 45000;
    while (!fs.existsSync(path.join(fixture, 'ack-' + current))) {
      if (Date.now() > end) throw Error('Screenshot timeout: ' + name + '; see capture-error.log in isolated directory.');
      await sleep(200);
    }
    for (const size of ['1366x768', '1920x1080']) {
      const filename = name + '-' + size + '.png';
      assert(fs.statSync(path.join(out, filename)).size > 1000, 'Screenshot empty: ' + filename);
      report.screenshots.push(filename);
    }
  }
  let logDir;
  const events = () => logDir && fs.existsSync(path.join(logDir, 'events.jsonl')) ? fs.readFileSync(path.join(logDir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse) : [];
  try {
    const link = new URL(options.contestUrl);
    assert(link.origin === 'https://oj.vnoi.info' && !link.username && !link.password && !link.search && !link.hash && /^\/contest\/[\w-]+(?:\/all)?\/?$/.test(link.pathname), 'Invalid contest URL');
    if (options.mock) {
      mock = await require('./mock-vnoj').createMock(link.origin).start();
      Object.assign(mock.control, { combined: true, requireAuth: true, requirePdfAuth: true, htmlSamples: true });
    }
    globalThis.fetch = guard((input, init) => {
      if (!mock) return realFetch(input, init);
      const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
      return realFetch(url.origin === link.origin ? mock.origin + url.pathname + url.search : input, init);
    }, report.requests, { manual: () => manual });
    win.showInputBox = async (inputOptions, token) => {
      if (manual) return vscode.window.showInputBox(inputOptions, token);
      if (inputOptions?.title === 'Đăng nhập VNOJ bằng cookie') {
        cookieShown = true;
        if (options.mock) return require('./mock-vnoj').good;
        say('Đang chờ hộp cookie thật (5 phút); Esc để dừng. Không tự nộp.');
        const cancel = new vscode.CancellationTokenSource();
        const subscription = token?.onCancellationRequested(() => cancel.cancel());
        const timeout = setTimeout(() => { cookieTimedOut = true; cancel.cancel(); }, 300000);
        try { return await vscode.window.showInputBox(inputOptions, cancel.token); }
        finally { clearTimeout(timeout); subscription?.dispose(); cancel.dispose(); }
      }
      assert.equal(inputOptions?.title, 'Tải đề VNOJ', 'Unexpected input box during quick flow');
      assert.equal(await inputOptions.validateInput?.(options.contestUrl), undefined, 'Contest link rejected');
      return options.contestUrl;
    };
    win.showQuickPick = async (items, pickOptions, token) => {
      if (manual) return vscode.window.showQuickPick(items, pickOptions, token);
      throw Error('Unexpected quick pick during fresh-profile quick start');
    };
    win.showInformationMessage = async (message, ...args) => {
      boundary.ui.infos.push(message);
      if (manual) return vscode.window.showInformationMessage(message, ...args);
      if (message.includes('ngay?')) return args.find(a => typeof a === 'string' && a === 'Bắt đầu');
      return undefined;
    };
    say('[1/4] olp.quick: link → cookie thật → tải/tách đề → bắt đầu');
    await command('quick');
    report.account = boundary.context.globalState.get('olp.vnoj.user'); // Displayed account only, never secrets.
    if (!report.account && cookieShown && !state()?.kit) {
      if (boundary.ui.errors.length) throw Error('Không đăng nhập được: ' + safe(boundary.ui.errors.at(-1)));
      report.result = 'CANCELLED'; report.reason = cookieTimedOut ? 'Hết 5 phút chờ cookie; chưa nhập đề, chưa bắt đầu phiên.' : 'Đã hủy hộp cookie; chưa nhập đề, chưa bắt đầu phiên.';
      return;
    }
    assert(state()?.kit?.problems?.length, 'Không tải được kỳ thi: tài khoản có thể chưa tham gia/không có quyền xem kỳ thi, hoặc VNOJ GET thất bại. ' + boundary.ui.errors.map(safe).join(' | '));
    const kit = state().kit, kitRoot = path.join(fixture, 'OLP-' + kit.id);
    report.contest = { title: kit.title, url: options.contestUrl, problems: kit.problems.length };
    report.copiedKit = 'kit/' + kit.id; // Each run retains its own statements; never mix stale samples from previous runs.
    const session = state().sessions.at(-1);
    assert(session && !session.end, 'Quick start did not start timer');
    logDir = path.join(kitRoot, '.olp', session.id);
    const startEvents = events().filter(e => /^(session_start|start|activity|focus)$/.test(e.type));
    assert(startEvents.some(e => e.type === 'session_start'), 'Missing session_start in events.jsonl');
    report.timer = { sessionId: session.id, start: session.start, deadline: session.deadline, startEvents };
    const mainTabs = tabs(), first = kit.problems[0];
    const has = (col, file) => mainTabs.find(g => g.column === col)?.tabs.some(t => t.file === path.join(kitRoot, first.key, file));
    assert.equal(mainTabs.length, 3, 'Expected three working groups: ' + JSON.stringify(mainTabs));
    assert(has(1, first.source) && has(2, 'input.txt') && has(3, 'output.txt'), 'Wrong working layout: ' + JSON.stringify(mainTabs));
    assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, path.join(kitRoot, first.key, first.source), 'Solution must have focus');
    report.layout = { passed: true, tabs: mainTabs, design: 'wide solution left; input above output right (geometry judged in screenshots)' };
    await capture('main-layout');
    say('[2/4] Thu thập đề, mẫu và ảnh từng tab đề');
    for (const p of kit.problems) {
      const dir = path.join(kitRoot, p.key), dest = path.join(out, 'kit', kit.id, p.key);
      fs.mkdirSync(dest, { recursive: true });
      const textFile = path.join(dir, 'statement.txt'), text = fs.existsSync(textFile) ? fs.readFileSync(textFile, 'utf8') : '';
      const pdf = fs.existsSync(path.join(dir, 'De-bai.pdf')) && fs.statSync(path.join(dir, 'De-bai.pdf')).size > 5;
      const images = p.rendered?.images ?? [];
      const item = { key: p.key, name: p.name, code: new URL(p.url).pathname.split('/').filter(Boolean).at(-1), url: p.url,
        source: pdf ? (p.pdfShared ? 'shared PDF' : 'own PDF') : text.trim() ? 'HTML/text fallback' : 'failure', pages: p.pages ?? null,
        pdfPageCount: p.pdfPages ?? null, renderedPages: images.map(i => i.number), textPreview: text.slice(0, 300), textBytes: Buffer.byteLength(text),
        samples: [], limits: { time: p.timeLimit ?? null, memory: p.memoryLimit ?? null, note: 'null = not exposed by product kit' },
        warnings: [p.pdfWarning, p.renderWarning].filter(Boolean), statementTab: false, nonEmpty: Boolean(text.trim() || pdf && images.length) };
      report.problems.push(item);
      for (const filename of fs.readdirSync(dir).filter(n => /^(?:De-bai\.pdf|statement\.txt|mau-\d+\.(?:in|out))$/.test(n))) {
        fs.copyFileSync(path.join(dir, filename), path.join(dest, filename));
        if (/^mau-/.test(filename)) item.samples.push({ file: filename, bytes: fs.statSync(path.join(dir, filename)).size });
      }
      for (const image of images) {
        const source = path.resolve(dir, image.file);
        assert(source.startsWith(path.resolve(dir) + path.sep) && source.endsWith('.png'), 'Rendered page escaped problem directory');
        const target = path.join(dest, 'statement-pages', path.basename(source));
        fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target);
      }
      item.sampleCount = item.samples.filter(s => s.file.endsWith('.in')).length;
      fs.writeFileSync(path.join(dest, 'statement-info.json'), JSON.stringify({ pages: item.pages, pdfPageCount: item.pdfPageCount, source: item.source }, null, 2));
      if (pdf) {
        await command('source', p.key); await command('statement'); await sleep(900);
        item.statementTab = vscode.window.tabGroups.all.flatMap(g => g.tabs).some(t => t.isActive && t.input instanceof vscode.TabInputWebview && t.label.startsWith(p.key + ' · '));
        assert(item.statementTab, 'No active statement webview for ' + p.key + ': ' + JSON.stringify(tabs()));
        await capture('statement-' + p.key);
        await command('statement');
      } else {
        await command('source', p.key); await command('statement');
        item.warnings.push('Không có PDF: lệnh đề có thể mở trình duyệt, không có tab đề cục bộ để chụp.');
      }
    }
    assert(report.problems.every(p => p.nonEmpty), 'Đề rỗng/thất bại: ' + report.problems.filter(p => !p.nonEmpty).map(p => p.key).join(', '));
    if (options.mock) {
      assert.equal(report.problems.length, 4, 'Mock must import all four problems');
      assert(report.problems.every(p => p.source === 'shared PDF'), 'Mock shared PDF not detected');
      assert(report.requests.some(r => r.path === '/pdf/combined.pdf' && r.status === 302), 'Mock PDF must require authenticated GET retry');
      assert(report.requests.some(r => r.path === '/pdf/combined.pdf' && r.status === 200), 'Authenticated PDF download missing');
    }
    await command('source', first.key);
    fs.writeFileSync(path.join(fixture, 'shots-done'), 'ok');
    assert(report.requests.every(r => r.method === 'GET' && r.phase === 'automatic' && r.status !== 'BLOCKED'), 'Automatic network policy violation');
    say('[3/4] Nhập đề / tab / timer / chỉ GET ... OK');
    if (options.keepOpenMinutes > 0) {
      manual = true;
      // Restore real prompts/clipboard/external links for the user's explicit interactions.
      const oldWarning = win.showWarningMessage, oldError = win.showErrorMessage;
      win.showWarningMessage = vscode.window.showWarningMessage; win.showErrorMessage = vscode.window.showErrorMessage;
      const oldEnv = { ...boundary.vscode.env };
      boundary.vscode.env.clipboard = vscode.env.clipboard; boundary.vscode.env.openExternal = vscode.env.openExternal;
      say('Giữ cửa sổ ' + options.keepOpenMinutes + ' phút. Bộ thử KHÔNG bấm nộp; bạn tự thao tác.');
      save();
      try { for (let remaining = options.keepOpenMinutes * 60; remaining > 0; remaining--) await sleep(1000); }
      finally { win.showWarningMessage = oldWarning; win.showErrorMessage = oldError; Object.assign(boundary.vscode.env, oldEnv); }
    }
    report.manualSubmissions = [];
    for (const entry of fs.readdirSync(path.join(kitRoot, '.olp'), { withFileTypes: true }).filter(e => e.isDirectory())) {
      const file = path.join(kitRoot, '.olp', entry.name, 'events.jsonl');
      if (!fs.existsSync(file)) continue;
      report.manualSubmissions.push(...fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse)
        .filter(e => /^(submission|submission_source|sent|verdict|result)$/.test(e.type))
        .map(e => ({ sessionId: entry.name, t: e.t, type: e.type, problem: e.problem, id: e.id ?? e.submission, verdict: e.verdict ?? e.text ?? null })));
    }
    report.result = 'PASS'; report.reason = 'Đã nhập ít nhất một bài; mọi bài có đề không rỗng; timer và bố cục đúng. Chất lượng tách đề cần xem ảnh.';
    say('[4/4] Hoàn tất; báo cáo và đề tại outputs/live-quick');
  } catch (error) {
    report.result = 'FAIL'; report.reason = safe(error.message);
    say('FAIL: ' + report.reason);
  } finally {
    fs.writeFileSync(path.join(fixture, 'shots-done'), 'ok');
    report.fetchStatusSequences = [...new Set(report.requests.map(r => r.path))].map(p => ({ path: p, statuses: report.requests.filter(r => r.path === p).map(r => r.status), interpretation: report.requests.some(r => r.path === p && [301,302,303,307,308,401,403].includes(r.status)) ? 'redirect/denied then retry possible; authentication inferred, not headers inspected' : 'public success or indistinguishable authenticated GET' }));
    report.finishedAt = new Date().toISOString();
    save();
    const leaks = [...sensitiveFiles(base), ...sensitiveFiles(out).map(f => 'outputs/live-quick/' + f)];
    report.sensitivePatternScan = { passed: leaks.length === 0, files: leaks, profileExcluded: true };
    if (leaks.length) { report.result = 'FAIL'; report.reason = 'Sensitive-pattern scan failed (paths only): ' + leaks.join(', '); }
    save();
    globalThis.fetch = realFetch; Object.assign(win, oldUI);
    if (mock) await mock.stop();
    fs.writeFileSync(path.join(base, 'live.result'), report.result === 'PASS' ? 'PASS' : report.result === 'CANCELLED' ? 'CANCELLED' : 'FAIL 1');
    say('LIVE QUICK ' + report.result + ': ' + (report.reason ?? ''));
  }
};
