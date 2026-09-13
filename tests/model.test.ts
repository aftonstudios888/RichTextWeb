import test from "node:test";
import assert from "node:assert/strict";
import { RichTextEngine } from "../src/engine.js";
import {
  FlowDocument,
  Paragraph,
  Run,
  Section,
  Span,
  Bold,
  Italic,
  Underline,
  Hyperlink,
  List,
  ListItem,
  Table,
  TableRowGroup,
  TableRow,
  TableCell,
  TableColumn,
  Image,
  InlineUIContainer,
  BlockUIContainer,
  LineBreak,
  TextPointer,
  TextPointerContext,
  TextSymbolMap,
  LogicalDirection,
  Thickness,
  EventDispatcher,
  DependencyProperty,
  DependencyObject,
  TextElement,
  elementFromJSON,
} from "../src/model.js";

test("document traversal preserves empty paragraphs, nested blocks, UTF-16 and inline objects", () => {
  const table = new Table(
    new TableRowGroup(
      new TableRow([
        new TableCell(new Paragraph("cell one")),
        new TableCell(new Paragraph("cell two")),
      ]),
    ),
  );
  const document = new FlowDocument([
    new Paragraph([
      "A😀",
      new Bold("bold"),
      new LineBreak(),
      new InlineUIContainer(new Image("data:image/png;base64,AA==")),
    ]),
    new Paragraph(),
    new Section(new List(new ListItem(new Paragraph("item")))),
    table,
    new BlockUIContainer(new Image()),
  ]);
  assert.equal(
    document.Text,
    "A😀bold\n\uFFFC\n\nitem\ncell one\ncell two\n\uFFFC",
  );
  assert.equal(document.ContentEnd.Offset, document.Text.length);
  assert.equal(document.Blocks.Get(2).ContentStart.Offset, 11);
  assert.equal(document.Blocks.Get(2).ContentEnd.Offset, 15);
});

test("collections enforce type, one-parent ownership, cycles and atomic AddRange validation", () => {
  const paragraph = new Paragraph("hello");
  const document = new FlowDocument(paragraph);
  assert.equal(paragraph.Parent, document);
  assert.equal(paragraph.Inlines.Get(0).Document, document);
  assert.throws(() => new FlowDocument(paragraph), /parent/);
  const section = new Section();
  const nested = new Section();
  section.Blocks.Add(nested);
  assert.throws(() => nested.Blocks.Add(section), /ancestor/);
  assert.throws(() => document.Blocks.Add(new Run() as any), /Invalid child/);
  const valid = new Paragraph("valid");
  assert.throws(() => document.Blocks.AddRange([valid, paragraph]), /parent/);
  assert.equal(valid.Parent, null);
  assert.equal(document.Blocks.Count, 1);
  assert.throws(() => document.Blocks.AddRange([valid, valid]), /twice/);
  assert.equal(valid.Parent, null);
});

test("collections support insert, replace, detached moves, IDs, notifications and defensive arrays", () => {
  const first = new Paragraph("a"),
    second = new Paragraph("b");
  const document = new FlowDocument(first);
  const changes: string[] = [];
  document.Blocks.CollectionChanged.Subscribe((event) =>
    changes.push(event.Action),
  );
  document.Blocks.InsertAfter(first, second);
  assert.equal(second.PreviousBlock, first);
  assert.equal(first.NextBlock, second);
  const clone = first.Clone();
  document.Blocks.Set(0, clone);
  assert.equal(first.Parent, null);
  assert.equal(document.FindById(first.Id), clone);
  document.Blocks.ToArray().pop();
  assert.equal(document.Blocks.Count, 2);
  document.Blocks.Remove(second);
  assert.equal(document.FindById(second.Id), null);
  document.Blocks.InsertBefore(clone, second);
  assert.equal(second.NextBlock, clone);
  document.Blocks.Clear();
  assert.equal(clone.Parent, null);
  assert.equal(second.Parent, null);
  assert.deepEqual(changes, ["Add", "Replace", "Remove", "Add", "Reset"]);
  assert.throws(() => document.Blocks.Get(0), /range/);
  assert.throws(() => document.Blocks.Insert(-1, first), /range/);
});

