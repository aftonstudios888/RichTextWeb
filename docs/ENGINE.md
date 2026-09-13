# Editing engine

`RichTextEngine` is a reusable TypeScript document editor without a browser or UI framework dependency. It operates on the same `FlowDocument` used by the web component, React adapter, MVVM bindings, serializers, and WebView bridge. It is an independently implemented API inspired by .NET document patterns. Microsoft Word, WPF, WinUI, and Avalonia are separate products with different APIs and layout behavior; this package does not reproduce every member or their binary interfaces.

```ts
import {
  FlowDocument,
  Paragraph,
  Run,
  RichTextEngine,
  TextRange,
} from "@wieslawsoltes/richtextweb/core";

const document = new FlowDocument(new Paragraph(new Run("Hello world")));
const engine = new RichTextEngine(document);
engine.Select(6, 11);
engine.ApplyProperty("FontWeight", "Bold");
engine.InsertText("browser");

engine.Change(() => {
  engine.InsertParagraph();
  engine.InsertText("One transaction, one undo step.");
});
engine.Undo();

const range = new TextRange(document.ContentStart, document.ContentEnd);
console.log(range.Text);
```

## Document positions

Positions are UTF-16 plain-text offsets, matching JavaScript string indexing and browser text offsets. They are **not WPF symbol offsets**. Paragraphs and block UI objects are enumerated in document order and separated by a newline; sections, list items, and table cells add no further separators. An inline line break contributes a newline. Images and UI objects contribute one U+FFFC object replacement character.

`Select(start, end)` validates both offsets and normalizes reverse selections. `TextSelection.Select` also accepts `TextPointer` endpoints and rejects pointers from other documents. `Selection.Start` and `Selection.End` always refer to the engine's current document. A standalone `TextRange` retains its own endpoints and uses transient editing operations; use `engine.Selection` when operations should belong to the engine's undo history.

Backspace and forward delete use `Intl.Segmenter` for complete graphemes, including combining marks, emoji modifiers, flags, and emoji joined with ZWJ. Word deletion uses Unicode word segmentation. Environments without `Intl.Segmenter` fall back to Unicode code point deletion, which does not guarantee an entire combining or ZWJ sequence is deleted together.

## Editing and structure

| Area                 | APIs                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Plain text           | `InsertText`, `ReplaceSelection`, `InsertParagraph`, `DeleteBackward`, `DeleteForward`, `DeleteWordBackward`, `DeleteWordForward` |
| Rich fragments       | `InsertNode`, `InsertFragment`, `GetSelectedFragment`                                                                             |
| Inline formatting    | `ApplyProperty`, `GetProperty`, `ToggleFormat`, `ClearFormatting`                                                                 |
| Paragraph formatting | `SetParagraphProperty`, `Indent`                                                                                                  |
| Lists                | `ToggleList('Disc')`, `ToggleList('Decimal')`, other model marker styles                                                          |
| Links and images     | `InsertHyperlink`, `RemoveHyperlink`, `InsertImage`                                                                               |
| Tables               | `InsertTable`, `InsertTableRow`, `DeleteTableRow`, `InsertTableColumn`, `DeleteTableColumn`, `DeleteTable`                        |
| Search               | `Find`, `ReplaceAll`                                                                                                              |
| Review metadata      | `AddComment`, `AddBookmark`, `AddAnnotation`, `UpdateAnnotation`, `RemoveAnnotation`, `GoToBookmark`, `Annotations`               |
| History              | `Undo`, `Redo`, `CanUndo`, `CanRedo`, `UndoLimit`, `ClearUndo`                                                                    |
| Transactions         | `BeginChange`, `EndChange`, `Change`                                                                                              |
| Document lifecycle   | `SetDocument`, `ReplaceDocument`, `Dispose`                                                                                       |

Text replacements preserve unaffected nodes and nested structure. Partial formatting splits affected text runs and preserves surrounding spans, hyperlinks, lists, sections, and tables. Typing inherits effective inline formatting; formatting an empty selection changes the next insertion. `GetProperty` returns the effective value or `undefined` when the selection contains mixed values. Clear formatting removes selected inline styles and semantic bold, italic, and underline wrappers; the surrounding paragraph and document styles still apply.

Insertion fragments contain either inline nodes or block nodes. A `FlowDocument` node contributes its child blocks. Imported nodes receive fresh IDs to avoid duplicate identity. Paragraph fragments merge their first and last paragraphs with the text surrounding the caret. Tables and other structural blocks retain their own boundaries. `GetSelectedFragment` preserves selected inline formatting and ancestor structure for rich clipboard/export use.

