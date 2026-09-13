# Browser controls

`RichTextBox` is a custom element backed by the same `FlowDocument` and `RichTextEngine` used by the headless APIs. Importing the package is safe during server-side rendering; call `registerRichTextWeb()` in the browser to register its controls.

```js
import {
  registerRichTextWeb,
  FlowDocument,
  Paragraph,
  Run,
} from "@wieslawsoltes/richtextweb";

registerRichTextWeb();
const editor = document.createElement("rich-text-box");
editor.Document = new FlowDocument(new Paragraph(new Run("Hello world")));
editor.AcceptsTab = true;
editor.ViewMode = "page";
editor.style.height = "650px";
document.body.append(editor);
editor.Focus();
editor.Select(6, 11);
editor.Execute("ToggleBold");
```

## API and integration

| API                                                               | Behavior                                                                                                                                            |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Document` / `document`                                           | Assign or read the shared `FlowDocument`. Assignment resets engine undo history and selection.                                                      |
| `Engine`                                                          | Access the reusable editing engine directly.                                                                                                        |
| `Selection`, `CaretPosition`, `Select(start, end)`, `SelectAll()` | Model selections use UTF-16 plain-text offsets. Paragraph separators count as one newline; images and embedded containers count as one U+FFFC.      |
| `Text`, `value`                                                   | Read document text or replace the document with plain text.                                                                                         |
| `IsReadOnly` / `readOnly`                                         | Disable user editing, paste, undo and mutating control commands. Programmatic document/engine changes remain possible.                              |
| `AcceptsTab` / `acceptsTab`                                       | Insert a tab on Tab. Shift+Tab moves focus out of the editor. Default false.                                                                        |
| `Zoom` / `zoom`                                                   | Browser layout zoom between 0.25 and 4; 1 means 100%.                                                                                               |
| `ViewMode` / `viewMode`                                           | `page` displays a paper-width document surface; `continuous` fills available width.                                                                 |
| `Focus()`, `ScrollToHome()`, `ScrollToEnd()`                      | Manage editor focus and scrolling.                                                                                                                  |
| `Execute(command, parameter)`                                     | Run an engine editing command, `SelectAll`, or `Print`. Cached model selection survives toolbar focus changes.                                      |
| `Undo()`, `Redo()`, `CanUndo`, `CanRedo`                          | Model history including native IME reconciliation.                                                                                                  |
| `AppendText(text)`                                                | Programmatically append text at the end of the document.                                                                                            |
| `BeginChange()`, `EndChange()`, `DeclareChangeBlock()`            | Group programmatic operations into one undo entry. Dispose the returned change block to complete it.                                                |
| `PasteHTML(html)`                                                 | Sanitize and insert an HTML fragment at the current selection as one undoable operation.                                                            |
| `Refresh()`                                                       | Explicitly render the current model. Model changes normally render automatically.                                                                   |
| `RenderStatistics`                                                | `{ Created, Reused, Updated, Removed }` counts for the last live-DOM reconciliation. Counts describe committed DOM operations, not model traversal. |
| `Print()`                                                         | Open a browser print view; call from a user gesture so the browser permits its window.                                                              |
| `Dispose()`                                                       | Release engine subscriptions permanently when discarding an editor. Ordinary removal/reinsertion remains supported without disposal.                |

Observed HTML attributes: `readonly`, `accepts-tab`, `zoom`, `view-mode`, `placeholder`, `aria-label`, and `spellcheck`. Boolean attributes follow presence semantics, with the convenience value `false` also disabling them. `theme="light"` and `theme="dark"` select palettes; the system preference is the default.

The browser control exposes DOM custom events that bubble and cross its shadow boundary:

| Event                 | `event.detail`                                                                                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `documentchange`      | `{ document, engine, revision }`                                                                                                                                                  |
| `selectionchange`     | `{ selection, start, end, text }`                                                                                                                                                 |
| `commandstatechange`  | `{ canUndo, canRedo, isReadOnly }`                                                                                                                                                |
| `linkactivate`        | `{ uri, originalEvent }`; emitted by Ctrl/Cmd-click, or ordinary click in a read-only viewer. The host decides whether to navigate.                                               |
| `compositionconflict` | `{ document, composedText, baseText }`; a programmatic text mutation occurred during IME composition. The current model is retained and the host can reconcile the composed text. |

Registered viewers are `<flow-document-reader>`, `<flow-document-scroll-viewer>`, and `<flow-document-page-viewer>`. They use the same model and renderer and start read-only. Their default modes are page, continuous, and page, respectively. They are browser presentation controls; they do not emulate WPF template parts, routed event infrastructure, or native automation peers.

`registerRichTextWeb()` also registers `<rich-text-toolbar>`, the reusable toolbar. See the toolbar API for its `Target` property and command customization.

## Measured page viewer

`FlowDocumentPageViewer` displays a finite page window with accessible Previous/Next controls. The browser fragments content into fixed-height columns, applying its actual line breaking, `KeepTogether`, `KeepWithNext`, `BreakPageBefore`, and paragraph `Widows`/`Orphans` rules. The viewer measures those fragments to report page counts and UTF-16 content ranges. PageDown/PageUp navigate while the document has focus.

```js
const viewer = document.createElement("flow-document-page-viewer");
viewer.Document = editor.Document;
viewer.Document.PageWidth = 794;
viewer.Document.PageHeight = 1123;
viewer.Document.PagePadding = 72;
viewer.style.height = "750px";
document.body.append(viewer);

