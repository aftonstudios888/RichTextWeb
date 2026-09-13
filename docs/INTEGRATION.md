# Application integration

RichTextWeb shares one JavaScript `FlowDocument` model and editing engine across its custom element, React adapter, MVVM bindings and native WebView hosts. The PascalCase APIs ease migration from .NET code. WPF/WinUI/Avalonia integration runs this same engine inside a WebView; it is not a separate native text layout implementation or a binary-compatible replacement for the framework controls.

## Web component

```ts
import {
  FlowDocument,
  Paragraph,
  Run,
  registerRichTextWeb,
} from "@wieslawsoltes/richtextweb";
registerRichTextWeb();
const editor = document.createElement("rich-text-box");
editor.Document = new FlowDocument(
  new Paragraph(new Run("Hello from a shared model")),
);
editor.addEventListener("documentchange", (event) => {
  console.log(editor.Document.Revision, editor.Document.Text);
});
document.body.append(editor);
editor.Engine.Select(0, 5);
editor.Execute("ToggleBold");
```

The root package, `./core`, `./web`, `./mvvm`, `./formats` and `./bridge` do not require React. Custom element properties receive objects directly; do not serialize document objects into HTML attributes. In Vue use a DOM property binding (`:Document.prop="document"`) and register `rich-text-box` as a custom element in the compiler. In Angular enable `CUSTOM_ELEMENTS_SCHEMA` and use `[Document]="document"`. Both use the native `documentchange` event. Other frameworks can assign the element's `.Document` and subscribe with `addEventListener`.

## MVVM

```ts
import {
  ObservableObject,
  Binding,
  BindingMode,
  RelayCommand,
  BindCommand,
  CompositeDisposable,
  FlowDocument,
  Paragraph,
  Run,
} from "@wieslawsoltes/richtextweb";

class EditorViewModel extends ObservableObject {
  constructor() {
    super();
    this.Document = new FlowDocument(new Paragraph(new Run("Edit me")));
  }
  get Document() {
    return this.GetProperty<FlowDocument>("Document");
  }
  set Document(value: FlowDocument) {
    this.SetProperty("Document", value);
  }
}

const vm = new EditorViewModel();
const lifetime = new CompositeDisposable();
lifetime.Add(
  new Binding({
    Source: vm,
    Path: "Document",
    Mode: BindingMode.TwoWay,
  }).Attach(editor, "Document"),
);
const undo = lifetime.Add(
  new RelayCommand(
    () => editor.Undo(),
    () => editor.Engine.CanUndo,
  ),
);
lifetime.Add(BindCommand(document.querySelector("#undo")!, undo));
const changed = () => undo.NotifyCanExecuteChanged();
editor.addEventListener("commandstatechange", changed);
// On unmount: remove the commandstatechange listener and call lifetime.Dispose().
```

`ObservableObject` supports conventional accessors as above and `new ObservableObject({ Title: 'Untitled' })` for dynamically defined properties. `PropertyChanged.Subscribe` returns an `IDisposable`. Nested binding paths subscribe to observable intermediate objects and reconnect when any parent changes. Dispose bindings when their views are removed.

| Binding mode     | Initial transfer | Subsequent transfers                             |
| ---------------- | ---------------- | ------------------------------------------------ |
| `OneWay`         | Source → target  | Source changes                                   |
| `TwoWay`         | Source → target  | Source changes and target event/property changes |
| `OneTime`        | Source → target  | None                                             |
| `OneWayToSource` | Target → source  | Target changes                                   |

`IValueConverter` implements `Convert` and, for two-way changes, `ConvertBack`. `UpdateSourceEvent` chooses the DOM event; `Document` defaults to `documentchange`, other properties to `change`. Plain objects can call `BindingExpression.UpdateSource()` explicitly. These bindings do not reproduce WPF XAML binding markup, dependency-property precedence or validation rules.

`RelayCommand` supports `CanExecute`, `CanExecuteChanged`, `NotifyCanExecuteChanged` and disposal. `AsyncRelayCommand` exposes `IsRunning`, `Error`, `ExecutionTask` and `Cancel()` with an `AbortSignal`; it prevents overlapping execution. Its returned promise rejects on failure. `BindCommand` routes failures to a supplied callback or the bubbling `commanderror` event. `CompositeDisposable` disposes every child even if one cleanup throws.

## React 18 and 19

