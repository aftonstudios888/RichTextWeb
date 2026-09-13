# RichTextWeb

[![CI](https://github.com/wieslawsoltes/RichTextWeb/actions/workflows/ci.yml/badge.svg)](https://github.com/wieslawsoltes/RichTextWeb/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@wieslawsoltes/richtextweb)](https://www.npmjs.com/package/@wieslawsoltes/richtextweb)
[![npm downloads](https://img.shields.io/npm/dm/@wieslawsoltes/richtextweb)](https://www.npmjs.com/package/@wieslawsoltes/richtextweb)
[![MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

A reusable rich text engine and flow document library for JavaScript, TypeScript, web components, React, and .NET-style MVVM applications. One structured document model powers editing, safe format conversion, browser rendering, and a validated WebView bridge for desktop hosts.

**[Open Document Studio](https://wieslawsoltes.github.io/RichTextWeb/) · [Download releases](https://github.com/wieslawsoltes/RichTextWeb/releases) · [API and migration](docs/INTEGRATION.md) · [Compatibility](docs/COMPATIBILITY.md)**

RichTextWeb 0.2 adds reversible patch history, live text positions, tracked-change review, collaborative text operations, measured page viewing, headers/footers, fields, notes, mail merge, PDF text reconstruction, and reusable editing tools. The public APIs follow familiar .NET patterns and work through web components, React and MVVM. Its desktop adapters host the same web engine. Complete Word/WPF API and rendering parity remains a larger compatibility target; the [compatibility matrix](docs/COMPATIBILITY.md) distinguishes implemented behavior from remaining boundaries.

## Install

```sh
npm install @wieslawsoltes/richtextweb
# React is optional; install it only for the React adapter.
npm install react react-dom
```

Node.js 22.13+ for package tooling and headless use. Browser rendering requires modern custom elements, Shadow DOM, and the Selection/beforeinput APIs. The engine itself has no DOM or React dependency.

## Create a document and edit it

```ts
import {
  FlowDocument,
  Paragraph,
  Run,
  Bold,
  RichTextEngine,
  TextRange,
} from "@wieslawsoltes/richtextweb/core";

const document = new FlowDocument();
const paragraph = new Paragraph();
paragraph.Inlines.Add(new Run("Hello "));
paragraph.Inlines.Add(new Bold(new Run("world")));
document.Blocks.Add(paragraph);

const engine = new RichTextEngine(document);
engine.Select(6, 11);
engine.ApplyProperty("Foreground", "#1254a3");
engine.InsertText("web");
engine.Undo();

const range = new TextRange(document.ContentStart, document.ContentEnd);
console.log(range.Text);
const subscription = document.Changed.Subscribe((event) => {
  console.log(event.Revision, document.Text);
});
// Dispose subscriptions and owned engines when their host is destroyed.
subscription.Dispose();
engine.Dispose();
```

## Web component

```html
<rich-text-toolbar for="editor" mode="all"></rich-text-toolbar>
<rich-text-box
  id="editor"
  view-mode="page"
  aria-label="Article"
></rich-text-box>
<script type="module">
  import { registerRichTextWeb } from "@wieslawsoltes/richtextweb/web";
  import { fromMarkdown } from "@wieslawsoltes/richtextweb/formats";
  registerRichTextWeb();
  const editor = document.querySelector("#editor");
  editor.Document = fromMarkdown("# Hello\n\nAn **editable** document.");
  editor.addEventListener("documentchange", (event) => {
    console.log(event.detail.document.ToJSON());
  });
  editor.Zoom = 1.25; // ratio: 1 = 100%
</script>
```

Bare module imports above are intended for bundlers or import maps. For a plain HTML page with no build tool, download `richtextweb-browser.tar.gz` from a release and load `richtextweb.global.js`:

```html
<script src="./richtextweb.global.js"></script>
<rich-text-box id="editor" theme="light"></rich-text-box>
<script>
  RichTextWeb.registerRichTextWeb();
  document.getElementById("editor").Document = RichTextWeb.fromMarkdown(
    "# Standalone\n\nNo framework required.",
  );
</script>
```

Registration is explicit and idempotent. `FlowDocumentReader`, `FlowDocumentScrollViewer`, and `FlowDocumentPageViewer` provide read-only controls. Style their exposed `editor` and `viewport` shadow parts or `--rt-*` CSS variables.

## React

```tsx
import {
  RichTextEditor,
  useFlowDocument,
} from "@wieslawsoltes/richtextweb/react";
import { fromMarkdown } from "@wieslawsoltes/richtextweb/formats";

export function ArticleEditor() {
  const document = useFlowDocument(() => fromMarkdown("# Start writing"));
  return (
    <RichTextEditor
      document={document}
      zoom={1}
      viewMode="page"
      onDocumentChange={(next) => console.log(next.ToJSON())}
      style={{ height: "80vh" }}
    />
  );
}
```

React 18/19 compatibility, ref access, revision hooks, read-only state and selection callbacks are provided. The model is mutable; use `useDocumentRevision` or `useFlowDocument` to subscribe to mutations rather than relying on changed object identity.

## MVVM and desktop migration

`ObservableObject`, `RelayCommand`, `AsyncRelayCommand`, `Binding`, and `BindingMode` provide observable properties, commands and two-way bindings. Attach a binding directly to the control's `Document` property:

```ts
import {
  FlowDocument,
  Paragraph,
  Run,
  registerRichTextWeb,
  ObservableObject,
  Binding,
  BindingMode,
  RelayCommand,
} from "@wieslawsoltes/richtextweb";

registerRichTextWeb();
const editor = document.createElement("rich-text-box");
document.body.append(editor);
const viewModel = new ObservableObject({
  Document: new FlowDocument(new Paragraph(new Run("MVVM document"))),
});
const binding = new Binding({
  Source: viewModel,
  Path: "Document",
  Mode: BindingMode.TwoWay,
}).Attach(editor, "Document");

const bold = new RelayCommand(() => editor.Execute("ToggleBold"));
editor.Engine.Select(0, 4);
bold.Execute();
// On view teardown: binding.Dispose(); bold.Dispose(); viewModel.Dispose();
```

Bindings support nested observable paths, converters, one-way/two-way modes and disposal. `BindCommand` connects button events and disabled state to `ICommand`; `AsyncRelayCommand` adds cancellation and running/error state. The document model remains shared, so editing updates subscribers without replacing its identity.

The JSON message bridge exposes document loading, editing, selection, formatting, commands, history and revision-checked replacement. [Native integration sources](adapters/dotnet/README.md) include a standalone .NET 8 shared client project, framework helpers and a ready-to-host editor page:

| Host     | Supplied integration                                    | Application dependency                                |
| -------- | ------------------------------------------------------- | ----------------------------------------------------- |
| WPF      | `WpfRichTextHost.ConnectAsync`, WebView2 transport      | WPF and the WebView2 SDK/runtime                      |
| WinUI 3  | `WinUiRichTextHost.ConnectAsync`, WebView2 transport    | Windows App SDK and WebView2 runtime                  |
| Avalonia | `AvaloniaRichTextHost.Connect`, NativeWebView transport | A compatible Avalonia NativeWebView component/runtime |

`RichTextDocumentClient` provides asynchronous editing commands, request correlation, timeouts, cancellation and `INotifyPropertyChanged` notifications for revision, undo/redo state and optional document snapshots. All hosts execute the JavaScript engine inside their WebView. Version 0.2 provides compiled shared/WPF/Avalonia projects, executable C# protocol checks against the real Node engine, and a Windows WPF/WebView2 smoke workflow. Native runtime results and artifacts are reported by CI; WinUI/Avalonia UI, physical input and assistive technology need target-specific qualification.

See [complete integration examples](docs/INTEGRATION.md) for React refs/hooks, bridge setup, transport ownership, threading and lifecycle cleanup. The [native host guide](adapters/dotnet/README.md) explains asset packaging, UI-thread requirements and trusted-document navigation.

## Import, export, and PDF operations

```ts
import {
  fromHTML,
  toHTML,
  fromMarkdown,
  toMarkdown,
  fromXAML,
  toXAML,
  fromRTF,
  toRTF,
  fromDOCX,
  toDOCX,
  toPDF,
  PDFEditor,
} from "@wieslawsoltes/richtextweb/formats";

const document = fromMarkdown("# Report\n\nWritten once, shared widely.");
const docxBytes = await toDOCX(document);
const imported = await fromDOCX(docxBytes);
const pdfBytes = await toPDF(document, { title: "Report", pageNumbers: true });

const pdf = await PDFEditor.Load(pdfBytes);
await pdf.AddText(0, "Reviewed", { x: 50, y: 50, fontSize: 12 });
pdf.RotatePage(0, 90);
const editedPdf = await pdf.Save();
```

HTML uses an inert parser and an allowlist for content, styles, and URLs. XAML supports the implemented flow-document data schema without executing markup extensions or object constructors. DOCX produces and reads real Open XML ZIP packages. Markdown uses GFM parsing. JSON preserves the full engine model; other serializers preserve their documented subsets.

PDF output contains selectable text and supports pagination, tables, images, and supplied fonts. The PDF editor adds text/images/highlights and reorganizes pages. **Visual covers are not secure redaction** and do not remove underlying text. It does not reconstruct arbitrary existing PDF text into editable flow paragraphs. See [format support](docs/FORMATS.md) for layout and conversion boundaries.

## Package entry points

| Import                               | Content                                                         |
| ------------------------------------ | --------------------------------------------------------------- |
| `@wieslawsoltes/richtextweb`         | Combined public API, excluding the React adapter                |
| `@wieslawsoltes/richtextweb/core`    | Document model, positions, editing engine, history, annotations |
| `@wieslawsoltes/richtextweb/web`     | Editable web component and document viewers                     |
| `@wieslawsoltes/richtextweb/formats` | JSON/text/HTML/Markdown/XAML/RTF/DOCX/PDF tools                 |
| `@wieslawsoltes/richtextweb/mvvm`    | Observables, commands, bindings                                 |
| `@wieslawsoltes/richtextweb/react`   | React component, hooks, typed props                             |
| `@wieslawsoltes/richtextweb/bridge`  | Validated desktop WebView message protocol                      |

All entry points ship ESM, CommonJS, source maps, and TypeScript declarations. The standalone browser bundle includes runtime dependencies. Headless imports do not register custom elements or require a browser.

## Develop and verify

```sh
npm ci
npm run check         # build, model/engine/formats/integration tests, demo, tarball consumers
npx playwright install --with-deps chromium
npm run test:browser  # real browser editor, sample, and React checks
npm run benchmark    # observations, not performance guarantees
npm run dev          # sample at http://localhost:4173
```

`npm run build` emits `dist/`; `npm run build:demo` emits the static GitHub Pages site in `site/`. Runtime tests use `node:test`; browser checks use Playwright. Package tests install the actual tarball into an isolated consumer and verify all public ESM/CommonJS/TypeScript entry points and the standalone bundle.

## Releases and publishing

On `main`, CI verifies Node 22 and 24, browser behavior, and installed package consumers. A successful build deploys the sample to GitHub Pages and creates a versioned GitHub release when `package.json` contains a new version. Releases include the npm tarball, standalone browser library, source archive, sample archive, and SHA-256 checksums.

The npm workflow downloads the immutable GitHub release tarball, verifies its checksum and installed consumers, publishes it with provenance using `NPM_TOKEN` or configured trusted publishing, and verifies the public registry's bytes. Existing versions with different bytes are rejected. `workflow_dispatch` can retry publication of an existing release. Increment the package version and lockfile together for a new release; never replace an existing release's assets.

## Documentation

- [Document model and positions](docs/MODEL.md)
- [Editing commands, history, annotations](docs/ENGINE.md)
- [Browser controls and rendering](docs/CONTROL.md)
- [Format support and fidelity](docs/FORMATS.md)
- [React, MVVM, desktop bridge](docs/INTEGRATION.md)
- [Compatibility matrix](docs/COMPATIBILITY.md)
- [Verification and performance](docs/VERIFICATION.md)

MIT licensed. This is an independent implementation; it does not contain the proprietary Word engine. Public WPF document concepts were checked against Microsoft's [Flow Document overview](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/advanced/flow-document-overview) and [RichTextBox overview](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/controls/richtextbox). These references describe the migration target, not a claim that every feature is implemented.

## Advanced editing and document generation

The standalone `RichTextToolbar` provides formatting, table and image tools, fields, notes, headers/footers, comments and tracked-change review. It binds to an existing `RichTextBox` and uses that control's engine, selection, history and read-only state. The sample's Home and Advanced tools tabs use this component.

```ts
import { DocumentFeatures } from "@wieslawsoltes/richtextweb";
const features = new DocumentFeatures(editor.Engine);
features.InsertField("MERGEFIELD", "Customer");
features.InsertNote("Footnote", "Source note");
features.InsertTableOfContents({ MaxLevel: 3 });
const mergedDocuments = features.MailMerge([
  { Customer: "Ada" },
  { Customer: "Grace" },
]);

editor.Engine.CurrentAuthor = "Editor";
editor.Engine.TrackChanges = true;
editor.Engine.InsertText("A proposed addition");
editor.Engine.RejectAllRevisions();
```

Use `FlowDocumentPageViewer.Repaginate()` to obtain measured page ranges, overflow diagnostics, headers/footers and footnote areas. Use the separate `/pdf` entry point for PDF.js text extraction, reconstructed editable flow documents and the `rich-pdf-editor` control. The PDF worker and font/CMap assets are distributed in `dist/pdf-assets`; loading them is optional for applications that only need the core editor or PDF generation.

Read [document features and toolbar APIs](docs/DOCUMENT-FEATURES.md), [page-view APIs](docs/CONTROL.md), [PDF import and editing](docs/PDF.md) and [verification](docs/VERIFICATION.md) before choosing the relevant integration surface.
