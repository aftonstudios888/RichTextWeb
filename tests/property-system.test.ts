import test from "node:test";
import assert from "node:assert/strict";
import {
  DependencyObject,
  DependencyProperty,
  DependencyPropertyKey,
  DependencyPropertyHelper,
  PropertyMetadata,
  FrameworkPropertyMetadata,
  FrameworkPropertyMetadataOptions,
  FlowDocument,
  Paragraph,
  Run,
  Span,
  Figure,
  Floater,
  FigureLength,
  LogicalDirection,
  TextPointerContext,
  TextElement,
  Table,
  TableRowGroup,
  TableRow,
  TableCell,
  TableColumn,
} from "../src/model.js";

test("property owners retain identity and derived metadata merges callbacks without replacing validation", () => {
  class Owner extends DependencyObject {}
  class Child extends Owner {}
  class Other extends DependencyObject {}
  const calls: string[] = [];
  const metadata = new FrameworkPropertyMetadata(
    2,
    FrameworkPropertyMetadataOptions.Inherits |
      FrameworkPropertyMetadataOptions.AffectsRender,
    () => calls.push("base"),
    (_owner, value) => Math.min(value, 10),
  );
  const property = DependencyProperty.Register(
    "OwnerCount",
    Number,
    Owner,
    metadata,
    (value) => value >= 0,
  );
  property.OverrideMetadata(
    Child,
    new PropertyMetadata(3, () => calls.push("child")),
  );
  assert.equal(property.AddOwner(Other, { DefaultValue: 4 }), property);
  assert.equal(new Owner().GetValue(property), 2);
  assert.equal(new Child().GetValue(property), 3);
  assert.equal(new Other().GetValue(property), 4);
  const child = new Child();
  child.SetValue(property, 20);
  assert.equal(child.GetValue(property), 10);
  assert.equal(child.ReadLocalValue(property), 20);
  assert.deepEqual(calls, ["base", "child"]);
  assert.equal(property.GetMetadata(Child).Inherits, true);
  assert.equal(
    (property.GetMetadata(Child) as FrameworkPropertyMetadata).AffectsRender,
    true,
  );
  assert.equal(property.DefaultMetadata.IsSealed, true);
  assert.equal(Object.isFrozen(metadata), true);
  assert.throws(() => child.SetValue(property, -1), /Invalid value/);
  assert.throws(
    () =>
      property.OverrideMetadata(class Invalid extends Owner {}, {
        DefaultValue: -1,
      }),
    /Invalid default/,
  );
  assert.throws(
    () =>
      property.OverrideMetadata(class InvalidValidation extends Owner {}, {
        ValidateValueCallback: () => true,
      }),
    /cannot be overridden/,
  );
  class Late extends Owner {}
  new Late().GetValue(property);
  assert.throws(
    () => property.OverrideMetadata(Late, { DefaultValue: 5 }),
    /after use/,
  );
});

test("same-name dependency registrations and AddOwner aliases do not overwrite each other", () => {
  class FirstOwner extends DependencyObject {}
  class SecondOwner extends DependencyObject {}
  const first = DependencyProperty.Register("ScopedValue", Number, FirstOwner, {
    DefaultValue: 1,
  });
  const second = DependencyProperty.Register(
    "ScopedValue",
    Number,
    SecondOwner,
    { DefaultValue: 2 },
  );
  const owner = new FirstOwner();
  owner.SetValue(first, 10);
  owner.SetValue(second, 20);
  assert.equal(owner.GetValue(first), 10);
  assert.equal(owner.GetValue(second), 20);
  assert.equal(owner.GetValue("ScopedValue"), 10);
  const other = new SecondOwner();
  other.SetValue("ScopedValue", 30);
  assert.equal(other.GetValue(second), 30);
  assert.equal(other.GetValue(first), 1);
  assert.throws(
    () => DependencyProperty.Register("ScopedValue", Number, FirstOwner),
    /already registered/,
  );
  assert.throws(() => first.AddOwner(SecondOwner), /already registered/);
  assert.equal(first.IsValidType("2"), false);
});