```tsx
import { useRef } from "react";
import {
  FlowDocument,
  Paragraph,
  Run,
  RichTextBox,
} from "@wieslawsoltes/richtextweb";
import {
  RichTextEditor,
  useFlowDocument,
} from "@wieslawsoltes/richtextweb/react";

export function Editor() {
  const document = useFlowDocument(
    () => new FlowDocument(new Paragraph(new Run("React document"))),
  );
  const editor = useRef<RichTextBox>(null);
  return (
    <>
      <button onClick={() => editor.current?.Execute("ToggleBold")}>
        Bold
      </button>
      <RichTextEditor
        ref={editor}
        document={document}
        viewMode="page"
        zoom={1}
        aria-label="Document editor"
        style={{ height: 600 }}
        onDocumentChange={(doc) => console.log(doc.Revision)}
      />
      <output>{document.Text.length} UTF-16 code units</output>
    </>
  );
}
```

`document` is a shared mutable model. Mutations already update every subscribed control; replacing the prop's identity assigns a new document. `defaultDocument` is applied once for an uncontrolled editor. `onDocumentChange` reports control changes and avoids echoing a document assignment performed by the React adapter. `onSelectionChange`, `onCommandStateChange`, `onReady`, `readOnly`, `acceptsTab`, `zoom`, `viewMode`, native HTML attributes and forwarded control refs are supported. Event listeners detach when the component unmounts.

`useDocumentRevision(document)` reads a stable revision snapshot through React's external-store API. `useFlowDocument` creates a model once and subscribes to revisions. `useObservableProperty` connects a single MVVM property; replace object values to notify React of object changes. Server rendering produces the custom-element shell; editable layout initializes in the browser. See the [React external store documentation](https://react.dev/reference/react/useSyncExternalStore) for snapshot and hydration behavior.

## Native hosts and bridge protocol

See [`adapters/dotnet/README.md`](../adapters/dotnet/README.md) for the reusable C# request client, WebView2 transports, WPF and WinUI helpers, Avalonia transport, and a ready-to-host editor page. The C# APIs are asynchronous because the JavaScript engine lives in another runtime. They provide `INotifyPropertyChanged` for revision, undo/redo state and document snapshots, plus correlated requests, timeouts, cancellation, validated JSON envelopes and deterministic disposal.

```ts
import { connectWebView2 } from "@wieslawsoltes/richtextweb/bridge";
const bridge = connectWebView2(editor.Engine, window.chrome.webview, {
  isReadOnly: () => editor.IsReadOnly,
  includeDocumentInEvents: true,
});
// Dispose when the host closes. The supplied engine remains owned by the editor.
```

