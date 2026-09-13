import { createInterface } from "node:readline";
import {
  FlowDocument,
  Paragraph,
  Run,
  RichTextEngine,
  RichTextWebBridge,
} from "../../../dist/esm/index.js";
const engine = new RichTextEngine(
  new FlowDocument(new Paragraph(new Run("Native bridge document"))),
);
const bridge = new RichTextWebBridge(
  engine,
  (value) => process.stdout.write(JSON.stringify(value) + "\n"),
  { includeDocumentInEvents: true },
);
createInterface({ input: process.stdin })
  .on("line", (line) => bridge.Receive(line))
  .on("close", () => {
    bridge.Dispose();
    engine.Dispose();
  });
bridge.NotifyReady();
