'use strict';

const DURATION = 180 * 60 * 1000;

function clock(ms, round = Math.floor) {
  const seconds = round(Math.max(0, ms) / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(part => String(part).padStart(2, '0')).join(':');
}

function event(session, type, at, details = {}) {
  const previous = session.events.at(-1)?.at ?? session.start;
  session.events.push({ ...details, type, at: Math.max(session.start, previous, at) });
}

function start(kit, now, id, duration = DURATION) {
  const session = { id, kit, start: now, deadline: now + duration, duration, recordingVersion: 1, events: [] };
  event(session, 'start', now);
  return session;
}

function finish(session, now, expired) {
  if (!session || session.end !== undefined) return false;
  session.end = Math.min(session.deadline, Math.max(session.start, now));
  event(session, expired ? 'expired' : 'end', session.end);
  return true;
}

function focus(session, problem, now) {
  if (!session || session.end !== undefined || now >= session.deadline) return false;
  if (session.events.findLast(item => item.type === 'focus')?.problem === problem) return false;
  event(session, 'focus', now, { problem });
  return true;
}

const phases = { analysis: 'Đọc / phân tích đề', coding: 'Viết mã', testing: 'Thử input/output' };

function activity(session, problem, phase, now) {
  if (!session || session.end !== undefined || now >= session.deadline) return false;
  const last = session.events.findLast(item => item.type === 'focus' || item.type === 'phase');
  if (last?.type === 'phase' && last.problem === problem && last.phase === phase) return false;
  focus(session, problem, now);
  event(session, 'phase', now, { problem, phase });
  return true;
}

// Chạy thử / chạy mẫu / lỗi biên dịch chỉ ghi vào nhật ký, không đổi cách tính thời gian theo bài.
function record(session, type, problem, now, details = {}) {
  if (!session || session.end !== undefined || now >= session.deadline) return false;
  event(session, type, now, { problem, ...details });
  return true;
}

function stats(session, now) {
  const stop = Math.min(session.end ?? now, session.deadline);
  const totals = Object.fromEntries(session.kit.problems.map(problem => [
    problem.key, {
      elapsed: 0, analysis: 0, coding: 0, testing: 0, sent: 0, latest: '—', firstAC: null,
      runs: 0, samplesGood: 0, samplesBad: 0, compileErrors: 0
    }
  ]));
  const switches = session.events.filter(item => item.type === 'focus');
  switches.forEach((item, index) => {
    const next = switches[index + 1]?.at ?? stop;
    totals[item.problem].elapsed += Math.max(0, next - item.at);
  });
  const activityChanges = session.events.filter(item => item.type === 'focus' || item.type === 'phase');
  activityChanges.forEach((item, index) => {
    if (item.type !== 'phase') return;
    const next = activityChanges[index + 1]?.at ?? stop;
    totals[item.problem][item.phase] += Math.max(0, next - item.at);
  });
  for (const item of session.events) {
    const total = totals[item.problem];
    if (!total) continue;
    if (item.type === 'sent') total.sent++;
    if (item.type === 'run') total.runs++;
    if (item.type === 'compile') total.compileErrors++;
    if (item.type === 'samples') total[item.total > 0 && item.passed === item.total ? 'samplesGood' : 'samplesBad']++;
    if (item.type === 'verdict') {
      total.latest = item.text;
      if (/^AC(?:$|\s|\()/.test(item.text) && total.firstAC === null) total.firstAC = item.at - session.start;
    }
  }
  return totals;
}

// "AC" hoặc "WA 40/100" hoặc "40/100" -> { ac, points }.
function score(text) {
  const value = String(text ?? '').trim();
  if (/^AC(?:$|\s|\()/.test(value)) return { ac: true, points: null };
  const points = value.match(/(\d[\d.,]*)\s*\/\s*\d/)?.[1];
  const decimal = points?.includes(',') ? points.replace(/\./g, '').replace(',', '.') : points;
  return { ac: false, points: points === undefined ? null : Number(decimal) };
}

const rank = result => result.ac ? Infinity : result.points ?? -1;

// Mỗi bài nộp có mã (nộp tự động): { id, url, at, text, final }; theo bài.
function submissions(session) {
  const result = Object.fromEntries(session.kit.problems.map(problem => [problem.key, []]));
  for (const item of session.events) {
    if (!result[item.problem]) continue;
    if (item.type === 'sent' && item.submission) {
      result[item.problem].push({ id: item.submission, url: item.url, at: item.at, text: undefined, final: false });
    }
    if (item.type === 'verdict' && item.submission) {
      const target = result[item.problem].findLast(entry => entry.id === item.submission);
      if (target) Object.assign(target, { text: item.text, final: true, resultAt: item.at });
    }
  }
  return result;
}

// Mỗi bài: số lần nộp đã ghi, kết quả tốt nhất, số bài nộp tự động còn chờ kết quả.
function standing(session) {
  const all = submissions(session);
  return Object.fromEntries(session.kit.problems.map(problem => {
    let best;
    let sent = 0;
    for (const item of session.events) {
      if (item.problem !== problem.key) continue;
      if (item.type === 'sent') sent++;
      if (item.type === 'verdict') {
        const current = score(item.text);
        if (!best || rank(current) > rank(best)) best = { ...current, text: item.text };
      }
    }
    return [problem.key, { sent, best, pending: all[problem.key].filter(entry => !entry.final).length }];
  }));
}

const number = value => String(Math.round(value * 10) / 10);

function cell(entry) {
  if (entry.best?.ac) return '✓';
  if (entry.best) return entry.best.points === null ? '✗' : number(entry.best.points);
  return entry.sent ? '…' : '–';
}

// "A ✓  B 40  C –  D –"
function board(session) {
  const current = standing(session);
  return session.kit.problems.map(problem => problem.key + ' ' + cell(current[problem.key])).join('  ');
}

const labels = {
  start: 'Bắt đầu', focus: 'Chuyển bài', opened: 'Mở trang nộp',
  sent: 'Đã nộp (tự xác nhận)', verdict: 'Kết quả (tự ghi)',
  mark: 'Ghi mốc', end: 'Kết thúc', expired: 'Hết giờ'
};

const autoLabels = { sent: 'Đã nộp (tự động)', verdict: 'Kết quả (lấy từ VNOJ)' };

function describe(item) {
  if (item.type === 'phase') return phases[item.phase];
  if (item.type === 'run') return 'Chạy input.txt · ' + (item.status === 'OK' ? 'xong' : item.status) + (item.ms === undefined ? '' : ' · ' + Math.round(item.ms) + ' ms');
  if (item.type === 'samples') return 'Chạy test mẫu · ' + item.passed + '/' + item.total + ' đúng';
  if (item.type === 'compile') return 'Lỗi biên dịch' + (item.errors ? ' · ' + item.errors + ' lỗi' : '');
  const label = item.auto && autoLabels[item.type] || labels[item.type];
  return [label, item.submission && '#' + item.submission, item.text, item.url].filter(Boolean).join(' · ');
}

const pad = value => String(value).padStart(2, '0');

function offsetLabel(minutes) {
  const abs = Math.abs(minutes);
  return 'UTC' + (minutes < 0 ? '-' : '+') + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60);
}

function localTime(at, offset) {
  return new Date(at + offset * 60000).toISOString().slice(0, 19).replace('T', ' ');
}

// `offset` là số phút lệch so với UTC của máy (Asia/Saigon = 420).
function markdown(session, now, offset = -new Date(now).getTimezoneOffset(), summary) {
  const clean = value => String(value ?? '').replace(/[\r\n]/g, ' ').replace(/[\\|]/g, '\\$&');
  const totals = summary ? Object.fromEntries(Object.entries(summary.problems).map(([key,p])=>[key,{elapsed:p.totalMs,analysis:p.timeMs.statement,coding:p.timeMs.code,testing:p.timeMs.input+p.timeMs.output,none:p.timeMs.none,sent:p.submissionsCount,latest:p.finalVerdict??'—',firstAC:p.firstAC??null,runs:p.runs,samplesGood:p.sampleRuns.pass,samplesBad:p.sampleRuns.fail,compileErrors:p.compileErrors,other:p.timeMs['other-file'],outside:p.timeMs.outside,idle:p.timeMs.idle}])) : stats(session, now);
  const time=summary ? ms=>clock(ms)+'.'+String(Math.floor(Math.max(0,ms))%1000).padStart(3,'0') : clock;
  const observedTime=(category,ms)=>summary?.unavailableTimingCategories?.includes(category)?'—':time(ms);
  const wall = at => localTime(at, offset);
  const lines = [
    '# Thi thử OLP · ' + clean(session.kit.title),
    '', '- Bắt đầu ' + wall(session.start) + ' (' + offsetLabel(offset) + ', giờ địa phương)',
    '- Trạng thái ' + (session.end === undefined ? 'Đang thi' : 'Đã kết thúc'),
    '- Thời lượng ' + time(summary?.elapsedMs??Math.min(session.end ?? now, session.deadline) - session.start) + ' / ' + time(summary?.limitMs??session.deadline - session.start),
    '', summary ? (summary.legacy?'Phần cũ phân bổ theo journal focus/phase; I/O cũ gộp chung, ô — là không biết chứ không phải bằng 0. ':'Thời gian từ mô hình tiêu điểm/idle/ngoài cửa sổ. ')+'Cùng nguồn với summary.json. Tổng các loại đã phân bổ của bài bằng tổng bài; các bài + không gán bài bằng thời lượng phiên. Mốc AC tính từ đầu phiên. Đơn vị HH:MM:SS.mmm; giờ địa phương ('+offsetLabel(offset)+').' : 'Phiên cũ: thời gian ước lượng giữa các mốc, không có dữ liệu idle/ngoài cửa sổ. Giờ địa phương (' + offsetLabel(offset) + ').',
    '', '| Bài | Tổng thời gian | Lần nộp đã ghi | Kết quả gần nhất | Mốc AC đầu | Đọc / phân tích | Viết mã | Thử I/O | Chưa gán hoạt động | Lần chạy input | Chạy mẫu đúng hết | Chạy mẫu có sai | Lỗi biên dịch |',
    '| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'
  ];
  if(summary?.legacy)lines.splice(7,0,require('./observations').legacyLabel+'; '+(summary.legacyOnly?'phân bổ thời gian theo mốc focus/phase cũ, không đo idle hay ngoài VS Code.':'thời gian trước '+time(summary.legacyPrefixMs)+' là ước lượng theo mốc cũ, phần sau có log mới.'));
  if(summary){lines[lines.length-2]+=' Tệp khác | Ngoài VS Code | Không thao tác |';lines[lines.length-1]+=' ---: | ---: | ---: |';}
  for (const problem of session.kit.problems) {
    const total = totals[problem.key];
    lines.push('| ' + [problem.key + ' · ' + clean(problem.name), time(total.elapsed),
      total.sent, clean(total.latest), total.firstAC === null ? '—' : '+' + time(total.firstAC),
      time(total.analysis), time(total.coding), time(total.testing),
      time(summary?total.none:total.elapsed - total.analysis - total.coding - total.testing),
      total.runs, total.samplesGood, total.samplesBad, total.compileErrors,...(summary?[observedTime('other-file',total.other),observedTime('outside',total.outside),observedTime('idle',total.idle)]:[])].join(' | ') + ' |');
  }
  if(summary)lines.push('','- Chưa gán bài: '+time(summary.unassigned.totalMs)+'; toàn phiên: '+time(summary.overall.totalMs)+'.','',require('./observations').summaryMarkdown(summary));
  const sent = submissions(session);
  const rows = session.kit.problems.flatMap(problem => sent[problem.key].map(entry => '| ' + [
    problem.key, '+' + time(entry.at - session.start), wall(entry.at), '#' + entry.id,
    clean(entry.url ?? ''), clean(entry.text ?? 'chưa có kết quả')].join(' | ') + ' |'));
  if (rows.length) {
    lines.push('', '| Bài | Từ lúc bắt đầu | Giờ (' + offsetLabel(offset) + ') | Bài nộp | Liên kết | Kết quả |',
      '| --- | ---: | --- | --- | --- | --- |', ...rows);
  }
  lines.push('', '| Từ lúc bắt đầu | Giờ (' + offsetLabel(offset) + ') | Bài | Mốc |', '| ---: | --- | --- | --- |');
  for (const item of session.events) {
    lines.push('| ' + ['+' + time(item.at - session.start), wall(item.at),
      item.problem ?? '—', clean(describe(item))].join(' | ') + ' |');
  }
  return lines.join('\n') + '\n';
}

// Cảnh báo còn bao nhiêu phút: trả về mốc nhỏ nhất vừa chạm (và đánh dấu đã báo), hoặc undefined.
function dueWarning(remaining, minutes, given) {
  const crossed = minutes.filter(value => remaining <= value * 60000 && !given.has(value));
  crossed.forEach(value => given.add(value));
  return crossed.length ? Math.min(...crossed) : undefined;
}

// 'error' khi còn <= 5 phút, 'warning' khi còn <= 10 phút.
function urgency(remaining) {
  return remaining <= 5 * 60000 ? 'error' : remaining <= 10 * 60000 ? 'warning' : undefined;
}

module.exports = {
  activity, board, cell, clock, describe, dueWarning, DURATION, event, finish, focus, localTime, markdown, offsetLabel,
  record, score, standing, start, stats, submissions, urgency
};
