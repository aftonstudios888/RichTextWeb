/** Portable FlowDocument object model. Positions are UTF-16 plain-text offsets. */
export type PropertyValue = any;
export interface DocumentNode {
  type: string;
  id: string;
  props: Record<string, any>;
  text?: string;
  children?: DocumentNode[];
}
export interface IDisposable {
  Dispose(): void;
}
export type EventHandler<T> = (event: T) => void;

/** Synchronous multicast event. A snapshot makes subscribing/unsubscribing during dispatch safe. */
export class EventDispatcher<T = void> {
  private handlers = new Set<EventHandler<T>>();
  Subscribe(handler: EventHandler<T>): IDisposable {
    if (typeof handler !== "function")
      throw new TypeError("An event handler must be a function.");
    this.handlers.add(handler);
    let disposed = false;
    return {
      Dispose: () => {
        if (!disposed) {
          disposed = true;
          this.handlers.delete(handler);
        }
      },
    };
  }
  Unsubscribe(handler: EventHandler<T>): void {
    this.handlers.delete(handler);
  }
  Emit(event: T): void {
    // Notify every subscriber even when one fails, then surface its exception to the caller.
    const errors: unknown[] = [];
    for (const handler of [...this.handlers]) {
      try {
        handler(event);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw errors[0];
  }
  Invoke(event: T): void {
    this.Emit(event);
  }
  Raise(event: T): void {
    this.Emit(event);
  }
  Clear(): void {
    this.handlers.clear();
  }
  get Count(): number {
    return this.handlers.size;
  }
}

export const FontWeights = {
  Thin: "Thin",
  ExtraLight: "ExtraLight",
  Light: "Light",
  Normal: "Normal",
  Medium: "Medium",
  SemiBold: "SemiBold",
  Bold: "Bold",
  ExtraBold: "ExtraBold",
  Black: "Black",
} as const;
export const FontStyles = {
  Normal: "Normal",
  Italic: "Italic",
  Oblique: "Oblique",
} as const;
export const TextDecorations = {
  None: "None",
  Underline: "Underline",
  Strikethrough: "Strikethrough",
  OverLine: "OverLine",
} as const;
export const TextAlignment = {
  Left: "Left",
  Center: "Center",
  Right: "Right",
  Justify: "Justify",
} as const;
export const FlowDirection = {
  LeftToRight: "LeftToRight",
  RightToLeft: "RightToLeft",
} as const;
export const LogicalDirection = {
  Forward: "Forward",
  Backward: "Backward",
} as const;
export const TextMarkerStyle = {
  None: "None",
  Disc: "Disc",
  Circle: "Circle",
  Square: "Square",
  Box: "Box",
  Decimal: "Decimal",
  LowerRoman: "LowerRoman",
  UpperRoman: "UpperRoman",
  LowerLatin: "LowerLatin",
  UpperLatin: "UpperLatin",
} as const;
export const BaselineAlignment = {
  Baseline: "Baseline",
  Superscript: "Superscript",
  Subscript: "Subscript",
  Top: "Top",
  Center: "Center",
  Bottom: "Bottom",
  TextTop: "TextTop",
  TextBottom: "TextBottom",
} as const;
export const LineStackingStrategy = {
  MaxHeight: "MaxHeight",
  BlockLineHeight: "BlockLineHeight",
} as const;
export type LogicalDirectionValue =
  (typeof LogicalDirection)[keyof typeof LogicalDirection];

export class Thickness {
  readonly Left: number;
  readonly Top: number;
  readonly Right: number;
  readonly Bottom: number;
  constructor(uniform?: number);
  constructor(horizontal: number, vertical: number);
  constructor(left: number, top: number, right: number, bottom: number);
  constructor(left = 0, top = left, right = left, bottom = top) {
    for (const value of [left, top, right, bottom])
      if (!Number.isFinite(value))
        throw new RangeError("Thickness values must be finite.");
    this.Left = left;
    this.Top = top;
    this.Right = right;
    this.Bottom = bottom;
  }
  static Parse(value: string): Thickness {
    if (!value.trim())
      throw new TypeError(
        "Thickness requires one, two, or four numeric values.",
      );
    const parts = value
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (parts.length === 1) return new Thickness(parts[0]);
    if (parts.length === 2) return new Thickness(parts[0], parts[1]);
    if (parts.length === 4)
      return new Thickness(parts[0], parts[1], parts[2], parts[3]);
    throw new TypeError("Thickness requires one, two, or four numeric values.");
  }
  Equals(other: unknown): boolean {
    return (
      other instanceof Thickness &&
      this.Left === other.Left &&
      this.Top === other.Top &&
      this.Right === other.Right &&
      this.Bottom === other.Bottom
    );
  }
  ToString(): string {
    return `${this.Left},${this.Top},${this.Right},${this.Bottom}`;
  }
  toString(): string {
    return this.ToString();
  }
  toJSON(): Record<string, number> {
    return {
      Left: this.Left,
      Top: this.Top,
      Right: this.Right,
      Bottom: this.Bottom,
    };
  }
}
export interface PropertyMetadata<T = any> {
  DefaultValue?: T;
  Inherits?: boolean;
  ValidateValueCallback?: (value: T) => boolean;
  PropertyChangedCallback?: (
    owner: DependencyObject,
    event: PropertyChangedEvent<T>,
  ) => void;
}
export interface PropertyChangedEvent<T = any> {
  Property: string;
  OldValue: T;
  NewValue: T;
}
export class DependencyProperty<T = any> {
  static readonly UnsetValue = Symbol("UnsetValue");
  private static registry = new Map<string, DependencyProperty>();
  readonly Name: string;
  readonly PropertyType: unknown;
  readonly OwnerType: unknown;
  readonly DefaultMetadata: PropertyMetadata<T>;
  constructor(
    name: string,
    metadata: PropertyMetadata<T> = {},
    propertyType?: unknown,
    ownerType?: unknown,
  ) {
    if (!name) throw new TypeError("Dependency property name cannot be empty.");
    this.Name = name;
    this.DefaultMetadata = metadata;
    this.PropertyType = propertyType;
    this.OwnerType = ownerType;
  }
  static Register<T = any>(
    name: string,
    propertyType?: unknown,
    ownerType?: unknown,
    metadata: PropertyMetadata<T> | T = {},
  ): DependencyProperty<T> {
    const normalized =
      metadata &&
      typeof metadata === "object" &&
      ("DefaultValue" in metadata ||
        "Inherits" in metadata ||
        "ValidateValueCallback" in metadata ||
        "PropertyChangedCallback" in metadata)
        ? (metadata as PropertyMetadata<T>)
        : metadata &&
            typeof metadata === "object" &&
            Object.keys(metadata).length === 0
          ? {}
          : { DefaultValue: metadata as T };
    const property = new DependencyProperty<T>(
      name,
      normalized,
      propertyType,
      ownerType,
    );
    this.registry.set(name, property);
    return property;
  }
  static RegisterAttached<T = any>(
    name: string,
    propertyType?: unknown,
    ownerType?: unknown,
    metadata: PropertyMetadata<T> | T = {},
  ): DependencyProperty<T> {
    return this.Register(name, propertyType, ownerType, metadata);
  }
  static Find(name: string): DependencyProperty | undefined {
    return this.registry.get(name);
  }
  AddOwner(ownerType: unknown): DependencyProperty<T> {
    return new DependencyProperty(
      this.Name,
      this.DefaultMetadata,
      this.PropertyType,
      ownerType,
    );
  }
}

const inherited = new Set([
  "FontFamily",
  "FontSize",
  "FontWeight",
  "FontStyle",
  "Foreground",
  "FlowDirection",
  "Language",
  "TextAlignment",
  "LineHeight",
]);
const defaults: Record<string, any> = {
  FontFamily: "system-ui",
  FontSize: 16,
  FontWeight: "Normal",
  FontStyle: "Normal",
  TextDecorations: "None",
  Foreground: "#111827",
  Background: "transparent",
  TextAlignment: "Left",
  FlowDirection: "LeftToRight",
  Language: "en",
  Margin: 0,
  Padding: 0,
  LineHeight: 1.5,
  PageWidth: 816,
  PageHeight: 1056,
  PagePadding: 72,
  ColumnCount: 1,
  ColumnGap: 24,
  BreakPageBefore: false,
  BreakColumnBefore: false,
  KeepTogether: false,
  KeepWithNext: false,
  HeadingLevel: 0,
  BaselineAlignment: "Baseline",
  MarkerStyle: "Disc",
  StartIndex: 1,
  RowSpan: 1,
  ColumnSpan: 1,
  CellSpacing: 0,
  IsHyphenationEnabled: false,
  IsOptimalParagraphEnabled: false,
  IsColumnWidthFlexible: true,
  IsEnabled: true,
};
const positive = new Set(["FontSize", "PageWidth", "PageHeight"]);
const positiveInteger = new Set([
  "ColumnCount",
  "RowSpan",
  "ColumnSpan",
  "StartIndex",
]);
function cloneValue<T>(value: T): T {
  if (value === undefined || value === null) return value;
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value, (_key, item) => {
      if (
        typeof item === "function" ||
        typeof item === "symbol" ||
        typeof item === "bigint" ||
        (typeof item === "number" && !Number.isFinite(item))
      )
        throw new TypeError(
          "Document properties must contain finite JSON data.",
        );
      return item;
    });
  } catch (error) {
    throw new TypeError(
      `Document properties must be serializable JSON: ${String(error)}`,
    );
  }
  return JSON.parse(serialized!) as T;
}
function equalValue(a: unknown, b: unknown): boolean {
  return (
    Object.is(a, b) ||
    (a !== null &&
      b !== null &&
      typeof a === "object" &&
      typeof b === "object" &&
      JSON.stringify(a) === JSON.stringify(b))
  );
}
export class DependencyObject {
  protected values: Record<string, any> = {};
  readonly PropertyChanged = new EventDispatcher<PropertyChangedEvent>();
  protected get InheritanceParent(): DependencyObject | null {
    return null;
  }
  GetValue<T = any>(property: string | DependencyProperty<T>): T {
    const name = typeof property === "string" ? property : property.Name;
    if (Object.prototype.hasOwnProperty.call(this.values, name))
      return cloneValue(this.values[name]);
    const definition =
      typeof property === "string" ? DependencyProperty.Find(name) : property;
    if (
      (definition?.DefaultMetadata.Inherits ?? inherited.has(name)) &&
      this.InheritanceParent
    )
      return this.InheritanceParent.GetValue(property);
    return cloneValue(
      definition?.DefaultMetadata.DefaultValue !== undefined
        ? definition.DefaultMetadata.DefaultValue
        : defaults[name],
    );
  }
  SetValue<T = any>(property: string | DependencyProperty<T>, value: T): void {
    const name = typeof property === "string" ? property : property.Name;
    if (!name || typeof name !== "string")
      throw new TypeError("A property name is required.");
    if (value === undefined || value === DependencyProperty.UnsetValue) {
      this.ClearValue(property);
      return;
    }
    const definition =
      typeof property === "string" ? DependencyProperty.Find(name) : property;
    if (
      definition?.DefaultMetadata.ValidateValueCallback &&
      !definition.DefaultMetadata.ValidateValueCallback(value)
    )
      throw new RangeError(`Invalid value for ${name}.`);
    if (
      (positive.has(name) &&
        !(typeof value === "number" && Number.isFinite(value) && value > 0)) ||
      (positiveInteger.has(name) &&
        !(
          typeof value === "number" &&
          Number.isSafeInteger(value) &&
          value >= 1
        ))
    )
      throw new RangeError(
        `${name} must be a positive ${positiveInteger.has(name) ? "integer" : "number"}.`,
      );
    if (
      name === "HeadingLevel" &&
      !(
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= 0 &&
        value <= 6
      )
    )
      throw new RangeError("HeadingLevel must be between 0 and 6.");
    const next = cloneValue(value);
    if (
      Object.prototype.hasOwnProperty.call(this.values, name) &&
      equalValue(this.values[name], next)
    )
      return;
    const oldValue = this.GetValue(property);
    Object.defineProperty(this.values, name, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: next,
    });
    const event = {
      Property: name,
      OldValue: oldValue,
      NewValue: this.GetValue(property),
    };
    this.OnPropertyChanged(event);
    definition?.DefaultMetadata.PropertyChangedCallback?.(this, event);
    this.PropertyChanged.Emit(event);
  }
  SetCurrentValue<T = any>(
    property: string | DependencyProperty<T>,
    value: T,
  ): void {
    this.SetValue(property, value);
  }
  ReadLocalValue(property: string | DependencyProperty): any {
    const name = typeof property === "string" ? property : property.Name;
    return Object.prototype.hasOwnProperty.call(this.values, name)
      ? cloneValue(this.values[name])
      : DependencyProperty.UnsetValue;
  }
  ClearValue(property: string | DependencyProperty): void {
    const name = typeof property === "string" ? property : property.Name;
    if (!Object.prototype.hasOwnProperty.call(this.values, name)) return;
    const oldValue = this.GetValue(property);
    delete this.values[name];
    const event = {
      Property: name,
      OldValue: oldValue,
      NewValue: this.GetValue(property),
    };
    this.OnPropertyChanged(event);
    const definition =
      typeof property === "string" ? DependencyProperty.Find(name) : property;
    definition?.DefaultMetadata.PropertyChangedCallback?.(this, event);
    this.PropertyChanged.Emit(event);
  }
  protected OnPropertyChanged(_event: PropertyChangedEvent): void {}
}

