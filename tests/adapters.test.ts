import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { FlowDocument, Paragraph, Run } from "../src/model.js";
import { RichTextEngine } from "../src/engine.js";
import {
  AsyncRelayCommand,
  BindCommand,
  Binding,
  BindingMode,
  CompositeDisposable,
  ObservableObject,
  RelayCommand,
  Subscription,
} from "../src/mvvm.js";
import {
  BridgeProtocol,
  RichTextWebBridge,
  connectScriptHost,
  connectWebView2,
  parseBridgeRequest,
} from "../src/bridge.js";
import type { BridgeOutgoingMessage } from "../src/bridge.js";
import { RichTextEditor } from "../src/react.js";

const observable = <T extends Record<string, unknown>>(values: T) =>
  new ObservableObject(values) as ObservableObject & T;
const doc = (text = "hello") => new FlowDocument(new Paragraph(new Run(text)));
const request = (method: string, params: Record<string, unknown> = {}) => ({
  ...BridgeProtocol,
  kind: "request",
  id: "test",
  method,
  params,
});

test("ObservableObject change equality, CLR-style accessors and disposal", () => {
  class ViewModel extends ObservableObject {
    get Title() {
      return this.GetProperty("Title", "");
    }
    set Title(value: string) {
      this.SetProperty("Title", value);
    }
  }
  const vm = new ViewModel();
  const names: string[] = [];
  vm.PropertyChanged.Subscribe((e) => names.push(e.PropertyName));
  vm.Title = "A";
  vm.Title = "A";
  vm.Title = "B";
  assert.equal(vm.Title, "B");
  assert.deepEqual(names, ["Title", "Title"]);
  assert.throws(() => vm.DefineProperty("__proto__", {}));
  vm.Dispose();
  assert.throws(() => {
    vm.Title = "C";
  }, /disposed/);
});

test("nested two-way binding reattaches subscriptions and disposes every listener", () => {
  const original = observable({ Title: "first" });
  const replacement = observable({ Title: "second" });
  const vm = observable({ Child: original });
  const target = observable({ Text: "" });
  const binding = new Binding({
    Source: vm,
    Path: "Child.Title",
    Mode: BindingMode.TwoWay,
  }).Attach(target, "Text");
  assert.equal(target.Text, "first");
  target.Text = "edited";
  assert.equal(original.Title, "edited");
  vm.Child = replacement;
  assert.equal(target.Text, "second");
  original.Title = "detached";
  assert.equal(target.Text, "second");
  replacement.Title = "active";
  assert.equal(target.Text, "active");
  binding.Dispose();
  target.Text = "unbound";
  assert.equal(replacement.Title, "active");
  replacement.Title = "after dispose";
  assert.equal(target.Text, "unbound");
});

test("binding converters, one-time and one-way-to-source modes have precise direction", () => {
  const vm = observable({ Count: 2 });
  const target = observable({ Text: "7" });
  const binding = new Binding({
    Source: vm,
    Path: "Count",
    Mode: BindingMode.TwoWay,
    Converter: { Convert: String, ConvertBack: Number },
  }).Attach(target, "Text");
  assert.equal(target.Text, "2");
  target.Text = "3";
  assert.equal(vm.Count, 3);
  binding.Dispose();
  const snapshot = new Binding({
    Source: vm,
    Path: "Count",
    Mode: BindingMode.OneTime,
  }).Attach(target, "Text");
  vm.Count = 9;
  assert.equal(target.Text, 3);
  snapshot.Dispose();
  const sourceOnly = new Binding({
    Source: vm,
    Path: "Count",
    Mode: BindingMode.OneWayToSource,
    Converter: { Convert: String, ConvertBack: Number },
  }).Attach(target, "Text");
  assert.equal(vm.Count, 3);
  vm.Count = 10;
  assert.equal(target.Text, 3);
  target.Text = "21";
  assert.equal(vm.Count, 21);
  sourceOnly.Dispose();
  assert.throws(
    () => new Binding({ Source: vm, Path: "constructor.prototype" }),
  );
});

