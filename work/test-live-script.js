'use strict';

// Thử live-test.js với mock VNOJ trên 127.0.0.1 (không chạm oj.vnoi.info). Chạy: node work\test-live-script.js
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const path = require('node:path');
const { createMock, good } = require('./mock-vnoj');
const live = require(path.join(__dirname, 'live-test.js'));

const password = 'correct horse';
const mock = createMock();
const answers = list => async prompt => {
  const next = list.shift();
  if (next === undefined) throw new Error('hết câu trả lời cho: ' + prompt);
  return next;
};
let captured;
const outOf = () => (captured = []);
const text = () => captured.join('\n');
const base = () => ({ origin: mock.origin, interval: 20, timeout: 5000, out: line => captured.push(line) });
const posts = () => mock.control.posts.length;
const logouts = () => mock.log.filter(item => item.method === 'POST' && item.path === '/accounts/logout/').length;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// Bắt mọi thứ ghi ra stdout/stderr thật trong lúc chạy để chắc chắn không lộ bí mật.
async function withStreams(fn) {
  const chunks = [];
  const out = process.stdout.write;
  const err = process.stderr.write;
  process.stdout.write = (chunk, ...rest) => { chunks.push(String(chunk)); return true; };
  process.stderr.write = (chunk, ...rest) => { chunks.push(String(chunk)); return true; };
  try {
    return [await fn(), chunks.join('')];
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
  }
}

