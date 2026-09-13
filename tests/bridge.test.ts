import test from "node:test";
import assert from "node:assert/strict";
import { BridgeProtocol, RichTextWebBridge } from "../src/bridge.js";
import { RichTextEngine } from "../src/engine.js";
import { Figure, FlowDocument, Paragraph, Run, Table } from "../src/model.js";

const paragraph = (text: string) => new Paragraph(new Run(text));
const request = (method: string, params: Record<string, unknown> = {}) => ({
  ...BridgeProtocol,
  kind: "request",
  id: "structural",
  method,
  params,
});
const call = (
  bridge: RichTextWebBridge,
  method: string,
  params: Record<string, unknown> = {},
) => {
  const response = bridge.HandleMessage(request(method, params));
  assert.equal(response.error, undefined, JSON.stringify(response.error));
  return response.result;
};
const snapshot = (engine: RichTextEngine) => ({
  document: engine.Document.ToJSON(),
  revision: engine.Document.Revision,
  undo: engine.CanUndo,
  redo: engine.CanRedo,
  selection: [engine.Selection.Start.Offset, engine.Selection.End.Offset],
});

test("bridge moves rich selections and contiguous blocks through explicit and .NET command forms", () => {
  const engine = new RichTextEngine(
    new FlowDocument(paragraph("one two three")),
  );
  const bridge = new RichTextWebBridge(engine, () => {});
  engine.Select(4, 7);
  engine.ApplyProperty("FontWeight", "Bold");
  engine.TrackChanges = true;
  call(bridge, "moveSelection", {
    destination: 13,
    expectedRevision: engine.Document.Revision,
  });
  assert.equal(engine.Document.Text, "one  threetwo");
  assert.equal(engine.Revisions[0]!.Kind, "Move");
  engine.Select(10, 13);
  assert.equal(engine.GetProperty("FontWeight"), "Bold");
  call(bridge, "execute", { command: "RejectAllRevisions" });
  assert.equal(engine.Document.Text, "one two three");
  engine.Select(4, 7);
  call(bridge, "execute", {
    command: "EditingCommands.MoveSelection",
    parameter: { Destination: 13 },
  });
  assert.equal(engine.Document.Text, "one  threetwo");
  bridge.Dispose();
  engine.Dispose();

  const [a, b, c] = [paragraph("a"), paragraph("b"), paragraph("c")];
  const blocks = new RichTextEngine(new FlowDocument([a!, b!, c!]));
  const blockBridge = new RichTextWebBridge(blocks, () => {});
  call(blockBridge, "moveBlocks", {
    ids: [a!.Id],
    parentId: blocks.Document.Id,
    index: 3,
  });
  assert.equal(blocks.Document.Text, "b\nc\na");
  assert.equal(blocks.Document.Blocks.Get(2), a);
  call(blockBridge, "execute", {
    command: "MoveBlocks",
    parameter: { Ids: [a!.Id], ParentId: blocks.Document.Id, Index: 0 },
  });
  assert.equal(blocks.Document.Text, "a\nb\nc");
  const before = snapshot(blocks);
  assert.ok(
    blockBridge.HandleMessage(
      request("moveBlocks", {
        ids: [a!.Id, c!.Id],
        parentId: blocks.Document.Id,
        index: 1,
      }),
    ).error,
  );
  assert.deepEqual(snapshot(blocks), before);
  blockBridge.Dispose();
  blocks.Dispose();
});

