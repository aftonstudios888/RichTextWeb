import test from "node:test";
import assert from "node:assert/strict";
import {
  CollaborativeDocumentSession,
  CollaborationConflictError,
  type RichDocumentOperation,
} from "../src/collaboration.js";
import {
  FlowDocument,
  Paragraph,
  Run,
  Table,
  TableColumn,
  TableRowGroup,
  TableRow,
  TableCell,
  Section,
  Image,
  type DocumentNode,
} from "../src/model.js";
import { RichTextEngine } from "../src/engine.js";
const paragraph = (id: string, text = id): DocumentNode => ({
  type: "Paragraph",
  id,
  props: {},
  children: [{ type: "Run", id: `${id}-run`, props: {}, text }],
});
const root = (): DocumentNode => ({
  type: "FlowDocument",
  id: "root",
  props: {},
  children: [paragraph("first", "abcd"), paragraph("last", "tail")],
});
const session = (ActorId: string, Document = root()) =>
  new CollaborativeDocumentSession({
    DocumentId: "rich-test",
    ActorId,
    Document,
  });
const deliver = (
  replicas: CollaborativeDocumentSession[],
  operations: RichDocumentOperation[],
) => {
  replicas.forEach((replica, index) => {
    const order = index % 2 ? operations : [...operations].reverse();
    order.forEach((operation) => replica.Receive(operation));
  });
  assert.deepEqual(replicas[0].DocumentJSON, replicas[1].DocumentJSON);
};