let idSequence = 0;
function createId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `rtw-${Date.now().toString(36)}-${(++idSequence).toString(36)}`
  );
}
export interface DocumentChange {
  Element: TextElement;
  Kind: "property" | "text" | "insert" | "remove" | "reset";
  Property?: string;
  OldValue?: any;
  NewValue?: any;
  Index?: number;
}
export interface DocumentChangedEvent {
  Document: FlowDocument;
  Revision: number;
  Changes: DocumentChange[];
}
export interface CollectionChangedEvent<T> {
  Action: "Add" | "Remove" | "Reset" | "Replace";
  NewItems: T[];
  OldItems: T[];
  Index: number;
}

export class TextElement extends DependencyObject {
  readonly Type: string;
  private identity = createId();
  private parent: TextElement | null = null;
  /** Internal ownership slots; a node belongs to exactly one collection. */
  _collection: TextElementCollection<any> | null = null;
  protected childCollection?: TextElementCollection<any>;
  /** @internal Shared collection access for structural engine patches. */
  _getChildCollection(): TextElementCollection<any> | undefined {
    return this.childCollection;
  }
  constructor(type = "TextElement") {
    super();
    this.Type = type;
  }
  get Id(): string {
    return this.identity;
  }
  get Parent(): TextElement | null {
    return this.parent;
  }
  get Document(): FlowDocument | null {
    let node: TextElement | null = this;
    while (node) {
      if (node instanceof FlowDocument) return node;
      node = node.Parent;
    }
    return null;
  }
  protected override get InheritanceParent(): DependencyObject | null {
    return this.parent;
  }
  /** @internal */ _setParent(
    parent: TextElement | null,
    collection: TextElementCollection<any> | null,
  ): void {
    this.parent = parent;
    this._collection = collection;
  }
  /** @internal */ _setId(id: string): void {
    if (typeof id !== "string" || !id)
      throw new TypeError("Element id must be a nonempty string.");
    const doc = this.Document;
    if (doc && !(this instanceof FlowDocument))
      throw new Error("Cannot change the identity of an attached element.");
    if (this instanceof FlowDocument) this._changeRootId(this.identity, id);
    this.identity = id;
  }
  /** @internal */ _notify(change: DocumentChange): void {
    this.Document?._record(change);
  }
  protected override OnPropertyChanged(event: PropertyChangedEvent): void {
    this._notify({ Element: this, Kind: "property", ...event });
  }
  get Text(): string {
    return getElementText(this);
  }
  get Children(): readonly TextElement[] {
    return this.childCollection?.ToArray() ?? [];
  }
  private boundaryPointer(
    edge: keyof TextElementSymbolBounds,
    direction: LogicalDirectionValue,
  ): TextPointer {
    const document = this.Document;
    if (!document)
      throw new Error("The element is not attached to a FlowDocument.");
    const bounds = document.GetSymbolMap().GetElementBounds(this);
    if (!bounds)
      throw new Error("This element is not part of the text symbol stream.");
    return TextPointer._fromElementBoundary(document, this.Id, edge, direction);
  }
  get ContentStart(): TextPointer {
    return this.boundaryPointer("ContentStart", LogicalDirection.Backward);
  }
  get ContentEnd(): TextPointer {
    return this.boundaryPointer("ContentEnd", LogicalDirection.Forward);
  }
  get ElementStart(): TextPointer {
    return this.boundaryPointer("ElementStart", LogicalDirection.Forward);
  }
  get ElementEnd(): TextPointer {
    return this.boundaryPointer("ElementEnd", LogicalDirection.Backward);
  }
  ToJSON(): DocumentNode {
    const result: DocumentNode = {
      type: this.Type,
      id: this.Id,
      props: cloneValue(this.values),
    };
    if (this instanceof Run) result.text = this.Text;
    if (this.childCollection)
      result.children = this.childCollection
        .ToArray()
        .map((item) => item.ToJSON());
    return result;
  }
  Clone(): this {
    return (
      this instanceof FlowDocument
        ? FlowDocument.FromJSON(this.ToJSON())
        : elementFromJSON(this.ToJSON())
    ) as this;
  }
  get Name(): string {
    return this.GetValue("Name") ?? "";
  }
  set Name(value: string) {
    this.SetValue("Name", value);
  }
  get Tag(): any {
    return this.GetValue("Tag");
  }
  set Tag(value: any) {
    this.SetValue("Tag", value);
  }
  get FontFamily(): string {
    return this.GetValue("FontFamily");
  }
  set FontFamily(value: string) {
    this.SetValue("FontFamily", value);
  }
  get FontSize(): number {
    return this.GetValue("FontSize");
  }
  set FontSize(value: number) {
    this.SetValue("FontSize", value);
  }
  get FontWeight(): string | number {
    return this.GetValue("FontWeight");
  }
  set FontWeight(value: string | number) {
    this.SetValue("FontWeight", value);
  }
  get FontStyle(): string {
    return this.GetValue("FontStyle");
  }
  set FontStyle(value: string) {
    this.SetValue("FontStyle", value);
  }
  get Foreground(): string {
    return this.GetValue("Foreground");
  }
  set Foreground(value: string) {
    this.SetValue("Foreground", value);
  }
  get Background(): string {
    return this.GetValue("Background");
  }
  set Background(value: string) {
    this.SetValue("Background", value);
  }
  get TextDecorations(): string | string[] {
    return this.GetValue("TextDecorations");
  }
  set TextDecorations(value: string | string[]) {
    this.SetValue("TextDecorations", value);
  }
  get FlowDirection(): string {
    return this.GetValue("FlowDirection");
  }
  set FlowDirection(value: string) {
    this.SetValue("FlowDirection", value);
  }
  get Language(): string {
    return this.GetValue("Language");
  }
  set Language(value: string) {
    this.SetValue("Language", value);
  }
  static readonly FontFamilyProperty = DependencyProperty.Register(
    "FontFamily",
    String,
    TextElement,
    { DefaultValue: defaults.FontFamily, Inherits: true },
  );
  static readonly FontSizeProperty = DependencyProperty.Register(
    "FontSize",
    Number,
    TextElement,
    { DefaultValue: 16, Inherits: true },
  );
  static readonly FontWeightProperty = DependencyProperty.Register(
    "FontWeight",
    String,
    TextElement,
    { DefaultValue: "Normal", Inherits: true },
  );
  static readonly FontStyleProperty = DependencyProperty.Register(
    "FontStyle",
    String,
    TextElement,
    { DefaultValue: "Normal", Inherits: true },
  );
  static readonly ForegroundProperty = DependencyProperty.Register(
    "Foreground",
    String,
    TextElement,
    { DefaultValue: defaults.Foreground, Inherits: true },
  );
  static readonly BackgroundProperty = DependencyProperty.Register(
    "Background",
    String,
    TextElement,
    { DefaultValue: "transparent" },
  );
}

export class TextElementCollection<
  T extends TextElement,
