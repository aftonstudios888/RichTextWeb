import {
  EventDispatcher,
  FlowDocument,
  TextPointer,
  type DocumentNode,
} from "./model.js";
import {
  clone,
  deleteRange,
  effectiveProps,
  formatRange,
  inlineText,
  insertText,
  leaves,
  makeNode,
  mapMetadata,
  newIds,
  plainText,
  pointBlock,
  run,
  sliceInlines,
  textBlocks,
  uid,
} from "./engine-tree.js";

export interface FindOptions {
  MatchCase?: boolean;
  WholeWord?: boolean;
  matchCase?: boolean;
  wholeWord?: boolean;
  Start?: number;
}
export interface FindResult {
  Start: number;
  End: number;
  Text: string;
}
export interface DocumentAnnotation {
  Id: string;
  Kind: "Comment" | "Bookmark" | string;
  Start: number;
  End: number;
  Data: Record<string, any>;
}
export interface EngineChangedEvent {
  Engine: RichTextEngine;
  Document: FlowDocument;
  Revision: number;
}
export interface SelectionChangedEvent {
  Engine: RichTextEngine;
  Start: number;
  End: number;
}
interface Snapshot {
  document: DocumentNode;
  start: number;
  end: number;
  typing: Record<string, any>;
}
const INLINE_TYPES = new Set([
  "Run",
  "Span",
  "Bold",
  "Italic",
  "Underline",
  "Hyperlink",
  "LineBreak",
  "Image",
  "InlineUIContainer",
]);
const BLOCK_TYPES = new Set([
  "Paragraph",
  "Section",
  "List",
  "Table",
  "BlockUIContainer",
]);
const INLINE_PROPERTIES = new Set([
  "FontFamily",
  "FontSize",
  "FontWeight",
  "FontStyle",
  "FontStretch",
  "Foreground",
  "Background",
  "TextDecorations",
  "BaselineAlignment",
  "Typography",
  "Language",
]);
const wordCharacter = (text: string) => /[\p{L}\p{N}_]/u.test(text);
const validOffset = (value: number, length: number) => {
  if (!Number.isInteger(value) || value < 0 || value > length)
    throw new RangeError(`Text offset ${value} is outside 0..${length}.`);
  return value;
};

/** WPF-shaped range API using UTF-16 plain-text offsets rather than WPF symbols. */
export class TextRange {
  protected _start: TextPointer;
  protected _end: TextPointer;
  protected owner?: RichTextEngine;
  constructor(start: TextPointer, end: TextPointer) {
    if (start.Document !== end.Document)
      throw new Error("TextRange endpoints must belong to the same document.");
    this._start = start.Offset <= end.Offset ? start : end;
    this._end = start.Offset <= end.Offset ? end : start;
  }
  get Start(): TextPointer {
    return this._start;
  }
  get End(): TextPointer {
    return this._end;
  }
  get IsEmpty(): boolean {
    return this.Start.Offset === this.End.Offset;
  }
  get Text(): string {
    return this.Start.Document.Text.slice(this.Start.Offset, this.End.Offset);
  }
  set Text(value: string) {
    this.withEngine((engine) => engine.InsertText(value));
  }
  ApplyPropertyValue(
    property: string | { Name: string },
    value: unknown,
  ): void {
    this.withEngine((engine) =>
      engine.ApplyProperty(
        typeof property === "string" ? property : property.Name,
        value,
      ),
    );
  }
  GetPropertyValue(property: string | { Name: string }): unknown {
    const name = typeof property === "string" ? property : property.Name;
    if (this.owner) return this.owner.GetProperty(name);
    return propertyInRange(
      this.Start.Document.ToJSON(),
      this.Start.Offset,
      this.End.Offset,
      name,
      this.Start.Document.GetValue(name),
    );
  }
  protected withEngine(action: (engine: RichTextEngine) => void): void {
    const engine = this.owner ?? new RichTextEngine(this.Start.Document);
    if (!this.owner) engine.Select(this.Start.Offset, this.End.Offset);
    try {
      action(engine);
      if (!this.owner) {
        this._start = new TextPointer(
          engine.Document,
          engine.Selection.Start.Offset,
        );
        this._end = new TextPointer(
          engine.Document,
          engine.Selection.End.Offset,
        );
      }
    } finally {
      if (!this.owner) engine.Dispose();
    }
  }
}

export class TextSelection extends TextRange {
  constructor(engine: RichTextEngine) {
    super(
      new TextPointer(engine.Document, 0),
      new TextPointer(engine.Document, 0),
    );
    this.owner = engine;
  }
  override get Start(): TextPointer {
    return new TextPointer(this.owner!.Document, this.owner!.SelectionStart);
  }
  override get End(): TextPointer {
    return new TextPointer(this.owner!.Document, this.owner!.SelectionEnd);
  }
  Select(start: TextPointer | number, end: TextPointer | number): void {
    for (const pointer of [start, end])
      if (
        typeof pointer !== "number" &&
        pointer.Document !== this.owner!.Document
      )
        throw new Error("Selection endpoint belongs to another document.");
    this.owner!.Select(
      typeof start === "number" ? start : start.Offset,
      typeof end === "number" ? end : end.Offset,
    );
  }
  SelectAll(): void {
    this.owner!.Select(0, this.owner!.Document.Text.length);
  }
}

