import test from "node:test";
import assert from "node:assert/strict";
import {
  CollaborativeTextSession,
  CollaborationConflictError,
  type TextOperation,
} from "../src/collaboration.js";
import { FlowDocument, Paragraph, Run } from "../src/model.js";
import { RichTextEngine } from "../src/engine.js";
const session = (ActorId: string, Text = "abcd") =>
  new CollaborativeTextSession({ DocumentId: "document", ActorId, Text });

test("concurrent inserts at the same position converge regardless of delivery order", () => {
  const a = session("alice"),
    b = session("bob"),
    c = session("carol"),
    x = a.Insert(2, "AL")!,
    y = b.Insert(2, "BO")!,
    z = c.Insert(2, "CA")!;
  a.Receive(z);
  a.Receive(y);
  b.Receive(x);
  b.Receive(z);
  c.Receive(y);
  c.Receive(x);
  assert.equal(a.Text, b.Text);
  assert.equal(a.Text, c.Text);
  assert.equal(a.Text, "abCABOALcd");
  assert.deepEqual(a.VersionVector, b.VersionVector);
});
test("concurrent deletion preserves unseen inserted characters and converges", () => {
  const a = session("alice"),
    b = session("bob"),
    deletion = a.Delete(1, 3)!,
    insertion = b.Insert(2, "X")!;
  a.Receive(insertion);
  b.Receive(deletion);
  assert.equal(a.Text, "aXd");
  assert.equal(a.Text, b.Text);
});
test("overlapping deletes are idempotent and do not remove neighboring text", () => {
  const a = session("alice", "abcdef"),
    b = session("bob", "abcdef"),
    x = a.Delete(1, 4)!,
    y = b.Delete(3, 5)!;
  a.Receive(y);
  b.Receive(x);
  assert.equal(a.Text, "af");
  assert.equal(b.Text, "af");
  assert.equal(a.Receive(y), "duplicate");
});
test("out-of-order causal operations queue and drain after their dependencies", () => {
  const a = session("alice"),
    b = session("bob"),
    x = a.Insert(1, "X")!,
    y = a.Insert(2, "Y")!;
  assert.equal(b.Receive(y), "queued");
  assert.equal(b.Text, "abcd");
  assert.equal(b.PendingCount, 1);
  b.Receive(x);
  assert.equal(b.PendingCount, 0);
  assert.equal(b.Text, "aXYbcd");
});
test("tampered operations reject without corrupting accepted state", () => {
  const a = session("alice"),
    b = session("bob"),
    x = a.Insert(1, "X")!;
  b.Receive(x);
  const before = b.Text;
  for (const malformed of [
    { ...x, Text: "tampered" },
    { ...x, DocumentId: "other" },
    { ...x, ActorId: "__proto__" },
    { ...x, Protocol: 2 },
    {
      ...x,
      ActorId: "charlie",
      Sequence: 1,
      Dependencies: { charlie: 0 },
      Clock: 999,
    },
    {
      ...x,
      ActorId: "charlie",
      Sequence: 1,
      Dependencies: { charlie: 0 },
      After: "missing",
    },
  ])
    assert.throws(
      () => b.Receive(malformed as TextOperation),
      CollaborationConflictError,
    );
  assert.equal(b.Text, before);
  assert.deepEqual(b.VersionVector, { alice: 1 });
});
test("unobserved reference injection and nonfinite formatting are rejected", () => {
  const a = session("alice"),
    b = session("bob"),
    x = a.Insert(1, "X")!;
  b.Receive(x);
  assert.throws(
    () =>
      b.Receive({
        ...x,
        ActorId: "charlie",
        After: "alice:1:0",
        Dependencies: { charlie: 0 },
      }),
    /causal/i,
  );
  assert.throws(() => b.Format(0, 1, "FontSize", NaN));
  assert.throws(() => b.Format(0, 1, "NavigateUri", "javascript:evil"));
});
test("formatting uses deterministic Lamport and actor ordering", () => {
  const a = session("alice"),
    b = session("bob"),
    x = a.Format(1, 3, "FontWeight", "Bold")!,
    y = b.Format(1, 3, "FontWeight", "Normal")!;
  a.Receive(y);
  b.Receive(x);
  assert.deepEqual(a.GetFormatting(), b.GetFormatting());
  assert.equal(a.GetFormatting()[1].Properties.FontWeight, "Normal");
});
test("snapshots preserve tombstones, operation replay and further edits", () => {
  const a = session("alice");
  a.Insert(1, "X");
  a.Delete(2, 3);
  const b = CollaborativeTextSession.FromSnapshot(a.ExportSnapshot(), "bob");
  assert.equal(a.Text, b.Text);
  assert.deepEqual(a.VersionVector, b.VersionVector);
  const op = b.Insert(2, "next")!;
  a.Receive(op);
  assert.equal(a.Text, b.Text);
});
test("Unicode offsets match UTF-16 while surrogate pairs remain indivisible", () => {
  const a = session("alice", "a😀b");
  assert.throws(() => a.Insert(2, "x"), /surrogate/);
  a.Delete(1, 3);
  assert.equal(a.Text, "ab");
  a.Insert(1, "👩‍💻");
  assert.equal(a.Text, "a👩‍💻b");
});
test("engine bindings synchronize rich paragraphs and explicit formatting", () => {
  const a = session("alice"),
    b = session("bob"),
    ea = new RichTextEngine(new FlowDocument(new Paragraph(new Run("abcd")))),
    eb = new RichTextEngine(new FlowDocument(new Paragraph(new Run("abcd"))));
  const ba = a.BindEngine(ea),
    bb = b.BindEngine(eb),
    wireA = a.OperationGenerated.Subscribe((op) => b.Receive(op)),
    wireB = b.OperationGenerated.Subscribe((op) => a.Receive(op));
  ea.Select(1, 3);
  ea.InsertText("XYZ");
  assert.equal(eb.Document.Text, "aXYZd");
  assert.equal(a.Text, b.Text);
  b.Format(1, 4, "FontWeight", "Bold");
  ea.Select(1, 4);
  assert.equal(ea.GetProperty("FontWeight"), "Bold");
  eb.Select(1, 4);
  assert.equal(eb.GetProperty("FontWeight"), "Bold");
  ea.Undo();
  assert.equal(ea.Document.Text, eb.Document.Text);
  wireA.Dispose();
  wireB.Dispose();
  ba.Dispose();
  bb.Dispose();
});
test("unsupported structural edits explicitly disconnect the text projection", () => {
  const a = session("alice"),
    e = new RichTextEngine(new FlowDocument(new Paragraph(new Run("abcd")))),
    binding = a.BindEngine(e);
  let conflict = "";
  a.Conflict.Subscribe((event) => (conflict = event.Error.message));
  e.Select(2);
  e.InsertTable(1, 1);
  assert.equal(binding.IsConnected, false);
  assert.match(conflict, /structural|tables/i);
  assert.equal(a.Text, "abcd");
});
test("random concurrent batches converge on every replica after shuffled delivery", () => {
  const replicas = [
    session("alice", ""),
    session("bob", ""),
    session("carol", ""),
  ];
  let seed = 11;
  const next = (n: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  for (let round = 0; round < 30; round++) {
    const ops: TextOperation[] = [];
    for (const replica of replicas) {
      const text = replica.Text;
      if (text.length && next(3) === 0) {
        const from = next(text.length),
          to = from + 1 + next(text.length - from);
        ops.push(replica.Delete(from, to)!);
      } else
        ops.push(
          replica.Insert(
            next(text.length + 1),
            String.fromCharCode(65 + next(26)),
          )!,
        );
    }
    for (const replica of replicas) {
      const shuffled = [...ops];
      while (shuffled.length)
        replica.Receive(shuffled.splice(next(shuffled.length), 1)[0]);
    }
    assert.equal(replicas[0].Text, replicas[1].Text);
    assert.equal(replicas[1].Text, replicas[2].Text);
  }
});
test("atomic replacements reject oversize input before publishing deletion", () => {
  const a = session("alice"),
    b = session("bob"),
    e = new RichTextEngine(new FlowDocument(new Paragraph(new Run("abcd")))),
    binding = a.BindEngine(e);
  a.OperationGenerated.Subscribe((op) => b.Receive(op));
  e.Select(1, 3);
  e.InsertText("x".repeat(65537));
  assert.equal(binding.IsConnected, false);
  assert.equal(a.Text, "abcd");
  assert.equal(b.Text, "abcd");
  assert.equal(a.VersionVector.alice, undefined);
  const valid = session("alice"),
    peer = session("bob"),
    op = valid.Replace(1, 3, "XYZ")!;
  assert.equal(op.Kind, "Replace");
  peer.Receive(op);
  assert.equal(peer.Text, "aXYZd");
});
test("local character quotas allow concurrent remote union and report compaction", () => {
  const a = new CollaborativeTextSession({
      DocumentId: "quota",
      ActorId: "alice",
      Text: "abcd",
      MaxCharacters: 5,
    }),
    b = new CollaborativeTextSession({
      DocumentId: "quota",
      ActorId: "bob",
      Text: "abcd",
      MaxCharacters: 5,
    }),
    x = a.Insert(4, "A")!,
    y = b.Insert(4, "B")!;
  a.Receive(y);
  b.Receive(x);
  assert.equal(a.Text, b.Text);
  assert.equal(a.CharacterCount, 6);
  assert.equal(a.RequiresCompaction, true);
  assert.throws(() => a.Insert(0, "C"), /limit/);
});
test("queue overflow exposes required resynchronization", () => {
  const a = session("alice"),
    b = new CollaborativeTextSession({
      DocumentId: "document",
      ActorId: "bob",
      Text: "abcd",
      MaxPendingOperations: 0,
    });
  a.Insert(0, "1");
  const second = a.Insert(0, "2")!;
  assert.throws(() => b.Receive(second), /queue limit/i);
  assert.equal(b.ResyncRequired, true);
});
test("untrusted snapshot text types reject and local CRLF normalizes consistently", () => {
  assert.throws(
    () =>
      CollaborativeTextSession.FromSnapshot(
        {
          Protocol: 1,
          DocumentId: "bad",
          InitialText: 123 as any,
          Operations: [],
        },
        "alice",
      ),
    /string/,
  );
  const a = session("alice", "A"),
    e = new RichTextEngine(new FlowDocument(new Paragraph(new Run("A")))),
    binding = a.BindEngine(e);
  a.Insert(1, "\r\nB");
  assert.equal(a.Text, "A\nB");
  assert.equal(e.Document.Text, a.Text);
  assert.equal(binding.IsConnected, true);
});
test("remote insertion uses authoritative styling and preserves local pending caret format", () => {
  const a = session("alice"),
    b = session("bob"),
    ea = new RichTextEngine(new FlowDocument(new Paragraph(new Run("abcd")))),
    eb = new RichTextEngine(new FlowDocument(new Paragraph(new Run("abcd"))));
  a.BindEngine(ea);
  b.BindEngine(eb);
  a.OperationGenerated.Subscribe((op) => b.Receive(op));
  b.OperationGenerated.Subscribe((op) => a.Receive(op));
  ea.Select(4);
  ea.ToggleFormat("FontWeight", "Bold", "Normal");
  b.Insert(4, "X");
  assert.equal(ea.CaptureSelectionState().TypingProperties.FontWeight, "Bold");
  ea.Select(4, 5);
  eb.Select(4, 5);
  assert.equal(ea.GetProperty("FontWeight"), "Normal");
  assert.equal(eb.GetProperty("FontWeight"), "Normal");
  ea.Select(5);
  ea.ToggleFormat("FontWeight", "Bold", "Normal");
  ea.InsertText("Y");
  eb.Select(5, 6);
  assert.equal(eb.GetProperty("FontWeight"), "Bold");
});
test("engine formatting and undo replicate in coalesced document operations", () => {
  const text = "a".repeat(1000),
    a = session("alice", text),
    b = session("bob", text),
    ea = new RichTextEngine(new FlowDocument(new Paragraph(new Run(text)))),
    eb = new RichTextEngine(new FlowDocument(new Paragraph(new Run(text))));
  a.BindEngine(ea);
  b.BindEngine(eb);
  a.OperationGenerated.Subscribe((op) => b.Receive(op));
  b.OperationGenerated.Subscribe((op) => a.Receive(op));
  let calls = 0;
  const apply = eb.ApplyProperty.bind(eb);
  eb.ApplyProperty = (name, value) => {
    calls++;
    apply(name, value);
  };
  ea.Select(0, text.length);
  ea.ApplyProperty("FontWeight", "Bold");
  assert.equal(calls, 1);
  eb.Select(0, text.length);
  assert.equal(eb.GetProperty("FontWeight"), "Bold");
  ea.Undo();
  assert.equal(eb.GetProperty("FontWeight"), "Normal");
});
