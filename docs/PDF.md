# PDF export, extraction, reflow, and editing

RichTextWeb exports flow documents as real PDF text, vector rules, and embedded images using `pdf-lib`. The PDF module is available from `@wieslawsoltes/richtextweb/formats`. It runs in browsers and Node without a DOM or a print dialog.

```ts
import { FlowDocument, Paragraph, Run } from "@wieslawsoltes/richtextweb/core";
import { toPDF, PDFEditor } from "@wieslawsoltes/richtextweb/formats";

const document = new FlowDocument(
  new Paragraph(new Run("Hello from RichTextWeb")),
);
const bytes = await toPDF(document, {
  title: "Example document",
  author: "Example author",
  pageNumbers: true,
});
```

The exporter wraps text and long words, respects explicit line and page breaks, and creates additional pages as content grows. Runs retain font size, bold, italic, foreground, text background, underline, and strikethrough. Paragraphs support left, center, and right alignment, margins, line height, and basic indentation. Font-family names map to the built-in Helvetica, Times, or Courier families. This does not embed the named operating-system font. Images use embedded PNG/JPEG data URLs or bytes; remote URLs are rejected. Images larger than the content box scale down proportionally.

Lists retain nesting and decimal, alphabetic, and Roman numbering. Tables use equal-width columns, column spans, cell padding, fills, borders, and styled cell text. Tall rows continue on subsequent pages. The exporter rejects row spans and nested tables instead of silently presenting an incorrect table.

Flow model dimensions are CSS pixels; the exporter converts them at 96 pixels per inch. `PDFExportOptions.pageWidth`, `pageHeight`, and `margin` instead use PDF points at 72 points per inch. The default page is A4 unless the document defines a page size. `PagePadding` defines model page margins; absent padding defaults to 54 points. Page numbers require a bottom margin of at least 18 points.

## Unicode and layout boundaries

Standard PDF fonts support WinAnsi, including many Western European characters. Supply `fontBytes` containing a licensed TTF/OTF font to embed that font and export additional Unicode characters. `fontStyleBytes` accepts optional `bold`, `italic`, and `boldItalic` font files; missing styles use the regular supplied face. Custom fonts are subset to used glyphs and retain Unicode mappings for copying and extraction. Tests cover Polish diacritics with a small, licensed DejaVu Sans subset fixture. PDF overlay `AddText` also accepts `fontBytes`.

Unsupported characters throw a descriptive error by default, including characters absent from a supplied custom font. This prevents silently corrupting multilingual documents. An application can explicitly opt into `unsupportedGlyphs: 'replace'` and receive per-character warnings through `onWarning`; unsupported characters then become question marks. Automatic font fallback, qualified complex-script/bidirectional typography, multicolumn layout, full justification, floating objects, footnotes, fields, comments, bookmarks, active hyperlinks, repeated table headers, tagged PDF accessibility, PDF/A, and Word-identical pagination are outside this exporter. Use a qualified external typesetting service when those requirements apply.

The output retains selectable text for supported characters. Tests verify PDF structure, text drawing operators, pagination, images, table continuation, glyph policy, and page transformations; they do not certify document standards or every reader's rasterization. PDF viewing and import are provided by the separate optional entrypoint described below.

## Import an existing PDF into editable flow text

Version 0.2 adds genuine PDF text extraction through Mozilla PDF.js. Use the
`@wieslawsoltes/richtextweb/pdf` entrypoint for PDF import and the reusable viewer.
This keeps PDF.js and its worker out of applications that only import the core
engine or the existing export APIs.

```ts
import { extractPDF, fromPDF } from "@wieslawsoltes/richtextweb/pdf";
import { RichTextEngine } from "@wieslawsoltes/richtextweb/core";

const result = await extractPDF(existingBytes);
console.log(result.pages, result.warnings);
const engine = new RichTextEngine(result.document);
engine.Select(0, 0);
engine.InsertText("Edited document: ");

// Convenience API when only the flow document is needed.
const document = await fromPDF(existingBytes, {
  readingOrder: "layout",
  preservePageBreaks: true,
});
```