test("typography inherits dynamically and clearing a local property restores inheritance", () => {
  const run = new Run("hello");
  const document = new FlowDocument(new Paragraph(new Span(run)));
  document.FontFamily = "Example";
  document.FontSize = 22;
  assert.equal(run.FontFamily, "Example");
  assert.equal(run.FontSize, 22);
  run.SetValue(TextElement.FontSizeProperty, 30);
  assert.equal(run.FontSize, 30);
  document.FontSize = 24;
  assert.equal(run.FontSize, 30);
  run.ClearValue(TextElement.FontSizeProperty);
  assert.equal(run.FontSize, 24);
  assert.equal(run.ReadLocalValue("FontSize"), DependencyProperty.UnsetValue);
  assert.throws(() => {
    document.FontSize = 0;
  }, /positive/);
  assert.throws(() => {
    document.ColumnCount = 1.5;
  }, /integer/);
});

test("dependency metadata validation, callbacks and JSON property isolation", () => {
  const changes: number[] = [];
  const property = DependencyProperty.Register<number>(
    "TestCount",
    Number,
    DependencyObject,
    {
      DefaultValue: 3,
      ValidateValueCallback: (value) => value >= 0,
      PropertyChangedCallback: (_owner, event) => changes.push(event.NewValue),
    },
  );
  const object = new DependencyObject();
  assert.equal(object.GetValue(property), 3);
  object.SetValue(property, 4);
  object.ClearValue(property);
  assert.deepEqual(changes, [4, 3]);
  assert.throws(() => object.SetValue(property, -1), /Invalid value/);
  const external = { nested: [1] };
  object.SetValue("Extra", external);
  external.nested.push(2);
  assert.deepEqual(object.GetValue("Extra"), { nested: [1] });
  object.GetValue("Extra").nested.push(3);
  assert.deepEqual(object.GetValue("Extra"), { nested: [1] });
  assert.throws(
    () => object.SetValue("Bad", { value: Infinity }),
    /finite JSON/,
  );
  assert.throws(() => object.SetValue("Bad", () => 1), /finite JSON/);
});

test("nested batches emit once and no-op property sets do not increase revision", () => {
  const run = new Run("one");
  const document = new FlowDocument(new Paragraph(run));
  const events: any[] = [];
  assert.equal(document.Revision, 0);
  document.Changed.Subscribe((event) => events.push(event));
  document.BeginChange();
  run.Text = "two";
  document.BeginChange();
  run.FontWeight = "Bold";
  document.EndChange();
  assert.equal(events.length, 0);
  document.EndChange();
  assert.equal(events.length, 1);
  assert.equal(events[0].Revision, 1);
  assert.equal(events[0].Changes.length, 2);
  run.Text = "two";
  run.FontWeight = "Bold";
  assert.equal(document.Revision, 1);
  assert.throws(() => document.EndChange(), /matching/);
  assert.throws(
    () =>
      document.Change(() => {
        run.Text = "three";
        throw new Error("failure");
      }),
    /failure/,
  );
  assert.equal(document.IsInChange, false);
  assert.equal(document.Revision, 2);
});

test("event subscriptions are disposable and reentrant document edits remain ordered", () => {
  const dispatcher = new EventDispatcher<number>();
  const received: number[] = [];
  const subscription = dispatcher.Subscribe((value) => received.push(value));
  dispatcher.Emit(1);
  subscription.Dispose();
  subscription.Dispose();
  dispatcher.Emit(2);
  assert.deepEqual(received, [1]);
  const run = new Run();
  const document = new FlowDocument(new Paragraph(run));
  const revisions: number[] = [];
  document.Changed.Subscribe((event) => {
    revisions.push(event.Revision);
    if (event.Revision === 1) run.Text = "second";
  });
  run.Text = "first";
  assert.deepEqual(revisions, [1, 2]);
  assert.equal(run.Text, "second");
});

test("events notify remaining subscribers before propagating a listener error", () => {
  const event = new EventDispatcher<number>();
  let notified = false;
  event.Subscribe(() => {
    throw new Error("listener");
  });
  event.Subscribe(() => {
    notified = true;
  });
  assert.throws(() => event.Emit(1), /listener/);
  assert.equal(notified, true);
});

