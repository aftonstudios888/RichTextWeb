import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { FlowDocument, Paragraph, Run, Span, Section } from "../src/model.js";
import { toDOCX, fromDOCX, fromHTML } from "../src/formats.js";
const paragraph = (text: string) => new Paragraph(new Run(text)).ToJSON();
const field = (instruction: string, result: string) => {
  const value = new Span(new Run(result));
  value.SetValue("Field", {
    Instruction: instruction,
    Type: instruction.split(" ")[0],
  });
  return value;
};

test("DOCX writes and reads independent header/footer relationships, notes and fields", async () => {
  const doc = new FlowDocument(
    new Paragraph([
      new Run("Page "),
      field("PAGE", "1"),
      new Run(" note "),
      new Run("1"),
    ]),
  );
  (doc.Blocks.Get(0) as Paragraph).Inlines.Get(3).SetValue("NoteReference", {
    Kind: "Footnote",
    Id: "note-a",
  });
  doc.SetValue("Headers", [paragraph("Header text")]);
  doc.SetValue("Footers", [
    new Paragraph([
      new Run("Page "),
      field("PAGE", "1"),
      new Run(" of "),
      field("NUMPAGES", "2"),
    ]).ToJSON(),
  ]);
  doc.SetValue("FirstPageHeader", [paragraph("First page")]);
  doc.SetValue("EvenPageFooter", [paragraph("Even footer")]);
  doc.SetValue("Footnotes", [
    { Id: "note-a", Blocks: [paragraph("Footnote explanation")] },
  ]);
  const data = await toDOCX(doc),
    zip = await JSZip.loadAsync(data);
  assert.ok(zip.file("word/footnotes.xml"));
  assert.match(
    await zip.file("word/document.xml")!.async("string"),
    /w:footnoteReference/,
  );
  assert.match(
    await zip.file("[Content_Types].xml")!.async("string"),
    /wordprocessingml.header\+xml/,
  );
  const imported = await fromDOCX(data);
  assert.equal(imported.Text, doc.Text);
  assert.equal(imported.GetValue("Headers")[0].children[0].text, "Header text");
  assert.equal(
    imported.GetValue("Footnotes")[0].Blocks[0].children[0].text,
    "Footnote explanation",
  );
  assert.equal(
    imported.GetValue("FirstPageHeader")[0].children[0].text,
    "First page",
  );
  assert.equal(
    imported.GetValue("EvenPageFooter")[0].children[0].text,
    "Even footer",
  );
  const fields = (imported.Blocks.Get(0) as Paragraph).Inlines.ToArray().filter(
    (x) => x.GetValue("Field"),
  );
  assert.equal(fields[0].GetValue("Field").Instruction, "PAGE");
});

test("DOCX native review annotations preserve comment/bookmark offsets, insertions and deleted rich fragments", async () => {
  const doc = new FlowDocument(new Paragraph(new Run("Alpha beta")));
  doc.SetValue("Annotations", [
    {
      Id: "c",
      Kind: "Comment",
      Start: 0,
      End: 5,
      Data: {
        Text: "Check alpha",
        Resolved: true,
        Author: "Reviewer",
        CreatedAt: "2026-09-13T12:00:00Z",
      },
    },
    { Id: "b", Kind: "Bookmark", Start: 6, End: 10, Data: { Name: "target" } },
    {
      Id: "i",
      Kind: "Insertion",
      Start: 6,
      End: 10,
      Data: { Author: "Writer" },
    },
    {
      Id: "d",
      Kind: "Deletion",
      Start: 5,
      End: 5,
      Data: {
        Author: "Writer",
        Text: " removed",
        Nodes: [paragraph(" removed")],
      },
    },
  ]);
  const data = await toDOCX(doc),
    zip = await JSZip.loadAsync(data),
    xml = await zip.file("word/document.xml")!.async("string");
  assert.match(xml, /w:commentRangeStart/);
  assert.match(xml, /w:bookmarkStart/);
  assert.match(xml, /<w:ins /);
  assert.match(xml, /<w:del /);
  const imported = await fromDOCX(data),
    annotations = imported.GetValue<any[]>("Annotations");
  assert.equal(imported.Text, "Alpha beta");
  assert.deepEqual(
    annotations
      .filter((x) => x.Kind === "Comment")
      .map((x) => [x.Start, x.End, x.Data.Text, x.Data.Author]),
    [[0, 5, "Check alpha", "Reviewer"]],
  );
  assert.deepEqual(
    annotations
      .filter((x) => x.Kind === "Bookmark")
      .map((x) => [x.Start, x.End, x.Data.Name]),
    [[6, 10, "target"]],
  );
  assert.deepEqual(
    annotations
      .filter((x) => x.Kind === "Insertion")
      .map((x) => [x.Start, x.End]),
    [[6, 10]],
  );
  assert.equal(
    annotations.find((x) => x.Kind === "Comment").Data.Resolved,
    true,
  );
  assert.equal(
    annotations.find((x) => x.Kind === "Deletion").Data.Text,
    " removed",
  );
  assert.equal(annotations.find((x) => x.Kind === "Deletion").Start, 5);
});

