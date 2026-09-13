import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import {
  FlowDocument,
  Paragraph,
  Run,
  Figure,
  Table,
  TableRowGroup,
  TableRow,
  TableCell,
} from "../src/model.js";
import { RichTextEngine } from "../src/engine.js";
import { fromDOCX, toDOCX } from "../src/formats-docx.js";

async function nativeOnly(bytes: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  zip.remove("customXml/richtextweb-review.xml");
  return zip.generateAsync({ type: "uint8array" });
}
const e = () =>
  new RichTextEngine(new FlowDocument(new Paragraph(new Run("one two three"))));
test("DOCX formatting changes emit native run and paragraph revisions with reversible fallback", async () => {
  const editor = e();
  editor.TrackChanges = true;
  editor.Select(4, 7);
  editor.ApplyProperty("FontWeight", "Bold");
  editor.SetParagraphProperty("TextAlignment", "Center");
  const bytes = await toDOCX(editor.Document),
    zip = await JSZip.loadAsync(bytes),
    xml = await zip.file("word/document.xml")!.async("string");
  assert.match(xml, /w:rPrChange/);
  assert.match(xml, /w:pPrChange/);
  const restored = new RichTextEngine(await fromDOCX(bytes));
  assert.deepEqual(restored.Document.ToJSON(), editor.Document.ToJSON());
  restored.RejectAllRevisions();
  assert.equal(restored.Document.Text, "one two three");
  restored.Select(4, 7);
  assert.equal(restored.GetProperty("FontWeight"), "Normal");
  const native = new RichTextEngine(await fromDOCX(await nativeOnly(bytes)));
  assert.equal(native.Revisions.length, 2);
  native.RejectAllRevisions();
  native.Select(4, 7);
  assert.equal(native.GetProperty("FontWeight"), "Normal");
  assert.equal(native.Document.Blocks.Get(0).GetValue("TextAlignment"), "Left");
});
test("DOCX moves emit native source and destination and reject without extension metadata", async () => {
  const editor = e();
  editor.TrackChanges = true;
  editor.Select(4, 7);
  editor.MoveSelection(13);
  const bytes = await toDOCX(editor.Document),
    zip = await JSZip.loadAsync(bytes),
    xml = await zip.file("word/document.xml")!.async("string");
  assert.match(xml, /w:moveFrom/);
  assert.match(xml, /w:moveTo/);
  const native = new RichTextEngine(await fromDOCX(await nativeOnly(bytes)));
  assert.equal(native.Revisions.length, 1);
  assert.equal(native.Revisions[0]!.Kind, "Move");
  native.RejectAllRevisions();
  assert.equal(native.Document.Text, "one two three");
});
test("DOCX inserted and deleted table rows are reviewable natively and roundtrip exact snapshots", async () => {
  const table = new Table(
    new TableRowGroup([
      new TableRow([
        new TableCell(new Paragraph(new Run("a"))),
        new TableCell(new Paragraph(new Run("b"))),
      ]),
      new TableRow([
        new TableCell(new Paragraph(new Run("c"))),
        new TableCell(new Paragraph(new Run("d"))),
      ]),
    ]),
  );
  const editor = new RichTextEngine(new FlowDocument(table));
  editor.TrackChanges = true;
  editor.Select(0);
  editor.DeleteTableRow();
  const deleted = await toDOCX(editor.Document),
    zip = await JSZip.loadAsync(deleted),
    xml = await zip.file("word/document.xml")!.async("string");
  assert.match(xml, /<w:trPr><w:del/);
  assert.match(xml, /<w:delText/);
  const restored = new RichTextEngine(await fromDOCX(deleted));
  restored.RejectAllRevisions();
  assert.equal(restored.Document.Text, "a\nb\nc\nd");
  const native = new RichTextEngine(await fromDOCX(await nativeOnly(deleted)));
  assert.equal(native.Document.Text, "c\nd");
  native.RejectAllRevisions();
  assert.equal(native.Document.Text, "a\nb\nc\nd");
  editor.AcceptAllRevisions();
  editor.Select(0);
  editor.InsertTableRow();
  const inserted = await toDOCX(editor.Document),
    insertedZip = await JSZip.loadAsync(inserted);
  assert.match(
    await insertedZip.file("word/document.xml")!.async("string"),
    /<w:trPr><w:ins/,
  );
  const nativeInserted = new RichTextEngine(
    await fromDOCX(await nativeOnly(inserted)),
  );
  nativeInserted.RejectAllRevisions();
  assert.equal(nativeInserted.Document.Text, "c\nd");
});
test("DOCX floating rich text emits anchored DrawingML and imports the independent story", async () => {
  const figure = new Figure(new Paragraph(new Run("floating rich text")));
  figure.Width = 240;
  figure.Height = 120;
  figure.HorizontalAnchor = "ContentRight";
  figure.WrapDirection = "Left";
  const document = new FlowDocument(
    new Paragraph([new Run("before"), figure, new Run("after")]),
  );
  const bytes = await toDOCX(document),
    zip = await JSZip.loadAsync(bytes),
    xml = await zip.file("word/document.xml")!.async("string");
  assert.match(xml, /wp:anchor/);
  assert.match(xml, /w:txbxContent/);
  assert.match(xml, /wrapText="left"/);
  const native = await fromDOCX(await nativeOnly(bytes));
  assert.equal(native.Text, "before\uFFFCafter");
  const restored = (native.Blocks.Get(0) as Paragraph).Inlines.Get(1) as Figure;
  assert.equal(restored.Type, "Figure");
  assert.equal(restored.StoryText, "floating rich text");
  assert.equal(restored.WrapDirection, "Left");
});
test("changed native DOCX main part invalidates stale canonical review payload", async () => {
  const editor = e();
  editor.TrackChanges = true;
  editor.Select(0, 3);
  editor.ApplyProperty("FontWeight", "Bold");
  const zip = await JSZip.loadAsync(await toDOCX(editor.Document));
  const xml = await zip.file("word/document.xml")!.async("string");
  zip.file("word/document.xml", xml.replace(">one<", ">NEW<"));
  const imported = await fromDOCX(
    await zip.generateAsync({ type: "uint8array" }),
  );
  assert.equal(imported.Text, "NEW two three");
});

test("DOCX native cell insertions and deletions preserve column review without custom data", async () => {
  const editor = new RichTextEngine(
    new FlowDocument(
      new Table(
        new TableRowGroup([
          new TableRow([
            new TableCell(new Paragraph(new Run("a"))),
            new TableCell(new Paragraph(new Run("b"))),
          ]),
          new TableRow([
            new TableCell(new Paragraph(new Run("c"))),
            new TableCell(new Paragraph(new Run("d"))),
          ]),
        ]),
      ),
    ),
  );
  editor.TrackChanges = true;
  editor.Select(0);
  editor.DeleteTableColumn();
  const bytes = await toDOCX(editor.Document),
    zip = await JSZip.loadAsync(bytes);
  assert.match(
    await zip.file("word/document.xml")!.async("string"),
    /w:cellDel/,
  );
  const native = new RichTextEngine(await fromDOCX(await nativeOnly(bytes)));
  assert.equal(native.Document.Text, "b\nd");
  native.RejectAllRevisions();
  assert.equal(native.Document.Text, "a\nb\nc\nd");
  editor.AcceptAllRevisions();
  editor.Select(0);
  editor.InsertTableColumn();
  const inserted = new RichTextEngine(
    await fromDOCX(await nativeOnly(await toDOCX(editor.Document))),
  );
  inserted.RejectAllRevisions();
  assert.equal(inserted.Document.Text, "b\nd");
});
