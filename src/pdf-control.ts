import { FlowDocument } from "./model.js";
import { registerRichTextWeb, type RichTextBox } from "./control.js";
import type { RichTextToolbar } from "./toolbar.js";
import type {
  PDFTextOperator,
  PDFTextInspection,
  PDFTextReplacementOptions,
  PDFSourceTextReplaceOptions,
  PDFTextEditResult,
} from "./pdf-operators.js";
import {
  PDFEditor,
  toPDF,
  type PDFExportOptions,
  type PDFTextOptions,
  type PDFRectangleOptions,
  type PDFImageOptions,
} from "./formats-pdf.js";
import {
  openPDFDocument,
  extractPDF,
  extractPDFPage,
  pdfjs,
  type PDFImportOptions,
  type PDFExtractedPage,
  type PDFTextGeometry,
} from "./pdf-import.js";
import type { PageViewport } from "pdfjs-dist/types/src/display/page_viewport.js";
import type { RenderTask } from "pdfjs-dist/types/src/display/api.js";

const HTMLElementBase: typeof HTMLElement =
  (globalThis as any).HTMLElement ?? class extends EventTarget {};

export type PDFTool =
  "select" | "text" | "highlight" | "rectangle" | "cover" | "image";
export interface PDFSearchMatch extends PDFTextGeometry {
  pageIndex: number;
  text: string;
  matchIndex: number;
}

const css = `
:host{display:flex;flex-direction:column;min-height:420px;height:680px;--pdf-ink:#182236;--pdf-paper:#fff;--pdf-workspace:#e9edf3;--pdf-border:#d3dbe7;--pdf-accent:#2563eb;color:var(--pdf-ink);font:13px/1.4 Segoe UI,system-ui,sans-serif;border:1px solid var(--pdf-border);border-radius:8px;overflow:hidden;background:var(--pdf-paper)}*{box-sizing:border-box}button,input,select{font:inherit;color:inherit}button{border:1px solid transparent;border-radius:5px;background:transparent;padding:6px 9px;cursor:pointer;white-space:nowrap}button:hover:not(:disabled){background:var(--pdf-workspace)}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--pdf-accent);outline-offset:1px}button[aria-pressed=true]{background:color-mix(in srgb,var(--pdf-accent) 15%,var(--pdf-paper));color:var(--pdf-accent)}button:disabled{opacity:.4;cursor:default}input,select{border:1px solid var(--pdf-border);border-radius:4px;background:var(--pdf-paper);padding:4px 6px;min-width:0}input[type=number]{width:62px}input[type=color]{width:32px;height:29px;padding:2px}.toolbar{display:flex;align-items:center;gap:3px;flex-wrap:wrap;padding:6px 8px;border-bottom:1px solid var(--pdf-border);flex-shrink:0}.toolbar label{display:flex;align-items:center;gap:5px}.divider{height:22px;width:1px;background:var(--pdf-border);margin:0 3px}.spacer{flex:1}.text-input{width:170px}.find-input{width:150px}.viewport{position:relative;flex:1;overflow:auto;min-height:160px;background:var(--pdf-workspace);padding:24px;overscroll-behavior:contain}.page{position:relative;margin:auto;background:#fff;box-shadow:0 3px 18px #18223624;isolation:isolate}.page canvas{display:block}.page[data-tool]:not([data-tool=select]){cursor:crosshair}.page[data-tool]:not([data-tool=select]) .textLayer{pointer-events:none}.textLayer{color-scheme:only light;position:absolute;text-align:initial;inset:0;overflow:clip;opacity:1;line-height:1;letter-spacing:normal;word-spacing:normal;text-size-adjust:none;forced-color-adjust:none;transform-origin:0 0;caret-color:CanvasText;z-index:1;--min-font-size:1;--text-scale-factor:calc(var(--total-scale-factor)*var(--min-font-size));--min-font-size-inv:calc(1/var(--min-font-size))}.textLayer :is(span,br){color:transparent;position:absolute;white-space:pre;cursor:text;transform-origin:0 0;user-select:text}.textLayer>:not(.markedContent),.textLayer .markedContent span:not(.markedContent){z-index:1;--font-height:0;font-size:calc(var(--text-scale-factor)*var(--font-height));--scale-x:1;--rotate:0deg;transform:rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv))}.textLayer .markedContent{display:contents}.textLayer ::selection{background:#2563eb66}.search-layer{position:absolute;inset:0;pointer-events:none;z-index:2}.search-hit,.drag-preview{position:absolute;background:#facc1555;border:1px solid #eab308}.search-hit.current{background:#fb923c77;border-color:#ea580c}.drag-preview{pointer-events:none;z-index:4}.status{display:flex;gap:8px;padding:6px 12px;border-top:1px solid var(--pdf-border);min-height:30px;background:var(--pdf-paper);font-size:12px}.status[data-error=true]{color:#b91c1c}.empty{padding:48px 20px;text-align:center;color:#64748b}.flow-wrap{display:flex;flex-direction:column;flex:1;min-height:0}.flow-note{padding:9px 12px;background:var(--pdf-workspace);border-bottom:1px solid var(--pdf-border)}rich-text-box{flex:1;min-height:0;height:100%}[hidden]{display:none!important}:host([theme=dark]){--pdf-ink:#e5e7eb;--pdf-paper:#202630;--pdf-workspace:#151b24;--pdf-border:#394354;color-scheme:dark}@media(max-width:640px){.viewport{padding:12px}.toolbar{gap:1px}.text-input{width:120px}.find-input{width:110px}}`;