test("canonical JSON round-trips rich nodes, columns, ids and metadata", () => {
  const table = new Table(
    new TableRowGroup(new TableRow(new TableCell(new Paragraph("cell")))),
  );
  table.Columns.Add(new TableColumn("2*"));
  table.Columns.Add(new TableColumn(120));
  const hyperlink = new Hyperlink(
    [new Italic("link"), new Underline("under")],
    "https://example.com",
  );
  const document = new FlowDocument([
    new Paragraph([new Bold("bold"), hyperlink]),
    table,
  ]);
  document.PagePadding = new Thickness(10, 20, 30, 40);
  document.SetValue("Annotations", [{ id: "comment", start: 1 }]);
  const json = document.ToJSON(),
    copy = FlowDocument.FromJSON(JSON.stringify(json));
  assert.deepEqual(copy.ToJSON(), json);
  assert.notEqual(copy, document);
  assert.equal(copy.Revision, 0);
  const copiedTable = copy.Blocks.Get(1) as Table;
  assert.equal(copiedTable.Columns.Count, 2);
  assert.equal(copiedTable.Columns.Get(0).Parent, copiedTable);
  json.props.Annotations[0].start = 99;
  assert.equal(document.GetValue("Annotations")[0].start, 1);
});

test("JSON parser rejects duplicate identities, malformed child types, unsupported nodes and depth excess", () => {
  const source = new FlowDocument(new Paragraph("hello")).ToJSON();
  source.children!.push(source.children![0]!);
  assert.throws(() => FlowDocument.FromJSON(source), /Duplicate/);
  const bad = new FlowDocument().ToJSON();
  bad.children = [new Run("invalid").ToJSON()];
  assert.throws(() => FlowDocument.FromJSON(bad), /Invalid child/);
  assert.throws(
    () => elementFromJSON({ type: "ExecutableScript", id: "x", props: {} }),
    /Unsupported/,
  );
  assert.throws(
    () => elementFromJSON(new Paragraph("text").ToJSON(), { MaxDepth: 0 }),
    /nesting/,
  );
  assert.throws(
    () => elementFromJSON(new Paragraph("text").ToJSON(), { MaxNodes: 1 }),
    /node limit/,
  );
});

test("ReplaceWith preserves root identity, subscriptions and replaces child IDs safely", () => {
  const original = new FlowDocument(new Paragraph("old"));
  const originalId = original.Id;
  const previousChild = original.Blocks.Get(0);
  let events = 0;
  original.Changed.Subscribe(() => events++);
  const incoming = new FlowDocument([
    new Paragraph("new"),
    new Paragraph("tail"),
  ]);
  incoming.FontSize = 20;
  original.ReplaceWith(incoming);
  assert.equal(original.Id, originalId);
  assert.equal(original.Text, "new\ntail");
  assert.equal(original.FontSize, 20);
  assert.equal(previousChild.Parent, null);
  assert.equal(events, 1);
  assert.equal(original.FindById(previousChild.Id), null);
  assert.notEqual(original.Blocks.Get(0), incoming.Blocks.Get(0));
  assert.equal(
    original.FindById(incoming.Blocks.Get(0).Id),
    original.Blocks.Get(0),
  );
  original.ReplaceWith(original);
  assert.equal(events, 1);
});

test("ReplaceWith rejects target-root ID collisions before mutating existing content", () => {
  const original = new FlowDocument(new Paragraph("preserve"));
  const incoming = new FlowDocument(new Paragraph("replacement")).ToJSON();
  incoming.children![0]!.id = original.Id;
  assert.throws(
    () => original.ReplaceWith(FlowDocument.FromJSON(incoming)),
    /duplicates/,
  );
  assert.equal(original.Text, "preserve");
  assert.equal(original.Revision, 0);
});

test("TextPointers use UTF-16 offsets, reject foreign documents and navigate surrogate pairs", () => {
  const document = new FlowDocument(new Paragraph("A😀B"));
  const pointer = document.ContentStart.GetPositionAtOffset(1)!;
  assert.equal(pointer.Offset, 1);
  assert.equal(
    pointer.GetNextInsertionPosition(LogicalDirection.Forward)!.Offset,
    3,
  );
  assert.equal(new TextPointer(document, 2).IsAtInsertionPosition, false);
  assert.equal(
    document.ContentEnd.GetNextInsertionPosition(LogicalDirection.Forward),
    null,
  );
  assert.equal(document.ContentStart.GetPositionAtOffset(-1), null);
  assert.equal(pointer.GetOffsetToPosition(document.ContentEnd), 3);
  assert.equal(pointer.CompareTo(document.ContentEnd), -1);
  assert.throws(
    () => pointer.CompareTo(new FlowDocument().ContentStart),
    /different documents/,
  );
  assert.throws(() => new TextPointer(document, 5), /outside/);
});