> implements Iterable<T> {
  private items: T[] = [];
  readonly CollectionChanged = new EventDispatcher<CollectionChangedEvent<T>>();
  constructor(
    readonly Owner: TextElement,
    private accepts: (item: TextElement) => boolean = () => true,
  ) {}
  get Count(): number {
    return this.items.length;
  }
  get length(): number {
    return this.Count;
  }
  get FirstBlock(): T | null {
    return this.items[0] ?? null;
  }
  get LastBlock(): T | null {
    return this.items[this.items.length - 1] ?? null;
  }
  get FirstInline(): T | null {
    return this.FirstBlock;
  }
  get LastInline(): T | null {
    return this.LastBlock;
  }
  Get(index: number): T {
    this.checkIndex(index);
    return this.items[index]!;
  }
  at(index: number): T | undefined {
    return this.items.at(index);
  }
  private checkIndex(index: number, inserting = false): void {
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= this.items.length + (inserting ? 1 : 0)
    )
      throw new RangeError("Collection index is out of range.");
  }
  private validate(item: T, ignoredIds = new Set<string>()): void {
    if (!(item instanceof TextElement) || !this.accepts(item))
      throw new TypeError(`Invalid child for ${this.Owner.Type}.`);
    if (item.Parent || item._collection)
      throw new Error(
        "The element already has a parent. Remove it before inserting it elsewhere.",
      );
    for (
      let owner: TextElement | null = this.Owner;
      owner;
      owner = owner.Parent
    )
      if (owner === item)
        throw new Error(
          "An element cannot contain itself or one of its ancestors.",
        );
    const doc = this.Owner.Document;
    if (doc) {
      const pendingIds = new Set<string>();
      for (const node of walkElements(item)) {
        if (
          (doc._hasElementId(node.Id) && !ignoredIds.has(node.Id)) ||
          pendingIds.has(node.Id)
        )
          throw new Error(`Duplicate element id: ${node.Id}`);
        pendingIds.add(node.Id);
      }
    }
  }
  Add(item: T): number {
    const index = this.Count;
    this.Insert(index, item);
    return index;
  }
  AddRange(items: Iterable<T>): void {
    const pending = [...items];
    const seenItems = new Set<T>();
    const seenIds = new Set<string>();
    for (const item of pending) {
      this.validate(item);
      if (seenItems.has(item))
        throw new Error("An element cannot occur twice in a collection.");
      seenItems.add(item);
      for (const node of walkElements(item)) {
        if (seenIds.has(node.Id))
          throw new Error(`Duplicate element id: ${node.Id}`);
        seenIds.add(node.Id);
      }
    }
    const doc = this.Owner.Document;
    doc?.BeginChange();
    try {
      for (const item of pending) this.Add(item);
    } finally {
      doc?.EndChange();
    }
  }
  Insert(index: number, item: T): void {
    this.checkIndex(index, true);
    this.validate(item);
    this.items.splice(index, 0, item);
    item._setParent(this.Owner, this);
    this.Owner.Document?._registerSubtree(item);
    this.Owner._notify({
      Element: this.Owner,
      Kind: "insert",
      NewValue: item,
      Index: index,
    });
    this.CollectionChanged.Emit({
      Action: "Add",
      NewItems: [item],
      OldItems: [],
      Index: index,
    });
  }
  InsertBefore(sibling: T, item: T): void {
    const index = this.IndexOf(sibling);
    if (index < 0) throw new Error("Sibling is not in this collection.");
    this.Insert(index, item);
  }
  InsertAfter(sibling: T, item: T): void {
    const index = this.IndexOf(sibling);
    if (index < 0) throw new Error("Sibling is not in this collection.");
    this.Insert(index + 1, item);
  }
  Set(index: number, item: T): void {
    this.checkIndex(index);
    const previous = this.items[index]!;
    if (previous === item) return;
    this.validate(item, new Set(walkElements(previous).map((node) => node.Id)));
    this.Owner.Document?._unregisterSubtree(previous);
    this.items[index] = item;
    previous._setParent(null, null);
    item._setParent(this.Owner, this);
    this.Owner.Document?._registerSubtree(item);
    this.Owner._notify({
      Element: this.Owner,
      Kind: "reset",
      OldValue: previous,
      NewValue: item,
      Index: index,
    });
    this.CollectionChanged.Emit({
      Action: "Replace",
      NewItems: [item],
      OldItems: [previous],
      Index: index,
    });
  }
  Remove(item: T): boolean {
    const index = this.items.indexOf(item);
    if (index < 0) return false;
    this.RemoveAt(index);
    return true;
  }
  RemoveAt(index: number): void {
    this.checkIndex(index);
    const [item] = this.items.splice(index, 1);
    this.Owner.Document?._unregisterSubtree(item!);
    item!._setParent(null, null);
    this.Owner._notify({
      Element: this.Owner,
      Kind: "remove",
      OldValue: item,
      Index: index,
    });
    this.CollectionChanged.Emit({
      Action: "Remove",
      NewItems: [],
      OldItems: [item!],
      Index: index,
    });
  }
  Clear(): void {
    if (!this.items.length) return;
    const oldItems = this.items;
    this.items = [];
    for (const item of oldItems) {
      this.Owner.Document?._unregisterSubtree(item);
      item._setParent(null, null);
    }
    this.Owner._notify({
      Element: this.Owner,
      Kind: "reset",
      OldValue: oldItems,
      NewValue: [],
    });
    this.CollectionChanged.Emit({
      Action: "Reset",
      NewItems: [],
      OldItems: oldItems,
      Index: 0,
    });
  }
  Contains(item: T): boolean {
    return this.items.includes(item);
  }
  IndexOf(item: T): number {
    return this.items.indexOf(item);
  }
  ToArray(): T[] {
    return [...this.items];
  }
  CopyTo(array: T[], index: number): void {
    if (!Number.isInteger(index) || index < 0)
      throw new RangeError("Array index must be nonnegative.");
    this.items.forEach((item, offset) => {
      array[index + offset] = item;
    });
  }
  [Symbol.iterator](): Iterator<T> {
    return this.items[Symbol.iterator]();
  }
}