/** Reusable PDF viewer, page/overlay editor, and reconstructed-flow editing surface. */
export class PDFEditorControl extends HTMLElementBase {
  static get observedAttributes(): string[] {
    return ["readonly", "zoom", "page-index", "theme"];
  }
  /** Default font/page settings used by ExportReflow and its built-in download button. */
  ReflowExportOptions: PDFExportOptions = {};
  private _engine: PDFEditor | null = null;
  private _handle: Awaited<ReturnType<typeof openPDFDocument>> | null = null;
  private _importOptions: PDFImportOptions = {};
  private _pageIndex = 0;
  private _zoom = 1;
  private _readonly = false;
  private _tool: PDFTool = "select";
  private _viewMode: "pdf" | "flow" = "pdf";
  private _flow: RichTextBox | null = null;
  private _flowDocument: FlowDocument | null = null;
  private _viewport: PageViewport | null = null;
  private _renderTask: RenderTask | null = null;
  private _textLayer: InstanceType<typeof pdfjs.TextLayer> | null = null;
  private _renderVersion = 0;
  private _loadVersion = 0;
  private _disposed = false;
  private _history: Uint8Array[] = [];
  private _future: Uint8Array[] = [];
  private _pending: Promise<unknown> = Promise.resolve();
  private _pageCache = new Map<number, PDFExtractedPage>();
  private _matches: PDFSearchMatch[] = [];
  private _matchIndex = -1;
  private _imageBytes: Uint8Array | null = null;
  private _sourceOperators: PDFTextOperator[] = [];
  private _selectedSourceId: string | null = null;
  private _flowToolbar: RichTextToolbar | null = null;
  /** Optional font options used by the built-in original-text replacement tools. */
  SourceTextReplacementOptions: PDFTextReplacementOptions = {};
  private _drag: {
    x: number;
    y: number;
    preview: HTMLDivElement | null;
  } | null = null;
  private _canvas: HTMLCanvasElement | null = null;
  private _page: HTMLDivElement | null = null;
  private _scroll: HTMLDivElement | null = null;
  private _textContainer: HTMLDivElement | null = null;
  private _searchLayer: HTMLDivElement | null = null;
  private _status: HTMLDivElement | null = null;

