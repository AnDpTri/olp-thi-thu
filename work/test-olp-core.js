'use strict';

// Kiểm thử thuần Node (không cần VS Code): runner, so sánh, template, báo cáo, bảng điểm, cảnh báo giờ.
//   node work\test-olp-core.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.join(__dirname, 'olp-vscode');
const runner = require(path.join(root, 'runner'));
const template = require(path.join(root, 'template'));
const timer = require(path.join(root, 'session'));

const tests = [];
const test = (name, body) => tests.push([name, body]);
const have = (command, args) => spawnSync(command, args, { windowsHide: true, stdio: 'ignore' }).status === 0;
const tmp = fs.mkdtempSync(path.join(__dirname, 'core-'));
const write = (name, text) => { const file = path.join(tmp, name); fs.writeFileSync(file, text); return file; };

test('so sánh bỏ qua khoảng trắng cuối dòng và dòng trống cuối', () => {
  assert(runner.compare('1 2\n3\n', '1 2  \r\n3\n\n\n').equal);
  assert(runner.compare('', '\n').equal);
  assert(runner.compare('a', 'a\n').equal);
  const diff = runner.compare('1\n2\n3\n', '1\n5\n3\n');
  assert.deepEqual([diff.equal, diff.line, diff.expected, diff.actual], [false, 2, '2', '5']);
  assert.equal(runner.compare('1\n2\n', '1\n').line, 2);
  assert(!runner.compare(' 1', '1').equal, 'khoảng trắng đầu dòng là khác');
});

test('parseDiagnostics: gcc, đường dẫn Windows, javac, bỏ ghi chú', () => {
  const text = [
    'A.cpp: In function \'int main()\':',
    'A.cpp:12:5: error: \'x\' was not declared in this scope',
    'A.cpp:13:9: warning: unused variable \'y\' [-Wunused-variable]',
    'C:\\kit\\A\\A.cpp:20:1: fatal error: nope.h: No such file or directory',
    'A.cpp:12:5: note: suggested alternative: \'z\'',
    'Main.java:3: error: \';\' expected'
  ].join('\n');
  const found = runner.parseDiagnostics(text);
  assert.equal(found.length, 4);
  assert.deepEqual(found[0], { file: 'A.cpp', line: 12, column: 5, severity: 'error', message: '\'x\' was not declared in this scope' });
  assert.equal(found[1].severity, 'warning');
  assert.equal(found[2].file, 'C:\\kit\\A\\A.cpp');
  assert.deepEqual([found[3].file, found[3].line, found[3].column], ['Main.java', 3, 1]);
});

test('describeExit: mã Windows và tín hiệu', () => {
  assert.match(runner.describeExit(3221225477, null), /segmentation/);
  assert.match(runner.describeExit(-1073741819, null), /segmentation/);
  assert.match(runner.describeExit(1, null), /^mã thoát 1$/);
  assert.match(runner.describeExit(null, 'SIGSEGV'), /SIGSEGV/);
});