test("DOCX imports native complex field instructions and disables unsupported active fields on export", async () => {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> MERGEFIELD Customer </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Ada</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p><w:p><w:fldSimple w:instr="DDEAUTO unsafe"><w:r><w:t>cached</w:t></w:r></w:fldSimple></w:p></w:body></w:document>',
  );
  const doc = await fromDOCX(await zip.generateAsync({ type: "uint8array" }));
  assert.equal(doc.Text, "Ada\ncached");
  assert.equal(
    (doc.Blocks.Get(0) as Paragraph).Inlines.Get(0).GetValue("Field")
      .Instruction,
    "MERGEFIELD Customer",
  );
  const output = await JSZip.loadAsync(await toDOCX(doc));
  const xml = await output.file("word/document.xml")!.async("string");
  assert.match(xml, /MERGEFIELD Customer/);
  assert.doesNotMatch(xml, /DDEAUTO/);
  assert.match(xml, /cached/);
});

test("DOCX section properties round-trip without adding synthetic paragraphs to document text", async () => {
  const section = new Section(new Paragraph(new Run("Landscape section")));
  section.SetValue("SectionBreak", "continuous");
  section.SetValue("PageWidth", 1056);
  section.SetValue("PageHeight", 816);
  section.SetValue("ColumnCount", 2);
  section.SetValue("ColumnGap", 32);
  section.SetValue("Headers", [paragraph("Section header")]);
  const doc = new FlowDocument([
    section,
    new Paragraph(new Run("Final section")),
  ]);
  const imported = await fromDOCX(await toDOCX(doc));
  assert.equal(imported.Text, doc.Text);
  const first = imported.Blocks.Get(0);
  assert.equal(first.Type, "Section");
  assert.equal(first.GetValue("PageWidth"), 1056);
  assert.equal(first.GetValue("ColumnCount"), 2);
  assert.equal(first.GetValue("Headers")[0].children[0].text, "Section header");
});

test("DOCX preserves opaque chart drawing and inert dependency parts while excluding active attachments", async () => {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<Types><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>',
  );
  zip.file(
    "word/document.xml",
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><w:body><w:p><w:r><w:t>Chart:</w:t></w:r><w:r><w:drawing><a:graphic><a:graphicData><c:chart r:id="chartRel"/></a:graphicData></a:graphic></w:drawing></w:r></w:p></w:body></w:document>',
  );
  zip.file(
    "word/_rels/document.xml.rels",
    '<Relationships><Relationship Id="chartRel" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="charts/chart1.xml"/></Relationships>',
  );
  zip.file(
    "word/charts/chart1.xml",
    '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:title>Retained</c:title></c:chart></c:chartSpace>',
  );
  zip.file(
    "word/charts/_rels/chart1.xml.rels",
    '<Relationships><Relationship Id="bad" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="../embeddings/unsafe.bin"/></Relationships>',
  );
  zip.file("word/embeddings/unsafe.bin", "UNSAFE");
  zip.file("word/vbaProject.bin", "MACRO");
  const doc = await fromDOCX(await zip.generateAsync({ type: "uint8array" }));
  assert.equal(doc.Text, "Chart:");
  assert.ok(doc.GetValue("DocxPreservedParts").length >= 1);
  const output = await JSZip.loadAsync(await toDOCX(doc));
  assert.ok(output.file("rtw-preserved/word/charts/chart1.xml"));
  assert.doesNotMatch(
    await output
      .file("rtw-preserved/word/charts/_rels/chart1.xml.rels")!
      .async("string"),
    /oleObject/,
  );
  assert.equal(output.file("word/vbaProject.bin"), null);
  assert.equal(output.file("word/embeddings/unsafe.bin"), null);
  assert.match(
    await output.file("word/document.xml")!.async("string"),
    /c:chart/,
  );
  assert.match(
    await output.file("word/_rels/document.xml.rels")!.async("string"),
    /rtw-preserved\/word\/charts\/chart1.xml/,
  );
  const reimported = await fromDOCX(await toDOCX(doc));
  assert.equal(reimported.Text, "Chart:");
  const second = await JSZip.loadAsync(await toDOCX(reimported));
  assert.ok(second.file("rtw-preserved/word/charts/chart1.xml"));
});