test('mật khẩu: đạt, đúng một POST, đăng xuất phía máy chủ, không lộ bí mật', async () => {
  outOf();
  const before = [posts(), logouts()];
  const [code, streams] = await withStreams(() => live.run({
    ...base(), problemUrl: 'https://oj.vnoi.info/problem/p1',
    ask: answers(['y', '1', 'nguyen-an', password]), out: undefined
  }));
  assert.equal(code, 0, streams);
  assert.match(streams, /Sẽ nộp 1 bài C\+\+ cho bài Easy Math \(ICPC 2026 vòng Quốc gia - E\) \(https:\/\/oj\.vnoi\.info\/problem\/p1\) bằng tài khoản của bạn\./);
  for (const line of [/\[1\/6\] Đăng nhập \.\.\. OK — VNOJ báo tài khoản: nguyen-an/, /\[2\/6\] .* 4 ngôn ngữ, chọn "C\+\+17" \(id 1\)/,
    /\[3\/6\] .* OK — bài nộp #\d+ http/, /QU/, /\(xong\)/, /\[4\/6\].*kết quả cuối: AC/, /\[5\/6\].* OK/, /\[6\/6\].* OK/, /KẾT QUẢ: ĐẠT/]) {
    assert.match(streams, line);
  }
  assert.equal(posts() - before[0], 1);
  assert.equal(logouts() - before[1], 1);
  assert(!streams.includes(password) && !streams.includes(good), 'lộ bí mật ra stdout/stderr');
  const sent = mock.submissions.get(String(1000 + before[0]));
  assert.equal(sent.language, '1');
  assert.match(sent.source, /int main\(\)/);
});

test('cookie dán: đạt, không đăng xuất phía máy chủ', async () => {
  const before = [posts(), logouts()];
  const [code, streams] = await withStreams(() => live.run({
    ...base(), problemUrl: 'https://oj.vnoi.info/problem/p1', ask: answers(['Y', '2', good]), out: undefined
  }));
  assert.equal(code, 0, streams);
  assert.match(streams, /bỏ qua \(cookie dán/);
  assert.equal(posts() - before[0], 1);
  assert.equal(logouts(), before[1]);
  assert(!streams.includes(good));
});

test('từ chối ở câu hỏi Tiếp tục: không gửi gì', async () => {
  const before = mock.log.length;
  outOf();
  const code = await live.run({ ...base(), ask: answers(['n']) });
  assert.equal(code, 2);
  assert.match(text(), /KẾT QUẢ: ĐÃ HỦY/);
  assert.equal(mock.log.length, before);
});

test('sai mật khẩu: lỗi bước 1, chẩn đoán, không POST nộp bài, thoát khác 0', async () => {
  outOf();
  const before = posts();
  const code = await live.run({ ...base(), ask: answers(['y', '1', 'nguyen-an', 'wrong-password-xyz']) });
  assert.equal(code, 1);
  assert.match(text(), /\[1\/6\] Đăng nhập \.\.\. LỖI/);
  assert.match(text(), /Mã lỗi: badlogin/);
  assert.match(text(), /Phản hồi cuối: POST \/accounts\/login\/ → HTTP 200/);
  assert.match(text(), /\[6\/6\].*bỏ qua \(chưa có phiên\)/);
  assert.match(text(), /KẾT QUẢ: LỖI ở bước 1/);
  assert(!text().includes('wrong-password-xyz'));
  assert.equal(posts(), before);
});

test('cookie sai hoặc hết hạn: bước 1', async () => {
  outOf();
  const code = await live.run({ ...base(), ask: answers(['y', '2', 'deadbeefdeadbeef0000']) });
  assert.equal(code, 1);
  assert.match(text(), /Mã lỗi: auth/);
  assert(!text().includes('deadbeefdeadbeef0000'));
});

test('bị chặn 429 ở bước 3: một POST, không thử lại, vẫn đăng xuất', async () => {
  outOf();
  const before = [mock.log.filter(item => item.method === 'POST' && /toomany\/submit/.test(item.path)).length, logouts()];
  const code = await live.run({ ...base(), problemUrl: 'https://oj.vnoi.info/problem/toomany', ask: answers(['y', '1', 'nguyen-an', password]) });
  assert.equal(code, 1);
  assert.match(text(), /\[3\/6\] .* LỖI/);
  assert.match(text(), /Mã lỗi: rate/);
  assert.match(text(), /Phản hồi cuối: POST \/problem\/toomany\/submit → HTTP 429/);
  assert.match(text(), /\[6\/6\].* OK/);
  assert.match(text(), /KẾT QUẢ: LỖI ở bước 3/);
  assert.equal(mock.log.filter(item => item.method === 'POST' && /toomany\/submit/.test(item.path)).length - before[0], 1);
  assert.equal(logouts() - before[1], 1);
});

test('kết quả không phải AC: lỗi bước 5; hết giờ chờ: bước 4', async () => {
  outOf();
  let code = await live.run({ ...base(), problemUrl: 'https://oj.vnoi.info/problem/partial', ask: answers(['y', '1', 'nguyen-an', password]) });
  assert.equal(code, 1);
  assert.match(text(), /WA 40\/100/);
  assert.match(text(), /KẾT QUẢ: LỖI ở bước 5/);
  outOf();
  code = await live.run({ ...base(), timeout: 200, problemUrl: 'https://oj.vnoi.info/problem/never', ask: answers(['y', '2', good]) });
  assert.equal(code, 1);
  assert.match(text(), /Mã lỗi: timeout/);
  assert.match(text(), /KẾT QUẢ: LỖI ở bước 4/);
});

test('captcha và chuyển hướng ra ngoài hiện chẩn đoán không bí mật', async () => {
  outOf();
  await live.run({ ...base(), problemUrl: 'https://oj.vnoi.info/problem/captcha', ask: answers(['y', '2', good]) });
  assert.match(text(), /Mã lỗi: captcha/);
  assert.match(text(), /KẾT QUẢ: LỖI ở bước 2/);
  outOf();
  await live.run({ ...base(), problemUrl: 'https://oj.vnoi.info/problem/foreign', ask: answers(['y', '2', good]) });
  assert.match(text(), /Phản hồi cuối: POST \/problem\/foreign\/submit → HTTP 302, chuyển hướng tới \(origin khác\) 127\.0\.0\.1:\d+\/submission\/1/);
  assert.equal(mock.foreignLog.length, 0);
  assert(!text().includes(good));
});

test('mã nguồn đóng gói đúng: mẫu k=2 cho 537 (tính lại bằng JS cùng thuật toán)', () => {
  const solve = k => {
    let best = Infinity;
    for (let x = 100; x < 1000; x++) for (let y = 100; y < 1000; y++) {
      if (Math.floor(y / 100) !== k * (x % 10)) continue;
      if (new Set(String(x) + String(y)).size === 6) best = Math.min(best, x + y);
    }
    return best;
  };
  assert.equal(solve(2), 537);
  assert.match(live.source, /y \/ 100 != k \* \(x % 10\)/);
  assert.match(live.source, /cout << best << "\\n";/);
});

function fakeTerminal() {
  const stdin = new PassThrough();
  stdin.isTTY = true;
  stdin.rawModes = [];
  stdin.setRawMode = value => stdin.rawModes.push(value);
  const written = [];
  return { stdin, stdout: { write: chunk => written.push(String(chunk)) }, written };
}

test('terminal: bí mật không hiện gì, Backspace, Enter, khôi phục chế độ thô', async () => {
  const fake = fakeTerminal();
  const term = live.createTerminal(fake);
  const pending = term.ask('Mật khẩu: ', true);
  fake.stdin.write('ab');
  fake.stdin.write('\u007fcd\u001b[A\r');
  assert.equal(await pending, 'acd');
  assert.equal(fake.written.join(''), 'Mật khẩu: \n');
  const visible = term.ask('Tên: ', false);
  fake.stdin.write('xy\u007fz\n');
  assert.equal(await visible, 'xz');
  assert.match(fake.written.join(''), /xy\x08 \x08z/);
  term.close();
  assert.deepEqual(fake.stdin.rawModes, [true, false]);
});

test('terminal: Ctrl+C hủy và trả về chế độ thường; dán nhiều dòng một lần', async () => {
  let fake = fakeTerminal();
  let term = live.createTerminal(fake);
  const pending = term.ask('Mật khẩu: ', true);
  fake.stdin.write('abc\u0003');
  await assert.rejects(pending, /Ctrl\+C/);
  term.close();
  assert.deepEqual(fake.stdin.rawModes, [true, false]);
  assert(!fake.written.join('').includes('abc'));
  fake = fakeTerminal();
  term = live.createTerminal(fake);
  fake.stdin.write('one\r\ntwo\r\n');
  assert.equal(await term.ask('> ', false), 'one');
  assert.equal(await term.ask('> ', true), 'two');
  term.close();
  // Chạy cả luồng với terminal giả: Ctrl+C giữa chừng cho mã thoát 130 và vẫn đăng xuất nếu đã có phiên.
  fake = fakeTerminal();
  outOf();
  const before = logouts();
  const flow = live.run({ ...base(), problemUrl: 'https://oj.vnoi.info/problem/p1', terminal: live.createTerminal(fake) });
  fake.stdin.write('y\r1\rnguyen-an\r' + password + '\r');
  assert.equal(await flow, 0);
  assert.equal(logouts() - before, 1);
  assert(!fake.written.join('').includes(password));
  fake = fakeTerminal();
  outOf();
  const abort = live.run({ ...base(), terminal: live.createTerminal(fake) });
  fake.stdin.write('y\r1\rnguyen-an\r\u0003');
  assert.equal(await abort, 130);
  assert.match(text(), /ĐÃ HỦY/);
  assert.deepEqual(fake.stdin.rawModes, [true, false]);
});

(async () => {
  await mock.start();
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log('ok   ' + name);
    } catch (error) {
      failed++;
      console.log('FAIL ' + name + '\n' + (error.stack ?? error));
    }
  }
  mock.stop();
  console.log(failed ? failed + ' lỗi' : 'tất cả ' + tests.length + ' kiểm thử đạt');
  process.exitCode = failed ? 1 : 0;
})();