test("rich replicas merge concurrent paragraphs, images, and independent properties", () => {
  const a = session("alice"),
    b = session("bob");
  const x = a.InsertNode("root", 1, paragraph("alice-paragraph", "Alice"));
  const y = b.InsertNode("first", 1, {
    type: "Image",
    id: "bob-image",
    props: { Source: "https://example.test/image.png", Width: 40 },
  });
  const p = a.SetProperty("first", "TextAlignment", "Center");
  const q = b.SetProperty("first", "Margin", 12);
  deliver([a, b], [x, y, p, q]);
  assert.equal(a.Document.Blocks.Count, 3);
  assert.equal(a.Document.FindById("bob-image")?.Type, "Image");
  assert.equal(
    a.Document.FindById("first")?.GetValue("TextAlignment"),
    "Center",
  );
  assert.equal(a.Document.FindById("first")?.GetValue("Margin"), 12);
});
test("rich same-run edits use character CRDTs and retain concurrent insertions", () => {
  const a = session("alice"),
    b = session("bob");
  const x = a.ReplaceText("first-run", 1, 3, "AL")!,
    y = b.ReplaceText("first-run", 2, 2, "BO")!;
  deliver([a, b], [x, y]);
  assert(a.Text.includes("AL") && a.Text.includes("BO"));
  assert.equal(a.Receive(y), "duplicate");
});
test("tables replicate independent row, cell, and column structures", () => {
  const table = new Table(
    new TableRowGroup(
      new TableRow(new TableCell(new Paragraph(new Run("cell")))),
    ),
  );
  table.Columns.Add(new TableColumn(100));
  const doc = root();
  doc.children!.push(table.ToJSON());
  const a = session("alice", doc),
    b = session("bob", doc),
    group = table.RowGroups.at(0)!;
  const row = new TableRow(new TableCell(new Paragraph(new Run("new row"))));
  const x = a.InsertNode(group.Id, 1, row.ToJSON()),
    column = new TableColumn(200),
    y = b.InsertNode(table.Id, 1, column.ToJSON(), "Columns");
  deliver([a, b], [x, y]);
  const result = a.Document.FindById(table.Id) as Table;
  assert.equal(result.RowGroups.at(0)!.Rows.Count, 2);
  assert.equal(result.Columns.Count, 2);
});
test("concurrent moves that form a cycle resolve deterministically without losing sections", () => {
  const doc = root();
  doc.children = [
    { type: "Section", id: "A", props: {}, children: [paragraph("a")] },
    { type: "Section", id: "B", props: {}, children: [paragraph("b")] },
  ];
  const a = session("alice", doc),
    b = session("bob", doc);
  const x = a.MoveNode("A", "B", 1),
    y = b.MoveNode("B", "A", 1);
  deliver([a, b], [x, y]);
  assert(a.Document.FindById("A"));
  assert(a.Document.FindById("B"));
  assert(a.Text.includes("a") && a.Text.includes("b"));
});
test("deleted ordering anchors retain concurrent insertion positions", () => {
  const a = session("alice"),
    b = session("bob"),
    x = a.RemoveNode("first"),
    y = b.InsertNode("root", 1, paragraph("middle"));
  deliver([a, b], [x, y]);
  assert.deepEqual(
    a.DocumentJSON.children!.map((node) => node.id),
    ["middle", "last"],
  );
  assert(a.Statistics.TombstonedNodes >= 2);
});
test("subtree deletion wins over unseen descendants until causally restored", () => {
  const doc = root();
  doc.children![0] = {
    type: "Section",
    id: "container",
    props: {},
    children: [paragraph("inside")],
  };
  const a = session("alice", doc),
    b = session("bob", doc),
    x = a.RemoveNode("container"),
    y = b.InsertNode("container", 1, paragraph("concurrent"));
  deliver([a, b], [x, y]);
  assert.equal(a.Document.FindById("concurrent"), null);
  const restore = a.RestoreNodes(["container", "inside", "inside-run"]);
  b.Receive(restore);
  assert(a.Document.FindById("concurrent"));
  assert.deepEqual(a.DocumentJSON, b.DocumentJSON);
});
test("out-of-order rich transactions queue causally and snapshots resume offline edits", () => {
  const a = session("alice"),
    b = session("bob"),
    x = a.InsertNode("root", 0, paragraph("new")),
    y = a.ReplaceText("new-run", 0, 3, "NEW")!;
  assert.equal(b.Receive(y), "queued");
  assert.equal(b.PendingCount, 1);
  b.Receive(x);
  assert.equal(b.PendingCount, 0);
  const snapshot = b.ExportSnapshot();
  snapshot.Operations.reverse();
  const c = CollaborativeDocumentSession.FromSnapshot(snapshot, "carol");
  assert.deepEqual(c.DocumentJSON, a.DocumentJSON);
  const z = c.SetProperty("new", "TextAlignment", "Right");
  deliver([a, b, c], [z]);
});
test("rich transaction validation is atomic and detects tampering and invalid causal references", () => {
  const a = session("alice"),
    b = session("bob"),
    valid = a.SetProperty("first", "TextAlignment", "Center"),
    before = b.DocumentJSON;
  const malformed = structuredClone(valid);
  malformed.Actions.push({
    Kind: "Move",
    NodeId: "last",
    ParentId: "first-run",
    Collection: "Children",
    After: null,
  });
  assert.throws(() => b.Receive(malformed), CollaborationConflictError);
  assert.deepEqual(b.DocumentJSON, before);
  assert.deepEqual(b.VersionVector, {});
  b.Receive(valid);
  assert.throws(
    () =>
      b.Receive({
        ...valid,
        Actions: [
          {
            Kind: "Property",
            NodeId: "first",
            Name: "TextAlignment",
            Value: "Right",
          },
        ],
      }),
    /reused/,
  );
  const inserted = a.InsertNode("root", 1, paragraph("inserted"));
  b.Receive(inserted);
  const injection: RichDocumentOperation = {
    ...valid,
    ActorId: "mallory",
    Sequence: 1,
    Clock: 1,
    Dependencies: { mallory: 0 },
    Actions: [
      { Kind: "Property", NodeId: "inserted", Name: "FontSize", Value: 20 },
    ],
  };
  assert.throws(() => b.Receive(injection), /causal/);
});
test("checkpoint requires all actors, compacts tombstones, and rejects old epoch replay", () => {
  const a = session("alice"),
    b = session("bob"),
    x = a.RemoveNode("first"),
    y = b.SetProperty("last", "FontSize", 19);
  deliver([a, b], [x, y]);
  assert.throws(
    () => a.CreateCheckpoint({ alice: a.VersionVector }),
    /Every known/,
  );
  const checkpoint = a.CreateCheckpoint({
    alice: a.VersionVector,
    bob: b.VersionVector,
  });
  a.AdoptCheckpoint(checkpoint);
  b.AdoptCheckpoint(checkpoint);
  assert.equal(a.Statistics.Operations, 0);
  assert.equal(a.Statistics.TombstonedNodes, 0);
  assert.deepEqual(a.DocumentJSON, b.DocumentJSON);
  assert.throws(() => a.Receive(x), /epoch/);
  assert.equal(a.ResyncRequired, true);
  const edit = b.ReplaceText("last-run", 4, 4, "!")!;
  a.Receive(edit);
  assert.equal(a.Text, "tail!");
});
test("checkpoint cannot discard edits made after acknowledgement", () => {
  const a = session("alice"),
    b = session("bob"),
    x = a.SetProperty("first", "FontSize", 20);
  b.Receive(x);
  const checkpoint = a.CreateCheckpoint({
    alice: a.VersionVector,
    bob: b.VersionVector,
  });
  b.ReplaceText("first-run", 0, 0, "offline");
  assert.throws(() => b.AdoptCheckpoint(checkpoint), /discard/);
  assert(b.Text.includes("offline"));
});
test("keyed annotation registers preserve concurrent reviews and remove only observed entries", () => {
  const a = session("alice"),
    b = session("bob"),
    da = a.DocumentJSON,
    db = b.DocumentJSON;
  da.props.Annotations = [
    { Id: "review-a", Kind: "Comment", Start: 0, End: 2, Data: { Text: "A" } },
  ];
  db.props.Annotations = [
    { Id: "review-b", Kind: "Comment", Start: 1, End: 3, Data: { Text: "B" } },
  ];
  const x = a.UpdateDocument(da)!,
    y = b.UpdateDocument(db)!;
  deliver([a, b], [x, y]);
  assert.equal(a.DocumentJSON.props.Annotations.length, 2);
  const updated = a.DocumentJSON;
  updated.props.Annotations = updated.props.Annotations.filter(
    (entry: any) => entry.Id !== "review-a",
  );
  const remove = a.UpdateDocument(updated)!;
  b.Receive(remove);
  assert.deepEqual(
    b.DocumentJSON.props.Annotations.map((entry: any) => entry.Id),
    ["review-b"],
  );
});
test("full engine bindings synchronize tables, text, styles, and preserve live matching nodes", () => {
  const a = session("alice"),
    b = session("bob"),
    ea = new RichTextEngine(a.Document),
    eb = new RichTextEngine(b.Document);
  const ba = a.BindEngine(ea),
    bb = b.BindEngine(eb),
    stableNode = eb.Document.FindById("last"),
    ops: RichDocumentOperation[] = [];
  a.OperationGenerated.Subscribe((op) => {
    ops.push(op);
    b.Receive(op);
  });
  b.OperationGenerated.Subscribe((op) => a.Receive(op));
  ea.Select(2);
  ea.InsertText("hello");
  assert.equal(ea.Document.Text, eb.Document.Text);
  ea.Select(ea.Document.Text.length);
  ea.InsertTable(2, 2);
  assert(eb.Document.Children.some((node) => node.Type === "Table"));
  ea.Select(0, 2);
  ea.ApplyProperty("FontWeight", "Bold");
  assert.deepEqual(ea.Document.ToJSON(), eb.Document.ToJSON());
  assert.equal(eb.Document.FindById("last"), stableNode);
  assert.equal(ba.IsConnected, true);
  assert.equal(bb.IsConnected, true);
  assert(ops.length >= 3);
  assert.equal(eb.CanUndo, false);
  ba.Dispose();
  bb.Dispose();
});
test("rich engine bindings merge disconnected concurrent text and table insertions", () => {
  const a = session("alice"),
    b = session("bob"),
    ea = new RichTextEngine(a.Document),
    eb = new RichTextEngine(b.Document),
    ba = a.BindEngine(ea),
    bb = b.BindEngine(eb),
    operations: RichDocumentOperation[] = [];
  a.OperationGenerated.Subscribe((op) => operations.push(op));
  b.OperationGenerated.Subscribe((op) => operations.push(op));
  ea.Select(1);
  ea.InsertText("AL");
  eb.Select(2);
  eb.InsertText("BO");
  ea.Select(ea.Document.Text.length);
  ea.InsertTable(1, 2);
  eb.Select(eb.Document.Text.length);
  eb.InsertTable(2, 1);
  deliver([a, b], operations);
  assert.deepEqual(ea.Document.ToJSON(), eb.Document.ToJSON());
  assert(ea.Document.Text.includes("AL") && ea.Document.Text.includes("BO"));
  assert.equal(
    ea.Document.Children.filter((node) => node.Type === "Table").length,
    2,
  );
  assert(ba.IsConnected && bb.IsConnected);
});
test("observer failure does not suppress outgoing committed rich operations", () => {
  const a = session("alice"),
    b = session("bob");
  a.Changed.Subscribe(() => {
    throw new Error("observer");
  });
  a.OperationGenerated.Subscribe((op) => b.Receive(op));
  a.SetProperty("first", "FontSize", 28);
  assert.deepEqual(a.DocumentJSON, b.DocumentJSON);
});
test("random disconnected rich edits converge after duplicate and shuffled delivery", () => {
  const replicas = [session("alice"), session("bob"), session("carol")];
  let seed = 9107;
  const random = (n: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  for (let round = 0; round < 20; round++) {
    const operations: RichDocumentOperation[] = [];
    for (const replica of replicas) {
      const choice = random(4),
        id = `${replica.ActorId}-${round}`;
      if (choice === 0)
        operations.push(
          replica.InsertNode(
            "root",
            random(replica.Document.Blocks.Count + 1),
            paragraph(id),
          ),
        );
      else if (choice === 1)
        operations.push(
          replica.SetProperty("first", "FontSize", 10 + random(30)),
        );
      else if (choice === 2)
        operations.push(
          replica.ReplaceText(
            "first-run",
            0,
            0,
            `${replica.ActorId[0]}${round}`,
          )!,
        );
      else
        operations.push(
          replica.SetProperty(
            "last",
            "TextAlignment",
            random(2) ? "Left" : "Right",
          ),
        );
    }
    for (const replica of replicas) {
      const shuffled = [...operations, operations[0]];
      while (shuffled.length)
        replica.Receive(shuffled.splice(random(shuffled.length), 1)[0]);
    }
    assert.deepEqual(replicas[0].DocumentJSON, replicas[1].DocumentJSON);
    assert.deepEqual(replicas[1].DocumentJSON, replicas[2].DocumentJSON);
  }
});

test("MoveNode addresses final destination indices and preserves every sibling", () => {
  const doc = root();
  doc.children!.splice(1, 0, paragraph("middle"));
  const a = session("alice", doc),
    b = session("bob", doc),
    x = a.MoveNode("first", "root", 2);
  b.Receive(x);
  assert.deepEqual(
    a.DocumentJSON.children!.map((node) => node.id),
    ["middle", "last", "first"],
  );
  const y = b.MoveNode("first", "root", 0);
  a.Receive(y);
  assert.deepEqual(
    a.DocumentJSON.children!.map((node) => node.id),
    ["first", "middle", "last"],
  );
});
test("capture reorders by stable subsequences and produces no redundant moves for text edits", () => {
  const doc = root();
  doc.children = Array.from({ length: 40 }, (_, index) =>
    paragraph(`p${index}`),
  );
  const a = session("alice", doc),
    b = session("bob", doc);
  let seed = 441;
  for (let round = 0; round < 10; round++) {
    const next = a.DocumentJSON;
    next.children!.sort(() => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return (seed % 3) - 1;
    });
    const operation = a.UpdateDocument(next)!;
    b.Receive(operation);
    assert.deepEqual(
      a.DocumentJSON.children!.map((node) => node.id),
      next.children!.map((node) => node.id),
    );
    assert.deepEqual(a.DocumentJSON, b.DocumentJSON);
  }
  const next = a.DocumentJSON;
  next.children![12].children![0].text += "!";
  const edit = a.UpdateDocument(next)!;
  assert.equal(edit.Actions.length, 1);
  assert.equal(edit.Actions[0].Kind, "Text");
});
test("engine local undo and redo replicate node tombstone restoration", () => {
  const a = session("alice"),
    b = session("bob"),
    ea = new RichTextEngine(a.Document),
    eb = new RichTextEngine(b.Document);
  const ba = a.BindEngine(ea),
    bb = b.BindEngine(eb);
  a.OperationGenerated.Subscribe((op) => b.Receive(op));
  ea.Select(ea.Document.Text.length);
  ea.InsertTable(1, 1);
  assert.equal(ea.Undo(), true);
  assert.deepEqual(ea.Document.ToJSON(), eb.Document.ToJSON());
  assert.equal(ea.Redo(), true);
  assert.deepEqual(ea.Document.ToJSON(), eb.Document.ToJSON());
  assert(ba.IsConnected && bb.IsConnected);
});
test("forked character states are isolated while retaining history and causal edits", () => {
  const a = session("alice"),
    x = a.ReplaceText("first-run", 1, 2, "A")!;
  const b = CollaborativeDocumentSession.FromSnapshot(
    a.ExportSnapshot(),
    "bob",
  );
  const old = a.Text,
    y = b.ReplaceText("first-run", 1, 1, "B")!;
  assert.equal(a.Text, old);
  a.Receive(y);
  assert.deepEqual(a.DocumentJSON, b.DocumentJSON);
  assert.equal(a.Receive(x), "duplicate");
});
test("malformed collection identifiers cannot create invisible accepted nodes", () => {
  const a = session("alice"),
    b = session("bob"),
    operation = a.InsertNode("root", 0, paragraph("new"));
  (operation.Actions[0] as any).Collection = "Unknown";
  assert.throws(() => b.Receive(operation), /collection/);
  assert.deepEqual(b.VersionVector, {});
});

