'use strict';
// Test-only helpers. No request headers/bodies are inspected or retained.
const fs = require('node:fs'), path = require('node:path');
const origin = 'https://oj.vnoi.info';
function guard(inner, requests, { owned = () => /[\\/]extension[\\/](?:submit|vnoj|imports)\.js/.test(new Error().stack), manual = () => false } = {}) {
  return async function(input, init) {
    if (!owned()) return inner(input, init); // VS Code's own experimentation traffic is outside this boundary.
    const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
    const method = String(init?.method ?? input?.method ?? 'GET').toUpperCase();
    const row = { path: url.pathname, method, status: 'ERR', phase: manual() ? 'manual' : 'automatic' };
    requests.push(row);
    if (url.origin !== origin || url.username || url.password || (method !== 'GET' && !(manual() && method === 'POST' && /^\/problem\/[\w-]+\/submit\/?$/.test(url.pathname)))) {
      row.status = 'BLOCKED'; throw Error('Live quick network guard: blocked ' + method + ' ' + url.pathname);
    }
    const response = await inner(input, init);
    row.status = response.status;
    return response;
  };
}
function sensitiveFiles(root) {
  const found = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { if (file !== path.join(root, 'profile')) walk(file); continue; }
      const bytes = fs.readFileSync(file);
      // Detect values, not source-code references to cookie field names. Never return a match/value.
      if ([bytes.toString('utf8'), bytes.toString('utf16le')].some(text => /sessionid\s*(?:=|["']\s*:\s*["'])\s*[a-zA-Z0-9_-]{16,}|(?:^|[\r\n])\s*cookie\s*:\s*[^\r\n]+/im.test(text))) found.push(path.relative(root, file));
    }
  }
  walk(root); return found;
}
function safe(text) { return String(text).replace(/sessionid\s*=\s*[^\s;"']+/gi, '[redacted]').replace(/(?:^|[\r\n])\s*cookie\s*:[^\r\n]*/gi, '\n[redacted header]'); }
module.exports = { guard, sensitiveFiles, safe };
if (require.main === module) {
  const bad = sensitiveFiles(path.resolve(process.argv[3]));
  if (bad.length) { console.error('Sensitive-pattern scan FAIL (paths only): ' + bad.join(', ')); process.exitCode = 1; }
  else console.log('Sensitive-pattern scan PASS (profile excluded; no cookie values inspected by the test)');
}
