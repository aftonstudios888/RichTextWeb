import {
  FlowDocument,
  Run,
  Table,
  TextElement,
  elementFromJSON,
  type DocumentNode,
} from "./model.js";

const copy = <T>(value: T): T => structuredClone(value);
const stable = (value: unknown) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
const equal = (a: unknown, b: unknown) => stable(a) === stable(b);
export interface PropertyPatch {
  Name: string;
  Before?: unknown;
  After?: unknown;
  HadBefore: boolean;
  HasAfter: boolean;
}
export interface TextPatch {
  Offset: number;
  Removed: string;
  Inserted: string;
  BeforeFingerprint: string;
  AfterFingerprint: string;
}
export interface ChildrenPatch {
  Index: number;
  Removed: DocumentNode[];
  Inserted: DocumentNode[];
}
export interface NodePatch {
  Id: string;
  Type: string;
  Properties?: PropertyPatch[];
  Text?: TextPatch;
  Children?: ChildrenPatch;
  Descendants?: NodePatch[];
}
/** Serializable reversible patch containing changed values and subtrees only. */
export interface DocumentPatch {
  Version: 1;
  RootId: string;
  Change: NodePatch;
}
export class PatchConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatchConflictError";
  }
}
export class DocumentObserverError extends Error {
  readonly Committed = true;
  constructor(readonly Errors: unknown[]) {
    super("The document change committed, but a document observer failed.");
    this.name = "DocumentObserverError";
  }
}
function textFingerprint(value: string): string {
  let a = 2166136261,
    b = 2246822519;
  for (let i = 0; i < value.length; i++) {
    a = Math.imul(a ^ value.charCodeAt(i), 16777619);
    b = Math.imul(b ^ value.charCodeAt(i), 3266489917);
  }
  return `${value.length}:${a >>> 0}:${b >>> 0}`;
}

export function CreateDocumentPatch(
  before: DocumentNode,
  after: DocumentNode,
): DocumentPatch | undefined {
  if (before.id !== after.id || before.type !== after.type)
    throw new TypeError("Patch roots must have the same identity and type.");
  const diff = (a: DocumentNode, b: DocumentNode): NodePatch | undefined => {
    const result: NodePatch = { Id: a.id, Type: a.type },
      props: PropertyPatch[] = [];
    for (const Name of new Set([
      ...Object.keys(a.props),
      ...Object.keys(b.props),
    ])) {
      const HadBefore = Object.hasOwn(a.props, Name),
        HasAfter = Object.hasOwn(b.props, Name);
      if (HadBefore !== HasAfter || !equal(a.props[Name], b.props[Name]))
        props.push({
          Name,
          HadBefore,
          HasAfter,
          ...(HadBefore ? { Before: copy(a.props[Name]) } : {}),
          ...(HasAfter ? { After: copy(b.props[Name]) } : {}),
        });
    }
    if (props.length) result.Properties = props;
    if ((a.text ?? "") !== (b.text ?? "")) {
      const old = a.text ?? "",
        next = b.text ?? "";
      let prefix = 0,
        suffix = 0;
      while (
        prefix < old.length &&
        prefix < next.length &&
        old[prefix] === next[prefix]
      )
        prefix++;
      while (
        suffix < old.length - prefix &&
        suffix < next.length - prefix &&
        old.at(-suffix - 1) === next.at(-suffix - 1)
      )
        suffix++;
      result.Text = {
        Offset: prefix,
        Removed: old.slice(prefix, old.length - suffix),
        Inserted: next.slice(prefix, next.length - suffix),
        BeforeFingerprint: textFingerprint(old),
        AfterFingerprint: textFingerprint(next),
      };
    }
    const old = a.children ?? [],
      next = b.children ?? [];
    let prefix = 0,
      suffix = 0;
    const same = (x: DocumentNode, y: DocumentNode) =>
      x.id === y.id && x.type === y.type;
    while (
      prefix < old.length &&
      prefix < next.length &&
      same(old[prefix], next[prefix])
    )
      prefix++;
    while (
      suffix < old.length - prefix &&
      suffix < next.length - prefix &&
      same(old[old.length - suffix - 1], next[next.length - suffix - 1])
    )
      suffix++;
    if (prefix + suffix < old.length || prefix + suffix < next.length)
      result.Children = {
        Index: prefix,
        Removed: copy(old.slice(prefix, old.length - suffix)),
        Inserted: copy(next.slice(prefix, next.length - suffix)),
      };
    const descendants: NodePatch[] = [];
    for (let i = 0; i < prefix; i++) {
      const change = diff(old[i], next[i]);
      if (change) descendants.push(change);
    }
    for (let i = 0; i < suffix; i++) {
      const change = diff(
        old[old.length - suffix + i],
        next[next.length - suffix + i],
      );
      if (change) descendants.push(change);
    }
    if (descendants.length) result.Descendants = descendants;
    return result.Properties ||
      result.Text ||
      result.Children ||
      result.Descendants
      ? result
      : undefined;
  };
  const Change = diff(before, after);
  return Change ? { Version: 1, RootId: before.id, Change } : undefined;
}