test("canonical rich documents serialize identically after concurrent property delivery", () => {
  const a = session("alice"),
    b = session("bob"),
    x = a.SetProperty("first", "FontSize", 20),
    y = b.SetProperty("first", "Background", "#eeeeee");
  deliver([a, b], [x, y]);
  assert.equal(JSON.stringify(a.DocumentJSON), JSON.stringify(b.DocumentJSON));
});
test("concurrent same annotation identity and distinct annotations have deterministic ordering", () => {
  const a = session("alice"),
    b = session("bob"),
    da = a.DocumentJSON,
    db = b.DocumentJSON;
  da.props.Annotations = [
    { Id: "shared", Kind: "Comment", Start: 0, End: 0, Data: { Text: "A" } },
    { Id: "a", Kind: "Comment", Start: 0, End: 0, Data: {} },
  ];
  db.props.Annotations = [
    { Id: "b", Kind: "Comment", Start: 0, End: 0, Data: {} },
    { Id: "shared", Kind: "Comment", Start: 0, End: 0, Data: { Text: "B" } },
  ];
  const x = a.UpdateDocument(da)!,
    y = b.UpdateDocument(db)!;
  deliver([a, b], [x, y]);
  assert.equal(a.DocumentJSON.props.Annotations.length, 3);
  assert.equal(JSON.stringify(a.DocumentJSON), JSON.stringify(b.DocumentJSON));
});
test("unknown action fields and nonfinite JSON do not mutate a replica", () => {
  const a = session("alice"),
    b = session("bob"),
    op = a.SetProperty("first", "FontSize", 20);
  const hidden = structuredClone(op);
  (hidden.Actions[0] as any).Hidden = "data";
  assert.throws(() => b.Receive(hidden), /Malformed/);
  const invalid = structuredClone(op);
  (invalid.Actions[0] as any).Value = Number.NaN;
  assert.throws(() => b.Receive(invalid), /finite JSON/);
  assert.deepEqual(b.VersionVector, {});
});
test("large tree single-run edits produce one text action while retaining all node IDs", () => {
  const doc = root();
  doc.children = Array.from({ length: 1000 }, (_, index) =>
    paragraph(`p${index}`, "A paragraph with content"),
  );
  const a = session("alice", doc),
    next = a.DocumentJSON;
  next.children![700].children![0].text += "!";
  const edit = a.UpdateDocument(next)!;
  assert.equal(edit.Actions.length, 1);
  assert.equal(edit.Actions[0].Kind, "Text");
  assert.equal(a.Document.Blocks.Count, 1000);
  assert.equal(a.Statistics.Nodes, 2001);
});