export class Inline extends TextElement {
  constructor(type = "Inline") {
    super(type);
  }
  get BaselineAlignment(): string {
    return this.GetValue("BaselineAlignment");
  }
  set BaselineAlignment(value: string) {
    this.SetValue("BaselineAlignment", value);
  }
  get NextInline(): Inline | null {
    if (!this._collection) return null;
    return this._collection.at(this._collection.IndexOf(this) + 1) ?? null;
  }
  get PreviousInline(): Inline | null {
    if (!this._collection) return null;
    const index = this._collection.IndexOf(this);
    return index > 0 ? (this._collection.at(index - 1) ?? null) : null;
  }
}
export class Block extends TextElement {
  constructor(type = "Block") {
    super(type);
  }
  get Margin(): number | Thickness | Record<string, number> {
    return this.GetValue("Margin");
  }
  set Margin(value: number | Thickness | Record<string, number>) {
    this.SetValue("Margin", value);
  }
  get Padding(): number | Thickness | Record<string, number> {
    return this.GetValue("Padding");
  }
  set Padding(value: number | Thickness | Record<string, number>) {
    this.SetValue("Padding", value);
  }
  get TextAlignment(): string {
    return this.GetValue("TextAlignment");
  }
  set TextAlignment(value: string) {
    this.SetValue("TextAlignment", value);
  }
  get LineHeight(): number {
    return this.GetValue("LineHeight");
  }
  set LineHeight(value: number) {
    this.SetValue("LineHeight", value);
  }
  get BreakPageBefore(): boolean {
    return this.GetValue("BreakPageBefore");
  }
  set BreakPageBefore(value: boolean) {
    this.SetValue("BreakPageBefore", value);
  }
  get BreakColumnBefore(): boolean {
    return this.GetValue("BreakColumnBefore");
  }
  set BreakColumnBefore(value: boolean) {
    this.SetValue("BreakColumnBefore", value);
  }
  get KeepTogether(): boolean {
    return this.GetValue("KeepTogether");
  }
  set KeepTogether(value: boolean) {
    this.SetValue("KeepTogether", value);
  }
  get KeepWithNext(): boolean {
    return this.GetValue("KeepWithNext");
  }
  set KeepWithNext(value: boolean) {
    this.SetValue("KeepWithNext", value);
  }
  get NextBlock(): Block | null {
    if (!this._collection) return null;
    return this._collection.at(this._collection.IndexOf(this) + 1) ?? null;
  }
  get PreviousBlock(): Block | null {
    if (!this._collection) return null;
    const index = this._collection.IndexOf(this);
    return index > 0 ? (this._collection.at(index - 1) ?? null) : null;
  }
  static readonly TextAlignmentProperty = DependencyProperty.Register(
    "TextAlignment",
    String,
    Block,
    { DefaultValue: "Left", Inherits: true },
  );
  static readonly MarginProperty = DependencyProperty.Register(
    "Margin",
    Thickness,
    Block,
    { DefaultValue: 0 },
  );
  static readonly PaddingProperty = DependencyProperty.Register(
    "Padding",
    Thickness,
    Block,
    { DefaultValue: 0 },
  );
  static readonly LineHeightProperty = DependencyProperty.Register(
    "LineHeight",
    Number,
    Block,
    { DefaultValue: 1.5, Inherits: true },
  );
}
export class Run extends Inline {
  private text = "";
  constructor(text = "") {
    super("Run");
    if (typeof text !== "string")
      throw new TypeError("Run text must be a string.");
    this.text = text;
  }
  override get Text(): string {
    return this.text;
  }
  override set Text(value: string) {
    if (typeof value !== "string")
      throw new TypeError("Run text must be a string.");
    if (value === this.text) return;
    const oldValue = this.text;
    this.text = value;
    this._notify({
      Element: this,
      Kind: "text",
      Property: "Text",
      OldValue: oldValue,
      NewValue: value,
    });
    this.PropertyChanged.Emit({
      Property: "Text",
      OldValue: oldValue,
      NewValue: value,
    });
  }
}
export type InlineInput = Inline | string | readonly (Inline | string)[];
function addInlines(
  collection: TextElementCollection<Inline>,
  content?: InlineInput,
): void {
  if (content === undefined) return;
  for (const inline of Array.isArray(content) ? content : [content])
    collection.Add(
      typeof inline === "string" ? new Run(inline) : (inline as Inline),
    );
}
function addBlocks(
  collection: TextElementCollection<Block>,
  content?: Block | readonly Block[],
): void {
  if (content === undefined) return;
  collection.AddRange(Array.isArray(content) ? content : [content as Block]);
}
export class Span extends Inline {
  readonly Inlines: TextElementCollection<Inline>;
  constructor(content?: InlineInput, type = "Span") {
    super(type);
    this.Inlines = new TextElementCollection(
      this,
      (item) => item instanceof Inline,
    );
    this.childCollection = this.Inlines;
    addInlines(this.Inlines, content);
  }
}
export class Bold extends Span {
  constructor(content?: InlineInput) {
    super(content, "Bold");
    this.SetValue("FontWeight", "Bold");
  }
}
export class Italic extends Span {
  constructor(content?: InlineInput) {
    super(content, "Italic");
    this.SetValue("FontStyle", "Italic");
  }
}
export class Underline extends Span {
  constructor(content?: InlineInput) {
    super(content, "Underline");
    this.SetValue("TextDecorations", "Underline");
  }
}
export class Hyperlink extends Span {
  readonly RequestNavigate = new EventDispatcher<{
    Uri: string;
    TargetName: string;
  }>();
  constructor(content?: InlineInput, navigateUri?: string) {
    super(content, "Hyperlink");
    if (navigateUri !== undefined) this.NavigateUri = navigateUri;
  }
  get NavigateUri(): string {
    return this.GetValue("NavigateUri") ?? "";
  }
  set NavigateUri(value: string) {
    this.SetValue("NavigateUri", value);
  }
  get TargetName(): string {
    return this.GetValue("TargetName") ?? "";
  }
  set TargetName(value: string) {
    this.SetValue("TargetName", value);
  }
  Navigate(): void {
    this.RequestNavigate.Emit({
      Uri: this.NavigateUri,
      TargetName: this.TargetName,
    });
  }
}
export class LineBreak extends Inline {
  constructor() {
    super("LineBreak");
  }
}
export class Image extends Inline {
  constructor(source = "", alternativeText = "") {
    super("Image");
    if (source) this.Source = source;
    if (alternativeText) this.AlternativeText = alternativeText;
  }
  get Source(): string {
    return this.GetValue("Source") ?? "";
  }
  set Source(value: string) {
    this.SetValue("Source", value);
  }
  get AlternativeText(): string {
    return this.GetValue("AlternativeText") ?? "";
  }
  set AlternativeText(value: string) {
    this.SetValue("AlternativeText", value);
  }
  get Width(): number | undefined {
    return this.GetValue("Width");
  }
  set Width(value: number | undefined) {
    this.SetValue("Width", value);
  }
  get Height(): number | undefined {
    return this.GetValue("Height");
  }
  set Height(value: number | undefined) {
    this.SetValue("Height", value);
  }
}
export class InlineUIContainer extends Inline {
  constructor(child?: Image) {
    super("InlineUIContainer");
    this.childCollection = new TextElementCollection(
      this,
      (item) => item instanceof Image,
    );
    if (child) this.Child = child;
  }
  get Child(): Image | null {
    return this.childCollection!.at(0) ?? null;
  }
  set Child(value: Image | null) {
    if (value === this.Child) return;
    if (value !== null && !(value instanceof Image))
      throw new TypeError(
        "InlineUIContainer accepts a portable Image child; arbitrary native controls require a host adapter.",
      );
    if (value) {
      if (this.childCollection!.Count) this.childCollection!.Set(0, value);
      else this.childCollection!.Add(value);
    } else this.childCollection!.Clear();
  }
}
export class BlockUIContainer extends Block {
  constructor(child?: Image) {
    super("BlockUIContainer");
    this.childCollection = new TextElementCollection(
      this,
      (item) => item instanceof Image,
    );
    if (child) this.Child = child;
  }
  get Child(): Image | null {
    return this.childCollection!.at(0) ?? null;
  }
  set Child(value: Image | null) {
    if (value === this.Child) return;
    if (value !== null && !(value instanceof Image))
      throw new TypeError(
        "BlockUIContainer accepts a portable Image child; arbitrary native controls require a host adapter.",
      );
    if (value) {
      if (this.childCollection!.Count) this.childCollection!.Set(0, value);
      else this.childCollection!.Add(value);
    } else this.childCollection!.Clear();
  }
}
export class Paragraph extends Block {
  readonly Inlines: TextElementCollection<Inline>;
  constructor(content?: InlineInput) {
    super("Paragraph");
    this.Inlines = new TextElementCollection(
      this,
      (item) => item instanceof Inline,
    );
    this.childCollection = this.Inlines;
    addInlines(this.Inlines, content);
  }
  get HeadingLevel(): number {
    return this.GetValue("HeadingLevel");
  }
  set HeadingLevel(value: number) {
    this.SetValue("HeadingLevel", value);
  }
  get TextIndent(): number {
    return this.GetValue("TextIndent") ?? 0;
  }
  set TextIndent(value: number) {
    this.SetValue("TextIndent", value);
  }
}
export class Section extends Block {
  readonly Blocks: TextElementCollection<Block>;
  constructor(content?: Block | readonly Block[]) {
    super("Section");
    this.Blocks = new TextElementCollection(
      this,
      (item) => item instanceof Block,
    );
    this.childCollection = this.Blocks;
    addBlocks(this.Blocks, content);
  }
}
export class List extends Block {
  readonly ListItems: TextElementCollection<ListItem>;
  constructor(content?: ListItem | readonly ListItem[]) {
    super("List");
    this.ListItems = new TextElementCollection(
      this,
      (item) => item instanceof ListItem,
    );
    this.childCollection = this.ListItems;
    if (content)
      this.ListItems.AddRange(
        Array.isArray(content) ? content : [content as ListItem],
      );
  }
  get MarkerStyle(): string {
    return this.GetValue("MarkerStyle");
  }
  set MarkerStyle(value: string) {
    this.SetValue("MarkerStyle", value);
  }
  get StartIndex(): number {
    return this.GetValue("StartIndex");
  }
  set StartIndex(value: number) {
    this.SetValue("StartIndex", value);
  }
  get MarkerOffset(): number {
    return this.GetValue("MarkerOffset") ?? 0;
  }
  set MarkerOffset(value: number) {
    this.SetValue("MarkerOffset", value);
  }
}
export class ListItem extends TextElement {
  readonly Blocks: TextElementCollection<Block>;
  constructor(content?: Block | readonly Block[]) {
    super("ListItem");
    this.Blocks = new TextElementCollection(
      this,
      (item) => item instanceof Block,
    );
    this.childCollection = this.Blocks;
    addBlocks(this.Blocks, content);
  }
}
export class TableColumn extends TextElement {
  constructor(width?: number | string) {
    super("TableColumn");
    if (width !== undefined) this.Width = width;
  }
  get Width(): number | string | undefined {
    return this.GetValue("Width");
  }
  set Width(value: number | string | undefined) {
    this.SetValue("Width", value);
  }
}
export class Table extends Block {
  readonly RowGroups: TextElementCollection<TableRowGroup>;
  readonly Columns: TextElementCollection<TableColumn>;
  constructor(content?: TableRowGroup | readonly TableRowGroup[]) {
    super("Table");
    this.RowGroups = new TextElementCollection(
      this,
      (item) => item instanceof TableRowGroup,
    );
    this.Columns = new TextElementCollection(
      this,
      (item) => item instanceof TableColumn,
    );
    this.childCollection = this.RowGroups;
    if (content)
      this.RowGroups.AddRange(
        Array.isArray(content) ? content : [content as TableRowGroup],
      );
  }
  get CellSpacing(): number {
    return this.GetValue("CellSpacing");
  }
  set CellSpacing(value: number) {
    this.SetValue("CellSpacing", value);
  }
  override ToJSON(): DocumentNode {
    const result = super.ToJSON();
    if (this.Columns.Count)
      result.props.Columns = this.Columns.ToArray().map((column) =>
        column.ToJSON(),
      );
    return result;
  }
}
export class TableRowGroup extends TextElement {
  readonly Rows: TextElementCollection<TableRow>;
  constructor(content?: TableRow | readonly TableRow[]) {
    super("TableRowGroup");
    this.Rows = new TextElementCollection(
      this,
      (item) => item instanceof TableRow,
    );
    this.childCollection = this.Rows;
    if (content)
      this.Rows.AddRange(
        Array.isArray(content) ? content : [content as TableRow],
      );
  }
}
export class TableRow extends TextElement {
  readonly Cells: TextElementCollection<TableCell>;
  constructor(content?: TableCell | readonly TableCell[]) {
    super("TableRow");
    this.Cells = new TextElementCollection(
      this,
      (item) => item instanceof TableCell,
    );
    this.childCollection = this.Cells;
    if (content)
      this.Cells.AddRange(
        Array.isArray(content) ? content : [content as TableCell],
      );
  }
}
export class TableCell extends TextElement {
  readonly Blocks: TextElementCollection<Block>;
  constructor(content?: Block | readonly Block[]) {
    super("TableCell");
    this.Blocks = new TextElementCollection(
      this,
      (item) => item instanceof Block,
    );
    this.childCollection = this.Blocks;
    addBlocks(this.Blocks, content);
  }
  get RowSpan(): number {
    return this.GetValue("RowSpan");
  }
  set RowSpan(value: number) {
    this.SetValue("RowSpan", value);
  }
  get ColumnSpan(): number {
    return this.GetValue("ColumnSpan");
  }
  set ColumnSpan(value: number) {
    this.SetValue("ColumnSpan", value);
  }
  get Padding(): number | Thickness | Record<string, number> {
    return this.GetValue("Padding");
  }
  set Padding(value: number | Thickness | Record<string, number>) {
    this.SetValue("Padding", value);
  }
  get BorderThickness(): number | Thickness | Record<string, number> {
    return this.GetValue("BorderThickness") ?? 0;
  }
  set BorderThickness(value: number | Thickness | Record<string, number>) {
    this.SetValue("BorderThickness", value);
  }
  get BorderBrush(): string {
    return this.GetValue("BorderBrush") ?? "#d1d5db";
  }
  set BorderBrush(value: string) {
    this.SetValue("BorderBrush", value);
  }
}

