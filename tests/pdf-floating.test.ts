import test from "node:test";
import assert from "node:assert/strict";
import { FlowDocument, type DocumentNode } from "../src/model.js";
import { toPDF, PDFEditor } from "../src/formats-pdf.js";
import { fromPDF } from "../src/pdf-import.js";
let serial = 0;
const n = (
  type: string,
  props: Record<string, any> = {},
  children?: DocumentNode[],
  text?: string,
): DocumentNode => ({
  id: `pdf-float-${++serial}`,
  type,
  props,
  ...(children ? { children } : {}),
  ...(text !== undefined ? { text } : {}),
});
const run = (text: string) => n("Run", {}, undefined, text);
const para = (...children: DocumentNode[]) => n("Paragraph", {}, children);
const story = (
  type: "Figure" | "Floater",
  props: Record<string, any>,
  ...children: DocumentNode[]
) => n(type, props, children);
const doc = (...children: DocumentNode[]) =>
  FlowDocument.FromJSON(n("FlowDocument", { FontSize: 16 }, children));
const settings = { pageWidth: 420, pageHeight: 480, margin: 30 };

test("PDF floating stories remain independent from main text and flow resumes at full width below them", async () => {
  const anchor = story(
    "Figure",
    {
      Width: 160,
      Height: 120,
      HorizontalAlignment: "Left",
      WrapStyle: "Square",
      WrapDistance: 12,
      Background: "#eaf2ff",
    },
    para(run("Figure story only.")),
  );
  const document = doc(
    para(
      run("Main before. "),
      anchor,
      run("Body content continues around the figure. ".repeat(25)),
    ),
  );
  assert.ok(document.Text.includes("\uFFFC"));
  assert.ok(!document.Text.includes("Figure story"));
  const bytes = await toPDF(document, settings),
    editor = await PDFEditor.Load(bytes),
    ops = (await editor.GetTextOperators()).operators;
  assert.equal(
    ops.filter((x) => x.text?.includes("Figure story only.")).length,
    1,
  );
  const body = ops.filter(
    (x) => x.text?.includes("Body content") || x.text?.includes("Main before"),
  );
  assert.ok(body.length > 5);
  assert.ok(body.some((x) => x.transform[4] >= 159)); // 30pt margin +120pt figure+9pt wrap gap.
  assert.ok(body.some((x) => Math.abs(x.transform[4] - 30) < 0.01)); // Width resumes after the floating box.
  const text = (await fromPDF(bytes)).Text;
  assert.match(text, /Figure story only/);
  assert.match(text, /Main before/);
  assert.equal((text.match(/Body content/g) ?? []).length, 25);
});

test("inline anchored stories reserve line width and retain all rich story content", async () => {
  const document = doc(
    para(
      run("Before "),
      story(
        "Floater",
        { Width: 100, WrapStyle: "Inline", BorderThickness: 1, Padding: 4 },
        para(run("Inline story")),
      ),
      run(" after."),
    ),
  );
  const editor = await PDFEditor.Load(await toPDF(document, settings)),
    ops = (await editor.GetTextOperators()).operators;
  assert.ok(ops.some((x) => x.text?.includes("Inline story")));
  assert.ok(ops.some((x) => x.text?.includes("Before")));
  assert.ok(ops.some((x) => x.text?.includes("after")));
  const before = ops.find((x) => x.text?.includes("Before"))!,
    after = ops.find((x) => x.text?.includes("after"))!;
  assert.ok(after.transform[4] - before.transform[4] > 75);
});

test("PDF anchored tables, lists, unit dimensions, rotation and foreground layering remain selectable", async () => {
  const table = n("Table", {}, [
    n("TableRowGroup", {}, [
      n("TableRow", {}, [
        n("TableCell", {}, [para(run("Cell A"))]),
        n("TableCell", {}, [para(run("Cell B"))]),
      ]),
    ]),
  ]);
  const anchor = story(
    "Figure",
    {
      Width: { Value: 0.6, FigureUnitType: "Content" },
      WrapStyle: "InFrontOfText",
      HorizontalAnchor: "ContentCenter",
      VerticalAnchor: "ParagraphTop",
      Rotation: 12,
      BorderThickness: 1,
      Background: "#fff8e8",
    },
    para(run("Heading")),
    table,
    n("List", { MarkerStyle: "Decimal" }, [
      n("ListItem", {}, [para(run("List item"))]),
    ]),
  );
  const editor = await PDFEditor.Load(
    await toPDF(
      doc(para(run("Main text under foreground."), anchor)),
      settings,
    ),
  );
  const ops = (await editor.GetTextOperators()).operators,
    raw = ops.map((x) => x.text).join("|");
  assert.match(raw, /Cell A/);
  assert.match(raw, /Cell B/);
  assert.match(raw.replace(/\|/g, ""), /1\. List item/);
  assert.ok(
    ops.findIndex((x) => x.text?.includes("Heading")) >
      ops.findIndex((x) => x.text?.includes("Main text")),
  );
  assert.ok(
    Math.abs(ops.find((x) => x.text?.includes("Heading"))!.transform[1]) > 0.1,
  );
});

test("TopAndBottom anchored blocks reserve vertical space and undersized figures reject explicitly", async () => {
  const anchor = story(
    "Figure",
    {
      Width: 160,
      Height: 100,
      WrapStyle: "TopAndBottom",
      HorizontalAlignment: "Center",
    },
    para(run("Top figure")),
  );
  const editor = await PDFEditor.Load(
    await toPDF(doc(para(anchor, run("Text after figure."))), settings),
  );
  const ops = (await editor.GetTextOperators()).operators;
  assert.ok(
    ops.find((x) => x.text?.includes("Top figure"))!.transform[5] -
      ops.find((x) => x.text?.includes("Text after"))!.transform[5] >
      65,
  );
  await assert.rejects(
    toPDF(
      doc(
        para(
          story(
            "Figure",
            { Width: 60, Height: 10 },
            para(run("Too much story content to fit.")),
          ),
        ),
      ),
      settings,
    ),
    /height is too small/,
  );
});
