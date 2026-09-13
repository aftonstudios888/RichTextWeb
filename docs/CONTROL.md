# Browser controls

`RichTextBox` and `RichTextPageEditor` are custom elements backed by the same `FlowDocument` and `RichTextEngine` used by the headless APIs. Importing the package is safe during server-side rendering; call `registerRichTextWeb()` in the browser to register its controls.

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

| API                                                               | Behavior                                                                                                                                                               |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Document` / `document`                                           | Assign or read the shared `FlowDocument`. Assignment resets engine undo history and selection.                                                                         |
| `Engine`                                                          | Access the reusable editing engine directly.                                                                                                                           |
| `Selection`, `CaretPosition`, `Select(start, end)`, `SelectAll()` | Model selections use UTF-16 plain-text offsets. Paragraph separators count as one newline; images, embedded containers, and floating text stories count as one U+FFFC. |
| `Text`, `value`                                                   | Read document text or replace the document with plain text.                                                                                                            |
| `IsReadOnly` / `readOnly`                                         | Disable user editing, paste, undo and mutating control commands. Programmatic document/engine changes remain possible.                                                 |
| `AcceptsTab` / `acceptsTab`                                       | Insert a tab on Tab. Shift+Tab moves focus out of the editor. Default false.                                                                                           |
| `Zoom` / `zoom`                                                   | Browser layout zoom between 0.25 and 4; 1 means 100%.                                                                                                                  |
| `ViewMode` / `viewMode`                                           | `page` displays a paper-width document surface; `continuous` fills available width.                                                                                    |
| `Focus()`, `ScrollToHome()`, `ScrollToEnd()`                      | Manage editor focus and scrolling.                                                                                                                                     |
| `Execute(command, parameter)`                                     | Run an engine editing command, `SelectAll`, or `Print`. Cached model selection survives toolbar focus changes.                                                         |
| `Undo()`, `Redo()`, `CanUndo`, `CanRedo`                          | Model history including native IME reconciliation.                                                                                                                     |
| `AppendText(text)`                                                | Programmatically append text at the end of the document.                                                                                                               |
| `BeginChange()`, `EndChange()`, `DeclareChangeBlock()`            | Group programmatic operations into one undo entry. Dispose the returned change block to complete it.                                                                   |
| `PasteHTML(html)`                                                 | Sanitize and insert an HTML fragment at the current selection as one undoable operation.                                                                               |
| `Refresh()`                                                       | Explicitly render the current model. Model changes normally render automatically.                                                                                      |
| `RenderStatistics`                                                | `{ Created, Reused, Updated, Removed }` counts for the last live-DOM reconciliation. Counts describe committed DOM operations, not model traversal.                    |
| `Print()`                                                         | Open a browser print view; call from a user gesture so the browser permits its window.                                                                                 |
| `Dispose()`                                                       | Release engine subscriptions permanently when discarding an editor. Ordinary removal/reinsertion remains supported without disposal.                                   |

Observed HTML attributes: `readonly`, `accepts-tab`, `zoom`, `view-mode`, `virtualize`, `placeholder`, `aria-label`, and `spellcheck`. Boolean attributes follow presence semantics, with the convenience value `false` also disabling them. `theme="light"` and `theme="dark"` select palettes; the system preference is the default.

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

Rendering reconciles live elements by stable document IDs. Unchanged paragraphs, spans and text nodes retain identity; changes update only differing attributes, text, child ordering and membership. Detached templates are reused to reduce repeated DOM allocation. This avoids replacing the editing surface or rebuilding unaffected live subtrees. The renderer reads effective style, trigger, coercion, and current values for layout while portable serialization retains local base values. Optional continuous-view virtualization retains only the viewport window, nearby blocks, and the current selected range. JSON/index traversal still scales with document size.

Ordinary `beforeinput` operations edit the model directly: typing, paragraph/line breaks, deletion, formatting, paste, and history. Native caret selection is synchronized with model offsets. IME composition stays in the live browser editing surface until commit; the resulting text change is then applied as one undoable model edit, preserving unaffected structure and metadata. Browser spell-check or other unhandled native inputs import the safe DOM as an undoable model replacement. Clipboard HTML passes through the serializer's safe allowlist. Ctrl/Cmd+B/I/U and undo/redo shortcuts work without a framework. Copy supplies both plain text and sanitized HTML. Text/HTML drag-and-drop inserts at the drop caret; internal drags copy rather than move.

The editable region exposes `role="textbox"`, `aria-multiline`, `aria-readonly`, a label, visible keyboard focus, native text selection and native keyboard editing. Accessibility and input behavior depend partly on the browser; platform screen-reader and physical mobile/IME qualification remain required for production applications.

## Layout and fidelity boundaries

The browser supplies shaping, bidirectional text, line breaking and layout. The editable `RichTextBox` and general reader use a paper-sized surface that grows with content. `FlowDocumentPageViewer` supplies measured finite screen pages; `RichTextPageEditor` adds editing to that same pagination surface. Both support multiple newspaper-style text columns per page. Printing uses browser pagination. Word-identical pagination, an independent glyph shaper, per-section paper dimensions in one screen flow, page-specific adaptive footnote heights, and native layout engines are not implemented. Keep and widow/orphan rules follow browser CSS fragmentation behavior; impossible constraints can be relaxed by the browser. In multi-column pages, explicit break commands currently advance the text column. Oversized objects and story regions expose explicit overflow diagnostics. The portable Figure/Floater model preserves richer anchors than CSS can implement; `FloatingLayoutDiagnostics` reports unsupported vertical and page-relative placement cases.

Normal edits and committed IME text changes preserve unaffected model structure through the engine. Other native fallback imports fresh content nodes while retaining document-level properties; application-specific per-node metadata that HTML cannot express is not guaranteed to survive that fallback. Applications that mutate text during composition receive a `compositionconflict` event containing the composed text instead of losing their newer model content. Embedded UI containers display an image or accessible label, not arbitrary native controls. Imported images support HTTP(S), blob URLs and raster data URLs; SVG data URLs are rejected. Use an application image upload/resolution policy for durable document assets.

Continuous-view DOM virtualization reduces retained DOM and layout work; whole-model serialization/index traversal remains proportional to document size. Finite page measurement retains the full flow DOM. Benchmarks and browser checks describe the tested workload; the control does not claim every Word document feature or WPF control API.

## Finite editable pages

```html
<rich-text-toolbar for="document-editor" mode="all"></rich-text-toolbar>
<rich-text-page-editor
  id="document-editor"
  style="height:700px"
