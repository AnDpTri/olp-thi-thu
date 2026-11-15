'use strict';

// Máy chủ giả lập VNOJ dùng chung cho test-submit.js và olp-integration-submit.js (chỉ lắng nghe 127.0.0.1).
const { createServer } = require('node:http');
const csrf = 'x'.repeat(64);
const good = 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6';

const languages = `<select id="id_language" name="language">
<option value="1" data-id="1" data-name="C++17" data-ext="cpp" data-fileonly="False" selected>C++17</option>
<option value="2" data-id="2" data-name="C++20" data-ext="cpp" data-fileonly="False">C++20</option>
<option value="3" data-id="3" data-name="Python 3" data-ext="py" data-fileonly="False">Python 3</option>
<option value="4" data-id="4" data-name="Scratch" data-ext="sb3" data-fileonly="True">Scratch</option>
</select>`;
const page = (user, body = '') => '<html><script>window.user = ' + (user
  ? "{email: '', id: '7', name: '" + user.replace(/-/g, '\\u002D') + "'}" : '{}') + ';</script>' + body + '</html>';
const input = (name, value) => `<input type='hidden' name='${name}' value='${value}' />`;
const form = extra => `<form id="problem_submit" action="" method="post" enctype="multipart/form-data">${input('csrfmiddlewaretoken', csrf)}
<div id="editor"><textarea name="source"></textarea></div>${languages}${input('judge', '')}${extra ?? ''}
<input type="submit" value="Nộp!" class="button"></form>`;
const row = (status, score, spinner) => `<div class="sub-result ${status}"><div class="score">${spinner
  ? '<i class="fa fa-spinner fa-pulse grading-spinner"></i>' : score}</div><div class="state">
<span title="x" class="status">${status}</span> | <span class="language">C++17</span></div></div>
<div class="sub-main"><div class="sub-info"><span class="status">NOPE</span></div></div>`;


