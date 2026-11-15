'use strict';

// Kiểm thử submit.js với máy chủ giả lập VNOJ trên 127.0.0.1. Không bao giờ chạm tới oj.vnoi.info.
// Chạy: node work/test-submit.js
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const path = require('node:path');
const submit = require(path.join(__dirname, 'olp-vscode', 'submit.js'));
const session = require(path.join(__dirname, 'olp-vscode', 'session.js'));

const { createMock, csrf, form, good, page, row } = require('./mock-vnoj');
const server = createMock();
const { log, foreignLog } = server;
let origin;
let foreignOrigin;

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const reject = async (promise, code, pattern) => {
  const error = await promise.then(() => assert.fail('phải ném lỗi ' + code), failure => failure);
  assert.equal(error.code, code, error.message);
  if (pattern) assert.match(error.message, pattern);
  return error;
};
const opts = () => ({ origin });

test('đăng nhập đúng: lấy sessionid, không gửi lại mật khẩu ra ngoài form', async () => {
  log.length = 0;
  const result = await submit.login('nguyen-an', 'correct horse', opts());
  assert.deepEqual(result, { sid: good, user: 'nguyen-an' });
  const post = log.find(item => item.method === 'POST');
  assert.equal(post.path, '/accounts/login/');
  assert.equal(post.origin, origin);
  assert.equal(post.referer, origin + '/accounts/login/');
  assert.match(post.raw, /csrfmiddlewaretoken=x{64}/);
  assert.match(post.cookie, /csrftoken=x{64}/);
  assert.doesNotMatch(post.cookie, /sessionid/);
  assert(!log.some(item => item.method === 'GET' && /correct/.test(item.path + item.cookie)));
});

test('đăng nhập sai mật khẩu, tài khoản 2FA, chuyển hướng ra ngoài', async () => {
  await reject(submit.login('nguyen-an', 'nope', opts()), 'badlogin');
  await reject(submit.login('tfa', 'pw', opts()), 'twofa', /2FA/);
  foreignLog.length = 0;
  await reject(submit.login('evil', 'pw', opts()), 'http', /cookie/);
  assert.equal(foreignLog.length, 0);
});

test('dán cookie: xác minh tên người dùng (giải mã escapejs), cookie sai, hết hạn', async () => {
  assert.equal(await submit.verifySession(good, opts()), 'nguyen-an');
  assert.equal(await submit.verifySession(' "sessionid=' + good + '" ', opts()), 'nguyen-an');
  await reject(submit.verifySession('deadbeefdeadbeef0000', opts()), 'auth');
  await reject(submit.verifySession('bad', opts()), 'auth');
  assert.equal(submit.sessionId('abc; Path=/'), undefined);
  assert.equal(submit.sessionId('a'.repeat(20) + '\r\nX: y'), undefined);
});

test('phiên có 2FA chưa qua: báo twofa thay vì tên người dùng', async () => {
  await reject(submit.verifySession('tfa-session-0000', opts()), 'twofa');
});

test('phân tích form: danh sách ngôn ngữ, mặc định, bỏ ngôn ngữ chỉ nộp tệp', async () => {
  const parsed = submit.parseSubmitForm(page('x', form()));
  assert.equal(parsed.token, csrf);
  assert.deepEqual(parsed.languages.map(item => [item.id, item.name, item.ext, item.fileOnly, item.selected]), [
    ['1', 'C++17', 'cpp', false, true], ['2', 'C++20', 'cpp', false, false],
    ['3', 'Python 3', 'py', false, false], ['4', 'Scratch', 'sb3', true, false]]);
  assert.equal(parsed.hasJudge, true);
  assert.equal(parsed.captcha, false);
  assert.equal(submit.parseSubmitForm('<html>không có form</html>'), undefined);
  assert.equal(submit.submitPath('https://oj.vnoi.info/problem/olp_kc25_cpencils'), '/problem/olp_kc25_cpencils/submit');
  assert.throws(() => submit.submitPath('https://evil.example/problem/a'), /không phải/);
});

