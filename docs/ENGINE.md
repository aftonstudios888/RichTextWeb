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

`Select(start, end)` validates both offsets and normalizes reverse selections. `TextSelection.Select` also accepts `TextPointer` endpoints and rejects pointers from other documents. `Selection.Start` and `Selection.End` always refer to the engine's current document. A standalone `TextRange` uses live model pointers and transient editing operations; use `engine.Selection` when operations should belong to the engine's undo history.

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

Each operation validates a detached canonical document, computes a reversible structural patch, and reconciles changes through live model collections. Matching nodes keep their existing objects, IDs, and subscriptions. The original document object survives editing, undo, redo, and `ReplaceDocument`. `SetDocument` installs a new document object and resets selection and history. When a change is already mapped by another document service, `ReplaceDocument(document, { MapAnnotations: false, TextChanges: spans })` accepts pre-mapped annotation ranges and sorted disjoint pre-edit UTF-16 spans for exact live-pointer/history mapping.

History retains changed text fragments, property values, inserted/deleted subtrees, selection, and pending insertion formatting. It does not retain a whole-document snapshot for every edit. The default `UndoLimit` is 100 patch entries. Ordinary typing in an existing run retains that Run object and a compact text delta. `HistoryStatistics` reports entry counts and serialized patch bytes; the byte count excludes JavaScript runtime overhead and selection metadata. A new edit clears redo. Nested `BeginChange`/`EndChange` pairs group multiple operations into one history item and one document change notification. `Change(callback)` balances the transaction in `finally`; it is a grouping operation, not a rollback transaction. If the callback throws after successful edits, those earlier edits remain undoable as one unit. Undo and redo cannot run during an open transaction.

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

Patch construction, transient validation, and canonical-tree reconciliation still scan document content. The retained history improvement does not make every edit sublinear. An open compound transaction temporarily retains its starting document and identity tokens to compose exact text spans; those snapshots are released when the transaction ends. Replacing an entire document or removing a large subtree naturally produces a correspondingly large patch. Browser shaping and layout remain separate from the engine. This release does not implement a rope, piece table, native shaping engine, or automatic CRDT tombstone compaction. Performance qualification should use representative document size, formatting, tables, fonts, and target devices.

Patch preconditions reject stale text, property, or structural targets with `PatchConflictError` instead of silently undoing unrelated changes. Reconciliation validates root identity collisions before touching the current document. Observer failures are collected while a validated mutation finishes; `DocumentObserverError` reports those failures after the document and history are consistent. Its `Committed` property is true. Exact text spans preserve pointer gravity during normal text edits and their undo/redo, including repeated text and grouped edits.

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

Annotations are JSON-serializable document metadata with `Id`, `Kind`, `Start`, `End`, and `Data`. Text edits update their ranges; insertions at a range boundary are included by the default range stickiness. Structural edits follow surviving text block identities when possible, then use a textual change range as a fallback. Removed ranges can collapse. Bookmarks require unique nonempty names. Comments support application-defined authors, messages, and resolved state. Comments and bookmarks are separate from the tracked-change records described below. They do not supply a threaded service, author authentication, or enterprise review workflow.

## Commands

`Execute` accepts case-insensitive strings and recognizes optional `EditingCommands.` or `ApplicationCommands.` prefixes. The exported `EditingCommands` and `ApplicationCommands` objects provide familiar constants for the common commands.

Supported commands include `Undo`, `Redo`, `SelectAll`, `InsertText`, `InsertParagraph`, `InsertLineBreak`, `Delete`, `Backspace`, `DeletePreviousWord`, `DeleteNextWord`, `ToggleBold`, `ToggleItalic`, `ToggleUnderline`, `ToggleStrikethrough`, `ToggleSubscript`, `ToggleSuperscript`, `AlignLeft`, `AlignCenter`, `AlignRight`, `AlignJustify`, `FontFamily`, `FontSize`, `Foreground`, `Background`, `Highlight`, `Heading`, `ClearFormatting`, `Indent`, `Outdent`, `ToggleBullets`, `ToggleNumbering`, `InsertImage`, `InsertTable`, `InsertTableRow`, `DeleteTableRow`, `InsertTableColumn`, `DeleteTableColumn`, `DeleteTable`, `InsertHyperlink`, `RemoveHyperlink`, `Find`, `ReplaceAll`, `AddComment`, and `AddBookmark`. Unsupported command names throw a descriptive error.

Additional command names are `TrackChanges` (a boolean parameter or omitted to toggle), `CurrentAuthor` (string), `AcceptRevision`, `RejectRevision`, `AcceptAllRevisions`, and `RejectAllRevisions`.

The engine does not access system clipboard APIs, files, or networks. Those operations belong to a browser control or host adapter. It also does not implement Word field evaluation, mail merge, equation layout, arbitrary embedded OLE objects, script macros, footnote pagination, native document protection, or a proprietary Word/WPF layout engine. Refer to the format and control documentation for their separate import, export, rendering, and interaction boundaries.

## Tracked insertions and deletions

```ts
engine.CurrentAuthor = "Ada";
engine.TrackChanges = true;
engine.Select(6, 11);
engine.InsertText("browser");

for (const revision of engine.Revisions) {
  console.log(
    revision.Kind,
    revision.Start,
    revision.End,
    revision.Data.Author,
  );
}
engine.RejectAllRevisions(); // restores the deleted rich content
```

