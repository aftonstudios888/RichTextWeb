RichTextWeb 0.2.0 expands the shared engine and reusable controls with document review, measured pagination, advanced document features, PDF reconstruction, collaboration and native qualification.

- Live text positions with explicit WPF-style structural symbol traversal and UTF-16 conversion.
- Reversible patch history and stable model/DOM identity. A 200,000-character edit regression retains less than 1.5 KB of undo patch data.
- Authored tracked insertions/deletions, rich restoration and accept/reject commands.
- Causal concurrent text/format operations, atomic replacements, snapshots, engine binding and a two-peer sample with paused delivery/reconnection.
- Measured page viewer with page ranges/navigation, breaks/keep/widow behavior, headers/footers, footnotes and overflow diagnostics.
- Fields, bookmarks/page references, table of contents, notes and mail merge, exposed through reusable toolbar, document-feature APIs and the validated native bridge.
- DOCX headers/footers/notes/fields/TOC, comments/replies/bookmarks/revisions and safe opaque drawing dependency retention.
- Optional PDF.js import/search/preview, reusable PDF editor with overlays/history/page operations, editable text reconstruction and export to a new PDF.
- Packable shared/WPF/WinUI/Avalonia projects, real C#/Node tests, Windows WPF/WebView2 smoke checks, and a runnable native sample.

Validation: 172 Node tests, 57 grouped Chromium checks, installed ESM/CommonJS/strict TypeScript/standalone consumers, independent PDF fixture round trips, and seven executable C# protocol groups. Distribution is gated by both JavaScript and native CI, including actual WPF/WebView2 execution and WinUI compilation on Windows.

Install with `npm install @wieslawsoltes/richtextweb@0.2.0`. The main editor remains standalone; the optional `/pdf` entry point has its own browser module and worker/font assets. Release archives include browser builds, source, the sample, native NuGet packages/sample/qualification evidence, and checksums. npm publication uses provenance and verifies the published bytes against the release tarball.

The compatibility matrix documents remaining boundaries. Exact Word pagination and complete WPF API parity are unfinished; the collaboration protocol does not merge arbitrary rich structures; PDF text editing reconstructs a separate flow document; WinUI/Avalonia UI and physical input/accessibility qualification remain separate. The official Avalonia NativeWebView requires its provider's runtime license.

Demo: https://wieslawsoltes.github.io/RichTextWeb/
Compatibility: https://github.com/wieslawsoltes/RichTextWeb/blob/main/docs/COMPATIBILITY.md
