import { createElement, createRef, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { FlowDocument, Paragraph, Run } from "../src/model.js";
import {
  RichTextEditor,
  RichTextPagedEditor,
  useDocumentRevision,
} from "../src/react.js";
import type { RichTextBox, RichTextPageEditor } from "../src/control.js";

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

(window as any).richTextReactTest.mountPaged = () => {
  const container = document.createElement("div");
  container.id = "react-page-fixture";
  document.body.append(container);
  const root = createRoot(container);
  const model = new FlowDocument();
  for (let index = 0; index < 120; index++)
    model.Blocks.Add(
      new Paragraph(`React page paragraph ${index}: text for measured layout.`),
    );
  model.PageWidth = 450;
  model.PageHeight = 400;
  model.PagePadding = 35;
  model.SetValue("ColumnCount", 2);
  const ref = createRef<RichTextPageEditor>();
  let mode: "page" | "continuous" = "page",
    virtualize = true,
    readOnly = false;
  let ready = 0,
    changes = 0,
    pages = 0,
    layouts = 0,
    virtualEvents = 0;
  const render = () =>
    flushSync(() =>
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(RichTextPagedEditor, {
            ref,
            document: model,
            viewMode: mode,
            enableVirtualization: virtualize,
            virtualizationThreshold: 10,
            virtualizationOverscan: 2,
            readOnly,
            style: { height: "560px" },
            "aria-label": "React paged document",
            onReady: (editor) => {
              if (!("Repaginate" in editor)) throw new Error("Wrong paged ref");
              ready++;
            },
            onDocumentChange: () => {
              changes++;
            },
            onPageChange: () => {
              pages++;
            },
            onPaginated: () => {
              layouts++;
            },
            onVirtualizationChange: () => {
              virtualEvents++;
            },
          }),
          createElement(Status, { document: model }),
        ),
      ),
    );
  (window as any).richTextReactPagedTest = {
    get control() {
      return ref.current;
    },
    get model() {
      return model;
    },
    get events() {
      return { ready, changes, pages, layouts, virtualEvents };
    },
    setMode(value: "page" | "continuous") {
      mode = value;
      render();
    },
    setVirtualization(value: boolean) {
      virtualize = value;
      render();
    },
    setReadOnly(value: boolean) {
      readOnly = value;
      render();
    },
    unmount() {
      flushSync(() => root.unmount());
      container.remove();
    },
  };
  render();
};
