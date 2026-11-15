'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { once } = require('node:events');
const root = process.argv[2];
const port = process.argv[3];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function capture() {
  let target;
  for (let attempt = 0; attempt < 70; attempt++) {
    const ready = await fs.stat(path.join(root, 'fixture', 'review-ready')).catch(() => false);
    const targets = await fetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json()).catch(() => []);
    target = targets.find(item => item.type === 'page' && item.url.includes('workbench'));
    if (ready && target) break;
    await wait(250);
    target = undefined;
  }
  if (!target) throw new Error('Không mở được phiên xem thử VS Code.');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await once(socket, 'open');
  let id = 0;
  const requests = new Map();
  socket.addEventListener('message', message => {
    const reply = JSON.parse(message.data);
    requests.get(reply.id)?.(reply);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const sequence = ++id;
    requests.set(sequence, reply => {
      requests.delete(sequence);
      if (reply.error) reject(new Error(reply.error.message));
      else resolve(reply.result);
    });
    socket.send(JSON.stringify({ id: sequence, method, params }));
  });
  try {
    const view = await call('Runtime.evaluate', { expression: '({width:innerWidth,height:innerHeight,title:document.title})', returnByValue: true });
    console.log(view.result.value);
    await wait(1900);
    const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await fs.writeFile(path.join(root, 'current.png'), Buffer.from(screenshot.data, 'base64'));
  } finally {
    socket.close();
  }
}

capture().catch(error => { console.error(error); process.exitCode = 1; });