export class FlowDocument extends TextElement {
  readonly Blocks: TextElementCollection<Block>;
  readonly Changed = new EventDispatcher<DocumentChangedEvent>();
  private revision = 0;
  private changeDepth = 0;
  private pending: DocumentChange[] = [];
  private dispatching = false;
  private symbolMap: TextSymbolMap | undefined;
  private pointerDirty = true;
  private synchronizingPointers = false;
  private pointers = new Set<WeakRef<TextPointer>>();
  private pendingTextChanges: TextChangeSpan[] | undefined;
  /** Exact pre-batch UTF-16 edits. Ranges are sorted, disjoint and expressed in the original document. */
  SetPendingTextChanges(changes: readonly TextChangeSpan[]): void {
    const length = this.GetSymbolMap().Text.length;
    let previousEnd = -1,
      previousStart = -1;
    this.pendingTextChanges = changes.map((change) => {
      const { Start, RemovedLength, InsertedLength } = change;
      if (
        ![Start, RemovedLength, InsertedLength].every(
          (value) => Number.isSafeInteger(value) && value >= 0,
        ) ||
        Start < previousEnd ||
        Start === previousStart ||
        Start + RemovedLength > length
      )
        throw new RangeError(
          "Text change ranges must be sorted, nonoverlapping and inside the pre-edit document.",
        );
      previousEnd = Start + RemovedLength;
      previousStart = Start;
      return { Start, RemovedLength, InsertedLength };
    });
  }
  GetSymbolMap(): TextSymbolMap {
    this._syncPointers();
    return this.symbolMap!;
  }
  get SymbolCount(): number {
    return this.GetSymbolMap().SymbolCount;
  }
  GetPositionAtSymbolOffset(
    offset: number,
    direction: LogicalDirectionValue = LogicalDirection.Forward,
  ): TextPointer | null {
    const map = this.GetSymbolMap();
    if (!Number.isInteger(offset))
      throw new RangeError("Symbol offset must be an integer.");
    return offset < 0 || offset > map.SymbolCount
      ? null
      : TextPointer.FromSymbolOffset(this, offset, direction);
  }
  /** @internal */ _trackPointer(pointer: TextPointer): WeakRef<TextPointer> {
    const reference = new WeakRef(pointer);
    this.pointers.add(reference);
    return reference;
  }
  /** @internal */ _untrackPointer(reference: WeakRef<TextPointer>): void {
    this.pointers.delete(reference);
  }
  /** @internal */ _syncPointers(): void {
    if (this.synchronizingPointers || (!this.pointerDirty && this.symbolMap))
      return;
    this.synchronizingPointers = true;
    try {
      const previous = this.symbolMap;
      const next = new TextSymbolMap(this);
      this.symbolMap = next;
      this.pointerDirty = false;
      const explicit = this.pendingTextChanges;
      this.pendingTextChanges = undefined;
      const edits =
        previous &&
        explicit &&
        previous.Text.length +
          explicit.reduce(
            (total, edit) => total + edit.InsertedLength - edit.RemovedLength,
            0,
          ) ===
          next.Text.length
          ? explicit
          : undefined;
      for (const reference of this.pointers) {
        const pointer = reference.deref();
        if (!pointer) {
          this.pointers.delete(reference);
          continue;
        }
        if (previous) pointer._rebase(previous, next, edits);
      }
    } finally {
      this.synchronizingPointers = false;
    }
  }
  private elementIds = new Map<string, TextElement>([[this.Id, this]]);
  /** @internal */ _hasElementId(id: string): boolean {
    return this.elementIds.has(id);
  }
  /** @internal */ _changeRootId(previous: string, next: string): void {
    if (previous !== next && this.elementIds.has(next))
      throw new Error(`Duplicate element id: ${next}`);
    this.elementIds.delete(previous);
    this.elementIds.set(next, this);
  }
  /** @internal */ _registerSubtree(root: TextElement): void {
    for (const node of walkElements(root)) this.elementIds.set(node.Id, node);
  }
  /** @internal */ _unregisterSubtree(root: TextElement): void {
    for (const node of walkElements(root)) this.elementIds.delete(node.Id);
  }
  constructor(content?: Block | readonly Block[]) {
    super("FlowDocument");
    this.Blocks = new TextElementCollection(
      this,
      (item) => item instanceof Block,
    );
    this.childCollection = this.Blocks;
    addBlocks(this.Blocks, content);
    this.revision = 0;
  }
  get Revision(): number {
    return this.revision;
  }
  get IsInChange(): boolean {
    return this.changeDepth > 0;
  }
  override get ContentStart(): TextPointer {
    return TextPointer.FromSymbolOffset(this, 0, LogicalDirection.Backward);
  }
  override get ContentEnd(): TextPointer {
    return TextPointer.FromSymbolOffset(
      this,
      this.SymbolCount,
      LogicalDirection.Forward,
    );
  }
  get PageWidth(): number {
    return this.GetValue("PageWidth");
  }
  set PageWidth(value: number) {
    this.SetValue("PageWidth", value);
  }
  get PageHeight(): number {
    return this.GetValue("PageHeight");
  }
  set PageHeight(value: number) {
    this.SetValue("PageHeight", value);
  }
  get PagePadding(): number | Thickness | Record<string, number> {
    return this.GetValue("PagePadding");
  }
  set PagePadding(value: number | Thickness | Record<string, number>) {
    this.SetValue("PagePadding", value);
  }
  get ColumnCount(): number {
    return this.GetValue("ColumnCount");
  }
  set ColumnCount(value: number) {
    this.SetValue("ColumnCount", value);
  }
  get ColumnGap(): number {
    return this.GetValue("ColumnGap");
  }
  set ColumnGap(value: number) {
    this.SetValue("ColumnGap", value);
  }
  get TextAlignment(): string {
    return this.GetValue("TextAlignment");
  }
  set TextAlignment(value: string) {
    this.SetValue("TextAlignment", value);
  }
  get LineHeight(): number {
    return this.GetValue("LineHeight");
  }
  set LineHeight(value: number) {
    this.SetValue("LineHeight", value);
  }
  get IsHyphenationEnabled(): boolean {
    return this.GetValue("IsHyphenationEnabled");
  }
  set IsHyphenationEnabled(value: boolean) {
    this.SetValue("IsHyphenationEnabled", value);
  }
  BeginChange(): void {
    this.changeDepth++;
  }
  EndChange(): void {
    if (!this.changeDepth)
      throw new Error("EndChange requires a matching BeginChange.");
    if (--this.changeDepth === 0) this.flush();
  }
  Change(action: () => void): void {
    this.BeginChange();
    try {
      action();
    } finally {
      this.EndChange();
    }
  }
  /** @internal */ _record(change: DocumentChange): void {
    if (change.Kind !== "property") this.pointerDirty = true;
    this.pending.push(change);
    if (!this.changeDepth) this.flush();
  }
  private flush(): void {
    if (this.dispatching || !this.pending.length) return;
    this.dispatching = true;
    try {
      while (this.pending.length && this.changeDepth === 0) {
        if (this.symbolMap || this.pointers.size) this._syncPointers();
        const changes = this.pending;
        this.pending = [];
        this.revision++;
        this.Changed.Emit({
          Document: this,
          Revision: this.Revision,
          Changes: changes,
        });
      }
    } finally {
      this.dispatching = false;
    }
  }
  ReplaceWith(other: FlowDocument): void {
    if (!(other instanceof FlowDocument))
      throw new TypeError("ReplaceWith requires a FlowDocument.");
    if (other === this) return;
    // Parse before mutation: malformed incoming content cannot destroy the current document.
    const replacement = FlowDocument.FromJSON(other.ToJSON());
    for (const child of replacement.Children)
      if (walkElements(child).some((node) => node.Id === this.Id))
        throw new Error(
          `Replacement child duplicates the document id: ${this.Id}`,
        );
    this.BeginChange();
    try {
      this.values = cloneValue(replacement.values);
      this.Blocks.Clear();
      const blocks = replacement.Blocks.ToArray();
      replacement.Blocks.Clear();
      this.Blocks.AddRange(blocks);
      this._record({ Element: this, Kind: "reset" });
    } finally {
      this.EndChange();
    }
  }
  static FromJSON(node: DocumentNode | string): FlowDocument {
    const element = elementFromJSON(
      typeof node === "string" ? JSON.parse(node) : node,
    );
    if (!(element instanceof FlowDocument))
      throw new TypeError("Expected a FlowDocument root.");
    element.revision = 0;
    return element;
  }
  FindName(name: string): TextElement | null {
    return walkElements(this).find((element) => element.Name === name) ?? null;
  }
  FindById(id: string): TextElement | null {
    return this.elementIds.get(id) ?? null;
  }
}

/** Depth-first traversal, including table columns. */
export function walkElements(root: TextElement): TextElement[] {
  const result: TextElement[] = [];
  const visit = (element: TextElement): void => {
    result.push(element);
    if (element instanceof Table)
      for (const column of element.Columns) visit(column);
    for (const child of element.Children) visit(child);
  };
  visit(root);
  return result;
}
function leafBlocks(root: TextElement): TextElement[] {
  const result: TextElement[] = [];
  const visit = (element: TextElement): void => {
    if (element instanceof Paragraph || element instanceof BlockUIContainer)
      result.push(element);
    else for (const child of element.Children) visit(child);
  };
  visit(root);
  return result;
}
function inlineText(root: TextElement): string {
  if (root instanceof Run) return root.Text;
  if (root instanceof LineBreak) return "\n";
  if (
    root instanceof Image ||
    root instanceof InlineUIContainer ||
    root instanceof BlockUIContainer
  )
    return "\uFFFC";
  return root.Children.map(inlineText).join("");
}
export function getElementText(element: TextElement): string {
  if (
    element instanceof Inline ||
    element instanceof Paragraph ||
    element instanceof BlockUIContainer
  )
    return inlineText(element);
  return leafBlocks(element).map(inlineText).join("\n");
}
function elementOffset(document: FlowDocument, target: TextElement): number {
  if (target === document) return 0;
  let position = 0;
  const blocks = leafBlocks(document);
  for (const block of blocks) {
    if (block === target || isAncestor(target, block)) return position;
    let found: number | undefined;
    const scan = (node: TextElement, offset: number): number => {
      if (node === target) found = offset;
      if (node instanceof Run || node instanceof LineBreak)
        return offset + inlineText(node).length;
      if (
        node instanceof Image ||
        node instanceof InlineUIContainer ||
        node instanceof BlockUIContainer
      ) {
        for (const child of node.Children) if (child === target) found = offset;
        return offset + 1;
      }
      let next = offset;
      for (const child of node.Children) next = scan(child, next);
      return next;
    };
    scan(block, position);
    if (found !== undefined) return found;
    position += inlineText(block).length + 1;
  }
  // Empty containers have no leaf text; locate their place in structural order.
  position = 0;
  for (const node of walkElements(document)) {
    if (node === target) break;
    if (node instanceof Paragraph || node instanceof BlockUIContainer)
      position += inlineText(node).length + 1;
  }
  return Math.min(position, document.Text.length);
}
function isAncestor(ancestor: TextElement, descendant: TextElement): boolean {
  for (let node = descendant.Parent; node; node = node.Parent)
    if (node === ancestor) return true;
  return false;
}

/** Context categories use WPF names; offsets remain explicitly separated from UTF-16 positions. */
export const TextPointerContext = {
  None: "None",
  Text: "Text",
  EmbeddedElement: "EmbeddedElement",
  ElementStart: "ElementStart",
  ElementEnd: "ElementEnd",
} as const;
export type TextPointerContextValue =
  (typeof TextPointerContext)[keyof typeof TextPointerContext];
