import test from "node:test";
import assert from "node:assert/strict";
import {
  FlowDocument,
  Paragraph,
  Run,
  Bold,
  Table,
  TableColumn,
  TableRowGroup,
  TableRow,
  TableCell,
  TextPointer,
} from "../src/model.js";
import { RichTextEngine } from "../src/engine.js";
import {
  CreateDocumentPatch,
  ApplyDocumentPatch,
  InvertDocumentPatch,
  PatchConflictError,
  ReconcileDocument,
  DocumentObserverError,
} from "../src/history.js";

const engine = (text = "Hello world") =>
  new RichTextEngine(new FlowDocument(new Paragraph(new Run(text))));
test("patch history retains unchanged live nodes and stores a tiny text delta", () => {
  const e = engine("a".repeat(200000)),
    paragraph = e.Document.Blocks.Get(0),
    run = (paragraph as Paragraph).Inlines.Get(0);
  e.Select(100000);
  e.InsertText("X");
  assert.equal(e.Document.Blocks.Get(0), paragraph);
  assert.equal((paragraph as Paragraph).Inlines.Get(0), run);
  assert(e.HistoryStatistics.RetainedBytes < 1500);
  e.Undo();
  assert.equal(run.Text.length, 200000);
  e.Redo();
  assert.equal(run.Text[100000], "X");
  assert.equal((e.Document.Blocks.Get(0) as Paragraph).Inlines.Get(0), run);
});
test("multi-level patch undo covers formatting and annotations and preserves unrelated nodes", () => {
  const untouched = new Paragraph(new Run("untouched")),
    e = new RichTextEngine(
      new FlowDocument([new Paragraph(new Run("hello")), untouched]),
    );
  e.Select(1, 4);
  e.ApplyProperty("FontWeight", "Bold");
  e.AddComment("check");
  e.InsertText("i");
  e.Undo();
  assert.equal(e.Document.Text, "hello\nuntouched");
  e.Undo();
  assert.equal(e.Annotations.length, 0);
  e.Undo();
  assert.equal(e.GetProperty("FontWeight"), "Normal");
  e.Redo();
  e.Redo();
  e.Redo();
  assert.equal(e.Document.Text, "hio\nuntouched");
  assert.equal(e.Document.Blocks.Get(1), untouched);
});
test("patches reject stale/tampered context before changing the document", () => {
  const e = engine("abc"),
    before = e.Document.ToJSON();
  e.Select(1);
  e.InsertText("X");
  const after = e.Document.ToJSON(),
    patch = CreateDocumentPatch(before, after)!;
  const copy = FlowDocument.FromJSON(before);
  ApplyDocumentPatch(copy, patch);
  assert.equal(copy.Text, "aXbc");
  ApplyDocumentPatch(copy, InvertDocumentPatch(patch));
  assert.equal(copy.Text, "abc");
  (copy.Blocks.Get(0) as Paragraph).Inlines.Get(0).Text = "changed";
  const unchanged = copy.ToJSON();
  assert.throws(
    () => ApplyDocumentPatch(copy, InvertDocumentPatch(patch)),
    PatchConflictError,
  );
  assert.deepEqual(copy.ToJSON(), unchanged);
});
test("direct model changes grouped with engine change are undoable patches", () => {
  const e = engine("text"),
    p = e.Document.Blocks.Get(0);
  e.Change(() => {
    p.FontSize = 22;
    p.Foreground = "red";
  });
  e.Undo();
  assert.equal(p.FontSize, 16);
  assert.notEqual(p.Foreground, "red");
  e.Redo();
  assert.equal(p.FontSize, 22);
  assert.equal(p.Foreground, "red");
});
test("tracked insertion records author and can accept, reject, undo, redo", () => {
  const e = engine("ab");
  e.TrackChanges = true;
  e.CurrentAuthor = "Ada";
  e.Select(1);
  e.InsertText("XYZ");
  const revision = e.Revisions[0];
  assert.equal(revision.Kind, "Insertion");
  assert.equal(revision.Data.Author, "Ada");
  assert.equal(revision.Start, 1);
  assert.equal(revision.End, 4);
  e.RejectRevision(revision.Id);
  assert.equal(e.Document.Text, "ab");
  assert.equal(e.Revisions.length, 0);
  e.Undo();
  assert.equal(e.Document.Text, "aXYZb");
  assert.equal(e.Revisions.length, 1);
  e.Redo();
  assert.equal(e.Document.Text, "ab");
  e.Select(1);
  e.InsertText("Q");
  e.AcceptAllRevisions();
  assert.equal(e.Document.Text, "aQb");
  assert.equal(e.Revisions.length, 0);
});
test("tracked replacement restores rich deleted formatting and paragraph boundaries", () => {
  const e = new RichTextEngine(
    new FlowDocument([
      new Paragraph(new Bold(new Run("hello"))),
      new Paragraph(new Run("world")),
    ]),
  );
  e.TrackChanges = true;
  e.Select(2, 8);
  e.InsertText("NEW");
  assert.deepEqual(
    e.Revisions.map((r) => r.Kind),
    ["Deletion", "Insertion"],
  );
  assert.equal(e.Document.Text, "heNEWrld");
  e.RejectAllRevisions();
  assert.equal(e.Document.Text, "hello\nworld");
  assert.equal(e.Revisions.length, 0);
  e.Select(0, 5);
  assert.equal(e.GetProperty("FontWeight"), "Bold");
  e.Undo();
  assert.equal(e.Document.Text, "heNEWrld");
  assert.equal(e.Revisions.length, 2);
});
test("revision anchors survive earlier edits and imported text-only deletions reject", () => {
  const e = engine("one two");
  e.TrackChanges = true;
  e.Select(4, 7);
  e.InsertText("");
  const deletion = e.Revisions[0];
  e.TrackChanges = false;
  e.Select(0);
  e.InsertText("prefix ");
  e.RejectRevision(deletion.Id);
  assert.equal(e.Document.Text, "prefix one two");
  const imported = e.AddAnnotation(
    "Deletion",
    { Text: "!", Author: "Import" },
    e.Document.Text.length,
    e.Document.Text.length,
  );
  e.RejectRevision(imported.Id);
  assert(e.Document.Text.endsWith("!"));
});
test("dependent tracked edits reject newest-first without silent overwrite", () => {
  const e = engine("ab");
  e.TrackChanges = true;
  e.Select(1);
  e.InsertText("XYZ");
  const first = e.Revisions[0];
  e.Select(2, 3);
  e.InsertText("q");
  assert.throws(() => e.RejectRevision(first.Id), /conflict/i);
  e.RejectAllRevisions();
  assert.equal(e.Document.Text, "ab");
  assert.equal(e.Revisions.length, 0);
});
test("tracked cross-cell deletion restores cell fragments and keeps geometry", () => {
  const table = new Table(
      new TableRowGroup(
        new TableRow([
          new TableCell(new Paragraph(new Bold(new Run("alpha")))),
          new TableCell(new Paragraph(new Run("beta"))),
        ]),
      ),
    ),
    e = new RichTextEngine(new FlowDocument(table));
  e.TrackChanges = true;
  e.Select(1, 9);
  e.InsertText("");
  assert.equal(e.Document.Text, "a\na");
  e.RejectAllRevisions();
  assert.equal(e.Document.Text, "alpha\nbeta");
  assert.equal(e.Document.Blocks.Get(0), table);
  e.Select(0, 5);
  assert.equal(e.GetProperty("FontWeight"), "Bold");
});
test("tracked review metadata survives JSON round trip", () => {
  const e = engine("abc");
  e.TrackChanges = true;
  e.Select(1, 2);
  e.InsertText("Q");
  const restored = new RichTextEngine(
    FlowDocument.FromJSON(e.Document.ToJSON()),
  );
  restored.RejectAllRevisions();
  assert.equal(restored.Document.Text, "abc");
});
test("observer failures leave committed undo redo and cursor state consistent", () => {
  const e = engine("abc");
  e.Select(1);
  e.InsertText("X");
  const sub = e.Document.Changed.Subscribe(() => {
    throw Error("observer");
  });
  assert.throws(() => e.Undo(), DocumentObserverError);
  assert.equal(e.Document.Text, "abc");
  assert.equal(e.CanUndo, false);
  assert.equal(e.CanRedo, true);
  assert.equal(e.SelectionStart, 1);
  assert.throws(() => e.Redo(), DocumentObserverError);
  assert.equal(e.Document.Text, "aXbc");
  assert.equal(e.CanUndo, true);
  assert.equal(e.CanRedo, false);
  sub.Dispose();
  e.Undo();
  assert.equal(e.Document.Text, "abc");
});
test("property and collection observer failures do not stop a validated structural commit halfway", () => {
  const e = engine("abc"),
    p = e.Document.Blocks.Get(0) as Paragraph;
  p.Inlines.CollectionChanged.Subscribe(() => {
    throw Error("collection observer");
  });
  e.Select(1, 2);
  assert.throws(
    () => e.ApplyProperty("FontWeight", "Bold"),
    DocumentObserverError,
  );
  assert.equal(e.Document.Text, "abc");
  assert.equal(e.GetProperty("FontWeight"), "Bold");
  assert.equal(e.CanUndo, true);
});
test("reconciliation validates live-root identity collisions before removing content", () => {
  const e = engine("keep"),
    target = new FlowDocument(new Paragraph(new Run("bad"))).ToJSON();
  target.children![0].id = e.Document.Id;
  const before = e.Document.ToJSON();
  assert.throws(() => ReconcileDocument(e.Document, target), /Duplicate/);
  assert.deepEqual(e.Document.ToJSON(), before);
});
test("table column updates and boundary block insertion preserve unaffected live identity", () => {
  const table = new Table(
      new TableRowGroup(
        new TableRow(new TableCell(new Paragraph(new Run("cell")))),
      ),
    ),
    first = new TableColumn(),
    second = new TableColumn();
  table.Columns.Add(first);
  table.Columns.Add(second);
  const e = new RichTextEngine(new FlowDocument(table)),
    json = e.Document.ToJSON();
  json.children![0].props.Columns[0].props.Width = 123;
  e.ReplaceDocument(FlowDocument.FromJSON(json));
  assert.equal(table.Columns.Get(0), first);
  assert.equal(table.Columns.Get(1), second);
  assert.equal(first.Width, 123);
  const heading = new Paragraph(new Run("heading")),
    text = new RichTextEngine(new FlowDocument(heading));
  text.Select(0);
  text.InsertNode({
    type: "Section",
    id: "section",
    props: {},
    children: [{ type: "Paragraph", id: "toc", props: {}, children: [] }],
  });
  assert.equal(text.Document.Blocks.Get(1), heading);
});
test("grouped repeated-text edits retain exact live pointer coordinates through undo redo", () => {
  const e = engine("aaaaaaaa"),
    pointer = new TextPointer(e.Document, 4);
  e.Change(() => {
    e.Select(1);
    e.InsertText("a");
    e.Select(7);
    e.InsertText("a");
  });
  assert.equal(pointer.Offset, 5);
  e.Undo();
  assert.equal(pointer.Offset, 4);
  e.Redo();
  assert.equal(pointer.Offset, 5);
});

