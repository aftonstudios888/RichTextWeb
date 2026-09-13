import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  TextItem,
} from "pdfjs-dist/types/src/display/api.js";
import { FlowDocument, type DocumentNode } from "./model.js";

export interface PDFConfiguration {
  workerSrc?: string;
  cMapUrl?: string;
  standardFontDataUrl?: string;
  wasmUrl?: string;
  iccUrl?: string;
}

export interface PDFImportOptions extends PDFConfiguration {
  password?: string;
  /** Spatial order reconstructs lines and columns. Content order follows PDF text operators. */
  readingOrder?: "layout" | "content";
  preservePageBreaks?: boolean;
  /** Default 500; exceeding a limit rejects rather than truncating the document. */
  maxPages?: number;
  /** Default 200000 extracted text items across the document. */
  maxTextItems?: number;
  signal?: AbortSignal;
  onWarning?: (warning: string) => void;
}

export interface PDFTextGeometry {
  /** Coordinates in points, relative to the displayed page's top-left corner. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PDFExtractedRun extends PDFTextGeometry {
  text: string;
  fontName: string;
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  direction: string;
  /** Original PDF text transform in unrotated PDF coordinates. */
  transform: number[];
  sourceIndex: number;
}

export interface PDFExtractedLine extends PDFTextGeometry {
  text: string;
  runs: PDFExtractedRun[];
  column: number;
}

export interface PDFExtractedPage {
  index: number;
  /** Unrotated page crop-box size in PDF points. */
  width: number;
  height: number;
  displayWidth: number;
  displayHeight: number;
  rotation: number;
  cropBox: number[];
  text: string;
  lines: PDFExtractedLine[];
}

export interface PDFImportResult {
  document: FlowDocument;
  pages: PDFExtractedPage[];
  warnings: string[];
  metadata: Record<string, unknown>;
}

const configuration: PDFConfiguration = {};

/** Configure same-origin or CORS-enabled PDF.js assets once per application. */
export function configurePDF(options: PDFConfiguration): void {
  Object.assign(configuration, options);
  if (options.workerSrc)
    pdfjs.GlobalWorkerOptions.workerSrc = options.workerSrc;
}

export function configurePDFWorker(workerSrc: string): void {
  if (!workerSrc.trim()) throw new TypeError("PDF worker URL cannot be empty.");
  configurePDF({ workerSrc });
}

/** Internal shared loader. Bytes are copied so PDF.js cannot detach caller-owned buffers. */
export async function openPDFDocument(
  bytes: Uint8Array | ArrayBuffer,
  options: PDFImportOptions = {},
): Promise<{ document: PDFDocumentProxy; destroy(): Promise<void> }> {
  options.signal?.throwIfAborted();
  const settings = { ...configuration, ...options };
  if (settings.workerSrc)
    pdfjs.GlobalWorkerOptions.workerSrc = settings.workerSrc;
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes instanceof Uint8Array ? bytes : bytes.slice(0)),
    password: settings.password,
    cMapUrl: settings.cMapUrl,
    cMapPacked: true,
    standardFontDataUrl: settings.standardFontDataUrl,
    wasmUrl: settings.wasmUrl,
    iccUrl: settings.iccUrl,
    useSystemFonts: true,
    fontExtraProperties: true,
    enableXfa: false,
    stopAtErrors: true,
  });
  const abort = () => void task.destroy();
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    const document = await task.promise;
    options.signal?.throwIfAborted();
    return {
      document,
      async destroy() {
        options.signal?.removeEventListener("abort", abort);
        await task.destroy();
      },
    };
  } catch (error) {
    options.signal?.removeEventListener("abort", abort);
    await task.destroy();
    options.signal?.throwIfAborted();
    throw error;
  }
}