const layout = await viewer.Repaginate();
console.log(layout.PageCount, layout.Pages, layout.Overflows);
viewer.GoToPage(2);
```

| Page viewer API                                                                 | Behavior                                                                                                                                               |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Repaginate(): Promise<PageLayoutResult>`                                       | Wait for fonts and a browser layout frame, then measure the visible connected viewer. Images trigger measurement again when they load.                 |
| `LayoutResult`                                                                  | Latest completed layout, or `null` before measurement. Includes `Method`, `Revision`, paper/content dimensions, `PageCount`, `Pages`, and `Overflows`. |
| `PageCount`, `PageNumber`                                                       | Measured count and current 1-based page number. Before first measurement the count is 1. Assigning an invalid `PageNumber` throws.                     |
| `CanGoToNextPage`, `CanGoToPreviousPage`                                        | Navigation availability.                                                                                                                               |
| `NextPage()`, `PreviousPage()`, `FirstPage()`, `LastPage()`, `GoToPage(number)` | Navigate and return whether the requested page exists. `Execute()` accepts these command names too.                                                    |
| `paginated` event                                                               | `event.detail.layout` contains the measured result.                                                                                                    |
| `pagechange` event                                                              | `{ pageNumber, pageCount, page }` identifies the new visible page.                                                                                     |
| `paginationerror` event                                                         | `{ error }` describes a failed automatic measurement; explicit `Repaginate()` also rejects on failure.                                                 |

Each `Pages` entry contains `PageNumber`, `StartOffset`, `EndOffset`, and `HasOverflow`. Adjacent ranges meet without losing paragraph separators. The range collection covers the document text. Overflow entries report `ElementId`, `PageNumber`, `Reason`, `Measured`, and `Available`. Oversized unsplittable objects and overflowing page stories are reported rather than counted as successful fitting layout.

The viewer renders document `Headers`/`Footers` stories, with `FirstPageHeader`/`FirstPageFooter` and `EvenPageHeader`/`EvenPageFooter` variants. `PAGE` and `NUMPAGES` fields in those stories are resolved in display copies, preserving the document's cached field values. A superscript Run with `NoteReference: { Kind: 'Footnote', Id }` selects the corresponding `{ Id, Blocks }` entry from document `Footnotes` for its page. When footnotes exist, the viewer reserves a fixed note area on every page, controlled by document `FootnoteAreaHeight` (96 CSS pixels by default), and reports note-area overflow. It does not yet compute a different note-area height for each page. Endnotes remain document stories and are not appended to the page viewer's body.

`part="page"`, `part="page-navigation"`, `part="page-header"`, `part="page-footer"`, and `part="page-footnotes"` supplement the ordinary editor parts. Measurements describe the current browser, fonts, dimensions, and loaded images. Printing remains the separate browser print view and does not promise the same page boundaries as the screen viewer.

## Editing and rendering

The control uses semantic DOM elements inside an open shadow root. Paragraphs, headings, spans, emphasis, hyperlinks, lists, images, sections and tables are rendered with DOM APIs. It never evaluates imported markup or creates arbitrary embedded controls. `part="viewport"` and `part="editor"`, plus `--rt-accent`, `--rt-ink`, `--rt-paper`, `--rt-workspace`, and `--rt-border`, allow host styling.

Rendering reconciles live elements by stable document IDs. Unchanged paragraphs, spans and text nodes retain identity; changes update only differing attributes, text, child ordering and membership. Detached templates are reused to reduce repeated DOM allocation. This avoids replacing the editing surface or rebuilding unaffected live subtrees. The renderer still traverses the document to derive selection offsets and compare the desired structure, and retains the whole document DOM; it is not a virtualized renderer.

Ordinary `beforeinput` operations edit the model directly: typing, paragraph/line breaks, deletion, formatting, paste, and history. Native caret selection is synchronized with model offsets. IME composition stays in the live browser editing surface until commit; the resulting text change is then applied as one undoable model edit, preserving unaffected structure and metadata. Browser spell-check or other unhandled native inputs import the safe DOM as an undoable model replacement. Clipboard HTML passes through the serializer's safe allowlist. Ctrl/Cmd+B/I/U and undo/redo shortcuts work without a framework. Copy supplies both plain text and sanitized HTML. Text/HTML drag-and-drop inserts at the drop caret; internal drags copy rather than move.

The editable region exposes `role="textbox"`, `aria-multiline`, `aria-readonly`, a label, visible keyboard focus, native text selection and native keyboard editing. Accessibility and input behavior depend partly on the browser; platform screen-reader and physical mobile/IME qualification remain required for production applications.

## Layout and fidelity boundaries

The browser supplies shaping, bidirectional text, line breaking and layout. The editable `RichTextBox` and general reader use a paper-sized surface that grows with content; the separate `FlowDocumentPageViewer` supplies measured finite screen pages. Printing uses browser pagination. This release does not provide deterministic Word-compatible layout, an independent glyph shaper, virtualized page rendering, floating object wrapping, or a native WPF/WinUI/Avalonia renderer. Keep and widow/orphan rules follow browser CSS fragmentation behavior; impossible constraints can be relaxed by the browser. Oversized objects and story regions expose explicit overflow diagnostics. Document columns are displayed as page columns by the page viewer; multiple newspaper-style columns inside each page are not yet supported there.

Normal edits and committed IME text changes preserve unaffected model structure through the engine. Other native fallback imports fresh content nodes while retaining document-level properties; application-specific per-node metadata that HTML cannot express is not guaranteed to survive that fallback. Applications that mutate text during composition receive a `compositionconflict` event containing the composed text instead of losing their newer model content. Embedded UI containers display an image or accessible label, not arbitrary native controls. Imported images support HTTP(S), blob URLs and raster data URLs; SVG data URLs are rejected. Use an application image upload/resolution policy for durable document assets.

Large-document traversal cost and retained DOM memory scale with document size. Benchmarks and browser checks describe the tested workload; the control does not claim every Word document feature or WPF control API.
