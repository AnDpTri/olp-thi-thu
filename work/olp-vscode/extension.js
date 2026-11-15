'use strict';

const { randomUUID } = require('node:crypto');
const { mkdir, readFile, readdir, stat, writeFile } = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const timer = require('./session');
const vnoj = require('./vnoj');
const submitter = require('./submit');
const runner = require('./runner');
const sourceGuard = require('./source-guard');
const template = require('./template');
const { shortName } = require('./pdf-reader');
const { makeStatementView } = require('./statement-view');
const { makeLayout } = require('./layout');
const imports = require('./imports');
const pdfMap = require('./pdf-map');
const { Recorder, readingMs } = require('./recording');
const archive = require('./archive');
const fsSync = require('node:fs');

const stateKey = 'olp.practice.v1';
const verdicts = ['AC', 'WA', 'TLE', 'MLE', 'RTE', 'CE', 'IE', 'Nhập điểm / kết quả…'];
const secretKey = 'olp.vnoj.sessionid';
const testFiles = { input: 'input.txt', output: 'output.txt' };
const languages = [
  { label: 'C++', extension: 'cpp' }, { label: 'Python', extension: 'py' },
  { label: 'C', extension: 'c' }, { label: 'Java', extension: 'java' }
];
const sampleName = /^mau-(\d+)\.in$/;
const lf = value => value.replace(/\r\n/g, '\n');

