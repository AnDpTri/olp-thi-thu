from pathlib import Path
p=Path('work/olp-vscode/extension.js');s=p.read_text(encoding='utf-8')
def rep(a,b):
 global s
 if a not in s: raise Exception('Missing '+a[:100])
 s=s.replace(a,b)
rep("const { makeLayout } = require('./layout');", "const { makeLayout } = require('./layout');\nconst imports = require('./imports');\nconst pdfMap = require('./pdf-map');\nconst { Recorder } = require('./recording');\nconst archive = require('./archive');\nconst fsSync = require('node:fs');")
rep('  let job;', '  let recorder;\n  let generatedEdit = false;\n  let lastSelection = 0;\n  let runSerial = 0;\n  let job;')
pos=s.index('  function errorMessage(')
s=s[:pos]+'''  function ensureRecorder(session = visibleSession()) {
    if (!local || !session) return undefined;
    if (recorder?.session.id === session.id) { recorder.session = session; return recorder; }
    recorder = new Recorder(kitUri(session.kit).fsPath, session, Date.now());
    for (const p of session.kit.problems) for (const name of [p.source, 'input.txt', 'output.txt']) {
      const file = p.key + '/' + name, uri = kitUri(session.kit, p.key, name);
      const open = workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
      const text = open?.getText() ?? (fsSync.existsSync(uri.fsPath) ? fsSync.readFileSync(uri.fsPath, 'utf8') : '');
      recorder.baseline(file, text, Date.now(), 'start');
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
    if (!recorder || visibleSession()?.end !== undefined) return;
    if (type === 'state') { observeFocus(); trackFocus(true); }
    if (type === 'touch' || type === 'pages') recorder.touch(Date.now());
    if (type === 'pages') recorder.emit('statement_pages', problem === 'common' ? null : problem, details, Date.now());
  });
  function captureRun(problem, result, input, plan, kind = 'run', sample) {
    if (!recorder) return;
    const id = String(++runSerial) + '-' + recorder.seq;
    const base = problem.key + '/runs/' + id + '/';
    const refs = { stdin: recorder.asset(base+'stdin.txt', input), stdout: recorder.asset(base+'stdout.txt', result.output ?? ''), stderr: recorder.asset(base+'stderr.txt', result.stderr ?? '') };
    const meta = { command: plan?.run.command ? path.basename(plan.run.command) : undefined, args: plan?.run.args, exit: result.exitCode, ms: result.ms, status: result.status, sample, refs };
    recorder.asset(base+'meta.json', JSON.stringify(meta,null,2));
    recorder.emit(kind, problem.key, { ...meta, artifacts: base }, Date.now());
  }
  async function exportCurrent(session = visibleSession() ?? current()) {
    if (!session) throw new Error('Chưa có phiên để xuất.');
    const rec = ensureRecorder(session); rec.snapshotAll('export', Date.now());
    const date = new Date(session.start), stamp = template.dateText(date).replace(/-/g,'') + '-' + String(date.getHours()).padStart(2,'0') + String(date.getMinutes()).padStart(2,'0');
    const title = session.kit.title.normalize('NFKD').replace(/đ/g,'d').replace(/[^a-z0-9_-]+/gi,'-').slice(0,70);
    const destination = path.join(root.fsPath, 'OLP-'+title+'-'+stamp+'-'+session.id+'.zip');
    const result = archive.exportSession(rec, session, destination, { now: Date.now() });
    await env.clipboard.writeText(destination);
    void window.showInformationMessage('OLP · Đã xuất gói phiên: '+path.basename(destination)+'. Đường dẫn đã sao chép.'+(result.manifest.integrity.ok?'':' Có sai lệch replay, xem manifest.'), 'Mở thư mục').then(button => button && commands.executeCommand('revealFileInOS', Uri.file(destination)));
    return destination;
  }
''' + s[pos:]
rep("    await workspace.fs.writeFile(reportUri(session), Buffer.from(timer.markdown(session, Date.now())));", "    const extra = recorder?.session.id === session.id ? '\\n' + archive.summaryMarkdown(archive.metrics(recorder.events, recorder.edits, session, Date.now())) : '';\n    await workspace.fs.writeFile(reportUri(session), Buffer.from(timer.markdown(session, Date.now()) + extra));")
rep('        state = next;','''        const before = state;
        state = next;
        if (session && (session.end === undefined || recorder?.session.id === session.id)) {
          const rec = ensureRecorder(session);
          const old = before.sessions.find(s => s.id === session.id)?.events.length ?? 0;
          for (const event of session.events.slice(old)) {
            if (!['focus','phase','compile','run','samples'].includes(event.type)) rec.emit(event.type, event.problem, Object.fromEntries(Object.entries(event).filter(([k])=>!['at','type','problem'].includes(k))), event.at);
            if (event.type === 'sent') rec.milestone(event.problem, 'first_submission', event.at);
            if (event.type === 'verdict' && /^AC(?:$|\\s)/.test(event.text)) rec.milestone(event.problem, 'first_AC', event.at);
          }
        }''')
