import test from "node:test";
import assert from "node:assert/strict";
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