test("DOM-style document binding pushes a replaced document back to the source", () => {
  class Editor extends EventTarget {
    Document = doc();
  }
  const vm = observable({ Document: doc("source") });
  const editor = new Editor();
  const binding = Binding.SetBinding(editor, "Document", {
    Source: vm,
    Path: "Document",
    Mode: BindingMode.TwoWay,
  });
  assert.equal(editor.Document, vm.Document);
  editor.Document = doc("user");
  editor.dispatchEvent(new Event("documentchange"));
  assert.equal(vm.Document.Text, "user");
  binding.Dispose();
});

test("relay commands honor can-execute and button subscriptions dispose", () => {
  let allowed = false;
  let total = 0;
  const command = new RelayCommand<number>(
    (n) => {
      total += n ?? 1;
    },
    () => allowed,
  );
  const button = Object.assign(new EventTarget(), { disabled: false });
  const binding = BindCommand(button, command, 2);
  assert.equal(button.disabled, true);
  button.dispatchEvent(new Event("click"));
  assert.equal(total, 0);
  allowed = true;
  command.NotifyCanExecuteChanged();
  assert.equal(button.disabled, false);
  button.dispatchEvent(new Event("click"));
  assert.equal(total, 2);
  binding.Dispose();
  button.dispatchEvent(new Event("click"));
  assert.equal(total, 2);
  command.Dispose();
  assert.equal(command.CanExecute(), false);
});

test("async relay commands prevent overlap, expose errors and support cancellation", async () => {
  let executions = 0;
  let release!: () => void;
  const command = new AsyncRelayCommand(async (_, signal) => {
    executions++;
    await new Promise<void>((resolve, reject) => {
      release = resolve;
      signal.addEventListener("abort", () => reject(new Error("cancelled")), {
        once: true,
      });
    });
  });
  const first = command.Execute();
  await Promise.resolve();
  assert.equal(command.IsRunning, true);
  await command.Execute();
  assert.equal(executions, 1);
  release();
  await first;
  assert.equal(command.IsRunning, false);
  const second = command.Execute();
  await Promise.resolve();
  command.Cancel();
  await assert.rejects(second, /cancelled/);
  assert.match(String(command.Error), /cancelled/);
  assert.equal(command.IsRunning, false);
  command.Dispose();
});

test("composite disposal runs all cleanup and disposes late additions", () => {
  const composite = new CompositeDisposable();
  const calls: number[] = [];
  composite.Add(
    new Subscription(() => {
      calls.push(1);
      throw Error("fail");
    }),
  );
  composite.Add(new Subscription(() => calls.push(2)));
  assert.throws(() => composite.Dispose(), AggregateError);
  composite.Add(new Subscription(() => calls.push(3)));
  composite.Dispose();
  assert.deepEqual(calls, [1, 2, 3]);
});

test("bridge validated commands edit the shared engine and emit serializable events", () => {
  const engine = new RichTextEngine(doc());
  const messages: BridgeOutgoingMessage[] = [];
  const bridge = new RichTextWebBridge(
    engine,
    (message) => messages.push(message),
    { includeDocumentInEvents: true },
  );
  assert.deepEqual(bridge.HandleMessage(request("getText")).result, "hello");
  assert.equal(
    bridge.HandleMessage(request("select", { start: 0, end: 5 })).error,
    undefined,
  );
  assert.equal(
    bridge.Receive(JSON.stringify(request("insertText", { text: "world" })))
      .error,
    undefined,
  );
  assert.equal(engine.Document.Text, "world");
  assert.ok(
    messages.some(
      (message) =>
        message.kind === "event" && message.event === "documentChanged",
    ),
  );
  assert.ok(
    messages.some(
      (message) => message.kind === "response" && message.id === "test",
    ),
  );
  assert.doesNotThrow(() => JSON.stringify(messages));
  bridge.HandleMessage(request("undo"));
  assert.equal(engine.Document.Text, "hello");
  bridge.HandleMessage(request("redo"));
  assert.equal(engine.Document.Text, "world");
  const count = messages.length;
  bridge.Dispose();
  engine.InsertText("!");
  assert.equal(messages.length, count);
  assert.equal(
    bridge.HandleMessage(request("getText")).error?.code,
    "disposed",
  );
  engine.Dispose();
});