The importer extracts Unicode text through the PDF's character mappings,
recovers font families, font size, bold and italic metadata, groups positioned
text into lines, and reconstructs paragraphs. Spatial reading order uses
whitespace segmentation to handle common columns. `readingOrder: "content"`
instead orders reconstructed lines and their runs by source text operators.
Both modes are heuristics: a PDF typically stores drawing instructions rather
than original word-processing paragraphs, table cells, or semantic reading order.
Review the resulting flow, especially for tables, sidebars, overlapping text,
rotation, and bidirectional scripts.

Each source page becomes a flow `Section`. The original dimensions, rotation,
and crop box remain in `FlowDocument`'s `PDFSourcePages` property. Paragraphs and
runs retain `PDFGeometry`, including page index, displayed bounding box in PDF
points, and each run's original PDF transform. These properties preserve source
geometry for inspection and correspondence; the editable flow lays out its text
anew. The first page's displayed size becomes the flow page size. Mixed source
page sizes remain in metadata and are not silently presented as identical reflow
pagination.

`extractPDF` returns `{ document, pages, warnings, metadata }`. Each page includes
positioned lines and runs, original and displayed page size, rotation, crop box,
and extracted plain text. `fromPDF` returns just the document. Import options
include `password`, `readingOrder`, `preservePageBreaks`, `maxPages` (default 500),
`maxTextItems` (default 200,000), `signal`, and `onWarning`. Exceeding a configured
limit rejects instead of returning a silently truncated document. Caller-owned
byte arrays are copied before passing to the worker, so their buffers remain
usable after import.

**Reflow creates a reconstructed document.** Editing it and exporting creates a
new PDF; it does not rewrite individual text operators in the source PDF.
Images, vector art, forms, annotations, tagged-PDF semantics, and original page
composition remain in the source. Image-only/scanned pages receive an explicit
warning and an empty flow section; OCR is not supplied. Existing embedded fonts
are used to decode source text, but are not automatically transplanted into the
new PDF. Supply appropriate licensed `fontBytes` to `toPDF` when the reflow uses
characters outside the standard PDF font repertoire.

Independent-import tests use a PDF generated with ReportLab rather than this
package's exporter. That fixture includes out-of-order drawing instructions,
two columns, styled and accented text, a rotated Unicode page, and a page
containing only graphics. Tests edit the reconstructed text through the shared
engine, export it with an embedded font, and parse the resulting PDF again.

## Reusable PDF editor control

`PDFEditorControl` is the framework-independent `<rich-pdf-editor>` web component.
It renders actual PDF pages onto a canvas and adds a selectable text layer.
Its toolbar provides file opening, PDF download, page navigation, zoom, search,
text/image/rectangle/highlight/cover overlays, page rotation, page reordering,
deletion, blank-page insertion, import of pages from other PDFs, and undo/redo.
Pointer tools convert screen positions through the current page viewport, so
zoom and page rotation use the source PDF coordinate system.

The **Edit as flow** action opens a real `RichTextBox` inside the control, backed
by the shared document engine. Text can be edited normally and downloaded as a
new reflowed PDF. The original PDF view remains available, and its page/overlay
edits are separate from edits to the reconstructed flow.

```ts
import { configurePDF, PDFEditorControl } from "@wieslawsoltes/richtextweb/pdf";

configurePDF({
  workerSrc: "/pdf-assets/pdf.worker.mjs",
  cMapUrl: "/pdf-assets/cmaps/",
  standardFontDataUrl: "/pdf-assets/standard_fonts/",
  wasmUrl: "/pdf-assets/wasm/",
  iccUrl: "/pdf-assets/iccs/",
});

const editor = new PDFEditorControl();
document.querySelector("#host").append(editor);
await editor.Load(existingBytes);
editor.addEventListener("flowdocumentimport", (event) => {
  console.log(event.detail.document, event.detail.warnings);
});
editor.ReflowExportOptions = { fontBytes: licensedFontBytes };
```

