'use strict';

const { createServer } = require('node:http');
const origin = 'https://oj.vnoi.info';
const port = 27177;
const attributes = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

function vnojUrl(value, pattern) {
  try {
    const url = new URL(value, origin);
    return url.origin === origin && !url.username && !url.password &&
      pattern.test(url.pathname) ? url : undefined;
  } catch {
    return undefined;
  }
}

function inputUrl(value) {
  const input = value.trim();
  const url = vnojUrl(input, /^\/(?:contest\/[\w-]+(?:\/all)?|problem\/[\w-]+)\/?$/);
  if (!input.startsWith('https://') || !url) return undefined;
  const [, kind, code] = url.pathname.split('/');
  return url.origin + '/' + kind + '/' + code;
}

function plain(html) {
  const names = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return html.replace(/<[^>]*>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, name) => {
      if (!name.startsWith('#')) return names[name.toLowerCase()];
      const number = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return number > 0 && number <= 0x10FFFF ? String.fromCodePoint(number) : entity;
    }).replace(/\s+/g, ' ').trim();
}

function contestProblems(html) {
  const table = html.match(/<div\b[^>]*class\s*=\s*["'][^"']*\bcontest-problems\b[^"']*["'][^>]*>[\s\S]*?<table\b[\s\S]*?<\/table>/i)?.[0];
  if (!table) return [];
  const problems = new Map();
  for (const match of table.matchAll(/<a\b([^>]+)>([\s\S]*?)<\/a>/gi)) {
    const attr = [...match[1].matchAll(attributes)][0];
    const url = attr && vnojUrl(attr[1] ?? attr[2], /^\/problem\/[\w-]+\/?$/);
    if (!url) continue;
    const path = url.pathname.replace(/\/$/, '');
    problems.set(path, { url: origin + path, name: plain(match[2]) || path.split('/').at(-1) });
  }
  return [...problems.values()];
}

async function fetchBytes(value, maximum, fetcher = globalThis.fetch, sid, { timeoutMs=20000, retryDelayMs=250 }={}) {
  for(let attempt=0;attempt<2;attempt++)try{return await fetchOnce(value,maximum,fetcher,sid,timeoutMs);}catch(error){
    const code=error.cause?.code??(['AbortError','TimeoutError'].includes(error.name)?error.name:error.code??error.name);
    const transient=error.retryable||/^(?:AbortError|TimeoutError|ECONN\w*|ETIMEDOUT|ENET\w*|EAI_AGAIN|UND_ERR_\w+)$/.test(code)||error.message==='fetch failed';
    if(!transient||attempt===1){const failure=new Error('VNOJ GET '+new URL(value,origin).pathname+': '+error.message+' (cause='+code+')',{cause:error});failure.code=code;throw failure;}
    await new Promise(resolve=>setTimeout(resolve,retryDelayMs));
  }
}
async function fetchOnce(value, maximum, fetcher, sid, timeoutMs) {
  let url = value;
  const signal = AbortSignal.timeout(timeoutMs);
  for (let hop = 0; hop < 4; hop++) {
    const target = new URL(url);
    if (target.origin !== origin || target.username || target.password) throw new Error('Đã chặn địa chỉ ngoài VNOJ.');
    const headers = { 'Accept-Language': 'vi,en;q=0.8' };
    if (sid && /^[\w-]{8,200}$/.test(sid)) headers.Cookie = 'sessionid=' + sid;
    const response = await fetcher(url, { method: 'GET', redirect: 'manual', signal, headers });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = new URL(response.headers.get('location'), url);
      await response.body?.cancel();
      if (next.origin !== origin || next.username || next.password || next.pathname.startsWith('/accounts/')) {
        throw new Error('VNOJ yêu cầu đăng nhập hoặc chuyển sang địa chỉ khác.');
      }
      url = next.href;
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      const error=new Error('VNOJ trả về HTTP ' + response.status + '.');error.code='HTTP_'+response.status;error.retryable=response.status>=500;throw error;
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > maximum) throw new Error('Tệp đề vượt quá dung lượng hỗ trợ.');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  throw new Error('VNOJ chuyển hướng quá nhiều lần.');
}

async function loadList(url) {
  const html = (await fetchBytes(url, 4_000_000)).toString('utf8');
  const title = plain(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')
    .replace(/\s*-\s*VNOJ:.*$/i, '') || url.split('/').at(-1);
  const problems = url.includes('/contest/') ? contestProblems(html) : [{ url, name: title }];
  if (!problems.length) throw new Error('Không đọc được danh sách bài công khai. Thử nhập bằng Competitive Companion.');
  return { title, problems: problems.slice(0, 26) };
}

async function statement(problem, fetcher) {
  const html = await fetchBytes(problem.url, 5_000_000, fetcher).catch(() => undefined);
  const links = [...(html?.toString('utf8') ?? '').matchAll(attributes)]
    .map(match => vnojUrl(match[1] ?? match[2], /^\/pdf\/[\w.-]+\.pdf$/i))
    .filter(Boolean);
  for (const url of [...new Set(links.map(link => link.href)), problem.url + '/pdf']) {
    const bytes = await fetchBytes(url, 25_000_000, fetcher).catch(() => undefined);
    if (bytes?.subarray(0, 5).toString() === '%PDF-') return bytes;
  }
  return undefined;
}

function validatePayload(data) {
  const url = vnojUrl(data?.url, /^\/problem\/[\w-]+\/?$/);
  if (!url || typeof data.name !== 'string' || !data.name.trim() || !Array.isArray(data.tests)) {
    throw new Error('Competitive Companion chưa gửi một bài VNOJ hợp lệ.');
  }
  return {
    url: url.origin + url.pathname.replace(/\/$/, ''),
    name: data.name.trim().slice(0, 300),
    tests: data.tests.slice(0, 50).filter(test => typeof test?.input === 'string' && typeof test?.output === 'string'),
    batchId: typeof data.batch?.id === 'string' ? data.batch.id : undefined,
    batchSize: Number.isSafeInteger(data.batch?.size) && data.batch.size > 0 ? Math.min(26, data.batch.size) : 1
  };
}

async function listen(host, accept) {
  const server = createServer(async (request, response) => {
    // Competitive Companion sends this on localhost from its extension context.
    if (request.method !== 'POST' || request.url !== '/' ||
        !/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '') ||
        (request.headers.origin && !/^(chrome|moz)-extension:\/\//.test(request.headers.origin))) {
      response.writeHead(403).end();
      return;
    }
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 2_000_000) throw new Error('Gói đề quá lớn.');
        chunks.push(chunk);
      }
      accept(validatePayload(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
      response.writeHead(200).end();
    } catch {
      if (!response.destroyed) response.writeHead(400).end();
    }
  });
  server.requestTimeout = 15000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  return server;
}

module.exports = { contestProblems, fetchBytes, inputUrl, listen, loadList, origin, plain, port, statement, validatePayload, vnojUrl };