function createMock(publicOrigin) {
  const log = [];
  const foreignLog = [];
  const submissions = new Map();
  const control = { expired: false, released: false, posts: [], publicOrigin };
  let nextId = 1000;
  let origin;
  let foreignOrigin;

  function body(request) {
    return new Promise(resolve => {
      const chunks = [];
      request.on('data', chunk => chunks.push(chunk));
      request.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  const cookies = request => Object.fromEntries((request.headers.cookie ?? '').split(/;\s*/).filter(Boolean)
    .map(item => [item.slice(0, item.indexOf('=')), item.slice(item.indexOf('=') + 1)]));

  const mock = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://x');
    const jar = cookies(request);
    const raw = request.method === 'POST' ? (await body(request)).toString('latin1') : '';
    log.push({ method: request.method, path: url.pathname, cookie: request.headers.cookie, raw,
      referer: request.headers.referer, origin: request.headers.origin });
    const user = control.expired ? undefined : jar.sessionid === good ? 'nguyen-an' : jar.sessionid === 'tfa-session-0000' ? 'tfa' : undefined;
    const send = (status, headers, text = '') => { response.writeHead(status, headers); response.end(text); };
    const html = { 'Content-Type': 'text/html; charset=utf-8' };
    const fresh = ['csrftoken=' + csrf + '; Path=/; SameSite=Lax'];
    const fields = new URLSearchParams(raw.includes('csrfmiddlewaretoken=') && !raw.includes('Content-Disposition') ? raw : '');
    const csrfOk = () => jar.csrftoken === csrf &&
      (fields.get('csrfmiddlewaretoken') ?? raw.match(/name="csrfmiddlewaretoken"\r\n\r\n([^\r]+)/)?.[1]) === csrf &&
      request.headers.referer?.startsWith(control.publicOrigin ?? origin) && request.headers.origin === (control.publicOrigin ?? origin);
    const part = name => raw.match(new RegExp('name="' + name + '"\\r\\n\\r\\n([\\s\\S]*?)\\r\\n--'))?.[1];

    if(control.practice&&request.method==='GET'&&url.pathname==='/contest/olp_kc25')return send(200,html,'<title>OLP Không chuyên 2025</title><div class="contest-problems"><table>'+[['olp_kc25_cpencils','Bút chì màu'],['olp_kc25_delivery','Giao hàng'],['practice_c','Bài C'],['practice_d','Bài D']].map(([code,name])=>'<tr><td><a href="/problem/'+code+'">'+name+'</a></td></tr>').join('')+'</table></div>');
    if(control.practice&&request.method==='GET'&&url.pathname==='/pdf/practice.pdf')return send(200,{'Content-Type':'application/pdf'},require('node:fs').readFileSync(require('node:path').join(__dirname,'../outputs/De-OLP-2024-Khong-chuyen.pdf')));

    if (control.combined && request.method === 'GET' && url.pathname === '/contest/olp24') {
      if(control.requireAuth && !user)return send(302,{Location:'/accounts/login/'});
      const names=[['p1','Đăng ký học phần'],['partial','Đường đi'],['pac','Ba số nguyên tố'],['hold','Đố vui']];
      return send(200,html,'<title>OLP 2024 Không chuyên</title><div class="contest-problems"><table>'+names.map(([code,name])=>'<tr><td><a href="/problem/'+code+'">Olympic Sinh Viên 2024 - Không chuyên - '+name+'</a></td></tr>').join('')+'</table></div>');
    }
    if(control.combined && request.method==='GET' && url.pathname==='/pdf/combined.pdf') {
      if(control.requirePdfAuth && !user)return send(302,{Location:'/accounts/login/'});
      return send(200,{'Content-Type':'application/pdf'},require('node:fs').readFileSync(require('node:path').join(__dirname,'../outputs/De-OLP-2024-Khong-chuyen.pdf')));
    }

    if (url.pathname === '/accounts/login/' && request.method === 'GET') {
      return send(200, { ...html, 'Set-Cookie': fresh }, page(undefined,
        `<form action="" method="post" class="form-area">${input('csrfmiddlewaretoken', csrf)}
         <input type="text" name="username"><input type="password" name="password"><input type="hidden" name="next" value=""></form>`));
    }
    if (url.pathname === '/accounts/login/') {
      if (!csrfOk() && !(jar.csrftoken === csrf && fields.get('csrfmiddlewaretoken') === csrf)) return send(302, { Location: '/accounts/login/' });
      const [name, password] = [fields.get('username'), fields.get('password')];
      if (name === 'nguyen-an' && password === 'correct horse') {
        return send(302, { Location: '/', 'Set-Cookie': ['sessionid=' + good + '; HttpOnly; Path=/', 'csrftoken=' + csrf + '; Path=/'] });
      }
      if (name === 'tfa' && password === 'pw') return send(302, { Location: '/', 'Set-Cookie': 'sessionid=tfa-session-0000; HttpOnly; Path=/' });
      if (name === 'evil' && password === 'pw') return send(302, { Location: foreignOrigin + '/steal', 'Set-Cookie': 'sessionid=' + good + '; Path=/' });
      return send(200, html, page(undefined, '<div id="form-errors"><p class="error">Sai</p></div>'));
    }
    if (url.pathname === '/' && request.method === 'GET') {
      if (jar.sessionid === 'tfa-session-0000') return send(302, { Location: '/accounts/2fa/?next=/' });
      if (jar.sessionid === 'redirect-away-0000') return send(302, { Location: foreignOrigin + '/steal' });
      return send(200, html, page(user));
    }
    if (url.pathname === '/accounts/logout/') {
      if (request.method === 'GET') return send(200, { ...html, 'Set-Cookie': fresh }, page(user,
        `<form action="/accounts/logout/" method="POST">${input('csrfmiddlewaretoken', csrf)}<button>Logout</button></form>`));
      return send(302, { Location: '/accounts/logout/', 'Set-Cookie': 'sessionid=; Max-Age=0; Path=/' });
    }
    const problem = url.pathname.match(/^\/problem\/([\w-]+)\/submit$/)?.[1];
    if (problem && request.method === 'GET') {
      if (!user) return send(302, { Location: '/accounts/login/?next=' + url.pathname });
      if (problem === 'missing') return send(404, html, 'x');
      if (problem === 'nolang') return send(200, { ...html, 'Set-Cookie': fresh }, page(user, form().replace(/<select[\s\S]*<\/select>/, '')));
      if (problem === 'limit') return send(200, { ...html, 'Set-Cookie': fresh }, page(user, form().replace('class="button"', 'class="button" disabled')));
      return send(200, { ...html, 'Set-Cookie': fresh }, page(user, form(problem === 'captcha' ? '<div class="cf-turnstile"></div>' : '')));
    }
    if (problem && request.method === 'POST') {
      if (!user) return send(302, { Location: '/accounts/login/?next=' + url.pathname });
      if (!csrfOk()) return send(302, { Location: url.pathname });
      if (!/^multipart\/form-data/.test(request.headers['content-type'] ?? '')) return send(400, html, 'x');
      if (problem === 'toomany') return send(429, html, '<h1>You submitted too many submissions.</h1>');
      if (problem === 'invalid') return send(200, html, page(user, form().replace('<div id="editor">',
        '<ul class="errorlist nonfield"><li>Source code/file is missing or redundant.</li></ul><div id="editor">')));
      if (problem === 'banned') return send(200, html, page(user, '<pre style="x">Banned &amp; barred</pre>'));
      if (problem === 'forbidden') return send(403, html, 'no');
      if (problem === 'foreign') return send(302, { Location: foreignOrigin + '/submission/1' });
      if (!['1', '2', '3'].includes(part('language')) || part('source') === undefined || part('judge') !== '') return send(400, html, 'x');
      control.posts.push(problem);
      const id = nextId++;
      submissions.set(String(id), { polls: 0, problem, language: part('language'), source: part('source') });
      return send(302, { Location: '/submission/' + id });
    }
    if (url.pathname === '/widgets/single_submission') {
      const item = submissions.get(url.searchParams.get('id'));
      if (!item) return send(404, html, 'x');
      item.polls++;
      const outcome = control.outcome ?? { p1: ['AC', '100 / 100'], partial: ['WA', '40 / 100'], pac: ['PAC', '37.5 / 100'], hold: ['TLE', '55 / 100'], ce: ['CE', '---'] }[item.problem] ?? ['AC', '100 / 100'];
      if (item.problem === 'never' || item.polls < 3 || item.problem === 'hold' && !control.released) return send(200, html, row(item.polls < 2 ? 'QU' : 'G', '', true));
      return send(200, html, row(outcome[0], outcome[1], false));
    }
    // Trang công khai của bài (olp.import dùng link một bài): tiêu đề và, tuỳ control.pdf, một đề PDF.
    const publicProblem = url.pathname.match(/^\/problem\/([\w-]+)$/)?.[1];
    if (publicProblem && request.method === 'GET') {
      if(control.practice)return send(200,html,'<title>'+({olp_kc25_cpencils:'Bút chì màu',olp_kc25_delivery:'Giao hàng'}[publicProblem]??publicProblem)+'</title><a href="/pdf/practice.pdf">PDF</a>');
      if(control.combined) {
        if(control.requireAuth&&!user)return send(302,{Location:'/accounts/login/'});
        const names={p1:'Đăng ký học phần',partial:'Đường đi',pac:'Ba số nguyên tố',hold:'Đố vui'};
        return send(200,html,'<title>Olympic Sinh Viên 2024 - Không chuyên - '+(names[publicProblem]??publicProblem)+'</title><a href="/pdf/combined.pdf">PDF</a>'+(control.htmlSamples?'<h4>Input</h4><pre>2 3\n</pre><h4>Output</h4><pre>5\n</pre>':''));
      }
      return send(200, html, '<html><head><title>Easy Math - VNOJ: VNOI Online Judge</title></head><body>' +
        (control.pdf ? '<a href="/pdf/' + publicProblem + '.pdf">PDF</a>' : '') + '</body></html>');
    }
    if (control.pdf && request.method === 'GET' && /^\/pdf\/[\w-]+\.pdf$/.test(url.pathname)) {
      return send(200, { 'Content-Type': 'application/pdf' }, '%PDF-1.4\n%mock\n');
    }
    send(404, html, 'x');
  });

  const foreign = createServer((request, response) => {
    foreignLog.push({ path: request.url, cookie: request.headers.cookie });
    response.writeHead(200).end('ok');
  });


  const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port)));
  return {
    log, foreignLog, submissions, control,
    get origin() { return origin; }, get foreignOrigin() { return foreignOrigin; },
    async start() { origin = await listen(mock); foreignOrigin = await listen(foreign); return this; },
    stop() { mock.close(); foreign.close(); mock.closeAllConnections(); foreign.closeAllConnections(); }
  };
}

module.exports = { createMock, csrf, form, good, page, row };