Deletion joins adjacent paragraphs in the same block collection. Deleting across table cells, list items, or separate containers removes intersecting text while retaining those structural containers and their paragraph separators. It does not flatten a table or list into paragraphs. Use the explicit table commands to remove a table, row, or column. Row and column editing requires a rectangular table without merged cells and throws on unsupported geometry. Table creation and expansion are capped at 10,000 cells per table. List conversion requires contiguous paragraphs in one block collection; toggling an existing list applies to that list as a whole.

`Indent` modifies paragraph `TextIndent` in CSS pixels, with a minimum of zero; it does not create nested list levels.

## History, events, and lifecycle

Each operation validates a detached canonical document before applying it through `FlowDocument.ReplaceWith`. The original document object and its subscribers survive editing, undo, redo, and `ReplaceDocument`. `SetDocument` installs a new document object and resets selection and history.

History records document content, metadata, selection, and pending insertion formatting. The default `UndoLimit` is 100 snapshots. A new edit clears redo. Nested `BeginChange`/`EndChange` pairs group multiple operations into one history item and one document change notification. `Change(callback)` balances the transaction in `finally`; it is a grouping operation, not a rollback transaction. If the callback throws after successful edits, those earlier edits remain undoable as one unit. Undo and redo cannot run during an open transaction.

```ts
const documentSubscription = engine.Changed.Subscribe(
  ({ Document, Revision }) => {
    console.log(Revision, Document.Text);
  },
);
const selectionSubscription = engine.SelectionChanged.Subscribe(
  ({ Start, End }) => {
    console.log(Start, End);
  },
);

documentSubscription.Dispose();
selectionSubscription.Dispose();
engine.Dispose();
```

Changes made directly through the model trigger the engine's change event, but do not independently create undo records unless enclosed in an engine change transaction. `ReplaceDocument` is the explicit history-recorded reconciliation API for composition or external editor content.

Snapshot history and canonical-tree editing have document-size cost per edit. This release does not implement a rope, piece table, incremental shaping engine, collaborative operation log, or history compression. Browser layout and text shaping are provided by the browser renderer. Performance qualification should use representative document size, formatting, tables, fonts, and target devices.

## Search and review metadata

```ts
const matches = engine.Find("document", { MatchCase: false, WholeWord: true });
const count = engine.ReplaceAll("old name", "new name", { MatchCase: true });
const comment = engine.AddComment("Please review this paragraph.", "Ada");
engine.UpdateAnnotation(comment.Id, { Resolved: true });
engine.AddBookmark("introduction");
engine.GoToBookmark("introduction");
```

Find treats the search string literally, with optional case sensitivity, Unicode-aware whole-word boundaries, and a starting offset. Replace-all processes matches from the end so earlier positions remain valid, and groups all replacements into one undo unit. Replacement text is literal; `$&` and other regular-expression replacement syntax have no special behavior.

Annotations are JSON-serializable document metadata with `Id`, `Kind`, `Start`, `End`, and `Data`. Text edits update their ranges; insertions at a range boundary are included by the default range stickiness. Structural edits follow surviving text block identities when possible, then use a textual change range as a fallback. Removed ranges can collapse. Bookmarks require unique nonempty names. Comments support application-defined authors, messages, and resolved state. This is not tracked-changes markup, document comparison, threaded service collaboration, or native Office review interoperability.

## Commands

`Execute` accepts case-insensitive strings and recognizes optional `EditingCommands.` or `ApplicationCommands.` prefixes. The exported `EditingCommands` and `ApplicationCommands` objects provide familiar constants for the common commands.

Supported commands include `Undo`, `Redo`, `SelectAll`, `InsertText`, `InsertParagraph`, `InsertLineBreak`, `Delete`, `Backspace`, `DeletePreviousWord`, `DeleteNextWord`, `ToggleBold`, `ToggleItalic`, `ToggleUnderline`, `ToggleStrikethrough`, `ToggleSubscript`, `ToggleSuperscript`, `AlignLeft`, `AlignCenter`, `AlignRight`, `AlignJustify`, `FontFamily`, `FontSize`, `Foreground`, `Background`, `Highlight`, `Heading`, `ClearFormatting`, `Indent`, `Outdent`, `ToggleBullets`, `ToggleNumbering`, `InsertImage`, `InsertTable`, `InsertTableRow`, `DeleteTableRow`, `InsertTableColumn`, `DeleteTableColumn`, `DeleteTable`, `InsertHyperlink`, `RemoveHyperlink`, `Find`, `ReplaceAll`, `AddComment`, and `AddBookmark`. Unsupported command names throw a descriptive error.

The engine does not access system clipboard APIs, files, or networks. Those operations belong to a browser control or host adapter. It also does not implement Word field evaluation, mail merge, equation layout, arbitrary embedded OLE objects, script macros, footnote pagination, native document protection, or a proprietary Word/WPF layout engine. Refer to the format and control documentation for their separate import, export, rendering, and interaction boundaries.
