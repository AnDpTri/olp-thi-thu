'use strict';

// Kiểm thử thật trên VNOJ: đăng nhập, nộp ĐÚNG MỘT bài, chờ kết quả, đăng xuất.
// Chạy trong terminal:  node work\live-test.js
// Dùng nguyên các hàm của olp-vscode\submit.js với origin sản xuất https://oj.vnoi.info.
// Mật khẩu và cookie chỉ nằm trong bộ nhớ, không in ra, không ghi đĩa.
const path = require('node:path');
const submit = require(path.join(__dirname, 'olp-vscode', 'submit.js'));

// Bài ICPC 2026 vòng Quốc gia - E "Easy Math": một số nguyên k (2 ≤ k ≤ 9), in tổng X + Y nhỏ nhất của hai số có ba chữ số
// với sáu chữ số đôi một khác nhau và chữ số hàng trăm của Y bằng k lần chữ số hàng đơn vị của X (mẫu: k = 2 → 537).
const problem = {
  name: 'Easy Math (ICPC 2026 vòng Quốc gia - E)',
  url: 'https://oj.vnoi.info/problem/icpc26_na_e'
};
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

class Abort extends Error {}

// Đọc từng ký tự từ terminal: tắt echo hoàn toàn cho bí mật (không cả dấu *), xử lý Backspace, Enter, Ctrl+C.
function createTerminal({ stdin = process.stdin, stdout = process.stdout } = {}) {
  const queue = [];
  let waiting;
  let ended = false;
  let attached = false;
  let skipLF = false;
  const wake = () => { const resolve = waiting; waiting = undefined; resolve?.(); };
  const onData = chunk => { queue.push(...String(chunk)); wake(); };
  const onEnd = () => { ended = true; wake(); };
  function attach() {
    if (attached) return;
    attached = true;
    stdin.setEncoding?.('utf8');
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.on('data', onData);
    stdin.on('end', onEnd);
    stdin.resume();
  }
  function close() {
    if (!attached) return;
    attached = false;
    stdin.off('data', onData);
    stdin.off('end', onEnd);
    if (stdin.isTTY) stdin.setRawMode(false);
    stdin.pause();
  }
  async function char() {
    while (!queue.length) {
      if (ended) return null;
      await new Promise(resolve => { waiting = resolve; });
    }
    return queue.shift();
  }
  async function ask(prompt, secret) {
    attach();
    stdout.write(prompt);
    let value = '';
    for (;;) {
      const c = await char();
      if (c === null) {
        if (value) break;
        throw new Abort('Hết dữ liệu nhập.');
      }
      if (c === '\u0003') {
        stdout.write('\n');
        throw new Abort('Đã hủy bằng Ctrl+C.');
      }
      if (c === '\n' && skipLF) { skipLF = false; continue; }
      skipLF = false;
      if (c === '\r' || c === '\n') {
        skipLF = c === '\r';
        break;
      }
      if (c === '\u007f' || c === '\b') {
        if (value && !secret) stdout.write('\b \b');
        value = value.slice(0, -1);
        continue;
      }
      if (c === '\u001b') {
        // Bỏ qua phím điều hướng (ESC [ ... chữ cái) để không lẫn vào giá trị.
        if (queue[0] === '[' || queue[0] === 'O') {
          queue.shift();
          while (queue.length && !/[A-Za-z~]/.test(queue[0])) queue.shift();
          queue.shift();
        }
        continue;
      }
      if (c < ' ') continue;
      value += c;
      if (!secret) stdout.write(c);
    }
    stdout.write('\n');
    return value;
  }
  return { ask, close };
}