export interface TextChangeSpan {
  Start: number;
  RemovedLength: number;
  InsertedLength: number;
}
export interface TextElementSymbolBounds {
  ElementStart: number;
  ContentStart: number;
  ContentEnd: number;
  ElementEnd: number;
}
export interface TextSymbolSegment {
  readonly Context: Exclude<TextPointerContextValue, "None">;
  readonly SymbolStart: number;
  readonly SymbolEnd: number;
  readonly TextStart: number;
  readonly TextEnd: number;
  readonly Element: TextElement;
  readonly Text: string;
}
interface SymbolElementRecord {
  element: TextElement;
  bounds: TextElementSymbolBounds;
  depth: number;
}
function validateDirection(direction: LogicalDirectionValue): void {
  if (
    direction !== LogicalDirection.Forward &&
    direction !== LogicalDirection.Backward
  )
    throw new RangeError("Logical direction must be Forward or Backward.");
}

/** Immutable structural index: tags count once, Run code units count once, embedded objects count once. */
export class TextSymbolMap {
  readonly Text: string;
  readonly SymbolCount: number;
  readonly Segments: readonly TextSymbolSegment[];
  private records = new Map<string, SymbolElementRecord>();
  private runs = new Map<string, TextSymbolSegment>();
  private graphemes?: number[];
  /** @internal */ _getGraphemeOffsets(): readonly number[] {
    return (this.graphemes ??= graphemeBoundaries(this.Text));
  }
  constructor(readonly Document: FlowDocument) {
    this.Text = Document.Text;
    const segments: TextSymbolSegment[] = [];
    let symbol = 0,
      text = 0,
      leafIndex = 0;
    const add = (
      context: TextSymbolSegment["Context"],
      element: TextElement,
      symbolLength = 1,
      textLength = 0,
      content = "",
    ) => {
      const segment = Object.freeze({
        Context: context,
        SymbolStart: symbol,
        SymbolEnd: symbol + symbolLength,
        TextStart: text,
        TextEnd: text + textLength,
        Element: element,
        Text: content,
      });
      if (symbolLength > 0) segments.push(segment);
      if (context === TextPointerContext.Text)
        this.runs.set(element.Id, segment);
      symbol += symbolLength;
      text += textLength;
    };
    const visit = (element: TextElement, depth: number): void => {
      if (element instanceof TableColumn) return;
      if (element instanceof Image) {
        const start = symbol;
        add(TextPointerContext.EmbeddedElement, element, 1, 1);
        this.records.set(element.Id, {
          element,
          depth,
          bounds: Object.freeze({
            ElementStart: start,
            ContentStart: start,
            ContentEnd: symbol,
            ElementEnd: symbol,
          }),
        });
        return;
      }
      const start = symbol;
      const delimiter =
        element instanceof Paragraph || element instanceof BlockUIContainer
          ? leafIndex++ > 0
            ? 1
            : 0
          : 0;
      add(TextPointerContext.ElementStart, element, 1, delimiter);
      const contentStart = symbol;
      if (element instanceof Run)
        add(
          TextPointerContext.Text,
          element,
          element.Text.length,
          element.Text.length,
          element.Text,
        );
      else if (
        element instanceof InlineUIContainer ||
        element instanceof BlockUIContainer
      ) {
        // Portable UI containers retain one replacement character even when no child is installed.
        if (element.Child) {
          const embeddedStart = symbol;
          add(TextPointerContext.EmbeddedElement, element.Child, 1, 1);
          this.records.set(element.Child.Id, {
            element: element.Child,
            depth: depth + 1,
            bounds: Object.freeze({
              ElementStart: embeddedStart,
              ContentStart: embeddedStart,
              ContentEnd: symbol,
              ElementEnd: symbol,
            }),
          });
        }
      } else if (!(element instanceof LineBreak))
        for (const child of element.Children) visit(child, depth + 1);
      const contentEnd = symbol;
      let plainOnEnd =
        element instanceof LineBreak ||
        ((element instanceof InlineUIContainer ||
          element instanceof BlockUIContainer) &&
          !element.Child)
          ? 1
          : 0;
      add(TextPointerContext.ElementEnd, element, 1, plainOnEnd);
      this.records.set(element.Id, {
        element,
        depth,
        bounds: Object.freeze({
          ElementStart: start,
          ContentStart: contentStart,
          ContentEnd: contentEnd,
          ElementEnd: symbol,
        }),
      });
    };
    for (const block of Document.Blocks) visit(block, 1);
    this.SymbolCount = symbol;
    this.Segments = Object.freeze(segments);
    this.records.set(Document.Id, {
      element: Document,
      depth: 0,
      bounds: Object.freeze({
        ElementStart: 0,
        ContentStart: 0,
        ContentEnd: symbol,
        ElementEnd: symbol,
      }),
    });
  }
  GetElementBounds(
    element: TextElement | string,
  ): Readonly<TextElementSymbolBounds> | null {
    return (
      this.records.get(typeof element === "string" ? element : element.Id)
        ?.bounds ?? null
    );
  }
  GetTextOffset(symbolOffset: number): number {
    this.validateSymbolOffset(symbolOffset);
    if (symbolOffset === this.SymbolCount) return this.Text.length;
    const segment = this.GetAdjacentSegment(
      symbolOffset,
      LogicalDirection.Forward,
    );
    if (!segment) return 0;
    return segment.Context === TextPointerContext.Text
      ? segment.TextStart + symbolOffset - segment.SymbolStart
      : segment.TextStart;
  }
  GetSymbolOffset(
    textOffset: number,
    direction: LogicalDirectionValue = LogicalDirection.Forward,
  ): number {
    validateDirection(direction);
    if (
      !Number.isInteger(textOffset) ||
      textOffset < 0 ||
      textOffset > this.Text.length
    )
      throw new RangeError("Text offset is outside the document.");
    // Prefer the adjacent text run so ordinary UTF-16 positions remain useful editing positions.
    for (const segment of this.runs.values()) {
      if (
        direction === LogicalDirection.Forward
          ? textOffset >= segment.TextStart && textOffset < segment.TextEnd
          : textOffset > segment.TextStart && textOffset <= segment.TextEnd
      )
        return segment.SymbolStart + textOffset - segment.TextStart;
    }
    for (const segment of this.runs.values()) {
      if (textOffset === segment.TextEnd) return segment.SymbolEnd;
      if (textOffset === segment.TextStart) return segment.SymbolStart;
    }
    for (const record of this.records.values()) {
      if (
        record.element instanceof Paragraph &&
        record.element.Text.length === 0 &&
        this.GetTextOffset(record.bounds.ContentStart) === textOffset
      )
        return record.bounds.ContentStart;
    }
    let first: number | undefined, last: number | undefined;
    for (const segment of this.Segments) {
      if (segment.TextStart === textOffset) {
        first ??= segment.SymbolStart;
        last = segment.SymbolStart;
      }
      if (segment.TextEnd === textOffset) {
        first ??= segment.SymbolEnd;
        last = segment.SymbolEnd;
      }
      // A synthetic paragraph separator can share a structural edge with a line break.
      if (segment.TextStart < textOffset && segment.TextEnd > textOffset)
        return direction === LogicalDirection.Forward
          ? segment.SymbolEnd
          : segment.SymbolStart;
    }
    if (textOffset === this.Text.length) last = this.SymbolCount;
    return (
      (direction === LogicalDirection.Forward
        ? (last ?? first)
        : (first ?? last)) ?? 0
    );
  }
  GetAdjacentSegment(
    symbolOffset: number,
    direction: LogicalDirectionValue,
  ): TextSymbolSegment | null {
    this.validateSymbolOffset(symbolOffset);
    validateDirection(direction);
    const probe =
      direction === LogicalDirection.Forward ? symbolOffset : symbolOffset - 1;
    if (probe < 0 || probe >= this.SymbolCount) return null;
    let low = 0,
      high = this.Segments.length - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const segment = this.Segments[middle]!;
      if (probe < segment.SymbolStart) high = middle - 1;
      else if (probe >= segment.SymbolEnd) low = middle + 1;
      else return segment;
    }
    return null;
  }
  GetParent(symbolOffset: number): TextElement {
    this.validateSymbolOffset(symbolOffset);
    let best = this.records.get(this.Document.Id)!;
    for (const record of this.records.values())
      if (
        !(record.element instanceof Image) &&
        record.depth > best.depth &&
        symbolOffset >= record.bounds.ContentStart &&
        symbolOffset <= record.bounds.ContentEnd
      )
        best = record;
    return best.element;
  }
  GetParagraph(symbolOffset: number): Paragraph | null {
    this.validateSymbolOffset(symbolOffset);
    let paragraph: SymbolElementRecord | undefined;
    for (const record of this.records.values())
      if (
        record.element instanceof Paragraph &&
        symbolOffset >= record.bounds.ContentStart &&
        symbolOffset <= record.bounds.ContentEnd &&
        (!paragraph || record.depth > paragraph.depth)
      )
        paragraph = record;
    return (paragraph?.element as Paragraph | undefined) ?? null;
  }
  /** @internal */ _getRun(id: string): TextSymbolSegment | undefined {
    return this.runs.get(id);
  }
  /** @internal */ _validate(offset: number): void {
    this.validateSymbolOffset(offset);
  }
  private validateSymbolOffset(offset: number): void {
    if (!Number.isInteger(offset) || offset < 0 || offset > this.SymbolCount)
      throw new RangeError("Symbol offset is outside the document.");
  }
}

function inferredChange(
  before: string,
  after: string,
): TextChangeSpan | undefined {
  if (before === after) return undefined;
  let start = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  )
    start++;
  let endBefore = before.length,
    endAfter = after.length;
  while (
    endBefore > start &&
    endAfter > start &&
    before[endBefore - 1] === after[endAfter - 1]
  ) {
    endBefore--;
    endAfter--;
  }
  return {
    Start: start,
    RemovedLength: endBefore - start,
    InsertedLength: endAfter - start,
  };
}
function mapTextPosition(
  offset: number,
  direction: LogicalDirectionValue,
  changes: readonly TextChangeSpan[],
): number {
  let adjustment = 0;
  for (const change of changes) {
    const end = change.Start + change.RemovedLength;
    if (offset < change.Start) break;
    if (offset > end || (offset === end && change.RemovedLength > 0)) {
      adjustment += change.InsertedLength - change.RemovedLength;
      continue;
    }
    return (
      change.Start +
      adjustment +
      (direction === LogicalDirection.Forward ? change.InsertedLength : 0)
    );
  }
  return offset + adjustment;
}
function graphemeBoundaries(text: string): number[] {
  if (typeof Intl.Segmenter === "function")
    return [
      ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
        text,
      ),
    ]
      .map((segment) => segment.index)
      .concat(text.length);
  const result = [0];
  let offset = 0;
  for (const character of text) {
    offset += character.length;
    result.push(offset);
  }
  return result;
}
export interface TextPointerOptions {
  TrackChanges?: boolean;
}

