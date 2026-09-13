import { EventDispatcher, FlowDocument, type DocumentNode } from "./model.js";
import { leaves } from "./engine-tree.js";
import type { RichTextEngine } from "./engine.js";

export type VersionVector = Record<string, number>;
export interface TextOperation {
  Protocol: 1;
  DocumentId: string;
  InitialHash: string;
  ActorId: string;
  Sequence: number;
  Clock: number;
  Dependencies: VersionVector;
  Kind: "Insert" | "Delete" | "Replace" | "Format";
  After?: string;
  Text?: string;
  Targets?: string[];
  Property?: string;
  Value?: unknown;
}
export interface CollaborationSnapshot {
  Protocol: 1;
  DocumentId: string;
  InitialText: string;
  Operations: TextOperation[];
}
export interface CollaborationOptions {
  DocumentId: string;
  ActorId: string;
  Text?: string;
  MaxPendingOperations?: number;
  MaxCharacters?: number;
}
export class CollaborationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CollaborationConflictError";
  }
}
interface Character {
  Id: string;
  After: string;
  Text: string;
  Clock: number;
  ActorId: string;
  Sequence: number;
  Index: number;
  Deleted: boolean;
  Styles: Map<
    string,
    { Clock: number; ActorId: string; Sequence: number; Value: unknown }
  >;
}
const ROOT = "@root";
const properties = new Set([
  "FontFamily",
  "FontSize",
  "FontWeight",
  "FontStyle",
  "Foreground",
  "Background",
  "TextDecorations",
  "BaselineAlignment",
  "Language",
]);
const safeActor = (id: unknown): id is string =>
  typeof id === "string" &&
  /^[A-Za-z0-9_-]{1,80}$/.test(id) &&
  !["__proto__", "prototype", "constructor"].includes(id);
const integer = (value: unknown) =>
  Number.isSafeInteger(value) && Number(value) >= 0;
const clone = <T>(value: T): T => structuredClone(value);
const canonical = (value: any): string =>
  JSON.stringify(
    value && typeof value === "object"
      ? Array.isArray(value)
        ? value.map((item) => JSON.parse(canonical(item)))
        : Object.fromEntries(
            Object.keys(value)
              .sort()
              .filter((key) => value[key] !== undefined)
              .map((key) => [key, JSON.parse(canonical(value[key]))]),
          )
      : value,
  );
const fingerprint = (text: string) => {
  let a = 2166136261,
    b = 2246822519;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619);
    b = Math.imul(b ^ text.charCodeAt(i), 3266489917);
  }
  return `${text.length}:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`;
};
const stampCompare = (
  a: { Clock: number; ActorId: string; Sequence: number },
  b: { Clock: number; ActorId: string; Sequence: number },
) =>
  a.Clock - b.Clock ||
  (a.ActorId < b.ActorId ? -1 : a.ActorId > b.ActorId ? 1 : 0) ||
  a.Sequence - b.Sequence;