Copy `legacy/build/pdf.worker.mjs` and the `cmaps`, `standard_fonts`, `wasm`, and
`iccs` directories from the installed `pdfjs-dist` package. Serve JavaScript
modules using a JavaScript MIME type and `.wasm` as `application/wasm`. Worker
and support assets must match the installed PDF.js version. `configurePDFWorker`
is a convenience API when only the worker URL needs configuration. The shipped
sample copies these assets and loads `richtextweb.pdf.js` only when the PDF
workspace is opened. No hosted third-party viewer is required. The optional
entrypoint supports ESM; use `await import("@wieslawsoltes/richtextweb/pdf")`
from CommonJS applications because PDF.js itself uses ESM initialization.

| Control API                                                           | Behavior                                                                                        |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `Load(bytes, importOptions?)`                                         | Opens an unencrypted PDF for viewing and editing                                                |
| `Engine`                                                              | Exposes the underlying `PDFEditor` for advanced consumers                                       |
| `PageCount`, `PageIndex`, `Zoom`, `FitWidth()`                        | Navigates and sizes the view                                                                    |
| `Tool`, `IsReadOnly`                                                  | Sets the pointer tool and UI editing state                                                      |
| `Save()`                                                              | Returns the source PDF including page and overlay edits                                         |
| `AddText`, `AddImage`, `Highlight`, `DrawRectangle`, `CoverRegion`    | Adds history-aware overlays using the same arguments as `PDFEditor`                             |
| `RotatePage`, `ReorderPages`, `DeletePages`, `AddPage`, `InsertPages` | Organizes pages with undo support                                                               |
| `CanUndo`, `CanRedo`, `Undo()`, `Redo()`                              | Manages up to 20 snapshots of PDF edits                                                         |
| `Find(query, {caseSensitive?}?)`                                      | Searches reconstructed text lines across pages; boxes highlight the containing line             |
| `ImportToFlowDocument(options?)`                                      | Reconstructs text and opens the internal rich text editor                                       |
| `FlowDocument`, `ViewMode`                                            | Accesses the derived document and switches between `pdf` and `flow` views                       |
| `ExportReflow(options?)`                                              | Creates a new PDF from the edited flow                                                          |
| `ReflowExportOptions`                                                 | Default export/font options used by `ExportReflow` and its download button                      |
| `Refresh()`                                                           | Renders externally changed `Engine` state; direct engine mutations do not enter control history |
| `Dispose()`                                                           | Releases the PDF worker/document and editing resources                                          |

The control emits `pdfload`, `pdfchange`, `pagechange`, `pagerender`, `pdferror`,
`flowdocumentimport`, and `flowdocumentchange` events. Registration is idempotent
through `registerPDFEditor`; the optional entrypoint registers the element when
a browser registry is available. Imports are safe during server rendering.
The `theme="dark"` attribute changes the editing workspace while preserving the
PDF page's own colors. Set the host's height in CSS for a resizable embedded view.

Browser tests exercise file opening, real canvas ink and text selection,
search, pointer overlays, undo/redo, page operations, separate core/PDF bundles,
native flow text input, and downloading/reparsing a Unicode reflowed PDF.

## Editing an existing PDF

`PDFEditor` adds text, image, and drawing overlays to existing pages, rotates pages, reorders pages, deletes pages, appends blank pages, and imports pages from another PDF. Load and save are asynchronous. Pages use zero-based indices; drawing positions use points measured from the bottom-left corner of the unrotated PDF page. Rotation changes page presentation and does not transform the coordinates supplied to drawing methods.

```ts
const editor = await PDFEditor.Load(existingBytes);
await editor.AddText(0, "Reviewed", {
  x: 48,
  y: 48,
  fontSize: 14,
  bold: true,
  color: "#166534",
});
editor.Highlight(0, { x: 48, y: 96, width: 180, height: 18 });
editor.RotatePage(0, 90);
const modifiedBytes = await editor.Save();
```