test("bridge applies element/table/cell properties and merges and splits actual table geometry", () => {
  const engine = new RichTextEngine(new FlowDocument(paragraph("")));
  engine.InsertTable(2, 3);
  const table = engine.Document.Blocks.ToArray().find(
    (node) => node.Type === "Table",
  ) as Table;
  const row = table.RowGroups.Get(0).Rows.Get(0),
    cell = row.Cells.Get(0);
  const bridge = new RichTextWebBridge(engine, () => {});
  engine.Select(0);
  call(bridge, "setTableProperty", { name: "CellSpacing", value: 4 });
  assert.equal(table.CellSpacing, 4);
  call(bridge, "setCellProperty", { name: "Background", value: "#aabbcc" });
  assert.equal(cell.Background, "#aabbcc");
  call(bridge, "setElementProperty", {
    id: cell.Id,
    name: "Background",
    value: null,
  });
  assert.equal(cell.GetValue("Background"), null);
  call(bridge, "execute", {
    command: "SetElementProperty",
    parameter: { Id: table.Id, Name: "CellSpacing", Value: 6 },
  });
  assert.equal(table.CellSpacing, 6);
  call(bridge, "execute", {
    command: "SetTableProperty",
    parameter: { Name: "CellSpacing", Value: 8 },
  });
  call(bridge, "execute", {
    command: "SetCellProperty",
    parameter: { Name: "Background", Value: "#123456" },
  });
  assert.equal(table.CellSpacing, 8);
  assert.equal(cell.Background, "#123456");
  call(bridge, "mergeTableCells", { count: 2 });
  assert.equal(row.Cells.Count, 2);
  assert.equal(row.Cells.Get(0).ColumnSpan, 2);
  call(bridge, "splitTableCell");
  assert.equal(row.Cells.Count, 3);
  assert.equal(row.Cells.Get(0).ColumnSpan, 1);
  call(bridge, "execute", { command: "MergeTableCells", parameter: 2 });
  call(bridge, "execute", { command: "SplitTableCell" });
  assert.equal(row.Cells.Count, 3);
  bridge.Dispose();
  engine.Dispose();
});

test("bridge replaces floating stories with canonical rich blocks, mapped annotations and tracked undo", () => {
  const figure = new Figure(paragraph("inside"));
  const engine = new RichTextEngine(
    new FlowDocument(
      new Paragraph([new Run("before"), figure, new Run("after")]),
    ),
  );
  engine.EditFloatingContent(figure.Id, (story) => {
    story.Select(0, 6);
    story.AddComment("keep this", "Author");
  });
  const bridge = new RichTextWebBridge(engine, () => {});
  engine.TrackChanges = true;
  const blocks = figure.ToJSON().children!;
  blocks[0]!.children![0]!.text = "inside story";
  blocks[0]!.children![0]!.props.FontWeight = "Bold";
  call(bridge, "editFloatingContent", {
    id: figure.Id,
    blocks,
    expectedRevision: engine.Document.Revision,
  });
  assert.equal(engine.Document.Text, "before\uFFFCafter");
  assert.equal(figure.StoryText, "inside story");
  assert.equal(
    figure.Blocks.Get(0).Children[0]!.GetValue("FontWeight"),
    "Bold",
  );
  const annotations = figure.GetValue("StoryAnnotations") as Array<{
    Data: { Text: string };
    Start: number;
    End: number;
  }>;
  assert.equal(annotations.length, 1);
  assert.equal(annotations[0]!.Data.Text, "keep this");
  assert.ok(
    annotations[0]!.Start >= 0 &&
      annotations[0]!.End <= figure.StoryText.length,
  );
  assert.equal(engine.Revisions.at(-1)!.Kind, "Structural");
  call(bridge, "execute", { command: "RejectAllRevisions" });
  assert.equal(figure.StoryText, "inside");
  call(bridge, "undo");
  assert.equal(figure.StoryText, "inside story");
  engine.TrackChanges = false;
  call(bridge, "execute", {
    command: "EditFloatingContent",
    parameter: {
      Id: figure.Id,
      Blocks: [paragraph("native replacement").ToJSON()],
    },
  });
  assert.equal(figure.StoryText, "native replacement");
  assert.equal(engine.Document.Text, "before\uFFFCafter");
  bridge.Dispose();
  engine.Dispose();
});

