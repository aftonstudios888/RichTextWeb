/** Optional React entry point. Importing core/web does not import React. */
import {
  createElement,
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { CSSProperties, ForwardedRef, HTMLAttributes } from "react";
import { FlowDocument } from "./model.js";
import { RichTextBox, registerRichTextWeb } from "./control.js";
import type { TextSelection } from "./engine.js";
import type { ObservableObject } from "./mvvm.js";

export interface RichTextEditorProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children" | "onChange" | "onSelect" | "defaultValue"
> {
  /** Shared mutable document model. Change its identity to replace the editor document. */
  document?: FlowDocument;
  /** Used only when this mounted control is first initialized. */
  defaultDocument?: FlowDocument;
  readOnly?: boolean;
  acceptsTab?: boolean;
  zoom?: number;
  viewMode?: "page" | "continuous";
  style?: CSSProperties;
  onDocumentChange?: (document: FlowDocument, event: CustomEvent) => void;
  onSelectionChange?: (selection: TextSelection, event: CustomEvent) => void;
  onCommandStateChange?: (
    state: { canUndo: boolean; canRedo: boolean; isReadOnly: boolean },
    event: CustomEvent,
  ) => void;
  onReady?: (editor: RichTextBox) => void;
}

function assignRef<T>(ref: ForwardedRef<T>, value: T | null): void {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

/** Works with React 18 and 19; ref exposes the actual RichTextBox control. */
export const RichTextEditor = forwardRef<RichTextBox, RichTextEditorProps>(
  function RichTextEditor(props, forwardedRef) {
    const {
      document,
      defaultDocument,
      readOnly = false,
      acceptsTab = false,
      zoom = 1,
      viewMode = "page",
      onDocumentChange,
      onSelectionChange,
      onCommandStateChange,
      onReady,
      ...attributes
    } = props;
    const [editor, setEditor] = useState<RichTextBox | null>(null);
    const initialized = useRef<RichTextBox | null>(null);
    const assigningDocument = useRef(false);
    const callbacks = useRef({
      onDocumentChange,
      onSelectionChange,
      onCommandStateChange,
      onReady,
    });
    callbacks.current = {
      onDocumentChange,
      onSelectionChange,
      onCommandStateChange,
      onReady,
    };
    const attach = useCallback(
      (element: HTMLElement | null) => {
        if (element) registerRichTextWeb();
        const control = element as RichTextBox | null;
        assignRef(forwardedRef, control);
        setEditor(control);
      },
      [forwardedRef],
    );

    useEffect(() => {
      if (!editor) return;
      const changed = (event: Event) => {
        if (!assigningDocument.current)
          callbacks.current.onDocumentChange?.(
            editor.Document,
            event as CustomEvent,
          );
      };
      const selected = (event: Event) =>
        callbacks.current.onSelectionChange?.(
          editor.Selection,
          event as CustomEvent,
        );
      const state = (event: Event) =>
        callbacks.current.onCommandStateChange?.(
          (event as CustomEvent).detail,
          event as CustomEvent,
        );
      editor.addEventListener("documentchange", changed);
      editor.addEventListener("selectionchange", selected);
      editor.addEventListener("commandstatechange", state);
      return () => {
        editor.removeEventListener("documentchange", changed);
        editor.removeEventListener("selectionchange", selected);
        editor.removeEventListener("commandstatechange", state);
      };
    }, [editor]);

    useEffect(() => {
      if (!editor) return;
      assigningDocument.current = true;
      try {
        if (document && editor.Document !== document)
          editor.Document = document;
        else if (!document && initialized.current !== editor && defaultDocument)
          editor.Document = defaultDocument;
        editor.IsReadOnly = readOnly;
        editor.AcceptsTab = acceptsTab;
        editor.Zoom = zoom;
        editor.ViewMode = viewMode;
        if (initialized.current !== editor) {
          initialized.current = editor;
          callbacks.current.onReady?.(editor);
        }
      } finally {
        assigningDocument.current = false;
      }
    }, [
      editor,
      document,
      defaultDocument,
      readOnly,
      acceptsTab,
      zoom,
      viewMode,
    ]);

    return createElement("rich-text-box", { ...attributes, ref: attach });
  },
);

/** Subscribes React to a mutable FlowDocument using a stable numeric snapshot. */
export function useDocumentRevision(document: FlowDocument): number {
  const subscribe = useCallback(
    (notify: () => void) => {
      const subscription = document.Changed.Subscribe(notify);
      return () => subscription.Dispose();
    },
    [document],
  );
  const snapshot = useCallback(() => document.Revision, [document]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Creates one model per component instance and rerenders on document mutations. */
export function useFlowDocument(
  initial?: FlowDocument | (() => FlowDocument),
): FlowDocument {
  const [document] = useState(() =>
    typeof initial === "function" ? initial() : (initial ?? new FlowDocument()),
  );
  useDocumentRevision(document);
  return document;
}

/** Select an observable property; object values should be replaced to notify React. */
export function useObservableProperty<T>(
  source: ObservableObject,
  propertyName: string,
  defaultValue?: T,
): T {
  const subscribe = useCallback(
    (notify: () => void) => {
      const subscription = source.PropertyChanged.Subscribe((args) => {
        if (!args.PropertyName || args.PropertyName === propertyName) notify();
      });
      return () => subscription.Dispose();
    },
    [source, propertyName],
  );
  const snapshot = useCallback(
    () => source.GetProperty<T>(propertyName, defaultValue),
    [source, propertyName, defaultValue],
  );
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
