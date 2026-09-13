# Verification and measured performance

Verification uses Node.js 24.19.0, TypeScript 5.9.3 and Chromium 153 on Linux/x64. GitHub Actions repeats package and browser checks on Node 22 and 24, runs native shared/Avalonia builds on Linux, and compiles Windows adapters and exercises real WPF/WebView2 on Windows.

## Automated coverage

The Node suites cover model ownership and validation, live/snapshot text positions and structural symbols, editing, patch history, observer failures, tracked review, concurrent text operations, MVVM/React/bridge APIs, fields/notes/mail merge, format conversion, advanced DOCX stories/review/opaque parts, PDF generation, and independent PDF extraction.

The expanded browser suite currently has **57 grouped checks**. It covers native typing, selection/caret, clipboard sanitation, composition reconciliation, readonly guards, retained DOM identity, real measured page ranges/navigation, break/keep/widow rules, headers/footers/notes and overflow diagnostics. React Strict Mode, sample formatting/source/table/review controls, reusable toolbar dialogs, target changes, invalid page setup, stable TOC refresh, cached fields, two-peer offline edits/reconnection, independent PDF canvas/text search, pointer overlays/history, reconstructed native text editing, Unicode reflow export/download, themes and mobile overflow are included.

Package tests install the actual npm tarball into an isolated application. They exercise ESM and CommonJS imports, shared constructors across entry points, strict TypeScript consumers including `/pdf`, `/document` and `/collaboration`, optional React, and the standalone editor bundle. The optional PDF bundle and assets are also exercised together with the separately bundled main editor in browser tests.

Native checks build the shared C# client and run executable protocol tests against both controlled transports and the actual JavaScript engine in Node. WPF and Avalonia source projects compile against pinned official packages. The Windows CI job builds WPF and WinUI, runs a real WPF/WebView2 host, checks bridge editing/formatting/selection/undo/redo/readonly/revision notifications and DOM output, and captures PNG/JSON evidence. The release archive includes native package artifacts and the runnable WPF sample. An official Avalonia NativeWebView runtime license is required by its provider; compilation does not imply licensed runtime execution.

Advanced DOCX output was independently opened with python-docx. The PDF import fixture was generated independently by ReportLab and includes out-of-order drawing operators, columns, Unicode, rotation and a graphics-only page. Its construction is documented next to the fixture. PDF export/reflow results are reparsed with PDF.js and browser-rendered for visual verification.

Run `npm run check`, then `npm run test:browser` after installing Chromium. `test-results/browser.json` records actual grouped results and browser version; CI uploads screenshots and native evidence. Node's test runner reports the final count for the checked commit.

## Performance observation

Workload: 1,000 paragraphs and 80,892 UTF-16 code units on the local Intel Xeon Platinum 8573C. Medians use three repetitions, five for insertion/search and one for binary exports:

| Operation                       | Observed time |
| ------------------------------- | ------------: |
| Construct model and ID index    |        7.0 ms |
| Serialize canonical JSON        |        1.5 ms |
| Parse canonical JSON            |        6.0 ms |
| Insert five characters and undo |       43.1 ms |
| Find all 1,000 matches          |        0.4 ms |
| Format 100 characters and undo  |       39.1 ms |
| Export HTML                     |        3.0 ms |
| Export Markdown                 |        1.3 ms |
| Export DOCX                     |       34.8 ms |
| Export PDF                      |      116.2 ms |

A separate regression test edits a 200,000-character run, verifies retained undo history below 1.5 KB, and preserves the original Run/Paragraph objects through undo/redo. Retained history uses reversible patches and compact text splices. Temporary canonical-tree cloning/diff discovery still scales with document size. Keyed rendering preserves unaffected live DOM and caches detached templates; indexing/layout traversal is not virtualized. The timings do not establish device typing latency or sustained large-session memory guarantees. `node scripts/benchmark.mjs --json` provides the repeatable workload.

## Remaining qualification

Exact Word render comparison, exhaustive WPF/native API conformance, WinUI/Avalonia runtime UI execution, physical mobile/stylus devices, actual OS IMEs, screen readers, Firefox/WebKit, production-scale collaboration/tombstone storage and arbitrary third-party Office/PDF corpora still require separate qualification. Browser page fragmentation and direct PDF generation remain different layout paths. The repository's tests establish its documented behavior, not complete Microsoft-engine parity.
