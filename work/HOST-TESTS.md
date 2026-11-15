# 0.7.0 supervisor acceptance

Round 8 adds test tooling only; product sources and VSIX are unchanged. Run the new non-interactive quick-flow check first (cookie-protected mock contest AND cookie-protected shared PDF, same test module as the real runner):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File work\run-host-check.ps1 -Name live-quick-mock
```

Expected final line: `HOST live-quick-mock PASS` (inner `LIVE QUICK PASS`, `Sensitive-pattern scan PASS`, `KẾT QUẢ: ĐẠT`). Log: `outputs\host-logs\live-quick-mock.log`. Maximum eight minutes. Images: `outputs\live-quick\main-layout-{1366x768,1920x1080}.png` and `statement-{A,B,C,D}-{1366x768,1920x1080}.png`, captured with the existing CDP screenshot helper. Inspect the statement ranges visually; the test deliberately does not assert split correctness. Reports: `outputs\live-quick\report.md` / `.json`; copied PDFs/text/samples: `outputs\live-quick\kit\`. The isolated profile is removed; diagnostic fixtures/logs remain. No automatic submission or real VNOJ request. Local pure check: `node work\test-live-quick-tools.js` → `live quick tooling pure PASS 10`.

Only after that passes, with the user present, run the separate REAL entry point (not part of unattended host acceptance):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File work\run-olp-live-quick.ps1 -ContestUrl https://oj.vnoi.info/contest/olp24
```

Replace the contest URL as appropriate. Optional `-KeepOpenMinutes 5` permits the user to try the isolated extension himself. Cookie input is a real VS Code input box, passed straight through without capture, with a five-minute cancellation token; Esc/timeout records CANCELLED and exits nonzero without importing/starting. Automation invokes only quick/source/statement commands. During automation, extension fetch calls are guarded to GET on oj.vnoi.info only. During the explicit manual interval, the guard additionally permits the product's normal problem submission POST so the user may click Submit himself; the test never invokes it. The request report omits headers, bodies and query strings. Status sequences show possible authenticated retries without reading cookies. Profile cleanup and an additional on-disk sensitive-pattern scan run after the host exits. Pattern scanning is an audit, not proof against arbitrary encodings. Screenshots start only after cookie input has closed.

Run the older regression commands below from the project root in order. Each command is independent, non-interactive, bounded below ten minutes and exits nonzero on failure. Do not run `run-olp-live.ps1`. All VNOJ traffic in these suites, including practice, is redirected to the local mock. Practice injects one public-GET ECONNRESET and strictly checks the retry; it no longer relies on live pages. Logs include step names, expected/actual assertions and state dumps. Preserve the unique e2e/shot directories for diagnostics; runners close only processes with their own isolated directory in the command line. No installation into the user's VS Code.

Legacy-history follow-up after round 5 (13 PASS; only v6-migrate failed). Prior passes apply to the previous package. Run unit-v7, replay and v6-migrate first, then the remaining regression commands below.

History now uses the same report renderer and reads the selected session's own logs. If no detailed logs exist, legacy focus/phase journal intervals supply the old per-problem allocation, clearly labelled legacy estimates. Unknown idle/outside values are dashes, not false measured zeros. History copy/export target the viewed session. Historical export does not replace the running recorder or invent historical source from current files.

The strict v6-migrate assertion still requires exactly 00:02:00.000 / 03:00:00.000 and now prints the complete actual report on failure. It additionally requires A total/coding 00:01:00.000, the Vietnamese legacy label, no NaN, unknown outside/idle, exact history clipboard copy, legacy=true/missingData in a valid ZIP, preserved legacy journal and unavailable old source. It verifies replay/hash checks and that live editing is still recorded after exporting history. Pure unit-v7 covers old phase timing, legacy archive verification and modern startup delay not falsely classified as legacy. Python replay also verifies the generated legacy archive and rejects invented source replay.

All schema-2 archive/report checks from round 5 remain. Submission and networking modules are unchanged. All isolated runners close only their own instances and exit nonzero on failure. Earlier evidence directories/logs remain untouched.

