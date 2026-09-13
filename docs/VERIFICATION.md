# Verification and measured performance

Local verification performed on 2026-09-13 with Node.js 24.19.0, TypeScript 5.9.3 and headless Chromium 153 on Linux/x64. GitHub Actions repeats the release checks on Node 22 and 24 with its installed Chromium build.

## Tests

- **100 automated Node tests passed** across the document model, engine, browser-control SSR/API, MVVM/bridge/React SSR, text formats, DOCX and PDF.
- **34 grouped browser checks passed.** Browser checks cover native typing and caret movement, selection preserved through toolbar focus, keyboard history, cross-paragraph edits, clipboard sanitation, simulated composition/undo, empty IME input, metadata/whitespace retention, concurrent composition conflicts, read-only/tab/zoom and all viewers.
- React Strict Mode checks cover mounting/ref/settings, one callback per edit, revision subscriptions, replacement/read-only properties and unmount cleanup.
- The sample is exercised through Markdown source application, ribbon formatting, table dialogs, DOCX download, PDF conversion/overlay/download, light/dark themes and a 390px mobile viewport. Additional review checks verify comments, bookmarks, table tools, persistence and read-only commands.
- Package checks install the actual npm tarball into an isolated consumer and test ESM, CommonJS, strict TypeScript imports, every public entry point, optional React, cross-module constructor identity and standalone IIFE use. Both fresh-pack and supplied release-tarball modes pass.
- A generated DOCX was independently opened with python-docx; generated PDF output was visually inspected through MuPDF.

Run `npm run check`, then `npm run test:browser` after installing Chromium. `test-results/browser.json` records the grouped browser check count and browser version; screenshots include desktop, dark theme and mobile. Browser artifacts are uploaded by CI.

## Performance observation

Workload: 1,000 paragraphs, 80,892 UTF-16 code units, 1,000 search matches. Local medians on Intel Xeon Platinum 8573C; 3 repetitions except 5 for insertion/search and 1 for binary exports:

| Operation                       | Observed time |
| ------------------------------- | ------------: |
| Construct document and ID index |       12.4 ms |
| Serialize canonical JSON        |        1.6 ms |
| Parse canonical JSON            |        7.0 ms |
| Insert five characters and undo |       46.0 ms |
| Find all 1,000 matches          |        0.4 ms |
| Format 100 characters and undo  |       35.3 ms |
| Export HTML                     |        3.5 ms |
| Export Markdown                 |        1.9 ms |
| Export DOCX                     |       34.2 ms |

These observations include allocation and history work where named. They are not latency guarantees or a statistical performance study. Engine edits and undo currently clone document snapshots; DOM rendering rebuilds the edited document surface. Large-document typing, sustained memory use and native browser layout are therefore separate performance concerns. `node scripts/benchmark.mjs --json` produces a reproducible report for the current environment.

## Qualification not performed

Real Windows WPF/WinUI or Avalonia native builds, physical mobile/stylus devices, real operating-system IMEs, screen readers, Firefox/WebKit, production-scale memory testing, exact Word render comparison, exhaustive native API conformance, and arbitrary third-party document corpora were not qualified. The tests validate the documented implementation; they do not establish full Word/WPF or Office-file fidelity.