test("Thickness preserves WPF argument order and validates inputs", () => {
  assert.deepEqual(new Thickness(2, 3).toJSON(), {
    Left: 2,
    Top: 3,
    Right: 2,
    Bottom: 3,
  });
  assert.equal(Thickness.Parse("1,2,3,4").ToString(), "1,2,3,4");
  assert.ok(new Thickness(4).Equals(Thickness.Parse("4")));
  assert.throws(() => Thickness.Parse("1,2,3"), /one, two, or four/);
  assert.throws(() => new Thickness(NaN), /finite/);
});

test("large document construction retains linear identity lookup and ownership correctness", () => {
  const paragraphs = Array.from(
    { length: 2500 },
    (_, index) => new Paragraph(`Paragraph ${index}`),
  );
  const document = new FlowDocument(paragraphs);
  assert.equal(document.Blocks.Count, 2500);
  assert.equal(document.FindById(paragraphs[2499]!.Id), paragraphs[2499]);
  const copy = FlowDocument.FromJSON(document.ToJSON());
  assert.equal(copy.Text, document.Text);
});

test("UI container replacement validates before removing its existing child", () => {
  const image = new Image("first");
  const container = new InlineUIContainer(image);
  const duplicateSource = new Image("second");
  const document = new FlowDocument(
    new Paragraph([container, duplicateSource]),
  );
  assert.throws(() => {
    container.Child = duplicateSource.Clone();
  }, /Duplicate/);
  assert.equal(container.Child, image);
  assert.equal(image.Parent, container);
  const replacement = image.Clone();
  container.Child = replacement;
  assert.equal(container.Child, replacement);
  assert.equal(image.Parent, null);
  assert.equal(document.FindById(replacement.Id), replacement);
});

test("empty container positions and cloned document revision are stable", () => {
  const empty = new Section();
  const document = new FlowDocument([empty, new Paragraph("content")]);
  assert.equal(empty.ContentStart.Offset, 0);
  assert.equal(empty.ContentEnd.Offset, 0);
  document.FontSize = 20;
  assert.equal(document.Clone().Revision, 0);
});

test("live pointers rebase at insertion with forward and backward gravity before events", () => {
  const run = new Run("hello"),
    document = new FlowDocument(new Paragraph(run));
  const forward = new TextPointer(document, 2, LogicalDirection.Forward);
  const backward = new TextPointer(document, 2, LogicalDirection.Backward);
  const end = document.ContentEnd,
    start = run.ContentStart,
    runEnd = run.ContentEnd;
  let observed: number[] = [];
  document.Changed.Subscribe(() => {
    observed = [forward.Offset, backward.Offset, end.Offset];
  });
  run.Text = "heXllo";
  assert.deepEqual(observed, [3, 2, 6]);
  assert.equal(start.Offset, 0);
  assert.equal(runEnd.Offset, 6);
  run.Text = "hlo";
  assert.equal(forward.Offset, 1);
  assert.equal(backward.Offset, 1);
  assert.equal(end.Offset, 3);
});

test("live pointers retain unchanged runs when separate surrounding paragraphs change", () => {
  const first = new Run("first"),
    middle = new Run("middle"),
    last = new Run("last");
  const document = new FlowDocument([
    new Paragraph(first),
    new Paragraph(middle),
    new Paragraph(last),
  ]);
  const pointer = new TextPointer(document, 9);
  document.Change(() => {
    first.Text = "expanded first";
    last.Text = "expanded last";
  });
  assert.equal(pointer.Offset, 18);
  assert.equal(pointer.GetTextInRun(LogicalDirection.Forward), "dle");
  document.Blocks.Insert(0, new Paragraph("intro"));
  assert.equal(pointer.Offset, 24);
  assert.equal(pointer.Parent, middle);
});

test("exact pre-batch edit ranges preserve middle anchors across disjoint changes in one run", () => {
  const run = new Run("abc---def---ghi"),
    document = new FlowDocument(new Paragraph(run));
  const pointer = new TextPointer(document, 7);
  document.SetPendingTextChanges([
    { Start: 0, RemovedLength: 3, InsertedLength: 1 },
    { Start: 12, RemovedLength: 3, InsertedLength: 4 },
  ]);
  document.Change(() => {
    run.Text = "A---def---GHI!";
  });
  assert.equal(pointer.Offset, 5);
  assert.equal(pointer.GetTextInRun(LogicalDirection.Forward), "ef---GHI!");
  assert.throws(
    () =>
      document.SetPendingTextChanges([
        { Start: 3, RemovedLength: 3, InsertedLength: 0 },
        { Start: 4, RemovedLength: 1, InsertedLength: 0 },
      ]),
    /nonoverlapping/,
  );
});

