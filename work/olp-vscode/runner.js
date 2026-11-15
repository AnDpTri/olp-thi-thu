'use strict';

// Biên dịch và chạy lời giải, so sánh kết quả. Không phụ thuộc VS Code.
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const exe = process.platform === 'win32' ? '.exe' : '';
const maxOutput = 20_000_000;
const maxError = 200_000;
const split = text => String(text ?? '').match(/"[^"]*"|\S+/g)?.map(item => item.replace(/^"|"$/g, '')) ?? [];
const hash = text => createHash('sha1').update(text).digest('hex').slice(0, 16);

const defaults = {
  cpp: { compiler: 'g++', flags: '-std=c++20 -O2 -Wall' },
  c: { compiler: 'gcc', flags: '-std=c17 -O2 -Wall' },
  py: { command: 'python' }
};

const names = { cpp: 'C++', c: 'C', py: 'Python', java: 'Java' };

// Kế hoạch biên dịch + chạy cho một tệp lời giải: `file` là tên tệp trong thư mục bài (cwd), `build` là thư mục build.
function plan(extension, file, build, settings = {}) {
  const base = path.basename(file, path.extname(file));
  if (extension === 'cpp' || extension === 'c') {
    const option = { ...defaults[extension], ...settings[extension] };
    const out = path.join(build, base + exe);
    return {
      name: names[extension], out, stamp: path.join(build, base + '.stamp'),
      compile: { command: option.compiler, args: [...split(option.flags), file, '-o', out] },
      run: { command: out, args: [] }
    };
  }
  if (extension === 'py') {
    const option = { ...defaults.py, ...settings.py };
    return { name: names.py, run: { command: option.command, args: [file], env: { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } } };
  }
  if (extension === 'java') {
    const classes = path.join(build, base + '-classes');
    return {
      name: names.java, out: path.join(classes, 'Main.class'), stamp: path.join(build, base + '.stamp'),
      compile: { command: 'javac', args: ['-encoding', 'UTF-8', '-d', classes, file] },
      run: { command: 'java', args: ['-cp', classes, 'Main'] }
    };
  }
  return undefined;
}

function killTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    let tried = false;
    const direct = () => {
      if (tried || child.exitCode !== null) return;
      tried = true;
      try { child.kill('SIGKILL'); } catch { /* tiến trình đã kết thúc hoặc hệ điều hành từ chối */ }
    };
    try {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.on('error', direct);
      killer.on('exit', code => { if (code !== 0) direct(); });
    } catch { direct(); }
    return;
  }
  try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
}

// Chạy một tiến trình, cấp `input` qua stdin, giết khi quá `timeoutMs` hoặc khi `signal` bị huỷ.
function exec(command, args, { cwd, input, timeoutMs = 5000, signal, env } = {}) {
  return new Promise(resolve => {
    const started = process.hrtime.bigint();
    const elapsed = () => Number(process.hrtime.bigint() - started) / 1e6;
    let child;
    try {
      child = spawn(command, args, {
        cwd, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
        env: env ? { ...process.env, ...env } : undefined
      });
    } catch (error) {
      resolve({ error, ms: 0, stdout: Buffer.alloc(0), stderr: '' });
      return;
    }
    const out = [];
    const err = [];
    let errorTail = Buffer.alloc(0);
    let outputTail = Buffer.alloc(0);
    let outputHead = Buffer.alloc(0);
    let outSize = 0;
    let errSize = 0;
    let timedOut = false;
    let aborted = false;
    let truncated = false;
    let finished = false;
    let stopping = false;
    let fallback;
    const finish = result => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(fallback);
      signal?.removeEventListener('abort', abort);
      resolve({
        ms: elapsed(), timedOut, aborted, truncated, stdoutBytes: outSize, stderrBytes: errSize, stderrTruncated: errSize > maxError,
        stdout: truncated ? Buffer.concat([outputHead,Buffer.from('\n[OLP: OUTPUT TRUNCATED]\n'),outputTail]) : Buffer.concat(out),
        stderr: (errSize > maxError ? Buffer.concat([Buffer.concat(err).subarray(0,100000),Buffer.from('\n[OLP: STDERR TRUNCATED]\n'),errorTail]) : Buffer.concat(err)).toString('utf8'), ...result
      });
    };
    const stop = () => {
      if (stopping || finished) return;
      stopping = true;
      fallback = setTimeout(() => finish({ exitCode: null, signal: 'SIGKILL' }), 1500);
      killTree(child);
    };
    const abort = () => { aborted = true; stop(); };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    child.on('error', error => finish({ error, exitCode: null, signal: null }));
    child.stdout.on('data', chunk => {
      if(outputHead.length<100000)outputHead=Buffer.concat([outputHead,chunk.subarray(0,100000-outputHead.length)]);
      outputTail=Buffer.concat([outputTail,chunk]).subarray(-100000);
      outSize += chunk.length;
      if (outSize > maxOutput) { truncated = true; stop(); return; }
      out.push(chunk);
    });
    child.stderr.on('data', chunk => {
      errorTail=Buffer.concat([errorTail,chunk]).subarray(-100000);
      if (errSize < maxError) err.push(chunk.subarray(0,maxError-errSize));
      errSize += chunk.length;
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
    child.on('close', (exitCode, killedBy) => finish({ exitCode, signal: killedBy }));
  });
}

// gcc/clang: `A.cpp:12:5: error: ...`; javac: `A.java:3: error: ...`.
function parseDiagnostics(text) {
  const found = [];
  const pattern = /^(.+?):(\d+):(?:(\d+):)?\s*(fatal error|error|warning):\s*(.*)$/;
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(pattern);
    if (!match) continue;
    found.push({
      file: match[1], line: Number(match[2]), column: match[3] ? Number(match[3]) : 1,
      severity: match[4] === 'warning' ? 'warning' : 'error', message: match[5]
    });
    if (found.length >= 50) break;
  }
  return found;
}