Text replacement records a collapsed `Deletion` annotation with removed text and a rich block fragment, plus an `Insertion` annotation covering the new text. `Data.Author` and `Data.CreatedAt` are serializable review metadata. Replacement text can include paragraph breaks. Deletion across table cells retains the cells and stores per-cell fragments for restoration. Review records survive JSON round trips; supported DOCX review conversion is described separately in the format documentation.

Accepting a revision removes its review metadata. Rejecting an insertion removes its text; rejecting a deletion restores its rich fragment. These actions participate in patch undo/redo. Reject-all runs newest-first so dependent replacements unwind in order. An insertion whose content has since been independently edited, or a deleted cell whose remaining content or container changed, raises a revision conflict. It does not overwrite the later edits. Review author strings are display metadata, not authenticated identities.

Tracking currently covers `InsertText`, paragraph insertion, and backward/forward or word deletion, which all use the text replacement operation. Arbitrary structural insertions, table topology edits, paragraph properties, and formatting changes do not create Word-compatible formatting revisions. Existing edits made while tracking was off are not reconstructed as revisions. The tracked-change layer is separate from the collaboration protocol.

## Transport-neutral collaborative text

```ts
import { CollaborativeTextSession } from "@wieslawsoltes/richtextweb/core";

const session = new CollaborativeTextSession({
  DocumentId: "shared-note-v1",
  ActorId: "unique-client-42",
  Text: engine.Document.Text,
});
const binding = session.BindEngine(engine);
const outbound = session.OperationGenerated.Subscribe((operation) => {
  transport.send(JSON.stringify(operation));
});
// In your transport's receive handler:
// session.Receive(JSON.parse(message));

session.Conflict.Subscribe(({ Error }) => console.error(Error.message));
// On close: outbound.Dispose(); binding.Dispose();
```

`CollaborativeTextSession` is a replicated growable character sequence (RGA). Every inserted Unicode code point has a stable actor/sequence/index ID. Deletes target those IDs and retain tombstones, so a concurrent deletion preserves an insertion it has not observed. Concurrent siblings order deterministically by Lamport timestamp and actor ID. Formatting attaches last-writer-wins property registers to character IDs using the same deterministic stamp ordering. A causal version vector and actor sequence numbers allow out-of-order delivery to queue until dependencies arrive. Replacement is one atomic operation, validated before its deletion is applied.

The public APIs are `Insert(offset, text)`, `Delete(start, end)`, `Replace(start, end, text)`, `Format(start, end, property, value)`, `Receive(operation)`, `GetFormatting()`, `ExportSnapshot()`, and `FromSnapshot(snapshot, newActorId)`. `Text`, `VersionVector`, `PendingCount`, `CharacterCount`, `ResyncRequired`, and `RequiresCompaction` expose session state. Local CRLF/CR input becomes LF; malformed remote newline representations are rejected. Offsets remain UTF-16, and operations reject offsets inside a surrogate pair.

The engine binding supports root paragraphs with supported rich inline nodes. It observes local text and inline formatting changes, emits operations, projects remote changes in coalesced ranges, and preserves the local pending caret format. Newly inserted text uses the session's formatting, rather than inheriting a receiving user's pending typing style. Undo emits compensating edits; this is not author-scoped collaborative undo. Participating initial documents must have the same paragraph structure and initial styling as well as matching plain text. The protocol's initial-content fingerprint checks text identity, not full document equivalence.

Tables, lists, sections, embedded objects, paragraph/page properties, fields, notes, comments, bookmarks, and tracked-review metadata are outside this text projection protocol. Attempting an unsupported structural engine edit disconnects that binding and emits `Conflict`; local document content remains available for host-directed recovery. The host must provide a merge or reinitialization workflow rather than passing arbitrary structural snapshots through this protocol.

Received operations validate protocol/document identity, payload shape, unique operation contents, causal references, actor sequences, and Lamport clocks. Duplicate delivery is idempotent; reusing an operation ID with different contents is rejected. These checks are not cryptographic authentication. The host owns actor identity, authorization, transport encryption, durable storage, network reconnect/retry, and an authenticated snapshot service. A text fingerprint detects accidental initial-content mismatch; it is not a signature or security boundary.

The default insertion limit is 65,536 UTF-16 code units per operation. Local allocation is limited to one million retained characters/tombstones by default (`MaxCharacters`). Received valid concurrent operations may exceed that soft local allocation limit so all replicas can converge; further local insertion then requires coordinated compaction. `RequiresCompaction` identifies that state. Causal queue overflow sets `ResyncRequired` and requires the host to obtain a complete authenticated snapshot. Snapshots replay the operation log and retain tombstones; they do not perform automatic garbage collection. Compaction requires all peers to agree on a new baseline/document identity. This module supplies no hosted collaboration server or distributed enterprise administration system.

## Rich revisions and structural editing

Version 0.3 adds tracked formatting, rich text/block moves and table/list/fragment revisions; merged-cell-aware row/column edits; `SetElementProperty`, `EditFloatingContent`, `MoveSelection`, `MoveBlocks`, `MergeTableCells` and `SplitTableCell`. Rejection validates inverse patches before changing the live document, and reject-all preflights the complete batch. See [review, table geometry and remote history semantics](REVIEW-AND-STRUCTURE.md) for usage and exact boundaries.