/** Replicated growable character sequence with causal delivery and tombstones. */
export class CollaborativeTextSession {
  readonly DocumentId: string;
  readonly ActorId: string;
  readonly InitialText: string;
  readonly InitialHash: string;
  readonly OperationGenerated = new EventDispatcher<TextOperation>();
  readonly Changed = new EventDispatcher<{
    Session: CollaborativeTextSession;
    Operation: TextOperation;
    Remote: boolean;
  }>();
  readonly Conflict = new EventDispatcher<{
    Error: Error;
    Operation?: TextOperation;
  }>();
  private characters = new Map<string, Character>();
  private children = new Map<string, string[]>();
  private vector = new Map<string, number>();
  private accepted = new Map<string, TextOperation>();
  private pending = new Map<string, TextOperation>();
  private clock = 0;
  private maxPending: number;
  private maxCharacters: number;
  private resyncRequired = false;
  constructor(options: CollaborationOptions) {
    if (
      !options ||
      typeof options.DocumentId !== "string" ||
      !options.DocumentId ||
      options.DocumentId.length > 200 ||
      !safeActor(options.ActorId)
    )
      throw new TypeError(
        "A document ID and unique safe actor ID are required.",
      );
    if (options.Text !== undefined && typeof options.Text !== "string")
      throw new TypeError("Initial collaboration text must be a string.");
    this.DocumentId = options.DocumentId;
    this.ActorId = options.ActorId;
    this.InitialText = (options.Text ?? "").replace(/\r\n?/g, "\n");
    this.InitialHash = fingerprint(this.InitialText);
    this.maxPending = options.MaxPendingOperations ?? 1000;
    this.maxCharacters = options.MaxCharacters ?? 1000000;
    if (
      !integer(this.maxPending) ||
      !integer(this.maxCharacters) ||
      this.InitialText.length > this.maxCharacters
    )
      throw new RangeError("Invalid collaboration limits.");
    let after = ROOT,
      index = 0;
    for (const text of Array.from(this.InitialText)) {
      const Id = `@seed:${index}`;
      this.addCharacter({
        Id,
        After: after,
        Text: text,
        Clock: 0,
        ActorId: "",
        Sequence: 0,
        Index: index,
        Deleted: false,
        Styles: new Map(),
      });
      after = Id;
      index++;
    }
  }
  get Text(): string {
    return this.visible()
      .map((item) => item.Text)
      .join("");
  }
  get VersionVector(): VersionVector {
    return Object.fromEntries(
      [...this.vector].sort(([a], [b]) => (a < b ? -1 : 1)),
    );
  }
  get ResyncRequired(): boolean {
    return this.resyncRequired;
  }
  get RequiresCompaction(): boolean {
    return this.characters.size >= this.maxCharacters;
  }
  get PendingCount(): number {
    return this.pending.size;
  }
  get CharacterCount(): number {
    return this.characters.size;
  }
  private ordered(): Character[] {
    const output: Character[] = [],
      stack = [...(this.children.get(ROOT) ?? [])].reverse();
    while (stack.length) {
      const id = stack.pop()!,
        item = this.characters.get(id)!;
      output.push(item);
      const children = this.children.get(id) ?? [];
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    }
    return output;
  }
  private visible(): Character[] {
    return this.ordered().filter((item) => !item.Deleted);
  }
  private boundary(offset: number): { items: Character[]; index: number } {
    if (!integer(offset))
      throw new RangeError("Text offsets must be nonnegative integers.");
    const items = this.visible();
    let position = 0;
    for (let i = 0; i < items.length; i++) {
      if (position === offset) return { items, index: i };
      position += items[i].Text.length;
      if (position > offset)
        throw new RangeError(
          "A collaborative edit cannot split a Unicode surrogate pair.",
        );
    }
    if (position !== offset)
      throw new RangeError("Text offset is outside the document.");
    return { items, index: items.length };
  }
  private base(kind: TextOperation["Kind"]): TextOperation {
    return {
      Protocol: 1,
      DocumentId: this.DocumentId,
      InitialHash: this.InitialHash,
      ActorId: this.ActorId,
      Sequence: (this.vector.get(this.ActorId) ?? 0) + 1,
      Clock: this.clock + 1,
      Dependencies: {
        ...this.VersionVector,
        [this.ActorId]: this.vector.get(this.ActorId) ?? 0,
      },
      Kind: kind,
    };
  }
  Insert(offset: number, text: string): TextOperation | undefined {
    if (typeof text !== "string")
      throw new TypeError("Insertion text must be a string.");
    text = text.replace(/\r\n?/g, "\n");
    if (!text) return undefined;
    const { items, index } = this.boundary(offset),
      operation = {
        ...this.base("Insert"),
        After: index ? items[index - 1].Id : ROOT,
        Text: text,
      };
    this.commitLocal(operation);
    return clone(operation);
  }
  Delete(start: number, end: number): TextOperation | undefined {
    if (end < start) throw new RangeError("Deletion end precedes its start.");
    const a = this.boundary(start),
      b = this.boundary(end);
    if (a.index === b.index) return undefined;
    const operation = {
      ...this.base("Delete"),
      Targets: a.items.slice(a.index, b.index).map((item) => item.Id),
    };
    this.commitLocal(operation);
    return clone(operation);
  }
  Replace(start: number, end: number, text: string): TextOperation | undefined {
    if (typeof text !== "string" || end < start)
      throw new TypeError(
        "A replacement requires ordered offsets and string text.",
      );
    text = text.replace(/\r\n?/g, "\n");
    if (start === end) return this.Insert(start, text);
    if (!text) return this.Delete(start, end);
    const a = this.boundary(start),
      b = this.boundary(end),
      operation = {
        ...this.base("Replace"),
        After: a.index ? a.items[a.index - 1].Id : ROOT,
        Targets: a.items.slice(a.index, b.index).map((item) => item.Id),
        Text: text,
      };
    this.commitLocal(operation);
    return clone(operation);
  }
  Format(
    start: number,
    end: number,
    property: string,
    value: unknown,
  ): TextOperation | undefined {
    if (end < start) throw new RangeError("Formatting end precedes its start.");
    const a = this.boundary(start),
      b = this.boundary(end);
    if (a.index === b.index) return undefined;
    const operation = {
      ...this.base("Format"),
      Targets: a.items.slice(a.index, b.index).map((item) => item.Id),
      Property: property,
      Value: clone(value),
    };
    this.commitLocal(operation);
    return clone(operation);
  }
  private commitLocal(operation: TextOperation): void {
    this.validate(operation);
    this.apply(operation, false);
    this.OperationGenerated.Emit(clone(operation));
    this.drain();
  }
  Receive(input: TextOperation): "applied" | "queued" | "duplicate" {
    try {
      const operation = clone(input);
      this.validate(operation);
      const key = this.key(operation),
        known = this.accepted.get(key) ?? this.pending.get(key);
      if (known) {
        if (canonical(known) !== canonical(operation))
          throw new CollaborationConflictError(
            "An operation ID was reused with different contents.",
          );
        return "duplicate";
      }
      if (operation.Sequence <= (this.vector.get(operation.ActorId) ?? 0))
        throw new CollaborationConflictError(
          "An actor sequence was replayed with unknown contents.",
        );
      if (!this.ready(operation)) {
        if (this.pending.size >= this.maxPending) {
          this.resyncRequired = true;
          throw new CollaborationConflictError(
            "Causal queue limit exceeded; obtain a current snapshot.",
          );
        }
        this.pending.set(key, operation);
        return "queued";
      }
      this.apply(operation, true);
      this.drain();
      return "applied";
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      this.Conflict.Emit({ Error: failure, Operation: input });
      throw failure;
    }
  }
  private key(operation: TextOperation): string {
    return `${operation.ActorId}:${operation.Sequence}`;
  }
  private validate(operation: TextOperation): void {
    if (
      !operation ||
      operation.Protocol !== 1 ||
      operation.DocumentId !== this.DocumentId ||
      operation.InitialHash !== this.InitialHash
    )
      throw new CollaborationConflictError(
        "Protocol, document identity, or initial content does not match.",
      );
    const keys = new Set([
      "Protocol",
      "DocumentId",
      "InitialHash",
      "ActorId",
      "Sequence",
      "Clock",
      "Dependencies",
      "Kind",
      "After",
      "Text",
      "Targets",
      "Property",
      "Value",
    ]);
    if (
      Object.keys(operation).some((key) => !keys.has(key)) ||
      !safeActor(operation.ActorId) ||
      !integer(operation.Sequence) ||
      operation.Sequence < 1 ||
      !integer(operation.Clock) ||
      operation.Clock < 1 ||
      !operation.Dependencies ||
      typeof operation.Dependencies !== "object" ||
      Array.isArray(operation.Dependencies)
    )
      throw new CollaborationConflictError("Malformed operation envelope.");
    if (
      Object.entries(operation.Dependencies).some(
        ([actor, sequence]) => !safeActor(actor) || !integer(sequence),
      ) ||
      (operation.Dependencies[operation.ActorId] ?? 0) !==
        operation.Sequence - 1
    )
      throw new CollaborationConflictError("Invalid causal version vector.");
    if (operation.Kind === "Insert" || operation.Kind === "Replace") {
      if (
        typeof operation.Text !== "string" ||
        !operation.Text.length ||
        operation.Text.length > 65536 ||
        operation.Text.includes("\r") ||
        typeof operation.After !== "string" ||
        (operation.Kind === "Insert" && operation.Targets !== undefined) ||
        operation.Property !== undefined ||
        operation.Value !== undefined
      )
        throw new CollaborationConflictError("Malformed insertion operation.");
      if (
        operation.Kind === "Replace" &&
        (!Array.isArray(operation.Targets) ||
          !operation.Targets.length ||
          operation.Targets.length > 100000 ||
          new Set(operation.Targets).size !== operation.Targets.length ||
          operation.Targets.some(
            (id) => typeof id !== "string" || id.length > 150,
          ))
      )
        throw new CollaborationConflictError(
          "Malformed replacement target list.",
        );
    } else if (operation.Kind === "Delete" || operation.Kind === "Format") {
      if (
        !Array.isArray(operation.Targets) ||
        !operation.Targets.length ||
        operation.Targets.length > 100000 ||
        new Set(operation.Targets).size !== operation.Targets.length ||
        operation.Targets.some(
          (id) => typeof id !== "string" || id.length > 150,
        ) ||
        operation.Text !== undefined ||
        operation.After !== undefined
      )
        throw new CollaborationConflictError(
          "Malformed target character list.",
        );
      if (operation.Kind === "Format") {
        if (
          !properties.has(operation.Property ?? "") ||
          operation.Value === undefined ||
          !(
            typeof operation.Value === "string" ||
            typeof operation.Value === "number" ||
            typeof operation.Value === "boolean" ||
            operation.Value === null
          ) ||
          (typeof operation.Value === "number" &&
            !Number.isFinite(operation.Value)) ||
          JSON.stringify(operation.Value).length > 2048
        )
          throw new CollaborationConflictError(
            "Unsupported collaboration formatting property or value.",
          );
        if (
          operation.Property === "FontSize" &&
          (typeof operation.Value !== "number" ||
            !Number.isFinite(operation.Value) ||
            operation.Value <= 0)
        )
          throw new CollaborationConflictError(
            "Font size must be a positive finite number.",
          );
      } else if (
        operation.Property !== undefined ||
        operation.Value !== undefined
      )
        throw new CollaborationConflictError(
          "Deletion operations do not contain formatting.",
        );
    } else throw new CollaborationConflictError("Unknown operation kind.");
  }
  private ready(operation: TextOperation): boolean {
    return (
      operation.Sequence === (this.vector.get(operation.ActorId) ?? 0) + 1 &&
      Object.entries(operation.Dependencies).every(
        ([actor, sequence]) => (this.vector.get(actor) ?? 0) >= sequence,
      )
    );
  }
  private apply(operation: TextOperation, remote: boolean): void {
    let causalClock = 0;
    for (const [actor, sequence] of Object.entries(operation.Dependencies)) {
      if (!sequence) continue;
      const predecessor = this.accepted.get(`${actor}:${sequence}`);
      if (!predecessor)
        throw new CollaborationConflictError("Missing causal predecessor.");
      causalClock = Math.max(causalClock, predecessor.Clock);
    }
    if (operation.Clock !== causalClock + 1)
      throw new CollaborationConflictError(
        "Lamport clock does not match the causal version vector.",
      );
    const causal = (item: Character) => {
      if (
        item.Sequence &&
        (operation.Dependencies[item.ActorId] ?? 0) < item.Sequence
      )
        throw new CollaborationConflictError(
          "Referenced character is absent from the causal version vector.",
        );
    };
    if (operation.Kind === "Insert" || operation.Kind === "Replace") {
      if (operation.After !== ROOT && !this.characters.has(operation.After!))
        throw new CollaborationConflictError(
          "Insertion anchor is unknown despite satisfied dependencies.",
        );
      if (operation.After !== ROOT)
        causal(this.characters.get(operation.After!)!);
      const points = Array.from(operation.Text!);
      if (!remote && this.characters.size + points.length > this.maxCharacters)
        throw new CollaborationConflictError(
          "Character/tombstone limit reached; compact through an agreed new snapshot.",
        );
      const removed = (operation.Targets ?? []).map((id) => {
        const item = this.characters.get(id);
        if (!item)
          throw new CollaborationConflictError(
            "A replacement target is unknown.",
          );
        causal(item);
        return item;
      });
      for (const item of removed) item.Deleted = true;
      let after = operation.After!;
      points.forEach((text, index) => {
        const Id = `${operation.ActorId}:${operation.Sequence}:${index}`;
        this.addCharacter({
          Id,
          After: after,
          Text: text,
          Clock: operation.Clock,
          ActorId: operation.ActorId,
          Sequence: operation.Sequence,
          Index: index,
          Deleted: false,
          Styles: new Map(),
        });
        after = Id;
      });
    } else {
      const targets = operation.Targets!.map((id) => {
        const item = this.characters.get(id);
        if (!item)
          throw new CollaborationConflictError(
            "A target character is unknown despite satisfied dependencies.",
          );
        causal(item);
        return item;
      });
      for (const item of targets) {
        if (operation.Kind === "Delete") item.Deleted = true;
        else {
          const old = item.Styles.get(operation.Property!);
          if (!old || stampCompare(old, operation) < 0)
            item.Styles.set(operation.Property!, {
              Clock: operation.Clock,
              ActorId: operation.ActorId,
              Sequence: operation.Sequence,
              Value: clone(operation.Value),
            });
        }
      }
    }
    this.clock = Math.max(this.clock, operation.Clock);
    this.vector.set(operation.ActorId, operation.Sequence);
    this.accepted.set(this.key(operation), clone(operation));
    this.Changed.Emit({
      Session: this,
      Operation: clone(operation),
      Remote: remote,
    });
  }
  private addCharacter(item: Character): void {
    this.characters.set(item.Id, item);
    const siblings = this.children.get(item.After) ?? [];
    siblings.push(item.Id);
    siblings.sort(
      (a, b) =>
        stampCompare(this.characters.get(b)!, this.characters.get(a)!) ||
        this.characters.get(a)!.Index - this.characters.get(b)!.Index,
    );
    this.children.set(item.After, siblings);
  }
  private drain(): void {
    let progress = true;
    while (progress) {
      progress = false;
      for (const [key, operation] of this.pending) {
        if (this.ready(operation)) {
          this.pending.delete(key);
          try {
            this.apply(operation, true);
          } catch (error) {
            this.resyncRequired = true;
            this.Conflict.Emit({
              Error: error instanceof Error ? error : new Error(String(error)),
              Operation: operation,
            });
          }
          progress = true;
        }
      }
    }
  }
  GetFormatting(): Array<{
    CharacterId: string;
    Start: number;
    End: number;
    Properties: Record<string, unknown>;
  }> {
    let offset = 0;
    return this.visible().map((item) => {
      const Start = offset;
      offset += item.Text.length;
      return {
        CharacterId: item.Id,
        Start,
        End: offset,
        Properties: Object.fromEntries(
          [...item.Styles].map(([name, stamp]) => [name, clone(stamp.Value)]),
        ),
      };
    });
  }
  ExportSnapshot(): CollaborationSnapshot {
    return {
      Protocol: 1,
      DocumentId: this.DocumentId,
      InitialText: this.InitialText,
      Operations: [...this.accepted.values()].map(clone),
    };
  }
  static FromSnapshot(
    snapshot: CollaborationSnapshot,
    actorId: string,
  ): CollaborativeTextSession {
    if (
      !snapshot ||
      snapshot.Protocol !== 1 ||
      !Array.isArray(snapshot.Operations)
    )
      throw new CollaborationConflictError("Malformed collaboration snapshot.");
    const session = new CollaborativeTextSession({
      DocumentId: snapshot.DocumentId,
      ActorId: actorId,
      Text: snapshot.InitialText,
    });
    for (const operation of snapshot.Operations) session.Receive(operation);
    if (session.PendingCount)
      throw new CollaborationConflictError(
        "Snapshot is missing causal operations.",
      );
    return session;
  }
  BindEngine(engine: RichTextEngine): CollaborationBinding {
    return new CollaborationBinding(this, engine);
  }
}