test('nộp thành công: lấy id từ chuyển hướng, multipart đúng trường', async () => {
  log.length = 0;
  const form1 = await submit.openForm(good, '/problem/p1/submit', opts());
  assert.equal(form1.languages.length, 4);
  const result = await submit.send(form1, { languageId: '2', source: 'int main(){}\n// Việt' }, opts());
  assert.deepEqual(result, { id: '1000', url: origin + '/submission/1000' });
  const post = log.find(item => item.method === 'POST');
  assert.match(post.raw, /name="language"\r\n\r\n2\r\n/);
  assert.match(post.raw, /name="source"\r\n\r\nint main\(\)\{\}/);
  assert.match(post.cookie, /sessionid=a1b2/);
  assert.equal(post.referer, origin + '/problem/p1/submit');
});

test('nộp: chưa đăng nhập hoặc phiên hết hạn', async () => {
  await reject(submit.openForm('deadbeefdeadbeef0000', '/problem/p1/submit', opts()), 'auth');
  await reject(submit.openForm(undefined, '/problem/p1/submit', opts()), 'auth');
  await reject(submit.openForm(good, '/problem/missing/submit', opts()), 'invalid');
});

test('nộp: giới hạn tốc độ 429, lỗi form, trang thông báo, 403, hết lượt', async () => {
  const sendTo = async name => submit.send(await submit.openForm(good, '/problem/' + name + '/submit', opts()),
    { languageId: '1', source: 'x' }, opts());
  await reject(sendTo('toomany'), 'rate', /quá nhiều/);
  await reject(sendTo('invalid'), 'invalid', /missing or redundant/);
  await reject(sendTo('banned'), 'rate', /Banned & barred/);
  await reject(sendTo('forbidden'), 'language', /403/);
  await reject(submit.openForm(good, '/problem/limit/submit', opts()), 'rate', /hết lượt/);
  await reject(submit.openForm(good, '/problem/nolang/submit', opts()), 'language');
});

test('nộp: ngôn ngữ không có trong form, tệp chỉ-nộp-file, mã rỗng hoặc quá dài', async () => {
  const form1 = await submit.openForm(good, '/problem/p1/submit', opts());
  await reject(submit.send(form1, { languageId: '99', source: 'x' }, opts()), 'language');
  await reject(submit.send(form1, { languageId: '4', source: 'x' }, opts()), 'language');
  await reject(submit.send(form1, { languageId: '1', source: '  \n' }, opts()), 'invalid');
  await reject(submit.send(form1, { languageId: '1', source: 'x'.repeat(65537) }, opts()), 'invalid', /65536/);
});

test('captcha trong form nộp: báo captcha để dùng đường trình duyệt', async () => {
  await reject(submit.openForm(good, '/problem/captcha/submit', opts()), 'captcha');
});

test('không gửi cookie ra origin khác khi bị chuyển hướng', async () => {
  foreignLog.length = 0;
  const form1 = await submit.openForm(good, '/problem/foreign/submit', opts());
  await reject(submit.send(form1, { languageId: '1', source: 'x' }, opts()), 'http', /cookie/);
  await reject(submit.verifySession('redirect-away-0000', opts()), 'http', /cookie/);
  await reject(submit.openForm(good, '//' + foreignOrigin.slice(7) + '/steal', opts()), 'invalid');
  assert.equal(foreignLog.length, 0, 'máy chủ ngoài không được nhận yêu cầu nào');
  const production = require(path.join(__dirname, 'olp-vscode', 'vnoj.js')).origin;
  assert.equal(production, 'https://oj.vnoi.info');
  const seen = [];
  const fetcher = async url => { seen.push(String(url)); return new Response('', { status: 200 }); };
  await submit.verifySession(good, { fetcher }).catch(() => {});
  assert.deepEqual(seen, ['https://oj.vnoi.info/']);
});

test('phân tích kết quả: AC, điểm một phần, PAC, CE, đang chấm', async () => {
  assert.deepEqual(submit.parseResult(row('AC', '100 / 100')),
    { final: true, status: 'AC', points: '100', total: '100', text: 'AC' });
  assert.equal(submit.parseResult(row('WA', '40 / 100')).text, 'WA 40/100');
  assert.equal(submit.parseResult(row('PAC', '37,5 / 100')).text, 'PAC 37,5/100');
  assert.equal(submit.parseResult(row('PAC', '23,900 / 25')).text, 'PAC 23,900/25');
  assert.equal(submit.parseResult(row('WA', '1.234,5 / 2.000')).text, 'WA 1.234,5/2.000');
  assert.equal(submit.parseResult(row('CE', '---')).text, 'CE');
  const grading = submit.parseResult(row('G', '', true));
  assert.equal(grading.final, false);
  assert.equal(submit.parseResult('<html>lạ</html>'), undefined);
});

