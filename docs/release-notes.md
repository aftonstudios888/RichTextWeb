RichTextWeb 0.1.0 introduces a reusable JavaScript rich text engine with .NET-style FlowDocument APIs, model-driven editing, browser controls, MVVM/React integration, native WebView source adapters, and a working Document Studio sample.

The distribution includes ESM, CommonJS, TypeScript declarations, source maps, a standalone browser bundle, complete source, the sample app, an npm tarball and SHA-256 checksums. CI validates installed consumers and browser behavior before creating the release and publishing the same tarball to npm with provenance.

Import/export supports the documented text, JSON, HTML, Markdown, XAML, RTF and DOCX subsets. PDF generation contains selectable text; PDF editing supports overlays and page operations. Compatibility is documented in docs/COMPATIBILITY.md and docs/FORMATS.md. This release does not establish full Word/WPF parity, exact Office layout fidelity, arbitrary existing PDF text reflow, or native desktop qualification.