test("pointers survive canonical replacement and do not drift when formatting splits text runs", () => {
  const run = new Run("abcdef"),
    document = new FlowDocument(new Paragraph(run));
  const pointer = new TextPointer(document, 4);
  const json = document.ToJSON();
  const first = json.children![0]!.children![0]!;
  first.text = "ab";
  json.children![0]!.children!.push({
    type: "Run",
    id: "split-suffix",
    props: { FontWeight: "Bold" },
    text: "cdef",
  });
  document.ReplaceWith(FlowDocument.FromJSON(json));
  assert.equal(pointer.Offset, 4);
  assert.equal(pointer.GetTextInRun(LogicalDirection.Forward), "ef");
  document.ReplaceWith(new FlowDocument(new Paragraph("Xabcdef")));
  assert.equal(pointer.Offset, 5);
});

test("pointer reads during a batch reflect edits while events stay batched", () => {
  const run = new Run("abc"),
    document = new FlowDocument(new Paragraph(run));
  const pointer = new TextPointer(document, 2);
  let events = 0;
  document.Changed.Subscribe(() => events++);
  document.BeginChange();
  run.Text = "Xabc";
  assert.equal(pointer.Offset, 3);
  run.Text = "XYabc";
  assert.equal(pointer.Offset, 4);
  document.EndChange();
  assert.equal(pointer.Offset, 4);
  assert.equal(events, 1);
});

test("snapshots and disposed pointers retain their recorded coordinates and cannot edit", () => {
  const run = new Run("abc"),
    document = new FlowDocument(new Paragraph(run));
  const live = new TextPointer(document, 1),
    snapshot = live.CreateSnapshot(),
    disposed = new TextPointer(document, 2);
  disposed.Dispose();
  run.Text = "Xabc";
  assert.equal(live.Offset, 2);
  assert.equal(snapshot.Offset, 1);
  assert.equal(disposed.Offset, 2);
  assert.equal(snapshot.IsLive, false);
  assert.equal(snapshot.GetTextInRun(LogicalDirection.Forward), "bc");
  assert.throws(() => snapshot.InsertTextInRun("bad"), /Snapshot/);
});

test("symbol offsets count UTF-16 code units and element edges independently", () => {
  const run = new Run("A😀"),
    paragraph = new Paragraph(run),
    document = new FlowDocument(paragraph);
  const map = document.GetSymbolMap();
  assert.ok(map instanceof TextSymbolMap);
  assert.equal(document.SymbolCount, 7);
  assert.deepEqual(map.GetElementBounds(run), {
    ElementStart: 1,
    ContentStart: 2,
    ContentEnd: 5,
    ElementEnd: 6,
  });
  assert.equal(document.ContentStart.SymbolOffset, 0);
  assert.equal(document.ContentEnd.SymbolOffset, 7);
  assert.equal(run.ContentStart.Offset, 0);
  assert.equal(run.ContentStart.SymbolOffset, 2);
  assert.equal(run.ContentStart.GetPositionAtSymbolOffset(3)!.SymbolOffset, 5);
  assert.equal(
    document.ContentStart.GetSymbolOffsetToPosition(document.ContentEnd),
    7,
  );
  assert.equal(
    document.ContentStart.GetOffsetToPosition(document.ContentEnd),
    3,
  );
  assert.equal(document.ContentStart.CompareTo(run.ContentStart), 0);
  assert.equal(document.ContentStart.CompareSymbolTo(run.ContentStart), -1);
  assert.equal(map.GetTextOffset(4), 2);
  assert.equal(map.GetSymbolOffset(2), 4);
  assert.equal(document.GetPositionAtSymbolOffset(8), null);
  assert.throws(() => TextPointer.FromSymbolOffset(document, -1), /outside/);
});

