# Document properties and floating stories

The shared model supplies dependency-property registration, metadata and value evaluation using .NET-style names. These APIs are available from the root package and `/core`; they require no DOM, native window or framework adapter.

```ts
import {
  DependencyObject,
  DependencyProperty,
  FrameworkPropertyMetadata,
  FrameworkPropertyMetadataOptions,
  DependencyPropertyHelper,
} from "@wieslawsoltes/richtextweb/core";

class Measure extends DependencyObject {
  Maximum = 100;
  static readonly AmountProperty = DependencyProperty.Register<number>(
    "Amount",
    Number,
    Measure,
    new FrameworkPropertyMetadata(
      0,
      FrameworkPropertyMetadataOptions.AffectsRender,
      (owner, change) => console.log(change.OldValue, change.NewValue),
      (owner, requested) => Math.min(requested, (owner as Measure).Maximum),
    ),
    (value) => Number.isFinite(value) && value >= 0,
  );
}

const measure = new Measure();
measure.SetValue(Measure.AmountProperty, 200);
measure.GetValue(Measure.AmountProperty); // 100, the coerced value
measure.ReadLocalValue(Measure.AmountProperty); // 200, the requested base value
measure.Maximum = 250;
measure.CoerceValue(Measure.AmountProperty);
measure.GetValue(Measure.AmountProperty); // 200
DependencyPropertyHelper.GetValueSource(measure, Measure.AmountProperty);
```

## Implemented semantics

| API or behavior                                                       | Contract                                                                                                                                                                                                                            |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Register`, `RegisterAttached`                                        | Property type, owner, default, immutable registration-wide validation callback; duplicate owner/name registrations are rejected.                                                                                                    |
| `PropertyMetadata`, `UIPropertyMetadata`, `FrameworkPropertyMetadata` | Constructor forms and object initializers; sealed registration metadata; layout/binding flags available to adapters.                                                                                                                |
| `GetMetadata`, `OverrideMetadata`                                     | Most specific owner metadata; inherited default/coercion callbacks; base-first property-change callbacks. Overrides after the owner or its derived types have used the property are rejected.                                       |
| `AddOwner`                                                            | Returns the same dependency-property identity and adds owner-specific metadata.                                                                                                                                                     |
| `RegisterReadOnly`, `RegisterAttachedReadOnly`                        | A `DependencyPropertyKey` authorizes writes, clears and metadata overrides. Forged keys and property-only writes are rejected.                                                                                                      |
| `GetValue`, `SetValue`, `ClearValue`                                  | Effective value evaluation; clearing reveals the next source; local requested values remain available for serialization and coercion reevaluation.                                                                                  |
| `SetStyleValue`, `ClearStyleValue`                                    | Host-supplied style setters and active style triggers, with local > trigger > style > inherited > metadata-default precedence.                                                                                                      |
| `SetCurrentValue`                                                     | Overrides the current effective value without changing its base source or the local requested value. Reevaluation or a new base source replaces the current override.                                                               |
| `CoerceValue`, `InvalidateProperty`                                   | Explicit reevaluation; a coercion callback returning `UnsetValue` keeps the previous effective value. Invalid coercion results do not commit the proposed mutation. Metadata defaults are not coerced.                              |
| `ReadLocalValue`, `GetLocalValueEnumerator`                           | `UnsetValue` distinguishes absent local values. Enumeration is a defensive snapshot with `Count`, `Current`, `MoveNext`, `Reset`, and JavaScript iteration.                                                                         |
| `GetValueSource`, `DependencyPropertyHelper.GetValueSource`           | Reports source, coercion and current-value status. Expressions and animation are reported false because this model does not install native expression or animation objects.                                                         |
| Inheritance                                                           | Descendants receive effective `PropertyChanged` notifications when ancestor values or parent relationships change. Local and style values stop inheritance. A parent metadata default does not erase a more specific child default. |
| Equal effective values                                                | Setting a local value equal to an inherited value still persists that local choice and records a document change; effective-value callbacks are not raised.                                                                         |
| Observer errors                                                       | Already committed values remain valid; other affected subscribers are notified before an observer exception is surfaced.                                                                                                            |

Built-in document properties expose more identifiers and attached-accessor methods, including typography, flow direction, language, block breaks/keeps, paragraph indentation, page dimensions, columns and hyphenation settings. Existing browser-friendly representations remain supported: `FontWeight` accepts strings or numbers, and thickness values accept numbers, `Thickness`, or its JSON representation.

`TextElement.ToJSON()` stores local requested values. Style sources and `SetCurrentValue` are runtime state; they are not serialized. A renderer or adapter uses `GetValue` to read effective properties. Inheritance changes visit the affected descendants; this is not a native WPF dispatcher or animation engine.

Independent properties with the same name retain separate identities. Secondary registrations use an owner-qualified JSON storage key such as `SecondOwner.Value`. Owner constructor names must be distinct for these conflicting registrations so the keys remain unambiguous. `AddOwner` shares the existing key.

## Figure and Floater stories

`AnchoredBlock` is the abstract inline base class with a `Blocks` collection. `Figure` adds width/height, horizontal and vertical anchors, offsets, wrapping direction and placement policy. `Floater` adds a numeric width and horizontal alignment.

```ts
import {
  FlowDocument,
  Paragraph,
  Run,
  Figure,
  FigureLength,
} from "@wieslawsoltes/richtextweb/core";