  constructor() {
    super();
    if (typeof this.attachShadow !== "function") return;
    const shadow = this.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>${css}</style>
      <div class="toolbar" role="toolbar" aria-label="PDF document tools">
        <button data-command="open">Open PDF</button><button data-command="save" data-loaded>Save PDF</button>
        <span class="divider"></span><button data-command="previous" data-loaded aria-label="Previous page">‹</button>
        <label>Page <input type="number" data-input="page" min="1" value="1" aria-label="Page number"></label><span data-label="pages">/ 0</span>
        <button data-command="next" data-loaded aria-label="Next page">›</button><span class="divider"></span>
        <button data-command="zoom-out" aria-label="Zoom out">−</button><span data-label="zoom">100%</span><button data-command="zoom-in" aria-label="Zoom in">+</button><button data-command="fit">Fit width</button>
        <span class="spacer"></span><button data-command="view-pdf" data-loaded aria-pressed="true">PDF</button><button data-command="reflow" data-loaded>Edit as flow</button>
      </div>
      <div class="toolbar pdf-tools" role="toolbar" aria-label="PDF editing tools">
        <button data-tool="select" aria-pressed="true">Select</button><button data-tool="text" data-mutates>Text</button><button data-tool="highlight" data-mutates>Highlight</button><button data-tool="rectangle" data-mutates>Rectangle</button><button data-tool="cover" data-mutates>Cover</button><button data-command="image" data-mutates>Image</button>
        <input class="text-input" data-input="text" value="New text" aria-label="Overlay text"><label>Size <input type="number" data-input="size" min="1" max="200" value="14" aria-label="Overlay text size"></label><input type="color" data-input="color" value="#2563eb" aria-label="Overlay color">
        <span class="divider"></span><button data-command="undo" data-mutates>Undo</button><button data-command="redo" data-mutates>Redo</button><button data-command="rotate" data-mutates>Rotate</button><button data-command="move-before" data-mutates>Move earlier</button><button data-command="move-after" data-mutates>Move later</button><button data-command="delete" data-mutates>Delete page</button><button data-command="add-page" data-mutates>Blank page</button><button data-command="insert-pages" data-mutates>Import pages</button>
      </div>
      <div class="toolbar pdf-tools source-tools" role="toolbar" aria-label="Original PDF text editing">
        <button data-command="inspect-source" data-loaded>Original text</button>
        <select data-input="source-operator" aria-label="Original PDF text" style="max-width:280px"><option value="">Inspect this page to select original text</option></select>
        <input data-input="source-replacement" class="text-input" aria-label="Replace original text" placeholder="Replacement text">
        <button data-command="replace-source" data-mutates>Replace original</button><button data-command="remove-source" data-mutates>Remove original</button>
        <label><input data-input="preserve-advance" type="checkbox" checked>Keep following positions</label>
        <span data-label="source-font"></span>
      </div>
      <div class="toolbar pdf-tools" role="search"><input data-input="find" class="find-input" type="search" placeholder="Find in PDF" aria-label="Find in PDF"><button data-command="find" data-loaded>Find</button><button data-command="find-next" data-loaded>Next match</button><span data-label="matches"></span><button data-command="replace-source-matches" data-mutates>Replace source matches</button></div>
      <div class="viewport" part="viewport"><div class="empty">Open a PDF to view, search, annotate, organize pages, or reconstruct editable flow text.</div><div class="page" part="page" data-tool="select" hidden><canvas aria-label="PDF page"></canvas><div class="textLayer"></div><div class="search-layer"></div></div></div>
      <div class="flow-wrap" hidden><div class="flow-note">Editable text reconstructed from PDF. Paragraphs and reading order are inferred. Images and original page layout remain in the source PDF.</div></div>
      <div class="status" role="status" aria-live="polite">No document loaded.</div>
      <input type="file" data-file="open" accept="application/pdf,.pdf" hidden><input type="file" data-file="insert" accept="application/pdf,.pdf" hidden><input type="file" data-file="image" accept="image/png,image/jpeg" hidden>`;
    this._canvas = shadow.querySelector("canvas");
    this._page = shadow.querySelector(".page");
    this._scroll = shadow.querySelector(".viewport");
    this._textContainer = shadow.querySelector(".textLayer");
    this._searchLayer = shadow.querySelector(".search-layer");
    this._status = shadow.querySelector(".status");
    shadow.addEventListener("click", (event) => {
      const target = (event.target as Element).closest<HTMLButtonElement>(
        "button",
      );
      if (!target || target.disabled) return;
      if (target.dataset.tool) this.Tool = target.dataset.tool as PDFTool;
      if (target.dataset.command)
        void this.command(target.dataset.command).catch((error) =>
          this.reportError(error),
        );
    });
    shadow.addEventListener("change", (event) => {
      const input = event.target as HTMLInputElement;
      if (input.dataset.input === "source-operator") {
        this.SelectTextOperator(input.value);
      }
      if (input.dataset.input === "page") {
        try {
          this.PageIndex = Number(input.value) - 1;
        } catch (error) {
          this.reportError(error);
        }
      }
      if (input.dataset.file && input.files?.[0])
        void this.fileSelected(input.dataset.file, input.files[0]).catch(
          (error) => this.reportError(error),
        );
    });
    shadow.addEventListener("keydown", (event) => {
      const key = event as KeyboardEvent;
      if (
        (key.target as HTMLElement).dataset.input === "find" &&
        key.key === "Enter"
      ) {
        key.preventDefault();
        void this.command("find").catch((error) => this.reportError(error));
      }
      if (
        this.ViewMode === "pdf" &&
        (key.ctrlKey || key.metaKey) &&
        key.key.toLowerCase() === "z"
      ) {
        key.preventDefault();
        void (key.shiftKey ? this.Redo() : this.Undo()).catch((error) =>
          this.reportError(error),
        );
      }
    });
    this._textContainer?.addEventListener("dblclick", (event) => {
      if (this.Tool !== "select") return;
      const point = this.localPoint(event as PointerEvent);
      void this.selectSourceAt(point.x, point.y).catch((error) =>
        this.reportError(error),
      );
    });
    this._page?.addEventListener("pointerdown", (event) =>
      this.pointerDown(event),
    );
    this._page?.addEventListener("pointermove", (event) =>
      this.pointerMove(event),
    );
    this._page?.addEventListener(
      "pointerup",
      (event) =>
        void this.pointerUp(event).catch((error) => this.reportError(error)),
    );
    this._page?.addEventListener("pointercancel", () => {
      this._drag?.preview?.remove();
      this._drag = null;
    });
    this.updateToolbar();
  }

  connectedCallback(): void {
    if (this._handle)
      void this.render().catch((error) => this.reportError(error));
  }
  attributeChangedCallback(
    name: string,
    _old: string | null,
    value: string | null,
  ): void {
    if (name === "readonly")
      this.IsReadOnly = value !== null && value !== "false";
    if (name === "zoom" && value !== null) this.Zoom = Number(value);
    if (name === "page-index" && value !== null && this._engine)
      this.PageIndex = Number(value);
    if (name === "theme" && this._flow)
      value
        ? this._flow.setAttribute("theme", value)
        : this._flow.removeAttribute("theme");
  }

  get Engine(): PDFEditor | null {
    return this._engine;
  }
  get PageCount(): number {
    return this._engine?.PageCount ?? 0;
  }
  get PageIndex(): number {
    return this._pageIndex;
  }
  set PageIndex(value: number) {
    if (!Number.isInteger(value) || value < 0 || value >= this.PageCount)
      throw new RangeError("Invalid PDF page index.");
    this._pageIndex = value;
    this.clearSourceSelection();
    this.updateToolbar();
    void this.render().catch((error) => this.reportError(error));
    this.emit("pagechange", { pageIndex: value, pageCount: this.PageCount });
  }
  get Zoom(): number {
    return this._zoom;
  }
  set Zoom(value: number) {
    if (!Number.isFinite(value) || value < 0.25 || value > 4)
      throw new RangeError("PDF zoom must be between 0.25 and 4.");
    this._zoom = value;
    this.updateToolbar();
    void this.render().catch((error) => this.reportError(error));
  }
  get IsReadOnly(): boolean {
    return this._readonly;
  }
  set IsReadOnly(value: boolean) {
    this._readonly = Boolean(value);
    if (value) this.Tool = "select";
    if (this._flow) this._flow.IsReadOnly = this._readonly;
    this.updateToolbar();
  }
  get Tool(): PDFTool {
    return this._tool;
  }
  set Tool(value: PDFTool) {
    if (
      !["select", "text", "highlight", "rectangle", "cover", "image"].includes(
        value,
      )
    )
      throw new TypeError("Invalid PDF tool.");
    if (this.IsReadOnly && value !== "select")
      throw new Error("The PDF control is read-only.");
    this._tool = value;
    if (this._page) this._page.dataset.tool = value;
    this.updateToolbar();
    if (value === "cover")
      this.status(
        "Cover draws a visual overlay. It does not redact or remove original content.",
      );
    else if (value === "text" || value === "image")
      this.status(`Click the page to place ${value}.`);
    else if (value !== "select")
      this.status(`Drag on the page to draw a ${value}.`);
  }
  get ViewMode(): "pdf" | "flow" {
    return this._viewMode;
  }
  set ViewMode(value: "pdf" | "flow") {
    if (value !== "pdf" && value !== "flow")
      throw new TypeError("ViewMode must be pdf or flow.");
    if (value === "flow" && !this._flowDocument)
      throw new Error(
        "Call ImportToFlowDocument before opening the flow view.",
      );
    this._viewMode = value;
    this.updateToolbar();
  }
  get FlowDocument(): FlowDocument | null {
    return this._flowDocument;
  }
  get CanUndo(): boolean {
    return this._history.length > 0;
  }
  get CanRedo(): boolean {
    return this._future.length > 0;
  }

  async Load(
    bytes: Uint8Array | ArrayBuffer,
    options: PDFImportOptions = {},
  ): Promise<void> {
    this.assertActive();
    const version = ++this._loadVersion;
    this.status("Opening PDF…");
    const engine = await PDFEditor.Load(bytes);
    const handle = await openPDFDocument(bytes, options);
    if (version !== this._loadVersion || this._disposed) {
      await handle.destroy();
      return;
    }
    const previous = this._handle;
    this._renderTask?.cancel();
    this._engine = engine;
    this._handle = handle;
    this._importOptions = options;
    this._history = [];
    this._future = [];
    this._pageIndex = 0;
    this._pageCache.clear();
    this.clearSourceSelection();
    this._matches = [];
    this._matchIndex = -1;
    this._flowDocument = null;
    this._flowToolbar?.Dispose();
    this._flowToolbar?.remove();
    this._flowToolbar = null;
    this._flow?.remove();
    this._flow?.Dispose();
    this._flow = null;
    this._viewMode = "pdf";
    await previous?.destroy();
    this.updateToolbar();
    await this.render();
    if (this._disposed || version !== this._loadVersion) return;
    this.status(
      `${this.PageCount} page${this.PageCount === 1 ? "" : "s"} loaded. Text extraction creates a separate editable flow document.`,
    );
    this.emit("pdfload", { pageCount: this.PageCount, engine });
  }

  /** Saves the source PDF plus original-text, page and overlay edits. Flow edits are exported separately. */
  async Save(): Promise<Uint8Array> {
    return this.requiredEngine().Save();
  }

  /** Refresh after callers mutate Engine directly; direct mutations do not enter control history. */
  async Refresh(): Promise<void> {
    const bytes = await this.Save();
    const handle = await openPDFDocument(bytes, this._importOptions);
    if (this._disposed) {
      await handle.destroy();
      return;
    }
    const previous = this._handle;
    this._renderTask?.cancel();
    this._handle = handle;
    this._pageIndex = Math.min(this._pageIndex, this.PageCount - 1);
    this._pageCache.clear();
    this.clearSourceSelection();
    this._matches = [];
    this._matchIndex = -1;
    await previous?.destroy();
    this.updateToolbar();
    await this.render();
  }

  /** Inspect original page/Form text operators independently of PDF.js display grouping. */
  async GetTextOperators(pageIndex?: number): Promise<PDFTextInspection> {
    await this._pending.catch(() => undefined);
    return this.requiredEngine().GetTextOperators(pageIndex);
  }

  get SelectedTextOperator(): PDFTextOperator | null {
    return (
      this._sourceOperators.find(
        (item) => item.id === this._selectedSourceId,
      ) ?? null
    );
  }

  /** Populate the control's original-text picker for the current page. */
  async InspectSourceText(): Promise<PDFTextInspection> {
    const pageIndex = this.PageIndex;
    const result = await this.GetTextOperators(pageIndex);
    if (pageIndex !== this.PageIndex || this._disposed) return result;
    this._sourceOperators = result.operators;
    const picker = this.shadowRoot?.querySelector<HTMLSelectElement>(
      '[data-input="source-operator"]',
    );
    if (picker) {
      picker.replaceChildren();
      for (const item of result.operators) {
        const option = this.ownerDocument.createElement("option");
        option.value = item.id;
        option.textContent = `${item.editable ? "" : "Unavailable: "}${item.text ?? item.reason ?? "Undecodable text"}`;
        option.title = item.reason ?? item.fontName;
        picker.append(option);
      }
      if (!result.operators.length) {
        const option = this.ownerDocument.createElement("option");
        option.value = "";
        option.textContent = "No source text operators on this page";
        picker.append(option);
      }
    }
    this.SelectTextOperator(
      result.operators.find((item) => item.editable)?.id ??
        result.operators[0]?.id ??
        "",
    );
    const unsupported =
      result.operators.filter((item) => !item.editable).length +
      result.diagnostics.length;
    this.status(
      `${result.operators.length} original text operators. ${unsupported ? `${unsupported} unsupported source sections; select one for details.` : "Choose text or double-click a text line to replace its original content."}`,
    );
    return result;
  }

  SelectTextOperator(operatorId: string): void {
    const selected = this._sourceOperators.find(
      (item) => item.id === operatorId,
    );
    if (operatorId && !selected)
      throw new RangeError("Inspect source text before selecting an operator.");
    this._selectedSourceId = selected?.id ?? null;
    const picker = this.shadowRoot?.querySelector<HTMLSelectElement>(
      '[data-input="source-operator"]',
    );
    if (picker) picker.value = this._selectedSourceId ?? "";
    const replacement = this.input("source-replacement");
    if (replacement) replacement.value = selected?.text ?? "";
    const label = this.shadowRoot?.querySelector('[data-label="source-font"]');
    if (label)
      label.textContent = selected
        ? `${selected.fontName} · ${selected.fontSize} pt`
        : "";
    if (selected?.reason) this.status(selected.reason, true);
    this.drawSearch();
    this.updateToolbar();
    this.emit("pdftextselectionchange", { operator: selected ?? null });
  }

  async ReplaceTextOperator(
    pageIndex: number,
    operatorId: string,
    replacement: string,
    options: PDFTextReplacementOptions = {},
  ): Promise<PDFTextEditResult> {
    let result!: PDFTextEditResult;
    await this.mutate(async (engine) => {
      result = await engine.ReplaceTextOperator(
        pageIndex,
        operatorId,
        replacement,
        options,
      );
      return result.operatorsChanged > 0;
    });
    this.emit("pdftextchange", result);
    return result;
  }

  async ReplaceSourceText(
    query: string,
    replacement: string,
    options: PDFSourceTextReplaceOptions = {},
  ): Promise<PDFTextEditResult> {
    let result!: PDFTextEditResult;
    await this.mutate(async (engine) => {
      result = await engine.ReplaceSourceText(query, replacement, options);
      return result.operatorsChanged > 0;
    });
    this.emit("pdftextchange", result);
    return result;
  }

  AddText(
    pageIndex: number,
    text: string,
    options: PDFTextOptions,
  ): Promise<void> {
    return this.mutate((engine) => engine.AddText(pageIndex, text, options));
  }
  AddImage(
    pageIndex: number,
    source: string | Uint8Array | ArrayBuffer,
    options: PDFImageOptions,
  ): Promise<void> {
    return this.mutate((engine) => engine.AddImage(pageIndex, source, options));
  }
  Highlight(pageIndex: number, options: PDFRectangleOptions): Promise<void> {
    return this.mutate((engine) => engine.Highlight(pageIndex, options));
  }
  DrawRectangle(
    pageIndex: number,
    options: PDFRectangleOptions,
  ): Promise<void> {
    return this.mutate((engine) => engine.DrawRectangle(pageIndex, options));
  }
  CoverRegion(pageIndex: number, options: PDFRectangleOptions): Promise<void> {
    return this.mutate((engine) => engine.CoverRegion(pageIndex, options));
  }
  RotatePage(pageIndex: number, degrees: number): Promise<void> {
    return this.mutate((engine) => engine.RotatePage(pageIndex, degrees));
  }
  ReorderPages(order: readonly number[]): Promise<void> {
    return this.mutate((engine) => engine.ReorderPages(order));
  }
  DeletePages(indices: readonly number[]): Promise<void> {
    return this.mutate((engine) => engine.DeletePages(indices));
  }
  AddPage(width?: number, height?: number): Promise<void> {
    return this.mutate((engine) => {
      engine.AddPage(width, height);
      this._pageIndex = engine.PageCount - 1;
    });
  }
  InsertPages(
    bytes: Uint8Array | ArrayBuffer,
    indices?: readonly number[],
    insertionIndex?: number,
  ): Promise<void> {
    return this.mutate((engine) =>
      engine.InsertPages(bytes, indices, insertionIndex),
    );
  }

  Undo(): Promise<void> {
    return this.restore(this._history, this._future);
  }
  Redo(): Promise<void> {
    return this.restore(this._future, this._history);
  }

  async ImportToFlowDocument(
    options: PDFImportOptions = {},
  ): Promise<FlowDocument> {
    this.status("Reconstructing editable flow text…");
    const result = await extractPDF(await this.Save(), {
      ...this._importOptions,
      ...options,
    });
    this._flowDocument = result.document;
    if (this.shadowRoot) {
      this._flow?.remove();
      this._flow?.Dispose();
      // Use the registered host constructor when the core and optional PDF bundles
      // are loaded separately; each bundle can contain its own model constructors.
      this._flow = this.ownerDocument.createElement(
        "rich-text-box",
      ) as RichTextBox;
      const HostDocument = this._flow.Document
        .constructor as typeof FlowDocument;
      this._flowDocument = HostDocument.FromJSON(result.document.ToJSON());
      result.document = this._flowDocument;
      this._flow.Document = this._flowDocument;
      this._flow.IsReadOnly = this.IsReadOnly;
      const theme = this.getAttribute("theme");
      if (theme) this._flow.setAttribute("theme", theme);
      this._flow.addEventListener("documentchange", (event) => {
        event.stopPropagation();
        this.emit("flowdocumentchange", { document: this._flowDocument });
      });
      this._flowToolbar?.Dispose();
      this._flowToolbar?.remove();
      this._flowToolbar = this.ownerDocument.createElement(
        "rich-text-toolbar",
      ) as RichTextToolbar;
      this._flowToolbar.Editor = this._flow;
      this._flowToolbar.Mode = "all";
      this.shadowRoot
        .querySelector(".flow-wrap")
        ?.append(this._flowToolbar, this._flow);
    }
    this.ViewMode = "flow";
    this.status(
      `Reconstructed ${result.pages.length} pages of text. Export flow creates a new PDF.`,
    );
    this.emit("flowdocumentimport", result);
    return result.document;
  }

  async ExportReflow(options: PDFExportOptions = {}): Promise<Uint8Array> {
    if (!this._flowDocument)
      throw new Error("No reconstructed flow document is open.");
    return toPDF(this._flowDocument, {
      ...this.ReflowExportOptions,
      ...options,
    });
  }

  async Find(
    query: string,
    options: { caseSensitive?: boolean } = {},
  ): Promise<PDFSearchMatch[]> {
    this.requiredEngine();
    this._matches = [];
    this._matchIndex = -1;
    const needle = options.caseSensitive ? query : query.toLocaleLowerCase();
    if (!needle) {
      this.drawSearch();
      this.updateToolbar();
      return [];
    }
    for (let index = 0; index < this.PageCount; index++) {
      let page = this._pageCache.get(index);
      if (!page) {
        page = await extractPDFPage(
          await this._handle!.document.getPage(index + 1),
        );
        this._pageCache.set(index, page);
      }
      for (const line of page.lines) {
        const text = options.caseSensitive
          ? line.text
          : line.text.toLocaleLowerCase();
        let offset = text.indexOf(needle);
        while (offset >= 0) {
          this._matches.push({
            pageIndex: index,
            text: line.text,
            matchIndex: offset,
            x: line.x,
            y: line.y,
            width: line.width,
            height: line.height,
          });
          offset = text.indexOf(needle, offset + Math.max(1, needle.length));
        }
      }
    }
    if (this._matches.length) {
      this._matchIndex = 0;
      this._pageIndex = this._matches[0].pageIndex;
      await this.render();
    }
    this.drawSearch();
    this.updateToolbar();
    this.status(
      `${this._matches.length} matching text occurrence${this._matches.length === 1 ? "" : "s"}. Highlight boxes show the containing line.`,
    );
    return [...this._matches];
  }

  async FitWidth(): Promise<void> {
    if (!this._handle || !this._scroll) return;
    const page = await this._handle.document.getPage(this.PageIndex + 1);
    this.Zoom = Math.max(
      0.25,
      Math.min(
        4,
        (this._scroll.clientWidth - 48) /
          ((page.getViewport({ scale: 1 }).width * 4) / 3),
      ),
    );
  }

  async Dispose(): Promise<void> {
    if (this._disposed) return;
    this._disposed = true;
    this._loadVersion++;
    this._renderVersion++;
    this._renderTask?.cancel();
    this._textLayer?.cancel();
    this._flowToolbar?.Dispose();
    this._flow?.Dispose();
    await this._handle?.destroy();
    this._handle = null;
    this._engine = null;
    this._history = [];
    this._future = [];
    this._pageCache.clear();
  }

  private requiredEngine(): PDFEditor {
    this.assertActive();
    if (!this._engine) throw new Error("Load a PDF first.");
    return this._engine;
  }
  private assertActive(): void {
    if (this._disposed) throw new Error("The PDF control has been disposed.");
  }
  private assertWritable(): void {
    this.requiredEngine();
    if (this.IsReadOnly) throw new Error("The PDF control is read-only.");
  }
  private emit(name: string, detail: unknown): void {
    this.dispatchEvent(
      new CustomEvent(name, { detail, bubbles: true, composed: true }),
    );
  }
  private status(text: string, error = false): void {
    if (this._status) {
      this._status.textContent = text;
      this._status.dataset.error = String(error);
    }
  }
  private reportError(error: unknown): void {
    if (
      this._disposed ||
      (error as any)?.name === "RenderingCancelledException"
    )
      return;
    const message = error instanceof Error ? error.message : String(error);
    this.status(message, true);
    this.emit("pdferror", { error, message });
  }
  private input(name: string): HTMLInputElement | null {
    return this.shadowRoot?.querySelector(`[data-input="${name}"]`) ?? null;
  }
  private enqueue(action: () => Promise<void>): Promise<void> {
    const next = this._pending.catch(() => undefined).then(action);
    this._pending = next;
    return next;
  }

  private mutate(
    action: (engine: PDFEditor) => void | boolean | Promise<void | boolean>,
  ): Promise<void> {
    return this.enqueue(async () => {
      this.assertWritable();
      const before = await this.Save();
      try {
        if ((await action(this.requiredEngine())) === false) return;
        await this.Refresh();
      } catch (error) {
        this._engine = await PDFEditor.Load(before);
        await this.Refresh();
        throw error;
      }
      this._history.push(before);
      if (this._history.length > 20) this._history.shift();
      this._future = [];
      this.updateToolbar();
      this.emit("pdfchange", {
        engine: this._engine,
        pageCount: this.PageCount,
      });
    });
  }

  private restore(from: Uint8Array[], to: Uint8Array[]): Promise<void> {
    return this.enqueue(async () => {
      this.assertWritable();
      const bytes = from[from.length - 1];
      if (!bytes) return;
      const current = await this.Save();
      this._engine = await PDFEditor.Load(bytes);
      await this.Refresh();
      from.pop();
      to.push(current);
      this.updateToolbar();
      this.emit("pdfchange", {
        engine: this._engine,
        pageCount: this.PageCount,
      });
    });
  }

  private async render(): Promise<void> {
    if (
      !this._handle ||
      !this._canvas ||
      !this._page ||
      !this._textContainer ||
      this._disposed
    )
      return;
    const version = ++this._renderVersion;
    try {
      const oldRender = this._renderTask;
      oldRender?.cancel();
      this._textLayer?.cancel();
      if (oldRender) await oldRender.promise.catch(() => undefined);
      if (version !== this._renderVersion || this._disposed) return;
      const page = await this._handle.document.getPage(this.PageIndex + 1);
      if (version !== this._renderVersion || this._disposed) return;
      const viewport = page.getViewport({ scale: (this.Zoom * 4) / 3 });
      this._viewport = viewport;
      const scale = Math.min(
        globalThis.devicePixelRatio || 1,
        Math.sqrt(16000000 / (viewport.width * viewport.height)),
      );
      this._canvas.width = Math.max(1, Math.ceil(viewport.width * scale));
      this._canvas.height = Math.max(1, Math.ceil(viewport.height * scale));
      this._canvas.style.width = `${viewport.width}px`;
      this._canvas.style.height = `${viewport.height}px`;
      this._page.style.width = `${viewport.width}px`;
      this._page.style.height = `${viewport.height}px`;
      this._page.style.setProperty(
        "--total-scale-factor",
        String(viewport.scale),
      );
      this._page.hidden = false;
      this.shadowRoot?.querySelector(".empty")?.setAttribute("hidden", "");
      this._textContainer.replaceChildren();
      const context = this._canvas.getContext("2d");
      if (!context) throw new Error("Canvas rendering is unavailable.");
      this._renderTask = page.render({
        canvas: this._canvas,
        canvasContext: context,
        viewport,
        transform: scale === 1 ? undefined : [scale, 0, 0, scale, 0, 0],
      });
      await this._renderTask.promise;
      if (version !== this._renderVersion || this._disposed) return;
      this._textLayer = new pdfjs.TextLayer({
        textContentSource: await page.getTextContent(),
        container: this._textContainer,
        viewport,
      });
      await this._textLayer.render();
      this.drawSearch();
      this.emit("pagerender", {
        pageIndex: this.PageIndex,
        width: viewport.width,
        height: viewport.height,
      });
    } catch (error) {
      // Replacing a page, zooming, undoing, or disposing cancels an older render.
      // Cancellation is ordinary control lifecycle, not a document-load failure.
      if (
        this._disposed ||
        version !== this._renderVersion ||
        (error as any)?.name === "RenderingCancelledException"
      )
        return;
      throw error;
    }
  }

  private clearSourceSelection(): void {
    this._sourceOperators = [];
    this._selectedSourceId = null;
    const picker = this.shadowRoot?.querySelector<HTMLSelectElement>(
      '[data-input="source-operator"]',
    );
    if (picker) {
      const option = this.ownerDocument.createElement("option");
      option.value = "";
      option.textContent = "Inspect this page to select original text";
      picker.replaceChildren(option);
    }
    const label = this.shadowRoot?.querySelector('[data-label="source-font"]');
    if (label) label.textContent = "";
  }

  private async selectSourceAt(x: number, y: number): Promise<void> {
    if (!this._viewport) return;
    if (!this._sourceOperators.length) await this.InspectSourceText();
    const point = this._viewport.convertToPdfPoint(x, y);
    const selected = this._sourceOperators
      .filter(
        (item) =>
          item.bounds &&
          point[0] >= item.bounds.x - 3 &&
          point[0] <= item.bounds.x + item.bounds.width + 3 &&
          point[1] >= item.bounds.y - 3 &&
          point[1] <= item.bounds.y + item.bounds.height + 3,
      )
      .sort(
        (a, b) =>
          a.bounds!.width * a.bounds!.height -
          b.bounds!.width * b.bounds!.height,
      )[0];
    if (selected) {
      this.SelectTextOperator(selected.id);
      this.input("source-replacement")?.focus();
    }
  }

  private drawSearch(): void {
    if (!this._searchLayer || !this._viewport) return;
    this._searchLayer.replaceChildren();
    this._matches.forEach((match, index) => {
      if (match.pageIndex !== this.PageIndex) return;
      const element = this.ownerDocument.createElement("div");
      element.className = `search-hit${index === this._matchIndex ? " current" : ""}`;
      const scale = this._viewport!.scale;
      Object.assign(element.style, {
        left: `${match.x * scale}px`,
        top: `${match.y * scale}px`,
        width: `${match.width * scale}px`,
        height: `${match.height * scale}px`,
      });
      this._searchLayer!.append(element);
    });
    const selected = this.SelectedTextOperator;
    if (selected?.bounds && selected.pageIndex === this.PageIndex) {
      const b = selected.bounds;
      const rectangle = [
        ...this._viewport.convertToViewportPoint(b.x, b.y),
        ...this._viewport.convertToViewportPoint(b.x + b.width, b.y + b.height),
      ];
      const element = this.ownerDocument.createElement("div");
      element.className = "source-selection";
      Object.assign(element.style, {
        position: "absolute",
        border: "2px solid var(--pdf-accent)",
        background: "#2563eb22",
        left: `${Math.min(rectangle[0], rectangle[2])}px`,
        top: `${Math.min(rectangle[1], rectangle[3])}px`,
        width: `${Math.max(3, Math.abs(rectangle[2] - rectangle[0]))}px`,
        height: `${Math.max(3, Math.abs(rectangle[3] - rectangle[1]))}px`,
      });
      this._searchLayer.append(element);
    }
  }

  private updateToolbar(): void {
    const shadow = this.shadowRoot;
    if (!shadow) return;
    shadow
      .querySelectorAll<HTMLButtonElement>("[data-loaded]")
      .forEach((button) => (button.disabled = !this._engine));
    shadow
      .querySelectorAll<HTMLButtonElement>("[data-mutates]")
      .forEach(
        (button) => (button.disabled = !this._engine || this.IsReadOnly),
      );
    shadow
      .querySelectorAll<HTMLButtonElement>("[data-tool]")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.tool === this.Tool),
        ),
      );
    const specific: Record<string, boolean> = {
      previous: !this._engine || this.PageIndex <= 0,
      next: !this._engine || this.PageIndex >= this.PageCount - 1,
      undo: this.IsReadOnly || !this.CanUndo,
      redo: this.IsReadOnly || !this.CanRedo,
      "move-before": this.IsReadOnly || this.PageIndex <= 0,
      "move-after":
        this.IsReadOnly ||
        !this._engine ||
        this.PageIndex >= this.PageCount - 1,
      delete: this.IsReadOnly || this.PageCount <= 1,
      "replace-source": this.IsReadOnly || !this.SelectedTextOperator?.editable,
      "remove-source": this.IsReadOnly || !this.SelectedTextOperator?.editable,
    };
    for (const [command, disabled] of Object.entries(specific)) {
      const button = shadow.querySelector<HTMLButtonElement>(
        `[data-command="${command}"]`,
      );
      if (button) button.disabled = disabled;
    }
    const page = this.input("page");
    if (page) {
      page.value = String(this.PageIndex + 1);
      page.max = String(this.PageCount);
      page.disabled = !this._engine;
    }
    shadow.querySelector('[data-label="pages"]')!.textContent =
      `/ ${this.PageCount}`;
    shadow.querySelector('[data-label="zoom"]')!.textContent =
      `${Math.round(this.Zoom * 100)}%`;
    shadow.querySelector('[data-label="matches"]')!.textContent = this._matches
      .length
      ? `${this._matchIndex + 1} / ${this._matches.length}`
      : "";
    shadow.querySelector('[data-command="save"]')!.textContent =
      this.ViewMode === "flow" ? "Export reflow PDF" : "Save PDF";
    shadow
      .querySelector('[data-command="view-pdf"]')!
      .setAttribute("aria-pressed", String(this.ViewMode === "pdf"));
    shadow
      .querySelector('[data-command="reflow"]')!
      .setAttribute("aria-pressed", String(this.ViewMode === "flow"));
    if (this._scroll) this._scroll.hidden = this.ViewMode === "flow";
    const flow = shadow.querySelector<HTMLElement>(".flow-wrap");
    if (flow) flow.hidden = this.ViewMode !== "flow";
    shadow
      .querySelectorAll<HTMLElement>(".pdf-tools")
      .forEach((element) => (element.hidden = this.ViewMode === "flow"));
  }

  private async fileSelected(kind: string, file: File): Promise<void> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (kind === "open") await this.Load(bytes);
    if (kind === "insert") await this.InsertPages(bytes);
    if (kind === "image") {
      this._imageBytes = bytes;
      this.Tool = "image";
    }
    const input = this.shadowRoot?.querySelector<HTMLInputElement>(
      `[data-file="${kind}"]`,
    );
    if (input) input.value = "";
  }

  private async command(command: string): Promise<void> {
    if (
      command === "open" ||
      command === "insert-pages" ||
      command === "image"
    ) {
      this.shadowRoot
        ?.querySelector<HTMLInputElement>(
          `[data-file="${command === "insert-pages" ? "insert" : command}"]`,
        )
        ?.click();
      return;
    }
    if (command === "save") {
      const bytes =
        this.ViewMode === "flow"
          ? await this.ExportReflow()
          : await this.Save();
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(bytes).buffer], { type: "application/pdf" }),
      );
      const link = this.ownerDocument.createElement("a");
      link.href = url;
      link.download =
        this.ViewMode === "flow"
          ? "reconstructed-flow.pdf"
          : "edited-document.pdf";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
    if (command === "previous") this.PageIndex--;
    if (command === "next") this.PageIndex++;
    if (command === "zoom-out") this.Zoom = Math.max(0.25, this.Zoom - 0.1);
    if (command === "zoom-in") this.Zoom = Math.min(4, this.Zoom + 0.1);
    if (command === "fit") await this.FitWidth();
    if (command === "view-pdf") this.ViewMode = "pdf";
    if (command === "reflow") {
      if (this._flowDocument) this.ViewMode = "flow";
      else await this.ImportToFlowDocument();
    }
    if (command === "undo") await this.Undo();
    if (command === "redo") await this.Redo();
    if (command === "rotate")
      await this.RotatePage(
        this.PageIndex,
        this.requiredEngine().GetPages()[this.PageIndex].rotation + 90,
      );
    if (command === "delete") await this.DeletePages([this.PageIndex]);
    if (command === "add-page") await this.AddPage();
    if (command === "move-before" || command === "move-after") {
      const next = this.PageIndex + (command === "move-before" ? -1 : 1);
      const order = this.requiredEngine()
        .GetPages()
        .map((page) => page.index);
      [order[this.PageIndex], order[next]] = [
        order[next],
        order[this.PageIndex],
      ];
      await this.ReorderPages(order);
      this.PageIndex = next;
    }
    if (command === "inspect-source") await this.InspectSourceText();
    if (command === "replace-source" || command === "remove-source") {
      const selected = this.SelectedTextOperator;
      if (!selected) throw new Error("Select original PDF text first.");
      const replacement =
        command === "remove-source"
          ? ""
          : (this.input("source-replacement")?.value ?? "");
      await this.ReplaceTextOperator(
        selected.pageIndex,
        selected.id,
        replacement,
        {
          ...this.SourceTextReplacementOptions,
          expectedText: selected.text ?? undefined,
          preserveAdvance: this.input("preserve-advance")?.checked !== false,
        },
      );
      await this.InspectSourceText();
      this.status(
        "Original PDF text updated. Save PDF to download the modified content streams.",
      );
    }
    if (command === "replace-source-matches") {
      const result = await this.ReplaceSourceText(
        this.input("find")?.value ?? "",
        this.input("source-replacement")?.value ?? "",
        {
          ...this.SourceTextReplacementOptions,
          preserveAdvance: this.input("preserve-advance")?.checked !== false,
        },
      );
      await this.InspectSourceText();
      this.status(
        `Replaced ${result.occurrences} original text matches in ${result.pages.length} pages.`,
      );
    }
    if (command === "find") await this.Find(this.input("find")?.value ?? "");
    if (command === "find-next" && this._matches.length) {
      this._matchIndex = (this._matchIndex + 1) % this._matches.length;
      this.PageIndex = this._matches[this._matchIndex].pageIndex;
      this.drawSearch();
      this.updateToolbar();
    }
  }

  private localPoint(event: PointerEvent): { x: number; y: number } {
    const bounds = this._page!.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }
  private pointerDown(event: PointerEvent): void {
    if (
      this.Tool === "select" ||
      this.IsReadOnly ||
      !this._viewport ||
      event.button !== 0
    )
      return;
    event.preventDefault();
    this._page!.setPointerCapture(event.pointerId);
    const point = this.localPoint(event);
    const preview = ["highlight", "rectangle", "cover"].includes(this.Tool)
      ? this.ownerDocument.createElement("div")
      : null;
    if (preview) {
      preview.className = "drag-preview";
      this._page!.append(preview);
    }
    this._drag = { ...point, preview };
  }
  private pointerMove(event: PointerEvent): void {
    if (!this._drag?.preview) return;
    const point = this.localPoint(event),
      drag = this._drag;
    Object.assign(drag.preview!.style, {
      left: `${Math.min(point.x, drag.x)}px`,
      top: `${Math.min(point.y, drag.y)}px`,
      width: `${Math.abs(point.x - drag.x)}px`,
      height: `${Math.abs(point.y - drag.y)}px`,
    });
  }
  private async pointerUp(event: PointerEvent): Promise<void> {
    if (!this._drag || !this._viewport) return;
    const drag = this._drag;
    this._drag = null;
    drag.preview?.remove();
    const point = this.localPoint(event);
    const start = this._viewport.convertToPdfPoint(drag.x, drag.y),
      end = this._viewport.convertToPdfPoint(point.x, point.y);
    const color = this.input("color")?.value ?? "#2563eb";
    if (this.Tool === "text")
      await this.AddText(this.PageIndex, this.input("text")?.value ?? "", {
        x: end[0],
        y: end[1],
        fontSize: Number(this.input("size")?.value ?? 14),
        color,
      });
    else if (this.Tool === "image") {
      if (!this._imageBytes)
        throw new Error("Choose a PNG or JPEG image first.");
      await this.AddImage(this.PageIndex, this._imageBytes, {
        x: end[0],
        y: end[1],
        width: 120,
      });
    } else {
      if (Math.abs(point.x - drag.x) < 3 || Math.abs(point.y - drag.y) < 3)
        return;
      const region = {
        x: Math.min(start[0], end[0]),
        y: Math.min(start[1], end[1]),
        width: Math.abs(start[0] - end[0]),
        height: Math.abs(start[1] - end[1]),
      };
      if (this.Tool === "highlight")
        await this.Highlight(this.PageIndex, { ...region, color: "#ffff00" });
      if (this.Tool === "rectangle")
        await this.DrawRectangle(this.PageIndex, {
          ...region,
          color,
          opacity: 0.3,
          borderColor: color,
          borderWidth: 1,
        });
      if (this.Tool === "cover")
        await this.CoverRegion(this.PageIndex, { ...region, color: "#ffffff" });
    }
  }
}

export function registerPDFEditor(
  registry: CustomElementRegistry | undefined = globalThis.customElements,
): void {
  registerRichTextWeb(registry);
  if (registry && !registry.get("rich-pdf-editor"))
    registry.define("rich-pdf-editor", PDFEditorControl);
}

registerPDFEditor();