test("bridge rejects stale revisions, read-only writes and invalid offsets without edits", () => {
  const engine = new RichTextEngine(doc());
  let readOnly = false;
  const bridge = new RichTextWebBridge(engine, () => {}, {
    isReadOnly: () => readOnly,
  });
  assert.equal(
    bridge.HandleMessage(
      request("insertText", {
        text: "x",
        expectedRevision: engine.Document.Revision + 1,
      }),
    ).error?.code,
    "revision_conflict",
  );
  assert.equal(
    bridge.HandleMessage(request("select", { start: -1, end: 10 })).error?.code,
    "invalid_params",
  );
  readOnly = true;
  assert.equal(
    bridge.HandleMessage(request("insertText", { text: "x" })).error?.code,
    "read_only",
  );
  assert.equal(
    bridge.HandleMessage(request("execute", { command: "ToggleBold" })).error
      ?.code,
    "read_only",
  );
  assert.equal(bridge.HandleMessage(request("getText")).result, "hello");
  assert.equal(engine.Document.Text, "hello");
  bridge.Dispose();
  engine.Dispose();
});

test("bridge bounds JSON and rejects polluted, cyclic or malformed documents", () => {
  assert.throws(() => parseBridgeRequest("{bad"));
  assert.throws(() =>
    parseBridgeRequest(
      JSON.stringify({ ...request("getText"), params: { value: 1 } }),
      3,
    ),
  );
  assert.throws(() =>
    parseBridgeRequest(
      '{"channel":"richtextweb","version":1,"kind":"request","id":"a","method":"getText","params":{"__proto__":{}}}',
    ),
  );
  const circular = request("getText");
  circular.params.self = circular;
  assert.throws(() => parseBridgeRequest(circular), /Cyclic/);
  const engine = new RichTextEngine(doc());
  const bridge = new RichTextWebBridge(engine, () => {});
  const duplicate = doc().ToJSON();
  duplicate.children![0]!.id = duplicate.id;
  assert.equal(
    bridge.HandleMessage(request("setDocument", { document: duplicate })).error
      ?.code,
    "invalid_document",
  );
  assert.equal(
    bridge.HandleMessage(
      request("setDocument", {
        document: { ...doc().ToJSON(), type: "Unknown" },
      }),
    ).error?.code,
    "invalid_document",
  );
  assert.equal(
    bridge.HandleMessage(request("Dispose")).error?.code,
    "unknown_method",
  );
  assert.equal(engine.Document.Text, "hello");
  bridge.Dispose();
  engine.Dispose();
});

test("script and WebView2 attachments remove their installed receiver and listeners", () => {
  const engine = new RichTextEngine(doc());
  const globalObject: Record<string, unknown> = {};
  const sent: string[] = [];
  const script = connectScriptHost(engine, globalObject, (value) =>
    sent.push(value),
  );
  assert.equal(typeof globalObject.receiveRichTextWebMessage, "function");
  assert.equal(JSON.parse(sent[0]!).event, "ready");
  (globalObject.receiveRichTextWebMessage as (input: unknown) => void)(
    request("getText"),
  );
  assert.equal(JSON.parse(sent.at(-1)!).result, "hello");
  assert.throws(
    () => connectScriptHost(engine, globalObject, () => {}),
    /already installed/,
  );
  script.Dispose();
  assert.equal(globalObject.receiveRichTextWebMessage, undefined);
  const listeners = new Set<(e: { data: unknown }) => void>();
  const outputs: unknown[] = [];
  const webview = connectWebView2(engine, {
    postMessage: (value) => outputs.push(value),
    addEventListener: (_, fn) => {
      listeners.add(fn);
    },
    removeEventListener: (_, fn) => {
      listeners.delete(fn);
    },
  });
  assert.equal(listeners.size, 1);
  [...listeners][0]!({ data: request("getText") });
  assert.equal((outputs.at(-1) as { result: string }).result, "hello");
  webview.Dispose();
  assert.equal(listeners.size, 0);
  engine.Dispose();
});

test("React adapter renders on the server without HTMLElement or customElements", () => {
  const html = renderToString(
    createElement(RichTextEditor, {
      document: doc("server"),
      "aria-label": "Shared document",
      readOnly: true,
    }),
  );
  assert.match(html, /rich-text-box/);
  assert.match(html, /aria-label="Shared document"/);
  assert.doesNotMatch(html, /\[object Object\]/);
});