const callout = new Figure([
  new Paragraph("Quarterly results"),
  new Paragraph("This caption is a separate rich document story."),
]);
callout.Width = new FigureLength(0.3, "Content");
callout.HorizontalAnchor = "ContentRight";
callout.WrapDirection = "Both";
const document = new FlowDocument(
  new Paragraph([new Run("Introduction "), callout, new Run(" continued.")]),
);
const isolatedStory = callout.CreateStoryDocument();
```

`FigureLength` supports `Auto`, `Pixel`, `Column`, `Content` and `Page`. Page/content fractions must be between zero and one. `Parse`, unit flags, equality and JSON serialization are available. Renderers decide how these measurements fit the available page/column geometry and report unsupported placement cases separately.

Floating objects contribute one `U+FFFC` replacement character to their containing story, preserving unambiguous selection and edit coordinates. Their complete child trees remain in JSON and can contain paragraphs, tables, lists and additional floating stories. `StoryText` reads the child text; `CreateStoryDocument()` clones its blocks, preserves child identities and materializes inherited typography. The engine's scoped floating-content editing API commits story changes with history. Descendant `ContentStart`/`ContentEnd` pointers must be obtained from the isolated story document; those descendants have no positions in the containing story's symbol map.

## Compatibility boundaries and references

These APIs implement portable document-property behavior, not the entire native WPF object system. Native `Brush`, `Freezable`, resource dictionaries, binding expressions, theme/template precedence, routed input events, dispatcher affinity, animation clocks and all framework-specific metadata processing are not reproduced here. Flags such as `AffectsMeasure` are metadata for consuming renderers, not a guarantee of native layout behavior. Values remain finite JSON data to support snapshots, collaboration and serialization. Native WPF symbols, pointers, floating-story positions and native layout measurements do not have universal binary/API equivalence.

The implemented metadata merge rules follow [Microsoft's dependency property metadata description](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/properties/dependency-property-metadata). The base-value, validation and coercion behavior follows [dependency property callbacks and validation](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/properties/dependency-property-callbacks-and-validation), with the finite-JSON constraint above. Current values preserve their source as described by [SetCurrentValue](https://learn.microsoft.com/en-us/dotnet/api/system.windows.dependencyobject.setcurrentvalue). The supported style-source ordering is a subset of [WPF value precedence](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/properties/dependency-property-value-precedence). Floating node names and properties follow the documented [Figure](https://learn.microsoft.com/en-us/dotnet/api/system.windows.documents.figure) and [Floater](https://learn.microsoft.com/en-us/dotnet/api/system.windows.documents.floater) models, with the explicit isolated-story offset distinction above.