test("tracked inline formatting rejects only its changed property after unrelated edits", () => {
  const e = engine("abcdef");
  e.TrackChanges = true;
  e.CurrentAuthor = "Ada";
  e.Select(1, 4);
  e.ApplyProperty("FontWeight", "Bold");
  const revision = e.Revisions[0]!;
  assert.equal(revision.Kind, "Formatting");
  e.TrackChanges = false;
  e.Select(1, 4);
  e.ApplyProperty("Foreground", "red");
  e.Select(0);
  e.InsertText("prefix ");
  e.RejectRevision(revision.Id);
  e.Select(8, 11);
  assert.equal(e.GetProperty("FontWeight"), "Normal");
  assert.equal(e.GetProperty("Foreground"), "red");
  assert.equal(e.Document.Text, "prefix abcdef");
  e.Undo();
  e.Select(8, 11);
  assert.equal(e.GetProperty("FontWeight"), "Bold");
});
test("format revision conflicts preserve later formatting and reject-all is atomic", () => {
  const e = engine("abc");
  e.TrackChanges = true;
  e.Select(0, 3);
  e.ApplyProperty("FontSize", 20);
  const old = e.Revisions[0]!;
  e.TrackChanges = false;
  e.ApplyProperty("FontSize", 30);
  e.TrackChanges = true;
  e.Select(3);
  e.InsertText("!");
  const before = e.Document.ToJSON();
  assert.throws(() => e.RejectRevision(old.Id), /conflict/i);
  assert.throws(() => e.RejectAllRevisions(), /conflict/i);
  assert.deepEqual(e.Document.ToJSON(), before);
});
test("paragraph and table property reviews preserve other live properties", () => {
  const e = engine("abc"),
    p = e.Document.Blocks.Get(0);
  e.TrackChanges = true;
  e.SetParagraphProperty("TextAlignment", "Center");
  e.TrackChanges = false;
  e.SetParagraphProperty("KeepWithNext", true);
  e.RejectAllRevisions();
  assert.equal(p.GetValue("TextAlignment"), "Left");
  assert.equal(p.GetValue("KeepWithNext"), true);
  e.TrackChanges = true;
  e.Select(1);
  e.InsertTable(2, 2);
  assert.equal(e.Revisions[0]!.Kind, "TableStructure");
  e.RejectAllRevisions();
  assert.equal(e.Document.Text, "abc");
});
test("tracked rich text moves and stable block moves support reject undo and redo", () => {
  const e = engine("one two three");
  e.Select(4, 7);
  e.ApplyProperty("FontWeight", "Bold");
  e.TrackChanges = true;
  e.MoveSelection(13);
  assert.equal(e.Document.Text, "one  threetwo");
  assert.equal(e.Revisions[0]!.Kind, "Move");
  e.RejectAllRevisions();
  assert.equal(e.Document.Text, "one two three");
  e.Select(4, 7);
  assert.equal(e.GetProperty("FontWeight"), "Bold");
  const a = new Paragraph(new Run("a")),
    b = new Paragraph(new Run("b")),
    c = new Paragraph(new Run("c"));
  const blocks = new RichTextEngine(new FlowDocument([a, b, c]));
  blocks.TrackChanges = true;
  blocks.MoveBlocks([a.Id], blocks.Document.Id, 3);
  assert.equal(blocks.Document.Text, "b\nc\na");
  assert.equal(blocks.Document.Blocks.Get(2), a);
  blocks.RejectAllRevisions();
  assert.equal(blocks.Document.Text, "a\nb\nc");
  assert.equal(blocks.Document.Blocks.Get(0), a);
  blocks.Undo();
  assert.equal(blocks.Document.Text, "b\nc\na");
  blocks.Redo();
  assert.equal(blocks.Document.Text, "a\nb\nc");
});
test("table structural review allows unrelated cell text and refuses dependent edits", () => {
  const table = new Table(
    new TableRowGroup([
      new TableRow([
        new TableCell(new Paragraph(new Run("a"))),
        new TableCell(new Paragraph(new Run("b"))),
      ]),
    ]),
  );
  const e = new RichTextEngine(new FlowDocument(table));
  e.TrackChanges = true;
  e.Select(0);
  e.InsertTableRow();
  const revision = e.Revisions[0]!;
  e.TrackChanges = false;
  e.Select(0);
  e.InsertText("prefix ");
  e.RejectRevision(revision.Id);
  assert.equal(e.Document.Text, "prefix a\nb");
  assert.equal(table.RowGroups.Get(0).Rows.Count, 1);
  e.TrackChanges = true;
  e.Select(0);
  e.InsertTableRow();
  const next = e.Revisions[0]!;
  e.TrackChanges = false;
  e.Select(e.Document.Text.length);
  e.InsertText("content");
  assert.throws(() => e.RejectRevision(next.Id), /patch|changed|matches/i);
  assert(e.Document.Text.endsWith("content"));
});
test("merged table grid edits and split preserve geometry and can reject all revisions", () => {
  const e = engine("");
  e.InsertTable(3, 3);
  const before = e.Document.ToJSON();
  e.TrackChanges = true;
  e.Select(0);
  e.MergeTableCells(2);
  e.InsertTableColumn();
  e.InsertTableRow();
  e.SplitTableCell();
  e.DeleteTableColumn();
  assert(e.Revisions.every((r) => r.Kind === "TableStructure"));
  e.RejectAllRevisions();
  assert.deepEqual(e.Document.ToJSON().children, before.children);
});
test("remote document changes preserve live nodes but clear stale local undo only after valid commit", () => {
  const e = engine("abc"),
    p = e.Document.Blocks.Get(0);
  e.Select(1);
  e.InsertText("X");
  const next = e.Document.ToJSON();
  next.children![0]!.children![0]!.text = "remote";
  e.ApplyRemoteDocument(FlowDocument.FromJSON(next));
  assert.equal(e.Document.Text, "remote");
  assert.equal(e.Document.Blocks.Get(0), p);
  assert.equal(e.CanUndo, false);
});