function propertyInRange(
  root: DocumentNode,
  start: number,
  end: number,
  name: string,
  defaultValue?: unknown,
): unknown {
  const list = leaves(root);
  const selected =
    start === end
      ? [
          list.find((item) => item.start < start && item.end >= start) ??
            list.find((item) => item.start === start),
        ].filter(Boolean)
      : list.filter((item) => item.end > start && item.start < end);
  if (!selected.length) return root.props[name] ?? defaultValue;
  const resolve = (item: (typeof list)[number]) =>
    item.props[name] === undefined ? defaultValue : item.props[name];
  const value = resolve(selected[0]!);
  return selected.every(
    (item) => JSON.stringify(resolve(item!)) === JSON.stringify(value),
  )
    ? value
    : undefined;
}

/** Framework-independent editing, selection, undo, search, and document structure. */
export class RichTextEngine {
  private _document: FlowDocument;
  readonly Selection: TextSelection;
  readonly Changed = new EventDispatcher<EngineChangedEvent>();
  readonly SelectionChanged = new EventDispatcher<SelectionChangedEvent>();
  private subscription: { Dispose(): void };
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private typing: Record<string, any> = {};
  private start = 0;
  private end = 0;
  private depth = 0;
  private batch?: Snapshot;
  private disposed = false;
  UndoLimit = 100;