function mergeBounds(items: PDFTextGeometry[]): PDFTextGeometry {
  const x = Math.min(...items.map((item) => item.x));
  const y = Math.min(...items.map((item) => item.y));
  return {
    x,
    y,
    width: Math.max(...items.map((item) => item.x + item.width)) - x,
    height: Math.max(...items.map((item) => item.y + item.height)) - y,
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 12;
}

function lineFromRuns(runs: PDFExtractedRun[]): PDFExtractedLine {
  let text = "";
  runs.forEach((run, index) => {
    const previous = runs[index - 1];
    if (
      previous &&
      !/\s$/.test(text) &&
      !/^\s/.test(run.text) &&
      run.x - previous.x - previous.width >
        Math.min(previous.fontSize, run.fontSize) * 0.12
    )
      text += " ";
    text += run.text;
  });
  return { ...mergeBounds(runs), text, runs, column: 0 };
}

function reconstructLines(
  runs: PDFExtractedRun[],
  pageWidth: number,
): PDFExtractedLine[] {
  const rows: PDFExtractedRun[][] = [];
  for (const run of [...runs].sort((a, b) => a.y - b.y || a.x - b.x)) {
    let row = rows.find((candidate) => {
      const first = candidate[0];
      return (
        Math.abs(first.y + first.height - run.y - run.height) <
        Math.max(2, Math.min(first.height, run.height) * 0.4)
      );
    });
    if (!row) rows.push((row = []));
    row.push(run);
  }
  const lines: PDFExtractedLine[] = [];
  for (const row of rows) {
    const sorted = row.sort((a, b) => a.x - b.x);
    let group: PDFExtractedRun[] = [];
    for (const run of sorted) {
      const previous = group[group.length - 1];
      if (
        previous &&
        run.x - previous.x - previous.width >
          Math.max(run.fontSize * 3, pageWidth * 0.045)
      ) {
        lines.push(lineFromRuns(group));
        group = [];
      }
      group.push(run);
    }
    if (group.length) lines.push(lineFromRuns(group));
  }
  return lines;
}

/** Recursive whitespace segmentation provides useful reading order without claiming semantic recovery. */
function spatialOrder(lines: PDFExtractedLine[]): PDFExtractedLine[] {
  let column = 0;
  function gaps(
    items: PDFExtractedLine[],
    axis: "x" | "y",
  ): { split: number; size: number }[] {
    const extent = axis === "x" ? "width" : "height";
    const sorted = [...items].sort((a, b) => a[axis] - b[axis]);
    let end = sorted[0][axis] + sorted[0][extent];
    const result: { split: number; size: number }[] = [];
    for (const item of sorted.slice(1)) {
      if (item[axis] > end)
        result.push({ split: (end + item[axis]) / 2, size: item[axis] - end });
      end = Math.max(end, item[axis] + item[extent]);
    }
    return result.sort((a, b) => b.size - a.size);
  }
  function order(items: PDFExtractedLine[], depth: number): PDFExtractedLine[] {
    if (items.length <= 1 || depth > 30) return items;
    const fontSize = median(
      items.flatMap((line) => line.runs.map((run) => run.fontSize)),
    );
    const xGap = gaps(items, "x")[0];
    if (xGap && xGap.size > fontSize * 2) {
      const left = order(
        items.filter((line) => line.x < xGap.split),
        depth + 1,
      );
      column++;
      const right = order(
        items.filter((line) => line.x >= xGap.split),
        depth + 1,
      );
      return [...left, ...right];
    }
    const yGap = gaps(items, "y")[0];
    if (yGap && yGap.size > fontSize * 0.75)
      return [
        ...order(
          items.filter((line) => line.y < yGap.split),
          depth + 1,
        ),
        ...order(
          items.filter((line) => line.y >= yGap.split),
          depth + 1,
        ),
      ];
    return items
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((line) => ({ ...line, column }));
  }
  return lines.length ? order(lines, 0) : [];
}

/** Extract a page's positioned text; also used by the reusable viewer's search. */
export async function extractPDFPage(
  page: PDFPageProxy,
  options: PDFImportOptions = {},
): Promise<PDFExtractedPage> {
  options.signal?.throwIfAborted();
  const viewport = page.getViewport({ scale: 1 });
  const unrotated = page.getViewport({ scale: 1, rotation: 0 });
  const geometryScale = Math.hypot(
    viewport.transform[0],
    viewport.transform[1],
  );
  const text = await page.getTextContent();
  // This populates PDF.js's public font-object cache, retaining actual family/weight metadata.
  await page.getOperatorList();
  const runs: PDFExtractedRun[] = [];
  let sourceIndex = 0;
  for (const item of text.items) {
    if (!("str" in item) || !item.str) continue;
    const style = text.styles[item.fontName];
    const transform = pdfjs.Util.transform(viewport.transform, item.transform);
    const fontSize = Math.max(0.1, Math.hypot(transform[2], transform[3]));
    const angle = Math.atan2(transform[1], transform[0]);
    const ascent = Number.isFinite(style?.ascent) ? style.ascent : 0.8;
    const width = Math.abs(item.width) * geometryScale;
    const height = Math.max(
      0.1,
      Math.abs(item.height) * geometryScale || fontSize,
    );
    const x = transform[4] + Math.sin(angle) * fontSize * ascent;
    const y = transform[5] - Math.cos(angle) * fontSize * ascent;
    const xs = [
      x,
      x + Math.cos(angle) * width,
      x - Math.sin(angle) * height,
      x + Math.cos(angle) * width - Math.sin(angle) * height,
    ];
    const ys = [
      y,
      y + Math.sin(angle) * width,
      y + Math.cos(angle) * height,
      y + Math.sin(angle) * width + Math.cos(angle) * height,
    ];
    let font: any;
    try {
      font = page.commonObjs.get(item.fontName);
    } catch {
      /* Text still has geometric/font-family metadata. */
    }
    runs.push({
      text: item.str,
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
      fontName: font?.name ?? item.fontName,
      fontFamily:
        font?.name
          ?.replace(/^[A-Z]{6}\+/, "")
          .replace(/[-,](?:Bold|Italic|Oblique|Regular).*/i, "") ??
        style?.fontFamily ??
        "sans-serif",
      fontSize,
      bold: Boolean(font?.bold || font?.black),
      italic: Boolean(font?.italic),
      direction: item.dir,
      transform: item.transform.map(Number),
      sourceIndex: sourceIndex++,
    });
  }
  let lines = reconstructLines(runs, viewport.width);
  lines =
    options.readingOrder === "content"
      ? lines
          .map((line) =>
            lineFromRuns(
              line.runs.sort((a, b) => a.sourceIndex - b.sourceIndex),
            ),
          )
          .sort(
            (a, b) =>
              Math.min(...a.runs.map((run) => run.sourceIndex)) -
              Math.min(...b.runs.map((run) => run.sourceIndex)),
          )
      : spatialOrder(lines);
  return {
    index: page.pageNumber - 1,
    width: unrotated.width,
    height: unrotated.height,
    displayWidth: viewport.width,
    displayHeight: viewport.height,
    rotation: page.rotate,
    cropBox: [...page.view],
    text: lines.map((line) => line.text).join("\n"),
    lines,
  };
}

/** Genuine PDF text extraction with heuristic paragraph/reading-order reconstruction. No OCR is performed. */
export async function extractPDF(
  bytes: Uint8Array | ArrayBuffer,
  options: PDFImportOptions = {},
): Promise<PDFImportResult> {
  const maxPages = options.maxPages ?? 500;
  const maxItems = options.maxTextItems ?? 200000;
  if (
    !Number.isInteger(maxPages) ||
    maxPages < 1 ||
    !Number.isInteger(maxItems) ||
    maxItems < 1
  )
    throw new RangeError("PDF import limits must be positive integers.");
  const handle = await openPDFDocument(bytes, options);
  const warnings: string[] = [];
  const warn = (message: string) => {
    warnings.push(message);
    options.onWarning?.(message);
  };
  let nextId = 0;
  const node = (
    type: string,
    props: Record<string, any>,
    children?: DocumentNode[],
    text?: string,
  ): DocumentNode => ({
    type,
    id: `pdf-import-${++nextId}`,
    props,
    ...(children ? { children } : {}),
    ...(text !== undefined ? { text } : {}),
  });
  try {
    if (handle.document.numPages > maxPages)
      throw new RangeError(
        `PDF contains ${handle.document.numPages} pages; maxPages is ${maxPages}.`,
      );
    const pages: PDFExtractedPage[] = [];
    let count = 0;
    for (let index = 0; index < handle.document.numPages; index++) {
      options.signal?.throwIfAborted();
      const page = await extractPDFPage(
        await handle.document.getPage(index + 1),
        options,
      );
      count += page.lines.reduce((sum, line) => sum + line.runs.length, 0);
      if (count > maxItems)
        throw new RangeError(
          `PDF text item count exceeds maxTextItems (${maxItems}).`,
        );
      if (!page.lines.length)
        warn(
          `Page ${index + 1} contains no extractable text. Scans and image-only pages require OCR; images remain in the source PDF.`,
        );
      if (
        page.rotation !== 0 ||
        page.lines.some((line) =>
          line.runs.some(
            (run) =>
              run.direction !== "ltr" || Math.abs(run.transform[1]) > 0.01,
          ),
        )
      )
        warn(
          `Page ${index + 1} contains rotated or non-left-to-right text. Source geometry is retained; reflow reading order requires review.`,
        );
      pages.push(page);
    }
    const metadataResult = await handle.document.getMetadata();
    const metadata = metadataResult.info as Record<string, unknown>;
    const blocks: DocumentNode[] = [];
    for (const page of pages) {
      const paragraphs: {
        lines: PDFExtractedLine[];
        last: PDFExtractedLine;
      }[] = [];
      for (const line of page.lines) {
        const previous = paragraphs[paragraphs.length - 1];
        const last = previous?.last;
        const size = median(line.runs.map((run) => run.fontSize));
        const previousSize = last
          ? median(last.runs.map((run) => run.fontSize))
          : size;
        const gap = last ? line.y - last.y - last.height : 0;
        const continues =
          last &&
          line.column === last.column &&
          line.y > last.y &&
          gap < size * 0.8 &&
          gap > -size * 0.6 &&
          Math.abs(size - previousSize) < size * 0.2 &&
          Math.abs(line.x - last.x) < size * 1.5;
        if (continues) {
          previous.lines.push(line);
          previous.last = line;
        } else paragraphs.push({ lines: [line], last: line });
      }
      const pageBlocks = paragraphs.map((paragraph, paragraphIndex) => {
        const inlines: DocumentNode[] = [];
        paragraph.lines.forEach((line, lineIndex) => {
          line.runs.forEach((run, runIndex) => {
            const prior = line.runs[runIndex - 1];
            let prefix = "";
            if (
              runIndex === 0 &&
              lineIndex > 0 &&
              !/[\s-]$/.test(paragraph.lines[lineIndex - 1].text)
            )
              prefix = " ";
            else if (
              prior &&
              !/\s$/.test(prior.text) &&
              !/^\s/.test(run.text) &&
              run.x - prior.x - prior.width > run.fontSize * 0.12
            )
              prefix = " ";
            inlines.push(
              node(
                "Run",
                {
                  FontFamily: run.fontFamily,
                  FontSize: (run.fontSize * 4) / 3,
                  FontWeight: run.bold ? "Bold" : "Normal",
                  FontStyle: run.italic ? "Italic" : "Normal",
                  FlowDirection:
                    run.direction === "rtl" ? "RightToLeft" : "LeftToRight",
                  PDFGeometry: {
                    pageIndex: page.index,
                    x: run.x,
                    y: run.y,
                    width: run.width,
                    height: run.height,
                    transform: run.transform,
                  },
                },
                undefined,
                prefix + run.text,
              ),
            );
          });
        });
        return node(
          "Paragraph",
          {
            ...(paragraphIndex === 0 &&
            page.index > 0 &&
            options.preservePageBreaks !== false
              ? { BreakPageBefore: true }
              : {}),
            PDFGeometry: {
              pageIndex: page.index,
              ...mergeBounds(paragraph.lines),
            },
          },
          inlines,
        );
      });
      if (!pageBlocks.length)
        pageBlocks.push(
          node(
            "Paragraph",
            {
              PDFGeometry: { pageIndex: page.index },
              ...(page.index > 0 && options.preservePageBreaks !== false
                ? { BreakPageBefore: true }
                : {}),
            },
            [node("Run", {}, undefined, "")],
          ),
        );
      blocks.push(
        node(
          "Section",
          {
            PDFPageIndex: page.index,
            PDFPageWidth: page.width,
            PDFPageHeight: page.height,
            PDFPageRotation: page.rotation,
          },
          pageBlocks,
        ),
      );
    }
    warn(
      "Flow content is reconstructed from positioned PDF text. Paragraphs and reading order are inferred; images, vector art, forms, annotations, and exact page layout remain in the source PDF.",
    );
    const first = pages[0];
    const document = FlowDocument.FromJSON(
      node(
        "FlowDocument",
        {
          PageWidth: ((first?.displayWidth ?? 595.28) * 4) / 3,
          PageHeight: ((first?.displayHeight ?? 841.89) * 4) / 3,
          PagePadding: 48,
          Title:
            typeof metadata.Title === "string"
              ? metadata.Title
              : "Imported PDF",
          PDFReconstructed: true,
          PDFSourcePages: pages.map(({ lines, text, ...geometry }) => geometry),
          PDFImportWarnings: warnings,
        },
        blocks,
      ),
    );
    return { document, pages, warnings, metadata };
  } finally {
    await handle.destroy();
  }
}

export async function fromPDF(
  bytes: Uint8Array | ArrayBuffer,
  options: PDFImportOptions = {},
): Promise<FlowDocument> {
  return (await extractPDF(bytes, options)).document;
}

export { pdfjs };
