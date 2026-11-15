'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { once } = require('node:events');
const [root, port] = process.argv.slice(2);
const fixture = path.join(root, 'fixture');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const targets = () => fetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json()).catch(() => []);

async function until(fn, name, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = await fn();
    if (found) return found;
    await sleep(120);
  }
  throw new Error('Timed out: ' + name);
}

async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await once(socket, 'open');
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', message => {
    const response = JSON.parse(message.data);
    pending.get(response.id)?.(response);
  });
  async function call(method, params = {}) {
    const current = ++id;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(method + ' timed out')), 8000);
      pending.set(current, response => {
        clearTimeout(timeout);
        pending.delete(current);
        if (response.error) reject(new Error(response.error.message));
        else resolve(response.result);
      });
      socket.send(JSON.stringify({ id: current, method, params }));
    });
  }
  return { socket, call };
}

let app;
const evaluate = async expression => {
  const result = await app.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'Script failed');
  return result.result.value;
};
const literal = JSON.stringify;
const bodyHas = label => evaluate('document.body.innerText.includes(' + literal(label) + ')');
const point = (selector, label) => evaluate('(() => { const e = [...document.querySelectorAll(' + literal(selector) +
  ')].find(el => el.getBoundingClientRect().width && (el.innerText?.trim() === ' + literal(label) +
  ' || el.getAttribute("aria-label") === ' + literal(label) + ' || el.title === ' + literal(label) +
  ')); if(!e)return; e.scrollIntoView({block:"nearest"}); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()');
async function mouse(where, button = 'left', count = 1) {
  await app.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...where });
  await app.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...where, button, clickCount: count });
  await app.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...where, button, clickCount: count });
}
async function click(selector, label, button) {
  await mouse(await until(() => point(selector, label), label), button);
}
async function context(label) {
  await click('.context-view .action-label', label);
  if (await point('.context-view .action-label', label)) await enter();
}
const button = label => click('button,a[role=button],.monaco-button,[role=button]', label);
async function key(value, code, modifiers = 0) {
  for (const type of ['keyDown', 'keyUp']) {
    await app.call('Input.dispatchKeyEvent', { type, key: value, code, modifiers,
      windowsVirtualKeyCode: ({ Enter: 13, Escape: 27, KeyP: 80, KeyS: 83, KeyV: 86, KeyN: 78 })[code] });
  }
}
const enter = () => key('Enter', 'Enter');
const type = text => app.call('Input.insertText', { text });
async function editorType(text) {
  const where = await until(() => evaluate('(() => {const e=document.querySelector(".editor-group-container.active .view-lines") || document.querySelector(".editor-group-container .view-lines");if(!e)return;const r=e.getBoundingClientRect();return {x:r.x+8,y:r.y+8};})()'), 'editor buffer');
  await mouse(where);
  await type(text);
}
const quick = () => evaluate('!!document.querySelector(".quick-input-widget input:focus")');
async function palette(label) {
  await key('P', 'KeyP', 10);
  await until(quick, 'command palette');
  await type(label);
  await until(() => evaluate('document.querySelector(".quick-input-list .monaco-list-row.focused")?.innerText.includes(' + literal(label) + ')'), label);
  await enter();
}
const waitText = (label, timeout) => until(() => bodyHas(label), label, timeout);
const row = (label, action) => click('.monaco-list-row .label-name', label, action);
async function openRow(label) {
  const where = await until(() => point('.monaco-list-row .label-name', label), label);
  await mouse({ x: 71, y: where.y });
}
const choose = async label => {
  await until(quick, 'quick pick');
  await click('.quick-input-list .monaco-highlighted-label', label);
};
async function inline(label, action) {
  const where = await until(() => point('.monaco-list-row .label-name', label), label);
  await app.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...where });
  const hit = await until(() => evaluate('(() => {const row=[...document.querySelectorAll(".monaco-list-row")].find(e=>e.querySelector(".label-name")?.innerText.trim()===' + literal(label) + ');const action=[...row.querySelectorAll(".action-label")].find(e=>[e.title,e.getAttribute("aria-label"),e.getAttribute("data-tooltip")].includes(' + literal(action) + '));if(!action)return;const r=action.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()'), action);
  await mouse(hit);
}
async function screenshot(name) {
  await sleep(450);
  const image = await app.call('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(path.join(root, name + '.png'), Buffer.from(image.data, 'base64'));
}
async function kitFolder() {
  const names = await fs.readdir(fixture);
  const sorted = await Promise.all(names.filter(name => name.startsWith('OLP-')).map(async name =>
    ({ name, stat: await fs.stat(path.join(fixture, name)) })));
  return sorted.sort((a,b) => b.stat.birthtimeMs - a.stat.birthtimeMs).at(0)?.name;
}
async function submitPayload() {
  return fetch('http://127.0.0.1:27177/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'chrome-extension://test' },
    body: JSON.stringify({
      name: 'Bài mẫu Companion', url: 'https://oj.vnoi.info/problem/olp_kc25_cpencils',
      tests: [{ input: '2 3\n', output: '5\n' }]
    })
  }).then(response => response.ok).catch(() => false);
}