async function run({ origin, fetcher, ask, out, problemUrl = problem.url, interval = 3000, timeout = 180000, terminal } = {}) {
  const write = out ?? (text => process.stdout.write(text + '\n'));
  const term = ask ? undefined : terminal ?? createTerminal();
  const input = ask ?? ((prompt, secret) => term.ask(prompt, secret));
  const secrets = new Set();
  const scrub = text => {
    let result = String(text);
    for (const secret of secrets) if (secret.length >= 3) result = result.split(secret).join('***');
    return result;
  };
  const say = text => write(scrub(text));
  const real = fetcher ?? globalThis.fetch;
  let last;
  // Chỉ ghi lại thông tin chẩn đoán không bí mật của phản hồi cuối: phương thức, đường dẫn, HTTP, chuyển hướng, server.
  const traced = async (url, init) => {
    const target = new URL(String(url));
    const response = await real(url, init);
    const location = response.headers.get('location');
    let redirect;
    if (location) {
      const next = new URL(location, target);
      redirect = next.origin === target.origin ? next.pathname : '(origin khác) ' + next.host + next.pathname;
    }
    last = { method: init?.method ?? 'GET', path: target.pathname, status: response.status, redirect, server: response.headers.get('server') };
    return response;
  };
  const opts = { origin, fetcher: traced };
  const submitUrl = new URL(problemUrl);
  let sid;
  let own = false;
  let failedAt = 0;
  let cleanedUp = false;

  const fail = (step, label, error) => {
    failedAt ||= step;
    say('[' + step + '/6] ' + label + ' ... LỖI');
    say('    Mã lỗi: ' + (error?.code ?? 'không có') + ' | ' + (error?.message ?? String(error)));
    if (last) {
      say('    Phản hồi cuối: ' + last.method + ' ' + last.path + ' → HTTP ' + last.status +
        (last.redirect ? ', chuyển hướng tới ' + last.redirect : '') + ', server: ' + (last.server ?? '—'));
    }
  };

  async function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    if (!sid) {
      say('[6/6] Đăng xuất phía máy chủ ... bỏ qua (chưa có phiên)');
    } else if (!own) {
      say('[6/6] Đăng xuất phía máy chủ ... bỏ qua (cookie dán là phiên trình duyệt của bạn, không đăng xuất)');
    } else {
      try {
        await submit.logout(sid, opts);
        say('[6/6] Đăng xuất phía máy chủ ... OK');
      } catch (error) {
        fail(6, 'Đăng xuất phía máy chủ', error);
      }
    }
  }

  try {
    say('Sẽ nộp 1 bài C++ cho bài ' + problem.name + ' (' + problemUrl + ') bằng tài khoản của bạn.');
    say('Mã nguồn sẽ nộp (' + source.split('\n').length + ' dòng):');
    say(source.replace(/\n$/, '').split('\n').map(line => '    ' + line).join('\n'));
    if (!/^y(es)?$/i.test((await input('Tiếp tục? (y/N) ', false)).trim())) {
      say('Đã hủy, không gửi gì tới VNOJ.');
      say('KẾT QUẢ: ĐÃ HỦY');
      return 2;
    }
    const method = (await input('Đăng nhập bằng: 1) tên đăng nhập + mật khẩu   2) dán cookie sessionid  [1/2]: ', false)).trim();
    if (method !== '1' && method !== '2') {
      say('Lựa chọn không hợp lệ, không gửi gì tới VNOJ.');
      say('KẾT QUẢ: ĐÃ HỦY');
      return 2;
    }

    // Bước 1
    let user;
    try {
      if (method === '1') {
        const username = (await input('Tên đăng nhập: ', false)).trim();
        const password = await input('Mật khẩu (không hiện khi gõ): ', true);
        secrets.add(password);
        const session = await submit.login(username, password, opts);
        secrets.add(session.sid);
        ({ sid, user } = session);
        own = true;
      } else {
        const value = await input('Dán giá trị cookie sessionid (không hiện khi dán): ', true);
        secrets.add(value);
        const id = submit.sessionId(value);
        if (!id) throw new submit.SubmitError('auth', 'Giá trị sessionid không hợp lệ.');
        secrets.add(id);
        user = await submit.verifySession(id, opts);
        sid = id;
      }
      say('[1/6] Đăng nhập ... OK — VNOJ báo tài khoản: ' + user);
    } catch (error) {
      if (error instanceof Abort) throw error;
      fail(1, 'Đăng nhập', error);
    }

    // Bước 2
    let form;
    let language;
    if (!failedAt) {
      try {
        form = await submit.openForm(sid, submit.submitPath(problemUrl), opts);
        const cpp = form.languages.filter(item => !item.fileOnly && item.ext === 'cpp');
        language = cpp.find(item => item.selected) ?? cpp[0];
        if (!language) throw new submit.SubmitError('language', 'Bài này không có ngôn ngữ C++ trong danh sách.');
        say('[2/6] Mở form nộp bài ... OK — ' + form.languages.length + ' ngôn ngữ, chọn "' + language.name + '" (id ' + language.id + ')');
      } catch (error) {
        fail(2, 'Mở form nộp bài', error);
      }
    }

    // Bước 3: đúng một lần POST, không thử lại.
    let submission;
    if (!failedAt) {
      try {
        submission = await submit.send(form, { languageId: language.id, source }, opts);
        say('[3/6] Nộp bài ... OK — bài nộp #' + submission.id + ' ' + submission.url);
      } catch (error) {
        fail(3, 'Nộp bài (POST duy nhất, không thử lại)', error);
      }
    }

    // Bước 4
    let result;
    if (!failedAt) {
      let previous;
      try {
        result = await submit.poll(submission.id, sid, {
          ...opts, interval, timeout, onUpdate: item => {
            if (item.text !== previous) say('      #' + submission.id + ': ' + item.text + (item.final ? ' (xong)' : ''));
            previous = item.text;
          }
        });
        if (!result || result.timedOut) {
          throw new submit.SubmitError('timeout', 'Chưa chấm xong sau ' + Math.round(timeout / 1000) + ' giây (' + (result?.text ?? '—') + '). Xem ' + submission.url);
        }
        say('[4/6] Chờ kết quả ... OK — kết quả cuối: ' + result.text);
      } catch (error) {
        fail(4, 'Chờ kết quả', error);
      }
    }

    // Bước 5
    if (!failedAt) {
      if (result.status === 'AC') say('[5/6] Kiểm tra kết quả là AC ... OK');
      else fail(5, 'Kiểm tra kết quả là AC', new submit.SubmitError('verdict', 'Kết quả là "' + result.text + '", không phải AC. Xem ' + submission.url));
    }
  } catch (error) {
    if (error instanceof Abort) {
      await cleanup();
      say(error.message);
      say('KẾT QUẢ: ĐÃ HỦY');
      return 130;
    }
    failedAt ||= 1;
    say('Lỗi không mong đợi: ' + (error?.code ?? '') + ' ' + (error?.message ?? String(error)));
  } finally {
    term?.close();
  }

  await cleanup();
  say(failedAt ? 'KẾT QUẢ: LỖI ở bước ' + failedAt : 'KẾT QUẢ: ĐẠT');
  return failedAt ? 1 : 0;
}

module.exports = { createTerminal, problem, run, source };

if (require.main === module) {
  const done = code => process.exit(code);
  run().then(done, error => {
    // Không in stack để không lộ bất kỳ giá trị nào.
    process.stderr.write('Lỗi không mong đợi: ' + (error?.message ?? String(error)) + '\n');
    done(1);
  });
}
