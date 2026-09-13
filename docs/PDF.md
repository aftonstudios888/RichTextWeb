# PDF export and page editing

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

The output retains selectable text for supported characters. It is not a PDF viewer or a reverse PDF-to-flow importer. Tests verify PDF structure, text drawing operators, pagination, images, table continuation, glyph policy, and page transformations; they do not certify document standards or every reader's rasterization.

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

**CoverRegion is not redaction.** The original content can still be extracted, searched, copied, or recovered. Do not use it to remove secrets. True content-removing redaction is deliberately absent. Existing PDF text is not converted into editable paragraphs; editing it does not support reflow, font substitution, or arbitrary content-stream rewriting. Digital signatures are not preserved as valid signatures after modification. Interactive form manipulation and PDF-native annotations are not exposed by this wrapper; highlights are drawing overlays.
