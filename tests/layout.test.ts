import test from "node:test";
import assert from "node:assert/strict";
import { DocumentVirtualizer } from "../src/virtualization.js";
import { normalizeFloatingLayout } from "../src/floating-layout.js";
import { FlowDocument, Paragraph, Figure, Run, Image } from "../src/model.js";
import { RichTextBox, RichTextPageEditor } from "../src/control.js";
import { pageSettings } from "../src/pagination.js";

test("virtual block index preserves global UTF-16 positions and atomic floating stories", () => {
  const paragraph = new Paragraph("Before");
  paragraph.Inlines.Add(new Figure(new Paragraph("Independent story")));
  paragraph.Inlines.Add(new Run(" after"));
  const doc = new FlowDocument(paragraph);
  doc.Blocks.Add(new Paragraph("😀 next"));
  const index = new DocumentVirtualizer();
  index.Index(doc.ToJSON(), 500);
  const view = index.Window(0, 100, 1);
  assert.equal(view.Blocks.at(-1)!.EndOffset, doc.Text.length);
  assert.equal(view.Blocks[1].StartOffset, "Before\ufffc after".length);
  assert.equal(index.BlockAtOffset(doc.Text.length)?.Index, 1);
});

test("virtualization realizes a bounded window and preserves every selected block", () => {
  const doc = new FlowDocument();
  for (let i = 0; i < 5000; i++)
    doc.Blocks.Add(new Paragraph(`Paragraph ${i}`));
  const index = new DocumentVirtualizer();
  index.Index(doc.ToJSON(), 600);
  const first = index.Window(90000, 600, 4, { Start: 0, End: 0 });
  assert(first.Statistics.RealizedBlocks < 50);
  assert(first.Realized.has(0));
  assert(first.Statistics.FirstVisibleBlock > 1000);
  const all = index.Window(90000, 600, 4, { Start: 0, End: doc.Text.length });
  assert.equal(all.Realized.size, 5000);
  assert(all.Statistics.SelectionExpanded);
  assert.equal(index.SetMeasuredHeight(doc.Blocks.Get(0).Id, 150), true);
  assert.equal(index.SetMeasuredHeight(doc.Blocks.Get(0).Id, 150.1), false);
  index.Index(doc.ToJSON(), 600);
  assert.equal(index.Window(0, 100, 1).Blocks[0].Height, 150);
});

test("floating layout validates atomically and participates in undo and tracked formatting", () => {
  const editor = new RichTextBox();
  const paragraph = new Paragraph("Picture ");
  const image = new Image("https://example.com/picture.png");
  paragraph.Inlines.Add(image);
  editor.Document = new FlowDocument(paragraph);
  const before = editor.Document.ToJSON();
  assert.throws(
    () => editor.SetFloatingLayout(image.Id, { Width: 240, Height: -1 }),
    /range/,
  );
  assert.deepEqual(editor.Document.ToJSON(), before);
  editor.Engine.TrackChanges = true;
  editor.SetFloatingLayout(image.Id, {
    WrapStyle: "Square",
    Width: 240,
    HorizontalAlignment: "Left",
  });
  assert(
    editor.Engine.Revisions.some((revision) => revision.Kind === "Formatting"),
  );
  assert.equal(
    editor.Document.Blocks.Get(0).Children[1].GetValue("Width"),
    240,
  );
  editor.Undo();
  assert.deepEqual(editor.Document.ToJSON(), before);
  editor.IsReadOnly = true;
  assert.throws(
    () => editor.SetFloatingLayout(image.Id, { Width: 100 }),
    /read-only/,
  );
  editor.Dispose();
});

test("floating layout rejects invalid styles, nonfinite values and unknown properties", () => {
  assert.deepEqual(
    normalizeFloatingLayout({
      WrapStyle: "Tight",
      Shape: "Ellipse",
      Rotation: 45,
    }),
    { WrapStyle: "Tight", Shape: "Ellipse", Rotation: 45 },
  );
  assert.throws(() => normalizeFloatingLayout({ Width: Infinity }), /finite/);
  assert.throws(
    () => normalizeFloatingLayout({ WrapStyle: "url(x)" as any }),
    /wrapping/,
  );
  assert.throws(
    () => normalizeFloatingLayout({ Anything: "x" } as any),
    /Unsupported/,
  );
});

test("newspaper columns occupy one paper width and page editor remains editable in SSR", () => {
  const settings = pageSettings({
    PageWidth: 600,
    PagePadding: 50,
    ColumnCount: 2,
    ColumnGap: 20,
  });
  assert.equal(settings.ContentWidth, 500);
  assert.equal(settings.TextColumnWidth, 240);
  assert.equal(settings.ColumnCount, 2);
  const editor = new RichTextPageEditor();
  editor.Text = "Edit";
  editor.Select(4);
  editor.Execute("InsertText", " page");
  assert.equal(editor.Text, "Edit page");
  assert.equal(editor.IsReadOnly, false);
  editor.Dispose();
});