async function exists(file) {
  return fs.stat(file).then(() => true, () => false);
}

// Biên dịch nếu cần (bỏ qua khi mã nguồn, trình biên dịch và cờ không đổi so với lần trước).
async function compile(p, { cwd, source, timeoutMs = 60000, signal } = {}) {
  if (!p.compile) return { ok: true, interpreted: true, ms: 0, diagnostics: [], errors: 0 };
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  const key = digest(JSON.stringify([cwd, p.compile, source]));
  // A stamp alone cannot vouch for a binary rebuilt/replaced outside this runner.
  // Legacy stamps have no output fingerprint and force one clean compilation.
  const previous = await fs.readFile(p.stamp, 'utf8').then(text => { try { return JSON.parse(text); } catch { return undefined; } }, () => undefined);
  const binaryHash = await fs.readFile(p.out).then(digest, () => undefined);
  if (previous?.version === 2 && previous.key === key && binaryHash && previous.binaryHash === binaryHash) {
    return { ok: true, cached: true, ms: 0, diagnostics: [], errors: 0 };
  }
  await fs.rm(p.stamp, { force: true });
  await fs.mkdir(path.dirname(p.stamp), { recursive: true });
  const result = await exec(p.compile.command, p.compile.args, { cwd, timeoutMs, signal });
  if (result.error) {
    return { ok: false, missing: result.error.code === 'ENOENT', command: p.compile.command, message: result.error.message, ms: result.ms, diagnostics: [], errors: 0, stderr: '' };
  }
  const text = result.stderr + result.stdout.toString('utf8');
  const diagnostics = parseDiagnostics(text);
  const errors = diagnostics.filter(item => item.severity === 'error').length;
  const ok = result.exitCode === 0 && !result.timedOut && !result.aborted;
  if (ok && await exists(p.out)) await fs.writeFile(p.stamp, JSON.stringify({version:2,key,binaryHash:digest(await fs.readFile(p.out))}));
  return {
    ok, ms: result.ms, diagnostics, errors: ok ? 0 : errors || 1, stderr: text.trim(),
    timedOut: result.timedOut, aborted: result.aborted,
    stderrBytes: result.stderrBytes, stderrTruncated: result.stderrTruncated
  };
}

const windowsCodes = {
  0xC0000005: 'truy cập bộ nhớ không hợp lệ (segmentation fault)',
  0xC00000FD: 'tràn ngăn xếp (đệ quy quá sâu?)',
  0xC0000094: 'chia số nguyên cho 0',
  0xC0000409: 'chương trình bị hủy (vượt giới hạn mảng hoặc abort)',
  0xC000013A: 'bị ngắt',
  3: 'abort() hoặc ngoại lệ không được bắt'
};

function describeExit(code, signal) {
  if (signal) return 'tín hiệu ' + signal;
  if (code === null || code === undefined) return 'không có mã thoát';
  const reason = windowsCodes[code >>> 0];
  return 'mã thoát ' + code + (reason ? ' · ' + reason : '');
}

// Chạy tệp đã biên dịch (hoặc trình thông dịch) với `input`.
async function execute(p, { cwd, input, timeoutMs, signal } = {}) {
  const result = await exec(p.run.command, p.run.args, { cwd, input, timeoutMs, signal, env: p.run.env });
  if (result.error) {
    return { ...result, missing: result.error.code === 'ENOENT', command: p.run.command, status: 'RTE' };
  }
  const status = result.timedOut ? 'TLE' : result.truncated ? 'RTE' : result.exitCode === 0 ? 'OK' : 'RTE';
  return { ...result, status, output: result.stdout.toString('utf8') };
}

function normalize(text) {
  const lines = String(text ?? '').split(/\r?\n/).map(line => line.replace(/\s+$/, ''));
  while (lines.length && lines.at(-1) === '') lines.pop();
  return lines;
}

// Bỏ qua khoảng trắng cuối dòng và dòng trống cuối. `line` là dòng khác đầu tiên (từ 1).
function compare(expected, actual) {
  const a = normalize(expected);
  const b = normalize(actual);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    if (a[index] !== b[index]) return { equal: false, line: index + 1, expected: a[index], actual: b[index] };
  }
  return { equal: true };
}

function verdict(result, expected) {
  if (result.status === 'TLE') return 'TLE';
  if (result.status !== 'OK') return 'RTE';
  return compare(expected, result.output).equal ? 'ĐÚNG' : 'SAI';
}

function seconds(ms) {
  return ms < 995 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(2) + ' s';
}

module.exports = { compare, compile, defaults, describeExit, exec, execute, hash, normalize, parseDiagnostics, plan, seconds, split, verdict };
