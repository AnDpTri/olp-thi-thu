'use strict';

// Process-boundary checks: injected child events, no VS Code and no external processes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const source = fs.readFileSync(path.join(__dirname, 'olp-vscode', 'runner.js'), 'utf8');
let scenario;
let kills = 0;
let spawns = 0;
function spawn(command) {
  spawns++;
  if (command === 'taskkill') {
    kills++;
    if (scenario.killDenied) {
      const killer = new EventEmitter();
      setImmediate(() => killer.emit('exit', 1));
      return killer;
    }
    scenario.child.emit('close', 1, null);
    return new EventEmitter();
  }
  if (scenario.throw) throw Object.assign(new Error(scenario.throw), { code: scenario.throw });
  const child = Object.assign(new EventEmitter(), {
    pid: 123, exitCode: null, stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(),
    kill() { kills++; child.emit('close', null, 'SIGKILL'); }
  });
  scenario.child = child;
  setImmediate(() => scenario.act?.(child));
  return child;
}
const moduleMock = { exports: {} };
vm.runInNewContext(source, {
  module: moduleMock, require: name => name === 'node:child_process' ? { spawn } : require(name),
  process: { platform: 'win32', env: {}, hrtime: process.hrtime }, Buffer, setTimeout, clearTimeout
});
const runner = moduleMock.exports;
const tests = [];
const test = (name, action) => tests.push([name, action]);
const plan = runner.plan('cpp', 'A.cpp', path.join(__dirname, 'process-fixture', 'build'));

test('synchronous ENOENT and EPERM are returned, not thrown', async () => {
  scenario = { throw: 'ENOENT' };
  const missing = await runner.compile(plan, { cwd: __dirname, source: 'missing-compiler' });
  assert.equal(missing.missing, true);
  scenario = { throw: 'EPERM' };
  const denied = await runner.execute(plan);
  assert.equal(denied.error.code, 'EPERM');
  assert.equal(denied.missing, false);
  assert.equal(denied.status, 'RTE');
});
test('asynchronous ENOENT closes listeners and reports missing interpreter', async () => {
  scenario = { act: child => child.emit('error', Object.assign(new Error('missing'), { code: 'ENOENT' })) };
  assert.equal((await runner.execute(runner.plan('py', 'a.py', 'build'))).missing, true);
});
test('stdin, UTF-8 stdout, stderr, exit status', async () => {
  let input = '';
  scenario = { act: child => {
    input = child.stdin.read().toString();
    child.stdout.write(Buffer.from('chào\n'));
    child.stderr.write('warning');
    child.exitCode = 0;
    child.emit('close', 0, null);
  } };
  const result = await runner.execute(plan, { input: '42\n' });
  assert.equal(input, '42\n');
  assert.equal(result.output, 'chào\n');
  assert.equal(result.stderr, 'warning');
  assert.equal(result.status, 'OK');
  assert(result.ms >= 0);
});
test('RTE and Windows crash status', async () => {
  scenario = { act: child => child.emit('close', 3221225477, null) };
  const result = await runner.execute(plan);
  assert.equal(result.status, 'RTE');
  assert.match(runner.describeExit(result.exitCode), /segmentation/);
});
test('large stderr keeps head and tail, exact byte count and explicit truncation', async () => {
  const text='HEAD'+ 'x'.repeat(300000)+'TAIL';scenario={act:child=>{child.stderr.write(text);child.emit('close',0,null);}};
  const result=await runner.execute(plan);assert(result.stderr.startsWith('HEAD'));assert(result.stderr.endsWith('TAIL'));assert(result.stderrTruncated);assert.equal(result.stderrBytes,Buffer.byteLength(text));assert(result.stderr.length<201000);
});
test('timeout kills process tree exactly once', async () => {
  scenario = {};
  const before = kills;
  const result = await runner.execute(plan, { timeoutMs: 20 });
  assert.equal(result.status, 'TLE');
  assert(result.timedOut);
  assert.equal(kills - before, 1);
});
test('abort kills process tree and does not become a timeout', async () => {
  scenario = {};
  const controller = new AbortController();
  const running = runner.execute(plan, { timeoutMs: 1000, signal: controller.signal });
  controller.abort();
  const result = await running;
  assert(result.aborted);
  assert(!result.timedOut);
});
test('taskkill access denied falls back to terminating the owned child', async () => {
  scenario = { killDenied: true };
  const before = kills;
  const result = await runner.execute(plan, { timeoutMs: 20 });
  assert(result.timedOut);
  assert.equal(kills - before, 2, 'taskkill attempted, then direct child kill');
});
test('output overflow kills once even with more data arriving', async () => {
  const before = kills;
  scenario = { act: child => {
    child.stdout.write(Buffer.alloc(20_000_001));
    child.stdout.write(Buffer.alloc(20_000_001));
  } };
  const result = await runner.execute(plan);
  assert(result.truncated);
  assert.equal(result.status, 'RTE');
  assert.equal(kills - before, 1);
});
test('compile cache includes working directory; errors clear successful stamp', async () => {
  const compile = () => runner.compile(plan, { cwd: scenario.cwd, source: 'int main(){}' });
  const done = child => { child.exitCode = 0; child.emit('close', 0); };
  scenario = { cwd: 'A', act: done };
  fs.mkdirSync(path.dirname(plan.out), { recursive: true });
  fs.writeFileSync(plan.out, 'fake-binary');
  assert((await compile()).ok);
  const before = spawns;
  assert((await compile()).cached);
  assert.equal(spawns, before);
  fs.writeFileSync(plan.out,'externally replaced binary');
  assert(!(await compile()).cached,'Changed binary cannot reuse source stamp');
  assert.equal(spawns,before+1);
  assert((await compile()).cached,'Verified new source/binary pair can be cached');
  assert(!(await runner.compile(plan,{cwd:'A',source:'int main(){return 1;}'})).cached,'Changed source must compile');
  assert.equal(spawns,before+2);
  const changedFlags={...plan,compile:{...plan.compile,args:[...plan.compile.args,'-g']}};
  assert(!(await runner.compile(changedFlags,{cwd:'A',source:'int main(){return 1;}'})).cached,'Changed flags must compile');
  assert.equal(spawns,before+3);
  const changedCompiler={...plan,compile:{...plan.compile,command:'other-g++'}};
  assert(!(await runner.compile(changedCompiler,{cwd:'A',source:'int main(){return 1;}'})).cached,'Changed compiler must compile');
  assert.equal(spawns,before+4);
  scenario = { cwd: 'B', act: done };
  assert(!(await compile()).cached);
  scenario = { cwd: 'C', act: child => { child.stderr.write('A.cpp:4:2: error: syntax\n'); child.emit('close', 1); } };
  const failed = await compile();
  assert(!failed.ok);
  assert.equal(failed.errors, 1);
  assert(!fs.existsSync(plan.stamp));
});

(async () => {
  let failed = 0;
  for (const [name, action] of tests) {
    try { await action(); console.log('ok ' + name); }
    catch (error) { failed++; console.error('FAIL ' + name, error); }
  }
  console.log('process-boundary ' + (failed ? 'FAIL ' + failed : 'PASS ' + tests.length));
  process.exitCode = failed ? 1 : 0;
})();
