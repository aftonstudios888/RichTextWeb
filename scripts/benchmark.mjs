/** Repeatable local workload measurements; results are environment-specific, not performance guarantees. */
import { performance } from "node:perf_hooks";
import os from "node:os";
import {
  FlowDocument,
  Paragraph,
  Run,
  RichTextEngine,
} from "../dist/esm/core.js";
import { toHTML, toMarkdown, toDOCX, toPDF } from "../dist/esm/formats.js";

const argument = process.argv.find((value) => /^--paragraphs=/.test(value));
const count = argument ? Number(argument.split("=")[1]) : 1000;
if (!Number.isSafeInteger(count) || count < 1 || count > 100000)
  throw new RangeError("--paragraphs must be an integer from 1 to 100000");
const create = () =>
  new FlowDocument(
    Array.from(
      { length: count },
      (_, index) =>
        new Paragraph(
          new Run(
            `Sample paragraph ${index + 1}. RichTextWeb document editing and portable text formatting.`,
          ),
        ),
    ),
  );
const rows = [];
async function measure(operation, action, repetitions = 3) {
  const samples = [];
  for (let iteration = 0; iteration < repetitions; iteration++) {
    const start = performance.now();
    await action();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  rows.push({
    operation,
    repetitions,
    medianMs: Number(samples[Math.floor(samples.length / 2)].toFixed(3)),
    minMs: Number(samples[0].toFixed(3)),
    maxMs: Number(samples.at(-1).toFixed(3)),
  });
}
// Small warmup initializes module and code paths without hiding a full-size document run.
new RichTextEngine(new FlowDocument(new Paragraph("warmup"))).Dispose();
await measure("Construct model and index IDs", () => {
  create();
});
const document = create();
const json = document.ToJSON();
const engine = new RichTextEngine(document);
await measure("Serialize canonical JSON", () =>
  JSON.stringify(document.ToJSON()),
);
await measure("Parse canonical JSON", () => FlowDocument.FromJSON(json));
await measure(
  "Insert 5 characters and undo",
  () => {
    engine.Select(Math.floor(document.Text.length / 2));
    engine.InsertText("hello");
    engine.Undo();
  },
  5,
);
let matches = 0;
await measure(
  "Find all paragraph occurrences",
  () => {
    matches = engine.Find("paragraph").length;
  },
  5,
);
if (matches !== count)
  throw new Error(
    `Search benchmark found ${matches} matches, expected ${count}`,
  );
await measure("Format 100 characters and undo", () => {
  engine.Select(0, Math.min(100, document.Text.length));
  engine.ApplyProperty("FontWeight", "Bold");
  engine.Undo();
});
await measure("Export HTML", () => toHTML(document));
await measure("Export Markdown", () => toMarkdown(document));
let docxBytes = 0,
  pdfBytes = 0;
await measure(
  "Export DOCX",
  async () => {
    docxBytes = (await toDOCX(document)).byteLength;
  },
  1,
);
await measure(
  "Export PDF",
  async () => {
    pdfBytes = (await toPDF(document)).byteLength;
  },
  1,
);
engine.Dispose();
const report = {
  environment: {
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    cpu: os.cpus()[0]?.model ?? "unknown",
  },
  workload: {
    paragraphs: count,
    utf16Characters: document.Text.length,
    searchMatches: matches,
    docxBytes,
    pdfBytes,
  },
  measurements: rows,
  note: "Local wall-clock timings include allocation and undo work where named. Three samples are not a statistical performance study. This does not measure browser layout, typing latency on devices, font shaping, or large-session memory stability.",
};
if (process.argv.includes("--json"))
  console.log(JSON.stringify(report, null, 2));
else {
  console.log(
    JSON.stringify(
      { environment: report.environment, workload: report.workload },
      null,
      2,
    ),
  );
  console.table(rows);
  console.log(report.note);
}