export function InvertDocumentPatch(patch: DocumentPatch): DocumentPatch {
  const invert = (change: NodePatch): NodePatch => ({
    Id: change.Id,
    Type: change.Type,
    ...(change.Properties
      ? {
          Properties: change.Properties.map((p) => ({
            Name: p.Name,
            HadBefore: p.HasAfter,
            HasAfter: p.HadBefore,
            ...(p.HasAfter ? { Before: copy(p.After) } : {}),
            ...(p.HadBefore ? { After: copy(p.Before) } : {}),
          })),
        }
      : {}),
    ...(change.Text
      ? {
          Text: {
            Offset: change.Text.Offset,
            Removed: change.Text.Inserted,
            Inserted: change.Text.Removed,
            BeforeFingerprint: change.Text.AfterFingerprint,
            AfterFingerprint: change.Text.BeforeFingerprint,
          },
        }
      : {}),
    ...(change.Children
      ? {
          Children: {
            Index: change.Children.Index,
            Removed: copy(change.Children.Inserted),
            Inserted: copy(change.Children.Removed),
          },
        }
      : {}),
    ...(change.Descendants
      ? { Descendants: change.Descendants.map(invert) }
      : {}),
  });
  return { Version: 1, RootId: patch.RootId, Change: invert(patch.Change) };
}

/** Validate contextual preconditions before returning a detached patched tree. */
export function ApplyPatchToJSON(
  document: DocumentNode,
  patch: DocumentPatch,
): DocumentNode {
  if (patch.Version !== 1 || patch.RootId !== document.id)
    throw new PatchConflictError(
      "Patch document identity or version does not match.",
    );
  const root = copy(document);
  const apply = (node: DocumentNode, change: NodePatch) => {
    if (node.id !== change.Id || node.type !== change.Type)
      throw new PatchConflictError(
        `Element ${change.Id} is missing or has changed type.`,
      );
    for (const prop of change.Properties ?? []) {
      if (
        Object.hasOwn(node.props, prop.Name) !== prop.HadBefore ||
        (prop.HadBefore && !equal(node.props[prop.Name], prop.Before))
      )
        throw new PatchConflictError(
          `Property ${prop.Name} changed after this operation.`,
        );
      if (prop.HasAfter)
        Object.defineProperty(node.props, prop.Name, {
          value: copy(prop.After),
          writable: true,
          configurable: true,
          enumerable: true,
        });
      else delete node.props[prop.Name];
    }
    if (change.Text) {
      const { Offset, Removed, Inserted } = change.Text,
        text = node.text ?? "";
      if (
        !Number.isInteger(Offset) ||
        Offset < 0 ||
        text.slice(Offset, Offset + Removed.length) !== Removed ||
        Offset > text.length ||
        textFingerprint(text) !== change.Text.BeforeFingerprint
      )
        throw new PatchConflictError(
          "Text patch no longer matches its target.",
        );
      node.text =
        text.slice(0, Offset) + Inserted + text.slice(Offset + Removed.length);
      if (textFingerprint(node.text) !== change.Text.AfterFingerprint)
        throw new PatchConflictError(
          "Text patch result fingerprint is invalid.",
        );
    }
    // Descendant patches address the stable prefix and suffix, prior to splice.
    for (const childChange of change.Descendants ?? []) {
      const child = node.children?.find((n) => n.id === childChange.Id);
      if (!child)
        throw new PatchConflictError(
          `Child ${childChange.Id} no longer exists.`,
        );
      apply(child, childChange);
    }
    if (change.Children) {
      const { Index, Removed, Inserted } = change.Children,
        children = (node.children ??= []);
      if (
        !Number.isInteger(Index) ||
        Index < 0 ||
        Index > children.length ||
        !equal(children.slice(Index, Index + Removed.length), Removed)
      )
        throw new PatchConflictError(
          "Structural patch no longer matches its target children.",
        );
      children.splice(Index, Removed.length, ...copy(Inserted));
    }
  };
  apply(root, patch.Change);
  return root;
}