  constructor(document = new FlowDocument()) {
    this._document = document;
    this.Selection = new TextSelection(this);
    this.subscription = this.subscribe(document);
  }
  get Document(): FlowDocument {
    return this._document;
  }
  get SelectionStart(): number {
    return this.start;
  }
  get SelectionEnd(): number {
    return this.end;
  }
  get CanUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get CanRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get Annotations(): DocumentAnnotation[] {
    return clone(this.Document.ToJSON().props.Annotations ?? []);
  }
  private assertLive(): void {
    if (this.disposed) throw new Error("RichTextEngine is disposed.");
  }
  private subscribe(document: FlowDocument): { Dispose(): void } {
    return document.Changed.Subscribe(() => {
      this.start = Math.min(this.start, document.Text.length);
      this.end = Math.min(this.end, document.Text.length);
      this.Changed.Emit({
        Engine: this,
        Document: document,
        Revision: document.Revision,
      });
    });
  }
  Select(start: number, end = start): void {
    this.assertLive();
    validOffset(start, this.Document.Text.length);
    validOffset(end, this.Document.Text.length);
    const from = Math.min(start, end),
      to = Math.max(start, end);
    if (from === this.start && to === this.end) return;
    this.start = from;
    this.end = to;
    this.typing = {};
    this.SelectionChanged.Emit({ Engine: this, Start: from, End: to });
  }
  SetDocument(document: FlowDocument): void {
    this.assertLive();
    if (this.depth)
      throw new Error(
        "Cannot replace the document during a change transaction.",
      );
    this.subscription.Dispose();
    this._document = document;
    this.subscription = this.subscribe(document);
    this.start = 0;
    this.end = 0;
    this.typing = {};
    this.ClearUndo();
    this.Changed.Emit({
      Engine: this,
      Document: document,
      Revision: document.Revision,
    });
    this.emitSelection();
  }
  /** Replace all content while retaining the document object, subscribers, and undo. */
  ReplaceDocument(document: FlowDocument): void {
    this.mutate((root) => {
      const replacement = clone(document.ToJSON());
      root.props = replacement.props;
      root.children = replacement.children;
      root.text = replacement.text;
    });
  }
  BeginChange(): void {
    this.assertLive();
    if (this.depth++ === 0) {
      this.batch = this.snapshot();
      this.Document.BeginChange();
    }
  }
  EndChange(): void {
    this.assertLive();
    if (!this.depth)
      throw new Error("EndChange requires a matching BeginChange.");
    if (--this.depth === 0) {
      if (
        this.batch &&
        JSON.stringify(this.batch.document) !==
          JSON.stringify(this.Document.ToJSON())
      )
        this.record(this.batch);
      this.batch = undefined;
      this.Document.EndChange();
    }
  }
  Change(action: () => void): void {
    this.BeginChange();
    try {
      action();
    } finally {
      this.EndChange();
    }
  }
  ClearUndo(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
  Undo(): boolean {
    this.assertLive();
    if (this.depth)
      throw new Error("Finish the change transaction before undo.");
    const state = this.undoStack.pop();
    if (!state) return false;
    this.redoStack.push(this.snapshot());
    this.restore(state);
    return true;
  }
  Redo(): boolean {
    this.assertLive();
    if (this.depth)
      throw new Error("Finish the change transaction before redo.");
    const state = this.redoStack.pop();
    if (!state) return false;
    this.undoStack.push(this.snapshot());
    this.restore(state);
    return true;
  }
  private snapshot(): Snapshot {
    return {
      document: clone(this.Document.ToJSON()),
      start: this.start,
      end: this.end,
      typing: clone(this.typing),
    };
  }
  private restore(state: Snapshot): void {
    this.start = state.start;
    this.end = state.end;
    this.typing = clone(state.typing);
    this.Document.ReplaceWith(FlowDocument.FromJSON(state.document));
    this.emitSelection();
  }
  private record(state: Snapshot): void {
    this.undoStack.push(state);
    if (this.undoStack.length > Math.max(0, this.UndoLimit))
      this.undoStack.splice(
        0,
        this.undoStack.length - Math.max(0, this.UndoLimit),
      );
    this.redoStack = [];
  }
  private emitSelection(): void {
    this.SelectionChanged.Emit({
      Engine: this,
      Start: this.start,
      End: this.end,
    });
  }
  private mutate(
    action: (root: DocumentNode) => void,
    mapStructure = true,
  ): void {
    this.assertLive();
    const before = this.snapshot(),
      root = clone(before.document);
    try {
      action(root);
      if (mapStructure) mapStructuralAnnotations(before.document, root);
      const document = FlowDocument.FromJSON(root);
      if (
        JSON.stringify(before.document) !== JSON.stringify(document.ToJSON())
      ) {
        if (!this.depth) this.record(before);
        this.Document.ReplaceWith(document);
      }
      const length = this.Document.Text.length;
      this.start = Math.min(this.start, length);
      this.end = Math.max(this.start, Math.min(this.end, length));
      this.emitSelection();
    } catch (error) {
      this.start = before.start;
      this.end = before.end;
      this.typing = before.typing;
      throw error;
    }
  }
  InsertText(text: string): void {
    if (typeof text !== "string")
      throw new TypeError("InsertText expects a string.");
    this.assertLive();
    if (!text && this.start === this.end) return;
    text = text.replace(/\r\n?/g, "\n");
    const props = this.insertionProperties();
    this.mutate((root) => {
      const from = this.start,
        to = this.end,
        previousLength = plainText(root).length;
      deleteRange(root, from, to);
      const position = Math.min(from, plainText(root).length);
      this.start = this.end = text
        ? insertText(root, position, text, props)
        : position;
      mapMetadata(
        root,
        from,
        to,
        plainText(root).length - previousLength + to - from,
      );
    }, false);
  }
  ReplaceSelection(text: string): void {
    this.InsertText(text);
  }
  InsertParagraph(): void {
    this.InsertText("\n");
  }
  DeleteBackward(): void {
    this.deleteDirection(-1, false);
  }
  DeleteForward(): void {
    this.deleteDirection(1, false);
  }
  DeleteWordBackward(): void {
    this.deleteDirection(-1, true);
  }
  DeleteWordForward(): void {
    this.deleteDirection(1, true);
  }
  private deleteDirection(direction: -1 | 1, word: boolean): void {
    this.assertLive();
    if (this.start !== this.end) {
      this.InsertText("");
      return;
    }
    const text = this.Document.Text,
      at = this.start;
    if ((direction < 0 && at === 0) || (direction > 0 && at === text.length))
      return;
    const segmenter =
      typeof Intl.Segmenter === "function"
        ? new Intl.Segmenter(undefined, {
            granularity: word ? "word" : "grapheme",
          })
        : undefined;
    let boundary: number;
    if (segmenter) {
      const items = Array.from(segmenter.segment(text));
      if (direction < 0) {
        let index = items.length - 1;
        while (index >= 0 && items[index].index >= at) index--;
        if (word)
          while (index > 0 && /^\s+$/u.test(items[index].segment)) index--;
        boundary = items[Math.max(0, index)]?.index ?? 0;
      } else {
        let index = items.findIndex(
          (item) => item.index + item.segment.length > at,
        );
        if (word)
          while (
            index < items.length - 1 &&
            /^\s+$/u.test(items[index].segment)
          )
            index++;
        const item = items[index];
        boundary = item ? item.index + item.segment.length : text.length;
      }
    } else {
      const points = Array.from(text);
      let position = 0;
      const boundaries = [0];
      for (const point of points) {
        position += point.length;
        boundaries.push(position);
      }
      boundary =
        direction < 0
          ? (boundaries.filter((value) => value < at).at(-1) ?? 0)
          : (boundaries.find((value) => value > at) ?? text.length);
    }
    const previousStart = this.start,
      previousEnd = this.end;
    this.start = Math.min(at, boundary);
    this.end = Math.max(at, boundary);
    const selection = [this.start, this.end];
    this.InsertText("");
    // Undo should restore the user's caret, not the internal deletion selection.
    const last = this.undoStack.at(-1);
    if (
      !this.depth &&
      last &&
      last.start === selection[0] &&
      last.end === selection[1]
    ) {
      last.start = previousStart;
      last.end = previousEnd;
    }
  }
  private insertionProperties(): Record<string, any> {
    const list = leaves(this.Document.ToJSON());
    const leaf =
      list.find((item) => item.start < this.start && item.end >= this.start) ??
      list.find((item) => item.start === this.start);
    const inherited = leaf?.props ?? this.Document.ToJSON().props;
    return Object.fromEntries(
      Object.entries({ ...inherited, ...this.typing }).filter(([key]) =>
        INLINE_PROPERTIES.has(key),
      ),
    );
  }
  GetProperty(name: string): unknown {
    return this.start === this.end && name in this.typing
      ? this.typing[name]
      : propertyInRange(
          this.Document.ToJSON(),
          this.start,
          this.end,
          name,
          this.Document.GetValue(name),
        );
  }
  ApplyProperty(name: string, value: unknown): void {
    this.assertLive();
    if (!name || typeof name !== "string")
      throw new TypeError("A property name is required.");
    if (this.start === this.end) {
      this.typing[name] = clone(value);
      this.emitSelection();
      return;
    }
    this.mutate((root) => formatRange(root, this.start, this.end, name, value));
  }
  ToggleFormat(
    name: string,
    value: unknown = true,
    offValue: unknown = false,
  ): void {
    this.ApplyProperty(
      name,
      this.GetProperty(name) === value ? offValue : value,
    );
  }
  SetParagraphProperty(name: string, value: unknown): void {
    this.mutate((root) => {
      for (const block of this.selectedBlocks(root)) {
        if (value === undefined) delete block.node.props[name];
        else block.node.props[name] = clone(value);
      }
    });
  }
  private selectedBlocks(root: DocumentNode) {
    const blocks = textBlocks(root);
    return blocks.filter((block) =>
      this.start === this.end
        ? block.start <= this.start && block.end >= this.start
        : block.end >= this.start && block.start < this.end,
    );
  }
  ClearFormatting(): void {
    if (this.start === this.end) {
      this.typing = Object.fromEntries(
        [...INLINE_PROPERTIES]
          .map((name) => [name, this.Document.GetValue(name)])
          .filter(([, value]) => value !== undefined),
      );
      this.emitSelection();
      return;
    }
    this.typing = {};
    this.mutate((root) => {
      const strip = (items: DocumentNode[]): DocumentNode[] =>
        items.flatMap((item) => {
          for (const name of INLINE_PROPERTIES) delete item.props[name];
          if (item.children) item.children = strip(item.children);
          return ["Bold", "Italic", "Underline"].includes(item.type)
            ? (item.children ?? [])
            : [item];
        });
      for (const block of this.selectedBlocks(root)) {
        if (block.node.type !== "Paragraph") continue;
        const from = Math.max(0, this.start - block.start),
          to = Math.min(block.text.length, this.end - block.start);
        block.node.children = [
          ...sliceInlines(block.node.children ?? [], 0, from),
          ...strip(sliceInlines(block.node.children ?? [], from, to, from > 0)),
          ...sliceInlines(
            block.node.children ?? [],
            to,
            block.text.length,
            true,
          ),
        ];
      }
    });
  }
  InsertNode(node: DocumentNode): void {
    this.InsertFragment([node]);
  }
  InsertFragment(nodes: DocumentNode[]): void {
    if (!Array.isArray(nodes))
      throw new TypeError("InsertFragment expects an array of document nodes.");
    const list = nodes.flatMap((node) =>
      node.type === "FlowDocument" ? (node.children ?? []) : [node],
    );
    if (
      list.some(
        (node) => !INLINE_TYPES.has(node.type) && !BLOCK_TYPES.has(node.type),
      )
    )
      throw new Error("Only inline or block document nodes can be inserted.");
    if (!list.length) return;
    const allInline = list.every((node) => INLINE_TYPES.has(node.type));
    if (!allInline && list.some((node) => INLINE_TYPES.has(node.type)))
      throw new Error(
        "A fragment must contain either inline nodes or block nodes.",
      );
    this.mutate((root) => {
      const from = this.start,
        to = this.end,
        oldLength = plainText(root).length;
      deleteRange(root, from, to);
      const block = pointBlock(root, Math.min(from, plainText(root).length));
      const inserted = list.map(newIds);
      if (block.node.type !== "Paragraph")
        throw new Error("Select a text paragraph before inserting a fragment.");
      const local = Math.max(0, from - block.start),
        before = sliceInlines(block.node.children ?? [], 0, local),
        after = sliceInlines(
          block.node.children ?? [],
          local,
          block.text.length,
          true,
        );
      if (allInline) {
        block.node.children = [...before, ...inserted, ...after];
        this.start = this.end = from + inserted.map(inlineText).join("").length;
      } else {
        // Paragraph fragments join at the caret; structural blocks retain their
        // block boundary and are surrounded only when text requires it.
        const replacement: DocumentNode[] = [];
        if (inserted[0].type === "Paragraph")
          inserted[0].children = [...before, ...(inserted[0].children ?? [])];
        else if (before.length)
          replacement.push(
            makeNode("Paragraph", before, clone(block.node.props)),
          );
        replacement.push(...inserted);
        const tail = inserted.at(-1)!;
        const tailTextBefore = inlineText(tail).length;
        if (tail.type === "Paragraph")
          tail.children = [...(tail.children ?? []), ...after];
        else if (after.length)
          replacement.push(
            makeNode("Paragraph", after, clone(block.node.props)),
          );
        block.parent.children!.splice(block.index, 1, ...replacement);
        const resultingBlocks = textBlocks(root);
        const tailBlock =
          tail.type === "Paragraph"
            ? resultingBlocks.find((item) => item.node === tail)
            : resultingBlocks
                .filter((item) => containsNode(tail, item.node.id))
                .at(-1);
        this.start = this.end = tailBlock
          ? tail.type === "Paragraph"
            ? tailBlock.start + tailTextBefore
            : tailBlock.end
          : Math.min(from, plainText(root).length);
      }
      mapMetadata(
        root,
        from,
        to,
        plainText(root).length - oldLength + to - from,
      );
    }, false);
  }
  InsertImage(
    source: string,
    alternativeText = "",
    width?: number,
    height?: number,
  ): void {
    this.InsertNode(
      makeNode("Image", [], {
        Source: source,
        AlternativeText: alternativeText,
        ...(width === undefined ? {} : { Width: width }),
        ...(height === undefined ? {} : { Height: height }),
      }),
    );
  }
  InsertTable(rows = 2, columns = 2): void {
    if (
      !Number.isInteger(rows) ||
      !Number.isInteger(columns) ||
      rows < 1 ||
      columns < 1 ||
      rows * columns > 10000
    )
      throw new RangeError(
        "Table dimensions must be positive integers with at most 10,000 cells.",
      );
    this.InsertNode(
      makeNode("Table", [
        makeNode(
          "TableRowGroup",
          Array.from({ length: rows }, () =>
            makeNode(
              "TableRow",
              Array.from({ length: columns }, () =>
                makeNode("TableCell", [makeNode("Paragraph")]),
              ),
            ),
          ),
        ),
      ]),
    );
  }
  InsertHyperlink(uri: string, text = this.Selection.Text || uri): void {
    this.InsertNode(
      makeNode("Hyperlink", [run(text, this.insertionProperties())], {
        NavigateUri: uri,
      }),
    );
  }
  GetSelectedFragment(): FlowDocument {
    const root = this.Document.ToJSON(),
      ranges = new Map(textBlocks(root).map((block) => [block.node.id, block]));
    const extract = (item: DocumentNode): DocumentNode | undefined => {
      const block = ranges.get(item.id);
      if (block) {
        if (
          this.start === this.end ||
          block.end < this.start ||
          block.start >= this.end
        )
          return undefined;
        const copy = clone(item);
        if (item.type === "Paragraph")
          copy.children = sliceInlines(
            item.children ?? [],
            Math.max(0, this.start - block.start),
            Math.min(block.text.length, this.end - block.start),
          );
        return copy;
      }
      const children = (item.children ?? [])
        .map(extract)
        .filter((value): value is DocumentNode => !!value);
      return children.length ? { ...clone(item), children } : undefined;
    };
    return FlowDocument.FromJSON({
      ...clone(root),
      props: { ...root.props, Annotations: [] },
      children: (root.children ?? [])
        .map(extract)
        .filter((value): value is DocumentNode => !!value),
    });
  }
  RemoveHyperlink(): void {
    this.mutate((root) => {
      for (const block of this.selectedBlocks(root)) {
        if (block.node.type !== "Paragraph") continue;
        const start = Math.max(0, this.start - block.start),
          end = Math.min(block.text.length, this.end - block.start);
        if (this.start === this.end) {
          let position = block.start;
          const unwrapAt = (items: DocumentNode[]): DocumentNode[] =>
            items.flatMap((item) => {
              const at = position,
                length = inlineText(item).length;
              if (this.start < at || this.start > at + length) {
                position += length;
                return [item];
              }
              if (item.type === "Hyperlink") {
                position += length;
                return item.children ?? [];
              }
              if (item.children) item.children = unwrapAt(item.children);
              else position += length;
              return [item];
            });
          block.node.children = unwrapAt(block.node.children ?? []);
        } else {
          const unwrap = (items: DocumentNode[]): DocumentNode[] =>
            items.flatMap((item) => {
              if (item.children) item.children = unwrap(item.children);
              return item.type === "Hyperlink" ? (item.children ?? []) : [item];
            });
          block.node.children = [
            ...sliceInlines(block.node.children ?? [], 0, start),
            ...unwrap(
              sliceInlines(block.node.children ?? [], start, end, start > 0),
            ),
            ...sliceInlines(
              block.node.children ?? [],
              end,
              block.text.length,
              true,
            ),
          ];
        }
      }
    });
  }
  Indent(amount = 24): void {
    if (!Number.isFinite(amount))
      throw new RangeError("Indent amount must be finite.");
    this.mutate((root) => {
      for (const block of this.selectedBlocks(root))
        block.node.props.TextIndent = Math.max(
          0,
          Number(block.node.props.TextIndent ?? 0) + amount,
        );
    });
  }
  InsertTableRow(before = false): void {
    this.mutate((root) => {
      const context = tableContext(root, this.start);
      validateSimpleTable(context.table);
      const rows = context.group.children ?? [],
        index = rows.indexOf(context.row);
      if (
        findTableRows(context.table).length *
          (context.row.children?.length ?? 0) >=
        10000
      )
        throw new RangeError("Table limit is 10,000 cells.");
      rows.splice(
        index + (before ? 0 : 1),
        0,
        makeNode(
          "TableRow",
          (context.row.children ?? []).map((cell) =>
            makeNode("TableCell", [makeNode("Paragraph")], clone(cell.props)),
          ),
          clone(context.row.props),
        ),
      );
    });
  }
  DeleteTableRow(): void {
    this.mutate((root) => {
      const context = tableContext(root, this.start);
      validateSimpleTable(context.table);
      context.group.children!.splice(
        context.group.children!.indexOf(context.row),
        1,
      );
      if (!findTableRows(context.table).length)
        replaceTableWithParagraph(root, context.table);
    });
  }
  InsertTableColumn(before = false): void {
    this.mutate((root) => {
      const context = tableContext(root, this.start);
      validateSimpleTable(context.table);
      const index =
          context.row.children!.indexOf(context.cell) + (before ? 0 : 1),
        rows = findTableRows(context.table);
      if (rows.length * ((rows[0].children?.length ?? 0) + 1) > 10000)
        throw new RangeError("Table limit is 10,000 cells.");
      for (const row of rows)
        row.children!.splice(
          index,
          0,
          makeNode(
            "TableCell",
            [makeNode("Paragraph")],
            clone(row.children![Math.max(0, index - 1)]?.props ?? {}),
          ),
        );
    });
  }
  DeleteTableColumn(): void {
    this.mutate((root) => {
      const context = tableContext(root, this.start);
      validateSimpleTable(context.table);
      const index = context.row.children!.indexOf(context.cell),
        rows = findTableRows(context.table);
      if (context.row.children!.length === 1) {
        replaceTableWithParagraph(root, context.table);
        return;
      }
      for (const row of rows) row.children!.splice(index, 1);
    });
  }
  DeleteTable(): void {
    this.mutate((root) =>
      replaceTableWithParagraph(root, tableContext(root, this.start).table),
    );
  }
  ToggleList(markerStyle: string = "Disc"): void {
    this.mutate((root) => {
      const selected = this.selectedBlocks(root);
      if (!selected.length) return;
      const first = selected[0],
        last = selected.at(-1)!;
      const ancestors = findAncestors(root, first.node.id),
        list = [...ancestors].reverse().find((node) => node.type === "List");
      if (
        list &&
        selected.every((block) => containsNode(list, block.node.id))
      ) {
        if (list.props.MarkerStyle !== markerStyle) {
          list.props.MarkerStyle = markerStyle;
          return;
        }
        const parent = findParent(root, list.id)!;
        parent.children!.splice(
          parent.children!.indexOf(list),
          1,
          ...(list.children ?? []).flatMap((item) => item.children ?? []),
        );
        return;
      }
      if (
        first.parent !== last.parent ||
        selected.some(
          (block) =>
            block.parent !== first.parent || block.node.type !== "Paragraph",
        )
      )
        throw new Error(
          "List conversion requires contiguous paragraphs in one block collection.",
        );
      const parent = first.parent,
        a = parent.children!.indexOf(first.node),
        b = parent.children!.indexOf(last.node);
      if (
        parent
          .children!.slice(a, b + 1)
          .some((node) => node.type !== "Paragraph")
      )
        throw new Error("List conversion cannot cross structural blocks.");
      parent.children!.splice(
        a,
        b - a + 1,
        makeNode(
          "List",
          selected.map((block) => makeNode("ListItem", [block.node])),
          { MarkerStyle: markerStyle, StartIndex: 1 },
        ),
      );
    });
  }
  Find(text: string, options: FindOptions = {}): FindResult[] {
    if (typeof text !== "string" || !text.length) return [];
    const source = this.Document.Text,
      matchCase = options.MatchCase ?? options.matchCase ?? false,
      wholeWord = options.WholeWord ?? options.wholeWord ?? false;
    const regex = new RegExp(
      text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      matchCase ? "gu" : "giu",
    );
    regex.lastIndex =
      options.Start === undefined
        ? 0
        : validOffset(options.Start, source.length);
    const result: FindResult[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(source))) {
      const start = match.index,
        end = start + match[0].length;
      if (
        wholeWord &&
        ((start && wordCharacter(Array.from(source.slice(0, start)).at(-1)!)) ||
          (end < source.length &&
            wordCharacter(Array.from(source.slice(end))[0])))
      )
        continue;
      result.push({ Start: start, End: end, Text: match[0] });
    }
    return result;
  }
  ReplaceAll(
    find: string,
    replacement: string,
    options: FindOptions = {},
  ): number {
    if (typeof replacement !== "string")
      throw new TypeError("Replacement must be a string.");
    const matches = this.Find(find, options);
    this.Change(() => {
      for (const match of [...matches].reverse()) {
        this.Select(match.Start, match.End);
        this.InsertText(replacement);
      }
    });
    return matches.length;
  }
  AddAnnotation(
    kind: string,
    data: Record<string, any>,
    start = this.start,
    end = this.end,
  ): DocumentAnnotation {
    validOffset(start, this.Document.Text.length);
    validOffset(end, this.Document.Text.length);
    const annotation: DocumentAnnotation = {
      Id: uid(),
      Kind: kind,
      Start: Math.min(start, end),
      End: Math.max(start, end),
      Data: clone(data),
    };
    this.mutate((root) => {
      (root.props.Annotations ??= []).push(annotation);
    });
    return clone(annotation);
  }
  AddComment(text: string, author = ""): DocumentAnnotation {
    return this.AddAnnotation("Comment", {
      Text: text,
      Author: author,
      CreatedAt: new Date().toISOString(),
      Resolved: false,
    });
  }
  AddBookmark(name: string): DocumentAnnotation {
    if (
      !name ||
      this.Annotations.some(
        (item) => item.Kind === "Bookmark" && item.Data.Name === name,
      )
    )
      throw new Error("Bookmark names must be nonempty and unique.");
    return this.AddAnnotation("Bookmark", { Name: name });
  }
  UpdateAnnotation(id: string, data: Record<string, any>): void {
    this.mutate((root) => {
      const item = (root.props.Annotations ?? []).find(
        (annotation: DocumentAnnotation) => annotation.Id === id,
      );
      if (!item) throw new Error(`Annotation ${id} was not found.`);
      item.Data = { ...item.Data, ...clone(data) };
    });
  }
  RemoveAnnotation(id: string): boolean {
    let removed = false;
    this.mutate((root) => {
      const items: DocumentAnnotation[] = root.props.Annotations ?? [],
        index = items.findIndex((item) => item.Id === id);
      if (index >= 0) {
        items.splice(index, 1);
        removed = true;
      }
    });
    return removed;
  }
  GoToBookmark(name: string): boolean {
    const item = this.Annotations.find(
      (annotation) =>
        annotation.Kind === "Bookmark" && annotation.Data.Name === name,
    );
    if (!item) return false;
    this.Select(item.Start, item.End);
    return true;
  }
  Execute(command: string, parameter?: any): any {
    const name = command
      .replace(/^(EditingCommands|ApplicationCommands)\./, "")
      .replace(/[\s_-]/g, "")
      .toLowerCase();
    switch (name) {
      case "undo":
        return this.Undo();
      case "redo":
        return this.Redo();
      case "selectall":
        return this.Select(0, this.Document.Text.length);
      case "inserttext":
        return this.InsertText(parameter ?? "");
      case "insertparagraph":
      case "enterparagraphbreak":
        return this.InsertParagraph();
      case "insertlinebreak":
      case "enterlinebreak":
        return this.InsertNode(makeNode("LineBreak"));
      case "delete":
      case "deleteforward":
        return this.DeleteForward();
      case "backspace":
      case "deletebackward":
        return this.DeleteBackward();
      case "deletepreviousword":
      case "deletewordbackward":
        return this.DeleteWordBackward();
      case "deletenextword":
      case "deletewordforward":
        return this.DeleteWordForward();
      case "bold":
      case "togglebold":
        return this.ToggleFormat("FontWeight", "Bold", "Normal");
      case "italic":
      case "toggleitalic":
        return this.ToggleFormat("FontStyle", "Italic", "Normal");
      case "underline":
      case "toggleunderline":
        return this.ToggleFormat("TextDecorations", "Underline", "None");
      case "strikethrough":
      case "togglestrikethrough":
        return this.ToggleFormat("TextDecorations", "Strikethrough", "None");
      case "subscript":
      case "togglesubscript":
        return this.ToggleFormat("BaselineAlignment", "Subscript", "Baseline");
      case "superscript":
      case "togglesuperscript":
        return this.ToggleFormat(
          "BaselineAlignment",
          "Superscript",
          "Baseline",
        );
      case "alignleft":
        return this.SetParagraphProperty("TextAlignment", "Left");
      case "aligncenter":
        return this.SetParagraphProperty("TextAlignment", "Center");
      case "alignright":
        return this.SetParagraphProperty("TextAlignment", "Right");
      case "alignjustify":
      case "justify":
        return this.SetParagraphProperty("TextAlignment", "Justify");
      case "fontfamily":
        return this.ApplyProperty("FontFamily", parameter);
      case "fontsize":
        return this.ApplyProperty("FontSize", parameter);
      case "foreground":
        return this.ApplyProperty("Foreground", parameter);
      case "background":
      case "highlight":
        return this.ApplyProperty("Background", parameter);
      case "heading":
        return this.SetParagraphProperty("HeadingLevel", parameter);
      case "clearformatting":
        return this.ClearFormatting();
      case "indent":
      case "increaseindentation":
        return this.Indent();
      case "outdent":
      case "decreaseindentation":
        return this.Indent(-24);
      case "bullets":
      case "togglebullets":
        return this.ToggleList("Disc");
      case "numbering":
      case "togglenumbering":
        return this.ToggleList("Decimal");
      case "insertimage":
        return typeof parameter === "string"
          ? this.InsertImage(parameter)
          : this.InsertImage(
              parameter.Source ?? parameter.source,
              parameter.AlternativeText ?? parameter.alt,
              parameter.Width ?? parameter.width,
              parameter.Height ?? parameter.height,
            );
      case "inserttable":
        return this.InsertTable(
          parameter?.Rows ?? parameter?.rows ?? 2,
          parameter?.Columns ?? parameter?.columns ?? 2,
        );
      case "inserttablerow":
        return this.InsertTableRow(
          parameter?.Before ?? parameter?.before ?? false,
        );
      case "deletetablerow":
        return this.DeleteTableRow();
      case "inserttablecolumn":
        return this.InsertTableColumn(
          parameter?.Before ?? parameter?.before ?? false,
        );
      case "deletetablecolumn":
        return this.DeleteTableColumn();
      case "deletetable":
        return this.DeleteTable();
      case "inserthyperlink":
      case "insertlink":
        return typeof parameter === "string"
          ? this.InsertHyperlink(parameter)
          : this.InsertHyperlink(
              parameter.NavigateUri ?? parameter.uri,
              parameter.Text ?? parameter.text,
            );
      case "removehyperlink":
      case "removelink":
        return this.RemoveHyperlink();
      case "find":
        return this.Find(
          typeof parameter === "string" ? parameter : (parameter?.Text ?? ""),
          parameter?.Options,
        );
      case "replaceall":
        return this.ReplaceAll(
          parameter.Find,
          parameter.Replacement,
          parameter.Options,
        );
      case "addcomment":
        return this.AddComment(
          typeof parameter === "string" ? parameter : parameter.Text,
          parameter?.Author,
        );
      case "addbookmark":
        return this.AddBookmark(parameter);
      default:
        throw new Error(`Editing command '${command}' is not supported.`);
    }
  }
  Dispose(): void {
    if (!this.disposed) {
      while (this.depth) this.EndChange();
      this.subscription.Dispose();
      this.disposed = true;
    }
  }
}

