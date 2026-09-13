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

Version 0.2 makes `TextPointer` positions live. Insertions and deletions update an existing pointer before document `Changed` subscribers run. `LogicalDirection.Forward` places a pointer after text inserted exactly at its position; `Backward` keeps it before that insertion. Element boundary pointers retain the same surviving element through collection edits and canonical replacement. Unchanged runs are tracked by ID, preserving anchors when other paragraphs change. This follows the position-tracking model described in the [official TextPointer documentation](https://learn.microsoft.com/en-us/dotnet/api/system.windows.documents.textpointer?view=windowsdesktop-10.0).

```ts
import {
  FlowDocument,
  Paragraph,
  Run,
  TextPointer,
  LogicalDirection,
} from "@wieslawsoltes/richtextweb/core";

const run = new Run("abcd");
const document = new FlowDocument(new Paragraph(run));
const after = new TextPointer(document, 2, LogicalDirection.Forward);
const before = new TextPointer(document, 2, LogicalDirection.Backward);
after.InsertTextInRun("X");
console.log(document.Text, before.Offset, after.Offset); // abXcd, 2, 3

const snapshot = after.CreateSnapshot();
run.Text = "prefix " + run.Text;
console.log(after.Offset, snapshot.Offset); // 10, 3
```

`CreateSnapshot()` explicitly captures nontracking text and structural coordinates. `new TextPointer(document, offset, direction, { TrackChanges: false })` also creates a snapshot. `Dispose()` stops a live pointer from tracking changes; snapshots cannot edit a document. Live registrations use weak references, so documents do not keep otherwise unreferenced pointers alive. A structural index is built lazily and invalidated when text or child collections change.

Batches update pointers before their final notification. Reading a pointer inside a batch synchronizes it with the current intermediate tree. Direct `Run.Text` assignment provides replacement text, not an edit operation; the model infers a contiguous change using the common prefix and suffix. For multiple distant changes within one run, an adapter can supply `document.SetPendingTextChanges([{ Start, RemovedLength, InsertedLength }, ...])` before applying the batch. Ranges use the original UTF-16 coordinates, must be sorted and disjoint, and cannot share a start. They are consumed once during the next pointer synchronization. Their total length change must match the resulting text; otherwise the model uses its ordinary inference. Avoid reading pointers partway through an adapter batch whose ranges describe the complete result. `InsertTextInRun` and `DeleteTextInRun` supply exact ranges themselves, including repeated-character edits.

## Structural symbols and traversal

UTF-16 APIs retain their 0.1 units: `Offset`, `GetPositionAtOffset`, `GetOffsetToPosition`, and `CompareTo`. A separate symbol coordinate supports document-tree traversal. WPF counts an opening or closing text-element edge, each UTF-16 code unit in a Run, and an embedded UI element as symbols. A UI element's contents do not add further symbols. RichTextWeb applies those counting rules to its supported hierarchy, excluding the FlowDocument root and table-column metadata. See [Microsoft's symbol definition](https://learn.microsoft.com/en-us/dotnet/api/system.windows.documents.textpointer?view=windowsdesktop-10.0).

| API                                                          | Meaning                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------ |
| `document.GetSymbolMap()`                                    | Immutable index of the current text and structural segments        |
| `document.SymbolCount`                                       | Total structural symbols                                           |
| `pointer.SymbolOffset`                                       | Pointer position in structural symbols                             |
| `TextPointer.FromSymbolOffset(document, offset, direction?)` | Construct an absolute structural position                          |
| `document.GetPositionAtSymbolOffset(offset, direction?)`     | Absolute position, or `null` outside the document                  |
| `pointer.GetPositionAtSymbolOffset(delta, direction?)`       | Relative structural movement                                       |
| `pointer.GetSymbolOffsetToPosition(other)`                   | Signed symbol distance                                             |
| `pointer.CompareSymbolTo(other)`                             | Structural ordering, including edges at equal plain-text positions |
| `map.GetTextOffset(symbolOffset)`                            | Convert a structural position to its plain-text coordinate         |
| `map.GetSymbolOffset(textOffset, direction?)`                | Resolve a plain-text position toward adjacent text content         |
| `map.GetElementBounds(elementOrId)`                          | ElementStart, ContentStart, ContentEnd and ElementEnd in symbols   |

For `new FlowDocument(new Paragraph(new Run("A😀")))`, the plain length is 3 and the symbol count is 7: two paragraph edges, two run edges and three UTF-16 code units. `Run.ContentStart` has symbol offset 2 and plain offset 0. `ContentStart` uses backward gravity and `ContentEnd` uses forward gravity. The former matches the documented [TextElement.ContentStart direction](https://learn.microsoft.com/en-us/dotnet/api/system.windows.documents.textelement.contentstart?view=windowsdesktop-10.0).

Paragraph separators and `LineBreak` newlines are synthetic plain-text characters, while their structural representation uses element edges. Several structural positions can therefore have the same plain offset. At nested container boundaries, the element's plain `ContentStart`/`ContentEnd` denotes its visible content range; a raw symbol-to-text conversion may fall on the other side of a synthetic separator. Preserve symbol offsets when exact structural placement matters. A direct `Image` contributes one embedded symbol as a portable extension; an explicit UI container contributes its own two edges and one embedded symbol when populated. An empty UI container retains the existing U+FFFC plain-text placeholder but contributes only its two structural edges.

`GetPointerContext(direction)` returns `None`, `Text`, `ElementStart`, `ElementEnd`, or `EmbeddedElement`. `GetNextContextPosition(direction)` crosses one structural edge or the remainder of an adjacent text run. `GetAdjacentElement`, `Parent`, `Paragraph`, `DocumentStart`, `DocumentEnd`, `IsInSameDocument`, and `GetPropertyValue` support model inspection. This follows the categories and directional behavior described by [GetPointerContext](https://learn.microsoft.com/en-us/dotnet/api/system.windows.documents.textpointer.getpointercontext?view=windowsdesktop-10.0).

```ts
import {
  LogicalDirection,
  TextPointerContext,
} from "@wieslawsoltes/richtextweb/core";

let position: TextPointer | null = document.ContentStart;
while (position) {
  if (
    position.GetPointerContext(LogicalDirection.Forward) ===
    TextPointerContext.Text
  ) {
    console.log(position.GetTextInRun(LogicalDirection.Forward));
  }
  position = position.GetNextContextPosition(LogicalDirection.Forward);
}
```

`GetTextInRun(direction)` stops at the next structural edge; it does not flatten adjacent formatted runs. The buffer overload accepts `string[]` or `Uint16Array`, an array index and a maximum count, and returns the number copied. Backward reads retain normal character order and copy the nearest requested characters. `GetTextRunLength` returns the adjacent UTF-16 length. These operations correspond to the official [GetTextInRun contract](https://learn.microsoft.com/en-us/dotnet/api/system.windows.documents.textpointer.gettextinrun?view=windowsdesktop-10.0).

`IsAtInsertionPosition`, `GetInsertionPosition`, and `GetNextInsertionPosition` exclude positions outside paragraph content and avoid grapheme splits through `Intl.Segmenter` where available. The fallback avoids surrogate-pair splits. This is logical insertion navigation, not a bidi-aware visual caret or native WPF font/shaping implementation. `InsertTextInRun` edits an existing run or creates one at a valid inline boundary. `DeleteTextInRun` removes a signed number of UTF-16 code units from the adjacent run without crossing structural edges. Direct pointer edits are model mutations; applications that require undo grouping should route user commands through the editing engine.

## Scope

This model is the shared foundation for editing, HTML/Markdown/DOCX conversion and browser controls. It does not itself paginate, shape glyphs, resolve native fonts, render arbitrary WPF controls, execute hyperlinks, import binary Word formats or edit arbitrary existing PDF content. Format and rendering support are described in the relevant modules. Unsupported element types fail explicitly.
