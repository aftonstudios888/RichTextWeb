/** Optional PDF.js-powered import/view/edit entrypoint, isolated from the core browser bundle. */
export * from "./formats-pdf.js";
export {
  configurePDF,
  configurePDFWorker,
  extractPDF,
  fromPDF,
  type PDFConfiguration,
  type PDFImportOptions,
  type PDFImportResult,
  type PDFExtractedPage,
  type PDFExtractedRun,
  type PDFExtractedLine,
  type PDFTextGeometry,
} from "./pdf-import.js";
export {
  PDFEditorControl,
  registerPDFEditor,
  type PDFTool,
  type PDFSearchMatch,
} from "./pdf-control.js";
