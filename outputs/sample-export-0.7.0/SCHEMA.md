# OLP evidence schema 2 (extension 0.7.0)

All paths are relative to the extracted archive. JSON numbers ending in `Ms`, `t`,
`ms` or timing category values are integer milliseconds. Legacy raw records may
have fractional run/compile wall times; raw records are never rewritten during
export. Byte sizes describe UTF-8 or binary bytes; character offsets/counts use
JavaScript UTF-16 code units (an emoji usually occupies two).

## Timing: one measured model

`summary.json` is the source of every timing figure rendered in `summary.md` and
`report.md`, including the report written/opened/copied inside VS Code. Display
format is HH:MM:SS.mmm; no category is independently rounded to seconds.

`elapsedMs` is wall time from start to end/export, capped at the deadline.
`limitMs` is the contest limit. `totalMs` for a problem is the time assigned to
that problem, including its idle/outside intervals; it is not time since first
visit. An AC at +26 seconds refers to the session clock, not the problem total.
Every problem's categories sum exactly to its total. Problem totals plus
`unassigned.totalMs` equal `overall.totalMs` and elapsed. No event before the first
known focus is silently assigned to a problem. Missing initial intervals are
`none` under `unassigned`. Unobserved legacy time is explicitly unavailable.

Legacy exception: `legacy=true` uses the old focus/phase journal for the
pre-upgrade interval (`legacyPrefixMs`). Reports say **phiên cũ – không có nhật ký
chi tiết**. This reproduces old per-problem/phase allocation, including time that
may actually have been idle/outside; it is an estimate, not new observation.
Old testing is combined I/O, represented in input, since output cannot be split.
`legacyOnly=true` displays unknown output/other-file/outside/idle as —. Their
numeric zero allocation is bookkeeping, not a measured zero; see
`unavailableTimingCategories`. A continuing old session combines estimated prefix
with observed post-upgrade intervals. Elapsed/limit still use the original
start/end/deadline. Ordinary asynchronous startup delay in a new recording does
not classify it as legacy.

Effective category priority: outside > idle > actual focused surface:

| Category | Definition |
| --- | --- |
| statement | That problem's statement webview is active/visible and window focused. |
| code | Its solution editor owns focus. |
| input / output | Its input.txt / output.txt editor owns focus. |
| other-file | Another file in the kit is active; problem may be unassigned. |
| none | No observed problem surface; not inferred from a button click. |
| outside | VS Code window unfocused, or unknown crash/closed-window gap. |
| idle | Window focused, but no kit edit, selection, scroll or OLP command for idleSeconds (default 90). |

Idle may be active thought/reading. Focus is a proxy, not proof of attention.
No OS keystrokes, other applications, or files outside the kit are monitored.
Same-time changes have zero duration; `seq` resolves order. Visits have inclusive
start `t` and exclusive `end`; end of session bounds timing, not late verdicts.

## Manifest / summary

`manifest.json`: schemaVersion, extensionVersion, synthetic, timezone (IANA),
utcOffsetMinutes, session `{id, limitMs, elapsedMs, startedAt, endedAt, endReason}`.
Timestamps include local UTC offset. endReason is manual/expired, or null while
running. Contest title and problem identity are included. `files` indexes every
stored entry except manifest itself: path, bytes, SHA256, description.
`integrity` lists replay divergences, missing blobs/assets and recovered torn
tails. Never treat a failed integrity result as complete evidence.

`legacy` and `missingData` identify intentionally unavailable historical data,
separately from integrity failures. A valid legacy archive may have no edits or
snapshots at all. `timeline/legacy-journal.jsonl` preserves the original records
with `at` in epoch milliseconds; these are not fabricated detailed events.
Current kit PDFs/samples are labelled currentKitCopy when historical provenance
cannot be established. A final source/input/output with no historical snapshot
has state=unavailable, path=null, bytes=null and a reason, and is omitted: today's
kit solution must not masquerade as an old solution. Submission metadata may
similarly say sourceState=unavailable. Replay verify validates present evidence;
file replay correctly fails with No baseline when historical text is unknown.
Snapshot listing/submissions commands list only actually retained text.
Post-session observations from an earlier export may remain in the complete raw
logs, but are not labelled as session-end source or materialized historical code
history. README file examples use an available session-time baseline, or explain
that file replay is unavailable.