async function run() {
  const target = await until(async () => (await targets()).find(item => item.type === 'page' && item.url.includes('workbench')), 'VS Code');
  app = await connect(target);
  await until(() => evaluate('!!document.querySelector(".activitybar")'), 'workbench');
  const closeChat = await point('.auxiliarybar .action-label', 'Hide Secondary Side Bar');
  if (closeChat) await mouse(closeChat);
  await click('.activitybar [role=tab],.activitybar .action-label', 'OLP Thi thử');
  await waitText('Tải đề VNOJ');
  await click('a', 'Tải đề VNOJ');
  await until(quick, 'contest URL');
  await type('https://oj.vnoi.info/contest/olp_kc24');
  await enter();
  await choose('C++');
  await waitText('Đăng ký học phần', 45000);
  const kit = path.join(fixture, await kitFolder());
  for (const name of 'ABCD') {
    const data = await fs.readFile(path.join(kit, name, 'De-bai.pdf'));
    assert.equal(data.subarray(0, 5).toString(), '%PDF-');
  }
  console.log('PASS tải đề VNOJ qua giao diện, 4 PDF');
  await row('Bắt đầu 180 phút');
  const firstClock = await until(() => evaluate('document.querySelector(".statusbar")?.innerText.match(/OLP 02:59:\\d+/)?.[0]'), 'clock');
  await until(async () => (await evaluate('document.querySelector(".statusbar")?.innerText.match(/OLP 02:59:\\d+/)?.[0]')) !== firstClock, 'countdown tick');
  await openRow('A · Đăng ký học phần');
  await row('Mở mã · A.cpp');
  await until(() => evaluate('!!document.querySelector(".tab[aria-label*=\\\"A.cpp\\\"]")'), 'A.cpp tab');
  await editorType('// gui-test-only');
  await row('input.txt');
  await waitText('Thử input/output');
  await until(() => evaluate('!!document.querySelector(".tab.active[aria-label*=\\\"input.txt\\\"]")'), 'input editor focused');
  await sleep(250);
  await editorType('3 4');
  await key('s', 'KeyS', 2);
  await until(async () => (await fs.readFile(path.join(kit,'A','input.txt'),'utf8')).includes('3 4'), 'test input saved');
  await row('output.txt');
  await until(() => evaluate('!!document.querySelector(".tab.active[aria-label*=\\\"output.txt\\\"]")'), 'output editor focused');
  await sleep(250);
  await editorType('7');
  await key('s', 'KeyS', 2);
  await until(async () => (await fs.readFile(path.join(kit,'A','output.txt'),'utf8')).includes('7'), 'expected output saved');
  await row('Mở mã · A.cpp');
  await row('Mở đề');
  await until(() => evaluate('[...document.querySelectorAll(".tab")].some(el => el.innerText.includes("A · Đăng ký học phần"))'), 'PDF tab');
  await screenshot('01-doc-de');
  const tabs = await evaluate('[...document.querySelectorAll(".editor-group-container")].filter(e=>e.getBoundingClientRect().width).map(e=>e.innerText.slice(0,100))');
  assert(tabs.some(tab => tab.includes('A.cpp')));
  assert(tabs.some(tab => tab.includes('Đăng ký học phần')));
  const frame = await evaluate('(() => {const el=document.querySelector(".editor-group-container iframe.webview");if(!el)return;const r=el.getBoundingClientRect();return {x:r.right-102,y:r.top+20};})()');
  if (frame) {
    await mouse(frame);
    await screenshot('01-zoom');
    await mouse(frame);
  }
  console.log('PASS bộ đếm, mở đề và mã cạnh nhau');
  await openRow('B · Đường đi');
  const analysis = await until(() => evaluate('(() => {const matches=[...document.querySelectorAll(".monaco-list-row .label-name")].filter(e=>e.innerText.trim()==="Đọc / phân tích đề");if(matches.length<2)return;const r=matches[1].getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()'), 'analysis B');
  await mouse(analysis);
  await waitText('B · Đọc / phân tích đề');
  await row('A · Đăng ký học phần', 'right');
  await context('Ghi mốc');
  await choose('Bị kẹt');
  await waitText('Bị kẹt');
  await inline('A · Đăng ký học phần', 'Ghi kết quả chấm');
  await choose('AC');
  await waitText('Kết quả (tự ghi) · AC');
  await inline('B · Đường đi', 'Ghi kết quả chấm');
  await choose('Nhập điểm / kết quả…');
  await until(quick, 'score input');
  await type('40/100');
  await enter();
  await waitText('40/100');
  await inline('A · Đăng ký học phần', 'Nộp trên VNOJ');
  await waitText('https://oj.vnoi.info/problem/olp_kc24_credit/submit');
  await button('Open');
  await waitText('Mở trang nộp', 25000);
  await row('A · Đăng ký học phần', 'right');
  await context('Ghi đã nộp');
  await waitText('Đã nộp (tự xác nhận)');
  console.log('PASS ghi mốc, AC, điểm từng phần, thao tác mở form và xác nhận');
  await row('Kết thúc phiên');
  await button('Kết thúc');
  await waitText('Đã kết thúc');
  await row('Sao chép báo cáo');
  await waitText('Đã sao chép báo cáo Markdown');
  const reportFile = await until(async () => (await fs.readdir(kit)).find(name => /^phien-.*\.md$/.test(name)), 'report file');
  const report = await fs.readFile(path.join(kit, reportFile), 'utf8');
  for (const label of ['Đọc / phân tích đề','Viết mã','Bị kẹt','AC','40/100','Đã nộp (tự xác nhận)','Kết thúc']) assert(report.includes(label),label);
  assert(report.includes('Mở trang nộp'));
  await palette('OLP: Mở báo cáo một phiên');
  await choose('Olympic Sinh viên 2024 - Khối Không chuyên');
  await screenshot('02-bao-cao');
  console.log('PASS kết thúc, báo cáo, lịch sử');
  await palette('OLP: Chuẩn bị phiên ngoại tuyến A–D');
  await choose('Python');
  await waitText('Luyện ngoại tuyến');
  const local = path.join(fixture, await kitFolder());
  for (const name of 'ABCD') {
    for (const file of [name + '.py','input.txt','output.txt']) await fs.access(path.join(local, name, file));
  }
  console.log('PASS bộ đề ngoại tuyến và file input/output');
  await palette('OLP: Nhận đề từ Competitive Companion');
  await button('Chờ nhận đề');
  await until(submitPayload, 'Companion receiver', 18000);
  await choose('C++');
  await waitText('Bài mẫu Companion', 25000);
  const imported = path.join(fixture, await kitFolder(), 'A');
  assert.equal(await fs.readFile(path.join(imported, 'mau-1.in'), 'utf8'), '2 3\n');
  assert.equal(await fs.readFile(path.join(imported, 'mau-1.out'), 'utf8'), '5\n');
  assert.equal(await fs.readFile(path.join(imported, 'output.txt'), 'utf8'), '5\n');
  console.log('PASS nhận payload Companion từ cổng thật qua thao tác giao diện');
}

run().catch(async error => {
  console.error(error.message);
  if (app) await screenshot('error').catch(() => {});
  process.exitCode = 1;
}).finally(() => app?.socket.close());