></rich-text-page-editor>
```

`RichTextPageEditor` extends the existing page viewer and exposes all `RichTextBox` editing APIs, `PageNumber`, `PageCount`, `LayoutResult`, and `Repaginate()`. Changing pages places the editable caret at that page's start. Committed typing follows the caret to its measured page. Setting `ViewMode = "continuous"` switches to ordinary continuous editing, and setting it to `"page"` restores finite pages. `Repaginate()` rejects in continuous mode. Document `ColumnCount` and `ColumnGap` configure actual newspaper columns; `PageSettings.TextColumnWidth` reports each column's width.

## Large-document virtualization

```js
editor.ViewMode = "continuous";
editor.EnableVirtualization = true; // also <rich-text-box virtualize>
editor.VirtualizationThreshold = 200; // top-level blocks
editor.VirtualizationOverscan = 6; // blocks before and after the visible window
editor.ScrollToTextOffset(25000);
console.log(editor.VirtualizationStatistics);
```

`DocumentVirtualizer` is also exported as an independent offset/height index for host controls. It builds UTF-16 ranges for top-level blocks and replaces estimated heights with measured boxes. The editor renders visible blocks plus overscan, uses inert height spacers for omitted blocks, and retains the current caret neighborhood. Selected ranges are fully materialized so native selection and copy remain meaningful. Selecting the whole document therefore temporarily creates the full DOM. IME composition and unhandled native edits temporarily materialize the full document; a native mutation delivered without its `beforeinput` notification is rejected with `nativeinputconflict` so omitted model content cannot be lost.

`VirtualizationStatistics` reports `Active`, `TotalBlocks`, `RealizedBlocks`, `EstimatedHeight`, `FirstVisibleBlock`, `LastVisibleBlock`, and `SelectionExpanded`. `virtualizationchange` carries this record. The browser regression uses 3,000 paragraphs and checks fewer than 60 retained paragraph elements, distant caret editing, undo, selection expansion, and IME preservation.

Virtualization is opt-in and active only in continuous mode. A single enormous top-level section or table is one block and is not subdivided. Height estimates become more accurate as blocks are visited. Continuous native accessibility browsing should use `EnableVirtualization = false` when the assistive technology needs every document element present; screen-reader and physical IME/device qualification is separate from automated browser testing. Finite page measurement keeps its complete flow DOM.

## Floating objects and rich text stories

```js
const figure = new Figure(
  new Paragraph("A callout with independent rich text"),
);
figure.Width = 240;
paragraph.Inlines.Add(figure);
editor.SetFloatingLayout(figure.Id, {
  WrapStyle: "Square",
  HorizontalAlignment: "Left",
  Width: 240,
  WrapDistance: 12,
});
editor.SelectObject(figure.Id);
```

`WrapStyle` accepts `Inline`, `Square`, `Tight`, `TopAndBottom`, `BehindText`, and `InFrontOfText`. `HorizontalAlignment`, pixel dimensions/offsets, `WrapDistance`, `Rotation`, and rectangular/elliptical tight wrapping are validated together before mutation. Every accepted property change passes through the shared engine, so undo and tracked formatting apply. `GetSelectedObject()` returns the selected portable object, while `SelectedObjectId` identifies pointer selection. `FloatingLayoutDiagnostics` describes preserved anchors that have no exact browser equivalent.

The reusable editor supplies eight resize grips and a move handle (`part="object-adorner"`). Pointer gestures commit on release; arrow keys adjust the focused grip by one pixel, or ten with Shift. Escape returns focus to the document. Concurrent property changes cancel a stale gesture and raise `objectlayouterror` instead of overwriting it.

Figure/Floater content is an independent story. Each object consumes one U+FFFC in its parent's text stream. Double-clicking a text box opens `EditTextBox` in the attached reusable toolbar. That dialog hosts another `RichTextBox` and `RichTextToolbar`, allowing rich formatting, paragraphs, and clipboard operations. Apply commits through `RichTextEngine.EditFloatingContent()` as one parent undo/review operation; Cancel discards the draft. A changed target story is detected before saving. The `objecteditrequest` event is cancellable; a toolbar claims it so two toolbars attached to the same editor do not open duplicate dialogs.

The toolbar additionally exposes `TextBox`, `FloatingLayout`, `MoveSelection`, `MergeTableCells`, and `SplitTableCell`. These commands are callable through `RichTextToolbar.Execute()` from framework/MVVM menus without copying dialog or editing logic into the application.

## System clipboard commands

`Copy()`, `Cut()`, and `Paste()` return promises and are also routed by `Execute()`. Copy writes safe HTML and plain text when `ClipboardItem` is available, with a plain-text write fallback. Paste prefers HTML and imports it through the serializer. Clipboard access requires a secure browser context and the browser's normal user-gesture/permission policy; denied or unavailable access rejects explicitly. Cut and Paste capture the document, revision, and selection before awaiting the browser. If those change, they reject and preserve content rather than applying an operation at a stale location. Keyboard and native clipboard events continue to use the synchronous event clipboard APIs.

## Reference semantics

The implementation follows the public distinction between reflowable flow content, page viewers, and editor controls in Microsoft's [flow document overview](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/advanced/flow-document-overview), [Figure reference](https://learn.microsoft.com/en-us/dotnet/api/system.windows.documents.figure), and [Floater reference](https://learn.microsoft.com/en-us/dotnet/api/system.windows.documents.floater). Similar property names do not establish Word layout conformance or exhaustive WPF binary/API equivalence.

## React and MVVM consumption

The optional `@wieslawsoltes/richtextweb/react` entry exports `RichTextPagedEditor` with a forwarded `RichTextPageEditor` ref. It shares the complete document-assignment, event, and lifecycle implementation with `RichTextEditor`:

```tsx
const editor = useRef<RichTextPageEditor>(null);
<RichTextPagedEditor
  ref={editor}
  document={documentModel}
  viewMode="continuous"
  enableVirtualization
  virtualizationThreshold={200}
  virtualizationOverscan={6}
  onPaginated={(layout) => setPageCount(layout.PageCount)}
  onPageChange={({ pageNumber }) => setCurrentPage(pageNumber)}
  onVirtualizationChange={(statistics) =>
    setRealized(statistics.RealizedBlocks)
  }
/>;
```

`onReady` and the ref expose the concrete control type. Both wrappers accept the virtualization properties and detach all event handlers on unmount. Detached controls are disposed after a microtask, allowing React StrictMode or a changed ref callback to reattach the same element without disposing it prematurely. Browser tests exercise both wrappers, typed page navigation, actual typing and undo, virtualization changes, read-only state, event forwarding, and unmount cleanup.

The existing generic MVVM binding engine works with the new control properties. Page navigation supports a two-way binding by choosing its event explicitly:

```js
const viewModel = new ObservableObject({
  Page: 1,
  Mode: "continuous",
  Virtualize: true,
});
const bindings = [
  new Binding({
    Source: viewModel,
    Path: "Page",
    Mode: BindingMode.TwoWay,
    UpdateSourceEvent: "pagechange",
  }).Attach(editor, "PageNumber"),
  new Binding({ Source: viewModel, Path: "Mode" }).Attach(editor, "ViewMode"),
  new Binding({ Source: viewModel, Path: "Virtualize" }).Attach(
    editor,
    "EnableVirtualization",
  ),
];
// Dispose bindings when this view is removed.
```

A page number must be valid for the last measured layout. The MVVM browser regression changes pages from both the control and view model, then switches the same control to virtualized continuous editing.