test("direct typing avoids document serialization and preserves observer-safe history", () => {
  const editor = engine("a".repeat(100000)),
    document = editor.Document,
    original = document.ToJSON.bind(document);
  editor.Select(50000);
  document.ToJSON = () => {
    throw new Error("whole-document serialization on typing path");
  };
  try {
    editor.InsertText("X");
  } finally {
    document.ToJSON = original;
  }
  assert.equal(document.Text[50000], "X");
  assert(editor.HistoryStatistics.RetainedBytes < 1600);
  const observer = document.Changed.Subscribe(() => {
    throw new Error("observer failed");
  });
  assert.throws(() => editor.InsertText("Y"), DocumentObserverError);
  observer.Dispose();
  assert.equal(document.Text.slice(50000, 50002), "XY");
  editor.Undo();
  assert.equal(document.Text.slice(50000, 50002), "Xa");
});
test("deleted table row restoration follows neighboring identities after an earlier row insertion", () => {
  const editor = engine("");
  editor.InsertTable(3, 1);
  const table = editor.Document.Blocks.Get(0) as Table;
  const rows = table.RowGroups.Get(0).Rows;
  (rows.Get(0).Cells.Get(0).Blocks.Get(0) as Paragraph).Inlines.Add(
    new Run("a"),
  );
  (rows.Get(1).Cells.Get(0).Blocks.Get(0) as Paragraph).Inlines.Add(
    new Run("b"),
  );
  (rows.Get(2).Cells.Get(0).Blocks.Get(0) as Paragraph).Inlines.Add(
    new Run("c"),
  );
  editor.TrackChanges = true;
  editor.Select(2);
  editor.DeleteTableRow();
  const revision = editor.Revisions[0]!;
  editor.TrackChanges = false;
  editor.Select(0);
  editor.InsertTableRow(true);
  editor.RejectRevision(revision.Id);
  assert.equal(editor.Document.Text, "\na\nb\nc");
});

