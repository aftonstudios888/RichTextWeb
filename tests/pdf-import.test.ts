import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { extractPDF, fromPDF } from "../src/pdf-import.js";
import { PDFEditorControl } from "../src/pdf-control.js";
import { RichTextEngine } from "../src/engine.js";
import { toPDF } from "../src/formats-pdf.js";

const fixture = () => readFile("tests/fixtures/pdf-import-source.pdf");

test("independently generated PDF reconstructs searchable text, styles and source geometry", async () => {
  const source = await fixture();
  const result = await extractPDF(source);
  assert.equal(result.pages.length, 3);
  assert.equal(result.metadata.Title, "Independent PDF fixture");
  assert.match(result.document.Text, /Independent PDF source/);
  assert.match(result.document.Text, /Café/);
  assert.match(result.document.Text, /Łódź/);
  const first = result.pages[0];
  assert.equal(first.width, 612);
  assert.equal(first.height, 792);
  assert.ok(
    first.text.indexOf("Left column third") <
      first.text.indexOf("Right column first"),
  );
  assert.ok(
    first.text.indexOf("Independent PDF source") <
      first.text.indexOf("Drawn first"),
  );
  const title = first.lines
    .flatMap((line) => line.runs)
    .find((run) => run.text.includes("Independent"))!;
  assert.equal(title.bold, true);
  assert.equal(title.fontSize, 20);
  assert.equal(title.x, 48);
  assert.equal(title.transform.length, 6);
  assert.ok(first.lines.flatMap((line) => line.runs).some((run) => run.italic));
  assert.equal(result.pages[1].rotation, 90);
  assert.notEqual(result.pages[1].width, result.pages[1].displayWidth);
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes("Page 3 contains no extractable text"),
    ),
  );
  assert.equal(source.subarray(0, 4).toString(), "%PDF"); // worker ownership does not detach caller bytes.
  const json = result.document.ToJSON();
  assert.equal(json.props.PDFReconstructed, true);
  assert.equal(json.props.PDFSourcePages.length, 3);
  assert.equal(json.props.PageWidth, 816);
  const pageSections = json.children!;
  assert.equal(pageSections[1].props.PDFPageRotation, 90);
  assert.ok(pageSections[0].children![0].children![0].props.PDFGeometry);
});

test("PDF content-order option, limits, abort and malformed source behavior are explicit", async () => {
  const source = await fixture();
  const content = await extractPDF(source, { readingOrder: "content" });
  assert.match(content.pages[0].text, /^Drawn first/);
  await assert.rejects(extractPDF(source, { maxPages: 1 }), /maxPages/);
  await assert.rejects(extractPDF(source, { maxTextItems: 1 }), /maxTextItems/);
  await assert.rejects(
    extractPDF(source, { maxPages: 0 }),
    /positive integers/,
  );
  const signal = AbortSignal.abort(new Error("cancelled by test"));
  await assert.rejects(extractPDF(source, { signal }), /cancelled by test/);
  await assert.rejects(extractPDF(new Uint8Array([1, 2, 3, 4])), /PDF|Invalid/);
});

test("reconstructed flow text is editable by the shared engine and exports as a new PDF", async () => {
  const source = await fixture();
  const document = await fromPDF(source, { preservePageBreaks: false });
  const engine = new RichTextEngine(document);
  engine.Select(0, 0);
  engine.InsertText("Edited flow. ");
  assert.match(document.Text, /^Edited flow\./);
  const bytes = await toPDF(document, {
    fontBytes: await readFile("tests/fixtures/pdf-test-font.ttf"),
  });
  const parsed = await PDFDocument.load(bytes);
  assert.ok(parsed.getPageCount() >= 1);
  const restored = await fromPDF(bytes);
  assert.match(restored.Text, /Edited flow/);
  assert.match(restored.Text, /Łódź/);
  assert.equal(source.subarray(0, 4).toString(), "%PDF");
});

test("reusable PDF control supports headless page edits, undo, search, reconstruction and readonly", async () => {
  const control = new PDFEditorControl();
  await control.Load(await fixture());
  assert.equal(control.PageCount, 3);
  const matches = await control.Find("Left column");
  assert.equal(matches.length, 3);
  await control.AddText(0, "Overlay marker", { x: 40, y: 30 });
  assert.equal(control.CanUndo, true);
  assert.match((await fromPDF(await control.Save())).Text, /Overlay marker/);
  await control.Undo();
  assert.doesNotMatch(
    (await fromPDF(await control.Save())).Text,
    /Overlay marker/,
  );
  await control.Redo();
  assert.match((await fromPDF(await control.Save())).Text, /Overlay marker/);
  await control.DeletePages([2]);
  assert.equal(control.PageCount, 2);
  control.IsReadOnly = true;
  await assert.rejects(control.AddPage(), /read-only/);
  assert.throws(() => {
    control.PageIndex = 50;
  }, /page index/);
  const flow = await control.ImportToFlowDocument();
  assert.equal(control.ViewMode, "flow");
  assert.match(flow.Text, /Overlay marker/);
  assert.equal(control.FlowDocument, flow);
  await control.Dispose();
  await assert.rejects(control.Save(), /disposed/);
});
