# Flow document model

RichTextWeb exposes a portable document tree using familiar .NET names. The tree has no DOM dependency and runs in Node.js, browser workers and browsers. A host adapter can embed the same JavaScript engine in WPF, WinUI or Avalonia. These names provide migration familiarity; they do not imply binary compatibility with those frameworks or complete Microsoft Word functionality.

```ts
import {
  FlowDocument,
  Paragraph,
  Run,
  Bold,
  Section,
  List,
  ListItem,
  Table,
  TableRowGroup,
  TableRow,
  TableCell,
  Thickness,
} from "@wieslawsoltes/richtextweb/core";

const greeting = new Run("Welcome ");
const document = new FlowDocument([
  new Paragraph([greeting, new Bold("to RichTextWeb")]),
  new Section(new List(new ListItem(new Paragraph("First item")))),
  new Table(
    new TableRowGroup(
      new TableRow([
        new TableCell(new Paragraph("Name")),
        new TableCell(new Paragraph("Value")),
      ]),
    ),
  ),
]);
document.FontFamily = "Georgia";
document.FontSize = 18;
document.PagePadding = new Thickness(48);
const subscription = document.Changed.Subscribe(({ Revision, Changes }) => {
  console.log(Revision, Changes);
});
document.Change(() => {
  greeting.Text = "Hello ";
  greeting.Foreground = "#2457d6";
});
subscription.Dispose();
```

## Tree and collections

`FlowDocument` and `Section` expose `Blocks`. `Paragraph`, `Span`, `Bold`, `Italic`, `Underline` and `Hyperlink` expose `Inlines`. `List` contains `ListItems`; each `ListItem` contains `Blocks`. Tables contain `RowGroups`, row groups contain `Rows`, rows contain `Cells`, and each cell contains `Blocks`. `Table.Columns` contains `TableColumn` instances, whose widths are numbers or portable strings such as `2*`.

Collections implement `Add`, `AddRange`, `Insert`, `InsertBefore`, `InsertAfter`, `Set`, `Remove`, `RemoveAt`, `Clear`, `Contains`, `IndexOf`, `Get`, `Count`, `ToArray`, `CopyTo`, and JavaScript iteration. `Add` returns the inserted index. `CollectionChanged` reports additions, replacements, removals and resets. `ToArray` returns a defensive array; its elements remain live model objects.

Nodes have one parent and must be removed before insertion into another collection. Collections reject incorrect node types, duplicate ownership and ancestor cycles. `AddRange` validates the entire input before making changes. IDs must be unique across an attached document, including table columns. Attached document IDs are indexed for lookup; `FindById` performs a map lookup and `FindName` traverses names.

`Image` is a portable inline image with `Source`, `AlternativeText`, `Width` and `Height`. `InlineUIContainer` and `BlockUIContainer` accept one optional `Image` child. Arbitrary native UI controls and DOM nodes are intentionally not serialized; custom controls require host adapters.

## Properties and events

`DependencyObject` provides `GetValue`, `SetValue`, `SetCurrentValue`, `ClearValue`, `ReadLocalValue`, and `PropertyChanged`. `DependencyProperty.Register` and `RegisterAttached` support a default value, validation, a property change callback and inheritance metadata. Typography, foreground, alignment, language and flow direction inherit through parents when no local value is present. This inheritance is evaluated when a property is read. An ancestor update produces the ancestor's event and a document event; it does not synthesize a separate `PropertyChanged` event for each descendant.

Common .NET-style properties are exposed directly; additional document metadata can be read and written by name. Properties contain finite JSON data. Inputs, reads and serialized snapshots copy object values so callers cannot bypass notifications by modifying a previously returned object. `Thickness` accepts one uniform value, two horizontal/vertical values, or four left/top/right/bottom values; its serialized value is an object with those four PascalCase keys. Reading a serialized thickness property returns the corresponding plain object.

`EventDispatcher<T>` supports `Subscribe`, `Unsubscribe`, `Emit`, `Invoke`, `Raise`, `Clear`, and `Count`. `Subscribe` returns an idempotent `Dispose()` handle. Dispatch is synchronous and snapshots subscribers. All subscribers receive the event before the first listener error is rethrown. Registering the same function repeatedly creates one active subscription.

A document's `Changed` event contains `Document`, `Revision` and `Changes`. Nested `BeginChange`/`EndChange` blocks emit once at the outer boundary. `Change(action)` pairs these calls with `try/finally`. Batching groups notifications; it is not a rollback transaction. Use the editing engine for undoable user operations. A newly constructed or deserialized document starts at revision zero. Detached element changes do not affect the previous document.

## Serialization and replacement

`ToJSON` produces `{ type, id, props, text?, children? }`. Property names use PascalCase. Text belongs to `Run` nodes. `Table.Columns` is represented in `props.Columns` as column node records, leaving `children` for row groups. `FlowDocument.FromJSON` accepts a record or a JSON string. `elementFromJSON` handles any supported element and allows configurable `MaxDepth` and `MaxNodes` limits; defaults are 256 and 100,000. Unknown types, invalid hierarchy, invalid values and duplicate IDs throw descriptive errors.

`ReplaceWith(other)` copies the other document's properties and children while retaining the receiving document object, root ID and subscriptions. Incoming data is parsed and root-ID collisions are checked before changes occur. Input nodes remain owned by the original source document. `Clone()` copies an element and its IDs; inserting a clone alongside its original requires assigning fresh IDs in the canonical JSON before deserialization.

## Text and positions

Plain text uses UTF-16 offsets, matching JavaScript strings and DOM text positions. Every leaf `Paragraph` contributes its inline text, including empty paragraphs. Leaf paragraph/block-container units are separated by one newline across section, list and table boundaries. Containers do not contribute extra separators. `Run` contributes its text, `LineBreak` contributes a newline, and `Image`, `InlineUIContainer` and `BlockUIContainer` each contribute one U+FFFC object replacement character.

`ContentStart` and `ContentEnd` return `TextPointer` values. `GetPositionAtOffset` returns `null` outside the document, `CompareTo` returns -1/0/1, and `GetOffsetToPosition` returns a signed distance. Cross-document comparisons throw. Insertion-position navigation avoids splitting UTF-16 surrogate pairs. It does not implement complete Unicode grapheme, bidi caret or shaping behavior; browser editing and the editing engine handle their respective editing paths.

Pointers are immutable offset snapshots. Construct new positions after changing the document; a pointer is not a WPF live position that tracks subsequent insertions and deletions. WPF symbol offsets count structural tokens and are therefore different from RichTextWeb plain-text offsets. There is no claim of identical WPF `TextPointer` behavior.

## Scope

This model is the shared foundation for editing, HTML/Markdown/DOCX conversion and browser controls. It does not itself paginate, shape glyphs, resolve native fonts, render arbitrary WPF controls, execute hyperlinks, import binary Word formats or edit arbitrary existing PDF content. Format and rendering support are described in the relevant modules. Unsupported element types fail explicitly.