Each command below is a single command line. Its final line must be `HOST <Name> PASS`; the matching log is `outputs\host-logs\<Name>.log`.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File work\run-host-check.ps1 -Name unit-v7
powershell -NoProfile -ExecutionPolicy Bypass -File work\run-host-check.ps1 -Name replay
powershell -NoProfile -ExecutionPolicy Bypass -File work\run-host-check.ps1 -Name v6-migrate
powershell -NoProfile -ExecutionPolicy Bypass -File work\run-host-check.ps1 -Name v7-main
powershell -NoProfile -ExecutionPolicy Bypass -File work\run-host-check.ps1 -Name v6-main
powershell -NoProfile -ExecutionPolicy Bypass -File work\run-host-check.ps1 -Name v7-crash
powershell -NoProfile -ExecutionPolicy Bypass -File work\run-host-check.ps1 -Name practice
powershell -NoProfile -ExecutionPolicy Bypass -File work\run-host-check.ps1 -Name shots-main
powershell -NoProfile -ExecutionPolicy Bypass -File work\run-host-check.ps1 -Name shots-quick
powershell -NoProfile -ExecutionPolicy Bypass -File work\run-host-check.ps1 -Name unit-submit
powershell -NoProfile -ExecutionPolicy Bypass -File work\run-host-check.ps1 -Name unit-core
powershell -NoProfile -ExecutionPolicy Bypass -File work\run-host-check.ps1 -Name submit
powershell -NoProfile -ExecutionPolicy Bypass -File work\run-host-check.ps1 -Name live-mock
powershell -NoProfile -ExecutionPolicy Bypass -File work\run-host-check.ps1 -Name shots-urgent
```

| Name | Expected inner result | Log |
| --- | --- | --- |
| unit-submit | tất cả 15 kiểm thử đạt | outputs\host-logs\unit-submit.log |
| unit-core | tất cả 19 kiểm thử đạt | outputs\host-logs\unit-core.log |
| unit-v7 | v7 pure PASS 17; layout-view model PASS 9; process-boundary PASS 10 | outputs\host-logs\unit-v7.log |
| replay | Python independent ZIP + replay PASS | outputs\host-logs\replay.log |
| submit | submit PASS | outputs\host-logs\submit.log |
| practice | practice PASS, restore PASS | outputs\host-logs\practice.log |
| live-mock | KẾT QUẢ: ĐẠT | outputs\host-logs\live-mock.log |
| v6-main | main PASS | outputs\host-logs\v6-main.log |
| v6-migrate | migrate PASS | outputs\host-logs\v6-migrate.log |
| v7-main | v7 main PASS | outputs\host-logs\v7-main.log |
| v7-crash | v7 crash PASS | outputs\host-logs\v7-crash.log |
| shots-main | done: ...screenshots-0.7.0 | outputs\host-logs\shots-main.log |
| shots-urgent | done: ...screenshots-0.7.0 | outputs\host-logs\shots-urgent.log |
| shots-quick | done: ...screenshots-0.7.0 | outputs\host-logs\shots-quick.log |

The main 0.7 host suite uses actual editor `type`, undo/redo and real webview visibility/page messages; it imports the real combined 2024 PDF from the mock, checks all four mappings, reads the JSONL logs, runs G++, samples/diff/add-sample, pre-submit rejection and exactly one approved POST, final verdict, laps/notes, warnings and automatic export. It independently reads ZIP entries, checks every manifest hash/size, verifies replay and scans every entry for the mock cookie. It exercises idle while the OS window is focused. It does not fake OS focus: if Windows keeps a hidden instance unfocused, it checks the real blur record and explicitly logs the limitation; focus/blur priority is unit-tested.

Crash suite kills only its own isolated profile mid-session, reuses the same profile/workspace, resumes writing and exports with replay integrity. Saved source is checked before/after restart. JSONL records are synchronously fsynced. Torn-tail recovery is tested separately by the unit suite.

View EVERY PNG in `outputs\screenshots-0.7.0\`, both `-1366x768.png` and `-1920x1080.png`:

- working-code-input-output; working-without-pdf
- split-statement-A-pages-3-4 (A must start on original page 3)
- combined-pdf-fallback-all-pages (intentional fallback fixture, clear manual-assignment notice)
- failing-sample-tree; failing-sample-diff
- submissions-scoreboard-milestones
- last-five-minutes (error-color clock)
- quick-cookie-paste-box (actual extension login command; empty password field, cancelled without authentication)
- quick-ready-code-input-output (actual quick command, stored synthetic mock session, ready prompt)
- quick-ready-working-view (after cancelling the ready prompt, showing the prepared working layout)
- export-notification (actual archive generated by extension)

Check code width, all Vietnamese labels, statement legibility, unobstructed IO, no overlap, readable notification and scoreboard. The sample diff must occupy group 1 (the wide left group); journal starts collapsed. The statement header must show the source page range, the focus-derived live reading clock and a Gán trang đề button in fallback mode. Quick link selection is captured BEFORE Enter; the ready prompt is a persistent modal, captured only after its actual text appears in the workbench. Capture fails if ready and link-selection PNGs are identical. `capture-audit.jsonl` records scene, resolution, expected UI text and PNG hash. The isolated quick profile explicitly uses custom workbench dialogs so the modal is included in the workbench screenshot.

Capture uses the real workbench renderer with CDP viewport sizes and no desktop/user-window automation. Return visual findings and logs even if an earlier suite fails; later isolated suites can run independently. The pure wrappers unit-submit, unit-v7 and replay were exercised in the sandbox. The VS Code host/screenshot commands await the supervisor; Code launch and piped child-process restrictions are already established.