The WebView2 API exchanges structured messages with its dedicated `chrome.webview` channel. The adapter does not register a general window `message` listener. Native hosts restrict top-level navigation and validate message sources. This follows the [WebView2 messaging guidance](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/communicate-btwn-web-native). Avalonia hosts use `connectScriptHost`, `NativeWebView.InvokeScript` and `invokeCSharpAction`, described in the [Avalonia WebView documentation](https://docs.avaloniaui.net/controls/web/nativewebview).

Request example:

```json
{
  "channel": "richtextweb",
  "version": 1,
  "kind": "request",
  "id": "42",
  "method": "insertText",
  "params": { "text": "Hello", "expectedRevision": 7 }
}
```

Responses echo the `id` and contain `result` or `{ "error": { "code": "...", "message": "..." } }`. Events use `kind: "event"`, `event` and `payload`. `ready`/`documentChanged` carry revision, text length, undo/redo, read-only and selection state. `selectionChanged` carries start/end offsets and selected text. Full document change payloads are opt-in to avoid serializing a document for every edit.

| Method                                            | Parameters                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------- |
| `getDocument`, `getText`, `getState`              | None                                                                |
| `setDocument`                                     | `document` canonical JSON; optional `expectedRevision`              |
| `select`                                          | `start`, `end` UTF-16 offsets                                       |
| `insertText`                                      | `text`; optional `expectedRevision`                                 |
| `insertNode`                                      | `node` canonical JSON                                               |
| `deleteBackward`, `deleteForward`, `undo`, `redo` | Optional `expectedRevision`                                         |
| `applyProperty`, `setParagraphProperty`           | `name`, `value`                                                     |
| `execute`                                         | `command`, optional `parameter`                                     |
| `moveSelection`                                   | `destination` UTF-16 offset before the move                         |
| `moveBlocks`                                      | `ids` of contiguous sibling blocks, `parentId`, `index`             |
| `setElementProperty`                              | `id`, `name`, `value`                                               |
| `setTableProperty`, `setCellProperty`             | `name`, `value`; targets the current selection's table or cell      |
| `mergeTableCells`                                 | Optional `count` (default 2); adjacent cells in the selected row    |
| `splitTableCell`                                  | None; splits the selected cell's spans                              |
| `editFloatingContent`                             | Figure/Floater `id`, canonical `blocks` array                       |
| `getReviewState`                                  | None; returns tracking state, current author and revisions          |
| `insertField`                                     | `type`, optional `argument`, `format`                               |
| `updateFields`                                    | Optional `context`                                                  |
| `setStory`                                        | `kind`, canonical `blocks`, optional `sectionId`                    |
| `insertNote`                                      | `kind` (`Footnote`/`Endnote`), `content` string or canonical blocks |
| `updateNote`                                      | `kind`, `id`, `content` string                                      |
| `insertTableOfContents`                           | Optional `options` and `context`                                    |
| `updateTableOfContents`                           | Optional `context`                                                  |
| `mailMerge`                                       | `records`, optional `context` and `expectedRevision`                |

Field context is JSON data: `PageNumber`, `PageCount`, `Locale`, `FileName`, `Data`, an ISO date/time string `Now`, and optional `PageMap` mapping document node IDs to positive page numbers. The bridge builds page lookup internally; it rejects caller-supplied resolver functions. TOC options are `MaxLevel` (1–9), `Title` and `IncludePageNumbers`. Headers and footers use `Headers`, `Footers`, `FirstPageHeader`, `FirstPageFooter`, `EvenPageHeader` or `EvenPageFooter` story kinds.

Mail merge returns canonical JSON documents without changing the template. It remains available for read-only documents, caps each batch at 1,000 records and enforces the configured output-size budget. Split larger jobs into batches. `execute` also reaches the engine's `TrackChanges`, `CurrentAuthor`, `AcceptRevision`, `RejectRevision`, `AcceptAllRevisions` and `RejectAllRevisions` commands.

All mutating methods accept optional `expectedRevision`; mismatch returns `revision_conflict`. Invalid documents, duplicate node IDs, unsupported node types, invalid offsets, excessive message size/depth, prototype keys, cycles and non-JSON values are rejected. The default input limit is 8 Mi UTF-16 code units, 100,000 document nodes and depth 64. `isReadOnly` is evaluated for each mutation. `HandleMessage` returns the response, while `Receive` also posts it. Invalid-envelope errors have `id: null`. Transport failures notify `TransportError`.

Structural editing uses the same engine transactions, undo history and revision tracking as the reusable browser controls. `editFloatingContent` replaces an anchored story without changing its main-story object offset. It validates block hierarchy, properties and IDs before editing; replacement nodes may retain IDs from that story but may not reuse IDs elsewhere in the document. Existing story annotations are mapped to the replacement text. Native callers send canonical JSON blocks, never callbacks.

The C# client exposes `MoveSelectionAsync`, `MoveBlocksAsync`, `SetElementPropertyAsync`, `SetTablePropertyAsync`, `SetCellPropertyAsync`, `MergeTableCellsAsync`, `SplitTableCellAsync` and `EditFloatingContentAsync`. Each accepts optional `expectedRevision` and a cancellation token. Property wrappers preserve explicit JSON `null` values. Revision-aware generic execution is also available through `ExecuteAsync(command, parameter, expectedRevision, token)`; existing overloads remain supported.

```cs
var state = await client.InvokeAsync("getState");
long revision = state.GetProperty("revision").GetInt64();
await client.SetElementPropertyAsync(figureId, "WrapDirection", "Both", revision);

// blocksJson is a JSON array of canonical Paragraph/Table/etc. document nodes.
using var blocks = JsonDocument.Parse(blocksJson);
await client.EditFloatingContentAsync(figureId, blocks.RootElement);
```

Generic `execute` accepts the corresponding PascalCase command names and DTOs: `MoveBlocks` uses `{ Ids, ParentId, Index }`, element formatting uses `{ Id, Name, Value }`, table/cell formatting uses `{ Name, Value }`, and floating replacement uses `{ Id, Blocks }`. `MoveSelection` accepts a numeric offset or `{ Destination }`; `MergeTableCells` accepts a count or `{ Count }`. These aliases pass through the same validation and read-only/revision checks as the explicit methods. Put `expectedRevision` in the outer request parameters, alongside `command`, rather than inside its DTO.

These adapters expose the implemented JavaScript engine through native host controls. Version 0.3 supplies packable native projects, a C# protocol suite against the actual Node engine, and executable Windows WPF, WinUI and Avalonia smoke applications with JSON and rendered evidence. The desktop workflow requires successful runtime reports before packaging; the checked commit's CI result is authoritative. The official Avalonia.Controls.WebView 11.4.0 dependency is MIT licensed. Avalonia runtime execution on Linux/macOS, physical input, screen readers and physical GPU testing still need separate platform qualification. See the [native build and qualification guide](../adapters/dotnet/README.md).