/** Live UTF-16 position with a separate WPF-style structural symbol coordinate. */
export class TextPointer {
  readonly Document: FlowDocument;
  readonly LogicalDirection: LogicalDirectionValue;
  private offset: number;
  private symbolOffset: number;
  private snapshotMap: TextSymbolMap;
  private registration?: WeakRef<TextPointer>;
  private edge?: { id: string; edge: keyof TextElementSymbolBounds };
  constructor(
    document: FlowDocument,
    offset = 0,
    direction: LogicalDirectionValue = LogicalDirection.Forward,
    options: TextPointerOptions = {},
  ) {
    if (!(document instanceof FlowDocument))
      throw new TypeError("A TextPointer requires a FlowDocument.");
    validateDirection(direction);
    const map = document.GetSymbolMap();
    if (!Number.isInteger(offset) || offset < 0 || offset > map.Text.length)
      throw new RangeError("TextPointer offset is outside the document.");
    this.Document = document;
    this.offset = offset;
    this.LogicalDirection = direction;
    this.snapshotMap = map;
    this.symbolOffset = map.GetSymbolOffset(offset, direction);
    if (options.TrackChanges !== false)
      this.registration = document._trackPointer(this);
  }
  static FromSymbolOffset(
    document: FlowDocument,
    symbolOffset: number,
    direction: LogicalDirectionValue = LogicalDirection.Forward,
    options: TextPointerOptions = {},
  ): TextPointer {
    const map = document.GetSymbolMap();
    map._validate(symbolOffset);
    const pointer = new TextPointer(
      document,
      map.GetTextOffset(symbolOffset),
      direction,
      options,
    );
    pointer.symbolOffset = symbolOffset;
    return pointer;
  }
  /** @internal */ static _fromElementBoundary(
    document: FlowDocument,
    id: string,
    edge: keyof TextElementSymbolBounds,
    direction: LogicalDirectionValue,
  ): TextPointer {
    const bounds = document.GetSymbolMap().GetElementBounds(id);
    if (!bounds) throw new Error("Element is outside the text stream.");
    const pointer = TextPointer.FromSymbolOffset(
      document,
      bounds[edge],
      direction,
    );
    pointer.edge = { id, edge };
    const element = document.FindById(id)!;
    pointer.offset =
      elementOffset(document, element) +
      (edge === "ContentEnd" || edge === "ElementEnd"
        ? element.Text.length
        : 0);
    return pointer;
  }
  get Offset(): number {
    this.synchronize();
    return this.offset;
  }
  get SymbolOffset(): number {
    this.synchronize();
    return this.symbolOffset;
  }
  get IsLive(): boolean {
    return !!this.registration;
  }
  get DocumentStart(): TextPointer {
    return this.deriveAtSymbol(0, LogicalDirection.Backward);
  }
  get DocumentEnd(): TextPointer {
    return this.deriveAtSymbol(this.map.SymbolCount, LogicalDirection.Forward);
  }
  get Parent(): TextElement {
    return this.map.GetParent(this.symbolOffset);
  }
  get Paragraph(): Paragraph | null {
    return this.map.GetParagraph(this.symbolOffset);
  }
  private deriveAtSymbol(
    symbolOffset: number,
    direction: LogicalDirectionValue,
  ): TextPointer {
    const map = this.map;
    map._validate(symbolOffset);
    validateDirection(direction);
    if (this.IsLive)
      return TextPointer.FromSymbolOffset(
        this.Document,
        symbolOffset,
        direction,
      );
    const pointer = Object.create(TextPointer.prototype) as TextPointer;
    Object.assign(pointer, {
      Document: this.Document,
      LogicalDirection: direction,
      offset: map.GetTextOffset(symbolOffset),
      symbolOffset,
      snapshotMap: map,
    });
    return pointer;
  }
  private deriveAtText(
    offset: number,
    direction: LogicalDirectionValue,
  ): TextPointer {
    const pointer = this.deriveAtSymbol(
      this.map.GetSymbolOffset(offset, direction),
      direction,
    );
    pointer.offset = offset;
    return pointer;
  }
  private get map(): TextSymbolMap {
    this.synchronize();
    return this.snapshotMap;
  }
  private synchronize(): void {
    if (this.registration) this.Document._syncPointers();
  }
  /** Stops tracking subsequent edits while retaining the current coordinates and structural snapshot. */
  Dispose(): void {
    this.synchronize();
    if (this.registration) {
      this.Document._untrackPointer(this.registration);
      this.registration = undefined;
    }
  }
  CreateSnapshot(): TextPointer {
    this.synchronize();
    const pointer = Object.create(TextPointer.prototype) as TextPointer;
    Object.assign(pointer, {
      Document: this.Document,
      LogicalDirection: this.LogicalDirection,
      offset: this.offset,
      symbolOffset: this.symbolOffset,
      snapshotMap: this.snapshotMap,
    });
    return pointer;
  }
  /** @internal */ _rebase(
    previous: TextSymbolMap,
    next: TextSymbolMap,
    changes?: readonly TextChangeSpan[],
  ): void {
    if (this.edge) {
      const bounds = next.GetElementBounds(this.edge.id);
      if (bounds) {
        this.symbolOffset = bounds[this.edge.edge];
        const element = next.Document.FindById(this.edge.id)!;
        this.offset =
          elementOffset(next.Document, element) +
          (this.edge.edge === "ContentEnd" || this.edge.edge === "ElementEnd"
            ? element.Text.length
            : 0);
        this.snapshotMap = next;
        return;
      }
      this.edge = undefined;
    }
    let nextOffset: number | undefined;
    if (changes)
      nextOffset = mapTextPosition(this.offset, this.LogicalDirection, changes);
    else {
      const forward = previous.GetAdjacentSegment(
        this.symbolOffset,
        LogicalDirection.Forward,
      );
      const backward = previous.GetAdjacentSegment(
        this.symbolOffset,
        LogicalDirection.Backward,
      );
      const candidate =
        this.LogicalDirection === LogicalDirection.Forward
          ? forward?.Context === TextPointerContext.Text
            ? forward
            : backward
          : backward?.Context === TextPointerContext.Text
            ? backward
            : forward;
      if (candidate?.Context === TextPointerContext.Text) {
        const run = next._getRun(candidate.Element.Id);
        if (run) {
          const local = this.symbolOffset - candidate.SymbolStart;
          const change = inferredChange(candidate.Text, run.Text);
          if (previous.Text === next.Text && change) nextOffset = this.offset;
          else
            nextOffset =
              run.TextStart +
              mapTextPosition(
                local,
                this.LogicalDirection,
                change ? [change] : [],
              );
        }
      }
      if (nextOffset === undefined && previous.Text === next.Text) {
        const adjacent =
          this.LogicalDirection === LogicalDirection.Forward
            ? forward
            : backward;
        const bounds = adjacent && next.GetElementBounds(adjacent.Element.Id);
        if (
          bounds &&
          adjacent &&
          adjacent.Context !== TextPointerContext.Text
        ) {
          const edge =
            adjacent.Context === TextPointerContext.ElementStart
              ? "ElementStart"
              : adjacent.Context === TextPointerContext.ElementEnd
                ? "ContentEnd"
                : "ElementStart";
          this.symbolOffset =
            bounds[edge] +
            (this.LogicalDirection === LogicalDirection.Backward ? 1 : 0);
          this.symbolOffset = Math.min(next.SymbolCount, this.symbolOffset);
          this.offset = next.GetTextOffset(this.symbolOffset);
          this.snapshotMap = next;
          return;
        }
      }
      if (nextOffset === undefined) {
        const change = inferredChange(previous.Text, next.Text);
        nextOffset = mapTextPosition(
          this.offset,
          this.LogicalDirection,
          change ? [change] : [],
        );
      }
    }
    this.offset = Math.max(0, Math.min(next.Text.length, nextOffset));
    this.symbolOffset = next.GetSymbolOffset(
      this.offset,
      this.LogicalDirection,
    );
    this.snapshotMap = next;
  }
  GetPositionAtOffset(
    offset: number,
    direction: LogicalDirectionValue = this.LogicalDirection,
  ): TextPointer | null {
    if (!Number.isInteger(offset))
      throw new RangeError("Offset must be an integer.");
    validateDirection(direction);
    const next = this.Offset + offset;
    return next < 0 || next > this.map.Text.length
      ? null
      : this.deriveAtText(next, direction);
  }
  GetPositionAtSymbolOffset(
    offset: number,
    direction: LogicalDirectionValue = this.LogicalDirection,
  ): TextPointer | null {
    if (!Number.isInteger(offset))
      throw new RangeError("Symbol offset must be an integer.");
    const next = this.SymbolOffset + offset;
    return next < 0 || next > this.map.SymbolCount
      ? null
      : this.deriveAtSymbol(next, direction);
  }
  CompareTo(other: TextPointer): number {
    this.ensureDocument(other);
    return Math.sign(this.Offset - other.Offset);
  }
  CompareSymbolTo(other: TextPointer): number {
    this.ensureDocument(other);
    return Math.sign(this.SymbolOffset - other.SymbolOffset);
  }
  GetOffsetToPosition(other: TextPointer): number {
    this.ensureDocument(other);
    return other.Offset - this.Offset;
  }
  GetSymbolOffsetToPosition(other: TextPointer): number {
    this.ensureDocument(other);
    return other.SymbolOffset - this.SymbolOffset;
  }
  IsInSameDocument(other: TextPointer): boolean {
    return other instanceof TextPointer && other.Document === this.Document;
  }
  GetPointerContext(direction: LogicalDirectionValue): TextPointerContextValue {
    return (
      this.map.GetAdjacentSegment(this.symbolOffset, direction)?.Context ??
      TextPointerContext.None
    );
  }
  GetAdjacentElement(direction: LogicalDirectionValue): TextElement | null {
    const segment = this.map.GetAdjacentSegment(this.symbolOffset, direction);
    return segment && segment.Context !== TextPointerContext.Text
      ? segment.Element
      : null;
  }
  GetNextContextPosition(direction: LogicalDirectionValue): TextPointer | null {
    const map = this.map,
      segment = map.GetAdjacentSegment(this.symbolOffset, direction);
    return segment
      ? this.deriveAtSymbol(
          direction === LogicalDirection.Forward
            ? segment.SymbolEnd
            : segment.SymbolStart,
          this.LogicalDirection,
        )
      : null;
  }
  GetTextInRun(direction: LogicalDirectionValue): string;
  GetTextInRun(
    direction: LogicalDirectionValue,
    buffer: string[] | Uint16Array,
    startIndex: number,
    count: number,
  ): number;
  GetTextInRun(
    direction: LogicalDirectionValue,
    buffer?: string[] | Uint16Array,
    startIndex = 0,
    count = 0,
  ): string | number {
    const segment = this.map.GetAdjacentSegment(this.symbolOffset, direction);
    const text =
      !segment || segment.Context !== TextPointerContext.Text
        ? ""
        : direction === LogicalDirection.Forward
          ? segment.Text.slice(this.symbolOffset - segment.SymbolStart)
          : segment.Text.slice(0, this.symbolOffset - segment.SymbolStart);
    if (buffer === undefined) return text;
    if (
      !(Array.isArray(buffer) || buffer instanceof Uint16Array) ||
      !Number.isSafeInteger(startIndex) ||
      !Number.isSafeInteger(count) ||
      startIndex < 0 ||
      count < 0 ||
      startIndex + count > buffer.length
    )
      throw new RangeError("Text buffer range is invalid.");
    const copied = Math.min(count, text.length),
      value =
        direction === LogicalDirection.Forward
          ? text.slice(0, copied)
          : text.slice(text.length - copied);
    for (let index = 0; index < copied; index++)
      if (buffer instanceof Uint16Array)
        buffer[startIndex + index] = value.charCodeAt(index);
      else buffer[startIndex + index] = value[index]!;
    return copied;
  }
  GetTextRunLength(direction: LogicalDirectionValue): number {
    return this.GetTextInRun(direction).length;
  }
  GetPropertyValue<T = any>(property: string | DependencyProperty<T>): T {
    return this.Parent.GetValue(property);
  }
  get IsAtInsertionPosition(): boolean {
    const map = this.map;
    const parent = map.GetParent(this.symbolOffset);
    return (
      (parent instanceof Paragraph ||
        parent instanceof Span ||
        parent instanceof Run) &&
      map._getGraphemeOffsets().includes(this.offset)
    );
  }
  GetInsertionPosition(direction: LogicalDirectionValue): TextPointer | null {
    validateDirection(direction);
    if (this.IsAtInsertionPosition)
      return this.deriveAtSymbol(this.SymbolOffset, direction);
    const step = direction === LogicalDirection.Forward ? 1 : -1;
    for (
      let symbol = this.SymbolOffset;
      symbol >= 0 && symbol <= this.map.SymbolCount;
      symbol += step
    ) {
      const position = this.deriveAtSymbol(symbol, direction);
      if (position.IsAtInsertionPosition) return position;
      position.Dispose();
    }
    return null;
  }
  GetNextInsertionPosition(
    direction: LogicalDirectionValue,
  ): TextPointer | null {
    validateDirection(direction);
    const offsets = this.map._getGraphemeOffsets();
    const next =
      direction === LogicalDirection.Forward
        ? offsets.find((offset) => offset > this.offset)
        : [...offsets].reverse().find((offset) => offset < this.offset);
    if (next === undefined) return null;
    const pointer = this.deriveAtText(next, direction);
    if (pointer.IsAtInsertionPosition) return pointer;
    const position = pointer.GetInsertionPosition(direction);
    pointer.Dispose();
    return position;
  }
  InsertTextInRun(text: string): void {
    if (typeof text !== "string") throw new TypeError("Text must be a string.");
    if (!this.IsLive)
      throw new Error("Snapshot pointers cannot edit a document.");
    const map = this.map;
    const parent = map.GetParent(this.symbolOffset);
    if (parent instanceof Run) {
      const run = map._getRun(parent.Id)!;
      const at = Math.max(
        0,
        Math.min(parent.Text.length, this.offset - run.TextStart),
      );
      if (!text) return;
      this.Document.SetPendingTextChanges([
        {
          Start: run.TextStart + at,
          RemovedLength: 0,
          InsertedLength: text.length,
        },
      ]);
      parent.Text = parent.Text.slice(0, at) + text + parent.Text.slice(at);
      this.Document._syncPointers();
      return;
    }
    if (parent instanceof Paragraph || parent instanceof Span) {
      const index = parent.Inlines.ToArray().findIndex(
        (child) =>
          map.GetElementBounds(child)!.ElementStart >= this.symbolOffset,
      );
      if (!text) return;
      this.Document.SetPendingTextChanges([
        { Start: this.offset, RemovedLength: 0, InsertedLength: text.length },
      ]);
      parent.Inlines.Insert(
        index < 0 ? parent.Inlines.Count : index,
        new Run(text),
      );
      this.Document._syncPointers();
      return;
    }
    throw new Error("The position is not inside inline text content.");
  }
  DeleteTextInRun(count: number): number {
    if (!Number.isInteger(count))
      throw new RangeError("Character count must be an integer.");
    if (!this.IsLive)
      throw new Error("Snapshot pointers cannot edit a document.");
    if (!count) return 0;
    const segment = this.map.GetAdjacentSegment(
      this.symbolOffset,
      count > 0 ? LogicalDirection.Forward : LogicalDirection.Backward,
    );
    if (
      !segment ||
      segment.Context !== TextPointerContext.Text ||
      !(segment.Element instanceof Run)
    )
      return 0;
    const local = this.symbolOffset - segment.SymbolStart,
      removed = Math.min(
        Math.abs(count),
        count > 0 ? segment.Text.length - local : local,
      );
    const start = count > 0 ? local : local - removed;
    this.Document.SetPendingTextChanges([
      {
        Start: segment.TextStart + start,
        RemovedLength: removed,
        InsertedLength: 0,
      },
    ]);
    segment.Element.Text =
      segment.Text.slice(0, start) + segment.Text.slice(start + removed);
    this.Document._syncPointers();
    return removed;
  }
  private ensureDocument(other: TextPointer): void {
    if (!this.IsInSameDocument(other))
      throw new Error("Text positions belong to different documents.");
  }
}

