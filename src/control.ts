import { FlowDocument, type DocumentNode, type TextPointer } from "./model.js";
import { RichTextEngine, type TextSelection } from "./engine.js";
import { fromHTML, toHTML, fromText } from "./formats.js";
import {
  applyDocumentStyle,
  renderDocument,
  thicknessCSS,
  type RenderResult,
} from "./control-renderer.js";

const HTMLElementBase: typeof HTMLElement =
  (globalThis as any).HTMLElement ?? class extends EventTarget {};
export type RichTextViewMode = "page" | "continuous";
export interface DocumentChangeDetail {
  document: FlowDocument;
  engine: RichTextEngine;
  revision: number;
}
export interface SelectionChangeDetail {
  selection: TextSelection;
  start: number;
  end: number;
  text: string;
}
export interface CommandStateChangeDetail {
  canUndo: boolean;
  canRedo: boolean;
  isReadOnly: boolean;
}

const stylesheet = `
:host{display:block;min-width:0;min-height:160px;--rt-accent:#2463d5;--rt-ink:#182236;--rt-paper:#fff;--rt-workspace:#edf0f5;--rt-border:#d7dce5;color:var(--rt-ink);font-family:Segoe UI,Inter,system-ui,sans-serif;color-scheme:light dark;contain:layout style}
*{box-sizing:border-box}.viewport{height:100%;min-height:inherit;overflow:auto;background:var(--rt-workspace);padding:28px;scrollbar-gutter:stable;position:relative;overscroll-behavior:contain}.surface{box-sizing:border-box;position:relative;outline:none;margin:0 auto;width:var(--rt-page-width,794px);min-height:var(--rt-page-height,1123px);padding:var(--rt-page-padding,72px);background:var(--rt-paper);color:var(--rt-ink);box-shadow:0 2px 14px #17233a13;border:1px solid var(--rt-border);font:16px/1.5 Georgia,Cambria,serif;white-space:pre-wrap;overflow-wrap:break-word;word-break:normal;caret-color:var(--rt-accent);zoom:var(--rt-zoom,1);tab-size:4}
.surface:focus-visible{outline:2px solid color-mix(in srgb,var(--rt-accent) 28%,transparent);outline-offset:3px}.viewport.continuous{padding:0;background:var(--rt-paper)}.continuous .surface{width:100%;min-height:100%;padding:24px;border:0;box-shadow:none}.surface:empty::before,.surface[data-empty=true]::before{content:attr(data-placeholder);position:absolute;color:#818898;pointer-events:none;font-family:Segoe UI,system-ui,sans-serif}.surface p{margin:0 0 .7em;min-height:1.5em}.surface p:last-child{margin-bottom:0}.surface h1,.surface h2,.surface h3,.surface h4,.surface h5,.surface h6{font-family:Segoe UI,system-ui,sans-serif;line-height:1.2;margin:1em 0 .45em;break-after:avoid}.surface h1{font-size:2em}.surface h2{font-size:1.5em}.surface h3{font-size:1.2em}.surface h1:first-child,.surface h2:first-child{margin-top:0}.surface a{color:var(--rt-accent);text-decoration:underline;cursor:text}.surface [contenteditable=false]{cursor:default}.surface table{border-collapse:collapse;margin:.75em 0;max-width:100%;width:100%;table-layout:fixed}.surface td,.surface th{border:1px solid #b8c0ce;padding:8px 10px;vertical-align:top;min-width:24px}.surface th{background:color-mix(in srgb,var(--rt-accent) 8%,var(--rt-paper));font-weight:600}.surface td p,.surface th p{margin:0}.surface ul,.surface ol{padding-inline-start:1.7em;margin:.5em 0}.surface li>p{margin-bottom:.25em}.surface img{max-width:100%;object-fit:contain;vertical-align:middle}.surface .rt-embedded{display:inline-block;border:1px dashed var(--rt-border);padding:4px 8px;border-radius:3px;font-family:Segoe UI,system-ui,sans-serif;font-size:.85em}.surface div.rt-embedded{display:block}.surface ::selection{background:color-mix(in srgb,var(--rt-accent) 25%,transparent)}
:host([theme=dark]){--rt-ink:#e7e9ef;--rt-paper:#242730;--rt-workspace:#1a1d24;--rt-border:#3a4050}:host([theme=light]){color-scheme:light}:host([theme=dark]){color-scheme:dark}@media(prefers-color-scheme:dark){:host(:not([theme=light])){--rt-ink:#e7e9ef;--rt-paper:#242730;--rt-workspace:#1a1d24;--rt-border:#3a4050}}@media(max-width:640px){.viewport{padding:12px}.surface{padding:32px;width:max(100%,var(--rt-page-width,794px))}.continuous .surface{width:100%;padding:18px}}@media print{:host{display:block;height:auto!important;contain:none;--rt-paper:white;--rt-ink:black}.viewport{height:auto!important;overflow:visible;padding:0;background:white}.surface,.continuous .surface{width:auto;min-height:0;margin:0;padding:0;border:0;box-shadow:none;zoom:1!important;outline:none!important}.surface td,.surface th{break-inside:avoid}.surface a{color:inherit}}`;