function activate(context) {
  const showStatement = makeStatementView(vscode);
  const layout = makeLayout(vscode);
  const { commands, env, languages: vsLanguages, window, workspace, Uri, ThemeIcon, TreeItemCollapsibleState } = vscode;
  const root = workspace.workspaceFolders?.length === 1 ? workspace.workspaceFolders[0].uri : undefined;
  const local = root?.scheme === 'file' && !env.remoteName;
  const status = window.createStatusBarItem(vscode.StatusBarAlignment.Left, 14);
  const runItem = window.createStatusBarItem(vscode.StatusBarAlignment.Left, 13);
  const submitItem = window.createStatusBarItem(vscode.StatusBarAlignment.Left, 12);
  const boardItem = window.createStatusBarItem(vscode.StatusBarAlignment.Left, 11);
  status.command = 'olp.menu';
  submitItem.command = 'olp.submit';
  submitItem.text = '$(cloud-upload) Nộp';
  submitItem.tooltip = 'Nộp lời giải lên VNOJ (Ctrl+Alt+S)';
  boardItem.command = 'olp.session.focus';
  const channel = window.createOutputChannel('OLP');
  const diagnostics = vsLanguages.createDiagnosticCollection('olp');
  const changed = new vscode.EventEmitter();
  const config = () => workspace.getConfiguration('olp');
  const migrate = stored => ({ ...stored, sessions: stored.sessions ?? [], runs: stored.runs ?? {} });
  let state = migrate(context.workspaceState.get(stateKey, { sessions: [] }));
  let queue = Promise.resolve();
  let importing = false;
  let vnojUser = context.globalState.get('olp.vnoj.user');
  const inflight = new Set();
  const pollers = new Set();
  const watching = new Set();
  const warned = new Map();
  let receiver;
  let clearReceiver;
  let previousRunning;
  let previousReady;
  let previousReport;
  let previousSolution;
  let previousCount;
  let previousKit;
  let recorder;
  let historyReport;
  const expectedGenerated = new Map();
  let lastSelection = 0;
  let runSerial = 0;
  let job;
  let arranging = false;
  let arrangement = 0;
  let opening = Promise.resolve();
  let lastProblem;
  let lastTab;
  const current = () => state.sessions.at(-1);
  const visibleSession = () => current()?.kit.id === state.kit?.id ? current() : undefined;
  const kitUri = (kit, ...parts) => Uri.joinPath(root, 'OLP-' + kit.id, ...parts);
  const reportUri = session => kitUri(session.kit, 'phien-' + session.id + '.md');
  const minutes = () => Math.max(1, Math.min(600, Math.round(Number(config().get('duration', 180))) || 180));

  function ensureRecorder(session = visibleSession()) {
    if (!local || !session) return undefined;
    if (recorder?.session.id === session.id) { recorder.session = session; return recorder; }
    recorder = new Recorder(kitUri(session.kit).fsPath, session, Date.now(), () => Date.now());
    recorder.readText=file=>{const uri=kitUri(session.kit,...file.split('/'));if(!recorder.relative(uri.fsPath))throw Error('Kit file unavailable');const doc=workspace.textDocuments.find(d=>d.uri.toString()===uri.toString());return doc?.getText()??fsSync.readFileSync(uri.fsPath,'utf8');};
    for (const p of session.kit.problems) for (const name of [p.source, 'input.txt', 'output.txt']) {
      const file = p.key + '/' + name, uri = kitUri(session.kit, p.key, name);
      if(!recorder.relative(uri.fsPath))continue;
      const open = workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
      const text = open?.getText() ?? (fsSync.existsSync(uri.fsPath) ? fsSync.readFileSync(uri.fsPath, 'utf8') : '');
      recorder.baseline(file, text, Date.now(), recorder.resumed ? 'resume' : 'start');
      if (name === p.source && p.templated) recorder.emit('template_applied', p.key, { file, historical: true });
    }
    recorder.window(window.state?.focused ?? true);
    return recorder;
  }
  function observeFocus() {
    if (!recorder || visibleSession()?.end !== undefined || arranging) return;
    const tab = window.tabGroups.activeTabGroup?.activeTab;
    if (tab?.input instanceof vscode.TabInputWebview && showStatement.active()) {
      recorder.focus(showStatement.problem() === 'common' ? null : showStatement.problem(), 'statement', Date.now()); return;
    }
    const uri = tab?.input instanceof vscode.TabInputText ? tab.input.uri : tab?.input instanceof vscode.TabInputTextDiff ? tab.input.original : undefined;
    const problem = uri && activeProblem({ uri });
    const file = uri && path.basename(uri.fsPath);
    recorder.focus(problem?.key ?? null, problem ? file === problem.source ? 'code' : file === 'input.txt' ? 'input' : file === 'output.txt' || /^mau-/.test(file) ? 'output' : 'other-file' : uri ? 'other-file' : 'none', Date.now());
  }
  showStatement.observe((type, problem, details) => {
    if(type==='assign'){const selected=state.kit?.problems.find(p=>p.key===problem);if(selected)void commands.executeCommand('olp.assignPages',{problem:selected});return;}
    if (!recorder || visibleSession()?.end !== undefined) return;
    if (type === 'state') { observeFocus(); trackFocus(true); }
    if (type === 'touch' || type === 'pages') recorder.touch(Date.now());
    if (type === 'pages') recorder.emit('statement_pages', problem === 'common' ? null : problem, details, Date.now());
  });
  function captureRun(problem, result, input, plan, kind = 'run', sample) {
    if (!recorder) return;
    const id = String(++runSerial) + '-' + recorder.seq;
    const base = problem.key + '/runs/' + id + '/';
    const refs = { stdin: recorder.asset(base+'stdin.txt', input), stdout: recorder.asset(base+'stdout.txt', result.stdout ?? result.output ?? ''), stderr: recorder.asset(base+'stderr.txt', result.stderr ?? '') };
    refs.compile = recorder.asset(base+'compile.txt',plan?.compileResult?.stderr ?? '');
    const meta = { command: plan?.run.command ? path.basename(plan.run.command) : undefined, args: plan?.run.args.map(a=>path.isAbsolute(a)?path.relative(recorder.root,a):a), verdict:result.verdict, exit: result.exitCode, ms: result.ms===undefined?undefined:Math.round(result.ms), status: result.status, sample, stdoutBytes:result.stdoutBytes??refs.stdout.bytes,stderrBytes:result.stderrBytes??refs.stderr.bytes,stdoutTruncated:result.truncated||refs.stdout.truncated,stderrTruncated:result.stderrTruncated||refs.stderr.truncated,refs };
    recorder.asset(base+'meta.json', JSON.stringify(meta,null,2));
    recorder.emit(kind, problem.key, { ...meta, artifacts: base }, Date.now());
  }
  async function exportCurrent(session = visibleSession() ?? current()) {
    if (!session) throw new Error('Chưa có phiên để xuất.');
    const rec = recorder?.session.id===session.id?ensureRecorder(session):new Recorder(kitUri(session.kit).fsPath,session,Date.now(),()=>Date.now(),{historical:true});
    rec.snapshotAll('export', Date.now());
    const date = new Date(session.start), stamp = template.dateText(date).replace(/-/g,'') + '-' + String(date.getHours()).padStart(2,'0') + String(date.getMinutes()).padStart(2,'0');
    const title = require('./names').slug(session.kit.title);
    let destination = path.join(root.fsPath, 'OLP-'+title+'-'+stamp+'.zip');
    if(fsSync.existsSync(destination)&&!rec.events.some(e=>e.type==='export'&&e.filename===path.basename(destination)))destination=path.join(root.fsPath,'OLP-'+title+'-'+stamp+'-'+session.id+'.zip');
    const exportedSession=structuredClone(session);
    await pdfMap.refreshText(rec.root,exportedSession.kit);
    const result = archive.exportSession(rec, exportedSession, destination, { now: Date.now() });
    await env.clipboard.writeText(destination);
    void window.showInformationMessage('OLP · Đã xuất gói phiên: '+path.basename(destination)+'. Đường dẫn đã sao chép.'+(result.manifest.integrity.ok?'':' Có sai lệch replay, xem manifest.'), 'Mở thư mục').then(button => button && commands.executeCommand('revealFileInOS', Uri.file(destination)));
    return destination;
  }
  function errorMessage(error) {
    if(error?.cause)channel.appendLine('OLP · '+error.message+' · cause='+String(error.cause?.cause?.code??error.cause?.code??error.cause?.name));
    void window.showErrorMessage('OLP · ' + (error instanceof Error ? error.message : String(error)));
  }

  function requireFolder() {
    if (!local) throw new Error('Hãy mở một thư mục trên máy bằng File → Open Folder.');
  }

  function setVnojUser(user, own) {
    vnojUser = user;
    void context.globalState.update('olp.vnoj.user', user);
    void context.globalState.update('olp.vnoj.own', user ? own : undefined);
    void commands.executeCommand('setContext', 'olp.vnoj', Boolean(user));
    changed.fire();
  }

  function updateDisplay(now = Date.now()) {
    const session = visibleSession();
    if(recorder&&session?.id===recorder.session.id)for(const p of session.kit.problems)showStatement.setReading(p.key,readingMs(recorder.events,p.key,Math.min(session.end??now,session.deadline)-session.start));
    const running = Boolean(session && session.end === undefined);
    const ready = Boolean(state.kit);
    const hasReport = Boolean(current());
    if (previousRunning !== running) void commands.executeCommand('setContext', 'olp.running', running);
    const count = state.kit?.problems.length ?? 0;
    if (previousKit !== state.kit?.id) {
      void commands.executeCommand('setContext', 'olp.sourceNames', state.kit?.problems.map(problem => problem.source) ?? []);
      void commands.executeCommand('setContext', 'olp.problemDirs', state.kit?.problems.map(problem => kitUri(state.kit, problem.key).fsPath) ?? []);
      previousKit = state.kit?.id;
    }
    if (previousReady !== ready) void commands.executeCommand('setContext', 'olp.ready', ready);
    if (previousCount !== count) void commands.executeCommand('setContext', 'olp.problemCount', count);
    previousCount = count;
    if (previousReport !== hasReport) void commands.executeCommand('setContext', 'olp.hasReport', hasReport);
    previousRunning = running;
    previousReady = ready;
    previousReport = hasReport;
    if (!local || !ready) {
      for (const item of [status, runItem, submitItem, boardItem]) item.hide();
      return;
    }
    const remaining = session ? session.deadline - (session.end ?? now) : minutes() * 60000;
    status.text = running ? '$(watch) OLP ' + timer.clock(remaining, Math.ceil)
      : session ? '$(watch) OLP · ' + (remaining <= 0 ? 'Hết giờ' : 'Đã kết thúc')
        : '$(watch) OLP · ' + minutes() + ' phút';
    const urgency = running && timer.urgency(remaining);
    status.backgroundColor = urgency ? new vscode.ThemeColor(urgency === 'error' ? 'statusBarItem.errorBackground' : 'statusBarItem.warningBackground') : undefined;
    status.tooltip = 'OLP · Bảng điều khiển phiên thi' + (urgency ? ' · Sắp hết giờ' : '');
    status.show();
    runItem.text = job ? '$(debug-stop) Dừng' : '$(play) Chạy';
    runItem.command = job ? 'olp.stop' : 'olp.run';
    runItem.tooltip = job ? 'Dừng chương trình đang chạy' : 'Chạy với input.txt (Ctrl+Alt+R) · test mẫu: Ctrl+Alt+T';
    runItem.show();
    if (running) submitItem.show();
    else submitItem.hide();
    if (session) {
      boardItem.text = '$(checklist) ' + timer.board(session);
      boardItem.tooltip = 'Bảng điểm: ✓ = AC, số = điểm cao nhất, … = chưa có kết quả, – = chưa nộp';
      boardItem.show();
    } else boardItem.hide();
  }

  function reportText(session) {
    const now=Date.now(),rec=recorder?.session.id===session.id?recorder:undefined;
    const dir=kitUri(session.kit,'.olp',session.id).fsPath;
    const read=name=>require('./recording').jsonl(path.join(dir,name+'.jsonl'));
    return archive.reportMarkdown(session,archive.metrics(rec?.events??read('events'),rec?.edits??read('edits'),session,now),now);
  }
  function viewedSession(selected){
    const id=selected?.session?.id??(window.activeTextEditor?.document.uri.toString()===historyReport?.uri?historyReport?.id:undefined);
    return state.sessions.find(s=>s.id===id)??visibleSession()??current();
  }
  async function writeReport(session) { await workspace.fs.writeFile(reportUri(session),Buffer.from(reportText(session))); }

  // Khi phiên vừa kết thúc: tệp báo cáo đã ghi, mở bên cạnh và sao chép vào clipboard để dán vào ChatGPT.
  async function deliverReport(session, expired) {
    await env.clipboard.writeText(Buffer.from(await workspace.fs.readFile(reportUri(session))).toString('utf8'));
    const note = config().get('export.auto',true) ? ' Báo cáo đã lưu, mở bên cạnh. Gói ZIP sẽ được xuất và đường dẫn được sao chép.' : ' Báo cáo đã lưu, mở bên cạnh và sao chép vào clipboard để dán vào ChatGPT.';
    const message = expired ? 'OLP · Hết ' + Math.round((session.deadline - session.start) / 60000) + ' phút.' + note
      : 'OLP · Đã kết thúc phiên.' + note;
    void (expired ? window.showWarningMessage(message) : window.showInformationMessage(message));
    await window.showTextDocument(await workspace.openTextDocument(reportUri(session)), {
      viewColumn: vscode.ViewColumn.Beside, preserveFocus: true, preview: false
    });
  }

  function mutate(change, now = Date.now()) {
    const operation = queue.then(async () => {
      const next = structuredClone(state);
      const session = next.sessions.at(-1);
      const expiry = session && session.end === undefined && now >= session.deadline &&
        timer.finish(session, session.deadline, true);
      let edited;
      let failure;
      try {
        edited = change?.(next, session);
      } catch (error) {
        failure = error;
      }
      if (expiry || edited) {
        const reports = next.sessions.filter((item, index) =>
          item.end !== undefined && item.events.length !== state.sessions[index]?.events.length);
        const ended = next.sessions.filter((item, index) => item.end !== undefined && state.sessions[index]?.end === undefined);
        await context.workspaceState.update(stateKey, next);
        const before = state;
        state = next;
        const recordedSession = next.sessions.at(-1);
        if (recordedSession && (recordedSession.end === undefined || recorder?.session.id === recordedSession.id)) {
          const rec = ensureRecorder(recordedSession);
          const old = before.sessions.find(s => s.id === recordedSession.id)?.events.length ?? 0;
          for (const event of recordedSession.events.slice(old)) {
            if (!['focus','phase','compile','run','samples'].includes(event.type)) rec.emit(event.type, event.problem, Object.fromEntries(Object.entries(event).filter(([k])=>!['at','type','problem'].includes(k))), event.at);
            if (event.type === 'sent') rec.milestone(event.problem, 'first_submission', event.at);
            if (event.type === 'verdict' && /^AC(?:$|\s)/.test(event.text)) rec.milestone(event.problem, 'first_AC', event.at);
          }
        }
        updateDisplay();
        changed.fire();
        for (const item of reports) {
          try {
            await writeReport(item);
            if (ended.includes(item)) {
              recorder?.snapshotAll('end', item.end);
              recorder?.emit(item.events.at(-1)?.type === 'expired' ? 'session_expiry' : 'session_end', null, {}, item.end);
              await deliverReport(item, item.events.at(-1)?.type === 'expired');
              if (config().get('export.auto', true)) await exportCurrent(item);
            }
          } catch {
            void window.showWarningMessage('OLP · Phiên đã lưu trong VS Code. Không ghi được tệp báo cáo, hãy dùng Sao chép báo cáo.');
          }
        }
      }
      if (failure) throw failure;
      return edited;
    });
    queue = operation.catch(() => {});
    return operation;
  }

  function activeProblem(document = window.activeTextEditor?.document) {
    if (!local || !state.kit || document?.uri.scheme !== 'file') return undefined;
    const relative = path.relative(kitUri(state.kit).fsPath, document.uri.fsPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
    return state.kit.problems.find(problem => relative === problem.key ||
      relative.startsWith(problem.key + path.sep));
  }

  function phaseOf(problem, uri) {
    const file = path.basename(uri.fsPath);
    return file === problem.source ? 'coding'
      : Object.values(testFiles).includes(file) || /^mau-\d+\.(in|out)$/.test(file) ? 'testing' : undefined;
  }

  function track(editor, force = false) {
    if (arranging && force !== true) return;
    const problem = editor && activeProblem(editor.document);
    const session = visibleSession();
    if (!problem || !session || session.end !== undefined) return;
    lastProblem = problem;
    void recordActivity(problem, phaseOf(problem, editor.document.uri), Date.now()).catch(errorMessage);
  }

  const tabKey = tab => {
    const input = tab?.input;
    return input instanceof vscode.TabInputText ? 'text:' + input.uri
      : input instanceof vscode.TabInputTextDiff ? 'diff:' + input.original
        : input instanceof vscode.TabInputWebview ? 'web:' + input.viewType : undefined;
  };

  // Theo tiêu điểm thật: tab đang hoạt động của nhóm đang hoạt động (kể cả khi bấm vào đề hay tệp input/output).
  function trackFocus(force = false) {
    observeFocus();
    if ((arranging && force !== true) || !state.kit || !local) return;
    const tab = window.tabGroups.activeTabGroup?.activeTab;
    const key = tabKey(tab);
    if (!key || key === lastTab) return;
    lastTab = key;
    const input = tab.input;
    if (input instanceof vscode.TabInputWebview) {
      const problem = state.kit.problems.find(item => item.key === showStatement.problem());
      if (problem && /olp\.statement$/.test(input.viewType) && visibleSession()) void recordActivity(problem, 'analysis').catch(errorMessage);
      return;
    }
    const document = { uri: input instanceof vscode.TabInputText ? input.uri : input.original };
    track({ document }, force);
  }

  function recordActivity(problem, phase, at = Date.now()) {
    const session = visibleSession();
    if (!session || session.end !== undefined) return Promise.resolve();
    return mutate((_, latest) => {
      if (latest?.id !== session.id) return false;
      return phase ? timer.activity(latest, problem.key, phase, at) : timer.focus(latest, problem.key, at);
    }, at);
  }

  // Ghi một sự kiện (chạy, mẫu, lỗi biên dịch) vào nhật ký và cập nhật kết quả gần nhất; không đổi cách tính thời gian.
  function note(problem, type, details, update) {
    const session = visibleSession();
    const at = Date.now();
    return mutate((next, latest) => {
      update?.(next);
      if (session && latest?.id === session.id) timer.record(latest, type, problem.key, at, details);
      return true;
    }, at);
  }

  async function ensureTestFiles(kit, problem, sample) {
    await mkdir(kitUri(kit, problem.key).fsPath, { recursive: true });
    for (const [kind, name] of Object.entries(testFiles)) {
      try {
        // output.txt là kết quả lần chạy gần nhất (từ 0.6.0), không còn là kết quả mong đợi.
        await writeFile(kitUri(kit, problem.key, name).fsPath, kind === 'input' ? sample?.input ?? '' : '', { flag: 'wx' });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
  }

  async function templateText(extension) {
    const file = Uri.joinPath(context.globalStorageUri, 'template.' + extension);
    return readFile(file.fsPath, 'utf8').catch(() => template.defaults[extension] ?? '');
  }

  // Tạo tệp lời giải từ template nếu chưa có hoặc đang trống; không bao giờ ghi đè tệp có nội dung.
  async function writeSolution(kit, problem) {
    const file = kitUri(kit, problem.key, problem.source).fsPath;
    const size = await stat(file).then(info => info.size, () => -1);
    if (size > 0) return {};
    const extension = path.extname(problem.source).slice(1).toLowerCase();
    const { text, cursor } = template.fill(await templateText(extension), {
      problem: problem.key, name: shortName(problem.name), contest: kit.title, date: new Date(Date.now())
    });
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
    return { cursor };
  }

  function tree(label, description, icon, command) {
    const item = new vscode.TreeItem(label);
    item.description = description;
    if (icon) item.iconPath = icon instanceof ThemeIcon ? icon : new ThemeIcon(icon);
    if (command) item.command = command;
    return item;
  }

  const good = new ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
  const bad = new ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
  const spent = ms => {
    const total = Math.floor(ms / 60000);
    return total < 1 ? '<1 phút' : total < 60 ? total + ' phút' : Math.floor(total / 60) + ' giờ ' + String(total % 60).padStart(2, '0') + ' phút';
  };
  const lastRunText = last => !last ? undefined : last.status === 'OK' ? '✓ ' + runner.seconds(last.ms) : last.status;

  function problemItem(kit, problem, session, extra) {
    const { totals, standing, subs, focused } = extra;
    const total = totals?.[problem.key];
    const mark = standing && timer.cell(standing[problem.key]);
    const item = tree(problem.key + ' · ' + shortName(problem.name),
      session ? [mark === '–' ? undefined : mark, spent(total?.totalMs ?? 0)].filter(Boolean).join(' · ') : undefined,
      focused === problem.key ? 'circle-filled' : 'file-code',
      { command: 'olp.source', title: 'Mở bài', arguments: [problem.key] });
    item.problem = problem;
    item.id = kit.id + ':' + problem.key;
    item.collapsibleState = focused === problem.key || (!focused && problem.key === kit.problems[0].key)
      ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed;
    const runs = state.runs[problem.key];
    const target = { problem };
    const samples = tree('Chạy test mẫu', runs?.samples ? runs.samples.passed + '/' + runs.samples.total + ' đúng'
      : problem.tests ? problem.tests + ' mẫu · chưa chạy' : 'chưa có mẫu', 'beaker',
    { command: 'olp.runSamples', title: 'Chạy test mẫu', arguments: [target] });
    samples.id = item.id + ':samples';
    if (runs?.samples?.items.length) {
      samples.collapsibleState = TreeItemCollapsibleState.Collapsed;
      samples.children = runs.samples.items.map(sample => {
        const row = tree('mau-' + sample.n, sample.v + ' · ' + runner.seconds(sample.ms), sample.v === 'ĐÚNG' ? good : bad,
          sample.v === 'SAI' ? { command: 'olp.diffSample', title: 'Xem khác biệt', arguments: [problem.key, sample.n] } : undefined);
        row.tooltip = sample.v === 'SAI' ? 'Bấm để xem khác biệt: mong đợi ↔ thực tế' : undefined;
        return row;
      });
    }
    item.children = [
      tree('Mở mã · ' + problem.source, undefined, 'file-code', { command: 'olp.source', title: 'Mở bài', arguments: [problem.key] }),
      tree('Chạy với input.txt', lastRunText(runs?.last), 'play', { command: 'olp.run', title: 'Chạy', arguments: [target] }),
      samples
    ];
    const list = subs?.[problem.key] ?? [];
    if (list.length) {
      const group = tree('Bài nộp', standing[problem.key].best?.text ?? 'chưa có kết quả', 'cloud-upload');
      group.id = item.id + ':subs';
      group.collapsibleState = TreeItemCollapsibleState.Expanded;
      group.children = list.toReversed().map(entry => {
        const row = tree('+' + timer.clock(entry.at - session.start) + ' · #' + entry.id, entry.final ? entry.text : 'đang chờ chấm…',
          entry.final ? (timer.score(entry.text).ac ? good : bad) : 'sync', entry.url ? { command: 'olp.openSubmission', title: 'Mở trên VNOJ', arguments: [entry.url] } : undefined);
        row.tooltip = 'Bài nộp #' + entry.id + (entry.url ? '\n' + entry.url : '');
        row.contextValue = entry.final ? 'olp.submission' : 'olp.pending';
        row.submission = { key: problem.key, id: entry.id, url: entry.url };
        return row;
      });
      item.children.push(group);
    }
    const milestones=recorder?.events.filter(e=>e.type==='milestone'&&e.problem===problem.key)??[];
    if(milestones.length){const row=tree('Mốc thời gian',milestones.length+' mốc','milestone');row.collapsibleState=TreeItemCollapsibleState.Collapsed;row.children=milestones.map(e=>tree(({first_statement:'\u0110\u1ecdc \u0111\u1ec1 l\u1ea7n \u0111\u1ea7u',first_keystroke:'G\u00f5 m\u00e3 l\u1ea7n \u0111\u1ea7u',first_compile:'Bi\u00ean d\u1ecbch l\u1ea7n \u0111\u1ea7u',first_clean_compile:'Bi\u00ean d\u1ecbch s\u1ea1ch',first_sample_pass:'\u0110\u00fang m\u1eabu l\u1ea7n \u0111\u1ea7u',first_submission:'N\u1ed9p l\u1ea7n \u0111\u1ea7u',first_AC:'AC \u0111\u1ea7u ti\u00ean'}[e.name]??e.name),'+'+timer.clock(e.t),'check'));item.children.push(row);}
    if(problem.sampleSource==='pdf-unverified'){samples.description=(samples.description??'')+' \u00b7 t\u1eeb PDF, c\u1ea7n ki\u1ec3m tra';}if(problem.sampleSource==='pdf-unverified')samples.tooltip='nguồn: tự trích từ PDF, cần kiểm tra; không chặn nộp';
    if(problem.pages?.confidence==='fallback')item.children.push(tree('Gán trang đề','PDF đầy đủ, cần chọn trang','edit',{command:'olp.assignPages',title:'Gán trang',arguments:[target]}));
    if(problem.commonPages)item.children.push(tree('Trang chung',undefined,'book',{command:'olp.commonPages',title:'Trang chung'}));
    item.children.push(
      tree('Mở đề', undefined, 'book', { command: 'olp.statement', title: 'Mở đề', arguments: [target] }),
      tree('Đọc / phân tích đề', undefined, 'book', { command: 'olp.analysis', title: 'Đọc / phân tích đề', arguments: [target] }),
      ...Object.entries(testFiles).map(([kind, name]) => tree(name,
        kind === 'output' ? 'Kết quả lần chạy gần nhất' : 'Dữ liệu vào để chạy', 'file', {
          command: 'olp.testFile', title: 'Mở ' + name, arguments: [problem.key, kind]
        })));
    for (const child of item.children) {
      child.parent = item;
      for (const grandchild of child.children ?? []) grandchild.parent = child;
    }
    item.contextValue = 'olp.problem';
    item.tooltip = problem.name + (problem.pdf ? '\nCó đề PDF cục bộ' : '')
      + (problem.tests ? '\nCó test mẫu trong thư mục bài' : '');
    return item;
  }

  const provider = {
      onDidChangeTreeData: changed.event,
      getTreeItem: item => item,
      getParent: item => item.parent,
      getChildren(parent) {
        if (parent) return parent.children;
        const kit = state.kit;
        if (!local || !kit) return [];
        const session = visibleSession();
        const running = session && session.end === undefined;
        const extra = {
          totals: session && archive.metrics(recorder?.session.id===session.id?recorder.events:[],recorder?.session.id===session.id?recorder.edits:[],session,Date.now()).problems, standing: session && timer.standing(session),
          subs: session && timer.submissions(session), focused: running && session.events.findLast(item => item.type === 'focus')?.problem
        };
        const items = kit.problems.map(problem => problemItem(kit, problem, session, extra));
        const action = running ? 'olp.end' : 'olp.start';
        const rows = [tree(kit.title, running ? 'Đang thi' : session ? 'Đã kết thúc' : 'Sẵn sàng', 'folder'),
          tree('VNOJ', vnojUser ?? 'Chưa đăng nhập', 'account',
            vnojUser ? undefined : { command: 'olp.login', title: 'Đăng nhập VNOJ' }),
          tree(running ? 'Kết thúc phiên' : 'Bắt đầu ' + minutes() + ' phút', undefined, running ? 'debug-stop' : 'play',
            { command: action, title: action }), ...items];
        if (session) {
          const journal = tree('Nhật ký', session.events.length + ' mốc', 'list-unordered');
          journal.id='journal:'+session.id;
          journal.collapsibleState = TreeItemCollapsibleState.Collapsed;
          journal.children = session.events.toReversed().map(item => {
            const row = tree('+' + timer.clock(item.at - session.start) + '  ' +
              (item.problem ? item.problem + ' · ' : '') + timer.describe(item));
            row.tooltip = new Date(item.at).toLocaleString('vi-VN') + '\n' + row.label;
            return row;
          });
          rows.push(journal, tree('Sao chép báo cáo', undefined, 'copy', { command: 'olp.copy', title: 'Sao chép báo cáo' }));
        }
        return rows;
      }
  };
  const treeView = window.createTreeView('olp.session', { showCollapseAll: false, treeDataProvider: provider });
  context.subscriptions.push(status, runItem, submitItem, boardItem, channel, diagnostics, treeView, changed,
    window.onDidChangeActiveTextEditor(editor => { track(editor); updateContext(); }),
    window.tabGroups.onDidChangeTabs(trackFocus), window.tabGroups.onDidChangeTabGroups(trackFocus),
    { dispose: () => { pollers.forEach(controller => controller.abort()); job?.controller.abort(); } });

  function updateContext() {
    const problem = activeProblem();
    const solution = Boolean(problem && window.activeTextEditor && path.basename(window.activeTextEditor.document.uri.fsPath) === problem.source);
    if (solution !== previousSolution) void commands.executeCommand('setContext', 'olp.solution', solution);
    previousSolution = solution;
  }

  async function chooseLanguage() {
    const setting = config().get('language', 'ask');
    const fixed = languages.find(item => item.extension === setting);
    if (fixed) return fixed;
    const saved = languages.find(item => item.extension === context.globalState.get('olp.language'));
    if (saved) return saved;
    const picked = await window.showQuickPick(languages, { placeHolder: 'Chọn loại tệp lời giải (sẽ nhớ cho lần sau)' });
    if (picked) await context.globalState.update('olp.language', picked.extension);
    return picked;
  }

  async function installKit(title, listed, download) {
    const language = await chooseLanguage();
    if (!language) return undefined;
    const kit = { id: randomUUID().slice(0, 8), title, problems: [] };
    let done = false;
    await window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'OLP · Chuẩn bị đề', cancellable: true
    }, async (progress, token) => {
      for (const [index, input] of listed.entries()) {
        if (token.isCancellationRequested) return;
        const key = String.fromCharCode(65 + index);
        progress.report({ message: 'Bài ' + key, increment: 100 / listed.length });
        const loaded = download ? await imports.statement(input, { sid: await context.secrets.get(secretKey) }) : {};
        const pdf = loaded.pdf;
        if (!input.tests?.length && loaded.tests?.length) input.tests = loaded.tests;
        if (token.isCancellationRequested) return;
        const source = (language.extension === 'java' ? 'Main' : key) + '.' + language.extension;
        const problem = { key, name: input.name, url: input.url, pdf: Boolean(pdf), source, tests: input.tests?.length ?? 0, templated: true };
        problem.sampleSources=Object.fromEntries((input.tests??[]).map((_,n)=>[n+1,download?(loaded.tests?.length?'vnoj-html':'unknown'):'companion']));
        problem.sampleHashes=Object.fromEntries((input.tests??[]).map((s,n)=>[n+1,{in:require('./recording').sha(s.input),out:require('./recording').sha(s.output)}]));
        const folder = kitUri(kit, key);
        await workspace.fs.createDirectory(folder);
        const { cursor } = await writeSolution(kit, problem);
        if (cursor) problem.cursor = cursor;
        await ensureTestFiles(kit, problem, input.tests?.[0]);
        if (pdf) await workspace.fs.writeFile(Uri.joinPath(folder, 'De-bai.pdf'), pdf);
        for (const [number, sample] of (input.tests ?? []).entries()) {
          await workspace.fs.writeFile(Uri.joinPath(folder, 'mau-' + (number + 1) + '.in'), Buffer.from(sample.input));
          await workspace.fs.writeFile(Uri.joinPath(folder, 'mau-' + (number + 1) + '.out'), Buffer.from(sample.output));
        }
        if (loaded.text) await workspace.fs.writeFile(Uri.joinPath(folder, 'statement.txt'), Buffer.from(loaded.text));
        kit.problems.push(problem);
      }
      if (token.isCancellationRequested) return;
      await pdfMap.prepare(kitUri(kit).fsPath, kit);
      for (const problem of kit.problems) {
        const file = kitUri(kit,problem.key,'statement.txt').fsPath;
        if (!problem.tests && problem.pdf && fsSync.existsSync(file)) {
          const samples = imports.pdfSamples(fsSync.readFileSync(file,'utf8'));
          if (samples.length) { problem.sampleSource = 'pdf-unverified'; problem.tests = samples.length; for (const [n,sample] of samples.entries()) { await writeFile(kitUri(kit,problem.key,'mau-'+(n+1)+'.in').fsPath,sample.input); await writeFile(kitUri(kit,problem.key,'mau-'+(n+1)+'.out').fsPath,sample.output); } }
        }
      }
      await mutate(next => {
        next.kit = kit;
        next.runs = {};
        return true;
      });
      layout.reset();
      showStatement.invalidate();
      done = true;
      const available = kit.problems.filter(problem => problem.pdf).length;
      void window.showInformationMessage('OLP · Đã chuẩn bị ' + kit.problems.length + ' bài.' +
        (download ? ' Có ' + available + ' PDF cục bộ. Bài thiếu PDF sẽ mở đề trên VNOJ.' : ''));
      await commands.executeCommand('olp.session.focus');
    });
    return done ? kit : undefined;
  }

  async function prepare(action) {
    requireFolder();
    if (importing || receiver) throw new Error('Đang chuẩn bị một bộ đề.');
    importing = true;
    try {
      await mutate();
      if (current() && current().end === undefined) throw new Error('Hãy kết thúc phiên trước khi chuẩn bị đề mới.');
      if (job) { job.controller.abort(); await job.done; }
      await action();
    } finally {
      importing = false;
    }
  }

  function closeReceiver() {
    clearReceiver?.();
    clearReceiver = undefined;
    for (const server of receiver ?? []) {
      server.close();
      server.closeAllConnections();
    }
    receiver = undefined;
  }

  function receiveProblems() {
    return new Promise((resolve, reject) => {
      void window.withProgress({
        location: vscode.ProgressLocation.Notification, title: 'OLP · Chờ Competitive Companion',
        cancellable: true
      }, async (progress, token) => {
        const problems = new Map();
        let batchId;
        let batchSize = 1;
        let complete;
        let grace;
        const done = new Promise(finish => { complete = finish; });
        const deadline = setTimeout(() => complete(undefined), 120000);
        const cancellation = token.onCancellationRequested(() => complete(undefined));
        clearReceiver = () => complete(undefined);
        const accept = problem => {
          if (!problems.size) {
            batchId = problem.batchId;
            batchSize = problem.batchSize;
          }
          if (problem.batchId !== batchId) return;
          problems.set(problem.url, problem);
          progress.report({ message: problems.size + '/' + batchSize + ' bài' });
          if (problems.size === batchSize) {
            clearTimeout(grace);
            // Give the last HTTP response time to reach the browser.
            grace = setTimeout(() => complete([...problems.values()]), 300);
          }
        };
        try {
          receiver = [await vnoj.listen('127.0.0.1', accept)];
          try {
            receiver.push(await vnoj.listen('::1', accept));
          } catch (error) {
            if (!['EADDRNOTAVAIL', 'EAFNOSUPPORT'].includes(error.code)) throw error;
          }
          if (token.isCancellationRequested) complete(undefined);
          resolve(await done);
        } catch (error) {
          reject(error.code === 'EADDRINUSE' ? new Error('Cổng 27177 đang bận. Hãy đóng cửa sổ VS Code đang nhận đề.') : error);
        } finally {
          clearTimeout(deadline);
          clearTimeout(grace);
          cancellation.dispose();
          closeReceiver();
        }
      }).then(undefined, reject);
    });
  }

  async function chooseProblem(selected) {
    const kit = state.kit;
    const wanted = selected?.problem;
    const problem = wanted
      ? kit?.problems.find(item => item.key === wanted.key && item.url === wanted.url)
      : (showStatement.active() ? kit?.problems.find(item=>item.key===showStatement.problem()) : undefined) ?? activeProblem() ?? kit?.problems.find(item => item.key === lastProblem?.key);
    if (problem) return problem;
    return (await window.showQuickPick((kit?.problems ?? []).map(item => ({
      label: item.key + ' · ' + item.name, problem: item
    })), { placeHolder: 'Chọn bài' }))?.problem;
  }

  function markForSession(session, type, details, at) {
    return mutate(next => {
      const target = next.sessions.find(item => item.id === session.id);
      if (!target) return false;
      timer.event(target, type, at, details);
      return true;
    }, at);
  }

  function register(id, handler) {
    context.subscriptions.push(commands.registerCommand('olp.' + id, async (...args) => {
      try {
        recorder?.touch(Date.now());
        await handler(...args);
      } catch (error) {
        errorMessage(error);
      }
    }));
  }

  const rememberLink = link => context.globalState.update('olp.recentLinks',
    [link, ...context.globalState.get('olp.recentLinks', []).filter(item => item !== link)].slice(0, 5));

  const askLink = () => window.showInputBox({
    title: 'Tải đề VNOJ', prompt: 'Dán link kỳ thi hoặc bài công khai. Tiện ích sẽ tải các PDF có sẵn.',
    placeHolder: 'https://oj.vnoi.info/contest/olp_kc25', ignoreFocusOut: true,
    validateInput: input => vnoj.inputUrl(input) ? undefined : 'Nhập link HTTPS bài hoặc kỳ thi trên oj.vnoi.info.'
  });

  async function importFrom(value) {
    const link = vnoj.inputUrl(value);
    const sid = await context.secrets.get(secretKey);
    const list = await window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'OLP · Đọc danh sách bài VNOJ' },
      () => imports.loadList(link, { sid }));
    const kit = await installKit(list.title, list.problems, true);
    if (kit) await rememberLink(link);
    return kit;
  }

  register('import', () => prepare(async () => {
    const value = await askLink();
    if (value) await importFrom(value);
  }));

  register('companion', () => prepare(async () => {
    const answer = await window.showInformationMessage(
      'Thêm cổng 27177 vào Custom ports của Competitive Companion. Sau đó bấm dấu + trên trang VNOJ.',
      { modal: true },
      'Chờ nhận đề'
    );
    if (!answer) return;
    const problems = await receiveProblems();
    if (problems) await installKit(problems.length === 1 ? problems[0].name : 'Bộ đề VNOJ', problems, true);
  }));

  register('local', () => prepare(() => installKit('Luyện ngoại tuyến',
    ['A', 'B', 'C', 'D'].map(key => ({ name: 'Bài ' + key })), false)));

  async function startSession() {
    requireFolder();
    if (importing) throw new Error('Đợi chuẩn bị đề xong rồi bắt đầu.');
    if (!state.kit) throw new Error('Hãy tải đề hoặc chuẩn bị phiên ngoại tuyến trước.');
    const now = Date.now();
    const duration = minutes() * 60000;
    await mutate((next, session) => {
      if (session && session.end === undefined) throw new Error('Phiên đã chạy.');
      next.sessions.push(timer.start(next.kit, now, randomUUID().slice(0, 8), duration));
      return true;
    }, now);
    lastTab = undefined;
    trackFocus();
  }

  register('start', startSession);

  register('end', async () => {
    const session = visibleSession();
    if (!session || session.end !== undefined) return;
    const answer = await window.showWarningMessage('Kết thúc phiên thi hiện tại?', { modal: true }, 'Kết thúc');
    if (!answer) return;
    const now = Date.now();
    await mutate((_, latest) => latest?.id === session.id && timer.finish(latest, now, false), now);
  });

  const isKit = uri => uri?.scheme === 'file' && path.relative(root.fsPath, uri.fsPath).split(path.sep)[0].startsWith('OLP-');
  const exists = file => stat(file).then(() => true, () => false);

  // Mở bài: lời giải bên trái, input và output (và đề nếu có PDF) bên phải; dùng lại các nhóm có sẵn.
  function openProblem(problem, options = {}) {
    const request = opening.then(() => arrangeProblem(problem, options));
    opening = request.catch(() => {});
    return request;
  }

  async function arrangeProblem(problem, options = {}) {
    requireFolder();
    showStatement.cancelReveal();
    const kit = state.kit;
    const solution = kitUri(kit, problem.key, problem.source);
    await mkdir(kitUri(kit, problem.key).fsPath, { recursive: true });
    if (!problem.templated) {
      const { cursor } = await writeSolution(kit, problem);
      await mutate(next => {
        const target = next.kit?.problems.find(item => item.key === problem.key);
        if (!target) return false;
        target.templated = true;
        if (cursor) target.cursor = cursor;
        return true;
      });
    }
    await ensureTestFiles(kit, problem);
    lastProblem = problem;
    if (options.force || config().get('layout.auto', true)) {
      arranging = true;
      const mine = ++arrangement;
      try { await layout.arrange({ isKit, solution, input: kitUri(kit,problem.key,'input.txt'), output: kitUri(kit,problem.key,'output.txt'), force: options.force }); }
      finally { setTimeout(() => { if (mine === arrangement) { arranging = false; observeFocus(); trackFocus(true); } }, 100); }
    } else {
      await layout.focusSolution(solution);
    }
    const target = state.kit?.problems.find(item => item.key === problem.key);
    const editor = window.activeTextEditor;
    if (target?.cursor && editor?.document.uri.toString() === solution.toString()) {
      const position = new vscode.Position(target.cursor.line, target.cursor.character);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      await mutate(next => {
        const item = next.kit?.problems.find(entry => entry.key === problem.key);
        if (!item?.cursor) return false;
        delete item.cursor;
        return true;
      });
    }
    lastTab = tabKey(window.tabGroups.activeTabGroup?.activeTab);
    await recordActivity(problem, 'coding');
  }

  register('source', async key => {
    const problem = state.kit?.problems.find(item => item.key === key);
    if (problem) await openProblem(problem);
  });

  register('switch', async target => {
    requireFolder();
    const problems = state.kit?.problems ?? [];
    let problem = typeof target === 'number' ? problems[target - 1] : problems.find(item => item.key === target);
    if (!problem && target === undefined) problem = await chooseProblem();
    if (problem) await openProblem(problem);
  });

  register('layout', async selected => {
    requireFolder();
    const problem = await chooseProblem(selected);
    if (problem) await openProblem(problem, { force: true });
  });

  register('testFile', async (key, kind) => {
    const kit = state.kit;
    const problem = kit?.problems.find(item => item.key === key);
    if (!problem || !Object.hasOwn(testFiles, kind)) return;
    await ensureTestFiles(kit, problem);
    await window.showTextDocument(kitUri(kit, problem.key, testFiles[kind]));
    lastTab = tabKey(window.tabGroups.activeTabGroup?.activeTab);
    await recordActivity(problem, 'testing');
  });

  register('analysis', async selected => {
    const problem = await chooseProblem(selected);
    if (problem) await recordActivity(problem, 'analysis');
  });

  register('statement', async selected => {
    if (showStatement.active()) { const key=showStatement.problem(); const p=state.kit?.problems.find(p=>p.key===key) ?? lastProblem; if(p)await openProblem(p); return; }
    requireFolder();
    const kit = state.kit;
    const problem = await chooseProblem(selected);
    if (!problem) return;
    const pdf = kitUri(kit, problem.key, 'De-bai.pdf');
    const hasPdf = await exists(pdf.fsPath);
    if (!hasPdf && !problem.url) throw new Error('Đặt tệp De-bai.pdf vào thư mục bài để mở đề ngoại tuyến.');
    if (hasPdf) {
      const column = 1;
      await window.withProgress({
        location: vscode.ProgressLocation.Window, title: 'OLP · Đang đọc đề'
      }, () => showStatement(pdf.fsPath, problem, kit.problems, () => {
        if (state.kit?.id === kit.id) return recordActivity(problem, 'analysis').catch(errorMessage);
      }, { column }));
      return;
    } else {
      const answer = await window.showInformationMessage('Bài này chưa có PDF cục bộ.', 'Mở trên VNOJ');
      if (!answer) return;
      if (!(await env.openExternal(Uri.parse(problem.url)))) throw new Error('Không mở được đề.');
    }
    await recordActivity(problem, 'analysis');
  });

  // ---------- Chạy / chạy mẫu ----------
  const log = (...lines) => channel.appendLine(lines.join('\n'));

  function settings() {
    const cfg = config();
    return {
      cpp: { compiler: cfg.get('cpp.compiler', 'g++'), flags: cfg.get('cpp.flags', '-std=c++20 -O2 -Wall') },
      c: { compiler: cfg.get('c.compiler', 'gcc'), flags: cfg.get('c.flags', '-std=c17 -O2 -Wall') },
      py: { command: cfg.get('python.command', 'python') }
    };
  }

  const missingHelp = (command, extension) => 'Không tìm thấy "' + command + '". ' + (extension === 'py'
    ? 'Cài Python hoặc đặt đường dẫn đầy đủ vào cài đặt olp.python.command.'
    : extension === 'java' ? 'Cài JDK và thêm javac, java vào PATH.'
      : 'Cài trình biên dịch (ví dụ MinGW-w64 / MSYS2) hoặc đặt đường dẫn đầy đủ vào cài đặt olp.' + extension + '.compiler.');

  function offerSettings(text, extension) {
    void window.showErrorMessage('OLP · ' + text, 'Mở cài đặt').then(button => button && commands.executeCommand(
      'workbench.action.openSettings', extension === 'py' ? 'olp.python.command' : 'olp.' + extension + '.compiler'));
  }

  async function exclusive(problem, work) {
    if (job) {
      job.controller.abort();
      await job.done;
    }
    const controller = new AbortController();
    let release;
    const mine = { controller, problem, done: new Promise(resolve => { release = resolve; }) };
    job = mine;
    updateDisplay();
    try {
      return await work(controller.signal);
    } finally {
      if (job === mine) job = undefined;
      release();
      updateDisplay();
      const kit = state.kit;
      if (kit?.problems.some(p => p.key === problem.key && p.source === problem.source)) {
        await layout.focusSolution(kitUri(kit, problem.key, problem.source));
        afterRun();
      }
    }
  }

  async function saveKitDocs(kit, problem) {
    const dir = kitUri(kit, problem.key).fsPath;
    for (const document of workspace.textDocuments) {
      if (!document.isDirty || document.uri.scheme !== 'file') continue;
      const relative = path.relative(dir, document.uri.fsPath);
      if (!relative.startsWith('..') && !path.isAbsolute(relative) && !(await document.save())) {
        throw new Error('Không lưu được ' + path.basename(document.uri.fsPath) + '. Hãy lưu tệp rồi chạy lại.');
      }
    }
  }

  async function sourceText(kit, problem) {
    const uri = kitUri(kit, problem.key, problem.source);
    return sourceGuard.capture(workspace, uri);
  }

  const columnOf = uri => window.tabGroups.all.find(group => group.tabs.some(tab =>
    tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString()))?.viewColumn;

  async function showCompileFailure(kit, problem, compiled, extension) {
    const dir = kitUri(kit, problem.key);
    if (compiled.aborted) return;
    if (compiled.missing) {
      log('✗ ' + missingHelp(compiled.command, extension));
      offerSettings(missingHelp(compiled.command, extension), extension);
      return;
    }
    const byFile = new Map();
    for (const item of compiled.diagnostics) {
      const uri = path.isAbsolute(item.file) ? Uri.file(item.file) : Uri.joinPath(dir, item.file);
      const range = new vscode.Range(item.line - 1, Math.max(0, item.column - 1), item.line - 1, 1000);
      const diagnostic = new vscode.Diagnostic(range, item.message, item.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
      diagnostic.source = 'OLP';
      const entry = byFile.get(uri.toString()) ?? { uri, list: [] };
      entry.list.push(diagnostic);
      byFile.set(uri.toString(), entry);
    }
    for (const { uri, list } of byFile.values()) diagnostics.set(uri, list);
    log('✗ Lỗi biên dịch ' + problem.source + ' (' + compiled.errors + ' lỗi):', compiled.stderr);
    const first = compiled.diagnostics.find(item => item.severity === 'error') ?? compiled.diagnostics[0];
    if (first) {
      const uri = path.isAbsolute(first.file) ? Uri.file(first.file) : Uri.joinPath(dir, first.file);
      const position = new vscode.Position(first.line - 1, Math.max(0, first.column - 1));
      try {
        await window.showTextDocument(uri, { selection: new vscode.Range(position, position), viewColumn: columnOf(uri), preview: false });
      } catch { /* tệp không mở được (ví dụ tệp hệ thống) */ }
    }
    const where = first ? first.file + ':' + first.line + ' · ' + first.message : compiled.stderr.split('\n')[0];
    void window.showErrorMessage('OLP · Bài ' + problem.key + ' lỗi biên dịch (' + compiled.errors + ' lỗi). ' + where.slice(0, 200), 'Xem lỗi')
      .then(button => button && commands.executeCommand('workbench.actions.view.problems'));
    await note(problem, 'compile', { errors: compiled.errors });
  }

  // Biên dịch (nếu cần). Trả về { plan, source } hoặc { failed: true } sau khi đã báo lỗi.
  async function build(kit, problem, signal, requestedSource) {
    const extension = path.extname(problem.source).slice(1).toLowerCase();
    const p = runner.plan(extension, problem.source, kitUri(kit, 'build', ...(extension === 'java' ? [problem.key] : [])).fsPath, settings());
    if (!p) throw new Error('Chưa hỗ trợ chạy tệp .' + extension + '.');
    const source = await sourceText(kit, problem);
    if (requestedSource !== undefined && source !== requestedSource) throw new Error('Mã đã thay đổi sau khi bấm chạy. Hãy chạy lại.');
    await sourceGuard.verify(workspace, kitUri(kit, problem.key, problem.source), source);
    if (!source.trim()) throw new Error('Tệp lời giải đang trống.');
    recorder?.milestone(problem.key,'first_compile',Date.now());
    const compiled = await window.withProgress({
      location: vscode.ProgressLocation.Window, title: 'OLP · Biên dịch ' + problem.source
    }, () => runner.compile(p, { cwd: kitUri(kit, problem.key).fsPath, source, signal }));
    p.compileResult = compiled;
    if (recorder) {
      recorder.milestone(problem.key,'first_compile',Date.now());
      if(compiled.ok)recorder.milestone(problem.key,'first_clean_compile',Date.now());
      const details={sourceHash:require('./recording').sha(Buffer.from(source)),ok:compiled.ok, cached:Boolean(compiled.cached), ms:Math.round(compiled.ms??0), diagnostics:compiled.diagnostics, command:p.compile ? path.basename(p.compile.command) : path.basename(p.run.command), args:p.compile?.args.map(a=>path.isAbsolute(a)?path.basename(a):a), output:recorder.asset(problem.key+'/runs/compile-'+recorder.seq+'/compile.txt',compiled.stderr??'')};
      recorder.emit('compile_result',problem.key,details,Date.now());
    }
    const solution = kitUri(kit, problem.key, problem.source);
    if (!compiled.cached) {
      diagnostics.delete(solution);
      if (compiled.ok) {
        log('✓ Biên dịch ' + problem.source + ' (' + runner.seconds(compiled.ms) + ')' + (compiled.stderr ? '\n' + compiled.stderr : ''));
        if (compiled.diagnostics.length) {
          diagnostics.set(solution, compiled.diagnostics.map(item => new vscode.Diagnostic(
            new vscode.Range(item.line - 1, Math.max(0, item.column - 1), item.line - 1, 1000), item.message, vscode.DiagnosticSeverity.Warning)));
        }
      }
    }
    if (!compiled.ok) {
      await showCompileFailure(kit, problem, compiled, extension);
      return { failed: true, aborted: compiled.aborted, compiled, plan: p };
    }
    await sourceGuard.verify(workspace, solution, source);
    return { plan: p, source, extension };
  }

  async function writeOutput(kit, problem, raw) {
    const text = lf(raw);
    const uri = kitUri(kit, problem.key, testFiles.output);
    const identity=uri.toString();expectedGenerated.set(identity,text);
    try { await require('./output-writer').writeOutput(workspace, uri, text); }
    finally { if(expectedGenerated.get(identity)===text)expectedGenerated.delete(identity); }
  }

  const afterRun = () => {
    lastTab = undefined;
    trackFocus(true);
  };

  async function target(selected) {
    requireFolder();
    const kit = state.kit;
    if (!kit) throw new Error('Hãy tải đề hoặc chuẩn bị phiên ngoại tuyến trước.');
    const problem = await chooseProblem(selected);
    return problem && { kit, problem };
  }

  register('run', async selected => {
    const chosen = await target(selected);
    if (!chosen) return;
    const { kit, problem } = chosen;
    const requestedSource = await sourceText(kit, problem);
    await ensureTestFiles(kit, problem);
    await exclusive(problem, async signal => {
      await saveKitDocs(kit, problem);
      recorder?.snapshotAll('run',Date.now());
      await recordActivity(problem, 'testing');
      const built = await build(kit, problem, signal, requestedSource);
      if (built.failed) {
        captureRun(problem,{status:built.aborted?'Dừng':'CE',stderr:built.compiled?.stderr,exitCode:null},await readFile(kitUri(kit,problem.key,'input.txt').fsPath),built.plan);
        await note(problem, 'run', { status: built.aborted ? 'Dừng' : 'CE' });
        return afterRun(problem);
      }
      const dir = kitUri(kit, problem.key).fsPath;
      const input = await readFile(path.join(dir, testFiles.input));
      const result = await runner.execute(built.plan, {
        cwd: dir, input, timeoutMs: Math.max(100, Number(config().get('run.timeoutMs', 5000)) || 5000), signal
      });
      captureRun(problem,result,input,built.plan);
      if (result.aborted) {
        void window.showInformationMessage('OLP · Đã dừng chương trình bài ' + problem.key + '.');
        return afterRun(problem);
      }
      if (result.missing) {
        offerSettings(missingHelp(result.command, built.extension), built.extension);
        return afterRun(problem);
      }
      await writeOutput(kit, problem, result.output ?? '');
      const time = runner.seconds(result.ms);
      const reason = result.timedOut ? 'quá ' + runner.seconds(Number(config().get('run.timeoutMs', 5000))) + ', đã dừng chương trình'
        : result.truncated ? 'in ra quá nhiều dữ liệu (>20 MB), đã dừng chương trình' : runner.describeExit(result.exitCode, result.signal);
      log('▶ Bài ' + problem.key + ' · ' + result.status + ' · ' + time + ' · ' + runner.describeExit(result.exitCode, result.signal) +
        (result.stderr ? '\n' + result.stderr : ''));
      await note(problem, 'run', { status: result.status, ms: Math.round(result.ms) }, next => {
        next.runs[problem.key] = { ...next.runs[problem.key], last: { at: Date.now(), status: result.status, ms: result.ms, code: result.exitCode } };
      });
      if (result.status === 'OK') {
        window.setStatusBarMessage('OLP · Bài ' + problem.key + ': chạy xong ' + time + ', ' + runner.describeExit(result.exitCode) + ' → output.txt', 12000);
        if (result.stderr.trim()) {
          log('(có nội dung stderr, xem Output → OLP)');
          void window.showWarningMessage('OLP · Bài ' + problem.key + ' chạy xong nhưng có stderr: ' + result.stderr.trim().slice(0, 160), 'Xem stderr')
            .then(button => button && channel.show(true));
        }
      } else {
        const tail = result.stderr.trim().split('\n').slice(-2).join(' ').slice(0, 160);
        void window.showWarningMessage('OLP · Bài ' + problem.key + ' ' + (result.status === 'TLE' ? 'TLE' : 'lỗi lúc chạy (RTE)') + ': ' + reason + ' · ' + time + (tail ? ' · ' + tail : ''), 'Xem chi tiết')
          .then(button => button && channel.show(true));
      }
      afterRun(problem);
    });
  });

  async function listSamples(kit, problem) {
    const dir = kitUri(kit, problem.key).fsPath;
    const names = await readdir(dir).catch(() => []);
    return names.map(name => name.match(sampleName)?.[1]).filter(Boolean).map(Number)
      .filter(number => names.includes('mau-' + number + '.out')).sort((a, b) => a - b);
  }

  async function sampleFingerprint(kit, problem, code) {
    const numbers = await listSamples(kit, problem);
    const data = [];
    for (const n of numbers) {
      data.push(n, await readFile(kitUri(kit, problem.key, 'mau-' + n + '.in').fsPath, 'utf8'),
        await readFile(kitUri(kit, problem.key, 'mau-' + n + '.out').fsPath, 'utf8'));
    }
    return runner.hash(JSON.stringify([code, settings(), config().get('run.timeoutMs', 5000), data]));
  }

  function noSamples(problem) {
    void window.showInformationMessage('OLP · Bài ' + problem.key + ' chưa có test mẫu. Đề tải từ PDF không kèm mẫu: gõ input vào input.txt, chạy, rồi lưu input/output đúng thành test mẫu để chạy lại nhanh.',
      'Lưu input/output thành test mẫu').then(button => button && commands.executeCommand('olp.addSample', { problem }));
  }

  // Chạy mọi mau-N.in; trả về { total, passed, items, hash } hoặc { failed } nếu không biên dịch được.
  async function runSamples(kit, problem, quiet) {
    const requestedSource = await sourceText(kit, problem);
    const numbers = await listSamples(kit, problem);
    if (!numbers.length) {
      if (!quiet) noSamples(problem);
      return { total: 0, passed: 0, items: [] };
    }
    return exclusive(problem, async signal => {
      await saveKitDocs(kit, problem);
      recorder?.snapshotAll('samples',Date.now());
      await recordActivity(problem, 'testing');
      const built = await build(kit, problem, signal, requestedSource);
      if (built.failed) {
        recorder?.emit('samples',problem.key,{passed:0,total:numbers.length,status:built.aborted?'Dừng':'CE',items:[]},Date.now());
        await note(problem, 'samples', { passed: 0, total: numbers.length, status: built.aborted ? 'Dừng' : 'CE' });
        afterRun(problem);
        return { total: numbers.length, passed: 0, items: [], failed: true, aborted: built.aborted };
      }
      const fingerprint = await sampleFingerprint(kit, problem, built.source);
      const dir = kitUri(kit, problem.key).fsPath;
      const buildDir = kitUri(kit, 'build').fsPath;
      await mkdir(buildDir, { recursive: true });
      const timeoutMs = Math.max(100, Number(config().get('run.timeoutMs', 5000)) || 5000);
      const items = [];
      for (const n of numbers) {
        if (signal.aborted) break;
        await sourceGuard.verify(workspace, kitUri(kit, problem.key, problem.source), built.source);
        const result = await runner.execute(built.plan, {
          cwd: dir, timeoutMs, signal, input: await readFile(path.join(dir, 'mau-' + n + '.in'))
        });
        if (result.aborted) break;
        if (result.missing) {
          offerSettings(missingHelp(result.command, built.extension), built.extension);
          return { total: numbers.length, passed: 0, items: [], failed: true };
        }
        const expected = await readFile(path.join(dir, 'mau-' + n + '.out'), 'utf8');
        const v = runner.verdict(result, expected);
        captureRun(problem,{...result,verdict:v},await readFile(path.join(dir,'mau-'+n+'.in')),built.plan,'sample_result',n);
        const item = { n, v, ms: Math.round(result.ms) };
        if (v === 'SAI') item.diff = runner.compare(expected, result.output);
        if (v !== 'ĐÚNG') await writeFile(path.join(buildDir, problem.key + '.mau-' + n + '.actual.txt'), lf(result.output ?? ''));
        if (result.stderr && v === 'RTE') log('mau-' + n + ' stderr:\n' + result.stderr);
        items.push(item);
      }
      if (signal.aborted && items.length < numbers.length) {
        void window.showInformationMessage('OLP · Đã dừng chạy test mẫu bài ' + problem.key + '.');
        return { total: numbers.length, passed: 0, items, aborted: true };
      }
      const passed = items.filter(item => item.v === 'ĐÚNG').length;
      await sourceGuard.verify(workspace, kitUri(kit, problem.key, problem.source), built.source);
      if (await sampleFingerprint(kit, problem, built.source) !== fingerprint) {
        void window.showWarningMessage('OLP · Test mẫu hoặc cài đặt đã thay đổi trong lúc chạy. Hãy chạy mẫu lại.');
        return { aborted: true, total: numbers.length, passed: 0, items };
      }
      const summary = { total: items.length, passed, items, hash: runner.hash(built.source) };
      log('Bài ' + problem.key + ' · test mẫu ' + passed + '/' + items.length + ': ' + items.map(item => 'mau-' + item.n + ' ' + item.v + ' ' + item.ms + ' ms').join(', '));
      recorder?.emit('samples',problem.key,{passed,total:items.length,items},Date.now());
      if(passed===items.length)recorder?.milestone(problem.key,'first_sample_pass',Date.now());
      await note(problem, 'samples', { passed, total: items.length }, next => {
        next.runs[problem.key] = {
          ...next.runs[problem.key],
          samples: { hash: summary.hash, fingerprint, at: Date.now(), total: items.length, passed, items: items.map(({ n, v, ms }) => ({ n, v, ms })) }
        };
      });
      if (!quiet) {
        const slowest = Math.max(...items.map(item => item.ms));
        const firstBad = items.find(item => item.v !== 'ĐÚNG');
        if (!firstBad) {
          void window.showInformationMessage('OLP · Bài ' + problem.key + ': ' + passed + '/' + items.length + ' test mẫu ĐÚNG (chậm nhất ' + runner.seconds(slowest) + ').');
        } else {
          const detail = firstBad.v === 'SAI' ? ' dòng ' + firstBad.diff.line + ': mong đợi "' + (firstBad.diff.expected ?? '(hết)') + '", nhận "' + (firstBad.diff.actual ?? '(hết)') + '"' : '';
          void window.showWarningMessage('OLP · Bài ' + problem.key + ': ' + passed + '/' + items.length + ' test mẫu đúng. mau-' + firstBad.n + ' ' + firstBad.v + detail.slice(0, 120),
            ...(firstBad.v === 'SAI' ? ['Xem khác biệt'] : [])).then(button => button && commands.executeCommand('olp.diffSample', problem.key, firstBad.n));
        }
      }
      afterRun(problem);
      return summary;
    });
  }

  register('runSamples', async selected => {
    const chosen = await target(selected);
    if (chosen) {
      try { await runSamples(chosen.kit, chosen.problem, false); }
      finally { await layout.focusSolution(kitUri(chosen.kit, chosen.problem.key, chosen.problem.source)); }
    }
  });

  register('stop', () => job?.controller.abort());

  register('diffSample', async (key, n) => {
    const kit = state.kit;
    const problem = kit?.problems.find(item => item.key === key);
    if (!problem) return;
    const expected = kitUri(kit, key, 'mau-' + n + '.out');
    const actual = kitUri(kit, 'build', key + '.mau-' + n + '.actual.txt');
    if (!(await exists(actual.fsPath))) throw new Error('Chưa có kết quả thực tế của mau-' + n + '. Hãy chạy test mẫu.');
    await commands.executeCommand('vscode.diff', expected, actual, 'Bài ' + key + ' · mau-' + n + ': mong đợi ↔ thực tế', { viewColumn: 1, preview: true });
    lastTab = tabKey(window.tabGroups.activeTabGroup?.activeTab);
    await recordActivity(problem, 'testing');
  });

  register('addSample', async selected => {
    const chosen = await target(selected);
    if (!chosen) return;
    const { kit, problem } = chosen;
    await ensureTestFiles(kit, problem);
    await saveKitDocs(kit, problem);
    const dir = kitUri(kit, problem.key).fsPath;
    const input = await readFile(path.join(dir, testFiles.input), 'utf8');
    const output = await readFile(path.join(dir, testFiles.output), 'utf8');
    if (!input.trim()) throw new Error('input.txt đang trống, chưa có gì để lưu thành test mẫu.');
    if (!output.trim()) throw new Error('output.txt đang trống. Hãy chạy chương trình (hoặc gõ kết quả đúng vào output.txt) rồi lưu.');
    const taken = (await readdir(dir)).map(name => name.match(/^mau-(\d+)\.(?:in|out)$/)?.[1]).filter(Boolean).map(Number);
    const number = Math.max(0, ...taken) + 1;
    await writeFile(path.join(dir, 'mau-' + number + '.in'), input);
    await writeFile(path.join(dir, 'mau-' + number + '.out'), output);
    await mutate(next => {
      const item = next.kit?.problems.find(entry => entry.key === problem.key);
      if (!item) return false;
      item.tests = (item.tests ?? 0) + 1;
      item.sampleSources??={};item.sampleSources[number]='user-added';
      item.sampleHashes??={};item.sampleHashes[number]={in:require('./recording').sha(input),out:require('./recording').sha(output)};
      for(const s of next.sessions.filter(s=>s.kit.id===kit.id)){const p=s.kit.problems.find(p=>p.key===problem.key);if(p){p.sampleSources={...item.sampleSources};p.sampleHashes={...item.sampleHashes};p.tests=item.tests;}}
      if (next.runs[problem.key]) delete next.runs[problem.key].samples;
      return true;
    });
    void window.showInformationMessage('OLP · Đã lưu mau-' + number + ' của bài ' + problem.key + ' từ input.txt và output.txt. Hãy chắc output.txt là kết quả ĐÚNG.');
  });

  register('template', async selected => {
    requireFolder();
    let extension = state.kit && activeProblem() ? path.extname(activeProblem().source).slice(1) : undefined;
    if (!extension && selected?.problem) extension = path.extname(selected.problem.source).slice(1);
    extension ??= (await chooseLanguage())?.extension;
    if (!extension) return;
    const file = Uri.joinPath(context.globalStorageUri, 'template.' + extension);
    await mkdir(context.globalStorageUri.fsPath, { recursive: true });
    if (!(await exists(file.fsPath))) await writeFile(file.fsPath, template.defaults[extension]);
    await window.showTextDocument(file);
    void window.showInformationMessage('OLP · Template .' + extension + ' dùng cho mọi bộ đề mới. Chỗ giữ: ${problem} ${name} ${contest} ${date}; con trỏ đặt ở ${cursor}. Bài đã có mã không bị ghi đè.');
  });

  register('solutionLanguage', async () => {
    await context.globalState.update('olp.language', undefined);
    const picked = await chooseLanguage();
    if (picked) void window.showInformationMessage('OLP · Bộ đề mới sẽ dùng tệp ' + picked.label + '.');
  });

  // ---------- Nộp bài ----------
  async function submitTarget(selected) {
    requireFolder();
    const session = visibleSession();
    if (!session || session.end !== undefined || Date.now() >= session.deadline) {
      throw new Error('Bắt đầu phiên thi để dùng nút nộp.');
    }
    const problem = await chooseProblem(selected);
    if (!problem) return undefined;
    if (!problem.url) throw new Error('Bài này chưa có link VNOJ.');
    if (!stillRunning(session)) return undefined;
    return { session, problem };
  }

  const stillRunning = session => Date.now() < session.deadline && current()?.id === session.id && current().end === undefined;

  async function readSource(session, problem) {
    const code = (await workspace.openTextDocument(kitUri(session.kit, problem.key, problem.source))).getText();
    if (!code.trim()) throw new Error('Tệp lời giải đang trống.');
    return code;
  }

  // Nhanh: dùng lại lần chạy mẫu gần nhất nếu mã không đổi; ngược lại chạy mẫu rồi hỏi một lần nếu còn sai.
  async function samplesAllow(session, problem, code) {
    if (!config().get('submit.checkSamples', true) || problem.sampleSource === 'pdf-unverified') return true;
    const kit = state.kit;
    if (!(await listSamples(kit, problem)).length) return true;
    const last = state.runs[problem.key]?.samples;
    let summary = last?.passed === last?.total && last?.total > 0 &&
      last.fingerprint === await sampleFingerprint(kit, problem, code) ? last : undefined;
    if (!summary) {
      summary = await window.withProgress({
        location: vscode.ProgressLocation.Notification, title: 'OLP · Chạy test mẫu trước khi nộp bài ' + problem.key
      }, () => runSamples(kit, problem, true));
    }
    if (summary.aborted) return false;
    if (summary.failed) {
      return Boolean(await window.showWarningMessage('OLP · Bài ' + problem.key + ' chưa biên dịch được, vẫn nộp?', 'Vẫn nộp'));
    }
    if (summary.passed === summary.total) return true;
    const bad = summary.items.filter(item => item.v !== 'ĐÚNG').map(item => 'mau-' + item.n + ' ' + item.v).join(', ');
    return Boolean(await window.showWarningMessage('OLP · Test mẫu đang sai, vẫn nộp? Bài ' + problem.key + ': ' + summary.passed + '/' + summary.total + ' đúng (' + bad + ').', 'Vẫn nộp'));
  }

  async function openInBrowser(session, problem, code, notice) {
    await env.clipboard.writeText(code);
    const at = Date.now();
    if (!stillRunning(session)) return;
    if (!(await env.openExternal(Uri.parse(problem.url + '/submit')))) throw new Error('Không mở được trang nộp VNOJ.');
    await markForSession(session, 'opened', { problem: problem.key }, at);
    void window.showInformationMessage('OLP · ' + (notice ? notice + ' ' : '') +
      'Đã sao chép mã lời giải. Dán và nộp trên VNOJ, rồi xác nhận ở đây.', 'Đã nộp').then(button => {
      if (button) void markForSession(session, 'sent', { problem: problem.key }, Date.now()).catch(errorMessage);
    });
  }

  async function chooseSubmitLanguage(form, problem) {
    const extension = path.extname(problem.source).slice(1).toLowerCase();
    const options = form.languages.filter(item => !item.fileOnly && item.ext === extension);
    if (!options.length) throw new Error('VNOJ không nhận tệp .' + extension + ' cho bài này.');
    const saved = context.globalState.get('olp.vnoj.languages', {});
    const known = options.find(item => item.id === saved[extension]);
    if (known) return known;
    const picked = options.length === 1 ? options[0] : (await window.showQuickPick(options.map(item => ({
      label: item.name, description: item.selected ? 'mặc định trên VNOJ' : undefined, option: item
    })), { placeHolder: 'Chọn ngôn ngữ nộp cho tệp .' + extension + ' (sẽ nhớ cho lần sau)' }))?.option;
    if (picked) await context.globalState.update('olp.vnoj.languages', { ...saved, [extension]: picked.id });
    return picked;
  }

  async function watch(session, problem, submission, sid) {
    if (watching.has(submission.id)) return;
    watching.add(submission.id);
    const controller = new AbortController();
    pollers.add(controller);
    const open = () => env.openExternal(Uri.parse(submission.url));
    try {
      const result = await submitter.poll(submission.id, sid, { signal: controller.signal, onUpdate: result => recorder?.emit('verdict_poll', problem.key, { id:submission.id,status:result.status,final:result.final },Date.now()) });
      if (!result || controller.signal.aborted) return;
      if (!result.final) {
        void window.showInformationMessage('OLP · Bài ' + problem.key + ' chưa chấm xong sau 3 phút (' + result.text +
          '). Xem #' + submission.id + ' trên VNOJ hoặc lấy lại kết quả.', 'Mở trên VNOJ', 'Lấy lại kết quả').then(button => {
          if (button === 'Mở trên VNOJ') void open();
          else if (button) void commands.executeCommand('olp.refetch', { submission: { key: problem.key, id: submission.id, url: submission.url } });
        });
        return;
      }
      await markForSession(session, 'verdict', {
        problem: problem.key, text: result.text, submission: submission.id, url: submission.url, auto: true
      }, Date.now());
      const endedSession=state.sessions.find(item=>item.id===session.id);
      if(endedSession?.end!==undefined&&current()?.id===session.id&&config().get('export.auto',true))await exportCurrent(endedSession);
      const show = result.status === 'AC' ? window.showInformationMessage : window.showWarningMessage;
      void show('OLP · Bài ' + problem.key + ': ' + result.text + ' (#' + submission.id + ')', 'Mở trên VNOJ')
        .then(button => button && open());
    } catch (error) {
      if (!controller.signal.aborted) {
        void window.showWarningMessage('OLP · Không lấy được kết quả bài ' + problem.key + ' (#' + submission.id + '): ' +
          (error instanceof Error ? error.message : String(error)));
      }
    } finally {
      pollers.delete(controller);
      watching.delete(submission.id);
    }
  }

  register('refetch', async item => {
    const session = visibleSession();
    const wanted = item?.submission;
    const problem = session && state.kit?.problems.find(entry => entry.key === wanted?.key);
    if (!problem || !/^\d+$/.test(String(wanted.id))) return;
    const sid = await context.secrets.get(secretKey);
    if (!sid) {
      if (await window.showWarningMessage('OLP · Chưa đăng nhập VNOJ.', 'Đăng nhập')) await commands.executeCommand('olp.login');
      return;
    }
    void window.showInformationMessage('OLP · Đang lấy lại kết quả bài nộp #' + wanted.id + '…');
    await watch(session, problem, { id: String(wanted.id), url: wanted.url ?? vnoj.origin + '/submission/' + wanted.id }, sid);
  });

  register('openSubmission', async url => {
    if (vnoj.vnojUrl(url, /^\/submission\/\d+\/?$/)) await env.openExternal(Uri.parse(url));
  });

  register('submit', async selected => {
    const target = await submitTarget(selected);
    if (!target) return;
    const { session, problem } = target;
    const key = session.id + ':' + problem.key;
    if (inflight.has(key)) return;
    inflight.add(key);
    try {
      const sid = await context.secrets.get(secretKey);
      if (!sid) {
        if (await window.showWarningMessage('OLP · Chưa đăng nhập VNOJ.', 'Đăng nhập')) await commands.executeCommand('olp.login');
        return;
      }
      const code = await readSource(session, problem);
      if (!stillRunning(session)) return;
      if (!(await samplesAllow(session, problem, code))) return;
      if (!stillRunning(session)) return;
      let form;
      try {
        form = await submitter.openForm(sid, submitter.submitPath(problem.url));
      } catch (error) {
        if (error?.code !== 'captcha') throw error;
        await openInBrowser(session, problem, code, 'VNOJ yêu cầu captcha nên không nộp trực tiếp được.');
        return;
      }
      const language = await chooseSubmitLanguage(form, problem);
      if (!language || !stillRunning(session)) return;
      if (await readSource(session, problem) !== code) {
        void window.showWarningMessage('OLP · Mã đã thay đổi trong lúc kiểm tra. Bấm Nộp lần nữa để kiểm tra và nộp mã mới.');
        return;
      }
      const at = Date.now();
      recorder?.snapshotAll('submission',at);
      if(recorder){const base=problem.key+'/submissions/pending-'+recorder.seq+'/';const sourceRef=recorder.asset(base+'source'+path.extname(problem.source),code,1000000);recorder.asset(base+'meta.json',JSON.stringify({language:language.name,attemptAt:at-session.start,source:sourceRef.path,pending:true},null,2));recorder.emit('submission_attempt',problem.key,{language:language.name,source:sourceRef.path},at);}
      const submission = await submitter.send(form, { languageId: language.id, source: code });
      if(recorder){const base=problem.key+'/submissions/'+submission.id+'/';recorder.asset(base+'source'+path.extname(problem.source),code,1000000);recorder.asset(base+'meta.json',JSON.stringify({id:submission.id,url:submission.url,language:language.name,source:base+'source'+path.extname(problem.source)},null,2));recorder.emit('submission_source',problem.key,{id:submission.id,url:submission.url,language:language.name,source:base+'source'+path.extname(problem.source)},at);}
      await markForSession(session, 'sent', {
        problem: problem.key, submission: submission.id, url: submission.url, language: language.name, auto: true
      }, at);
      void window.showInformationMessage('OLP · Đã nộp bài ' + problem.key + ' (#' + submission.id + ', ' + language.name +
        '). Đang chờ chấm…');
      void watch(session, problem, submission, sid);
    } catch (error) {
      if (error?.code !== 'auth') throw error;
      await context.secrets.delete(secretKey);
      setVnojUser(undefined);
      void window.showWarningMessage('OLP · ' + error.message + ' Dán cookie mới để đăng nhập lại.');
      await signInWithCookie();
    } finally {
      inflight.delete(key);
    }
  });

  register('submitBrowser', async selected => {
    const target = await submitTarget(selected);
    if (!target) return;
    const code = await readSource(target.session, target.problem);
    if (stillRunning(target.session)) await openInBrowser(target.session, target.problem, code);
  });

  register('language', async () => {
    await context.globalState.update('olp.vnoj.languages', undefined);
    void window.showInformationMessage('OLP · Lần nộp tới sẽ hỏi lại ngôn ngữ cho từng loại tệp.');
  });

  async function storeSession(sid, user, own) {
    await context.secrets.store(secretKey, sid);
    setVnojUser(user, own);
    void window.showInformationMessage('OLP · Đã đăng nhập VNOJ với tài khoản ' + user + '.');
  }

  async function signInWithCookie() {
    const value = await window.showInputBox({
      title: 'Đăng nhập VNOJ bằng cookie', password: true, ignoreFocusOut: true,
      prompt: 'Đăng nhập oj.vnoi.info trên trình duyệt, mở F12 → Application (Firefox: Storage) → Cookies → https://oj.vnoi.info, ' +
        'rồi dán giá trị cookie sessionid. Đăng xuất trên trình duyệt sẽ làm cookie này mất hiệu lực.',
      validateInput: input => submitter.sessionId(input) ? undefined : 'Giá trị sessionid không hợp lệ.'
    });
    if (!value) return;
    const sid = submitter.sessionId(value);
    const user = await window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'OLP · Kiểm tra phiên VNOJ' },
      () => submitter.verifySession(sid));
    await storeSession(sid, user, false);
  }

  async function signInWithPassword() {
    const username = await window.showInputBox({
      title: 'Đăng nhập VNOJ', prompt: 'Tên đăng nhập trên oj.vnoi.info', ignoreFocusOut: true,
      validateInput: input => input.trim() ? undefined : 'Nhập tên đăng nhập.'
    });
    if (!username) return;
    const password = await window.showInputBox({
      title: 'Đăng nhập VNOJ', prompt: 'Mật khẩu (không được lưu, chỉ giữ phiên đăng nhập)', password: true,
      ignoreFocusOut: true, validateInput: input => input ? undefined : 'Nhập mật khẩu.'
    });
    if (!password) return;
    try {
      const result = await window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'OLP · Đăng nhập VNOJ' },
        () => submitter.login(username.trim(), password));
      await storeSession(result.sid, result.user, true);
    } catch (error) {
      if (!['twofa', 'captcha', 'pwned'].includes(error?.code)) throw error;
      if (await window.showWarningMessage('OLP · ' + error.message, 'Dán sessionid')) await signInWithCookie();
    }
  }

  register('login', async () => {
    const method = await window.showQuickPick([
      { label: 'Dán cookie sessionid', detail: 'Cách đơn giản nhất nếu bạn đã đăng nhập VNOJ trên trình duyệt (kể cả bằng e-mail, 2FA, Google/Facebook).', run: signInWithCookie },
      { label: 'Tên đăng nhập và mật khẩu', detail: 'Tiện ích đăng nhập giúp bạn và chỉ giữ cookie phiên.', run: signInWithPassword }
    ], { placeHolder: 'Đăng nhập VNOJ' });
    await method?.run();
  });

  register('logout', async () => {
    const sid = await context.secrets.get(secretKey);
    const own = context.globalState.get('olp.vnoj.own');
    pollers.forEach(controller => controller.abort());
    await context.secrets.delete(secretKey);
    setVnojUser(undefined);
    // Cookie dán từ trình duyệt là phiên của trình duyệt, nên không đăng xuất phía máy chủ.
    if (sid && own) await submitter.logout(sid).catch(() => {});
    void window.showInformationMessage('OLP · Đã đăng xuất VNOJ khỏi VS Code.');
  });

  register('sent', async selected => {
    const session = visibleSession();
    if (!session) return;
    const problem = await chooseProblem(selected);
    if (problem) await markForSession(session, 'sent', { problem: problem.key }, Date.now());
  });

  register('verdict', async selected => {
    const session = visibleSession();
    if (!session) return;
    const problem = await chooseProblem(selected);
    if (!problem) return;
    let text = await window.showQuickPick(verdicts, { placeHolder: 'Kết quả bài ' + problem.key });
    if (text === verdicts.at(-1)) text = await window.showInputBox({
      prompt: 'Nhập kết quả hoặc điểm bạn thấy trên OJ', placeHolder: '40/100', validateInput: value =>
        value.trim().length > 100 ? 'Dùng tối đa 100 ký tự.' : undefined
    });
    if (text?.trim()) await markForSession(session, 'verdict', { problem: problem.key, text: text.trim() }, Date.now());
  });

  async function markProblem(problem, text, phase = recorder?.surface.phase ?? 'none') {
    const session = visibleSession();
    if (!session || session.end !== undefined) return false;
    const at = Date.now();
    return mutate((_, latest) => {
      if (latest?.id !== session.id || latest.end !== undefined) return false;
      timer.focus(latest, problem.key, at);
      timer.event(latest, 'mark', at, { problem: problem.key, text, phase });
      return true;
    }, at);
  }

  register('mark', async selected => {
    const session = visibleSession();
    if (!session || session.end !== undefined) return;
    const problem = await chooseProblem(selected);
    if (!problem) return;
    const phase=recorder?.surface.phase??'none';
    const text = await window.showInputBox({title:'OLP \u00b7 Ghi m\u1ed1c '+problem.key,prompt:'Nh\u00e3n t\u00f9y ch\u1ecdn',value:'M\u1ed1c th\u1eddi gian'});
    if (text) await markProblem(problem, text, phase);
  });

  // Bài đang làm: tệp đang mở, nếu không thì bài vừa mở / bài đang có tiêu điểm trong phiên.
  function workingProblem() {
    const session = visibleSession();
    const key = session?.events.findLast(item => item.type === 'focus')?.problem;
    return (showStatement.active()?state.kit?.problems.find(item=>item.key===showStatement.problem()):undefined) ?? activeProblem() ?? state.kit?.problems.find(item => item.key === lastProblem?.key) ?? state.kit?.problems.find(item => item.key === key);
  }

  register('stuck', async () => {
    const session = visibleSession();
    if (!session || session.end !== undefined) return;
    const problem = workingProblem();
    if (!problem) return;
    if (await markProblem(problem, 'Bị kẹt')) window.setStatusBarMessage('OLP · Đã ghi mốc "Bị kẹt" bài ' + problem.key, 6000);
  });

  register('note', async () => {
    const session = visibleSession();
    if (!session || session.end !== undefined) throw new Error('Bắt đầu phiên thi để ghi chú vào nhật ký.');
    const problem = workingProblem();
    if (!problem) return;
    const phase=recorder?.surface.phase??'none';
    const text = await window.showInputBox({
      title: 'Ghi chú bài ' + problem.key, prompt: 'Ghi vào nhật ký và báo cáo (ví dụ: nghĩ ra hướng quy hoạch động)', ignoreFocusOut: true,
      validateInput: value => value.trim().length > 200 ? 'Dùng tối đa 200 ký tự.' : undefined
    });
    if (text?.trim()) await markProblem(problem, text.trim(), phase);
  });

  register('copy', async () => {
    await mutate();
    const session = viewedSession();
    if (!session) return;
    await env.clipboard.writeText(reportText(session));
    void window.showInformationMessage('OLP · Đã sao chép báo cáo Markdown.');
  });

  register('history', async () => {
    await mutate();
    const selected = await window.showQuickPick(state.sessions.toReversed().map(session => ({
      label: session.kit.title,
      description: new Date(session.start).toLocaleString('vi-VN'),
      session
    })), { placeHolder: 'Chọn phiên xem báo cáo' });
    if (!selected) return;
    const document = await workspace.openTextDocument({ language: 'markdown', content: reportText(selected.session) });
    await window.showTextDocument(document);
    historyReport={uri:document.uri.toString(),id:selected.session.id};
  });

  register('menu', async () => {
    const running = visibleSession() && visibleSession().end === undefined;
    const items = [
      { label: 'Mở bảng phiên thi', command: 'olp.session.focus' },
      { label: running ? 'Kết thúc phiên' : 'Bắt đầu ' + minutes() + ' phút', command: running ? 'olp.end' : 'olp.start' },
      { label: 'Thi thử ngay (dán link kỳ thi)', command: 'olp.quick' },
      { label: 'Chạy với input.txt', description: 'Ctrl+Alt+R', command: 'olp.run' },
      { label: 'Chạy test mẫu', description: 'Ctrl+Alt+T', command: 'olp.runSamples' },
      { label: 'Lưu input/output hiện tại thành test mẫu', command: 'olp.addSample' },
      { label: 'Mở đề', description: 'Ctrl+Alt+D', command: 'olp.statement' },
      { label: 'Sắp lại bố cục bài', command: 'olp.layout' },
      { label: 'Ghi đang bị kẹt', description: 'Ctrl+Alt+K', command: 'olp.stuck' },
      { label: 'Ghi chú vào nhật ký', command: 'olp.note' },
      { label: 'Ghi mốc đọc / phân tích đề', command: 'olp.analysis' },
      { label: 'Nộp bài lên VNOJ', description: 'Ctrl+Alt+S', command: 'olp.submit' },
      { label: 'Mở trang nộp trên VNOJ', command: 'olp.submitBrowser' },
      { label: vnojUser ? 'Đăng xuất VNOJ' : 'Đăng nhập VNOJ', command: vnojUser ? 'olp.logout' : 'olp.login' },
      { label: 'Ghi kết quả chấm', command: 'olp.verdict' },
      { label: 'Sửa template lời giải', command: 'olp.template' },
      { label: 'Sao chép báo cáo', command: 'olp.copy' }
    ];
    const selected = await window.showQuickPick(items, { placeHolder: 'OLP Thi thử' });
    if (selected) await commands.executeCommand(selected.command);
  });

  // ---------- Thi thử ngay ----------
  async function pickLink() {
    const recent = context.globalState.get('olp.recentLinks', []);
    const copied = await env.clipboard.readText?.().then(text => typeof text === 'string' && text.length < 300 ? vnoj.inputUrl(text) : undefined, () => undefined);
    const items = [];
    if (copied) items.push({ label: '$(clippy) Link đang sao chép', description: copied, link: copied });
    for (const link of recent.filter(item => item !== copied)) {
      items.push({ label: '$(history) ' + link.replace(vnoj.origin + '/', ''), description: link, link });
    }
    if (!items.length) return askLink();
    items.push({ label: '$(add) Dán link khác…', other: true });
    const picked = await window.showQuickPick(items, { placeHolder: 'Chọn kỳ thi để thi thử ngay' });
    return picked?.other ? askLink() : picked?.link;
  }

  async function chooseDuration() {
    const picked = await window.showQuickPick([180, 150, 120, 90, 60, 45, 30].map(value => ({ label: value + ' phút', value }))
      .concat([{ label: 'Khác…', value: 0 }]), { placeHolder: 'Thời lượng phiên thi' });
    if (!picked) return false;
    let value = picked.value;
    if (!value) {
      const text = await window.showInputBox({ prompt: 'Số phút (1–600)', validateInput: input => /^\d{1,3}$/.test(input) && input >= 1 && input <= 600 ? undefined : 'Nhập số từ 1 đến 600.' });
      if (!text) return false;
      value = Number(text);
    }
    await config().update('duration', value, vscode.ConfigurationTarget.Global);
    return true;
  }

  register('quick', async () => {
    requireFolder();
    let kit;
    await prepare(async () => {
      const link = await pickLink();
      if (link) {
        if(!context.globalState.get('olp.language') && config().get('language','ask')==='ask')await context.globalState.update('olp.language','cpp');
        const sid=await context.secrets.get(secretKey);
        let valid=false;
        if(sid)try{setVnojUser(await submitter.verifySession(sid),context.globalState.get('olp.vnoj.own',false));valid=true;}catch{}
        if(!valid){setVnojUser(undefined);await signInWithCookie();if(!vnojUser)return;}
        kit = await importFrom(link);
      }
    });
    if (!kit) return;
    await openProblem(kit.problems[0], { force: true });
    for (;;) {
      const answer = await window.showInformationMessage('OLP · Bắt đầu ' + minutes() + ' phút ngay?', {modal:true,detail:'Bộ đề đã sẵn sàng: mã, input/output và đề riêng. Bấm Bắt đầu để tính giờ.'}, 'Bắt đầu', 'Đổi thời lượng');
      if (answer === 'Đổi thời lượng') {
        if (await chooseDuration()) continue;
        return;
      }
      if (answer) await startSession();
      return;
    }
  });

  register('export', selected => exportCurrent(viewedSession(selected)));
  register('assignPages', async selected => {
    const problem=await chooseProblem(selected);if(!problem)return;
    if(!(await exists(kitUri(state.kit,problem.key,'De-bai.pdf').fsPath))){void window.showInformationMessage('OLP · Bài này chưa có PDF cục bộ để gán trang.');return;}
    const pages=await pdfMap.extract(kitUri(state.kit,problem.key,'De-bai.pdf').fsPath);
    const value=await window.showInputBox({title:'Gán trang đề bài '+problem.key,prompt:'Trang đầu-trang cuối (từ 1), ví dụ 3-4',value:problem.pages?problem.pages.start+'-'+problem.pages.end:'1-'+pages.length,validateInput:value=>/^\d+-\d+$/.test(value)&&Number(value.split('-')[0])>=1&&Number(value.split('-')[1])<=pages.length&&Number(value.split('-')[0])<=Number(value.split('-')[1])?undefined:'Nhập khoảng trang hợp lệ.'});
    if(!value)return;const [start,end]=value.split('-').map(Number);
    await mutate(next=>{const p=next.kit.problems.find(p=>p.key===problem.key);p.pages={start,end,heading:p.pages?.heading??null,headingNumber:p.pages?.headingNumber??null,confidence:'manual',assignment:'manual'};delete p.pdfWarning;delete p.renderWarning;for(const session of next.sessions.filter(s=>s.kit.id===next.kit.id)){const target=session.kit.problems.find(p=>p.key===problem.key);if(target){target.pages=p.pages;delete target.pdfWarning;delete target.renderWarning;}}return true;});
    await writeFile(kitUri(state.kit,problem.key,'statement.txt').fsPath,pages.filter(p=>p.number>=start&&p.number<=end).map(p=>p.text).join('\n\n'));
    await writeFile(kitUri(state.kit,'pages.json').fsPath,JSON.stringify(Object.fromEntries(state.kit.problems.map(p=>[p.key,{pages:p.pages,common:p.commonPages,warning:p.pdfWarning}])),null,2));
    const updated=structuredClone(state.kit.problems.find(p=>p.key===problem.key));
    try {await pdfMap.renderOne(kitUri(state.kit,problem.key).fsPath,updated,state.kit.problems);await mutate(next=>{next.kit.problems.find(p=>p.key===problem.key).rendered=updated.rendered;for(const session of next.sessions.filter(s=>s.kit.id===next.kit.id)){const target=session.kit.problems.find(p=>p.key===problem.key);if(target)target.rendered=updated.rendered;}return true;});}catch(error){void window.showWarningMessage('OLP: '+error.message);}
    showStatement.invalidate();recorder?.emit('pages_assigned',problem.key,{start,end});
  });
  register('commonPages', async()=>{const p=state.kit?.problems.find(p=>p.commonPages);if(!p){void window.showInformationMessage('OLP · Chưa xác định được trang chung.');return;}await showStatement(kitUri(state.kit,p.key,'De-bai.pdf').fsPath,{key:'common',name:'Trang chung',pages:p.commonPages},state.kit.problems,()=>observeFocus());});
  if (local) {
    if(visibleSession()?.end===undefined&&visibleSession())ensureRecorder();
    const captureDocument=event=>{
      if(!recorder||visibleSession()?.end!==undefined||event.document.uri.scheme!=='file')return;
      const file=recorder.relative(event.document.uri.fsPath);if(!file||!recorder.recordable(file)||!event.contentChanges.length)return;
      const previous=recorder.shadow.get(file);if(previous===undefined)return;
      const identity=event.document.uri.toString(),automatic=expectedGenerated.get(identity)===event.document.getText();
      if(automatic)expectedGenerated.delete(identity);
      recorder.change(file,event.contentChanges,event.document.version,event.reason,Date.now(),automatic);
    };
    context.subscriptions.push(workspace.onDidChangeTextDocument(captureDocument),workspace.onDidSaveTextDocument(document=>{const file=recorder?.relative(document.uri.fsPath);if(file)recorder.save(file,document.version,Date.now());}),window.onDidChangeWindowState(event=>recorder?.window(event.focused,Date.now())),window.onDidChangeTextEditorSelection(event=>{if(!recorder)return;const file=recorder.relative(event.textEditor.document.uri.fsPath);if(!file||!recorder.recordable(file))return;recorder.touch(Date.now());if(Date.now()-lastSelection<500)return;lastSelection=Date.now();const p=event.selections[0].active;recorder.emit('selection',file[0],{file,line:p.line,col:p.character},Date.now());}),window.onDidChangeTextEditorVisibleRanges(event=>{if(activeProblem(event.textEditor.document))recorder?.touch(Date.now());}),{dispose:()=>showStatement.close()});
    const watcher=workspace.createFileSystemWatcher(new vscode.RelativePattern(root,'OLP-*/**/*'));
    const external=uri=>{if(!recorder||visibleSession()?.end!==undefined)return;const file=recorder.relative(uri.fsPath);if(!file)return;recorder.emit('kit_file_changed',file[0],{file},Date.now());if(!recorder.recordable(file))return;const doc=workspace.textDocuments.find(d=>d.uri.toString()===uri.toString());if(doc)return;try{recorder.baseline(file,fsSync.readFileSync(uri.fsPath,'utf8'),Date.now(),'external');}catch{recorder.emit('file_deleted',file[0],{file},Date.now());}};
    context.subscriptions.push(watcher,watcher.onDidChange(external),watcher.onDidCreate(external),watcher.onDidDelete(external));
  }
  // ---------- Đồng hồ ----------
  function timerWarnings(session, now) {
    const remaining = session.deadline - now;
    const marks = (config().get('timer.warnings', [60, 30, 10, 5]) ?? []).map(Number).filter(value => value > 0);
    const first = !warned.has(session.id);
    const given = warned.get(session.id) ?? new Set();
    warned.set(session.id, given);
    const due = timer.dueWarning(remaining, marks, given);
    // Lần đầu thấy phiên (mở lại VS Code giữa giờ): các mốc đã qua coi như đã báo, không báo dồn.
    if (first || due === undefined) return;
    recorder?.emit('timer_warning',null,{minutes:due},now);
    void window.showWarningMessage('OLP · Còn ' + due + ' phút · ' + timer.board(session));
  }

  let ticks = 0;
  updateDisplay();
  updateContext();
  void commands.executeCommand('setContext', 'olp.vnoj', Boolean(vnojUser));
  if (local) {
    void mutate().catch(errorMessage);
    const interval = setInterval(() => {
      const session = visibleSession();
      if (!session || session.end !== undefined) return;
      const now = Date.now();
      recorder?.tick(config().get('idleSeconds',90),now);
      observeFocus();
      updateDisplay(now);
      timerWarnings(session, now);
      if (++ticks % 5 === 0 && treeView.visible) changed.fire();
      if (now >= session.deadline) void mutate(undefined, now).catch(errorMessage);
    }, 1000);
    context.subscriptions.push({ dispose: () => clearInterval(interval) }, { dispose: closeReceiver });
  }

  // Dùng cho kiểm thử và chụp màn hình: nội dung cây và thanh trạng thái như người dùng thấy.
  const snapshot = (items = provider.getChildren()) => items.map(item => ({
    label: String(item.label), description: item.description, contextValue: item.contextValue,
    children: item.children ? snapshot(item.children) : undefined
  }));
  return {
    snapshot,
    expand: async key => {
      for (const item of provider.getChildren()) if (item.problem && (!key || item.problem.key === key)) await treeView.reveal(item, { expand: 3, select: false, focus: false });
    },
    status: () => ({
      clock: status.text, background: status.backgroundColor?.id, run: runItem.text, submit: submitItem.text,
      board: boardItem.text.replace(/^\$\(checklist\) /, '')
    })
  };
}

module.exports = { activate };