/** Binds root paragraphs and rich inlines; structural merges use explicit host logic. */
export class CollaborationBinding {
  private subscriptions: Array<{ Dispose(): void }> = [];
  private applying = false;
  private disposed = false;
  private formatting: FormatSpan[] = [];
  get IsConnected(): boolean {
    return !this.disposed;
  }
  constructor(
    readonly Session: CollaborativeTextSession,
    readonly Engine: RichTextEngine,
  ) {
    const engine = Engine;
    validateProjection(engine.Document.ToJSON());
    if (engine.Document.Text !== Session.Text)
      throw new CollaborationConflictError(
        "Engine and collaboration session must begin with identical text.",
      );
    this.formatting = captureFormatting(engine);
    this.subscriptions.push(
      engine.Changed.Subscribe(() => {
        if (this.applying || this.disposed) return;
        try {
          validateProjection(engine.Document.ToJSON());
          const before = Session.Text,
            after = engine.Document.Text,
            current = captureFormatting(engine);
          this.applying = true;
          try {
            if (before !== after) {
              const diff = textDifference(before, after);
              Session.Replace(diff.Start, diff.End, diff.Text);
              for (const span of current) {
                const start = Math.max(span.Start, diff.Start),
                  end = Math.min(span.End, diff.Start + diff.Text.length);
                if (end > start)
                  for (const [property, value] of Object.entries(
                    span.Properties,
                  ))
                    Session.Format(start, end, property, value);
              }
            } else
              for (const change of formattingDifference(
                this.formatting,
                current,
              ))
                Session.Format(
                  change.Start,
                  change.End,
                  change.Property,
                  change.Value,
                );
            this.formatting = current;
          } finally {
            this.applying = false;
          }
        } catch (error) {
          this.fail(error);
        }
      }),
    );
    this.subscriptions.push(
      Session.Changed.Subscribe(({ Operation }) => {
        if (this.applying || this.disposed) return;
        this.applying = true;
        const tracking = engine.TrackChanges,
          selection = engine.CaptureSelectionState();
        engine.TrackChanges = false;
        try {
          engine.Change(() => {
            const diff = textDifference(engine.Document.Text, Session.Text);
            let insertedStart = -1,
              insertedEnd = -1;
            if (diff.Start !== diff.End || diff.Text) {
              engine.Select(diff.Start, diff.End);
              engine.ResetInsertionFormatting();
              engine.InsertText(diff.Text);
              insertedStart = diff.Start;
              insertedEnd = diff.Start + diff.Text.length;
            }
            const targets = new Set(Operation.Targets ?? []),
              spans = Session.GetFormatting(),
              changes: Array<{
                Start: number;
                End: number;
                Property: string;
                Value: unknown;
              }> = [];
            for (const span of spans) {
              const inserted =
                span.Start >= insertedStart &&
                span.End <= insertedEnd &&
                insertedStart >= 0;
              if (inserted) {
                for (const [Property, Value] of Object.entries({
                  ...defaultFormatting,
                  ...span.Properties,
                }))
                  changes.push({
                    Start: span.Start,
                    End: span.End,
                    Property,
                    Value,
                  });
              } else if (
                Operation.Kind === "Format" &&
                targets.has(span.CharacterId)
              )
                changes.push({
                  Start: span.Start,
                  End: span.End,
                  Property: Operation.Property!,
                  Value: span.Properties[Operation.Property!],
                });
            }
            for (const change of coalesceFormats(changes)) {
              engine.Select(change.Start, change.End);
              engine.ApplyProperty(change.Property, change.Value);
            }
          });
          engine.RestoreSelectionState(selection);
          this.formatting = captureFormatting(engine);
          if (engine.Document.Text !== Session.Text)
            throw new CollaborationConflictError(
              "The engine cannot project this operation without changing document structure.",
            );
        } catch (error) {
          this.fail(error);
        } finally {
          engine.TrackChanges = tracking;
          this.applying = false;
        }
      }),
    );
  }
  private fail(error: unknown): void {
    const failure = error instanceof Error ? error : new Error(String(error));
    this.Dispose();
    this.Session.Conflict.Emit({ Error: failure });
  }
  Dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.subscriptions.forEach((subscription) => subscription.Dispose());
    this.subscriptions = [];
  }
}
interface FormatSpan {
  Start: number;
  End: number;
  Properties: Record<string, unknown>;
}
const defaultDocument = new FlowDocument();
const defaultFormatting = Object.fromEntries(
  [...properties]
    .map((name) => [name, defaultDocument.GetValue(name)])
    .filter(([, value]) => value !== undefined),
);
function captureFormatting(engine: RichTextEngine): FormatSpan[] {
  return leaves(engine.Document.ToJSON())
    .filter((leaf) => leaf.end > leaf.start)
    .map((leaf) => ({
      Start: leaf.start,
      End: leaf.end,
      Properties: Object.fromEntries(
        [...properties]
          .map((name) => [
            name,
            leaf.props[name] ?? engine.Document.GetValue(name),
          ])
          .filter(([, value]) => value !== undefined),
      ),
    }));
}
function coalesceFormats(
  changes: Array<{
    Start: number;
    End: number;
    Property: string;
    Value: unknown;
  }>,
): Array<{ Start: number; End: number; Property: string; Value: unknown }> {
  changes.sort((a, b) =>
    a.Property < b.Property
      ? -1
      : a.Property > b.Property
        ? 1
        : a.Start - b.Start,
  );
  const result: typeof changes = [];
  for (const change of changes) {
    const last = result.at(-1);
    if (
      last &&
      last.Property === change.Property &&
      last.End === change.Start &&
      canonical(last.Value) === canonical(change.Value)
    )
      last.End = change.End;
    else result.push({ ...change });
  }
  return result;
}
function formattingDifference(
  before: FormatSpan[],
  after: FormatSpan[],
): Array<{ Start: number; End: number; Property: string; Value: unknown }> {
  const boundaries = [
      ...new Set(
        [...before, ...after].flatMap((span) => [span.Start, span.End]),
      ),
    ].sort((a, b) => a - b),
    changes: Array<{
      Start: number;
      End: number;
      Property: string;
      Value: unknown;
    }> = [];
  let oldIndex = 0,
    newIndex = 0;
  for (let i = 0; i < boundaries.length - 1; i++) {
    const Start = boundaries[i],
      End = boundaries[i + 1];
    while (oldIndex < before.length && before[oldIndex].End <= Start)
      oldIndex++;
    while (newIndex < after.length && after[newIndex].End <= Start) newIndex++;
    const old = before[oldIndex],
      next = after[newIndex];
    if (!old || !next || old.Start > Start || next.Start > Start) continue;
    for (const [Property, Value] of Object.entries(next.Properties))
      if (canonical(old.Properties[Property]) !== canonical(Value))
        changes.push({ Start, End, Property, Value });
  }
  return coalesceFormats(changes);
}
function textDifference(
  before: string,
  after: string,
): { Start: number; End: number; Text: string } {
  let start = 0,
    suffix = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  )
    start++;
  if (start > 0 && /[\uDC00-\uDFFF]/.test(before[start] ?? after[start] ?? ""))
    start--;
  while (
    suffix < before.length - start &&
    suffix < after.length - start &&
    before.at(-suffix - 1) === after.at(-suffix - 1)
  )
    suffix++;
  if (
    suffix > 0 &&
    /[\uDC00-\uDFFF]/.test(
      before[before.length - suffix] ?? after[after.length - suffix] ?? "",
    )
  )
    suffix--;
  return {
    Start: start,
    End: before.length - suffix,
    Text: after.slice(start, after.length - suffix),
  };
}
function validateProjection(root: DocumentNode): void {
  const inline = new Set([
    "Run",
    "Span",
    "Bold",
    "Italic",
    "Underline",
    "Hyperlink",
    "LineBreak",
  ]);
  if (root.children?.some((child) => child.type !== "Paragraph"))
    throw new CollaborationConflictError(
      "Text collaboration binding supports root paragraphs; tables, lists and structural blocks require a host merge protocol.",
    );
  const visit = (node: DocumentNode) => {
    for (const child of node.children ?? []) {
      if (node.type !== "FlowDocument" && !inline.has(child.type))
        throw new CollaborationConflictError(
          "Text collaboration cannot project embedded objects or structural edits.",
        );
      visit(child);
    }
  };
  visit(root);
}
