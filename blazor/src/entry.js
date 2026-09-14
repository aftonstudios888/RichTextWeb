import * as engine from '../../dist/esm/index.js';
import * as Pdf from '../../dist/esm/pdf.js';
engine.registerRichTextWeb();
Pdf.configurePDF({
  workerSrc: new URL('./vendor/pdf.worker.mjs', import.meta.url).href,
  cMapUrl: new URL('./vendor/cmaps/', import.meta.url).href,
  wasmUrl: new URL('./vendor/wasm/', import.meta.url).href,
  iccUrl: new URL('./vendor/iccs/', import.meta.url).href,
  useSystemFonts: true
});
Pdf.registerPDFEditor();
const tags = { editor: 'rich-text-box', pageEditor: 'rich-text-page-editor', reader: 'flow-document-reader', scrollViewer: 'flow-document-scroll-viewer', pageViewer: 'flow-document-page-viewer' };
const formats = { text: ['fromText', 'toText'], html: ['fromHTML', 'toHTML'], rtf: ['fromRTF', 'toRTF'], markdown: ['fromMarkdown', 'toMarkdown'], xaml: ['fromXAML', 'toXAML'], docx: ['fromDOCX', 'toDOCX'], pdf: ['fromPDF', 'toPDF'] };
function attribute(element, name, value) { if (element.getAttribute(name) !== value) element.setAttribute(name, value); }
function parseValue(value, format) {
  if (format === 'json') return value ? engine.FlowDocument.FromJSON(JSON.parse(value)) : engine.fromText('');
  const fn = formats[format]?.[0];
  if (!fn || typeof engine[fn] !== 'function' || ['docx', 'pdf'].includes(format)) throw new TypeError(`Unsupported synchronous value format: ${format}`);
  return engine[fn](value ?? '');
}
function printValue(document, format) {
  if (format === 'json') return JSON.stringify(document.ToJSON());
  const fn = formats[format]?.[1];
  if (!fn || typeof engine[fn] !== 'function' || ['docx', 'pdf'].includes(format)) throw new TypeError(`Unsupported synchronous value format: ${format}`);
  return engine[fn](document);
}
function proxy(controller) {
  return new Proxy(controller, {
    get(target, key) {
      const owner = key in target ? target : target.Editor;
      const value = Reflect.get(owner, key, owner);
      return typeof value === 'function' ? value.bind(owner) : value;
    },
    set(target, key, value) { const owner = key in target ? target : target.Editor; return Reflect.set(owner, key, value, owner); }
  });
}
export class RichTextController extends EventTarget {
  constructor(host) {
    super(); this.host = host; this.Editor = null; this.toolbar = null; this.listeners = [];
    this.revision = 0; this.format = 'html'; this.debounce = 150; this.pending = false; this.timer = null; this.applying = false; this.disposed = false; this.initialized = false;
  }
  check() { if (this.disposed) throw new Error('The rich text component has been disposed.'); }
  emit(name, detail) { if (!this.disposed) this.dispatchEvent(new CustomEvent(name, { detail })); }
  create(kind) {
    if (!tags[kind]) throw new TypeError(`Unknown rich text control kind: ${kind}`);
    const previous = this.Editor?.Document?.ToJSON();
    if (this.Editor) {
      for (const [name, handler] of this.listeners) this.Editor.removeEventListener(name, handler);
      this.listeners = []; this.toolbar?.remove(); this.toolbar = null;
      this.Editor.remove(); this.Editor.Dispose();
    }
    const editor = document.createElement(tags[kind]); this.Editor = editor; this.kind = kind;
    editor.style.cssText = 'display:block;flex:1 1 auto;min-height:0;width:100%;height:100%';
    if (previous) editor.Document = engine.FlowDocument.FromJSON(previous);
    const listen = (name, handler) => { editor.addEventListener(name, handler); this.listeners.push([name, handler]); };
    listen('documentchange', () => {
      if (this.applying || this.disposed) return;
      this.revision++; this.pending = true;
      this.emit('documentchange', { revision: this.revision, length: editor.Text.length, canUndo: editor.CanUndo, canRedo: editor.CanRedo });
      clearTimeout(this.timer);
      if (this.debounce === 0) this.notifyValue(); else this.timer = setTimeout(() => this.notifyValue(), this.debounce);
    });
    listen('selectionchange', event => this.emit('selectionchange', { start: event.detail.start, end: event.detail.end, text: event.detail.text }));
    listen('commandstatechange', event => this.emit('commandstatechange', event.detail));
    listen('paginated', event => this.emit('paginated', { pageCount: event.detail.layout?.PageCount, overflowCount: event.detail.layout?.Overflows?.length ?? 0 }));
    listen('pagechange', event => this.emit('pagechange', { pageNumber: event.detail.pageNumber, pageCount: event.detail.pageCount }));
    listen('objectselectionchange', () => this.emit('objectselectionchange', { id: editor.SelectedObjectId }));
    this.host.append(editor);
  }
  Configure(options) {
    this.check();
    const kind = options.kind ?? 'editor', format = String(options.valueFormat ?? 'html').toLowerCase();
    if (!['text', 'html', 'json', 'rtf', 'markdown', 'xaml'].includes(format)) throw new TypeError(`Invalid bound value format: ${format}`);
    const debounce = options.debounceMilliseconds ?? 150;
    if (!Number.isInteger(debounce) || debounce < 0 || debounce > 60000) throw new RangeError('DebounceMilliseconds must be between 0 and 60000.');
    const changedKind = this.kind !== kind;
    if (changedKind) this.create(kind);
    const editor = this.Editor; this.debounce = debounce;
    const force = !this.initialized || this.format !== format || this.valueRevision !== (options.valueRevision ?? 0);
    const staleAcknowledgment = !force && options.ackRevision >= 0 && options.ackRevision < this.revision;
    this.applying = true;
    try {
      if (options.document) {
        if (changedKind || this.lastDocument !== options.document) { editor.Document = options.document; this.revision++; }
      } else if (!staleAcknowledgment && (force || options.value !== this.lastParameterValue || this.lastDocument)) {
        const value = options.value ?? '';
        if (force || printValue(editor.Document, format) !== value) { editor.Document = parseValue(value, format); this.revision++; }
        this.pending = false; clearTimeout(this.timer);
      }
      this.lastDocument = options.document ?? null; this.lastParameterValue = options.value;
      this.valueRevision = options.valueRevision ?? 0; this.format = format; this.initialized = true;
      for (const [name, value] of Object.entries(options.native ?? {})) if (editor[name] !== value) editor[name] = value;
      attribute(editor, 'theme', options.theme ?? 'light'); attribute(editor, 'aria-label', options.ariaLabel ?? 'Rich text editor'); attribute(editor, 'placeholder', options.placeholder ?? '');
      if (options.showToolbar) {
        if (!this.toolbar) {
          this.toolbar = document.createElement('rich-text-toolbar'); this.toolbar.style.cssText = 'display:block;flex:0 0 auto';
          this.toolbar.Editor = editor; this.host.prepend(this.toolbar);
        }
        if (this.toolbar.Mode !== (options.toolbarMode ?? 'all')) this.toolbar.Mode = options.toolbarMode ?? 'all';
        attribute(this.toolbar, 'theme', options.theme ?? 'light');
      } else if (this.toolbar) { this.toolbar.remove(); this.toolbar = null; }
    } finally { this.applying = false; }
  }
  notifyValue() {
    clearTimeout(this.timer); this.timer = null;
    if (!this.pending || this.disposed) return;
    this.pending = false;
    this.emit('blazor-valuechange', { revision: this.revision });
  }
  ReadBinding() { this.check(); return { revision: this.revision, value: printValue(this.Editor.Document, this.format) }; }
  FlushChanges() { this.check(); this.notifyValue(); return this.ReadBinding(); }
  GetValue(format = this.format) { this.check(); return printValue(this.Editor.Document, format); }
  GetNativeEditor() { this.check(); return this.Editor; }
  async Repaginate() {
    this.check(); if (typeof this.Editor.Repaginate !== 'function') throw new Error('Use a page editor or page viewer for measured pagination.');
    const result = await this.Editor.Repaginate();
    return { pageCount: result.PageCount, overflowCount: result.Overflows.length, documentRevision: result.DocumentRevision, pageNumber: this.Editor.PageNumber };
  }
  async ExportBytes(format, options = {}) {
    this.check(); format = format.toLowerCase();
    if (format === 'json') return new TextEncoder().encode(JSON.stringify(this.Editor.Document.ToJSON()));
    const name = formats[format]?.[1], fn = engine[name] ?? Pdf[name];
    if (typeof fn !== 'function') throw new TypeError(`Unsupported export format: ${format}`);
    const result = await fn(this.Editor.Document, options);
    return typeof result === 'string' ? new TextEncoder().encode(result) : new Uint8Array(result);
  }
  async ImportBytes(format, bytes, options = {}) {
    this.check(); format = format.toLowerCase(); const version = this.revision;
    let document;
    if (format === 'json') document = engine.FlowDocument.FromJSON(JSON.parse(new TextDecoder().decode(bytes)));
    else {
      const name = formats[format]?.[0], fn = engine[name] ?? Pdf[name];
      if (typeof fn !== 'function') throw new TypeError(`Unsupported import format: ${format}`);
      document = await fn(['docx', 'pdf'].includes(format) ? bytes : new TextDecoder().decode(bytes), options);
    }
    this.check();
    if (this.revision !== version) throw new Error('The document changed during import; the imported result was not applied.');
    this.Editor.Document = document; this.notifyValue();
  }
  Dispose() {
    if (this.disposed) return; this.disposed = true; clearTimeout(this.timer);
    for (const [name, handler] of this.listeners) this.Editor?.removeEventListener(name, handler);
    this.listeners = []; this.toolbar?.remove();
    this.Editor?.remove(); this.Editor?.Dispose(); this.host.remove();
  }
}
export class PdfController extends EventTarget {
  constructor(host) {
    super(); this.host = host; this.Editor = document.createElement('rich-pdf-editor'); this.Editor.style.cssText = 'display:block;width:100%;height:100%';
    this.listeners = []; this.disposed = false; this.source = null; this.sourceRevision = null;
    for (const name of ['pdfload', 'pdfchange', 'pdferror', 'pagechange', 'flowdocumentchange', 'flowdocumentimport']) {
      const handler = event => this.dispatchEvent(new CustomEvent(name, { detail: { pageCount: this.Editor.PageCount, pageIndex: this.Editor.PageIndex, canUndo: this.Editor.CanUndo, canRedo: this.Editor.CanRedo, message: event.detail?.message ?? null } }));
      this.Editor.addEventListener(name, handler); this.listeners.push([name, handler]);
    }
    host.append(this.Editor);
  }
  async Configure(options) {
    if (this.disposed) throw new Error('The PDF component has been disposed.');
    if (options.source) {
      const bytes = options.source;
      const same = this.sourceRevision === options.sourceRevision && this.source?.length === bytes.length && this.source.every((value, index) => value === bytes[index]);
      if (!same) { await this.Editor.Load(bytes, options.importOptions ?? {}); this.source = new Uint8Array(bytes); this.sourceRevision = options.sourceRevision; }
    }
    for (const [name, value] of Object.entries(options.native ?? {})) {
      if (this.Editor[name] === value) continue;
      if (name === 'ViewMode') await this.SetViewMode(value);
      else this.Editor[name] = value;
    }
    attribute(this.Editor, 'theme', options.theme ?? 'light');
  }
  async SetViewMode(value) {
    if (this.disposed) throw new Error('The PDF component has been disposed.');
    if (value !== 'pdf' && value !== 'flow') throw new TypeError('View mode must be pdf or flow.');
    if (value === 'flow' && !this.Editor.FlowDocument) await this.Editor.ImportToFlowDocument();
    if (this.disposed) throw new Error('The PDF component has been disposed.');
    this.Editor.ViewMode = value;
  }
  AddPage(width, height) { return this.Editor.AddPage(width ?? undefined, height ?? undefined); }
  InsertPages(bytes, indices, insertionIndex) { return this.Editor.InsertPages(bytes, indices ?? undefined, insertionIndex ?? undefined); }
  GetInfo() { return { pageCount: this.Editor.PageCount, pageIndex: this.Editor.PageIndex, zoom: this.Editor.Zoom, canUndo: this.Editor.CanUndo, canRedo: this.Editor.CanRedo, viewMode: this.Editor.ViewMode }; }
  GetNativeEditor() { return this.Editor; }
  async Dispose() {
    if (this.disposed) return; this.disposed = true;
    for (const [name, handler] of this.listeners) this.Editor.removeEventListener(name, handler);
    this.listeners = []; this.Editor.remove(); await this.Editor.Dispose(); this.source = null; this.host.remove();
  }
}
export const api = { ...engine, Pdf, RichTextController, PdfController };
export async function mount(host, options) {
  const inner = document.createElement('div'); inner.style.cssText = 'display:flex;flex-direction:column;min-height:0;height:100%;width:100%'; host.append(inner);
  const controller = options.kind === 'pdf' ? new PdfController(inner) : new RichTextController(inner);
  try { await controller.Configure(options); return proxy(controller); }
  catch (error) { await controller.Dispose(); inner.remove(); throw error; }
}
export async function update(controller, options) { await controller.Configure(options); }
