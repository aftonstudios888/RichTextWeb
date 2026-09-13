import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  PDFDocument,
  PDFArray,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";
import { FlowDocument, type DocumentNode } from "../src/model.js";
import { toPDF, PDFEditor } from "../src/formats-pdf.js";

let id = 0;
const node = (
  type: string,
  props: Record<string, any> = {},
  children?: DocumentNode[],
  text?: string,
): DocumentNode => ({
  type,
  id: `pdf-test-${++id}`,
  props,
  ...(children ? { children } : {}),
  ...(text !== undefined ? { text } : {}),
});
const run = (text: string, props = {}) => node("Run", props, undefined, text);
const paragraph = (text: string, props = {}) =>
  node("Paragraph", props, [run(text)]);
const document = (...children: DocumentNode[]) =>
  FlowDocument.FromJSON(node("FlowDocument", {}, children));

async function content(bytes: Uint8Array): Promise<string> {
  const pdf = await PDFDocument.load(bytes);
  let result = "";
  for (const page of pdf.getPages()) {
    const contents = page.node.Contents();
    const streams =
      contents instanceof PDFArray
        ? contents.asArray().map((ref) => pdf.context.lookup(ref))
        : [contents];
    for (const stream of streams)
      if (stream instanceof PDFRawStream)
        result += Buffer.from(decodePDFRawStream(stream).decode()).toString(
          "latin1",
        );
  }
  return result;
}

async function textContent(bytes: Uint8Array): Promise<string> {
  return [...(await content(bytes)).matchAll(/<([0-9a-f]+)>\s*Tj/gi)]
    .map((match) => Buffer.from(match[1], "hex").toString("latin1"))
    .join("\n");
}

test("PDF export preserves selectable text and document metadata", async () => {
  const bytes = await toPDF(document(paragraph("Hello PDF")), {
    title: "Export validation",
    author: "RichTextWeb",
  });
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), "%PDF-");
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1);
  assert.equal(pdf.getTitle(), "Export validation");
  assert.equal(pdf.getAuthor(), "RichTextWeb");
  assert.match(await textContent(bytes), /Hello PDF/); // Actual text operators, not a raster image.
});

test("PDF text wrapping and explicit page breaks paginate", async () => {
  const bytes = await toPDF(
    document(
      paragraph("A long paragraph with wrapping. ".repeat(100)),
      paragraph("After break", { BreakPageBefore: true }),
    ),
    { pageWidth: 240, pageHeight: 240, margin: 20, pageNumbers: true },
  );
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 5);
  for (const page of pdf.getPages())
    assert.deepEqual(page.getSize(), { width: 240, height: 240 });
  const text = await textContent(bytes);
  assert.match(text, /After break/);
  assert.match(text, /1 \/ /);
});

test("PDF export renders styled text and embedded image drawing operators", async () => {
  const png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
  const bytes = await toPDF(
    document(
      node("Paragraph", { TextAlignment: "Center" }, [
        node("Bold", {}, [run("Bold")]),
        run(" normal ", {
          Foreground: "#225599",
          Background: "#ffff00",
          TextDecorations: "Underline",
        }),
        node("Image", { Source: png, Width: 32, Height: 32 }),
      ]),
    ),
  );
  const output = await content(bytes);
  assert.match(output, /\/Helvetica-Bold/);
  assert.match(output, /\/Image-.* Do/);
  assert.match(output, /\nh\nf\n/); // filled text background path
});

test("PDF tables split tall rows across pages while retaining text", async () => {
  const row = node("TableRow", {}, [
    node("TableCell", {}, [paragraph("Left ".repeat(300))]),
    node("TableCell", {}, [paragraph("Right value")]),
  ]);
  const bytes = await toPDF(
    document(node("Table", {}, [node("TableRowGroup", {}, [row])])),
    { pageWidth: 260, pageHeight: 220, margin: 20 },
  );
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() > 1);
  const output = await content(bytes);
  const extracted = await textContent(bytes);
  assert.equal((extracted.match(/Left/g) ?? []).length, 300);
  assert.match(extracted, /Right value/);
  assert.ok((output.match(/\nh\nS\n/g) ?? []).length >= pdf.getPageCount() * 2);
});

test("unsupported glyphs reject by default and replacement requires an explicit policy", async () => {
  const doc = document(paragraph("Hello 世界"));
  await assert.rejects(toPDF(doc), /cannot encode U\+4E16/);
  const warnings: string[] = [];
  const bytes = await toPDF(doc, {
    unsupportedGlyphs: "replace",
    onWarning: (warning) => warnings.push(warning),
  });
  assert.equal(warnings.length, 2);
  assert.match(await textContent(bytes), /Hello \?\?/);
});

test("unsupported table row spanning, remote images, and invalid page dimensions fail explicitly", async () => {
  const table = node("Table", {}, [
    node("TableRowGroup", {}, [
      node("TableRow", {}, [
        node("TableCell", { RowSpan: 2 }, [paragraph("spanned")]),
      ]),
    ]),
  ]);
  await assert.rejects(toPDF(document(table)), /RowSpan/);
  await assert.rejects(
    toPDF(
      document(
        node("Paragraph", {}, [
          node("Image", { Source: "https://example.com/image.png" }),
        ]),
      ),
    ),
    /remote image fetching/,
  );
  await assert.rejects(
    toPDF(document(paragraph("x")), { pageWidth: 20, margin: 20 }),
    /content width/,
  );
  await assert.rejects(
    toPDF(document(paragraph("x", { FontSize: 1000 })), {
      pageHeight: 200,
      margin: 20,
    }),
    /height/,
  );
});