test('template: chỗ giữ, vị trí con trỏ, nhiều ${cursor}', () => {
  const out = template.fill('// ${contest} ${problem} ${name} ${date}\nint main() {\n    ${cursor}\n}\n${cursor}x',
    { problem: 'B', name: 'Đường đi', contest: 'OLP', date: new Date(2026, 10, 14) });
  assert.equal(out.text, '// OLP B Đường đi 2026-11-14\nint main() {\n    \n}\nx');
  assert.deepEqual(out.cursor, { line: 2, character: 4 });
  assert.equal(template.fill('khong co').cursor, undefined);
  for (const [ext, text] of Object.entries(template.defaults)) {
    const filled = template.fill(text, { problem: 'A', name: 'x', contest: 'c' });
    assert(filled.cursor, ext);
    assert(!filled.text.includes('${'), ext);
  }
  assert.match(template.defaults.cpp, /sync_with_stdio/);
  assert.doesNotMatch(template.defaults.cpp, /for\s*\(|sort|vector</, 'template không chứa thuật toán');
});

const kit = { title: 'Kỳ thi | thử', problems: ['A', 'B', 'C', 'D'].map(key => ({ key, name: 'Bài ' + key })) };
const base = Date.parse('2026-11-14T07:00:00Z');
const at = seconds => base + seconds * 1000;
const sample = () => {
  const session = timer.start(kit, base, 's1', 120 * 60000);
  timer.activity(session, 'A', 'coding', at(10));
  timer.record(session, 'compile', 'A', at(20), { errors: 2 });
  timer.record(session, 'run', 'A', at(30), { status: 'OK', ms: 12.4 });
  timer.record(session, 'samples', 'A', at(40), { passed: 1, total: 2 });
  timer.record(session, 'samples', 'A', at(50), { passed: 2, total: 2 });
  timer.event(session, 'sent', at(60), { problem: 'A', submission: '1000', url: 'https://oj.vnoi.info/submission/1000', auto: true });
  timer.event(session, 'verdict', at(70), { problem: 'A', submission: '1000', url: 'https://oj.vnoi.info/submission/1000', text: 'AC', auto: true });
  timer.event(session, 'sent', at(80), { problem: 'B', submission: '1001', url: 'https://oj.vnoi.info/submission/1001', auto: true });
  timer.event(session, 'verdict', at(90), { problem: 'B', submission: '1001', text: 'WA 40/100', auto: true });
  timer.event(session, 'sent', at(100), { problem: 'B', submission: '1002', url: 'https://oj.vnoi.info/submission/1002', auto: true });
  timer.event(session, 'verdict', at(110), { problem: 'B', text: 'PAC 37.5/100' });
  timer.event(session, 'sent', at(120), { problem: 'C', submission: '1003', url: 'https://oj.vnoi.info/submission/1003', auto: true });
  timer.event(session, 'mark', at(130), { problem: 'C', text: 'Bị kẹt' });
  return session;
};

test('chấm điểm và bảng điểm', () => {
  assert.deepEqual(timer.score('AC'), { ac: true, points: null });
  assert.deepEqual(timer.score('WA 40/100'), { ac: false, points: 40 });
  assert.deepEqual(timer.score('37,5/100'), { ac: false, points: 37.5 });
  assert.deepEqual(timer.score('WA 1.234,5/2.000'), { ac: false, points: 1234.5 });
  assert.deepEqual(timer.score('CE'), { ac: false, points: null });
  assert.equal(timer.board(sample()), 'A ✓  B 40  C …  D –');
  const done = sample();
  timer.event(done, 'verdict', at(140), { problem: 'C', text: 'CE' });
  assert.equal(timer.board(done), 'A ✓  B 40  C ✗  D –');
  const standing = timer.standing(sample());
  assert.equal(standing.B.pending, 1, 'bài nộp 1002 chưa có kết quả theo mã');
  assert.equal(standing.A.pending, 0);
  assert.equal(standing.B.best.text, 'WA 40/100');
  const list = timer.submissions(sample());
  assert.deepEqual(list.B.map(item => [item.id, item.text, item.final]), [['1001', 'WA 40/100', true], ['1002', undefined, false]]);
});

test('thống kê: lần chạy, chạy mẫu, lỗi biên dịch; chạy không đổi thời gian theo bài', () => {
  const stats = timer.stats(sample(), at(200));
  assert.deepEqual([stats.A.runs, stats.A.samplesGood, stats.A.samplesBad, stats.A.compileErrors], [1, 1, 1, 1]);
  assert.equal(stats.A.coding, 190000);
  const plain = timer.start(kit, base, 's2');
  timer.activity(plain, 'A', 'coding', at(10));
  const before = timer.stats(plain, at(200)).A;
  timer.record(plain, 'run', 'A', at(50), { status: 'OK' });
  assert.deepEqual(timer.stats(plain, at(200)).A.coding, before.coding);
  assert.equal(timer.record(plain, 'run', 'A', base + 999 * 3600000, {}), false, 'sau giờ thi không ghi');
});

test('báo cáo: giờ địa phương, múi giờ, số lần, bài nộp, thời lượng theo phiên', () => {
  const session = sample();
  timer.finish(session, at(300), false);
  const text = timer.markdown(session, at(400), 420);
  assert.match(text, /- Bắt đầu 2026-11-14 14:00:00 \(UTC\+07:00, giờ địa phương\)/);
  assert.match(text, /Thời lượng 00:05:00 \/ 02:00:00/);
  assert.match(text, /Giờ \(UTC\+07:00\)/);
  assert.doesNotMatch(text, /Z \|/, 'không còn giờ UTC');
  assert.match(text, /\| \+00:00:10 \| 2026-11-14 14:00:10 \| A \| Viết mã \|/);
  assert.match(text, /\| A · Bài A \| [\d:]+ \| 1 \| AC \| \+00:01:10 \| [\d:]+ \| [\d:]+ \| [\d:]+ \| [\d:]+ \| 1 \| 1 \| 1 \| 1 \|/);
  assert.match(text, /\| A \| \+00:01:00 \| 2026-11-14 14:01:00 \| #1000 \| https:\/\/oj\.vnoi\.info\/submission\/1000 \| AC \|/);
  assert.match(text, /\| B \| \+00:01:40 \| 2026-11-14 14:01:40 \| #1002 \| .* \| chưa có kết quả \|/);
  assert.match(text, /Kỳ thi \\\| thử/);
  assert.match(text, /Chạy test mẫu · 1\/2 đúng/);
  assert.match(text, /Lỗi biên dịch · 2 lỗi/);
  assert.match(timer.markdown(session, at(400), -300), /\(UTC-05:00, giờ địa phương\)/);
  assert.equal(timer.offsetLabel(330), 'UTC+05:30');
});

test('báo cáo của phiên 0.5.1 (không có duration, không có sự kiện chạy) vẫn dựng được', () => {
  const old = { id: 'old', kit: { id: 'k', title: 'Cũ', problems: [{ key: 'A', name: 'A', source: 'A.cpp' }] }, start: base, deadline: base + 180 * 60000,
    events: [{ type: 'start', at: base }, { type: 'focus', at: base + 1000, problem: 'A' }], end: base + 5000 };
  const text = timer.markdown(old, base + 10000, 420);
  assert.match(text, /Thời lượng 00:00:05 \/ 03:00:00/);
  assert.match(text, /\| A · A \| 00:00:04 \| 0 \| — \| — \|/);
});

test('cảnh báo giờ: mốc nhỏ nhất vừa chạm, mỗi mốc một lần, màu theo độ gấp', () => {
  const given = new Set();
  const marks = [60, 30, 10, 5];
  assert.equal(timer.dueWarning(61 * 60000, marks, given), undefined);
  assert.equal(timer.dueWarning(60 * 60000, marks, given), 60);
  assert.equal(timer.dueWarning(59 * 60000, marks, given), undefined);
  assert.equal(timer.dueWarning(9 * 60000, marks, given), 30 === 30 ? 10 : 0, 'nhảy qua 30 và 10: báo mốc 10');
  assert.equal(timer.dueWarning(9 * 60000, marks, given), undefined);
  assert.equal(timer.dueWarning(5 * 60000, marks, given), 5);
  assert.equal(timer.urgency(11 * 60000), undefined);
  assert.equal(timer.urgency(10 * 60000), 'warning');
  assert.equal(timer.urgency(5 * 60000 + 1), 'warning');
  assert.equal(timer.urgency(5 * 60000), 'error');
});

test('phiên theo thời lượng cấu hình', () => {
  const session = timer.start(kit, base, 'x', 90 * 60000);
  assert.equal(session.deadline - session.start, 90 * 60000);
  assert.equal(timer.start(kit, base, 'y').deadline - base, 180 * 60000);
});

const cpp = have('g++', ['--version']);
const python = have('python', ['--version']);
const options = { cwd: tmp, timeoutMs: 3000 };

async function build(name, text, ext = 'cpp', settings) {
  const file = name + '.' + ext;
  write(file, text);
  const plan = runner.plan(ext, file, path.join(tmp, 'build'), settings);
  return { plan, compiled: await runner.compile(plan, { cwd: tmp, source: text }) };
}

const header = '#include <bits/stdc++.h>\nusing namespace std;\n';
test('C++: biên dịch + chạy đúng, đọc stdin, bỏ qua biên dịch lại khi không đổi', async () => {
  if (!cpp) return 'bỏ qua: không có g++';
  const text = header + 'int main(){long long a,b;cin>>a>>b;cout<<a+b<<"\\n";}\n';
  const { plan, compiled } = await build('ok', text);
  assert(compiled.ok, compiled.stderr);
  assert(!compiled.cached);
  const result = await runner.execute(plan, { ...options, input: '2 40\n' });
  assert.equal(result.status, 'OK');
  assert.equal(result.output.trim(), '42');
  assert.equal(runner.verdict(result, '42\n'), 'ĐÚNG');
  assert.equal(runner.verdict(result, '43\n'), 'SAI');
  const again = await runner.compile(plan, { cwd: tmp, source: text });
  assert(again.ok && again.cached);
  const changed = await runner.compile(plan, { cwd: tmp, source: text + '// đổi\n' });
  assert(changed.ok && !changed.cached);
});

test('C++: lỗi biên dịch có chẩn đoán đúng dòng', async () => {
  if (!cpp) return 'bỏ qua: không có g++';
  const { compiled } = await build('ce', header + 'int main(){\n  int a = ;\n  undefined_name = 3;\n}\n');
  assert(!compiled.ok);
  assert(compiled.errors >= 1);
  assert.equal(compiled.diagnostics[0].file, 'ce.cpp');
  assert.equal(compiled.diagnostics[0].line, 4);
  assert.equal(compiled.diagnostics[0].severity, 'error');
  assert(!fs.existsSync(path.join(tmp, 'build', 'ce.stamp')));
});

test('C++: lỗi lúc chạy (chia cho 0 / truy cập sai) là RTE có mô tả', async () => {
  if (!cpp) return 'bỏ qua: không có g++';
  const { plan, compiled } = await build('rte', header + 'int main(){int *p=nullptr; volatile int x=*p; cout<<x;}\n');
  assert(compiled.ok, compiled.stderr);
  const result = await runner.execute(plan, options);
  assert.equal(result.status, 'RTE');
  assert.notEqual(result.exitCode, 0);
  assert.equal(runner.verdict(result, ''), 'RTE');
  assert.match(runner.describeExit(result.exitCode, result.signal), /mã thoát|tín hiệu/);
  const exit = await build('exit', header + 'int main(){cout<<"x";return 7;}\n');
  const code = await runner.execute(exit.plan, options);
  assert.deepEqual([code.status, code.exitCode], ['RTE', 7]);
});

test('C++: vòng lặp vô hạn bị giết đúng hạn (TLE), tiến trình không còn sống', async () => {
  if (!cpp) return 'bỏ qua: không có g++';
  const { plan, compiled } = await build('loop', header + 'int main(){volatile long long x=0; while(true) x++; }\n');
  assert(compiled.ok, compiled.stderr);
  const started = Date.now();
  const result = await runner.execute(plan, { cwd: tmp, timeoutMs: 700 });
  const took = Date.now() - started;
  assert.equal(result.status, 'TLE');
  assert(result.timedOut);
  assert(took >= 650 && took < 4000, 'giết sau ' + took + ' ms');
  assert.equal(runner.verdict(result, ''), 'TLE');
  await new Promise(resolve => setTimeout(resolve, 300));
  if (process.platform === 'win32') {
    const list = spawnSync('tasklist', ['/FI', 'IMAGENAME eq loop.exe', '/NH'], { encoding: 'utf8', windowsHide: true }).stdout;
    assert.doesNotMatch(list, /loop\.exe/, 'loop.exe vẫn chạy');
  }
});

test('C++: dừng giữa chừng bằng AbortSignal', async () => {
  if (!cpp) return 'bỏ qua: không có g++';
  const { plan } = await build('loop', header + 'int main(){volatile long long x=0; while(true) x++; }\n');
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 300);
  const started = Date.now();
  const result = await runner.execute(plan, { cwd: tmp, timeoutMs: 20000, signal: controller.signal });
  assert(result.aborted && !result.timedOut);
  assert(Date.now() - started < 4000);
});

test('C++: đầu ra rất lớn bị cắt và dừng', async () => {
  if (!cpp) return 'bỏ qua: không có g++';
  const { plan } = await build('big', '#include <cstdio>\nint main(){for(;;) fputs("0123456789012345678901234567890123456789\\n", stdout);}\n');
  const result = await runner.execute(plan, { cwd: tmp, timeoutMs: 10000 });
  assert(result.truncated);
  assert.equal(result.status, 'RTE');
});

test('Python: chạy, so sánh, lỗi ném ngoại lệ là RTE, tiếng Việt qua stdin/stdout', async () => {
  if (!python) return 'bỏ qua: không có python';
  const { plan, compiled } = await build('p', 'import sys\nprint(sys.stdin.readline().strip()[::-1])\n', 'py');
  assert(compiled.ok && compiled.interpreted);
  const result = await runner.execute(plan, { ...options, input: 'xin chào\n' });
  assert.equal(result.output.trim(), 'oàhc nix');
  const bad = await build('pe', 'raise ValueError("x")\n', 'py');
  const failed = await runner.execute(bad.plan, options);
  assert.equal(failed.status, 'RTE');
  assert.match(failed.stderr, /ValueError/);
});

test('thiếu trình biên dịch / trình thông dịch: báo missing, không ném lỗi', async () => {
  const { compiled } = await build('m', 'int main(){}\n', 'cpp', { cpp: { compiler: 'khong-co-trinh-bien-dich-nay' } });
  assert.equal(compiled.ok, false);
  assert.equal(compiled.missing, true);
  assert.equal(compiled.command, 'khong-co-trinh-bien-dich-nay');
  const { plan } = await build('m2', 'print(1)\n', 'py', { py: { command: 'khong-co-python-nay' } });
  const result = await runner.execute(plan, options);
  assert.equal(result.missing, true);
  assert.equal(result.status, 'RTE');
});

test('C và Java nếu máy có công cụ', async () => {
  if (have('gcc', ['--version'])) {
    const { plan, compiled } = await build('c1', '#include <stdio.h>\nint main(){int a;scanf("%d",&a);printf("%d\\n",a*2);}\n', 'c');
    assert(compiled.ok, compiled.stderr);
    assert.equal((await runner.execute(plan, { ...options, input: '21' })).output.trim(), '42');
  }
  if (have('javac', ['-version'])) {
    fs.mkdirSync(path.join(tmp, 'J'), { recursive: true });
    const file = 'Main.java';
    const text = 'public class Main { public static void main(String[] a){ System.out.println(6*7); } }\n';
    fs.writeFileSync(path.join(tmp, 'J', file), text);
    const plan = runner.plan('java', file, path.join(tmp, 'build'));
    const compiled = await runner.compile(plan, { cwd: path.join(tmp, 'J'), source: text });
    assert(compiled.ok, compiled.stderr);
    assert.equal((await runner.execute(plan, { cwd: path.join(tmp, 'J'), timeoutMs: 8000 })).output.trim(), '42');
    fs.writeFileSync(path.join(tmp, 'J', file), 'class Main { void f( }');
    const failed = await runner.compile(plan, { cwd: path.join(tmp, 'J'), source: 'class Main { void f( }' });
    assert(!failed.ok && failed.diagnostics[0]?.file === 'Main.java', JSON.stringify(failed));
  }
});

(async () => {
  let failed = 0;
  const selected = process.argv.includes('--pure') ? tests.slice(0, 10) : tests;
  const probe = selected.length > 10 ? await runner.exec(process.execPath, ['--version']) : undefined;
  for (const [name, body] of selected) {
    try {
      if (tests.findIndex(test => test[0] === name) >= 10 && probe?.error?.code === 'EPERM') {
        throw new Error('BLOCKED by sandbox: Node piped child process spawn EPERM (compiler availability checked separately)');
      }
      const note = await body();
      console.log('ok   ' + name + (note ? ' (' + note + ')' : ''));
    } catch (error) {
      failed++;
      console.log('LỖI  ' + name + '\n' + (error.stack ?? error));
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? failed + ' kiểm thử lỗi' : 'tất cả ' + selected.length + ' kiểm thử đạt');
  if (selected.length !== tests.length) console.log('NOT RUN: ' + (tests.length - selected.length) + ' process execution checks (--pure)');
  process.exitCode = failed ? 1 : 0;
})();
