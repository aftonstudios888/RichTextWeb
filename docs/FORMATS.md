# Document formats

RichTextWeb uses `FlowDocument` as its editable source of truth. Format conversion produces a new document; editing the imported result does not maintain a live relationship with the original file. For full preservation of RichTextWeb element identities, properties, annotations and model structure, save canonical JSON with `DocumentSerializer.Serialize(document)`.

```ts
import {
  DocumentSerializer,
  fromHTML,
  toHTML,
  fromMarkdown,
  toMarkdown,
  fromText,
  toText,
  fromXAML,
  toXAML,
  fromRTF,
  toRTF,
  fromDOCX,
  toDOCX,
  toPDF,
  PDFEditor,
} from "@wieslawsoltes/richtextweb/formats";

const document = fromMarkdown("# A document\n\n**Edit me** in any adapter.");
const html = toHTML(document);
const wordBytes = await toDOCX(document);
const importedWordDocument = await fromDOCX(wordBytes);
const pdfBytes = await toPDF(document);
```

All conversions work in Node and modern browsers. Import does not require a browser DOM. `toDOCX` and `toPDF` return `Promise<Uint8Array>`; the remaining converters are synchronous. `fromDOCX` accepts `Uint8Array` or `ArrayBuffer`. The `DocumentSerializer` class exposes corresponding PascalCase static methods. Its synchronous `Serialize` and `Deserialize` methods support `json`, `text`, `html`, `markdown`, `xaml` and `rtf`.

## Capability and fidelity matrix

| Format         | Import                | Export | Preservation and boundaries                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------- | --------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical JSON | Yes                   | Yes    | All serialized RichTextWeb model properties, element IDs and hierarchy. Model validation rejects invalid types, duplicate IDs and invalid child relationships. This format has no Word file compatibility claim.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Plain text     | Yes                   | Yes    | Unicode, tabs, line breaks and empty paragraphs. CRLF and CR input normalize to LF. Formatting and nontext structure are omitted; images occupy the model's object replacement character.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| HTML           | Yes                   | Yes    | Paragraphs, headings, spans, bold, italic, underline, strike, links, safe images, sections, lists, tables, row/column spans, basic CSS text/paragraph properties, text direction and subscript/superscript. A strict inert tokenizer converts an allowlist to the flow model. Scripts, forms, frames, stylesheets, SVG/MathML subtrees and unknown active content are omitted. CSS layout, classes, selectors, arbitrary widgets and browser parser error recovery are not reproduced.                                                                                                                                                         |
| Markdown       | Yes                   | Yes    | GFM headings, emphasis, strikethrough, links, images, lists and tables. Import uses Marked followed by the same HTML sanitization boundary. Plain Markdown cannot represent all model properties; colors, dimensions, comments and page settings are omitted. Table export treats the first row as the Markdown header; merged cells flatten. Code and blockquote content import, but semantic fenced-code/blockquote identity does not round-trip.                                                                                                                                                                                            |
| XAML           | Yes                   | Yes    | Inert FlowDocument document elements and an explicit property subset, including common collection property wrappers. No WPF runtime, resources, bindings, converters, styles, templates, event handlers, object activation, `x:Class`, markup extensions, custom controls or arbitrary embedded UI is executed. DTDs/entities and markup extensions on supported properties are rejected. XAML import is a document interchange subset, not a XAML application loader.                                                                                                                                                                         |
| RTF            | Yes                   | Yes    | Paragraphs, text, Unicode (including surrogate pairs), tabs, line breaks, font families, font sizes, bold, italic, underline, strike, subscript/superscript, alignment, foreground and highlight colors. Structural lists/tables flatten into their paragraph text. Pictures export as alternative text; embedded objects, fields, resources, headers/footers and unsupported destinations are omitted. Color conversion supports hexadecimal colors and common names.                                                                                                                                                                         |
| DOCX           | Yes                   | Yes    | Genuine zipped OPC package with WordprocessingML, styled runs, headings, paragraph alignment/margins, page settings, hyperlinks, numbering, nested lists, nested tables, cell shading, horizontal/vertical cell merges and embedded raster images. Imports the main document story and visible accepted-revision text. Does not preserve all Word styles/layout rules, comments, revision history, equations, drawing shapes, charts, content-control behavior, fields, sections with different layouts, headers/footers, footnotes/endnotes, custom XML or macros. This is a practical subset converter, not a lossless Word document engine. |
| PDF            | Page document editing | Yes    | Real text/vector/image PDF export; separate page/overlay editor for existing PDFs. See [PDF.md](PDF.md) for supported layout and explicit boundaries. PDF import does not infer an editable FlowDocument or reconstruct arbitrary source paragraphs.                                                                                                                                                                                                                                                                                                                                                                                           |

## HTML and XAML boundary

The serializer never copies arbitrary source attributes or CSS into its output. Text and attribute values are escaped. Link protocols are restricted; images accept safe URLs or raster PNG/JPEG/GIF/WebP data URLs. SVG data URLs and scriptable URLs are rejected. Native DOM rendering should use the model renderer or `toHTML` output, rather than the original untrusted source.

HTML import collapses normal HTML whitespace and preserves `pre`/`code` whitespace. Relative font sizes resolve against a 16 px baseline during import rather than a full cascading stylesheet context. Style properties outside the supported allowlist are dropped. Exported images and links may refer to permitted remote resources; displaying such a document can therefore make the normal browser requests for those URLs. Import itself does not fetch linked resources.

The XAML property subset covers font/text properties, paragraph alignment, margin/padding/line height, page width/height/padding, columns, heading level, page breaks, keep-together/keep-with-next, hyperlinks, images, list marker/start, spans and text direction. Unsupported attributes and elements are omitted. `InlineUIContainer` and `BlockUIContainer` can carry the model's supported image content; arbitrary platform controls cannot migrate through a serialized document.

## DOCX package handling

The importer locates the primary document through the package relationship when present and resolves XML namespace prefixes by their declared namespace URIs. It resolves embedded image and hyperlink relationships without executing content, expanding fields or fetching external resources. External image relationships are not fetched. Export embeds PNG/JPEG/GIF images supplied as data URLs; remote URLs and unsupported image encodings become alternative text. Embedded images import as raster data URLs.

The exporter creates `[Content_Types].xml`, package relationships, the main document, styles, numbering when needed, document relationships and image parts. Numbered-list IDs and level definitions are material package structures. Cell merges use `w:gridSpan` and `w:vMerge`; they are reconstructed into `ColumnSpan` and `RowSpan` on import.

Formatting conversions use CSS pixels in the model: 1 px = 15 twips, 1 px = 0.75 pt, and image drawing extents use 9,525 EMU per CSS pixel. Word can lay out the resulting file differently because its font metrics, pagination and text shaping differ from the browser.

Import limits are 64 MiB compressed input, 10,000 ZIP entries, 32 MiB per expanded part and 128 MiB of expanded data read. Expanded content streams are stopped when limits are exceeded. Markup and RTF inputs are capped at 32 MiB and nesting is capped at 256 levels. These are defensive resource limits, not a claim of a complete hostile-document sandbox or a production security audit.

## Verification

The tests use both exporter/importer round trips and an independently constructed DOCX package, inspect ZIP parts and relationships, verify merge instructions, exercise Unicode and formatting resets, and check malicious markup removal. A representative DOCX export was also loaded independently with python-docx, verifying headings, text, hyperlinks and vertical table merges. PDF tests additionally inspect independent PDF structures and graphics streams. Conversion tests establish the documented subset; they do not establish exhaustive Microsoft Word, WPF, PDF or RTF conformance.
