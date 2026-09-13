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

| Format         | Import                | Export | Preservation and boundaries                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------- | --------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical JSON | Yes                   | Yes    | All serialized RichTextWeb model properties, element IDs and hierarchy. Model validation rejects invalid types, duplicate IDs and invalid child relationships. This format has no Word file compatibility claim.                                                                                                                                                                                                                                                                                                                                                          |
| Plain text     | Yes                   | Yes    | Unicode, tabs, line breaks and empty paragraphs. CRLF and CR input normalize to LF. Formatting and nontext structure are omitted; images occupy the model's object replacement character.                                                                                                                                                                                                                                                                                                                                                                                 |
| HTML           | Yes                   | Yes    | Paragraphs, headings, spans, bold, italic, underline, strike, links, safe images, sections, lists, tables, row/column spans, basic CSS text/paragraph properties, text direction and subscript/superscript. A strict inert tokenizer converts an allowlist to the flow model. Scripts, forms, frames, stylesheets, SVG/MathML subtrees and unknown active content are omitted. CSS layout, classes, selectors, arbitrary widgets and browser parser error recovery are not reproduced.                                                                                    |
| Markdown       | Yes                   | Yes    | GFM headings, emphasis, strikethrough, links, images, lists and tables. Import uses Marked followed by the same HTML sanitization boundary. Plain Markdown cannot represent all model properties; colors, dimensions, comments and page settings are omitted. Table export treats the first row as the Markdown header; merged cells flatten. Code and blockquote content import, but semantic fenced-code/blockquote identity does not round-trip.                                                                                                                       |
| XAML           | Yes                   | Yes    | Inert FlowDocument document elements and an explicit property subset, including common collection property wrappers. No WPF runtime, resources, bindings, converters, styles, templates, event handlers, object activation, `x:Class`, markup extensions, custom controls or arbitrary embedded UI is executed. DTDs/entities and markup extensions on supported properties are rejected. XAML import is a document interchange subset, not a XAML application loader.                                                                                                    |
| RTF            | Yes                   | Yes    | Paragraphs, text, Unicode (including surrogate pairs), tabs, line breaks, font families, font sizes, bold, italic, underline, strike, subscript/superscript, alignment, foreground and highlight colors. Structural lists/tables flatten into their paragraph text. Pictures export as alternative text; embedded objects, fields, resources, headers/footers and unsupported destinations are omitted. Color conversion supports hexadecimal colors and common names.                                                                                                    |
| DOCX           | Yes                   | Yes    | Genuine OPC/WordprocessingML with styled text, tables and cell merges, lists, images, multiple sections, default/first/even headers and footers, footnotes/endnotes, fields and native table-of-contents fields, comments/replies/resolution, bookmarks and inserted/deleted text revisions. Selected unsupported Office drawings and their inert dependency parts survive round trips as opaque data. Exact pagination, all styles, native shape editing, property/topology revision history and lossless arbitrary document fidelity remain outside the implementation. |
| PDF            | Page document editing | Yes    | Real text/vector/image PDF export; separate page/overlay editor for existing PDFs. See [PDF.md](PDF.md) for supported layout and explicit boundaries. PDF import does not infer an editable FlowDocument or reconstruct arbitrary source paragraphs.                                                                                                                                                                                                                                                                                                                      |

## HTML and XAML boundary

The serializer never copies arbitrary source attributes or CSS into its output. Text and attribute values are escaped. Link protocols are restricted; images accept safe URLs or raster PNG/JPEG/GIF/WebP data URLs. SVG data URLs and scriptable URLs are rejected. Native DOM rendering should use the model renderer or `toHTML` output, rather than the original untrusted source.

HTML import collapses normal HTML whitespace and preserves `pre`/`code` whitespace. Relative font sizes resolve against a 16 px baseline during import rather than a full cascading stylesheet context. Style properties outside the supported allowlist are dropped. Exported images and links may refer to permitted remote resources; displaying such a document can therefore make the normal browser requests for those URLs. Import itself does not fetch linked resources.

The XAML property subset covers font/text properties, paragraph alignment, margin/padding/line height, page width/height/padding, columns, heading level, page breaks, keep-together/keep-with-next, hyperlinks, images, list marker/start, spans and text direction. Unsupported attributes and elements are omitted. `InlineUIContainer` and `BlockUIContainer` can carry the model's supported image content; arbitrary platform controls cannot migrate through a serialized document.

## DOCX package handling

The importer locates the primary document through the package relationship when present and resolves XML namespace prefixes by their declared namespace URIs. It resolves embedded image and hyperlink relationships without executing content, expanding fields or fetching external resources. External image relationships are not fetched. Export embeds PNG/JPEG/GIF images supplied as data URLs; remote URLs and unsupported image encodings become alternative text. Embedded images import as raster data URLs.

The exporter creates `[Content_Types].xml`, package relationships, the main document, styles, numbering when needed, document relationships and image parts. Numbered-list IDs and level definitions are material package structures. Cell merges use `w:gridSpan` and `w:vMerge`; they are reconstructed into `ColumnSpan` and `RowSpan` on import.

Formatting conversions use CSS pixels in the model: 1 px = 15 twips, 1 px = 0.75 pt, and image drawing extents use 9,525 EMU per CSS pixel. Word can lay out the resulting file differently because its font metrics, pagination and text shaping differ from the browser.

Import limits are 64 MiB compressed input, 10,000 ZIP entries, 32 MiB per expanded part and 128 MiB of expanded data read. Expanded content streams are stopped when limits are exceeded. Markup and RTF inputs are capped at 32 MiB and nesting is capped at 256 levels. These are defensive resource limits, not a claim of a complete hostile-document sandbox or a production security audit.

## Advanced DOCX model contract

