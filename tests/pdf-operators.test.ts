import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  PDFDocument,
  PDFDict,
  PDFArray,
  PDFName,
  PDFRawStream,
  PDFStream,
  StandardFonts,
  decodePDFRawStream,
} from "pdf-lib";
import { PDFEditor } from "../src/formats-pdf.js";
import {
  inspectPDFText,
  replacePDFTextOperator,
} from "../src/pdf-operators.js";
import { PDFEditorControl } from "../src/pdf-control.js";
import { openPDFDocument, fromPDF } from "../src/pdf-import.js";
const N = PDFName.of;

/** Hand-authored PDF graphics syntax, independent of the RichTextWeb exporter. */
async function rawPDF(
  content: string | string[],
  options: {
    font?: Record<string, unknown>;
    extra?: (pdf: PDFDocument, resources: PDFDict) => void;
  } = {},
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([500, 500]);
  const font = pdf.context.obj({
    Type: "Font",
    Subtype: "Type1",
    BaseFont: "Helvetica",
    Encoding: "WinAnsiEncoding",
    ...options.font,
  } as any);
  const resources = pdf.context.obj({
    Font: { F1: pdf.context.register(font) },
  });
  options.extra?.(pdf, resources);
  page.node.set(N("Resources"), resources);
  const streams = (Array.isArray(content) ? content : [content]).map((text) =>
    pdf.context.register(
      pdf.context.flateStream(Uint8Array.from(text, (c) => c.charCodeAt(0))),
    ),
  );
  page.node.set(N("Contents"), pdf.context.obj(streams));
  return pdf.save();
}
async function items(
  bytes: Uint8Array,
  index = 0,
): Promise<{ text: string; transform: number[] }[]> {
  const handle = await openPDFDocument(bytes);
  try {
    const page = await handle.document.getPage(index + 1);
    const content = await page.getTextContent({ disableNormalization: true });
    return content.items
      .filter((x: any) => "str" in x)
      .map((x: any) => ({ text: x.str, transform: x.transform }));
  } finally {
    await handle.destroy();
  }
}
async function activeStreams(bytes: Uint8Array): Promise<string[]> {
  const pdf = await PDFDocument.load(bytes),
    result: string[] = [];
  for (const page of pdf.getPages()) {
    const c = page.node.Contents();
    for (const o of c instanceof PDFArray ? c.asArray() : c ? [c] : []) {
      const stream = pdf.context.lookup(o);
      if (stream instanceof PDFRawStream)
        result.push(
          Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1"),
        );
    }
  }
  return result;
}
function near(a: number, b: number): void {
  assert.ok(Math.abs(a - b) < 0.00001, `${a} differs from ${b}`);
}

