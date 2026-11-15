'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { guard, sensitiveFiles, safe } = require('./live-quick-tools');
(async () => {
  const rows = [], calls = []; let manual = false;
  const fetcher = guard(async (url, init) => { calls.push([url, init]); return {status: 200}; }, rows, { owned: () => true, manual: () => manual });
  await fetcher('https://oj.vnoi.info/contest/olp24?unused=not-recorded');
  assert.deepEqual(rows[0], { path: '/contest/olp24', method: 'GET', status: 200, phase: 'automatic' });
  await assert.rejects(fetcher('https://other.invalid/steal'), /blocked/);
  await assert.rejects(fetcher('https://oj.vnoi.info/problem/p1/submit', {method:'POST'}), /blocked/);
  assert.equal(calls.length, 1);
  manual = true;
  await fetcher('https://oj.vnoi.info/problem/p1/submit', {method:'POST'});
  await assert.rejects(fetcher('https://oj.vnoi.info/contest/olp24/join', {method:'POST'}), /blocked/);
  assert.equal(calls.length, 2);
  await guard(async () => ({status:204}), [], {owned:()=>false})('https://internal.invalid/');
  const root = path.join(__dirname, 'quick-tools-' + Date.now());
  fs.mkdirSync(path.join(root, 'profile'), {recursive:true});
  fs.writeFileSync(path.join(root, 'profile', 'excluded'), 'sessionid=' + 'x'.repeat(32));
  fs.writeFileSync(path.join(root, 'safe'), 'sessionid= field name only');
  assert.deepEqual(sensitiveFiles(root), []);
  fs.writeFileSync(path.join(root, 'leak'), 'sessionid=' + 'y'.repeat(32));
  fs.writeFileSync(path.join(root, 'header'), Buffer.from('Cookie: hidden', 'utf16le'));
  assert.deepEqual(sensitiveFiles(root).sort(), ['header','leak']);
  assert(!safe('sessionid=' + 'z'.repeat(32)).includes('z'.repeat(32)));
  // The same authenticated shared-PDF fixture used by the host journey, without VS Code.
  const mock = await require('./mock-vnoj').createMock('https://oj.vnoi.info').start();
  const actualFetch = globalThis.fetch, requests = [];
  Object.assign(mock.control, {combined:true,requireAuth:true,requirePdfAuth:true,htmlSamples:true});
  const fetcher2 = guard((input, init) => {const u=new URL(input);return actualFetch(mock.origin+u.pathname+u.search,init);}, requests, {owned:()=>true});
  try {
    const imports = require('./olp-vscode/imports');
    const opts = {sid:require('./mock-vnoj').good,fetcher:fetcher2};
    const list = await imports.loadList('https://oj.vnoi.info/contest/olp24',opts);
    assert.equal(list.problems.length,4);
    const statement = await imports.statement(list.problems[0],opts);
    assert.equal(statement.pdf.subarray(0,5).toString(),'%PDF-');
    assert.equal(statement.tests.length,1);
    assert.deepEqual(requests.filter(r=>r.path==='/pdf/combined.pdf').map(r=>r.status),[302,200]);
    assert(requests.every(r=>r.method==='GET'));
  } finally {await mock.stop();}
  console.log('live quick tooling pure PASS 10');
})().catch(error => { console.error(error); process.exitCode=1; });