Version 0.2 adds native package structures for document stories and review metadata. Header/footer and note contents use ordinary serialized block nodes, so the same formatting engine can edit them before saving:

```ts
const headerBlocks = [new Paragraph(new Run("Project report")).ToJSON()];
document.SetValue("Headers", headerBlocks);
document.SetValue("Footers", footerBlocks);
document.SetValue("FirstPageHeader", firstPageBlocks);
document.SetValue("EvenPageFooter", evenPageBlocks);
document.SetValue("Footnotes", [
  { Id: "note-1", Blocks: [new Paragraph(new Run("A note.")).ToJSON()] },
]);

const reference = new Run("1");
reference.SetValue("NoteReference", { Kind: "Footnote", Id: "note-1" });
const field = new Span(new Run("1"));
field.SetValue("Field", { Type: "PAGE", Instruction: "PAGE" });
```

`Headers`, `Footers`, `FirstPageHeader`, `FirstPageFooter`, `EvenPageHeader` and `EvenPageFooter` are arrays of `DocumentNode`. They may also appear on a `Section` for section-specific stories. Each story gets its own relationship part, so links and embedded images resolve in the correct scope. `Footnotes` and `Endnotes` contain `{ Id, Blocks }`; note reference IDs are mapped to valid native numeric IDs on export and remain consistent with the imported note collection.

`Section` page settings preserve `PageWidth`, `PageHeight`, `PageOrientation`, `PagePadding`, `HeaderDistance`, `FooterDistance`, `Gutter`, `ColumnCount`, `ColumnGap`, optional `ColumnWidths`, `PageNumberStart` and `SectionBreak`. Supported break values follow WordprocessingML names: `nextPage`, `continuous`, `evenPage` and `oddPage`. Section boundaries do not add synthetic paragraphs to the model's plain text.

A field is a `Span` with `props.Field = { Instruction, Type, Dirty? }` and ordinary inline children containing its cached result. Import accepts native simple fields and begin/instruction/separate/end fields. Export emits supported instructions including `PAGE`, `NUMPAGES`, `DATE`, `TIME`, `REF`, `PAGEREF`, `MERGEFIELD`, `TOC`, `SEQ`, `NOTEREF`, document metadata and section page fields. A `Section` with `TableOfContents` properties exports as a native field spanning its cached entry paragraphs; it imports back as a TOC section. Conversion preserves field instructions and results; call `DocumentFeatures.UpdateFields` to recompute supported results from explicit context. The converter never evaluates external data or executable field instructions. Unsupported instructions such as DDE export only their cached visible result.

Review information uses `FlowDocument.props.Annotations` with UTF-16 plain-text offsets:

| Kind        | Range and metadata                                                                                 | Native DOCX representation                                                                                                                                                        |
| ----------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Comment`   | `Start`, `End`; `Data.Text`, optional rich `Blocks`, `Author`, `CreatedAt`, `Resolved`, `ParentId` | Comment ranges/references, comments story and `commentsExtended` for resolution/reply relationships. Native point comments and replies inheriting the parent range are supported. |
| `Bookmark`  | `Start`, `End`; `Data.Name`                                                                        | `bookmarkStart` and `bookmarkEnd`.                                                                                                                                                |
| `Insertion` | Visible inserted text in `Start`–`End`; `Data.Author`, `CreatedAt`                                 | Native `w:ins` wrappers. Adjacent run fragments with the same native revision ID merge on import.                                                                                 |
| `Deletion`  | Collapsed `Start = End`; `Data.Text`, optional rich block-fragment `Nodes`, author/date            | Native `w:del`/`w:delText`; deleted text remains outside the visible body and can be rejected through the engine.                                                                 |

The comment extension uses paragraph IDs to associate resolved state and replies with their comments, following the [Open XML CommentEx schema](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.office2013.word.commentex?view=openxml-3.0.1). This does not implement every modern comment identity, mention, task-assignment or collaboration-service field.

Text insertion/deletion revisions and rich deleted inline content are supported. Paragraph-mark, table-row, move and formatting/property revisions are not fully reconstructed. Complex structural deletion restoration may therefore preserve text and inline formatting without recreating every original native document topology change.

## Opaque Office drawing preservation

Unsupported Office drawings and Office Math may carry `DocxOpaqueXML` plus referenced relationship metadata on an inert model span. When those nodes are imported, only the referenced XML/raster dependencies under the original chart, diagram, drawing, media and theme directories are retained in `DocxPreservedParts`. Export places the parts under `rtw-preserved/`, rewrites their relationships and preserves them on subsequent round trips. The browser does not execute or edit the stored Office XML, and these spans do not claim a faithful browser preview.

The retained set excludes macros, ActiveX, OLE, embedded executable/office attachments and arbitrary package parts. Relationship filtering keeps supported internal drawing dependencies and safe explicit hyperlinks. DTD/entity-bearing XML is rejected. Unsupported embedded chart workbooks are omitted, so native chart data editing can remain incomplete even when the cached chart survives. Regenerated main-document/style/numbering parts are not byte-identical to their source, and unknown drawing structures, unsupported inline positions or later destructive edits may still lose content. Save the original file separately whenever exact archival preservation is required.

## Verification

Tests cover exporter/importer round trips and independently constructed DOCX packages. They inspect actual ZIP parts, field instructions, note/story relationships, section boundaries, merged cells, comments/replies/resolution, tracked text and repeated opaque-chart round trips. Separate tests verify excluded active attachments, malicious HTML removal, Unicode and formatting resets. Representative baseline and advanced DOCX exports were independently loaded with python-docx, confirming headings, text, hyperlinks, vertical table merges, default/first-page headers and footer story references. PDF tests inspect independent PDF structures and graphics streams. These tests establish the documented capabilities, not exhaustive Word, WPF, PDF or RTF conformance.