function containsNode(node: DocumentNode, id: string): boolean {
  return (
    node.id === id || !!node.children?.some((child) => containsNode(child, id))
  );
}
function findParent(root: DocumentNode, id: string): DocumentNode | undefined {
  if (root.children?.some((child) => child.id === id)) return root;
  for (const child of root.children ?? []) {
    const parent = findParent(child, id);
    if (parent) return parent;
  }
  return undefined;
}
function findAncestors(root: DocumentNode, id: string): DocumentNode[] {
  if (root.id === id) return [];
  for (const child of root.children ?? [])
    if (containsNode(child, id)) return [root, ...findAncestors(child, id)];
  return [];
}
function tableContext(root: DocumentNode, offset: number) {
  const block = pointBlock(root, offset),
    ancestors = findAncestors(root, block.node.id);
  const table = [...ancestors].reverse().find((item) => item.type === "Table"),
    group = [...ancestors]
      .reverse()
      .find((item) => item.type === "TableRowGroup"),
    row = [...ancestors].reverse().find((item) => item.type === "TableRow"),
    cell = [...ancestors].reverse().find((item) => item.type === "TableCell");
  if (!table || !group || !row || !cell)
    throw new Error("Place the selection inside a table cell first.");
  return { table, group, row, cell };
}
function findTableRows(table: DocumentNode): DocumentNode[] {
  return (table.children ?? []).flatMap((group) => group.children ?? []);
}
function validateSimpleTable(table: DocumentNode): void {
  const rows = findTableRows(table),
    width = rows[0]?.children?.length ?? 0;
  if (
    rows.some(
      (row) =>
        row.children?.length !== width ||
        row.children.some(
          (cell) =>
            (cell.props.RowSpan ?? 1) !== 1 ||
            (cell.props.ColumnSpan ?? 1) !== 1,
        ),
    )
  )
    throw new Error(
      "Row and column editing currently requires a rectangular table without merged cells.",
    );
}
function replaceTableWithParagraph(
  root: DocumentNode,
  table: DocumentNode,
): void {
  const parent = findParent(root, table.id)!;
  parent.children!.splice(
    parent.children!.indexOf(table),
    1,
    makeNode("Paragraph"),
  );
}
function mapStructuralAnnotations(
  before: DocumentNode,
  after: DocumentNode,
): void {
  if (
    !Array.isArray(after.props.Annotations) ||
    !after.props.Annotations.length
  )
    return;
  const oldText = plainText(before),
    newText = plainText(after);
  if (oldText === newText) return;
  let prefix = 0;
  while (
    prefix < oldText.length &&
    prefix < newText.length &&
    oldText[prefix] === newText[prefix]
  )
    prefix++;
  let suffix = 0;
  while (
    suffix < oldText.length - prefix &&
    suffix < newText.length - prefix &&
    oldText[oldText.length - suffix - 1] ===
      newText[newText.length - suffix - 1]
  )
    suffix++;
  const oldBlocks = textBlocks(before),
    newBlocks = new Map(
      textBlocks(after).map((block) => [block.node.id, block]),
    );
  const move = (offset: number, trailing: boolean) => {
    const oldBlock = oldBlocks.find(
        (block) => offset >= block.start && offset <= block.end,
      ),
      corresponding = oldBlock && newBlocks.get(oldBlock.node.id);
    if (oldBlock && corresponding && oldBlock.text === corresponding.text)
      return corresponding.start + offset - oldBlock.start;
    if (offset < prefix) return offset;
    if (offset > oldText.length - suffix)
      return offset + newText.length - oldText.length;
    return trailing ? newText.length - suffix : prefix;
  };
  for (const item of after.props.Annotations as DocumentAnnotation[]) {
    item.Start = move(item.Start, false);
    item.End = Math.max(item.Start, move(item.End, true));
  }
}

/** String commands work with Execute, RelayCommand, toolbar bindings, and bridges. */
export const EditingCommands = Object.freeze(
  Object.fromEntries(
    [
      "ToggleBold",
      "ToggleItalic",
      "ToggleUnderline",
      "ToggleStrikethrough",
      "ToggleSubscript",
      "ToggleSuperscript",
      "AlignLeft",
      "AlignCenter",
      "AlignRight",
      "AlignJustify",
      "ToggleBullets",
      "ToggleNumbering",
      "EnterParagraphBreak",
      "EnterLineBreak",
      "Delete",
      "Backspace",
      "DeletePreviousWord",
      "DeleteNextWord",
      "ClearFormatting",
    ].map((name) => [name, name]),
  ),
);
export const ApplicationCommands = Object.freeze({
  Undo: "Undo",
  Redo: "Redo",
  SelectAll: "SelectAll",
  Find: "Find",
  Replace: "ReplaceAll",
});
