'use strict';

const assert = require('node:assert/strict');
const timer = require('./olp-vscode/session');
const vnoj = require('./olp-vscode/vnoj');

async function main() {
  const start = 100000;
  const kit = { title: 'Kỳ thi', problems: [{ key: 'A', name: 'Một' }, { key: 'B', name: 'Hai' }] };
  const session = timer.start(kit, start, 'test');
  assert(timer.focus(session, 'A', start + 5000));
  assert(!timer.focus(session, 'A', start + 8000));
  assert(timer.focus(session, 'B', start + 15000));
  const resumed = JSON.parse(JSON.stringify(session));
  assert(timer.finish(resumed, session.deadline, true));
  assert(!timer.finish(resumed, session.deadline + 1000, true));
  assert(!timer.focus(resumed, 'A', session.deadline + 1000));
  timer.event(resumed, 'verdict', session.deadline + 1000, { problem: 'B', text: 'AC' });
  assert.equal(timer.stats(resumed).A.elapsed, 10000);
  assert.equal(timer.stats(resumed).B.elapsed, timer.DURATION - 15000);
  assert.match(timer.markdown(resumed), /03:00:01.*AC/);

  assert.equal(vnoj.inputUrl('https://oj.vnoi.info/contest/olp_kc25/all/'), 'https://oj.vnoi.info/contest/olp_kc25');
  assert.equal(vnoj.inputUrl('https://oj.vnoi.info@evil.invalid/contest/olp_kc25'), undefined);
  const html = '<a href="/problem/other">Other</a><div class="contest-problems"><table><tr><td><a href="/problem/b">B &amp; C</a></td></tr><tr><td><a href="/problem/a">Đề A</a></td></tr></table></div>';
  assert.deepEqual(vnoj.contestProblems(html).map(x => x.name), ['B & C', 'Đề A']);
  const problem = { url: vnoj.origin + '/problem/a' };
  const seen = [];
  const pdf = await vnoj.statement(problem, async url => {
    seen.push(url);
    if (url === problem.url) return new Response('<a href="/pdf/abc.pdf">Đề bài</a>');
    return new Response('%PDF-example');
  });
  assert.equal(pdf.toString(), '%PDF-example');
  assert.deepEqual(seen, [problem.url, vnoj.origin + '/pdf/abc.pdf']);

  const received = [];
  const server = await vnoj.listen('127.0.0.1', value => received.push(value));
  try {
    const send = (body, origin) => fetch('http://127.0.0.1:' + vnoj.port + '/', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify(body)
    });
    const payload = { name: 'Đề A', url: problem.url, tests: [{ input: '1\n', output: '2\n' }], batch: { id: 'test', size: 1 } };
    assert.equal((await send(payload, 'https://bad.example')).status, 403);
    assert.equal((await send(payload, 'chrome-extension://test')).status, 200);
    assert.deepEqual(received[0].tests, payload.tests);
  } finally {
    server.close();
    server.closeAllConnections();
  }
  console.log('Passed timer, restore, report, contest parsing, PDF download and Companion payload checks.');
}

main().catch(error => { process.exitCode = 1; console.error(error); });
