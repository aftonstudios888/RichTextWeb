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

| API                                                               | Behavior                                                                                                                                       |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `Document` / `document`                                           | Assign or read the shared `FlowDocument`. Assignment resets engine undo history and selection.                                                 |
| `Engine`                                                          | Access the reusable editing engine directly.                                                                                                   |
| `Selection`, `CaretPosition`, `Select(start, end)`, `SelectAll()` | Model selections use UTF-16 plain-text offsets. Paragraph separators count as one newline; images and embedded containers count as one U+FFFC. |
| `Text`, `value`                                                   | Read document text or replace the document with plain text.                                                                                    |
| `IsReadOnly` / `readOnly`                                         | Disable user editing, paste, undo and mutating control commands. Programmatic document/engine changes remain possible.                         |
| `AcceptsTab` / `acceptsTab`                                       | Insert a tab on Tab. Shift+Tab moves focus out of the editor. Default false.                                                                   |
| `Zoom` / `zoom`                                                   | Browser layout zoom between 0.25 and 4; 1 means 100%.                                                                                          |
| `ViewMode` / `viewMode`                                           | `page` displays a paper-width document surface; `continuous` fills available width.                                                            |
| `Focus()`, `ScrollToHome()`, `ScrollToEnd()`                      | Manage editor focus and scrolling.                                                                                                             |
| `Execute(command, parameter)`                                     | Run an engine editing command, `SelectAll`, or `Print`. Cached model selection survives toolbar focus changes.                                 |
| `Undo()`, `Redo()`, `CanUndo`, `CanRedo`                          | Model history including native IME reconciliation.                                                                                             |
| `AppendText(text)`                                                | Programmatically append text at the end of the document.                                                                                       |
| `BeginChange()`, `EndChange()`, `DeclareChangeBlock()`            | Group programmatic operations into one undo entry. Dispose the returned change block to complete it.                                           |
| `PasteHTML(html)`                                                 | Sanitize and insert an HTML fragment at the current selection as one undoable operation.                                                       |
| `Refresh()`                                                       | Explicitly render the current model. Model changes normally render automatically.                                                              |
| `Print()`                                                         | Open a browser print view; call from a user gesture so the browser permits its window.                                                         |
| `Dispose()`                                                       | Release engine subscriptions permanently when discarding an editor. Ordinary removal/reinsertion remains supported without disposal.           |

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

## Editing and rendering

The control uses semantic DOM elements inside an open shadow root. Paragraphs, headings, spans, emphasis, hyperlinks, lists, images, sections and tables are rendered with DOM APIs. It never evaluates imported markup or creates arbitrary embedded controls. `part="viewport"` and `part="editor"`, plus `--rt-accent`, `--rt-ink`, `--rt-paper`, `--rt-workspace`, and `--rt-border`, allow host styling.

Ordinary `beforeinput` operations edit the model directly: typing, paragraph/line breaks, deletion, formatting, paste, and history. Native caret selection is synchronized with model offsets. IME composition stays in the live browser editing surface until commit; the resulting text change is then applied as one undoable model edit, preserving unaffected structure and metadata. Browser spell-check or other unhandled native inputs import the safe DOM as an undoable model replacement. Clipboard HTML passes through the serializer's safe allowlist. Ctrl/Cmd+B/I/U and undo/redo shortcuts work without a framework. Copy supplies both plain text and sanitized HTML. Text/HTML drag-and-drop inserts at the drop caret; internal drags copy rather than move.

The editable region exposes `role="textbox"`, `aria-multiline`, `aria-readonly`, a label, visible keyboard focus, native text selection and native keyboard editing. Accessibility and input behavior depend partly on the browser; platform screen-reader and physical mobile/IME qualification remain required for production applications.

## Layout and fidelity boundaries

The browser supplies shaping, bidirectional text, line breaking and layout. Page mode is a paper-sized editing surface that grows with content. Printing uses browser pagination. This release does not provide deterministic Word-compatible page layout, an independent glyph shaper, virtualized page rendering, exact page counts, floating object wrapping, headers/footers, footnotes, or a native WPF/WinUI/Avalonia renderer. `PageWidth`, `PageHeight` (minimum editing surface height), `PagePadding`, and multicolumn CSS settings affect layout, but are not a Word pagination contract.

Normal edits and committed IME text changes preserve unaffected model structure through the engine. Other native fallback imports fresh content nodes while retaining document-level properties; application-specific per-node metadata that HTML cannot express is not guaranteed to survive that fallback. Applications that mutate text during composition receive a `compositionconflict` event containing the composed text instead of losing their newer model content. Embedded UI containers display an image or accessible label, not arbitrary native controls. Imported images support HTTP(S), blob URLs and raster data URLs; SVG data URLs are rejected. Use an application image upload/resolution policy for durable document assets.

The renderer currently rebuilds the document DOM after each committed model mutation. Large-document throughput and memory therefore scale with document size. Benchmarks and browser checks describe the tested workload; the control does not claim every Word document feature or WPF control API.