export interface DocumentParseOptions {
  MaxDepth?: number;
  MaxNodes?: number;
}
export function elementFromJSON(
  node: DocumentNode,
  options: DocumentParseOptions = {},
): TextElement {
  const ids = new Set<string>();
  let count = 0;
  const parse = (data: DocumentNode, depth: number): TextElement => {
    if (++count > (options.MaxNodes ?? 100000))
      throw new RangeError("Document exceeds the node limit.");
    if (depth > (options.MaxDepth ?? 256))
      throw new RangeError("Document exceeds the nesting limit.");
    if (!data || typeof data !== "object" || typeof data.type !== "string")
      throw new TypeError("Invalid document node.");
    if (typeof data.id !== "string" || !data.id)
      throw new TypeError("Document node requires an id.");
    if (ids.has(data.id)) throw new Error(`Duplicate element id: ${data.id}`);
    ids.add(data.id);
    if (
      data.props !== undefined &&
      (!data.props ||
        typeof data.props !== "object" ||
        Array.isArray(data.props))
    )
      throw new TypeError("Node props must be an object.");
    if (data.children !== undefined && !Array.isArray(data.children))
      throw new TypeError("Node children must be an array.");
    let element: TextElement;
    switch (data.type) {
      case "FlowDocument":
        element = new FlowDocument();
        break;
      case "Section":
        element = new Section();
        break;
      case "Paragraph":
        element = new Paragraph();
        break;
      case "Run":
        if (data.text !== undefined && typeof data.text !== "string")
          throw new TypeError("Run text must be a string.");
        element = new Run(data.text ?? "");
        break;
      case "Span":
        element = new Span();
        break;
      case "Bold":
        element = new Bold();
        break;
      case "Italic":
        element = new Italic();
        break;
      case "Underline":
        element = new Underline();
        break;
      case "Hyperlink":
        element = new Hyperlink();
        break;
      case "LineBreak":
        element = new LineBreak();
        break;
      case "List":
        element = new List();
        break;
      case "ListItem":
        element = new ListItem();
        break;
      case "Table":
        element = new Table();
        break;
      case "TableColumn":
        element = new TableColumn();
        break;
      case "TableRowGroup":
        element = new TableRowGroup();
        break;
      case "TableRow":
        element = new TableRow();
        break;
      case "TableCell":
        element = new TableCell();
        break;
      case "InlineUIContainer":
        element = new InlineUIContainer();
        break;
      case "BlockUIContainer":
        element = new BlockUIContainer();
        break;
      case "Image":
        element = new Image();
        break;
      default:
        throw new TypeError(`Unsupported document node type: ${data.type}`);
    }
    element._setId(data.id);
    for (const [name, value] of Object.entries(data.props ?? {})) {
      if (name === "Columns" && element instanceof Table) continue;
      element.SetValue(name, value);
    }
    if (element instanceof Table && data.props?.Columns !== undefined) {
      if (!Array.isArray(data.props.Columns))
        throw new TypeError("Table Columns must be an array.");
      for (const column of data.props.Columns)
        element.Columns.Add(parse(column, depth + 1) as TableColumn);
    }
    for (const child of data.children ?? []) {
      const parsed = parse(child, depth + 1);
      const target =
        element instanceof FlowDocument ||
        element instanceof Section ||
        element instanceof ListItem ||
        element instanceof TableCell
          ? element.Blocks
          : element instanceof Paragraph || element instanceof Span
            ? element.Inlines
            : element instanceof List
              ? element.ListItems
              : element instanceof Table
                ? element.RowGroups
                : element instanceof TableRowGroup
                  ? element.Rows
                  : element instanceof TableRow
                    ? element.Cells
                    : null;
      if (target) (target as TextElementCollection<any>).Add(parsed);
      else if (
        element instanceof InlineUIContainer ||
        element instanceof BlockUIContainer
      ) {
        if (element.Child || !(parsed instanceof Image))
          throw new TypeError(`${element.Type} accepts one Image child.`);
        element.Child = parsed;
      } else throw new TypeError(`${element.Type} cannot contain child nodes.`);
    }
    return element;
  };
  return parse(node, 0);
}
