import test from "node:test";
import assert from "node:assert/strict";
import { FlowDocument, Paragraph, Run } from "../src/model.js";
import { RichTextEngine } from "../src/engine.js";
import {
  DocumentFeatures,
  createField,
  updateDocumentFields,
} from "../src/document-features.js";

test("cached fields resolve without evaluating instructions and keep unresolved values", () => {
  const p = new Paragraph([
    createField("PAGE", "", "ROMAN"),
    new Run(" / "),
    createField("NUMPAGES"),
    new Run(" "),
    createField("DATE", "", "ISO"),
    new Run(" "),
    createField("MERGEFIELD", "Name"),
  ]);
  const root = new FlowDocument(p).ToJSON();
  const result = updateDocumentFields(root, {
    PageNumber: 4,
    PageCount: 8,
    Now: new Date("2026-09-13T12:30:00Z"),
    Data: { Name: "<script>safe text</script>" },
  });
  assert.equal(result.Updated, 4);
  assert.equal(result.Unresolved.length, 0);
  assert.equal(
    FlowDocument.FromJSON(root).Text,
    "IV / 8 2026-09-13 <script>safe text</script>",
  );
  root.children![0].children![0].props.Field = {
    Instruction: "DDE malicious command",
  };
  assert.equal(updateDocumentFields(root).Unresolved.length, 3);
  assert.equal(FlowDocument.FromJSON(root).Text.startsWith("IV"), true);
});
test("headers, notes, and field updates participate in engine undo", () => {
  const engine = new RichTextEngine(new FlowDocument(new Paragraph("Body"))),
    features = new DocumentFeatures(engine);
  features.SetStory("Headers", [new Paragraph("Private report").ToJSON()]);
  assert.equal(
    engine.Document.GetValue("Headers")[0].children[0].text,
    "Private report",
  );
  engine.Undo();
  assert.equal(engine.Document.GetValue("Headers"), undefined);
  engine.Redo();
  engine.Select(4);
  features.InsertNote("Footnote", "A source note");
  assert.equal(engine.Document.Text, "Body1");
  assert.equal(engine.Document.GetValue("Footnotes").length, 1);
  engine.Undo();
  assert.equal(engine.Document.Text, "Body");
  assert.equal(engine.Document.GetValue("Footnotes"), undefined);
  engine.Redo();
  features.UpdateNote(
    "Footnote",
    engine.Document.GetValue("Footnotes")[0].Id,
    "Updated source",
  );
  assert.equal(
    engine.Document.GetValue("Footnotes")[0].Blocks[0].children[0].text,
    "Updated source",
  );
});
test("mail merge produces independent documents and leaves the template unchanged", () => {
  const template = new FlowDocument(
    new Paragraph([new Run("Dear "), createField("MERGEFIELD", "Name")]),
  );
  const features = new DocumentFeatures(new RichTextEngine(template));
  const merged = features.MailMerge([{ Name: "Ada" }, { Name: "Grace" }]);
  assert.deepEqual(
    merged.map((d) => d.Text),
    ["Dear Ada", "Dear Grace"],
  );
  assert.equal(template.Text, "Dear «Name»");
  merged[0].Blocks.Clear();
  assert.equal(merged[1].Text, "Dear Grace");
});
test("TOC refresh follows nested headings and excludes its own title and entries", () => {
  const h1 = new Paragraph("Overview");
  h1.HeadingLevel = 1;
  const h2 = new Paragraph("Details");
  h2.HeadingLevel = 2;
  const engine = new RichTextEngine(
      new FlowDocument([h1, new Paragraph("Body"), h2]),
    ),
    features = new DocumentFeatures(engine);
  engine.Select(0);
  features.InsertTableOfContents({ MaxLevel: 2 }, { PageOfNode: () => 3 });
  assert.match(engine.Document.Text, /Contents\nOverview\t3\nDetails\t3/);
  features.UpdateTableOfContents({ PageOfNode: () => 4 });
  assert.match(engine.Document.Text, /Overview\t4\nDetails\t4/);
  assert.equal(engine.Document.Text.match(/Contents/g)?.length, 1);
  const before = engine.Document.ToJSON(),
    revision = engine.Document.Revision;
  features.UpdateTableOfContents({ PageOfNode: () => 4 });
  assert.deepEqual(engine.Document.ToJSON(), before);
  assert.equal(engine.Document.Revision, revision);
});
test("sequence fields and bookmark references are deterministic", () => {
  const p = new Paragraph([
    new Run("Target "),
    createField("SEQ", "fig", "alphabetic"),
    new Run(" "),
    createField("SEQ", "fig", "alphabetic"),
    new Run(" "),
    createField("REF", "source"),
  ]);
  const engine = new RichTextEngine(new FlowDocument(p));
  engine.Select(0, 6);
  engine.AddBookmark("source");
  const result = new DocumentFeatures(engine).UpdateFields();
  assert.equal(result.Unresolved.length, 0);
  assert.equal(engine.Document.Text, "Target a b Target");
});