test("read-only dependency keys authorize set clear and metadata while forged keys cannot", () => {
  class Owner extends DependencyObject {}
  const key = DependencyProperty.RegisterReadOnly(
    "ReadonlyCount",
    Number,
    Owner,
    { DefaultValue: 0 },
  );
  const property = key.DependencyProperty,
    owner = new Owner();
  assert.equal(property.ReadOnly, true);
  assert.throws(() => owner.SetValue(property, 1), /read-only/);
  assert.throws(() => owner.SetValue("ReadonlyCount", 1), /read-only/);
  assert.throws(
    () => new DependencyObject().SetValue("ReadonlyCount", 1),
    /read-only/,
  );
  assert.throws(
    () => owner.SetValue(new DependencyPropertyKey(property), 1),
    /read-only/,
  );
  owner.SetValue(key, 3);
  assert.equal(owner.GetValue(property), 3);
  assert.throws(() => owner.ClearValue(property), /read-only/);
  owner.ClearValue(key);
  assert.equal(owner.GetValue(property), 0);
  class Child extends Owner {}
  assert.throws(
    () => property.OverrideMetadata(Child, { DefaultValue: 2 }),
    /key/,
  );
  key.OverrideMetadata(Child, { DefaultValue: 2 });
  assert.equal(new Child().GetValue(property), 2);
});

test("coercion preserves requested base value and reevaluation restores it when constraints relax", () => {
  class Gauge extends DependencyObject {
    Limit = 10;
  }
  const changes: number[] = [];
  const property = DependencyProperty.Register(
    "GaugeValue",
    Number,
    Gauge,
    new PropertyMetadata(
      20,
      (_owner, event) => changes.push(event.NewValue),
      (owner, value) => Math.min(value, (owner as Gauge).Limit),
    ),
  );
  const owner = new Gauge();
  assert.equal(
    owner.GetValue(property),
    20,
    "metadata defaults are not coerced",
  );
  owner.SetValue(property, 15);
  assert.equal(owner.GetValue(property), 10);
  assert.equal(owner.ReadLocalValue(property), 15);
  assert.equal(
    DependencyPropertyHelper.GetValueSource(owner, property).IsCoerced,
    true,
  );
  owner.Limit = 30;
  owner.CoerceValue(property);
  assert.equal(owner.GetValue(property), 15);
  assert.deepEqual(changes, [10, 15]);
  owner.ClearValue(property);
  assert.equal(owner.GetValue(property), 20);
});

test("rejected coercion leaves local and effective values unchanged and UnsetValue retains previous value", () => {
  class Owner extends DependencyObject {}
  const property = DependencyProperty.Register<number>(
    "RejectCoerce",
    Number,
    Owner,
    {
      DefaultValue: 1,
      CoerceValueCallback: (_owner, value) =>
        value === 5 ? DependencyProperty.UnsetValue : value === 9 ? -1 : value,
    },
    (value) => value >= 0,
  );
  const owner = new Owner();
  owner.SetValue(property, 3);
  owner.SetValue(property, 5);
  assert.equal(owner.GetValue(property), 3);
  assert.equal(owner.ReadLocalValue(property), 5);
  assert.throws(() => owner.SetValue(property, 9), /Invalid coerced/);
  assert.equal(owner.ReadLocalValue(property), 5);
  assert.equal(owner.GetValue(property), 3);
});

test("current values retain source, style precedence and local enumeration snapshot semantics", () => {
  const run = new Run("A"),
    doc = new FlowDocument(new Paragraph(run));
  doc.FontSize = 22;
  run.SetStyleValue(TextElement.FontSizeProperty, 24);
  assert.equal(run.FontSize, 24);
  assert.equal(run.GetValueSource("FontSize").BaseValueSource, "Style");
  run.SetStyleValue("FontSize", 26, true);
  assert.equal(run.FontSize, 26);
  run.FontSize = 28;
  assert.equal(run.FontSize, 28);
  run.SetCurrentValue("FontSize", 30);
  assert.equal(run.FontSize, 30);
  assert.equal(run.ReadLocalValue("FontSize"), 28);
  assert.equal(run.GetValueSource("FontSize").IsCurrent, true);
  const snapshot = run.GetLocalValueEnumerator();
  assert.equal(snapshot.Count, 1);
  assert.throws(() => snapshot.Current, /not positioned/);
  run.FontSize = 32;
  assert.equal(snapshot.MoveNext(), true);
  assert.equal(snapshot.Current.Value, 28);
  assert.equal(snapshot.MoveNext(), false);
  snapshot.Reset();
  assert.equal([...snapshot][0]!.Value, 28);
  run.ClearValue("FontSize");
  assert.equal(run.FontSize, 26);
  run.ClearStyleValue("FontSize", true);
  assert.equal(run.FontSize, 24);
  run.ClearStyleValue("FontSize");
  assert.equal(run.FontSize, 22);
  run.SetCurrentValue("FontSize", 50);
  assert.equal(run.GetValueSource("FontSize").BaseValueSource, "Inherited");
  assert.equal(run.ReadLocalValue("FontSize"), DependencyProperty.UnsetValue);
  doc.FontSize = 23;
  assert.equal(run.FontSize, 23);
});

