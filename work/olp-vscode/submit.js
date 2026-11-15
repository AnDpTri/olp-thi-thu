'use strict';

// Đăng nhập, nộp bài và lấy kết quả trên VNOJ (fork của DMOJ). Không phụ thuộc VS Code.
// `origin` chỉ là tham số của hàm (mặc định cố định); tiện ích không bao giờ truyền giá trị khác.
const vnoj = require('./vnoj');

const cookieName = 'sessionid';
const maxBody = 5_000_000;

class SubmitError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function sessionId(value) {
  const sid = String(value ?? '').trim().replace(/^["']|["']$/g, '').replace(/^sessionid\s*=\s*/i, '').trim();
  return /^[\w-]{8,200}$/.test(sid) ? sid : undefined;
}

function submitPath(problemUrl) {
  const url = vnoj.vnojUrl(problemUrl, /^\/problem\/[\w-]+\/?$/);
  if (!url) throw new SubmitError('invalid', 'Link bài không phải một bài trên oj.vnoi.info.');
  return url.pathname.replace(/\/$/, '') + '/submit';
}

function mergeCookies(jar, response) {
  for (const line of response.headers.getSetCookie?.() ?? []) {
    const [pair, ...rest] = line.split(';');
    const at = pair.indexOf('=');
    if (at < 1) continue;
    const name = pair.slice(0, at).trim();
    const value = pair.slice(at + 1).trim();
    const attrs = rest.join(';');
    if (!value || /max-age\s*=\s*0\b/i.test(attrs) || /expires\s*=[^;]*\b19[67]\d\b/i.test(attrs)) delete jar[name];
    else jar[name] = value;
  }
}

// Mọi yêu cầu có cookie đều đi qua đây: chỉ tới đúng `origin`, không bao giờ tự theo chuyển hướng.
async function call(opts, method, path, { jar = {}, body, signal } = {}) {
  const base = new URL(opts.origin ?? vnoj.origin);
  if (typeof path !== 'string' || !path.startsWith('/')) throw new SubmitError('invalid', 'Đường dẫn VNOJ không hợp lệ.');
  const url = new URL(path, base);
  if (url.origin !== base.origin || url.username || url.password) throw new SubmitError('invalid', 'Đường dẫn VNOJ không hợp lệ.');
  const headers = { 'Accept-Language': 'vi,en;q=0.8', Accept: 'text/html,*/*;q=0.5' };
  const cookie = Object.entries(jar).map(([name, value]) => name + '=' + value).join('; ');
  if (cookie) headers.Cookie = cookie;
  if (method === 'POST') {
    headers.Origin = base.origin;
    headers.Referer = new URL(opts.referer ?? path, base).href;
  }
  const signals = [AbortSignal.timeout(15000), opts.signal, signal].filter(Boolean);
  let response;
  try {
    response = await (opts.fetcher ?? globalThis.fetch)(url, {
      method, redirect: 'manual', headers, body, signal: AbortSignal.any(signals)
    });
  } catch (error) {
    if (opts.signal?.aborted) throw error;
    throw new SubmitError('network', 'Không kết nối được tới VNOJ. Kiểm tra mạng rồi thử lại.');
  }
  mergeCookies(jar, response);
  let location;
  let foreign = false;
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const next = new URL(response.headers.get('location') ?? '/', url);
    if (next.origin === base.origin && !next.username && !next.password) location = next.pathname + next.search;
    else foreign = true;
    await response.body?.cancel();
    return { status: response.status, location, foreign, text: '', server: response.headers.get('server') ?? '' };
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBody) throw new SubmitError('http', 'VNOJ trả về trang quá lớn.');
  return { status: response.status, text: bytes.toString('utf8'), server: response.headers.get('server') ?? '' };
}

function formBlock(html, test) {
  return html.split(/<form\b/i).slice(1).find(test) ?? '';
}

function token(block) {
  const tag = [...block.matchAll(/<input\b[^>]*>/gi)].map(match => match[0])
    .find(item => /name\s*=\s*["']csrfmiddlewaretoken["']/i.test(item));
  return tag?.match(/value\s*=\s*["']([^"']+)["']/i)?.[1];
}

function escapedJs(value) {
  return value.replace(/\\u([\da-f]{4})/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/\\(.)/g, '$1');
}

// Trang nào của VNOJ cũng có `window.user = {name: '...'}` khi đã đăng nhập (templates/base.html).
function userOf(html) {
  const name = html.match(/window\.user\s*=\s*\{[^}]*\bname\s*:\s*'((?:[^'\\]|\\.)*)'/)?.[1];
  return name === undefined ? undefined : escapedJs(name) || undefined;
}

function redirectError(location) {
  if (/^\/accounts\/login\//.test(location)) return new SubmitError('auth', 'Phiên đăng nhập VNOJ đã hết hạn hoặc không hợp lệ.');
  if (/^\/accounts\/2fa\//.test(location)) {
    return new SubmitError('twofa', 'Tài khoản bật xác thực hai bước (2FA) nên đăng nhập bằng mật khẩu chưa đủ. Hãy dùng cách dán cookie sessionid của trình duyệt đã đăng nhập.');
  }
  if (/^\/accounts\/password\/change\//.test(location)) {
    return new SubmitError('pwned', 'VNOJ yêu cầu đổi mật khẩu (mật khẩu nằm trong danh sách bị lộ). Hãy đổi mật khẩu trong trình duyệt rồi đăng nhập lại.');
  }
}

function pageError(page) {
  if (page.foreign) return new SubmitError('http', 'VNOJ chuyển sang địa chỉ khác, đã dừng để không gửi cookie ra ngoài.');
  if (page.location) return redirectError(page.location) ??
    new SubmitError('http', 'VNOJ chuyển hướng bất ngờ tới ' + page.location + '.');
  if (page.status === 429 || page.status === 503 || /cloudflare/i.test(page.server) && page.status === 403) {
    return new SubmitError('rate', 'VNOJ (hoặc Cloudflare) đang chặn tạm thời, HTTP ' + page.status + '. Đợi một lúc rồi thử lại.');
  }
  if (page.status !== 200) return new SubmitError('http', 'VNOJ trả về HTTP ' + page.status + '.');
}

// Trả về tên đăng nhập của phiên, hoặc ném lỗi có `code`.
async function verifySession(sid, opts = {}) {
  const id = sessionId(sid);
  if (!id) throw new SubmitError('auth', 'Giá trị sessionid không hợp lệ.');
  const page = await call(opts, 'GET', '/', { jar: { [cookieName]: id } });
  const failure = pageError(page);
  if (failure) throw failure;
  const user = userOf(page.text);
  if (!user) throw new SubmitError('auth', 'VNOJ không nhận phiên này. Cookie sessionid sai hoặc đã hết hạn.');
  return user;
}

// Đăng nhập bằng form Django (judge/views/user.py CustomLoginView, URL /accounts/login/).
// Mật khẩu chỉ nằm trong yêu cầu này; trả về { sid, user }.
async function login(username, password, opts = {}) {
  const jar = {};
  const page = await call(opts, 'GET', '/accounts/login/', { jar });
  const failure = pageError(page);
  if (failure) throw failure;
  const block = formBlock(page.text, item => /name\s*=\s*["']password["']/i.test(item));
  const csrf = token(block);
  if (!csrf || !jar.csrftoken) throw new SubmitError('http', 'Không đọc được form đăng nhập của VNOJ.');
  if (/captcha|turnstile/i.test(block)) {
    throw new SubmitError('captcha', 'Trang đăng nhập yêu cầu captcha. Hãy dùng cách dán cookie sessionid.');
  }
  const form = new URLSearchParams({ csrfmiddlewaretoken: csrf, username, password, next: '' });
  const reply = await call({ ...opts, referer: '/accounts/login/' }, 'POST', '/accounts/login/', {
    jar, body: form
  });
  if (reply.foreign) throw pageError(reply);
  if (reply.status === 200) {
    const ban = reply.text.match(/<p class="error">([\s\S]*?)<\/p>/gi)?.map(item => vnoj.plain(item))
      .find(item => /banned|bị cấm|khóa/i.test(item));
    throw new SubmitError('badlogin', ban ?? 'Tên đăng nhập hoặc mật khẩu sai.');
  }
  if (reply.status === 403 || reply.status === 429) throw pageError(reply);
  if (!reply.location || !jar[cookieName]) throw new SubmitError('http', 'VNOJ trả lời bất ngờ khi đăng nhập (HTTP ' + reply.status + ').');
  const sid = sessionId(jar[cookieName]);
  if (!sid) throw new SubmitError('http', 'VNOJ không cấp phiên đăng nhập.');
  return { sid, user: await verifySession(sid, opts) };
}

// Đăng xuất phía máy chủ (POST /accounts/logout/). Chỉ gọi cho phiên do chính tiện ích tạo.
async function logout(sid, opts = {}) {
  const id = sessionId(sid);
  if (!id) return;
  const jar = { [cookieName]: id };
  const page = await call(opts, 'GET', '/accounts/logout/', { jar });
  const csrf = token(formBlock(page.text ?? '', item => /logout/i.test(item)) || page.text || '');
  if (!csrf || !jar.csrftoken) return;
  await call({ ...opts, referer: '/accounts/logout/' }, 'POST', '/accounts/logout/', {
    jar, body: new URLSearchParams({ csrfmiddlewaretoken: csrf })
  });
}

function attrs(text) {
  const result = {};
  for (const match of text.matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) result[match[1].toLowerCase()] = vnoj.plain(match[2]);
  return result;
}

// templates/problem/submit-form.html: <select name="language"> với các <option value data-ext data-fileonly>.
function parseSubmitForm(html) {
  const block = formBlock(html, item => /id\s*=\s*["']problem_submit["']/i.test(item));
  if (!block) return undefined;
  const select = block.match(/<select\b[^>]*name\s*=\s*["']language["'][^>]*>([\s\S]*?)<\/select>/i)?.[1] ?? '';
  const languages = [...select.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map(match => {
    const a = attrs(match[1]);
    return {
      id: a.value, name: vnoj.plain(match[2]) || a['data-name'] || a.value, ext: (a['data-ext'] ?? '').toLowerCase(),
      fileOnly: /^true$/i.test(a['data-fileonly'] ?? ''), selected: /\bselected\b/i.test(match[1].replace(/"[^"]*"/g, ''))
    };
  }).filter(item => /^\d+$/.test(item.id ?? ''));
  const judge = [...block.matchAll(/<input\b[^>]*>/gi)].map(match => match[0])
    .find(item => /name\s*=\s*["']judge["']/i.test(item));
  return {
    token: token(block), languages, hasJudge: Boolean(judge),
    judge: judge?.match(/value\s*=\s*["']([^"']*)["']/i)?.[1] ?? '',
    captcha: /captcha|turnstile/i.test(block),
    disabled: /<input\b[^>]*type\s*=\s*["']submit["'][^>]*\bdisabled\b/i.test(block)
  };
}

// Mở form nộp: trả về { token, languages, jar, path, ... } để dùng cho send().
async function openForm(sid, path, opts = {}) {
  const id = sessionId(sid);
  if (!id) throw new SubmitError('auth', 'Chưa đăng nhập VNOJ.');
  const jar = { [cookieName]: id };
  const page = await call(opts, 'GET', path, { jar });
  if (page.status === 404) throw new SubmitError('invalid', 'Không tìm thấy bài này trên VNOJ hoặc bạn không có quyền nộp.');
  const failure = pageError(page);
  if (failure) throw failure;
  const form = parseSubmitForm(page.text);
  if (!form || !form.token || !jar.csrftoken) {
    throw new SubmitError(userOf(page.text) ? 'invalid' : 'auth', userOf(page.text)
      ? 'Không đọc được form nộp bài của VNOJ.' : 'Phiên đăng nhập VNOJ đã hết hạn hoặc không hợp lệ.');
  }
  if (form.captcha) throw new SubmitError('captcha', 'VNOJ yêu cầu captcha khi nộp bài.');
  if (!form.languages.length) {
    throw new SubmitError('language', 'Bài này hiện không nhận bài nộp: chưa có dữ liệu chấm hoặc không có máy chấm.');
  }
  if (form.disabled) throw new SubmitError('rate', 'VNOJ không cho nộp thêm bài này (hết lượt nộp trong kỳ thi).');
  return { ...form, jar, path };
}

function formErrors(html) {
  const found = [];
  for (const list of html.matchAll(/<ul\b[^>]*class\s*=\s*"[^"]*\berrorlist\b[^"]*"[^>]*>([\s\S]*?)<\/ul>/gi)) {
    for (const item of list[1].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) found.push(vnoj.plain(item[1]));
  }
  return [...new Set(found.filter(Boolean))];
}

// POST form như trình duyệt (multipart/form-data; judge/forms.py ProblemSubmitForm: source, language, judge).
// Trả về { id, url }. Mọi chuyển hướng khác /submission/<id> đều bị coi là lỗi.
async function send(form, { languageId, source }, opts = {}) {
  if (!form.languages.some(item => item.id === languageId && !item.fileOnly)) {
    throw new SubmitError('language', 'Ngôn ngữ đã chọn không được phép cho bài này.');
  }
  if (!source.trim()) throw new SubmitError('invalid', 'Tệp lời giải đang trống.');
  if (source.length > 65536) throw new SubmitError('invalid', 'Mã nguồn dài quá 65536 ký tự, VNOJ không nhận.');
  const body = new FormData();
  body.set('csrfmiddlewaretoken', form.token);
  body.set('language', languageId);
  body.set('source', source);
  if (form.hasJudge) body.set('judge', form.judge);
  const page = await call({ ...opts, referer: form.path }, 'POST', form.path, { jar: form.jar, body });
  if (page.foreign) throw pageError(page);
  if (page.location) {
    const id = page.location.match(/^\/submission\/(\d+)\/?$/)?.[1];
    if (id) return { id, url: new URL('/submission/' + id, opts.origin ?? vnoj.origin).href };
    if (page.location.replace(/\/$/, '') === form.path.replace(/\/$/, '')) {
      throw new SubmitError('invalid', 'VNOJ từ chối yêu cầu (CSRF hoặc phiên hết hạn). Thử nộp lại, nếu vẫn lỗi hãy đăng nhập lại.');
    }
    throw pageError(page);
  }
  if (page.status === 429) {
    throw new SubmitError('rate', 'Bạn đang có quá nhiều bài chờ chấm. Đợi chấm xong rồi nộp tiếp.');
  }
  if (page.status === 403) {
    throw new SubmitError('language', 'VNOJ từ chối (HTTP 403): bạn không được nộp bài này hoặc ngôn ngữ không được phép. Thử nộp trên trình duyệt để xem lý do.');
  }
  if (page.status === 200) {
    const errors = formErrors(page.text);
    if (errors.length) throw new SubmitError('invalid', 'VNOJ từ chối bài nộp: ' + errors.join(' · '));
    const message = vnoj.plain(page.text.match(/<pre\b[^>]*>([\s\S]*?)<\/pre>/i)?.[1] ?? '');
    if (message) throw new SubmitError('rate', 'VNOJ: ' + message);
    throw new SubmitError('invalid', 'VNOJ không nhận bài nộp (form báo lỗi không rõ). Thử nộp trên trình duyệt.');
  }
  throw pageError(page) ?? new SubmitError('http', 'VNOJ trả về HTTP ' + page.status + '.');
}

// /widgets/single_submission?id=N&show_problem=0 render templates/submission/row.html (judge/views/submission.py).
function parseResult(html) {
  const head = html.split(/<div class="sub-main"/i)[0];
  if (!/class\s*=\s*"sub-result\b/i.test(head)) return undefined;
  const status = vnoj.plain(head.match(/<span\b[^>]*class\s*=\s*"status"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? '');
  if (!status) return undefined;
  const final = !/grading-spinner/i.test(head);
  const score = vnoj.plain(head.match(/<div\b[^>]*class\s*=\s*"score"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? '')
    .match(/^(\d[\d.,]*)\s*\/\s*(\d[\d.,]*)$/);
  const text = final && score && status !== 'AC' ? status + ' ' + score[1] + '/' + score[2] : status;
  return { final, status, points: score?.[1], total: score?.[2], text };
}

async function fetchResult(id, sid, opts = {}) {
  if (!/^\d+$/.test(String(id))) throw new SubmitError('invalid', 'Mã bài nộp không hợp lệ.');
  const jar = sessionId(sid) ? { [cookieName]: sessionId(sid) } : {};
  const page = await call(opts, 'GET', '/widgets/single_submission?id=' + id + '&show_problem=0', { jar });
  if (page.status === 404) throw new SubmitError('invalid', 'VNOJ không cho xem bài nộp #' + id + '.');
  const failure = pageError(page);
  if (failure) throw failure;
  const result = parseResult(page.text);
  if (!result) throw new SubmitError('http', 'Không đọc được kết quả bài nộp #' + id + '.');
  return result;
}

const pause = (ms, signal) => new Promise(resolve => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});

// Hỏi lại mỗi `interval` ms đến khi chấm xong. Trả về { ...kết quả, timedOut } hoặc undefined nếu bị huỷ.
async function poll(id, sid, opts = {}) {
  const { interval = 3000, timeout = 180000, signal } = opts;
  const stop = Date.now() + timeout;
  let last;
  let failures = 0;
  while (!signal?.aborted) {
    try {
      last = await fetchResult(id, sid, { ...opts, signal });
      failures = 0;
      opts.onUpdate?.(last);
      if (last.final) return { ...last, timedOut: false };
    } catch (error) {
      if (signal?.aborted) return undefined;
      if (!['network', 'rate'].includes(error.code) || ++failures >= 5) throw error;
    }
    if (Date.now() + interval > stop) return { ...(last ?? { text: '—', status: '—' }), final: false, timedOut: true };
    await pause(interval, signal);
  }
  return undefined;
}

module.exports = {
  SubmitError, fetchResult, login, logout, openForm, parseResult, parseSubmitForm, poll, send,
  sessionId, submitPath, userOf, verifySession
};