test("structural context traversal visits tags, text and embedded content in both directions", () => {
  const image = new Image("image.png");
  const document = new FlowDocument(
    new Paragraph([
      new Run("ab"),
      new Bold("c"),
      new LineBreak(),
      new InlineUIContainer(image),
    ]),
  );
  const contexts: string[] = [];
  let current: TextPointer | null = document.ContentStart;
  while (current) {
    contexts.push(current.GetPointerContext(LogicalDirection.Forward));
    current = current.GetNextContextPosition(LogicalDirection.Forward);
  }
  assert.deepEqual(contexts, [
    "ElementStart",
    "ElementStart",
    "Text",
    "ElementEnd",
    "ElementStart",
    "ElementStart",
    "Text",
    "ElementEnd",
    "ElementEnd",
    "ElementStart",
    "ElementEnd",
    "ElementStart",
    "EmbeddedElement",
    "ElementEnd",
    "ElementEnd",
    "None",
  ]);
  const reversed: string[] = [];
  current = document.ContentEnd;
  while (current) {
    reversed.push(current.GetPointerContext(LogicalDirection.Backward));
    current = current.GetNextContextPosition(LogicalDirection.Backward);
  }
  assert.deepEqual(
    reversed,
    [...contexts.slice(0, -1)].reverse().concat("None"),
  );
  assert.equal(
    image.ElementStart.GetAdjacentElement(LogicalDirection.Forward),
    image,
  );
  assert.equal(
    image.ElementStart.GetPointerContext(LogicalDirection.Forward),
    TextPointerContext.EmbeddedElement,
  );
  assert.equal(
    document.ContentStart.GetPointerContext(LogicalDirection.Backward),
    TextPointerContext.None,
  );
});

test("table columns do not contribute symbols and embedded UI children count once", () => {
  const table = new Table(
      new TableRowGroup(new TableRow(new TableCell(new Paragraph("cell")))),
    ),
    document = new FlowDocument(table);
  const before = document.SymbolCount;
  table.Columns.Add(new TableColumn(120));
  assert.equal(document.SymbolCount, before);
  const embedded = new InlineUIContainer(new Image("image"));
  const paragraph = new Paragraph(embedded);
  const standalone = new FlowDocument(paragraph);
  assert.equal(standalone.SymbolCount, 5);
  assert.equal(standalone.Text, "\uFFFC");
  assert.throws(() => table.Columns.Get(0).ContentStart, /not part/);
});

test("GetTextInRun stops at structure and supports caller-provided UTF-16 buffers", () => {
  const run = new Run("abcdef"),
    document = new FlowDocument(new Paragraph([run, new Bold("tail")]));
  const pointer = TextPointer.FromSymbolOffset(
    document,
    run.ContentStart.SymbolOffset + 3,
  );
  assert.equal(pointer.GetTextInRun(LogicalDirection.Forward), "def");
  assert.equal(pointer.GetTextInRun(LogicalDirection.Backward), "abc");
  assert.equal(pointer.GetTextRunLength(LogicalDirection.Backward), 3);
  const buffer = ["_", "_", "_", "_"];
  assert.equal(
    pointer.GetTextInRun(LogicalDirection.Backward, buffer, 1, 2),
    2,
  );
  assert.deepEqual(buffer, ["_", "b", "c", "_"]);
  const units = new Uint16Array(2);
  pointer.GetTextInRun(LogicalDirection.Forward, units, 0, 2);
  assert.deepEqual([...units], [100, 101]);
  assert.equal(run.ElementStart.GetTextInRun(LogicalDirection.Forward), "");
  assert.throws(
    () => pointer.GetTextInRun(LogicalDirection.Forward, [], 0, 1),
    /buffer/,
  );
});

test("insertion context excludes document and inter-paragraph edges and respects graphemes", () => {
  const run = new Run("e\u0301👩‍💻Z"),
    paragraph = new Paragraph(run),
    document = new FlowDocument([paragraph, new Paragraph("tail")]);
  assert.equal(document.ContentStart.IsAtInsertionPosition, false);
  assert.equal(paragraph.ElementEnd.IsAtInsertionPosition, false);
  assert.equal(run.ContentStart.IsAtInsertionPosition, true);
  assert.equal(new TextPointer(document, 1).IsAtInsertionPosition, false);
  assert.equal(
    new TextPointer(document, 0).GetNextInsertionPosition(
      LogicalDirection.Forward,
    )!.Offset,
    2,
  );
  assert.equal(
    new TextPointer(document, 2).GetNextInsertionPosition(
      LogicalDirection.Forward,
    )!.Offset,
    7,
  );
  assert.equal(
    document.ContentStart.GetInsertionPosition(LogicalDirection.Forward)!
      .Offset,
    0,
  );
  assert.equal(
    document.ContentEnd.GetInsertionPosition(LogicalDirection.Backward)!.Offset,
    document.Text.length,
  );
  assert.equal(run.ContentStart.Parent, run);
  assert.equal(run.ContentStart.Paragraph, paragraph);
});