test("inherited changes notify descendants once and local equal values still persist without effective notifications", () => {
  const first = new Run("A"),
    second = new Run("B"),
    paragraph = new Paragraph(new Span([first, second]));
  const doc = new FlowDocument(paragraph);
  const changes: string[] = [];
  first.PropertyChanged.Subscribe((event) =>
    changes.push(
      `${event.Property}:${event.OldValue}:${event.NewValue}:${event.IsInherited}`,
    ),
  );
  const revision = doc.Revision;
  doc.FontSize = 25;
  assert.deepEqual(changes, ["FontSize:16:25:true"]);
  assert.equal(doc.Revision, revision + 1);
  first.FontSize = 25;
  assert.equal(
    changes.length,
    1,
    "effective callbacks do not fire for equal inherited/local values",
  );
  assert.equal(first.ToJSON().props.FontSize, 25);
  doc.FontSize = 26;
  assert.equal(changes.length, 1);
  first.ClearValue("FontSize");
  assert.equal(first.FontSize, 26);
  assert.equal(changes.length, 2);
});

test("reparenting invalidates inherited current values and parent defaults do not replace child metadata defaults", () => {
  class CustomParagraph extends Paragraph {}
  class CustomRun extends Run {}
  const property = DependencyProperty.RegisterAttached(
    "InheritedCustom",
    Number,
    CustomParagraph,
    { DefaultValue: 1, Inherits: true },
  );
  property.OverrideMetadata(CustomRun, { DefaultValue: 2 });
  const run = new CustomRun("x"),
    paragraph = new CustomParagraph(run),
    doc = new FlowDocument(paragraph);
  assert.equal(run.GetValue(property), 2);
  paragraph.SetValue(property, 4);
  assert.equal(run.GetValue(property), 4);
  const changes: number[] = [];
  run.PropertyChanged.Subscribe((event) => {
    if (event.DependencyProperty === property) changes.push(event.NewValue);
  });
  run.SetCurrentValue(property, 5);
  paragraph.Inlines.Remove(run);
  assert.equal(run.GetValue(property), 2);
  const next = new Paragraph();
  next.SetValue(property, 8);
  doc.Blocks.Add(next);
  next.Inlines.Add(run);
  assert.equal(run.GetValue(property), 8);
  assert.deepEqual(changes, [5, 2, 8]);
});

test("property callback exceptions still notify descendant subscriptions and preserve committed values", () => {
  const run = new Run("x"),
    doc = new FlowDocument(new Paragraph(run));
  let observed = false;
  doc.PropertyChanged.Subscribe(() => {
    throw new Error("observer");
  });
  run.PropertyChanged.Subscribe(() => {
    observed = true;
  });
  assert.throws(() => {
    doc.FontSize = 30;
  }, /observer/);
  assert.equal(run.FontSize, 30);
  assert.equal(observed, true);
});

