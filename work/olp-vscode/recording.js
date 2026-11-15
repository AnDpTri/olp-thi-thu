'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const sha = value => createHash('sha256').update(value).digest('hex');
const jsonl = file => { if(!fs.existsSync(file))return [];return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line,index)=>{try{return JSON.parse(line);}catch{throw new Error('Nhật ký hỏng: '+path.basename(file)+', dòng '+(index+1)+'. Tệp được giữ nguyên.');}}); };
function timestamp(now) {
  const d = new Date(now), offset = -d.getTimezoneOffset(), sign = offset < 0 ? '-' : '+';
  return new Date(now + offset * 60000).toISOString().slice(0, 23) + sign + String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0') + ':' + String(Math.abs(offset) % 60).padStart(2, '0');
}
function apply(text, changes, strict = true) {
  for (const c of [...changes].sort((a, b) => b.offset - a.offset)) {
    if (strict && text.slice(c.offset, c.offset + c.removed) !== c.removedText) throw new Error('Replay removedText mismatch at ' + c.offset);
    text = text.slice(0, c.offset) + c.text + text.slice(c.offset + c.removed);
  }
  return text;
}
class Recorder {
  constructor(root, session, now = Date.now(), clock = Date.now, { historical = false } = {}) {
    this.now = clock; this.root = root; this.session = session; this.dir = path.join(root, '.olp', session.id); this.shadow = new Map(); this.seq = 0;
    fs.mkdirSync(path.join(this.dir, 'blobs'), { recursive: true });
    this.recoveries = [];
    for (const name of ['events', 'edits', 'snapshots']) {
      const file = path.join(this.dir, name + '.jsonl');
      if (!fs.existsSync(file)) continue;
      const bytes = fs.readFileSync(file), last = bytes.lastIndexOf(10);
      // Preserve a torn tail as evidence before trimming it; records up to the last fsync survive.
      if (last !== bytes.length - 1) { fs.writeFileSync(file + '.torn-' + now, bytes.subarray(last + 1)); fs.truncateSync(file, last + 1); this.recoveries.push(name); }
    }
    this.events = jsonl(path.join(this.dir, 'events.jsonl')); this.edits = jsonl(path.join(this.dir, 'edits.jsonl')); this.snapshots = jsonl(path.join(this.dir, 'snapshots.jsonl'));
    this.resumed = this.events.length > 0;
    this.seq = Math.max(0, ...[...this.events, ...this.edits, ...this.snapshots].map(e => e.seq || 0));
    this.lastT = Math.max(0, ...this.events.map(e => e.t), ...this.edits.map(e => e.t));
    this.lastTouch = now; this.focused = true; this.idle = false; this.surface = { problem: null, phase: 'none' }; this.lastPeriodic = now;
    const files = [...new Set(this.snapshots.map(s => s.file))];
    for (const file of files) {
      const base = this.snapshots.find(s => s.file === file);
      let text = fs.readFileSync(path.join(this.dir, 'blobs', base.hash), 'utf8');
      for (const e of this.edits.filter(e => e.file === file && e.type === 'edit' && e.seq > base.seq)) text = apply(text, e.changes);
      this.shadow.set(file, text);
    }
    if(!historical){
      if (this.events.length) this.emit('activity', null, { category: 'outside', reason: 'recording_gap' }, session.start + this.lastT);
      this.emit(this.events.length ? 'session_resume' : 'session_start', null, { recoveredTails: this.recoveries }, now);
    }
  }
  relative(file) {
    const p = path.relative(this.root, file).replace(/\\/g, '/');
    try {const real=path.relative(fs.realpathSync(this.root),fs.realpathSync(file));if(real.startsWith('..'+path.sep)||path.isAbsolute(real))return undefined;} catch {}
    return !p.startsWith('../') && !path.isAbsolute(p) && !p.startsWith('.olp/') && /^[A-Z]\//.test(p) ? p : undefined;
  }
  recordable(file) { return this.session.kit.problems.some(p => file === p.key + '/' + p.source || file === p.key + '/input.txt' || file === p.key + '/output.txt'); }
  common(type, problem, data, now) {
    const t = Math.floor(Math.max(this.lastT, Math.max(0, now - this.session.start))); this.lastT = t;
    return { ...data, seq: ++this.seq, t, ts: timestamp(this.session.start + t), type, problem: problem ?? null };
  }
  append(name, record) {
    const fd = fs.openSync(path.join(this.dir, name + '.jsonl'), 'a');
    try { fs.writeSync(fd, JSON.stringify(record) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    this[name].push(record); return record;
  }
  emit(type, problem, data = {}, now = this.now()) { return this.append('events', this.common(type, problem, data, now)); }
  milestone(problem, name, now = this.now(), extra = {}) {
    if (!this.events.some(e => e.type === 'milestone' && e.problem === problem && e.name === name)) this.emit('milestone', problem, { name, ...extra }, now);
  }
  baseline(file, text, now = this.now(), reason = 'start') {
    if (!this.recordable(file)) return;
    if (!this.shadow.has(file)) { this.shadow.set(file, text); this.emit('file_created', file[0], { file }, now); this.snapshot(file, reason, now); }
    else {
      const previous = this.shadow.get(file);
      if (reason === 'resume') this.emit('resume_baseline', file[0], { file, previousHash: sha(Buffer.from(previous)), observedHash: sha(Buffer.from(text)), changed: previous !== text, reason: 'reopened_document' }, now);
      if (previous !== text) this.change(file, [{ rangeOffset: 0, rangeLength: previous.length, text }], undefined, 'external', now);
      if (reason === 'resume') this.snapshot(file, 'resume', now);
    }
  }
  change(file, contentChanges, version, reason, now = this.now(), generated = false) {
    if (!this.recordable(file)) return;
    contentChanges = contentChanges.filter(c => c.rangeLength !== 0 || c.text !== '');
    if (!contentChanges.length) return;
    const before = this.shadow.get(file);
    if (before === undefined) throw new Error('Missing baseline: ' + file);
    const changes = contentChanges.map(c => ({ offset: c.rangeOffset, removed: c.rangeLength, removedText: before.slice(c.rangeOffset, c.rangeOffset + c.rangeLength), text: c.text, pasteLike: c.text.length >= 32 }));
    const after = apply(before, changes); this.shadow.set(file, after);
    this.append('edits', this.common('edit', file[0], { file, version, reason, generated, undo: reason === 1, redo: reason === 2, changes }, now));
    if (reason === 'external') this.emit('external_change', file[0], { file, chars: after.length }, now);
    else { this.touch(now); if (changes.some(c => c.text.length) && file.endsWith(this.session.kit.problems.find(p => p.key === file[0])?.source)) this.milestone(file[0], 'first_keystroke', now); }
  }
  save(file, version, now = this.now()) { if (this.recordable(file)) {this.touch(now);this.append('edits', this.common('save', file[0], { file, version }, now));} }
  snapshot(file, reason, now = this.now(), observed) {
    const text = observed ?? this.shadow.get(file); if (text === undefined) return;
    const hash = sha(Buffer.from(text)); const dest = path.join(this.dir, 'blobs', hash);
    if (!fs.existsSync(dest)) { const fd = fs.openSync(dest, 'wx'); try { fs.writeSync(fd, Buffer.from(text)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
    const previous = this.snapshots.findLast(s => s.file === file);
    if (reason === 'periodic' && previous?.hash === hash) return;
    return this.append('snapshots', this.common('snapshot', file[0], { file, hash, reason }, now));
  }
  snapshotAll(reason, now = this.now()) {
    for (const file of this.shadow.keys()) {
      let observed;
      try { observed=this.readText?.(file); } catch(error) {this.emit('snapshot_missing',file[0],{file,error:error.message},now);}
      if(observed!==undefined&&observed!==this.shadow.get(file)) {
        this.snapshot(file,reason,now,observed);
        this.emit('recording_divergence',file[0],{file,expected:sha(Buffer.from(this.shadow.get(file))),observed:sha(Buffer.from(observed))},now);
        this.change(file,[{rangeOffset:0,rangeLength:this.shadow.get(file).length,text:observed}],undefined,'external',now);
      } else this.snapshot(file, reason, now);
    }
  }
  phase(now = this.now()) {
    const category = !this.focused ? 'outside' : this.idle ? 'idle' : this.surface.phase;
    const previous = this.events.findLast(e => e.type === 'activity');
    if (previous?.category !== category || previous?.problem !== this.surface.problem) this.emit('activity', this.surface.problem, { category }, now);
  }
  focus(problem, phase, now = this.now()) {
    if (this.surface.problem === problem && this.surface.phase === phase) return;
    this.touch(now); this.surface = { problem: problem ?? null, phase }; this.emit('focus', problem, { phase }, now); this.phase(now);
    if (phase === 'statement') this.milestone(problem, 'first_statement', now);
  }
  window(focused, now = this.now()) { if (this.focused === focused) return; this.focused = focused; this.emit(focused ? 'window_focus' : 'window_blur', this.surface.problem, {}, now); if (focused) this.touch(now); this.phase(now); }
  touch(now = this.now()) { this.lastTouch = now; if (this.idle) { this.idle = false; this.emit('idle_end', this.surface.problem, {}, now); this.phase(now); } }
  tick(seconds = 90, now = this.now()) {
    if (this.focused && !this.idle && now - this.lastTouch >= seconds * 1000) { const at = this.lastTouch + seconds * 1000; this.idle = true; this.emit('idle_start', this.surface.problem, {}, at); this.phase(at); }
    if (now - this.lastPeriodic >= 60000) { this.snapshotAll('periodic', now); this.lastPeriodic = now; }
  }
  asset(relative, data, cap = 200000) {
    if (relative.split('/').includes('..') || path.isAbsolute(relative)) throw new Error('Bad asset path');
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(String(data ?? ''));
    const truncated = raw.length > cap, bytes = truncated ? Buffer.concat([raw.subarray(0, Math.floor(cap / 2)), Buffer.from('\n[OLP: TRUNCATED]\n'), raw.subarray(-Math.floor(cap / 2))]) : raw;
    const dest = path.join(this.dir, 'assets', relative); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, bytes);
    return { path: relative, bytes: raw.length, storedBytes: bytes.length, truncated };
  }
}
function verify(recorder) {
  const divergences = [];
  for (const file of new Set(recorder.snapshots.map(s => s.file))) {
    const snaps = recorder.snapshots.filter(s => s.file === file), base = snaps[0];
    let text;
    try{text=fs.readFileSync(path.join(recorder.dir,'blobs',base.hash),'utf8');if(sha(Buffer.from(text))!==base.hash)divergences.push({file,t:base.t,error:'Initial snapshot hash mismatch'});}catch(error){divergences.push({file,t:base.t,error:error.message});continue;}
    const stream = [...recorder.edits.filter(e => e.file === file && e.seq > base.seq), ...snaps.slice(1)].sort((a, b) => a.seq - b.seq);
    for (const e of stream) try {
      if (e.type === 'edit') text = apply(text, e.changes);
      if (e.type === 'snapshot' && sha(Buffer.from(text)) !== e.hash) divergences.push({ file, t: e.t, expected: e.hash, actual: sha(Buffer.from(text)) });
    } catch (error) { divergences.push({ file, t: e.t, error: error.message }); }
  }
  const missing=recorder.events.filter(e=>e.type==='snapshot_missing').map(e=>({file:e.file,t:e.t,error:e.error}));
  return { ok: divergences.length === 0 && missing.length === 0, divergences, missing, recoveredTails: [...new Set(recorder.events.flatMap(e=>e.recoveredTails??[]))] };
}
function readingMs(events,problem,until){const activity=events.filter(e=>e.type==='activity');let total=0;for(let i=0;i<activity.length;i++){const e=activity[i];if(e.problem===problem&&e.category==='statement')total+=Math.max(0,Math.min(until,activity[i+1]?.t??until)-e.t);}return total;}
module.exports = { Recorder, apply, verify, sha, timestamp, jsonl, readingMs };