test("DOCX comment replies and point annotations preserve native thread relationships", async () => {
  const doc = new FlowDocument(new Paragraph(new Run("target")));
  doc.SetValue("Annotations", [
    {
      Id: "parent",
      Kind: "Comment",
      Start: 0,
      End: 6,
      Data: { Text: "Parent", Author: "A" },
    },
    {
      Id: "reply",
      Kind: "Comment",
      Start: 0,
      End: 6,
      Data: { Text: "Reply", Author: "B", ParentId: "parent", Resolved: true },
    },
    { Id: "point", Kind: "Comment", Start: 6, End: 6, Data: { Text: "Point" } },
  ]);
  const data = await toDOCX(doc),
    imported = await fromDOCX(data),
    comments = imported
      .GetValue<any[]>("Annotations")
      .filter((a) => a.Kind === "Comment");
  const parent = comments.find((a) => a.Data.Text === "Parent"),
    reply = comments.find((a) => a.Data.Text === "Reply");
  assert.equal(reply.Data.ParentId, parent.Id);
  assert.equal(reply.Data.Resolved, true);
  assert.deepEqual(
    comments
      .filter((a) => a.Data.Text === "Point")
      .map((a) => [a.Start, a.End]),
    [[6, 6]],
  );
  // A native reply may inherit its parent's range and have no explicit body markers.
  const zip = await JSZip.loadAsync(data);
  let xml = await zip.file("word/document.xml")!.async("string");
  xml = xml
    .replace(/<w:commentRangeStart w:id="1"\/>/g, "")
    .replace(/<w:commentRangeEnd w:id="1"\/>/g, "")
    .replace(/<w:r><w:commentReference w:id="1"\/><\/w:r>/g, "");
  zip.file("word/document.xml", xml);
  const native = await fromDOCX(
    await zip.generateAsync({ type: "uint8array" }),
  );
  assert.equal(
    native.GetValue<any[]>("Annotations").filter((a) => a.Kind === "Comment")
      .length,
    3,
  );
});

test("DOCX exports and imports a native multiparagraph table of contents field", async () => {
  const toc = new Section([
    new Paragraph(new Run("Contents")),
    new Paragraph([new Run("Introduction "), field("PAGEREF intro", "2")]),
  ]);
  toc.SetValue("TableOfContents", {
    MaxLevel: 3,
    Title: "Contents",
    IncludePageNumbers: true,
  });
  const doc = new FlowDocument([toc, new Paragraph(new Run("Introduction"))]);
  const data = await toDOCX(doc),
    zip = await JSZip.loadAsync(data);
  const xml = await zip.file("word/document.xml")!.async("string");
  assert.match(xml, /TOC/);
  assert.match(xml, /PAGEREF intro/);
  const imported = await fromDOCX(data);
  assert.equal(imported.Text, doc.Text);
  assert.equal(imported.Blocks.Get(0).GetValue("TableOfContents").MaxLevel, 3);
  assert.equal(imported.Blocks.Get(0).Type, "Section");
});