test("source PDF replacement rewrites independently generated operators and embedded subset text", async () => {
  const editor = await PDFEditor.Load(
    await readFile("tests/fixtures/pdf-import-source.pdf"),
  );
  const inspected = await editor.GetTextOperators();
  assert.equal(inspected.diagnostics.length, 0);
  assert.equal(inspected.operators.length, 10);
  assert.ok(inspected.operators.every((x) => x.editable));
  const title = inspected.operators.find(
    (x) => x.text === "Independent PDF source",
  )!;
  await editor.ReplaceTextOperator(0, title.id, "Modified PDF source", {
    expectedText: title.text!,
  });
  const saved = await editor.Save(),
    extracted = await fromPDF(saved);
  assert.match(extracted.Text, /Modified PDF source/);
  assert.doesNotMatch(extracted.Text, /Independent PDF source/);
  const polish = (await editor.GetTextOperators(1)).operators[0];
  await editor.ReplaceTextOperator(1, polish.id, "Zażółć — Łódź");
  assert.match((await fromPDF(await editor.Save())).Text, /Zażółć — Łódź/);
  const raw = await activeStreams(saved);
  assert.ok(raw.every((x) => !x.includes("Independent PDF source")));
  assert.match(raw[0], /\[<4D6F646966696564/);
});

test("literal escapes, nested parentheses, comments, hex strings and TJ arrays are parsed as PDF syntax", async () => {
  const original = await rawPDF(
    "BT /F1 12 Tf 1 0 0 1 20 420 Tm (A\\(nested\\) (inner)\\040\\102\\\nC) Tj % fake (hidden) Tj\n [<2044> 35 ( E)] TJ ET",
  );
  const editor = await PDFEditor.Load(original),
    before = await editor.GetTextOperators();
  assert.deepEqual(
    before.operators.map((x) => x.text),
    ["A(nested) (inner) BC", " D E"],
  );
  await editor.ReplaceTextOperator(0, before.operators[0].id, "X (real)");
  assert.deepEqual(
    (await editor.GetTextOperators()).operators.map((x) => x.text),
    ["X (real)", " D E"],
  );
  assert.match(
    (await activeStreams(await editor.Save()))[0],
    /% fake \(hidden\) Tj/,
  );
});

test("shorter and longer replacements preserve following glyph positions, including spacing and scaling", async () => {
  const source = await rawPDF(
    "BT /F1 13 Tf 2 Tc 5 Tw 80 Tz 1 0 0 1 30 420 Tm [(A ) 40 (B)] TJ (TAIL) Tj ET",
  );
  const editor = await PDFEditor.Load(source),
    before = (await editor.GetTextOperators()).operators;
  const initialTail = before.find((x) => x.text === "TAIL")!;
  for (const replacement of ["Much longer text with spaces", "X", ""]) {
    const current = (await editor.GetTextOperators()).operators[0];
    await editor.ReplaceTextOperator(0, current.id, replacement);
    const tail = (await editor.GetTextOperators()).operators.find(
      (x) => x.text === "TAIL",
    )!;
    near(tail.transform[4], initialTail.transform[4]);
    near(tail.transform[5], initialTail.transform[5]);
  }
  const parsed = await items(await editor.Save());
  const tail = parsed.find((x) => x.text.replace(/\s/g, "") === "TAIL")!;
  near(tail.transform[4], initialTail.transform[4]);
});

test("single and double quote operators retain line movement and changed text spacing", async () => {
  const editor = await PDFEditor.Load(
    await rawPDF(
      "BT /F1 12 Tf 18 TL 1 0 0 1 20 450 Tm (First) Tj (Second) ' 4 1 (Third) \" (Tail) Tj ET",
    ),
  );
  const initial = (await editor.GetTextOperators()).operators;
  assert.deepEqual(
    initial.map((x) => x.operator),
    ["Tj", "'", '"', "Tj"],
  );
  await editor.ReplaceTextOperator(0, initial[1].id, "Second replacement");
  let current = (await editor.GetTextOperators()).operators;
  near(current[2].transform[5], 414);
  await editor.ReplaceTextOperator(0, current[2].id, "Third replacement");
  current = (await editor.GetTextOperators()).operators;
  near(current[3].transform[4], initial[3].transform[4]);
  near(current[3].transform[5], initial[3].transform[5]);
  const stream = (await activeStreams(await editor.Save()))[0];
  assert.match(stream, /4 Tw 1 Tc T\*/);
});

test("text state carries across page Contents streams and can explicitly move following text", async () => {
  const editor = await PDFEditor.Load(
    await rawPDF([
      "BT /F1 12 Tf 1 0 0 1 20 400 Tm (First) Tj",
      "(Second) Tj ET",
    ]),
  );
  const original = (await editor.GetTextOperators()).operators;
  assert.equal(original[1].text, "Second");
  await editor.ReplaceTextOperator(0, original[0].id, "A much longer first", {
    preserveAdvance: false,
  });
  const after = (await editor.GetTextOperators()).operators;
  assert.ok(after[1].transform[4] > original[1].transform[4] + 20);
  assert.match(
    (await fromPDF(await editor.Save())).Text,
    /A much longer firstSecond/,
  );
});

test("one occurrence of a shared nested Form XObject is replaced without changing other occurrences", async () => {
  const pdf = await PDFDocument.create(),
    font = pdf.context.register(
      pdf.context.obj({
        Type: "Font",
        Subtype: "Type1",
        BaseFont: "Helvetica",
        Encoding: "WinAnsiEncoding",
      }),
    );
  const leaf = pdf.context.flateStream(
    "BT /F1 12 Tf 1 0 0 1 0 0 Tm (Shared form) Tj ET",
    {
      Type: "XObject",
      Subtype: "Form",
      BBox: [0, -20, 200, 30],
      Resources: { Font: { F1: font } },
    },
  );
  const leafRef = pdf.context.register(leaf);
  const parent = pdf.context.register(
    pdf.context.flateStream("/Leaf Do", {
      Type: "XObject",
      Subtype: "Form",
      BBox: [0, -20, 200, 30],
      Resources: { XObject: { Leaf: leafRef } },
    }),
  );
  for (const y of [350, 250]) {
    const page = pdf.addPage([500, 500]);
    page.node.set(
      N("Resources"),
      pdf.context.obj({ XObject: { Box: parent } }),
    );
    page.node.set(
      N("Contents"),
      pdf.context.register(
        pdf.context.flateStream(
          `q 1 0 0 1 20 ${y} cm /Box Do Q q 1 0 0 1 20 150 cm /Box Do Q`,
        ),
      ),
    );
  }
  const editor = await PDFEditor.Load(await pdf.save()),
    original = (await editor.GetTextOperators()).operators;
  assert.equal(original.length, 4);
  assert.ok(original.every((x) => x.inForm));
  await editor.ReplaceTextOperator(0, original[0].id, "Local edit");
  const updated = (await editor.GetTextOperators()).operators;
  assert.deepEqual(
    updated.map((x) => x.text),
    ["Local edit", "Shared form", "Shared form", "Shared form"],
  );
  assert.match(
    (await items(await editor.Save(), 0)).map((x) => x.text).join("|"),
    /Local edit.*Shared form/,
  );
  assert.deepEqual(
    (await items(await editor.Save(), 1))
      .filter((x) => x.text)
      .map((x) => x.text),
    ["Shared form", "Shared form"],
  );
});

test("Encoding Differences and font widths preserve custom single-byte glyph selection", async () => {
  const editor = await PDFEditor.Load(
    await rawPDF("BT /F1 12 Tf 1 0 0 1 20 400 Tm (A) Tj (B) Tj ET", {
      font: {
        Encoding: {
          BaseEncoding: "WinAnsiEncoding",
          Differences: [65, "aacute"],
        },
      },
    }),
  );
  const before = (await editor.GetTextOperators()).operators;
  assert.equal(before[0].text, "á");
  await editor.ReplaceTextOperator(0, before[0].id, "áá");
  const after = (await editor.GetTextOperators()).operators;
  assert.equal(after[0].text, "áá");
  near(after[1].transform[4], before[1].transform[4]);
  assert.match((await activeStreams(await editor.Save()))[0], /\[<4141>/);
});

test("replacement fonts extend an original subset without moving following original-font text", async () => {
  const editor = await PDFEditor.Load(
    await rawPDF("BT /F1 12 Tf 1 0 0 1 20 400 Tm (Before) Tj (TAIL) Tj ET"),
  );
  const before = (await editor.GetTextOperators()).operators;
  await assert.rejects(
    editor.ReplaceTextOperator(0, before[0].id, "Łódź"),
    /cannot encode/,
  );
  assert.equal((await editor.GetTextOperators()).operators[0].text, "Before");
  await editor.ReplaceTextOperator(0, before[0].id, "Łódź", {
    fontBytes: await readFile("tests/fixtures/pdf-test-font.ttf"),
  });
  const after = (await editor.GetTextOperators()).operators;
  assert.equal(after[0].text, "Łódź");
  assert.equal(after[1].fontName, "Helvetica");
  near(after[1].transform[4], before[1].transform[4]);
  assert.match((await fromPDF(await editor.Save())).Text, /Łódź/);
  await editor.AddText(0, "After source rewrite", { x: 40, y: 40 });
  assert.match(
    (await fromPDF(await editor.Save())).Text,
    /After source rewrite/,
  );
});

test("replacement with a different standard font is scoped and retains original advance", async () => {
  const editor = await PDFEditor.Load(
    await rawPDF("BT /F1 12 Tf 1 0 0 1 20 400 Tm (Original) Tj (TAIL) Tj ET"),
  );
  const before = (await editor.GetTextOperators()).operators;
  await editor.ReplaceTextOperator(0, before[0].id, "Courier", {
    standardFont: StandardFonts.CourierBold,
  });
  const after = (await editor.GetTextOperators()).operators;
  assert.equal(after[0].fontName, "Courier-Bold");
  assert.equal(after[1].fontName, "Helvetica");
  near(after[1].transform[4], before[1].transform[4]);
});

test("literal replace matches across TJ string fragments, counts occurrences, and preflights all changes", async () => {
  const editor = await PDFEditor.Load(
    await rawPDF(
      "BT /F1 12 Tf 1 0 0 1 20 400 Tm [(Hel) -10 (lo Hello)] TJ 0 -20 Td (hello) Tj ET",
    ),
  );
  const result = await editor.ReplaceSourceText("hello", "Done");
  assert.deepEqual(result, { operatorsChanged: 2, occurrences: 3, pages: [0] });
  assert.deepEqual(
    (await editor.GetTextOperators()).operators.map((x) => x.text),
    ["Done Done", "Done"],
  );
  const first = await editor.ReplaceSourceText("Done", "Only once", {
    all: false,
  });
  assert.equal(first.occurrences, 1);
  await assert.rejects(
    editor.ReplaceSourceText("Done", "世界"),
    /cannot encode/,
  );
  assert.deepEqual(
    (await editor.GetTextOperators()).operators.map((x) => x.text),
    ["Only once Done", "Done"],
  );
});

test("stale operator ids, incorrect expected text, newlines and malformed replacements reject", async () => {
  const editor = await PDFEditor.Load(
    await rawPDF("BT /F1 12 Tf 1 0 0 1 20 400 Tm (Original) Tj ET"),
  );
  const original = (await editor.GetTextOperators()).operators[0];
  await assert.rejects(
    editor.ReplaceTextOperator(0, original.id, "X", { expectedText: "Other" }),
    /source text changed/,
  );
  await assert.rejects(
    editor.ReplaceTextOperator(0, original.id, "X\nY"),
    /single line/,
  );
  await editor.ReplaceTextOperator(0, original.id, "Current");
  await assert.rejects(
    editor.ReplaceTextOperator(0, original.id, "Stale"),
    /stale/,
  );
  assert.equal((await editor.GetTextOperators()).operators[0].text, "Current");
});

test("unsupported fonts, inline images and ActualText semantics are reported instead of silently misedited", async () => {
  const actual = await PDFEditor.Load(
    await rawPDF(
      "BT /F1 12 Tf /Span << /ActualText (Semantic original) >> BDC (Painted) Tj EMC ET",
    ),
  );
  const item = (await actual.GetTextOperators()).operators[0];
  assert.equal(item.editable, false);
  assert.match(item.reason!, /ActualText/);
  await assert.rejects(
    actual.ReplaceTextOperator(0, item.id, "Replacement"),
    /ActualText/,
  );
  const inline = await PDFEditor.Load(
    await rawPDF("q BI /W 1 /H 1 /BPC 8 /CS /G ID x EI Q"),
  );
  assert.match(
    (await inline.GetTextOperators()).diagnostics[0].message,
    /inline-image/,
  );
  await assert.rejects(
    inline.ReplaceSourceText("x", "y"),
    /cannot inspect all source text/,
  );
  const unsupported = await PDFEditor.Load(
    await rawPDF("BT /F1 12 Tf (Unknown) Tj ET", {
      font: { BaseFont: "Custom", Encoding: "UnknownEncoding" },
    }),
  );
  assert.equal(
    (await unsupported.GetTextOperators()).operators[0].editable,
    false,
  );
  await assert.rejects(
    unsupported.ReplaceSourceText("Unknown", "y"),
    /no usable ToUnicode/,
  );
  assert.equal(
    (
      await unsupported.ReplaceSourceText("Unknown", "y", {
        allowPartial: true,
      })
    ).occurrences,
    0,
  );
});

test("reusable PDF control edits original text, searches modified content, and restores source through undo/redo", async () => {
  const control = new PDFEditorControl();
  await control.Load(
    await rawPDF("BT /F1 12 Tf 1 0 0 1 20 400 Tm (Original) Tj ET"),
  );
  const inspected = await control.InspectSourceText();
  assert.equal(control.SelectedTextOperator?.text, "Original");
  await control.ReplaceTextOperator(0, inspected.operators[0].id, "Edited");
  assert.equal((await control.Find("Original")).length, 0);
  assert.equal((await control.Find("Edited")).length, 1);
  await control.Undo();
  assert.equal(
    (await control.GetTextOperators()).operators[0].text,
    "Original",
  );
  await control.Redo();
  assert.equal((await control.GetTextOperators()).operators[0].text, "Edited");
  await control.ReplaceSourceText("Edited", "Final");
  assert.equal((await control.GetTextOperators()).operators[0].text, "Final");
  control.IsReadOnly = true;
  await assert.rejects(
    control.ReplaceSourceText("Final", "Forbidden"),
    /read-only/,
  );
  await control.Dispose();
});

test("multiple occurrences of the same page stream reference are edited independently", async () => {
  const pdf = await PDFDocument.create(),
    page = pdf.addPage([500, 500]);
  page.node.set(
    N("Resources"),
    pdf.context.obj({
      Font: {
        F1: {
          Type: "Font",
          Subtype: "Type1",
          BaseFont: "Helvetica",
          Encoding: "WinAnsiEncoding",
        },
      },
    }),
  );
  const ref = pdf.context.register(
    pdf.context.flateStream(
      "BT /F1 12 Tf 1 0 0 1 20 400 Tm (Shared stream) Tj ET",
    ),
  );
  page.node.set(N("Contents"), pdf.context.obj([ref, ref]));
  const editor = await PDFEditor.Load(await pdf.save()),
    before = (await editor.GetTextOperators()).operators;
  await editor.ReplaceTextOperator(0, before[1].id, "Second only");
  assert.deepEqual(
    (await editor.GetTextOperators()).operators.map((x) => x.text),
    ["Shared stream", "Second only"],
  );
});

test("failed replacement-font encoding leaves the complete resource graph unchanged", async () => {
  const editor = await PDFEditor.Load(
    await rawPDF("BT /F1 12 Tf 1 0 0 1 20 400 Tm (Original) Tj ET"),
  );
  const before = await editor.Save(),
    operator = (await editor.GetTextOperators()).operators[0];
  await assert.rejects(
    editor.ReplaceTextOperator(0, operator.id, "世界", {
      fontBytes: await readFile("tests/fixtures/pdf-test-font.ttf"),
    }),
    /cannot encode/,
  );
  assert.deepEqual(await editor.Save(), before);
});

test("identical source replacement creates no history entry and does not normalize existing TJ kerning", async () => {
  const control = new PDFEditorControl();
  await control.Load(await rawPDF("BT /F1 12 Tf [(A) 80 (V)] TJ ET"));
  const before = await control.Save(),
    operator = (await control.GetTextOperators()).operators[0];
  assert.equal(
    (await control.ReplaceTextOperator(0, operator.id, "AV")).operatorsChanged,
    0,
  );
  assert.equal(control.CanUndo, false);
  assert.deepEqual(await control.Save(), before);
  await control.Dispose();
});

test("CID Identity-H and ToUnicode ranges use glyph widths while multi-byte code32 ignores word spacing", async () => {
  const source = await rawPDF(
    "BT /F1 12 Tf 9 Tw 1 0 0 1 20 400 Tm <002000210022> Tj <0023> Tj ET",
    {
      extra(pdf, resources) {
        const unicode = pdf.context.register(
          pdf.context.flateStream(
            "begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange 1 beginbfrange <0020> <0023> <0041> endbfrange endcmap",
          ),
        );
        const font = pdf.context.obj({
          Type: "Font",
          Subtype: "Type0",
          BaseFont: "TestCID",
          Encoding: "Identity-H",
          ToUnicode: unicode,
          DescendantFonts: [
            {
              Type: "Font",
              Subtype: "CIDFontType2",
              BaseFont: "TestCID",
              CIDSystemInfo: {
                Registry: "Adobe",
                Ordering: "Identity",
                Supplement: 0,
              },
              DW: 500,
              W: [32, [500, 600, 700, 800]],
            },
          ],
        });
        resources.set(N("Font"), pdf.context.obj({ F1: font }));
      },
    },
  );
  const editor = await PDFEditor.Load(source),
    before = (await editor.GetTextOperators()).operators;
  assert.equal(before[0].text, "ABC");
  near(before[1].transform[4], 41.6);
  await editor.ReplaceTextOperator(0, before[0].id, "ABCC");
  const after = (await editor.GetTextOperators()).operators;
  assert.equal(after[0].text, "ABCC");
  near(after[1].transform[4], 41.6);
});

test("ToUnicode semantics do not override actual simple-font glyph widths or Encoding Differences", async () => {
  const pdf = await PDFDocument.load(
    await rawPDF("BT /F1 12 Tf 1 0 0 1 20 400 Tm (A) Tj (B) Tj ET", {
      extra(pdf, resources) {
        const cmap = pdf.context.register(
          pdf.context.flateStream(
            "begincmap 2 beginbfchar <41> <0057> <42> <0049> endbfchar endcmap",
          ),
        );
        const font = pdf.context.obj({
          Type: "Font",
          Subtype: "Type1",
          BaseFont: "Helvetica",
          Encoding: {
            BaseEncoding: "WinAnsiEncoding",
            Differences: [65, "aacute"],
          },
          ToUnicode: cmap,
        });
        resources.set(N("Font"), pdf.context.obj({ F1: font }));
      },
    }),
  );
  const original = (await inspectPDFText(pdf)).operators;
  assert.equal(original[0].text, "W");
  near(original[1].transform[4], 20 + 556 * 0.012); // glyph aacute, not semantic Unicode W.
  await replacePDFTextOperator(pdf, 0, original[0].id, "WW");
  const decoded = await items(await pdf.save()),
    tail = decoded.find((x) => x.text === "I")!;
  near(tail.transform[4], original[1].transform[4]);
});

test("operator fingerprints reject changed font resources and preceding stream text state", async () => {
  const pdf = await PDFDocument.load(
    await rawPDF(["BT /F1 12 Tf 1 0 0 1 20 400 Tm", "(Original) Tj ET"]),
  );
  const original = (await inspectPDFText(pdf)).operators[0],
    page = pdf.getPage(0);
  const fonts = page.node.Resources()!.lookup(N("Font"), PDFDict),
    font = fonts.lookup(N("F1"), PDFDict);
  font.set(N("BaseFont"), N("Courier"));
  assert.notEqual((await inspectPDFText(pdf)).operators[0].id, original.id);
  await assert.rejects(
    replacePDFTextOperator(pdf, 0, original.id, "Stale font"),
    /stale/,
  );
  const current = (await inspectPDFText(pdf)).operators[0],
    contents = page.node.Contents() as PDFArray;
  contents.set(
    0,
    pdf.context.register(
      pdf.context.flateStream("BT /F1 24 Tf 1 0 0 1 20 400 Tm"),
    ),
  );
  await assert.rejects(
    replacePDFTextOperator(pdf, 0, current.id, "Stale state"),
    /stale/,
  );
});

test("concurrent source edits serialize and reject stale targets without losing a committed edit", async () => {
  const editor = await PDFEditor.Load(
      await rawPDF("BT /F1 12 Tf (First) Tj (Second) Tj ET"),
    ),
    before = (await editor.GetTextOperators()).operators;
  const results = await Promise.allSettled([
    editor.ReplaceTextOperator(0, before[0].id, "ONE"),
    editor.ReplaceTextOperator(0, before[1].id, "TWO"),
  ]);
  assert.deepEqual(
    results.map((x) => x.status),
    ["fulfilled", "rejected"],
  );
  assert.match(String((results[1] as PromiseRejectedResult).reason), /stale/);
  assert.deepEqual(
    (await editor.GetTextOperators()).operators.map((x) => x.text),
    ["ONE", "Second"],
  );
  await editor.ReplaceSourceText("Second", "TWO");
  assert.deepEqual(
    (await editor.GetTextOperators()).operators.map((x) => x.text),
    ["ONE", "TWO"],
  );
});

test("source staging detects concurrent page and overlay mutations without overwriting them", async () => {
  const editor = await PDFEditor.Load(
    await rawPDF("BT /F1 12 Tf (Original) Tj ET"),
  );
  async function beginPausedEdit(operatorId: string) {
    const source = (editor as unknown as { pdf: PDFDocument }).pdf;
    const save = source.save.bind(source);
    let started!: () => void, release!: () => void;
    const snapshotReady = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Suspend a real serialized snapshot at the asynchronous boundary, ensuring
    // the concurrent mutation occurs after source staging has actually started.
    source.save = async (options) => {
      const snapshot = await save(options);
      started();
      await gate;
      return snapshot;
    };
    const pending = editor.ReplaceTextOperator(0, operatorId, "Replacement");
    await snapshotReady;
    source.save = save;
    return { pending, release };
  }
  const operator = (await editor.GetTextOperators()).operators[0];
  const first = await beginPausedEdit(operator.id);
  editor.RotatePage(0, 90);
  first.release();
  await assert.rejects(first.pending, /changed during the source edit/);
  assert.equal(editor.GetPages()[0].rotation, 90);
  assert.equal((await editor.GetTextOperators()).operators[0].text, "Original");
  const original = (await editor.GetTextOperators()).operators[0];
  const second = await beginPausedEdit(original.id);
  await editor.AddText(0, "Concurrent overlay", { x: 40, y: 40 });
  second.release();
  await assert.rejects(second.pending, /changed during the source edit|stale/);
  assert.ok(
    (await editor.GetTextOperators()).operators.some(
      (x) => x.text === "Concurrent overlay",
    ),
  );
});

test("oversized compressed content fails terminally before decoder allocation exceeds its bound", async () => {
  const pdf = await PDFDocument.create(),
    page = pdf.addPage([100, 100]);
  const content = new Uint8Array(64 * 1024 * 1024 + 1);
  content.fill(32);
  page.node.set(
    N("Contents"),
    pdf.context.register(pdf.context.flateStream(content)),
  );
  await assert.rejects(inspectPDFText(pdf), /64 MiB limit/);
});