| API                                             | Effect                                                                                 |
| ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| `PDFEditor.Create()`                            | Creates an empty editor; add a page before saving                                      |
| `PDFEditor.Load(bytes)`                         | Opens an existing PDF; encrypted PDFs are rejected by the parser                       |
| `PageCount`, `GetPages()`                       | Reports page count, dimensions, and rotation                                           |
| `AddText(index, text, options)`                 | Draws additional selectable text with built-in fonts                                   |
| `AddImage(index, source, options)`              | Embeds a PNG/JPEG image overlay; preserves aspect ratio when one dimension is supplied |
| `DrawRectangle(index, options)`                 | Draws a rectangle with fill, optional border, and opacity                              |
| `Highlight(index, region)`                      | Draws a translucent yellow rectangle by default                                        |
| `CoverRegion(index, region)`                    | Draws an opaque visual covering; original content remains                              |
| `RotatePage(index, degrees)`                    | Sets absolute rotation in multiples of 90 degrees                                      |
| `ReorderPages(indices)`                         | Reorders a permutation containing every page exactly once                              |
| `DeletePages(indices)`                          | Deletes selected pages while retaining at least one page                               |
| `AddPage(width?, height?)`                      | Appends a blank page and returns its index                                             |
| `InsertPages(bytes, indices?, insertionIndex?)` | Copies selected pages from another PDF; defaults to appending all source pages         |
| `Save()`                                        | Serializes the modified PDF to `Uint8Array`                                            |

**CoverRegion is not redaction.** The original content can still be extracted, searched, copied, or recovered. Do not use it to remove secrets. True content-removing redaction is deliberately absent. Original text can be rewritten through the source-text APIs below; overlay operations continue to preserve covered content. The optional importer provides a separate reconstructed flow for semantic text editing and reflow. Digital signatures are not preserved as valid signatures after modification. Interactive form manipulation and PDF-native annotations are not exposed by this wrapper; highlights are drawing overlays.

## Editing original PDF text

The source editor rewrites actual text-showing operators and saves them back into
PDF content streams. It resolves existing font resources and reuses their encoded
glyphs. This is distinct from adding overlays or reconstructing a FlowDocument.
The reusable `PDFEditorControl` exposes **Original text**, a source-text picker,
replacement/removal controls, and **Replace source matches**. Double-clicking a
visible text line selects the containing source operator. Changes participate in
the control's undo/redo history and are immediately re-rendered and searchable.
The reconstructed flow view now includes the reusable `RichTextToolbar` too.

```ts
const editor = await PDFEditor.Load(originalBytes);
const inspection = await editor.GetTextOperators(0);
const selected = inspection.operators.find((item) => item.text === "Draft")!;
await editor.ReplaceTextOperator(0, selected.id, "Approved", {
  expectedText: "Draft",
  preserveAdvance: true,
});
const result = await editor.ReplaceSourceText("2025", "2026", {
  caseSensitive: true,
  all: true,
});
const modifiedOriginal = await editor.Save();
```

The same methods are available on `PDFEditorControl`. `InspectSourceText()`
populates its current-page picker; `SelectTextOperator(id)` selects an inspected
operator; `SelectedTextOperator` exposes that selection. `pdftextselectionchange`
and `pdftextchange` events notify application/MVVM code. Source replacement respects
`IsReadOnly`. `SourceTextReplacementOptions` configures the built-in tools.