test("vertical merged cells expand and migrate during row editing", () => {
  const table = new Table(
    new TableRowGroup([
      new TableRow([
        new TableCell(new Paragraph(new Run("span"))),
        new TableCell(new Paragraph(new Run("b"))),
      ]),
      new TableRow(new TableCell(new Paragraph(new Run("d")))),
    ]),
  );
  table.RowGroups.Get(0).Rows.Get(0).Cells.Get(0).RowSpan = 2;
  const editor = new RichTextEngine(new FlowDocument(table));
  editor.TrackChanges = true;
  editor.Select(0);
  editor.InsertTableRow();
  assert.equal(table.RowGroups.Get(0).Rows.Get(0).Cells.Get(0).RowSpan, 3);
  editor.DeleteTableRow();
  assert.equal(table.RowGroups.Get(0).Rows.Get(0).Cells.Get(0).RowSpan, 2);
  editor.RejectAllRevisions();
  assert.equal(editor.Document.Text, "span\nb\nd");
});
test("Figure story editing retains main-story object offsets and is undoable and reviewable", async () => {
  const { Figure } = await import("../src/model.js");
  const figure = new Figure(new Paragraph(new Run("inside"))),
    editor = new RichTextEngine(
      new FlowDocument(
        new Paragraph([new Run("before"), figure, new Run("after")]),
      ),
    );
  editor.TrackChanges = true;
  editor.EditFloatingContent(figure.Id, (story) => {
    story.Select(0, 6);
    story.ApplyProperty("FontWeight", "Bold");
    story.Select(6);
    story.InsertText(" story");
  });
  assert.equal(editor.Document.Text, "before\uFFFCafter");
  assert.equal(figure.StoryText, "inside story");
  assert.equal(editor.Revisions[0]!.Kind, "Structural");
  editor.RejectAllRevisions();
  assert.equal(figure.StoryText, "inside");
  editor.Undo();
  assert.equal(figure.StoryText, "inside story");
});