test("figure and floater stories serialize fully while main story positions remain atomic", () => {
  const figure = new Figure([
    new Paragraph("caption"),
    new Paragraph("details"),
  ]);
  figure.Width = new FigureLength(0.5, "Page");
  figure.HorizontalAnchor = "PageCenter";
  figure.Height = 100;
  figure.HorizontalOffset = 12;
  figure.WrapDirection = "Both";
  const floater = new Floater(new Paragraph("sidebar"));
  floater.Width = 180;
  const after = new Run("B"),
    doc = new FlowDocument([
      new Paragraph([new Run("A"), figure, after, floater]),
      new Paragraph("C"),
    ]);
  assert.equal(doc.Text, "A\uFFFCB\uFFFC\nC");
  assert.equal(doc.GetSymbolMap().Text, doc.Text);
  assert.equal(figure.ElementStart.Offset, 1);
  assert.equal(figure.ElementEnd.Offset, 2);
  assert.equal(after.ContentStart.Offset, 2);
  assert.equal(
    figure.ElementStart.GetPointerContext(LogicalDirection.Forward),
    TextPointerContext.EmbeddedElement,
  );
  assert.throws(() => figure.Blocks.Get(0).ContentStart, /not part of/);
  assert.equal(figure.StoryText, "caption\ndetails");
  const story = figure.CreateStoryDocument();
  assert.equal(story.Text, figure.StoryText);
  assert.equal(story.Blocks.Get(0).Id, figure.Blocks.Get(0).Id);
  story.Blocks.Get(0).FontSize = 45;
  assert.notEqual(figure.Blocks.Get(0).FontSize, 45);
  assert.deepEqual(FlowDocument.FromJSON(doc.ToJSON()).ToJSON(), doc.ToJSON());
  assert.throws(() => {
    figure.HorizontalAnchor = "invalid";
  }, /Invalid value/);
  assert.throws(() => {
    floater.Width = -1;
  }, /Invalid value/);
  assert.throws(
    () => figure.Blocks.Add(new Run("bad") as any),
    /Invalid child/,
  );
  const table = new Table(
    new TableRowGroup(new TableRow(new TableCell(new Paragraph("cell")))),
  );
  table.Columns.Add(new TableColumn("*"));
  assert.equal(table.Columns.Get(0).Width, "*");
});

test("FigureLength validates relative units and provides portable parse equality and flags", () => {
  assert.equal(FigureLength.Parse("Auto").IsAuto, true);
  assert.equal(
    FigureLength.Parse("0.5 Page").Equals(new FigureLength(0.5, "Page")),
    true,
  );
  assert.equal(FigureLength.Parse("2 Column").IsColumn, true);
  assert.equal(FigureLength.Parse("24px").IsAbsolute, true);
  assert.equal(FigureLength.Parse(".25 content").ToString(), "0.25 Content");
  assert.throws(() => new FigureLength(1.1, "Page"), /Invalid/);
  assert.throws(() => FigureLength.Parse("-1 Page"), /Invalid/);
});

test("inheritance observer failures occur only after collections and document identity indexes commit", () => {
  const doc = new FlowDocument();
  doc.FontSize = 30;
  const paragraph = new Paragraph("one"),
    second = new Paragraph("two");
  const subscription = paragraph.PropertyChanged.Subscribe(() => {
    throw new Error("inheritance observer");
  });
  let collectionNotified = false;
  doc.Blocks.CollectionChanged.Subscribe(() => {
    collectionNotified = true;
  });
  assert.throws(() => doc.Blocks.Add(paragraph), /inheritance observer/);
  assert.equal(doc.Blocks.Get(0), paragraph);
  assert.equal(paragraph.Parent, doc);
  assert.equal(doc.FindById(paragraph.Id), paragraph);
  assert.equal(collectionNotified, true);
  assert.throws(() => doc.Blocks.Set(0, second), /inheritance observer/);
  assert.equal(doc.Blocks.Get(0), second);
  assert.equal(second.Parent, doc);
  assert.equal(doc.FindById(paragraph.Id), null);
  assert.equal(doc.FindById(second.Id), second);
  subscription.Dispose();
  second.PropertyChanged.Subscribe(() => {
    throw new Error("remove observer");
  });
  assert.throws(() => doc.Blocks.Clear(), /remove observer/);
  assert.equal(doc.Blocks.Count, 0);
  assert.equal(second.Parent, null);
  assert.equal(doc.FindById(second.Id), null);
});

test("property scalar and empty-bag fast paths retain JSON normalization and custom serializers", () => {
  const owner = new DependencyObject();
  owner.SetValue("NegativeZero", -0);
  assert.equal(Object.is(owner.GetValue("NegativeZero"), 0), true);
  owner.SetValue("EmptyBag", {});
  const detached = owner.GetValue<Record<string, unknown>>("EmptyBag");
  detached.Changed = true;
  assert.deepEqual(owner.GetValue("EmptyBag"), {});
  let serializationReads = 0;
  const custom = Object.defineProperty({}, "toJSON", {
    get() {
      serializationReads++;
      return () => ({ Serialized: true });
    },
  });
  owner.SetValue("CustomValue", custom);
  assert.equal(
    serializationReads,
    2,
    "validation and storage each invoke the custom serializer once",
  );
  assert.deepEqual(owner.GetValue("CustomValue"), { Serialized: true });
  assert.throws(
    () => owner.SetValue("InvalidNumber", Infinity),
    /finite JSON|serializable JSON/,
  );
});