rep("            if (ended.includes(item)) await deliverReport(item, item.events.at(-1)?.type === 'expired');", "            if (ended.includes(item)) {\n              recorder?.snapshotAll('end', item.end);\n              recorder?.emit(item.events.at(-1)?.type === 'expired' ? 'session_expiry' : 'session_end', null, {}, item.end);\n              await deliverReport(item, item.events.at(-1)?.type === 'expired');\n              if (config().get('export.auto', true)) await exportCurrent(item);\n            }")
# auto export path changes clipboard as specified; deliverReport must copy report originally then export path final.
rep('    if ((arranging && force !== true) || !state.kit || !local) return;', '    observeFocus();\n    if ((arranging && force !== true) || !state.kit || !local) return;')
rep("    const showStatement = makeStatementView(vscode);", "    const showStatement = makeStatementView(vscode);") if False else None
rep("        const pdf = download && await vnoj.statement(input);", "        const loaded = download ? await imports.statement(input, { sid: await context.secrets.get(secretKey) }) : {};\n        const pdf = loaded.pdf;\n        if (!input.tests?.length && loaded.tests?.length) input.tests = loaded.tests;")
rep("        kit.problems.push(problem);", "        if (loaded.text) await workspace.fs.writeFile(Uri.joinPath(folder, 'statement.txt'), Buffer.from(loaded.text));\n        kit.problems.push(problem);")
rep("      await mutate(next => {\n        next.kit = kit;", "      await pdfMap.prepare(kitUri(kit).fsPath, kit);\n      for (const problem of kit.problems) {\n        const file = kitUri(kit,problem.key,'statement.txt').fsPath;\n        if (!problem.tests && problem.pdf && fsSync.existsSync(file)) {\n          const samples = imports.pdfSamples(fsSync.readFileSync(file,'utf8'));\n          if (samples.length) { problem.sampleSource = 'pdf-unverified'; problem.tests = samples.length; for (const [n,sample] of samples.entries()) { await writeFile(kitUri(kit,problem.key,'mau-'+(n+1)+'.in').fsPath,sample.input); await writeFile(kitUri(kit,problem.key,'mau-'+(n+1)+'.out').fsPath,sample.output); } }\n        }\n      }\n      await mutate(next => {\n        next.kit = kit;")
rep('      layout.reset();', '      layout.reset();\n      showStatement.invalidate();')
rep("      () => vnoj.loadList(link));", "      () => imports.loadList(link, { sid: undefined }));") if False else None
rep("      () => vnoj.loadList(link));", "      () => imports.loadList(link, { sid }));")
rep("    const link = vnoj.inputUrl(value);\n    const list", "    const link = vnoj.inputUrl(value);\n    const sid = await context.secrets.get(secretKey);\n    const list")
# always plain working layout, never automatically render PDF
start=s.index('      const pdf = kitUri(kit, problem.key, \'De-bai.pdf\');',s.index('  async function arrangeProblem'))
end=s.index('    } else {\n      await window.showTextDocument(solution);',start)
s=s[:start]+'''      arranging = true;
      const mine = ++arrangement;
      try { await layout.arrange({ isKit, solution, input: kitUri(kit,problem.key,'input.txt'), output: kitUri(kit,problem.key,'output.txt'), force: options.force }); }
      finally { setTimeout(() => { if (mine === arrangement) { arranging = false; observeFocus(); } }, 100); }
''' + s[end:]
rep("  register('statement', async selected => {", "  register('statement', async selected => {\n    if (showStatement.active()) { const key=showStatement.problem(); const p=state.kit?.problems.find(p=>p.key===key) ?? lastProblem; if(p)await openProblem(p); return; }")
# force statement column1
rep("      const column = config().get('layout.auto', true) && window.tabGroups.all.length >= 4 ? layout.columns.pdf.statement : undefined;", "      const column = 1;")
rep("      title: 'OLP · Biên dịch ' + problem.source", "      title: 'OLP · Biên dịch ' + problem.source") if False else None
rep("    const solution = kitUri(kit, problem.key, problem.source);\n    if (!compiled.cached)", "    if (recorder) {\n      recorder.milestone(problem.key,'first_compile',Date.now());\n      if(compiled.ok)recorder.milestone(problem.key,'first_clean_compile',Date.now());\n      const details={ok:compiled.ok, cached:Boolean(compiled.cached), ms:compiled.ms, diagnostics:compiled.diagnostics, command:p.compile ? path.basename(p.compile.command) : p.run.command, args:p.compile?.args.map(a=>path.isAbsolute(a)?path.basename(a):a), output:recorder.asset(problem.key+'/runs/compile-'+recorder.seq+'/compile.txt',compiled.stderr??'')};\n      recorder.emit('compile_result',problem.key,details,Date.now());\n    }\n    const solution = kitUri(kit, problem.key, problem.source);\n    if (!compiled.cached)")
rep("    const text = lf(raw);", "    const text = lf(raw);\n    generatedEdit = true;\n    try {")
rep("    await writeFile(uri.fsPath, text);\n  }", "    await writeFile(uri.fsPath, text);\n    } finally { generatedEdit = false; }\n  }")
rep("      await saveKitDocs(kit, problem);", "      await saveKitDocs(kit, problem);\n      recorder?.snapshotAll('run',Date.now());")
rep("      if (result.aborted) {\n        void window.showInformationMessage('OLP · Đã dừng chương trình", "      captureRun(problem,result,input,built.plan);\n      if (result.aborted) {\n        void window.showInformationMessage('OLP · Đã dừng chương trình")
rep("        const v = runner.verdict(result, expected);", "        const v = runner.verdict(result, expected);\n        captureRun(problem,{...result,verdict:v},await readFile(path.join(dir,'mau-'+n+'.in')),built.plan,'sample_result',n);")
rep("      await note(problem, 'samples', { passed, total: items.length }, next => {", "      recorder?.emit('samples',problem.key,{passed,total:items.length,items},Date.now());\n      if(passed===items.length)recorder?.milestone(problem.key,'first_sample_pass',Date.now());\n      await note(problem, 'samples', { passed, total: items.length }, next => {")
rep("    if (!config().get('submit.checkSamples', true)) return true;", "    if (!config().get('submit.checkSamples', true) || problem.sampleSource === 'pdf-unverified') return true;")
rep("      const submission = await submitter.send(form, { languageId: language.id, source: code });", "      recorder?.snapshotAll('submission',at);\n      const submission = await submitter.send(form, { languageId: language.id, source: code });\n      if(recorder){const base=problem.key+'/submissions/'+submission.id+'/';recorder.asset(base+'source'+path.extname(problem.source),code,1000000);recorder.asset(base+'meta.json',JSON.stringify({id:submission.id,url:submission.url,language:language.name,source:base+'source'+path.extname(problem.source)},null,2));recorder.emit('submission_source',problem.key,{id:submission.id,url:submission.url,language:language.name,source:base+'source'+path.extname(problem.source)},at);}")
rep("        problem: problem.key, submission: submission.id, url: submission.url, auto: true", "        problem: problem.key, submission: submission.id, url: submission.url, language: language.name, auto: true")
rep("{ signal: controller.signal });", "{ signal: controller.signal, onUpdate: result => recorder?.emit('verdict_poll', problem.key, { id:submission.id,status:result.status,final:result.final },Date.now()) });")
rep("      if (link) kit = await importFrom(link);", "      if (link) {\n        const sid=await context.secrets.get(secretKey);\n        let valid=false;\n        if(sid)try{setVnojUser(await submitter.verifySession(sid),false);valid=true;}catch{}\n        if(!valid){await signInWithCookie();if(!vnojUser)return;}\n        kit = await importFrom(link);\n      }")
rep("    const due = timer.dueWarning(remaining, marks, given);", "    const due = timer.dueWarning(remaining, marks, given);")
rep("    void window.showWarningMessage('OLP · Còn ' + due", "    recorder?.emit('timer_warning',null,{minutes:due},now);\n    void window.showWarningMessage('OLP · Còn ' + due")
rep("      const now = Date.now();\n      updateDisplay(now);", "      const now = Date.now();\n      recorder?.tick(config().get('idleSeconds',90),now);\n      observeFocus();\n      updateDisplay(now);")
# command interactions + export command and manual page assignment
rep("      try {\n        await handler(...args);", "      try {\n        recorder?.touch(Date.now());\n        await handler(...args);")
pos=s.index('  // ---------- Đồng hồ ----------')
s=s[:pos]+'''  register('export', () => exportCurrent());
  register('assignPages', async selected => {
    const problem=await chooseProblem(selected);if(!problem)return;
    const pages=await pdfMap.extract(kitUri(state.kit,problem.key,'De-bai.pdf').fsPath);
    const value=await window.showInputBox({title:'Gán trang đề bài '+problem.key,prompt:'Trang đầu-trang cuối (từ 1), ví dụ 3-4',value:problem.pages?problem.pages.start+'-'+problem.pages.end:'1-'+pages.length,validateInput:value=>/^\\d+-\\d+$/.test(value)&&Number(value.split('-')[0])>=1&&Number(value.split('-')[1])<=pages.length&&Number(value.split('-')[0])<=Number(value.split('-')[1])?undefined:'Nhập khoảng trang hợp lệ.'});
    if(!value)return;const [start,end]=value.split('-').map(Number);
    await mutate(next=>{const p=next.kit.problems.find(p=>p.key===problem.key);p.pages={start,end,confidence:'manual'};return true;});
    await writeFile(kitUri(state.kit,problem.key,'statement.txt').fsPath,pages.filter(p=>p.number>=start&&p.number<=end).map(p=>p.text).join('\\n\\n'));
    await writeFile(kitUri(state.kit,'pages.json').fsPath,JSON.stringify(Object.fromEntries(state.kit.problems.map(p=>[p.key,p.pages])),null,2));
    showStatement.invalidate();recorder?.emit('pages_assigned',problem.key,{start,end});
  });
  register('commonPages', async()=>{const p=state.kit?.problems.find(p=>p.commonPages);if(!p){void window.showInformationMessage('OLP · Chưa xác định được trang chung.');return;}await showStatement(kitUri(state.kit,p.key,'De-bai.pdf').fsPath,{key:'common',name:'Trang chung',pages:p.commonPages},state.kit.problems,()=>observeFocus());});
  if (local) {
    if(visibleSession()?.end===undefined&&visibleSession())ensureRecorder();
    const captureDocument=event=>{
      if(!recorder||visibleSession()?.end!==undefined||event.document.uri.scheme!=='file')return;
      const file=recorder.relative(event.document.uri.fsPath);if(!file||!recorder.recordable(file)||!event.contentChanges.length)return;
      const previous=recorder.shadow.get(file);if(previous===undefined)return;
      recorder.change(file,event.contentChanges,event.document.version,event.reason,Date.now());
      if(generatedEdit){recorder.edits.at(-1).generated=true; /* persisted via explicit flag below in Recorder */}
    };
    context.subscriptions.push(workspace.onDidChangeTextDocument(captureDocument),workspace.onDidSaveTextDocument(document=>{const file=recorder?.relative(document.uri.fsPath);if(file)recorder.save(file,document.version,Date.now());}),window.onDidChangeWindowState(event=>recorder?.window(event.focused,Date.now())),window.onDidChangeTextEditorSelection(event=>{if(!recorder)return;const file=recorder.relative(event.textEditor.document.uri.fsPath);if(!file||!recorder.recordable(file))return;recorder.touch(Date.now());if(Date.now()-lastSelection<500)return;lastSelection=Date.now();const p=event.selections[0].active;recorder.emit('selection',file[0],{file,line:p.line,col:p.character},Date.now());}),window.onDidChangeTextEditorVisibleRanges(event=>{if(activeProblem(event.textEditor.document))recorder?.touch(Date.now());}),{dispose:()=>showStatement.close()});
    const watcher=workspace.createFileSystemWatcher(new vscode.RelativePattern(root,'OLP-*/**/*'));
    const external=uri=>{if(!recorder||visibleSession()?.end!==undefined)return;const file=recorder.relative(uri.fsPath);if(!file)return;recorder.emit('kit_file_changed',file[0],{file},Date.now());if(!recorder.recordable(file))return;const doc=workspace.textDocuments.find(d=>d.uri.toString()===uri.toString());if(doc?.isDirty)return;try{recorder.baseline(file,fsSync.readFileSync(uri.fsPath,'utf8'),Date.now(),'external');}catch{recorder.emit('file_deleted',file[0],{file},Date.now());}};
    context.subscriptions.push(watcher,watcher.onDidChange(external),watcher.onDidCreate(external),watcher.onDidDelete(external));
  }
''' + s[pos:]
# milestones in tree
rep("    item.children.push(\n      tree('Mở đề'", "    const milestones=recorder?.events.filter(e=>e.type==='milestone'&&e.problem===problem.key)??[];\n    if(milestones.length){const row=tree('Mốc thời gian',milestones.length+' mốc','milestone');row.collapsibleState=TreeItemCollapsibleState.Collapsed;row.children=milestones.map(e=>tree(e.name,'+'+timer.clock(e.t),'check'));item.children.push(row);}\n    if(problem.sampleSource==='pdf-unverified')samples.tooltip='nguồn: tự trích từ PDF, cần kiểm tra; không chặn nộp';\n    if(problem.pages?.confidence==='fallback')item.children.push(tree('Gán trang đề','PDF đầy đủ, cần chọn trang','edit',{command:'olp.assignPages',title:'Gán trang',arguments:[target]}));\n    if(problem.commonPages)item.children.push(tree('Trang chung',undefined,'book',{command:'olp.commonPages',title:'Trang chung'}));\n    item.children.push(\n      tree('Mở đề'")
p.write_text(s,encoding='utf-8')