Problem identity in manifest AND summary: key, name, sourceFile (replay file key), vnojCode, URL,
originalHeading/Number in PDF (may differ from contest A/B/C/D), language,
finalVerdict, bestScore (null when a numeric score is unknown), accepted,
submissionsCount. The latest verdict and best score need not come from the same
submission. Summary also has milestones, laps, visits, counts, typing,
longest idleGaps, per-minute activityStrip and results. `sampleRuns.pass/fail`
counts batches. `sampleResults.total/pass/fail/verdicts` counts individual tests.
CE before executing any test counts one failed batch and zero individual tests.
summary.durationMs is a legacy alias for elapsedMs, never the contest limit.
`runs` excludes sample executions. `compileErrors` counts failed compilations,
not the number of diagnostic messages.

`problems/X/statement.json`: source PDF path, inclusive 1-based page range, crop
top/bottom in PDF viewport points at scale 1, top origin (top on first page,
bottom on last page), confidence, assignment automatic/manual, original heading
and number, commonPages. Identical shared PDFs are stored once at
statement/full.pdf (additional shared groups use a hash suffix). Separate PDFs
remain under their own problem. PNG pages are the authoritative rendered
statement; text is a convenience. Scripts are encoded as `^{...}` / `_{...}`;
tables, fractions, equations or reading order can still be ambiguous.

Samples metadata: n, samplesSource = vnoj-html / companion / user-added / unknown,
verified (official transport provenance AND matching imported hashes, not proof
of correctness), originalHashes, current hashes, matchesImported (null if unknown), provenance,
in/out file descriptors. PDF-auto samples use unknown with pdf-unverified
provenance and never block submission. Old imports without provenance are unknown.
Problem `files` describes final source/input/output, including omitted empty files.

## Raw timelines

`timeline/events.jsonl`, edits.jsonl, snapshots.jsonl are append-only local logs,
exported without lossy collapsing. Missing empty JSONL files mean zero records.
Every record has seq (session-wide monotonic order), t (ms since start), ts
(ISO-8601 local offset), type, problem (A.. or null). Fields below are additional;
unavailable optional values are omitted/null. No authentication data is logged.

| Event type | Additional fields and meaning |
| --- | --- |
| session_start / session_resume | recoveredTails: log names whose torn tails were preserved locally. |
| session_end / session_expiry | No required extras; end/expiry checkpoint. |
| start / end / expired | Legacy session journal markers, retained alongside recording lifecycle. |
| focus | phase = statement/code/input/output/other-file/none, observed surface. |
| phase | Legacy phase = analysis/coding/testing; not used for measured time. |
| activity | category (effective timing category above), optional reason=recording_gap. |
| statement_pages | pages: visible 1-based original PDF page numbers, throttled. |
| window_focus / window_blur | Observed VS Code window focus; no external activity inferred. |
| idle_start / idle_end | Interaction threshold crossed / interaction resumed. |
| selection | file, line, col (zero-based UTF-16 column); throttled samples. |
| run / sample_result | command, args, exit (null if unavailable), ms, status, verdict, sample (1-based), stdoutBytes, stderrBytes, stdoutTruncated, stderrTruncated, refs, artifacts. |
| samples | passed, total, items [{n,v,ms}], optional status CE/Dừng; batch result. |
| compile_result | sourceHash (SHA256 of exact UTF-8 compiler input), ok, cached, ms, diagnostics, command, args, output reference. |
| compile | Legacy failed-compile journal entry: errors (diagnostic count). |
| submission_attempt | language, source (retained exact source ref); may fail before receiving an id. |
| submission_source | id, url, language, source; exact accepted submission payload. |
| sent | submission (id), url, language optional, auto flag; user's click sent this submission. |
| verdict_poll | id, status, final (boolean). |
| verdict | submission id optional for manual marks, url, text, auto optional. |
| opened | url/code optional: browser submission page opened, not proof of submission. |
| milestone | name, optional typed fields; first_statement/keystroke/compile/clean_compile/sample_pass/submission/AC. |
| mark | text (full note/lap/stuck text), problem, phase captured before note dialog; timestamp is confirmation time. Legacy phase can be unknown/null. |
| timer_warning | minutes remaining threshold. |
| template_applied | file, historical flag (already templated at recording start). |
| file_created | file: baseline first observed; not necessarily original creation time. |
| kit_file_changed | file: filesystem watcher signal, possibly generated; not proof of user typing. |
| external_change | file, chars (UTF-16 length after replacement). |
| file_deleted | file: unavailable filesystem file. |
| pages_assigned | start/end inclusive original PDF page numbers. |
| resume_baseline | file, previousHash, observedHash, changed, reason=reopened_document. |
| recording_divergence | file, expected/observed SHA256; an unobserved discrepancy remains visible in integrity. |
| snapshot_missing | file, error. |
| export | filename of created ZIP. |