test("every structured bridge method and command alias rejects read-only and stale edits before mutation", () => {
  const engine = new RichTextEngine(new FlowDocument(paragraph("unchanged")));
  let readOnly = false;
  const bridge = new RichTextWebBridge(engine, () => {}, {
    isReadOnly: () => readOnly,
  });
  const methods = [
    "moveSelection",
    "moveBlocks",
    "setElementProperty",
    "setTableProperty",
    "setCellProperty",
    "mergeTableCells",
    "splitTableCell",
    "editFloatingContent",
  ];
  const before = snapshot(engine);
  for (const method of methods) {
    for (const generic of [false, true]) {
      const params = generic
        ? { command: method[0]!.toUpperCase() + method.slice(1) }
        : {};
      readOnly = true;
      assert.equal(
        bridge.HandleMessage(request(generic ? "execute" : method, params))
          .error?.code,
        "read_only",
        method,
      );
      readOnly = false;
      assert.equal(
        bridge.HandleMessage(
          request(generic ? "execute" : method, {
            ...params,
            expectedRevision: engine.Document.Revision + 1,
          }),
        ).error?.code,
        "revision_conflict",
        method,
      );
      assert.deepEqual(snapshot(engine), before);
    }
  }
  bridge.Dispose();
  engine.Dispose();
});

test("floating bridge rejects invalid categories, duplicate or foreign IDs and budget overruns atomically", () => {
  const outside = paragraph("outside"),
    figure = new Figure(paragraph("inside"));
  const engine = new RichTextEngine(
    new FlowDocument([outside, new Paragraph(figure)]),
  );
  const bridge = new RichTextWebBridge(engine, () => {});
  const valid = paragraph("new").ToJSON();
  const duplicate = structuredClone(valid);
  duplicate.children![0]!.id = duplicate.id;
  const unknown = structuredClone(valid);
  unknown.type = "Unknown" as typeof unknown.type;
  for (const blocks of [
    [new Run("illegal block").ToJSON()],
    [duplicate],
    [outside.ToJSON()],
    [unknown],
  ]) {
    const before = snapshot(engine);
    assert.equal(
      bridge.HandleMessage(
        request("editFloatingContent", { id: figure.Id, blocks }),
      ).error?.code,
      "invalid_document",
    );
    assert.deepEqual(snapshot(engine), before);
    assert.equal(figure.StoryText, "inside");
  }
  const invalidTarget = snapshot(engine);
  assert.equal(
    bridge.HandleMessage(
      request("editFloatingContent", { id: outside.Id, blocks: [valid] }),
    ).error?.code,
    "invalid_params",
  );
  assert.deepEqual(snapshot(engine), invalidTarget);
  for (const limits of [{ maxDocumentNodes: 2 }, { maxDocumentDepth: 1 }]) {
    const limited = new RichTextWebBridge(engine, () => {}, limits),
      before = snapshot(engine);
    assert.equal(
      limited.HandleMessage(
        request("editFloatingContent", { id: figure.Id, blocks: [valid] }),
      ).error?.code,
      "document_too_large",
    );
    assert.deepEqual(snapshot(engine), before);
    limited.Dispose();
  }
  bridge.Dispose();
  engine.Dispose();
});

test("structured property and argument validation cannot be bypassed through Execute", () => {
  const engine = new RichTextEngine(new FlowDocument(paragraph("text")));
  const bridge = new RichTextWebBridge(engine, () => {}),
    before = snapshot(engine);
  const invalid = [
    request("moveSelection", { destination: -1 }),
    request("moveSelection", { destination: 0.5 }),
    request("moveBlocks", {
      ids: ["a", "a"],
      parentId: engine.Document.Id,
      index: 0,
    }),
    request("setElementProperty", {
      id: engine.Document.Id,
      name: "constructor",
      value: {},
    }),
    request("setTableProperty", { name: "CellSpacing" }),
    request("mergeTableCells", { count: 1 }),
    request("execute", {
      command: "SetElementProperty",
      parameter: { Id: engine.Document.Id, Name: "__proto__", Value: {} },
    }),
    request("execute", {
      command: "SetCellProperty",
      parameter: { Name: "Background" },
    }),
    request("execute", { command: "MergeTableCells", parameter: "two" }),
    request("execute", { command: "MoveSelection", parameter: 100 }),
  ];
  for (const envelope of invalid) {
    assert.equal(
      bridge.HandleMessage(envelope).error?.code,
      "invalid_params",
      JSON.stringify(envelope),
    );
    assert.deepEqual(snapshot(engine), before);
  }
  bridge.Dispose();
  engine.Dispose();
});