| API or option                                        | Behavior                                                                                                                                                                                     |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GetTextOperators(pageIndex?)`                       | Returns decoded operators, font/size, approximate bounds, baseline transforms, editability and diagnostics. Omitting the page inspects every page.                                           |
| `ReplaceTextOperator(pageIndex, id, text, options?)` | Replaces one original text-showing operation. The opaque ID includes a source fingerprint; stale IDs reject. Empty replacement removes its visible glyphs.                                   |
| `ReplaceSourceText(query, replacement, options?)`    | Replaces literal matches within each source text-showing operation. Text fragments inside one `TJ` array are searched together. Returns occurrence/operator counts and affected pages.       |
| `preserveAdvance`                                    | Defaults to true: compensates the replacement's final advance so subsequent text operators keep their existing positions. False lets subsequent text advance naturally from the replacement. |
| `fontBytes` / `standardFont`                         | Installs a replacement font in the correct page/Form resource scope, then restores the previous font. Use font bytes when an original embedded subset lacks the new characters.              |
| `expectedText`                                       | Rejects if the operator's decoded source text differs from the expected value.                                                                                                               |
| `pageIndices`, `caseSensitive`, `all`                | Restrict literal replacement; default is all pages, case-insensitive matching, and all occurrences.                                                                                          |
| `allowPartial`                                       | Default false: whole-document replacement rejects when source text cannot be fully inspected. Explicit true skips unsupported sections.                                                      |

The parser handles `Tj`, `TJ`, single-quote and double-quote text operators;
literal/hex strings, escapes and comments; text/graphics matrices and spacing;
multiple page content streams; nested Form XObjects; standard simple encodings,
Encoding Differences, embedded ToUnicode maps, and horizontal Identity-H CID
fonts. A shared Form invocation is cloned only where edited, preserving other
occurrences. Replacement glyphs and every planned edit are checked before the
new document is committed. Resource/encoding failure leaves the original PDF
unchanged. Replaced content streams that are no longer reachable are removed.

Preserving the final advance does not fit a long replacement into the old word's
bounds or reflow nearby objects. Replacement text uses its natural glyph widths
and the current spacing; original internal `TJ` kerning is regenerated for the
changed operation. The default can therefore overlap nearby text when a longer
replacement extends past the original area. Source text is not a semantic Word
paragraph model, and text split across separate operators is not matched as one
string. Use the flow importer when semantic reflow is the desired result.

Source editing currently reports unsupported vertical/custom composite encodings,
inherited ToUnicode CMaps, Type3 glyph programs, inline-image content streams and
ActualText marked-content groups. It does not edit annotation appearance streams,
XFA, image pixels, or outlined text. Bounds are conservative font-size rectangles,
not exact glyph outlines. The implementation is verified against independently
created PDFs and explicit operator/resource fixtures; this does not establish
support for every PDF producer or font program. These APIs are content editing,
not certified secure redaction: duplicated text, metadata, attachments and other
representations can still contain the original information.

Implementation references: [ISO 32000-1:2008, sections 7.3 and 9](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf)
and the [pdf-lib low-level document context](https://pdf-lib.js.org/docs/api/classes/pdfdocument#context).

## Anchored stories in flow-to-PDF export

`toPDF` preserves Figure/Floater contents as independent anchored stories instead
of flattening their text into the main paragraph. Main-story offsets continue to
use one object-replacement character for each anchor. Text, images, paragraph
styles, lists and ordinary tables in the story remain vector/selectable PDF
content. Inline stories reserve line width; square wrapping narrows main-story
lines beside the box and restores their width below it. Tight wrapping supports
unrotated ellipses; rotated boxes use their enclosing bounds. TopAndBottom,
BehindText and InFrontOfText control vertical reservation and painting order.

FigureLength pixel/content/column/page units, horizontal/vertical anchors,
offsets, padding, border/background and rotation are used by the PDF exporter.
Anchored stories must fit on one export page; insufficient explicit heights and
oversized stories reject rather than silently clipping or losing text. Story
layout is measured with the selected PDF fonts, separately from browser layout.
Complex contour wrapping, multi-page anchored stories, table row spans and exact
Word pagination are not established by this export path.

Operator IDs cover the page's resolved resources and all content streams as well
as the selected operation; changing a font mapping or an earlier stream's text
state invalidates them. Source edits are serialized. Concurrent requests using
old operator IDs reject after an earlier edit commits; inspect again before
retrying. Concurrent page/overlay changes during a staged source edit are detected
and retained, while the conflicting source edit rejects. Prefer awaiting editing
operations in application code. Save and inspection wait for queued source edits.

Source inspection enforces terminal 64 MiB decoded-stream/page-resource limits
and a 200,000-text-operator limit. Decoder allocation is bounded at each filter
stage, including oversized compressed blocks; these resource errors are not
suppressed by `allowPartial`.