test("TextPointer run editing mutates actual text and preserves neighboring formatting", () => {
  const run = new Run("abcd"),
    bold = new Bold("tail"),
    document = new FlowDocument(new Paragraph([run, bold]));
  const pointer = new TextPointer(document, 2);
  pointer.InsertTextInRun("X");
  assert.equal(document.Text, "abXcdtail");
  assert.equal(pointer.Offset, 3);
  assert.equal(pointer.DeleteTextInRun(-2), 2);
  assert.equal(document.Text, "acdtail");
  assert.equal(pointer.Offset, 1);
  assert.equal(pointer.DeleteTextInRun(99), 2);
  assert.equal(document.Text, "atail");
  assert.equal(bold.Inlines.Get(0).Text, "tail");
  const empty = new Paragraph();
  document.Blocks.Add(empty);
  empty.ContentStart.InsertTextInRun("empty");
  assert.equal(empty.Text, "empty");
});

test("precise pointer edits preserve insertion gravity even when every character repeats", () => {
  const run = new Run("aaaa"),
    document = new FlowDocument(new Paragraph(run));
  const forward = new TextPointer(document, 2),
    backward = new TextPointer(document, 2, LogicalDirection.Backward);
  forward.InsertTextInRun("a");
  assert.equal(forward.Offset, 3);
  assert.equal(backward.Offset, 2);
  assert.equal(forward.DeleteTextInRun(-1), 1);
  assert.equal(forward.Offset, 2);
  assert.equal(backward.Offset, 2);
  assert.throws(
    () =>
      document.SetPendingTextChanges([
        { Start: 1, RemovedLength: 0, InsertedLength: 1 },
        { Start: 1, RemovedLength: 0, InsertedLength: 1 },
      ]),
    /nonoverlapping/,
  );
});

test("live pointer insertion gravity survives engine undo and redo with repeated text", () => {
  const document = new FlowDocument(new Paragraph("aaaa")),
    engine = new RichTextEngine(document);
  const forward = new TextPointer(document, 2),
    backward = new TextPointer(document, 2, LogicalDirection.Backward);
  engine.Select(2);
  engine.InsertText("a");
  assert.deepEqual([forward.Offset, backward.Offset], [3, 2]);
  engine.Undo();
  assert.deepEqual([forward.Offset, backward.Offset], [2, 2]);
  engine.Redo();
  assert.deepEqual([forward.Offset, backward.Offset], [3, 2]);
  engine.Dispose();
});

test("insertion positions do not enter embedded UI or LineBreak element interiors", () => {
  const embedded = new InlineUIContainer(new Image("image")),
    line = new LineBreak();
  const document = new FlowDocument(
    new Paragraph([new Run("a"), embedded, line, new Run("b")]),
  );
  assert.equal(embedded.ContentStart.IsAtInsertionPosition, false);
  assert.equal(line.ContentStart.IsAtInsertionPosition, false);
  assert.equal(embedded.ElementStart.IsAtInsertionPosition, true);
  assert.equal(embedded.ElementEnd.IsAtInsertionPosition, true);
  assert.equal(document.GetSymbolMap().Text, "a\uFFFC\nb");
});

test("snapshot traversal remains within its captured text after the live document is shortened", () => {
  const run = new Run("abcdef"),
    paragraph = new Paragraph(run),
    document = new FlowDocument(paragraph);
  const snapshot = new TextPointer(document, 3).CreateSnapshot();
  document.Blocks.Clear();
  assert.equal(
    snapshot.GetPositionAtOffset(2)!.GetTextInRun(LogicalDirection.Forward),
    "f",
  );
  assert.equal(snapshot.DocumentEnd.Offset, 6);
  assert.equal(snapshot.DocumentEnd.IsLive, false);
  assert.equal(
    snapshot
      .GetNextContextPosition(LogicalDirection.Forward)!
      .GetPointerContext(LogicalDirection.Forward),
    TextPointerContext.ElementEnd,
  );
  assert.equal(snapshot.Paragraph, paragraph);
});