/** A model-backed, framework-independent rich text editing control. */
export class RichTextBox extends HTMLElementBase {
  static get observedAttributes(): string[] {
    return [
      "readonly",
      "accepts-tab",
      "zoom",
      "view-mode",
      "placeholder",
      "aria-label",
      "spellcheck",
    ];
  }
  private _engine = new RichTextEngine();
  private _editor: HTMLDivElement | null = null;
  private _viewport: HTMLDivElement | null = null;
  private _render: RenderResult | null = null;
  private _readOnly = false;
  private _acceptsTab = false;
  private _zoom = 1;
  private _viewMode: RichTextViewMode = "page";
  private _composing = false;
  private _compositionBase: string | null = null;
  private _suspendRender = false;
  private _restoringSelection = false;
  private _backwardSelection = false;
  private _lastDOMHTML = "";
  private _subscriptions: Array<{ Dispose(): void }> = [];
  private _connected = false;
  private _disposed = false;
  private _documentSelectionChanged = (event: Event) => {
    // The public custom selectionchange event also bubbles to Document. It must
    // not be mistaken for the browser's native selection notification.
    if (event.target === this.ownerDocument) this.syncSelection();
  };

  constructor(
    options: { readOnly?: boolean; viewMode?: RichTextViewMode } = {},
  ) {
    super();
    this._readOnly = Boolean(options.readOnly);
    this._viewMode = options.viewMode || "page";
    this._subscriptions.push(
      this._engine.Changed.Subscribe(() => {
        if (!this._composing && !this._suspendRender) this.Refresh();
        this.emit("documentchange", {
          document: this.Document,
          engine: this.Engine,
          revision: this.Document.Revision,
        } satisfies DocumentChangeDetail);
        this.emitCommandState();
      }),
    );
    this._subscriptions.push(
      this._engine.SelectionChanged.Subscribe(() => {
        const selection = this.Selection;
        if (!this._restoringSelection) this.restoreSelection();
        this.emit("selectionchange", {
          selection,
          start: selection.Start.Offset,
          end: selection.End.Offset,
          text: selection.Text,
        } satisfies SelectionChangeDetail);
        this.emitCommandState();
      }),
    );
    if (typeof this.attachShadow !== "function") return;
    const shadow = this.attachShadow({ mode: "open", delegatesFocus: true });
    const style = this.ownerDocument.createElement("style");
    style.textContent = stylesheet;
    const viewport = this.ownerDocument.createElement("div");
    viewport.className = "viewport";
    viewport.setAttribute("part", "viewport");
    const editor = this.ownerDocument.createElement("div");
    editor.className = "surface";
    editor.setAttribute("part", "editor");
    editor.setAttribute("role", "textbox");
    editor.setAttribute("aria-multiline", "true");
    editor.tabIndex = 0;
    viewport.append(editor);
    shadow.append(style, viewport);
    this._editor = editor;
    this._viewport = viewport;
    editor.addEventListener("beforeinput", (event) =>
      this.beforeInput(event as InputEvent),
    );
    editor.addEventListener("input", () => {
      if (!this._composing) this.reconcileNativeInput();
    });
    editor.addEventListener("compositionstart", () => {
      this.syncSelection();
      this._compositionBase = this.Document.Text;
      this._composing = true;
    });
    editor.addEventListener("compositionend", () => {
      this._composing = false;
      queueMicrotask(() => this.reconcileNativeInput());
    });
    editor.addEventListener("keydown", (event) => this.keyDown(event));
    editor.addEventListener("keyup", () => this.syncSelection());
    editor.addEventListener("pointerup", () => this.syncSelection());
    editor.addEventListener("focus", () => this.restoreSelection());
    editor.addEventListener("copy", (event) => this.copy(event, false));
    editor.addEventListener("cut", (event) => this.copy(event, true));
    editor.addEventListener("paste", (event) => this.paste(event));
    editor.addEventListener("dragover", (event) => {
      if (
        !this.IsReadOnly &&
        event.dataTransfer?.types.some(
          (type) => type === "text/plain" || type === "text/html",
        )
      ) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }
    });
    editor.addEventListener("drop", (event) => this.drop(event));
    editor.addEventListener("click", (event) => {
      const link = (event.target as Element)?.closest?.("a");
      if (link) {
        event.preventDefault();
        if (event.ctrlKey || event.metaKey || this.IsReadOnly)
          this.emit("linkactivate", {
            uri: link.getAttribute("href"),
            originalEvent: event,
          });
      }
    });
  }

  connectedCallback(): void {
    if (this._disposed || this._connected) return;
    this._connected = true;
    this.ownerDocument.addEventListener(
      "selectionchange",
      this._documentSelectionChanged,
    );
    this.updateAttributes();
    this.Refresh();
  }

  disconnectedCallback(): void {
    this._connected = false;
    this.ownerDocument?.removeEventListener(
      "selectionchange",
      this._documentSelectionChanged,
    );
  }

  attributeChangedCallback(
    name: string,
    _old: string | null,
    value: string | null,
  ): void {
    switch (name) {
      case "readonly":
        this._readOnly = value !== null && value !== "false";
        break;
      case "accepts-tab":
        this._acceptsTab = value !== null && value !== "false";
        break;
      case "zoom": {
        const parsed = Number(value);
        if (value !== null && Number.isFinite(parsed) && parsed > 0)
          this._zoom = Math.max(0.25, Math.min(4, parsed));
        break;
      }
      case "view-mode":
        this._viewMode = value === "continuous" ? "continuous" : "page";
        break;
    }
    this.updateAttributes();
  }

  get Document(): FlowDocument {
    return this._engine.Document;
  }
  set Document(value: FlowDocument) {
    if (!(value instanceof FlowDocument))
      throw new TypeError("Document must be a FlowDocument.");
    this._engine.SetDocument(value);
    this.Refresh();
  }
  get Engine(): RichTextEngine {
    return this._engine;
  }
  get Selection(): TextSelection {
    return this._engine.Selection;
  }
  get CaretPosition(): TextPointer {
    return this.Selection.End;
  }
  set CaretPosition(value: TextPointer) {
    if (value.Document !== this.Document)
      throw new Error("CaretPosition belongs to a different document.");
    this.Select(value.Offset, value.Offset);
  }
  get IsReadOnly(): boolean {
    return this._readOnly;
  }
  set IsReadOnly(value: boolean) {
    this._readOnly = Boolean(value);
    this.reflectBoolean("readonly", this._readOnly);
    this.updateAttributes();
    this.emitCommandState();
  }
  get AcceptsTab(): boolean {
    return this._acceptsTab;
  }
  set AcceptsTab(value: boolean) {
    this._acceptsTab = Boolean(value);
    this.reflectBoolean("accepts-tab", this._acceptsTab);
  }
  get Zoom(): number {
    return this._zoom;
  }
  set Zoom(value: number) {
    if (!Number.isFinite(value) || value <= 0)
      throw new RangeError("Zoom must be a positive finite number.");
    this._zoom = Math.max(0.25, Math.min(4, value));
    this.setAttribute?.("zoom", String(this._zoom));
    this.updateAttributes();
  }
  get ViewMode(): RichTextViewMode {
    return this._viewMode;
  }
  set ViewMode(value: RichTextViewMode) {
    if (value !== "page" && value !== "continuous")
      throw new TypeError("ViewMode must be page or continuous.");
    this._viewMode = value;
    this.setAttribute?.("view-mode", value);
    this.updateAttributes();
  }
  get CanUndo(): boolean {
    return !this.IsReadOnly && this._engine.CanUndo;
  }
  get CanRedo(): boolean {
    return !this.IsReadOnly && this._engine.CanRedo;
  }
  get Text(): string {
    return this.Document.Text;
  }
  set Text(value: string) {
    this.Document = fromText(String(value));
  }
  get value(): string {
    return this.Text;
  }
  set value(value: string) {
    this.Text = value;
  }
  get document(): FlowDocument {
    return this.Document;
  }
  set document(value: FlowDocument) {
    this.Document = value;
  }
  get readOnly(): boolean {
    return this.IsReadOnly;
  }
  set readOnly(value: boolean) {
    this.IsReadOnly = value;
  }
  get acceptsTab(): boolean {
    return this.AcceptsTab;
  }
  set acceptsTab(value: boolean) {
    this.AcceptsTab = value;
  }
  get zoom(): number {
    return this.Zoom;
  }
  set zoom(value: number) {
    this.Zoom = value;
  }
  get viewMode(): RichTextViewMode {
    return this.ViewMode;
  }
  set viewMode(value: RichTextViewMode) {
    this.ViewMode = value;
  }

  Focus(): void {
    this._editor?.focus({ preventScroll: true });
    this.restoreSelection();
  }
  Select(start: number, end = start): void {
    this._engine.Select(start, end);
    this.restoreSelection();
  }
  SelectAll(): void {
    this.Select(0, this.Document.Text.length);
  }
  Undo(): void {
    if (!this.IsReadOnly) {
      this._engine.Undo();
      this.restoreSelection();
    }
  }
  Redo(): void {
    if (!this.IsReadOnly) {
      this._engine.Redo();
      this.restoreSelection();
    }
  }
  AppendText(text: string): void {
    this._engine.Select(this.Document.Text.length, this.Document.Text.length);
    this._engine.InsertText(String(text));
    this.restoreSelection();
  }
  BeginChange(): void {
    this._engine.BeginChange();
  }
  EndChange(): void {
    this._engine.EndChange();
  }
  DeclareChangeBlock(): { Dispose(): void } {
    this.BeginChange();
    let disposed = false;
    return {
      Dispose: () => {
        if (!disposed) {
          disposed = true;
          this.EndChange();
        }
      },
    };
  }
  ScrollToHome(): void {
    if (this._viewport) this._viewport.scrollTop = 0;
  }
  ScrollToEnd(): void {
    if (this._viewport) this._viewport.scrollTop = this._viewport.scrollHeight;
  }

  Execute(command: string, parameter?: any): unknown {
    const name = command.replace(
      /^(EditingCommands|ApplicationCommands)\./,
      "",
    );
    const normalized = name.replace(/[\s_-]/g, "").toLowerCase();
    if (normalized === "selectall") {
      this.SelectAll();
      return;
    }
    if (normalized === "print") {
      this.Print();
      return;
    }
    if (this.IsReadOnly && normalized !== "find") return false;
    this.syncSelection();
    const result = this._engine.Execute(name, parameter);
    this.restoreSelection();
    return result;
  }

  /** Import rich HTML at the selection using the serializer's safe allowlist. */
  PasteHTML(html: string): void {
    if (this.IsReadOnly) return;
    const fragment = fromHTML(html);
    this._engine.InsertFragment(fragment.ToJSON().children || []);
    this.restoreSelection();
  }

  Refresh(): void {
    if (!this._editor || this._composing || this._suspendRender) return;
    const hadFocus = this.shadowRoot?.activeElement === this._editor;
    const scrollTop = this._viewport?.scrollTop || 0;
    const scrollLeft = this._viewport?.scrollLeft || 0;
    const json = this.Document.ToJSON();
    this._render = renderDocument(json, this.ownerDocument);
    this._editor.replaceChildren(this._render.fragment);
    applyDocumentStyle(this._editor, json.props || {});
    const props = json.props || {};
    if (Number.isFinite(Number(props.PageWidth)) && Number(props.PageWidth) > 0)
      this._editor.style.setProperty(
        "--rt-page-width",
        `${Number(props.PageWidth)}px`,
      );
    if (
      Number.isFinite(Number(props.PageHeight)) &&
      Number(props.PageHeight) > 0
    )
      this._editor.style.setProperty(
        "--rt-page-height",
        `${Number(props.PageHeight)}px`,
      );
    const padding = thicknessCSS(props.PagePadding);
    if (padding) this._editor.style.setProperty("--rt-page-padding", padding);
    this._editor.dataset.empty = this.Document.Text.length ? "false" : "true";
    this.updateAttributes();
    this._lastDOMHTML = this._editor.innerHTML;
    if (hadFocus) this.restoreSelection();
    if (this._viewport) {
      this._viewport.scrollTop = scrollTop;
      this._viewport.scrollLeft = scrollLeft;
    }
  }

  /** Open a printable browser view. Invoke from a user gesture to allow its window. */
  Print(): void {
    const view = this.ownerDocument?.defaultView;
    if (!view) throw new Error("Printing requires a browser.");
    const popup = view.open("", "_blank", "popup,width=900,height=900");
    if (!popup)
      throw new Error(
        "The browser blocked the print window. Invoke Print from a user gesture.",
      );
    const html = toHTML(this.Document);
    popup.document.open();
    popup.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>Print document</title><style>@page{margin:18mm}body{font:12pt/1.5 Georgia,serif;color:#000;background:#fff}p{margin:0 0 .7em}table{width:100%;border-collapse:collapse}td,th{border:1px solid #aeb5bf;padding:6pt}img{max-width:100%}h1,h2,h3{break-after:avoid}tr{break-inside:avoid}</style></head><body>${html}</body></html>`,
    );
    popup.document.close();
    popup.opener = null;
    const ready = () => {
      popup.focus();
      popup.print();
    };
    if (popup.document.readyState === "complete") ready();
    else popup.addEventListener("load", ready, { once: true });
  }

  Dispose(): void {
    this.disconnectedCallback();
    for (const subscription of this._subscriptions.splice(0))
      subscription.Dispose();
    this._engine.Dispose();
    this._disposed = true;
  }

  private reflectBoolean(name: string, value: boolean): void {
    if (typeof this.toggleAttribute === "function")
      this.toggleAttribute(name, value);
  }
  private emit(name: string, detail: unknown): void {
    if (typeof CustomEvent !== "undefined")
      this.dispatchEvent(
        new CustomEvent(name, { detail, bubbles: true, composed: true }),
      );
  }
  private emitCommandState(): void {
    this.emit("commandstatechange", {
      canUndo: this.CanUndo,
      canRedo: this.CanRedo,
      isReadOnly: this.IsReadOnly,
    } satisfies CommandStateChangeDetail);
  }
  private updateAttributes(): void {
    if (!this._editor || !this._viewport) return;
    this._editor.contentEditable = String(!this.IsReadOnly);
    this._editor.setAttribute("aria-readonly", String(this.IsReadOnly));
    this._editor.setAttribute(
      "aria-label",
      this.getAttribute("aria-label") || "Rich text document",
    );
    this._editor.setAttribute(
      "aria-placeholder",
      this.getAttribute("placeholder") || "",
    );
    this._editor.dataset.placeholder = this.getAttribute("placeholder") || "";
    this._editor.spellcheck = this.getAttribute("spellcheck") !== "false";
    this._editor.style.setProperty("--rt-zoom", String(this._zoom));
    this._viewport.classList.toggle(
      "continuous",
      this._viewMode === "continuous",
    );
  }

  private nativeSelection(): Selection | null {
    const shadow = this.shadowRoot as
      (ShadowRoot & { getSelection?: () => Selection | null }) | null;
    return (
      shadow?.getSelection?.() || this.ownerDocument?.getSelection() || null
    );
  }

  private nativeRange(): {
    startContainer: Node;
    startOffset: number;
    endContainer: Node;
    endOffset: number;
    backward?: boolean;
  } | null {
    const selection = this.nativeSelection();
    if (!selection || !this._editor) return null;
    if (
      selection.anchorNode &&
      selection.focusNode &&
      this._editor.contains(selection.anchorNode) &&
      this._editor.contains(selection.focusNode)
    ) {
      const range = selection.rangeCount ? selection.getRangeAt(0) : null;
      if (range && this._editor.contains(range.startContainer))
        return {
          startContainer: range.startContainer,
          startOffset: range.startOffset,
          endContainer: range.endContainer,
          endOffset: range.endOffset,
          backward:
            selection.anchorNode === range.endContainer &&
            selection.anchorOffset === range.endOffset &&
            !selection.isCollapsed,
        };
      return {
        startContainer: selection.anchorNode,
        startOffset: selection.anchorOffset,
        endContainer: selection.focusNode,
        endOffset: selection.focusOffset,
      };
    }
    const composed = (selection as any).getComposedRanges?.({
      shadowRoots: [this.shadowRoot],
    })?.[0] as StaticRange | undefined;
    if (
      composed &&
      this._editor.contains(composed.startContainer) &&
      this._editor.contains(composed.endContainer)
    )
      return composed;
    return null;
  }

  private offsetFromDOM(node: Node, offset: number): number {
    if (!this._render || !this._editor) return 0;
    const positions = this._render.positions;
    const own = positions.get(node);
    if (node.nodeType === 3 && own)
      return (
        own.start + Math.max(0, Math.min(offset, node.textContent?.length || 0))
      );
    if (offset < node.childNodes.length) {
      const child = node.childNodes[offset];
      const position = positions.get(child);
      if (position) return position.start;
    }
    if (offset > 0 && node.childNodes.length) {
      const child =
        node.childNodes[Math.min(offset, node.childNodes.length) - 1];
      const position = positions.get(child);
      if (position) return position.end;
    }
    if (own) return offset > 0 ? own.end : own.start;
    return node === this._editor && offset > 0 ? this.Document.Text.length : 0;
  }

  private syncSelection(): void {
    if (this._restoringSelection || this._composing || this._suspendRender)
      return;
    if (!this._editor || this.shadowRoot?.activeElement !== this._editor)
      return;
    const range = this.nativeRange();
    if (!range) return;
    this._backwardSelection = Boolean(range.backward);
    const start = this.offsetFromDOM(range.startContainer, range.startOffset);
    const end = this.offsetFromDOM(range.endContainer, range.endOffset);
    if (
      start !== this.Selection.Start.Offset ||
      end !== this.Selection.End.Offset
    )
      this._engine.Select(start, end);
  }

  private domPoint(offset: number): { node: Node; offset: number } | null {
    if (!this._render || !this._editor) return null;
    const at = Math.max(0, Math.min(offset, this.Document.Text.length));
    // Prefer a text leaf on the requested side of a block separator.
    const leaf = this._render.leaves.find(
      (item) => !item.atomic && at >= item.start && at <= item.end,
    );
    if (leaf) return { node: leaf.node, offset: at - leaf.start };
    const atomic = this._render.leaves.find(
      (item) => item.atomic && at >= item.start && at <= item.end,
    );
    if (atomic?.node.parentNode)
      return {
        node: atomic.node.parentNode,
        offset:
          Array.prototype.indexOf.call(
            atomic.node.parentNode.childNodes,
            atomic.node,
          ) + (at > atomic.start ? 1 : 0),
      };
    const paragraph =
      this._render.paragraphs.find(
        (item) => at >= item.start && at <= item.end,
      ) ||
      this._render.paragraphs.find((item) => item.start > at) ||
      this._render.paragraphs.at(-1);
    if (paragraph)
      return {
        node: paragraph.node,
        offset: at <= paragraph.start ? 0 : paragraph.node.childNodes.length,
      };
    return { node: this._editor, offset: 0 };
  }

  private restoreSelection(): void {
    if (
      !this._editor ||
      this._composing ||
      this._suspendRender ||
      this.shadowRoot?.activeElement !== this._editor
    )
      return;
    const selection = this.nativeSelection();
    const start = this.domPoint(this.Selection.Start.Offset),
      end = this.domPoint(this.Selection.End.Offset);
    if (!selection || !start || !end) return;
    this._restoringSelection = true;
    try {
      if (this._backwardSelection && selection.setBaseAndExtent)
        selection.setBaseAndExtent(
          end.node,
          end.offset,
          start.node,
          start.offset,
        );
      else {
        const range = this.ownerDocument.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    } finally {
      this._restoringSelection = false;
    }
  }

  private beforeInput(event: InputEvent): void {
    if (this.IsReadOnly) {
      event.preventDefault();
      return;
    }
    if (
      this._composing ||
      event.isComposing ||
      event.inputType === "insertCompositionText" ||
      !event.cancelable
    )
      return;
    this.syncSelection();
    let handled = true;
    switch (event.inputType) {
      case "insertText":
      case "insertReplacementText":
        this._engine.InsertText(event.data || "");
        break;
      case "insertParagraph":
        this._engine.InsertParagraph();
        break;
      case "insertLineBreak":
        this._engine.Execute("InsertLineBreak");
        break;
      case "deleteContentBackward":
        this._engine.DeleteBackward();
        break;
      case "deleteContentForward":
        this._engine.DeleteForward();
        break;
      case "deleteWordBackward":
        this.deleteWord(-1);
        break;
      case "deleteWordForward":
        this.deleteWord(1);
        break;
      case "deleteSoftLineBackward":
      case "deleteHardLineBackward":
        this.deleteLine(-1);
        break;
      case "deleteSoftLineForward":
      case "deleteHardLineForward":
        this.deleteLine(1);
        break;
      case "historyUndo":
        this._engine.Undo();
        break;
      case "historyRedo":
        this._engine.Redo();
        break;
      case "formatBold":
        this._engine.ToggleFormat("FontWeight", "Bold", "Normal");
        break;
      case "formatItalic":
        this._engine.ToggleFormat("FontStyle", "Italic", "Normal");
        break;
      case "formatUnderline":
        this._engine.ToggleFormat("TextDecorations", "Underline", "None");
        break;
      case "formatStrikeThrough":
        this._engine.ToggleFormat("TextDecorations", "Strikethrough", "None");
        break;
      case "formatJustifyCenter":
        this._engine.SetParagraphProperty("TextAlignment", "Center");
        break;
      case "formatJustifyLeft":
        this._engine.SetParagraphProperty("TextAlignment", "Left");
        break;
      case "formatJustifyRight":
        this._engine.SetParagraphProperty("TextAlignment", "Right");
        break;
      case "formatJustifyFull":
        this._engine.SetParagraphProperty("TextAlignment", "Justify");
        break;
      case "insertFromPaste":
      case "insertFromDrop": {
        if (event.dataTransfer) this.insertTransfer(event.dataTransfer);
        else handled = false;
        break;
      }
      default:
        handled = false;
    }
    if (handled) {
      event.preventDefault();
      this.restoreSelection();
    }
  }

  private deleteWord(direction: number): void {
    let start = this.Selection.Start.Offset,
      end = this.Selection.End.Offset;
    if (start === end) {
      const text = this.Document.Text;
      if (direction < 0)
        start -=
          text.slice(0, start).match(/(?:\s+|[^\s]+\s*)$/u)?.[0].length || 0;
      else end += text.slice(end).match(/^(?:\s+|[^\s]+\s*)/u)?.[0].length || 0;
    }
    this._engine.Select(start, end);
    this._engine.InsertText("");
  }
  private deleteLine(direction: number): void {
    let start = this.Selection.Start.Offset,
      end = this.Selection.End.Offset;
    if (start === end) {
      const text = this.Document.Text;
      if (direction < 0)
        start = text.lastIndexOf("\n", Math.max(-1, start - 1)) + 1;
      else {
        const next = text.indexOf("\n", end);
        end = next < 0 ? text.length : next;
      }
    }
    this._engine.Select(start, end);
    this._engine.InsertText("");
  }

  private keyDown(event: KeyboardEvent): void {
    if (event.isComposing || this._composing) return;
    const modifier = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (modifier && !event.altKey) {
      if (key === "a") {
        event.preventDefault();
        this.SelectAll();
        return;
      }
      if (this.IsReadOnly) return;
      if (key === "z") {
        event.preventDefault();
        event.shiftKey ? this.Redo() : this.Undo();
        return;
      }
      if (key === "y") {
        event.preventDefault();
        this.Redo();
        return;
      }
      const formats: Record<string, [string, string, string]> = {
        b: ["FontWeight", "Bold", "Normal"],
        i: ["FontStyle", "Italic", "Normal"],
        u: ["TextDecorations", "Underline", "None"],
      };
      if (!event.shiftKey && formats[key]) {
        event.preventDefault();
        this.syncSelection();
        this._engine.ToggleFormat(...formats[key]);
        this.restoreSelection();
        return;
      }
    }
    if (
      event.key === "Tab" &&
      this.AcceptsTab &&
      !this.IsReadOnly &&
      !modifier &&
      !event.altKey &&
      !event.shiftKey
    ) {
      event.preventDefault();
      this.syncSelection();
      this._engine.InsertText("\t");
      this.restoreSelection();
    }
  }

  private copy(event: ClipboardEvent, cut: boolean): void {
    this.syncSelection();
    if (this.Selection.IsEmpty || !event.clipboardData) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", this.Selection.Text);
    event.clipboardData.setData(
      "text/html",
      toHTML(this._engine.GetSelectedFragment()),
    );
    if (cut && !this.IsReadOnly) {
      this._engine.InsertText("");
      this.restoreSelection();
    }
  }

  private paste(event: ClipboardEvent): void {
    if (this.IsReadOnly) {
      event.preventDefault();
      return;
    }
    if (!event.clipboardData) return;
    event.preventDefault();
    this.syncSelection();
    this.insertTransfer(event.clipboardData);
  }

  private insertTransfer(transfer: DataTransfer): void {
    const html = transfer.getData("text/html");
    const text = transfer.getData("text/plain");
    if (html) this.PasteHTML(html);
    else if (text) this._engine.InsertText(text);
    this.restoreSelection();
  }

  private drop(event: DragEvent): void {
    if (this.IsReadOnly || !event.dataTransfer) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    const document = this.ownerDocument as Document & {
      caretPositionFromPoint?: (
        x: number,
        y: number,
        options?: any,
      ) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    const position = document.caretPositionFromPoint?.(
      event.clientX,
      event.clientY,
      { shadowRoots: [this.shadowRoot] },
    );
    const range = !position
      ? document.caretRangeFromPoint?.(event.clientX, event.clientY)
      : undefined;
    const node = position?.offsetNode || range?.startContainer;
    const offset = position?.offset ?? range?.startOffset ?? 0;
    if (node && this._editor?.contains(node))
      this._engine.Select(
        this.offsetFromDOM(node, offset),
        this.offsetFromDOM(node, offset),
      );
    this.Focus();
    this.insertTransfer(event.dataTransfer);
  }

  /** Native IME, spell-check and browser input fallback commit as one undoable change. */
  private reconcileNativeInput(): void {
    if (!this._editor || this._composing) return;
    if (this._editor.innerHTML === this._lastDOMHTML) {
      this._compositionBase = null;
      return;
    }
    if (this.IsReadOnly) {
      this.Refresh();
      return;
    }
    const native = this.nativeRange();
    const caret = native
      ? this.nativeTextOffset(native.endContainer, native.endOffset)
      : this.Selection.End.Offset;
    const content = this._editor.cloneNode(true) as HTMLDivElement;
    content
      .querySelectorAll("[data-rt-placeholder]")
      .forEach((node) => node.remove());
    content.querySelectorAll("p,div,h1,h2,h3,h4,h5,h6,span").forEach((node) => {
      (node as HTMLElement).style.whiteSpace = "pre-wrap";
    });
    const html = content.innerHTML;
    const compositionBase = this._compositionBase;
    this._compositionBase = null;
    this._suspendRender = true;
    try {
      const replacement = fromHTML(html);
      if (compositionBase !== null && compositionBase !== this.Document.Text) {
        // Never overwrite a programmatic text change with an older IME DOM.
        this.emit("compositionconflict", {
          document: this.Document,
          composedText: replacement.Text,
          baseText: compositionBase,
        });
      } else if (compositionBase !== null) {
        const next = replacement.Text;
        let prefix = 0,
          suffix = 0;
        while (
          prefix < compositionBase.length &&
          prefix < next.length &&
          compositionBase[prefix] === next[prefix]
        )
          prefix++;
        if (
          prefix > 0 &&
          /[\uD800-\uDBFF]/.test(compositionBase[prefix - 1]) &&
          /[\uDC00-\uDFFF]/.test(compositionBase[prefix] || next[prefix] || "")
        )
          prefix--;
        while (
          suffix < compositionBase.length - prefix &&
          suffix < next.length - prefix &&
          compositionBase[compositionBase.length - suffix - 1] ===
            next[next.length - suffix - 1]
        )
          suffix++;
        if (
          suffix > 0 &&
          /[\uDC00-\uDFFF]/.test(
            compositionBase[compositionBase.length - suffix] || "",
          ) &&
          /[\uD800-\uDBFF]/.test(
            compositionBase[compositionBase.length - suffix - 1] || "",
          )
        )
          suffix--;
        this._engine.BeginChange();
        try {
          if (next !== compositionBase) {
            this._engine.Select(prefix, compositionBase.length - suffix);
            this._engine.InsertText(next.slice(prefix, next.length - suffix));
          }
          this._engine.Select(
            Math.min(caret, this.Document.Text.length),
            Math.min(caret, this.Document.Text.length),
          );
        } finally {
          this._engine.EndChange();
        }
      } else {
        // Other native editing may change formatting: retain document-level metadata.
        const node: DocumentNode = replacement.ToJSON();
        node.props = { ...this.Document.ToJSON().props };
        this._engine.ReplaceDocument(FlowDocument.FromJSON(node));
        this._engine.Select(
          Math.min(caret, this.Document.Text.length),
          Math.min(caret, this.Document.Text.length),
        );
      }
    } finally {
      this._suspendRender = false;
    }
    this.Refresh();
    this.restoreSelection();
  }

  private nativeTextOffset(node: Node, offset: number): number {
    if (!this._editor) return 0;
    // Import the actual DOM prefix so browser-created divs and paragraphs follow
    // exactly the serializer's newline semantics instead of textContent's.
    const range = this.ownerDocument.createRange();
    range.selectNodeContents(this._editor);
    try {
      range.setEnd(node, offset);
    } catch {
      return this.Selection.End.Offset;
    }
    const wrapper = this.ownerDocument.createElement("div");
    wrapper.append(range.cloneContents());
    wrapper
      .querySelectorAll("[data-rt-placeholder]")
      .forEach((node) => node.remove());
    wrapper.querySelectorAll("p,div,h1,h2,h3,h4,h5,h6,span").forEach((node) => {
      (node as HTMLElement).style.whiteSpace = "pre-wrap";
    });
    return fromHTML(wrapper.innerHTML).Text.length;
  }
}

/** Read-only document presentation controls use the same document and renderer. */
export class FlowDocumentReader extends RichTextBox {
  constructor(viewMode: RichTextViewMode = "page") {
    super({ readOnly: true, viewMode });
  }
  connectedCallback(): void {
    this.IsReadOnly = true;
    super.connectedCallback();
  }
}
export class FlowDocumentScrollViewer extends FlowDocumentReader {
  constructor() {
    super("continuous");
  }
}
export class FlowDocumentPageViewer extends FlowDocumentReader {
  constructor() {
    super("page");
  }
}

/** Explicit and idempotent registration; safe to import during server rendering. */
export function registerRichTextWeb(
  registry: CustomElementRegistry | undefined = globalThis.customElements,
): void {
  if (!registry) return;
  const controls: Array<[string, CustomElementConstructor]> = [
    ["rich-text-box", RichTextBox],
    ["flow-document-reader", FlowDocumentReader],
    ["flow-document-scroll-viewer", FlowDocumentScrollViewer],
    ["flow-document-page-viewer", FlowDocumentPageViewer],
  ];
  for (const [name, constructor] of controls)
    if (!registry.get(name)) registry.define(name, constructor);
}

declare global {
  interface HTMLElementTagNameMap {
    "rich-text-box": RichTextBox;
    "flow-document-reader": FlowDocumentReader;
    "flow-document-scroll-viewer": FlowDocumentScrollViewer;
    "flow-document-page-viewer": FlowDocumentPageViewer;
  }
}
