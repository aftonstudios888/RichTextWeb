# Verification and measured performance

Verification uses Node.js 24.19.0, TypeScript 7.0.2 and Chromium 153 on Linux/x64. GitHub Actions repeats package and browser checks on Node 22 and 24, executes shared native protocol checks on Linux, and builds and runs the WPF, WinUI and Avalonia sample hosts on Windows. Check the release commit's CI report for the final outcome; compilation and runtime execution are separate gates.

## Automated coverage

The Node suites cover model ownership, dependency-property metadata and inheritance/coercion, live/snapshot positions and structural symbols, rich editing, patch history, observer failures, formatting/move/structural review, merged-cell geometry, rich concurrent operations, MVVM/React/bridge APIs, fields/notes/mail merge, format conversion, DOCX stories/native review/anchored text boxes, PDF flow export, and original PDF operator editing. The runner records the exact test count for each commit.

Real Chromium checks include native typing, selection/caret, clipboard sanitation and stale asynchronous cut rejection, composition reconciliation, readonly guards, retained DOM identity, measured finite-page editing/navigation, columns, headers/footers/notes and overflow diagnostics. A 3,000-paragraph virtualization fixture verifies fewer than 60 retained paragraph elements, distant selection/edit/undo, complete native selection materialization and composition protection. Floating text-box stories, image handles, scoped rich editing, React Strict Mode, paginated React refs and MVVM document bindings exercise the shared controls.

The sample checks instantiate all seven requested published libraries, execute RibbonWeb commands, edit through reusable toolbar dialogs, filter the TreeDataGrid through ReactiveWeb/DynamicData, float/dock the actual editor without losing history, traverse QuikGraph reference edges, query RBush bounds, inspect/reject formatting review, and verify dark/mobile layouts. Rich collaboration browser checks merge offline/reordered paragraphs, text, tables and images, then checkpoint both live controls. PDF checks exercise canvas/text search, original-source replacement/undo, overlays, page organization, reconstructed typing and Unicode reflow export.

Package tests install the actual npm tarball into an isolated application. ESM, CommonJS, strict TypeScript and standalone consumers exercise shared constructors, the page editor, React typed refs and virtualization props, Figure/Floater interchange, dependency-property coercion/read-only keys, rich coauthoring/checkpoints and original PDF replacement followed by saving and reopening. The standalone main/PDF bundle combination is also tested in the browser.

Native PR #8 passed **10 WPF/WebView2, 11 WinUI/WebView2 and 11 Avalonia NativeWebView checks** in [Windows CI run 34758192244](https://github.com/wieslawsoltes/RichTextWeb/actions/runs/34758192244). The release pipeline repeats these gates for the final feature commit.

The Windows smoke applications exercise real native WebView controls: handshake, editing/selection/formatting, undo/redo, DOM output, MVVM notifications, readonly policy, stale revision rejection, document features and tracked-change rejection. WPF captures PNG evidence; WinUI captures a native WebView2 PNG; Avalonia prints the rendered WebView to PDF. Successful JSON reports are required before packaging. The shared C# tests use controlled transports and the actual JavaScript engine, and exercise the loopback asset server. The pinned Avalonia.Controls.WebView 11.4.0 dependency is MIT licensed.

Advanced DOCX fixtures are checked both with the engine's hash-bound extension and with that extension removed to exercise native XML import. PDF fixtures include independently generated ReportLab content and PDF.js extraction/rendering; operator checks cover encodings, text advance, nested/shared Forms and unsupported-input diagnostics.

Run `npm run check`, then `npm run test:browser` after installing Chromium. `test-results/browser.json` records grouped results and the browser version; CI uploads screenshots, benchmark observations and native evidence. Release archives retain native application/package artifacts and their qualification reports.

## Performance observation

Workload: 1,000 paragraphs and 80,892 UTF-16 code units on the local Intel Xeon Platinum 8573C. Medians use three repetitions, five for insertion/search and one for binary exports. This is a local wall-clock observation, including undo where named; it is not a device latency guarantee. A second run under concurrent build load measured 24.0 ms construction, 34.0 ms insert/undo and 123.7 ms format/undo, illustrating workload sensitivity.

| Operation                       | Observed time |
| ------------------------------- | ------------: |
| Construct model and ID index    |       11.2 ms |
| Serialize canonical JSON        |        0.7 ms |
| Parse canonical JSON            |        7.9 ms |
| Insert five characters and undo |       28.8 ms |
| Find all 1,000 matches          |        0.4 ms |
| Format 100 characters and undo  |       65.2 ms |
| Export HTML                     |        2.6 ms |
| Export Markdown                 |        0.8 ms |
| Export DOCX                     |      116.3 ms |
| Export PDF                      |      118.4 ms |

A separate regression edits a 200,000-character Run, verifies retained undo below 1.5 KB, and preserves the original Run/Paragraph objects through undo/redo. Common untracked single-Run typing avoids whole-document serialization; structural edits and symbol/index maintenance can still traverse document-size data. Continuous block virtualization limits retained DOM, while finite page measurement materializes the complete flow. `node scripts/benchmark.mjs --json` provides the repeatable workload. CI records observations for the release commit without enforcing machine-dependent timing thresholds.

## Remaining qualification

Exact Word render comparison, exhaustive WPF/native API conformance, Avalonia runtime execution on macOS/Linux, physical mobile/stylus input, actual OS IMEs, screen readers, Firefox/WebKit, production collaboration storage/transport and arbitrary third-party Office/PDF corpora need separate qualification. Browser pagination, browser print and direct PDF generation remain different layout paths. Repository tests establish the documented behavior for the tested environments, rather than complete Microsoft-engine parity.
