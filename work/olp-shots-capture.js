'use strict';

// Chụp cửa sổ VS Code cô lập qua CDP ở hai cỡ cửa sổ mỗi khi olp-shots-entry.js yêu cầu.
//   node olp-shots-capture.js <thư mục fixture> <cổng gỡ lỗi> <thư mục ra> <tiền tố>
const fs = require('node:fs/promises');
const path = require('node:path');
const { once } = require('node:events');
const {createHash}=require('node:crypto');
const [, , fixture, port, out, prefix = '', timeoutMs = '420000'] = process.argv;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const sizes = [[1366, 768], [1920, 1080]];
setTimeout(()=>{console.error('Screenshot suite exceeded timeout ('+timeoutMs+' ms)');process.exit(1);},Number(timeoutMs)).unref();

async function connect() {
  for (let attempt = 0; attempt < 120; attempt++) {
    const targets = await fetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json()).catch(() => []);
    const target = targets.find(item => item.type === 'page' && item.url.includes('workbench'));
    if (target) return target;
    await wait(500);
  }
  throw new Error('Không thấy cửa sổ VS Code.');
}

async function main() {
  await fs.mkdir(out, { recursive: true });
  const target = await connect();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await once(socket, 'open');
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', message => {
    const reply = JSON.parse(message.data);
    pending.get(reply.id)?.(reply);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const sequence = ++id;
    pending.set(sequence, reply => {
      pending.delete(sequence);
      if (reply.error) reject(new Error(method + ': ' + reply.error.message));
      else resolve(reply.result);
    });
    socket.send(JSON.stringify({ id: sequence, method, params }));
  });
  let last = 0;
  for (;;) {
    if (await fs.stat(path.join(fixture, 'shots-done')).then(() => true, () => false)) break;
    const stage = await fs.readFile(path.join(fixture, 'stage.json'), 'utf8').then(JSON.parse, () => undefined);
    if (!stage || stage.sequence <= last) { await wait(250); continue; }
    last = stage.sequence;
    const key=async(key,code)=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:code});await call('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode:code});};
    if(stage.action==='cookie'){await key('Enter',13);await wait(900);}
    const expect=async()=>{if(!stage.expectText)return;const end=Date.now()+30000;while(Date.now()<end){const result=await call('Runtime.evaluate',{expression:'document.body.innerText.includes('+JSON.stringify(stage.expectText)+')',returnByValue:true});if(result.result.value)return;await wait(100);}throw Error('Scene '+stage.name+': expected visible UI text '+JSON.stringify(stage.expectText));};
    await expect();
    for (const [width, height] of sizes) {
      await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await wait(2200);
      await expect();
      const shot = await call('Page.captureScreenshot', { format: 'png' });
      const bytes=Buffer.from(shot.data,'base64');
      if(stage.name==='quick-ready-code-input-output'){const previous=await fs.readFile(path.join(out,prefix+'quick-link-selection-'+width+'x'+height+'.png'));if(previous.equals(bytes))throw Error('Quick ready capture is identical to link selection at '+width+'x'+height);}
      await fs.writeFile(path.join(out, prefix + stage.name + '-' + width + 'x' + height + '.png'),bytes);
      await fs.appendFile(path.join(out,'capture-audit.jsonl'),JSON.stringify({ts:new Date().toISOString(),scene:stage.name,width,height,expectedText:stage.expectText,sha256:createHash('sha256').update(bytes).digest('hex')})+'\n');
    }
    await call('Emulation.clearDeviceMetricsOverride');
    if(stage.action==='cookie'||stage.action==='cancel-modal')await key('Escape',27);
    if(stage.action==='choose')await key('Enter',13);
    await fs.writeFile(path.join(fixture, 'ack-' + stage.sequence), 'ok');
    console.log('chụp ' + stage.name);
  }
  socket.close();
}

main().catch(error => { console.error(error); process.exit(1); });
