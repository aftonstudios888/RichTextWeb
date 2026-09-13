import { createElement, createRef, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { FlowDocument, Paragraph, Run } from "../src/model.js";
import { RichTextEditor, useDocumentRevision } from "../src/react.js";
import type { RichTextBox } from "../src/control.js";

const container = document.createElement("div");
container.id = "react-fixture";
document.body.append(container);
const root = createRoot(container);
let current = new FlowDocument(new Paragraph(new Run("React initial")));
let readOnly = false;
const ref = createRef<RichTextBox>();
let changes = 0;
let ready = 0;
const onDocumentChange = () => {
  changes++;
};
const onReady = () => {
  ready++;
};
function Status({ document }: { document: FlowDocument }) {
  const revision = useDocumentRevision(document);
  return createElement(
    "output",
    { id: "react-status" },
    `${revision}:${document.Text}`,
  );
}
function render() {
  flushSync(() =>
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(RichTextEditor, {
          ref,
          document: current,
          onDocumentChange,
          onReady,
          readOnly,
          viewMode: "continuous",
          zoom: 1.25,
          "aria-label": "React test document",
        }),
        createElement(Status, { document: current }),
      ),
    ),
  );
}
(window as any).richTextReactTest = {
  render,
  get control() {
    return ref.current;
  },
  get model() {
    return current;
  },
  get changes() {
    return changes;
  },
  get ready() {
    return ready;
  },
  replace() {
    current = new FlowDocument(new Paragraph(new Run("Replacement")));
    render();
  },
  setReadOnly(value: boolean) {
    readOnly = value;
    render();
  },
  unmount() {
    flushSync(() => root.unmount());
  },
};
render();