test("large Unicode paste chunks remain one atomic rich transaction", () => {
  const a = session("alice"),
    b = session("bob"),
    text = "x".repeat(65535) + "😀" + "y".repeat(70000);
  const op = a.ReplaceText("first-run", 0, 4, text)!;
  assert.equal(op.Actions.length, 3);
  b.Receive(op);
  assert.deepEqual(a.DocumentJSON, b.DocumentJSON);
  assert.equal((a.Document.FindById("first-run") as Run).Text, text);
  for (const action of op.Actions)
    if (action.Kind === "Text") {
      assert(!/[\uD800-\uDBFF]$/.test(action.Operation.Text!));
      assert(!/^[\uDC00-\uDFFF]/.test(action.Operation.Text!));
    }
});

test("checkpoint adoption retires old engine history as well as CRDT tombstones", () => {
  const a = session("alice"),
    engine = new RichTextEngine(a.Document),
    binding = a.BindEngine(engine);
  engine.Select(0);
  engine.InsertText("local ");
  assert.equal(engine.CanUndo, true);
  a.AdoptCheckpoint(a.CreateCheckpoint({ alice: a.VersionVector }));
  assert.equal(engine.CanUndo, false);
  assert.equal(binding.IsConnected, true);
  assert.equal(engine.Document.Text, a.Text);
});

test("floating block stories merge independently while remaining atomic in main text", () => {
  const a = session("alice"),
    b = session("bob"),
    figure: DocumentNode = {
      type: "Figure",
      id: "figure",
      props: {
        Width: { Value: 160, FigureUnitType: "Pixel" },
        WrapDirection: "Both",
      },
      children: [paragraph("figure-body", "Floating story")],
    };
  const insert = a.InsertNode("first", 1, figure);
  b.Receive(insert);
  const x = a.ReplaceText("figure-body-run", 0, 0, "A ")!,
    y = b.SetProperty("figure", "HorizontalOffset", 20);
  deliver([a, b], [x, y]);
  assert.equal(a.Document.Text, "abcd\uFFFC\ntail");
  assert.equal(
    (a.Document.FindById("figure-body-run") as Run).Text,
    "A Floating story",
  );
});