test("PDF editor adds text and overlays and preserves the covered original text", async () => {
  const original = await toPDF(document(paragraph("Private original")));
  const editor = await PDFEditor.Load(original);
  await editor.AddText(0, "Approved", {
    x: 50,
    y: 50,
    bold: true,
    color: "#228844",
  });
  editor.Highlight(0, { x: 45, y: 45, width: 100, height: 20 });
  editor.CoverRegion(0, { x: 0, y: 0, width: 500, height: 800 });
  const output = await content(await editor.Save());
  assert.match(output, /<417070726F766564>/); // Approved
  assert.match(await textContent(await editor.Save()), /Private original/); // CoverRegion is not redaction.
  assert.match(output, /\/GS-.* gs/); // highlight transparency graphics state
});

test("PDF editor rotation, page reordering and deletion preserve page content and sizes", async () => {
  const editor = await PDFEditor.Create();
  editor.AddPage(200, 300);
  editor.AddPage(400, 500);
  editor.AddPage(600, 700);
  await editor.AddText(0, "First", { x: 10, y: 20 });
  await editor.AddText(2, "Third", { x: 10, y: 20 });
  editor.RotatePage(0, -90);
  editor.ReorderPages([2, 0, 1]);
  assert.deepEqual(
    editor.GetPages().map((p) => [p.width, p.rotation]),
    [
      [600, 0],
      [200, 270],
      [400, 0],
    ],
  );
  editor.DeletePages([2]);
  const saved = await editor.Save();
  const reopened = await PDFEditor.Load(saved);
  assert.equal(reopened.PageCount, 2);
  assert.deepEqual(
    reopened.GetPages().map((p) => p.width),
    [600, 200],
  );
  const output = await content(saved);
  assert.ok(output.indexOf("<5468697264>") < output.indexOf("<4669727374>"));
});

test("PDF editor validates mutations before changing pages", async () => {
  const editor = await PDFEditor.Create();
  await assert.rejects(editor.Save(), /at least one page/);
  editor.AddPage();
  editor.AddPage();
  assert.throws(() => editor.ReorderPages([0, 0]), /exactly once/);
  assert.throws(() => editor.ReorderPages([0, 9]), /page index/);
  assert.throws(() => editor.DeletePages([0, 9]), /page index/);
  assert.throws(() => editor.DeletePages([0, 1]), /retain at least one/);
  assert.throws(() => editor.RotatePage(0, 30), /multiple of 90/);
  assert.throws(
    () => editor.DrawRectangle(0, { x: 0, y: 0, width: -2, height: 2 }),
    /width/,
  );
  await assert.rejects(
    editor.AddText(0, "你好", { x: 0, y: 0 }),
    /unsupported/,
  );
  assert.equal(editor.PageCount, 2);
});

test("PDF editor imports selected pages and draws embedded image overlays", async () => {
  const source = await PDFEditor.Create();
  source.AddPage(100, 200);
  source.AddPage(300, 400);
  await source.AddText(1, "Imported", { x: 10, y: 10 });
  const sourceBytes = await source.Save();
  const editor = await PDFEditor.Create();
  editor.AddPage(500, 600);
  await editor.InsertPages(sourceBytes, [1], 0);
  await assert.rejects(
    editor.InsertPages(sourceBytes, [5]),
    /source page indices/,
  );
  assert.deepEqual(
    editor.GetPages().map((page) => page.width),
    [300, 500],
  );
  const png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
  await editor.AddImage(1, png, { x: 10, y: 30, width: 60 });
  const bytes = await editor.Save();
  assert.match(await textContent(bytes), /Imported/);
  assert.match(await content(bytes), /\/Image-.* Do/);
});

test("embedded custom fonts preserve Polish Unicode mappings and reject absent glyphs", async () => {
  const fontBytes = await readFile("tests/fixtures/pdf-test-font.ttf");
  const phrase = "Łódź — Zażółć gęślą jaźń";
  const bytes = await toPDF(document(paragraph(phrase)), { fontBytes });
  const pdf = await PDFDocument.load(bytes);
  let maps = "";
  for (const [, value] of pdf.context.enumerateIndirectObjects()) {
    if (value instanceof PDFRawStream) {
      const data = Buffer.from(decodePDFRawStream(value).decode()).toString(
        "latin1",
      );
      if (data.includes("begincmap")) maps += data;
    }
  }
  for (const codePoint of [
    "0141",
    "00f3",
    "017a",
    "017c",
    "0107",
    "0119",
    "015b",
    "0105",
    "0144",
  ])
    assert.ok(
      maps.toLowerCase().includes(`<${codePoint}>`),
      `Unicode map must retain ${codePoint}`,
    );
  await assert.rejects(
    toPDF(document(paragraph("世界")), { fontBytes }),
    /cannot encode U\+4E16/,
  );
  const editor = await PDFEditor.Load(bytes);
  await editor.AddText(0, phrase, { x: 40, y: 40, fontBytes });
  await assert.rejects(
    editor.AddText(0, "世界", { x: 40, y: 40, fontBytes }),
    /unsupported/,
  );
  assert.ok((await editor.Save()).length > bytes.length);
});
