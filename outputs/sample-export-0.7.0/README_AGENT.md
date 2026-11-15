# OLP practice evidence archive
SYNTHETIC DEMONSTRATION — NOT A REAL ATTEMPT

Read SCHEMA.md for all fields, timing definitions, reconstruction and caveats. Suggested order: manifest.json → summary.md/json → report.md → timeline/timeline.md → problems/A/worklog.md and code-history/index.md. Raw events/edits and both replay tools are authoritative for reconstruction; integrity reports missing data/divergences.

Time: elapsed is wall time since session start, bounded by end/deadline; limit is the contest allowance. A problem's total is its allocated intervals: statement (active visible PDF), code, input, output, other-file, none (no observed surface), outside (unfocused VS Code/unknown crash gap), idle (focused but no observed interaction for the configured threshold). Outside overrides idle, then the focused surface. Each problem's categories sum to its total; problems plus unassigned sum to elapsed. All three reports use these same integer-ms values, displayed as HH:MM:SS.mmm. Idle/outside describe observations, not attention.

Contest: SYNTHETIC OLP demonstration; 1 independent problems, limit 03:00:00.000. Judge verdicts/partial scores are recorded; other scoring rules are unknown. PNG statement-pages are the authoritative rendered statement; statement.txt is a convenience and mathematical layout may still lose meaning. Shared PDFs live once in statement/; each problem's statement.json specifies pages/crop/assignment.

All paths are archive-relative. Run artifacts and exact submitted sources live under problems/X; raw timeline references resolve via manifest.artifacts. Empty files are omitted (state=empty in metadata); empty snapshot blobs are implicit SHA256 of empty UTF-8. Legacy data gaps are explicit. Events are self-recorded interaction proxies, not proof of attention. No cookies, sessions, request headers or deliberate usernames beyond public VNOJ handles are exported. User-authored kit text can itself be sensitive; inspect before sharing. No upload/telemetry.

From the extracted folder (time 15000 ms is inside this session):
```text
node tools/replay.js file A/A.cpp 15000 source.cpp
python tools/replay.py file A/A.cpp 15000 source-python.cpp
node tools/replay.js submissions reconstructed-submissions
python tools/replay.py submissions reconstructed-submissions-python
node tools/replay.js snapshots
python tools/replay.py snapshots
node tools/replay.js verify
python tools/replay.py verify
node tools/replay.js timeline
```
Submission commands write exact retained sources and metadata for every submission (including duplicate source texts). See SCHEMA.md for the difference between event-time replay and exact submitted bytes.
