# Review, structure, and editing performance

`RichTextEngine.TrackChanges` records text insertion/deletion, inline and node property changes, moves, table edits, fragment insertion, list conversion, and floating-story transactions. The reusable toolbar invokes the same commands; sample code does not implement a second editing engine. `CurrentAuthor` identifies the author, and `TrackFormatting = false` excludes formatting revisions while text/structure tracking remains active.

```ts
engine.TrackChanges = true;
engine.CurrentAuthor = "Ada";
engine.Select(10, 24);
engine.ApplyProperty("FontWeight", "Bold");
engine.SetParagraphProperty("KeepWithNext", true);
engine.MoveSelection(80); // destination in the document before the move

engine.Select(0); // place the selection in a table cell
engine.InsertTableRow();
engine.InsertTableColumn(true);
engine.MergeTableCells(2); // adjacent cells with matching row spans
engine.SplitTableCell(); // restore the merged cell's grid slots
engine.SetCellProperty("Background", "#fff2cc");

engine.RejectRevision(engine.Revisions.at(-1)!.Id);
engine.AcceptAllRevisions();
```

Revision kinds are `Insertion`, `Deletion`, `Formatting`, `Move`, `TableStructure`, and `Structural`. Every revision has an ID, range, and data including author and creation time. New operations also provide `Data.Operation`; `Data.Text` is optional. Controls should display the operation or kind when text is absent.

Inline formatting retains the prior local value of each changed property over mapped ranges. Paragraph, cell, table, and element formatting addresses stable element IDs. Rejection validates the current value before restoring the prior value, leaving unrelated properties and text edits intact. Structural revisions retain inverse patches. Stable child IDs relocate applicable splices after unrelated sibling edits, and deleted content retains neighboring insertion anchors. An edit to the content that a structural rejection would remove produces a conflict instead of silently discarding that edit. `RejectAllRevisions` preflights the complete sequence before changing the live document.

Row and column editing understands horizontal and vertical spans. Inserting through a spanning cell expands its span; deleting the origin row of a vertical span migrates the cell and its content to the following row. Horizontal merge preserves the rich block contents of every selected cell. Splitting retains contents in the first cell and creates the remaining grid slots. The grid must be rectangular and nonoverlapping, and the editor enforces a 10,000-slot limit. `MergeTableCells(count)` merges adjacent cells on one row with equal row spans; it is not an arbitrary rectangular merge-selection API.

`MoveBlocks(ids, parentId, index)` moves contiguous block siblings while retaining live model identity. It validates the destination collection and prevents ancestor cycles. `MoveSelection(destination)` moves rich selected text and refuses selections crossing protected cell/list boundaries; use block moves for those structural cases.

Figures and floaters occupy one U+FFFC object position in the main story. Their blocks belong to an independent text story. Edit that story through a synchronous transaction:

```ts
engine.EditFloatingContent(figure.Id, (story) => {
  story.Selection.SelectAll();
  story.ApplyProperty("FontFamily", "Aptos");
  story.Select(story.Document.Text.length);
  story.InsertText("\nAdditional text");
});
engine.SetElementProperty(figure.Id, "WrapDirection", "Left");
```

The transaction preserves child IDs and commits as one parent undo/review operation. Prepare asynchronous content before calling it. Direct model mutations remain possible, but review capture belongs to the engine commands; arbitrary model setters are not automatically transformed into authored revisions.

## DOCX

Exports contain native WordprocessingML run/paragraph formatting revisions, text move source/destination records, inserted/deleted row and cell markers, and DrawingML anchored text boxes for Figure/Floater stories. Native review imports can reject those supported changes without an application extension. The test suite removes the extension before verifying those paths.

An optional custom XML part preserves the canonical document, stable IDs, and full reversible review data for this engine. It is bound to the exact generated main document XML by SHA-256. If another application changes that native XML, the extension is ignored and standard WordprocessingML import applies. Invalid optional canonical data also falls back to native import. The extension requires Web Crypto availability.

Block-move reversibility, clear-format wrapper restoration, generic structural operations, and formatting properties outside the native translator's property mapping depend on that extension for exact engine round trips. They are not claimed as exhaustive native Word review compatibility. Floating layout maps supported anchors, offsets, dimensions, and wrapping to anchored text boxes; native Word layout equivalence is not established.

## History and collaboration

Untracked single-run typing and deletion update the live run directly, preserve exact pointer-change spans, and retain a compact ancestry/text patch. That path avoids whole-document JSON serialization, document reconstruction, and DOM reconciliation. Tests instrument `FlowDocument.ToJSON` to verify the typing path does not call it, and verify observer failures preserve committed undo state. Symbol-map maintenance can still traverse the document; structural operations still use detached validation and reconciliation.

`ApplyRemoteDocument(document, options)` applies a validated incoming state without recording it as a local edit and clears prior local history. This prevents stale local patches from overwriting remote changes. It does not claim selective collaborative undo or history rebasing. The rich collaboration layer merges independently identified review annotations; conflicting edits to a review's target can still require resolving dependent revisions first.