`edits.jsonl` types:

- edit: file (kit-relative), version (VS Code document version; optional for
  external replacement), reason (1 undo, 2 redo, external, or omitted), generated,
  undo, redo, changes. Each change has offset, removed (UTF-16 length),
  removedText, text, pasteLike. All offsets in a batch refer to the same previous
  version: apply in descending offset order. pasteLike means a single insertion
  >=32 UTF-16 units, not certainty about a clipboard operation. generated means
  extension-written output, excluded from typing totals. Empty no-ops are dropped.
- save: file, version; no text change. Save may occur without typing.

`snapshots.jsonl`: type=snapshot, file, hash (SHA256 UTF-8), reason, t/seq.
Blobs are content-addressed under timeline/blobs/HASH. SHA256 of empty UTF-8 is
implicit, with no empty physical blob. Reasons: start, resume, run, samples,
submission, periodic, end, export, external. Snapshot verification merges edits
and checkpoints by seq. On resume, a known lost-unsaved rollback gets an explicit
resume_baseline, an external replacement, then a resume snapshot. Old unsaved
edits survive historically; rollback is not typing. Unexpected divergence is
reported, not hidden. A killed host may lose up to the latest unflushed OS event;
delivered records are synchronously fsynced. No pre-upgrade history is invented.

Code history materializes only changed content, with consecutive equal hashes
collapsed. Filenames: snapshots/NNN-t-reason.ext and diffs/NNN.diff, whole-file
unified diff versus prior materialized text. Unchanged templates get only an
index explanation; full raw checkpoints remain available for replay.

## Runs, compilations, submissions, references

Folders: problems/X/runs/run-003-sample-2-WA or run-001-input-OK; order is per
problem, sorted by timeline seq. AC/WA folder labels correspond to ĐÚNG/SAI
sample results, not judge certification. Compile-only failures have their own
run-NNN-compile-CE metadata. One meta.json per execution includes the full compile
result and diagnostics. cached means the exact source/compiler/flags/cwd key AND
binary SHA256 match a prior successful build. Editor/disk source mismatch aborts
execution. Diagnostics: file, line/column (1-based), severity, message.

Run meta fields are the run event fields plus compile. stdin/stdout/stderr refs
and compile.output use archive paths. Original raw references resolve through
manifest.artifacts[oldPath]. A descriptor is `{path, bytes, state}`; empty has
path=null, bytes=0, state=empty and no physical file. Raw asset refs may also have
storedBytes/truncated. Counts of original stdout/stderr bytes and truncation are
preserved. Head and tail are retained when capped at 200KB; truncation is explicit.
Compilation output can be shared by multiple sample executions.

problems/X/submissions/ID/source.ext is the exact submitted text, not a later
snapshot. meta.json contains id, URL, language, source path, verdict, verdictAt
(ms). Pending attempts remain under pending-N, with attemptAt and pending=true.
Final verdict is merged into meta; intermediate polls stay in raw events. One
submission POST requires one user's click; archive does not prove judge identity.

## Reconstruction and readable work logs

From the extracted root: `node tools/replay.js verify` or
`python tools/replay.py verify` checks manifest hashes and snapshot/edit replay.
`file A/A.cpp T out.cpp` reconstructs inclusive session time T (ms).
`snapshots [A/A.cpp]` lists all checkpoints, including collapsed materializations.
`submissions folder` writes exact sources and metadata for every numbered
submission; use these for byte-exact submitted text, since several edits and a
submission can share a timestamp. `timeline` prints the merged work log.
README_AGENT.md gives an actual time inside this session.

timeline/timeline.md and problems/X/worklog.md are readable derivatives: noisy
watcher/selection signals omitted, same-second state flips collapsed, edit bursts
show full inserted AND removed text up to 300 UTF-16 units each with line ranges.
Use raw JSONL for complete records and precise order, not these summaries.

No cookie/session values, unrelated clipboard data, authentication headers,
external files, or deliberate usernames beyond public VNOJ handles are exported.
User-written kit text can itself contain private information. This is local,
self-recorded evidence; timestamps/activity/coverage may be incomplete and are
not tamper-proof. No telemetry, upload or monitoring outside the kit occurs.