/** Reconcile a validated tree through live collections, retaining matching objects. */
export function ReconcileDocument(
  document: FlowDocument,
  target: DocumentNode,
): void {
  const input = copy(target);
  input.id = document.Id;
  const normalized = FlowDocument.FromJSON(input).ToJSON();
  const live = new Map<string, TextElement>(),
    old = new Map<string, DocumentNode>(),
    wanted = new Map<string, { node: DocumentNode; parent?: string }>();
  const scanLive = (element: TextElement) => {
    live.set(element.Id, element);
    for (const child of element.Children) scanLive(child);
  };
  scanLive(document);
  const scanOld = (node: DocumentNode) => {
    old.set(node.id, node);
    node.children?.forEach(scanOld);
  };
  scanOld(document.ToJSON());
  const scanWanted = (node: DocumentNode, parent?: string) => {
    wanted.set(node.id, { node, parent });
    node.children?.forEach((child) => scanWanted(child, node.id));
  };
  scanWanted(normalized);
  const observerErrors: unknown[] = [];
  const attempt = (action: () => void) => {
    try {
      action();
    } catch (error) {
      observerErrors.push(error);
    }
  };
  document.BeginChange();
  try {
    for (const element of live.values()) {
      if (element === document || !element.Parent) continue;
      const target = wanted.get(element.Id),
        parent = wanted.get(element.Parent.Id);
      if (
        !target ||
        target.parent !== element.Parent.Id ||
        target.node.type !== element.Type ||
        !parent ||
        parent.node.type !== element.Parent.Type
      )
        attempt(() => {
          element._collection?.Remove(element);
        });
    }
    const reconcile = (node: DocumentNode): TextElement => {
      let element = live.get(node.id);
      if (!element || element.Type !== node.type)
        element = elementFromJSON({ ...copy(node), children: [] });
      const before = old.get(node.id)?.props ?? element.ToJSON().props;
      for (const name of new Set([
        ...Object.keys(before),
        ...Object.keys(node.props),
      ])) {
        if (name === "Columns" && element instanceof Table) {
          if (!equal(before.Columns, node.props.Columns)) {
            const table = element,
              existing = new Map(
                table.Columns.ToArray().map((column) => [column.Id, column]),
              );
            const columns = (node.props.Columns ?? []).map(
              (column: DocumentNode) => {
                const instance = existing.get(column.id);
                if (!instance) return elementFromJSON(column) as any;
                const previous = instance.ToJSON().props;
                for (const key of new Set([
                  ...Object.keys(previous),
                  ...Object.keys(column.props),
                ])) {
                  if (!Object.hasOwn(column.props, key))
                    attempt(() => instance.ClearValue(key));
                  else if (!equal(previous[key], column.props[key]))
                    attempt(() => instance.SetValue(key, column.props[key]));
                }
                return instance;
              },
            );
            for (const column of table.Columns.ToArray())
              if (!columns.includes(column))
                attempt(() => {
                  table.Columns.Remove(column);
                });
            columns.forEach((column: any, index: number) => {
              if (table.Columns.at(index) !== column) {
                attempt(() => {
                  column._collection?.Remove(column);
                });
                attempt(() => table.Columns.Insert(index, column));
              }
            });
          }
          continue;
        }
        if (!Object.hasOwn(node.props, name))
          attempt(() => element!.ClearValue(name));
        else if (!equal(before[name], node.props[name]))
          attempt(() => element!.SetValue(name, copy(node.props[name])));
      }
      if (element instanceof Run && element.Text !== (node.text ?? "")) {
        const run = element;
        attempt(() => {
          run.Text = node.text ?? "";
        });
      }
      const collection =
        (element as any)._getChildCollection?.() ??
        ["Blocks", "Inlines", "ListItems", "RowGroups", "Rows", "Cells"]
          .map((name) => (element as any)[name])
          .find((value) => value?.Owner === element);
      if (collection) {
        const children = (node.children ?? []).map(reconcile);
        for (let i = 0; i < children.length; i++) {
          const child = children[i];
          if (collection.at(i) === child) continue;
          attempt(() => {
            child._collection?.Remove(child);
          });
          attempt(() => collection.Insert(i, child));
        }
        while (collection.Count > children.length) {
          const before = collection.Count;
          attempt(() => collection.RemoveAt(collection.Count - 1));
          if (collection.Count === before) break;
        }
      } else if (node.children?.length)
        throw new TypeError(
          `No child collection is available for ${element.Type}.`,
        );
      return element;
    };
    reconcile(normalized);
  } finally {
    attempt(() => document.EndChange());
  }
  if (!equal(document.ToJSON(), normalized))
    throw new PatchConflictError(
      "Live reconciliation could not commit the validated target document.",
    );
  if (observerErrors.length) throw new DocumentObserverError(observerErrors);
}

export function ApplyDocumentPatch(
  document: FlowDocument,
  patch: DocumentPatch,
): void {
  const target = ApplyPatchToJSON(document.ToJSON(), patch);
  ReconcileDocument(document, target);
}

export function PatchByteLength(patch: DocumentPatch): number {
  return new TextEncoder().encode(JSON.stringify(patch)).length;
}