test("field updates read bookmark references from one snapshot and preserve exact ranges and history", () => {
  const p = new Paragraph([
    createField("MERGEFIELD", "Name"),
    new Run(" XYZ "),
    createField("REF", "target"),
  ]);
  const engine = new RichTextEngine(new FlowDocument(p)),
    features = new DocumentFeatures(engine);
  engine.Select(7, 10);
  const bookmark = engine.AddBookmark("target"),
    comment = engine.AddComment("Do not move off XYZ");
  const pointer = engine.Document.ContentStart.GetPositionAtOffset(7)!;
  const before = engine.Document.ToJSON();
  const result = features.UpdateFields({
    Data: { Name: "A much longer name" },
  });
  assert.equal(engine.Document.Text, "A much longer name XYZ XYZ");
  assert.equal(result.Unresolved.length, 0);
  for (const id of [bookmark.Id, comment.Id]) {
    const annotation = engine.Annotations.find((a) => a.Id === id)!;
    assert.deepEqual([annotation.Start, annotation.End], [19, 22]);
    assert.equal(
      engine.Document.Text.slice(annotation.Start, annotation.End),
      "XYZ",
    );
  }
  assert.equal(pointer.Offset, 19);
  assert.deepEqual(result.TextChanges, [
    { Start: 0, RemovedLength: 6, InsertedLength: 18 },
    { Start: 11, RemovedLength: 1, InsertedLength: 3 },
  ]);
  engine.Undo();
  assert.deepEqual(engine.Document.ToJSON(), before);
  assert.equal(pointer.Offset, 7);
  engine.Redo();
  assert.equal(engine.Document.Text, "A much longer name XYZ XYZ");
  assert.equal(pointer.Offset, 19);
  const after = engine.Document.ToJSON();
  features.UpdateFields({ Data: { Name: "A much longer name" } });
  assert.deepEqual(engine.Document.ToJSON(), after);
});

test("multiple field replacements preserve annotations among repeated text and after each field", () => {
  const a = createField("MERGEFIELD", "A"),
    b = createField("MERGEFIELD", "B");
  const doc = new FlowDocument(
    new Paragraph([a, new Run(" repeat "), b, new Run(" repeat END")]),
  );
  const engine = new RichTextEngine(doc),
    features = new DocumentFeatures(engine);
  const original = doc.Text;
  const repeat1 = original.indexOf("repeat"),
    repeat2 = original.lastIndexOf("repeat"),
    end = original.indexOf("END");
  for (const [name, start, length] of [
    ["one", repeat1, 6],
    ["two", repeat2, 6],
    ["end", end, 3],
  ] as const) {
    engine.Select(start, start + length);
    engine.AddBookmark(name);
  }
  features.UpdateFields({ Data: { A: "very-long-first", B: "x" } });
  assert.equal(doc.Text, "very-long-first repeat x repeat END");
  assert.deepEqual(
    engine.Annotations.map((a) => [
      a.Data.Name,
      a.Start,
      a.End,
      doc.Text.slice(a.Start, a.End),
    ]),
    [
      ["one", 16, 22, "repeat"],
      ["two", 25, 31, "repeat"],
      ["end", 32, 35, "END"],
    ],
  );
  engine.Undo();
  assert.equal(doc.Text, original);
  assert.deepEqual(
    engine.Annotations.map((a) => [a.Start, a.End]),
    [
      [repeat1, repeat1 + 6],
      [repeat2, repeat2 + 6],
      [end, end + 3],
    ],
  );
});

test("PAGEREF resolves imported bookmark names against paragraphs or containing rendered runs", () => {
  const target = new Run("Target"),
    p = new Paragraph([target, new Run(" "), createField("PAGEREF", "named")]);
  const engine = new RichTextEngine(new FlowDocument(p));
  engine.Select(0, 6);
  engine.AddBookmark("named");
  const features = new DocumentFeatures(engine);
  assert.equal(
    features.UpdateFields({ PageOfNode: (id) => (id === p.Id ? 5 : undefined) })
      .Unresolved.length,
    0,
  );
  assert.equal(engine.Document.Text, "Target 5");
  assert.equal(
    features.UpdateFields({
      PageOfNode: (id) => (id === target.Id ? 7 : undefined),
    }).Unresolved.length,
    0,
  );
  assert.equal(engine.Document.Text, "Target 7");
  const unresolved = features.UpdateFields({ PageOfNode: () => undefined });
  assert.equal(unresolved.Unresolved.length, 1);
  assert.equal(engine.Document.Text, "Target 7");
});

test("story field changes do not remap main-story annotations even with reused detached IDs", () => {
  const field = createField("MERGEFIELD", "Name"),
    body = new Paragraph([field, new Run(" anchored")]);
  const engine = new RichTextEngine(new FlowDocument(body)),
    features = new DocumentFeatures(engine);
  engine.Select(7, 15);
  engine.AddBookmark("body");
  features.SetStory("Headers", [body.ToJSON()]);
  const result = features.UpdateFields({ Data: { Name: "A" } });
  assert.equal(result.TextChanges.length, 1);
  assert.equal(engine.Document.Text, "A anchored");
  const mark = engine.Annotations.find((a) => a.Data.Name === "body")!;
  assert.equal(engine.Document.Text.slice(mark.Start, mark.End), "anchored");
  assert.equal(
    engine.Document.GetValue("Headers")[0].children[0].children[0].text,
    "A",
  );
});