test('chờ kết quả đến khi chấm xong, ghi đúng chuỗi để stats nhận AC', async () => {
  const id = (await submit.send(await submit.openForm(good, '/problem/p1/submit', opts()), { languageId: '1', source: 'x' }, opts())).id;
  const updates = [];
  const result = await submit.poll(id, good, { ...opts(), interval: 5, timeout: 5000, onUpdate: item => updates.push(item.status) });
  assert.deepEqual(updates, ['QU', 'G', 'AC']);
  assert.equal(result.final, true);
  assert.equal(result.text, 'AC');
  const kit = { id: 'k', title: 'T', problems: [{ key: 'A', name: 'A' }] };
  const run = session.start(kit, 0, 's');
  session.event(run, 'sent', 10, { problem: 'A', submission: id, url: origin + '/submission/' + id, auto: true });
  session.event(run, 'verdict', 20, { problem: 'A', text: result.text, submission: id, url: origin + '/submission/' + id, auto: true });
  assert.equal(session.stats(run, 30).A.firstAC, 20);
  assert.equal(session.stats(run, 30).A.sent, 1);
  const report = session.markdown(run, 30);
  assert.match(report, /Đã nộp \(tự động\) · #\d+ · http/);
  assert.match(report, /Kết quả \(lấy từ VNOJ\) · #\d+ · AC/);
});

test('chờ kết quả: điểm một phần, hết giờ chờ, huỷ, kết quả đến sau giờ thi', async () => {
  const idOf = async problem => (await submit.send(await submit.openForm(good, '/problem/' + problem + '/submit', opts()),
    { languageId: '3', source: 'x' }, opts())).id;
  const partial = await submit.poll(await idOf('partial'), good, { ...opts(), interval: 5, timeout: 5000 });
  assert.equal(partial.text, 'WA 40/100');
  assert.equal(partial.final, true);
  assert.equal(/^AC(?:$|\s|\()/.test(partial.text), false);
  assert.equal((await submit.poll(await idOf('pac'), good, { ...opts(), interval: 5, timeout: 5000 })).text, 'PAC 37.5/100');
  assert.equal((await submit.poll(await idOf('ce'), good, { ...opts(), interval: 5, timeout: 5000 })).text, 'CE');
  const slow = await submit.poll(await idOf('never'), good, { ...opts(), interval: 20, timeout: 100 });
  assert.equal(slow.timedOut, true);
  assert.equal(slow.final, false);
  const controller = new AbortController();
  const aborted = submit.poll(await idOf('never'), good, { ...opts(), interval: 50, timeout: 60000, signal: controller.signal });
  setTimeout(() => controller.abort(), 30);
  assert.equal(await aborted, undefined);
  const kit = { id: 'k', title: 'T', problems: [{ key: 'A', name: 'A' }] };
  const run = session.start(kit, 0, 's');
  session.finish(run, 1000, false);
  session.event(run, 'verdict', 5000, { problem: 'A', text: partial.text, auto: true });
  assert.equal(session.stats(run, 6000).A.latest, 'WA 40/100');
  assert.match(session.describe(run.events.at(-1)), /Kết quả \(lấy từ VNOJ\) · WA 40\/100/);
  await reject(submit.fetchResult('12x', good, opts()), 'invalid');
  await reject(submit.fetchResult('424242', good, opts()), 'invalid');
});

test('đăng xuất phía máy chủ gửi POST có CSRF, bỏ qua giá trị không hợp lệ', async () => {
  log.length = 0;
  await submit.logout(good, opts());
  const post = log.find(item => item.method === 'POST');
  assert.equal(post.path, '/accounts/logout/');
  assert.match(post.raw, /csrfmiddlewaretoken=x{64}/);
  await submit.logout('bad', opts());
});

(async () => {
  await server.start();
  ({ origin, foreignOrigin } = server);
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
  server.stop();
  console.log(failed ? failed + ' lỗi' : 'tất cả ' + tests.length + ' kiểm thử đạt');
  process.exitCode = failed ? 1 : 0;
})();
