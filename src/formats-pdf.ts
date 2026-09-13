import {
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFPage,
  StandardFonts,
  degrees,
  rgb,
  type Color,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { FlowDocument, type DocumentNode } from "./model.js";

/** PDF coordinates are points (1/72 inch). FlowDocument dimensions are CSS pixels. */
export interface PDFExportOptions {
  /** Override page size in PDF points. Default is A4, or the document's CSS pixel page size. */
  pageWidth?: number;
  pageHeight?: number;
  /** Override page margins in PDF points. */
  margin?:
    number | { left: number; top: number; right: number; bottom: number };
  title?: string;
  author?: string;
  subject?: string;
  /** Standard PDF fonts cover WinAnsi. Unsupported characters throw by default. */
  unsupportedGlyphs?: "error" | "replace";
  /** Embed a supplied TTF/OTF font. Its character map is checked before drawing. */
  fontBytes?: Uint8Array | ArrayBuffer;
  /** Optional style faces. An absent face uses fontBytes, retaining the supplied font's actual face. */
  fontStyleBytes?: {
    bold?: Uint8Array | ArrayBuffer;
    italic?: Uint8Array | ArrayBuffer;
    boldItalic?: Uint8Array | ArrayBuffer;
  };
  /** Called for each explicitly replaced unsupported character. */
  onWarning?: (message: string) => void;
  /** Text drawn in the bottom margin after pagination. */
  pageNumbers?: boolean;
}

export interface PDFPageInfo {
  index: number;
  width: number;
  height: number;
  rotation: number;
}

export interface PDFTextOptions {
  x: number;
  y: number;
  fontSize?: number;
  fontFamily?: "Helvetica" | "Times" | "Courier";
  bold?: boolean;
  italic?: boolean;
  color?: string;
  opacity?: number;
  maxWidth?: number;
  lineHeight?: number;
  /** Embed a custom font for this overlay. Supersedes fontFamily, bold and italic. */
  fontBytes?: Uint8Array | ArrayBuffer;
}

export interface PDFRectangleOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  borderColor?: string;
  borderWidth?: number;
  opacity?: number;
}

export interface PDFImageOptions {
  x: number;
  y: number;
  width?: number;
  height?: number;
  opacity?: number;
}

type Props = Record<string, any>;
type Insets = { left: number; top: number; right: number; bottom: number };
type Fragment = { text: string; props: Props; image?: DocumentNode };
type Piece = {
  text: string;
  props: Props;
  font: PDFFont;
  size: number;
  width: number;
  height: number;
  image?: PDFImage;
};
type Line = { pieces: Piece[]; width: number; height: number };
const PIXEL = 0.75;

function finite(value: unknown, fallback: number): number {
  const result =
    typeof value === "string" ? Number.parseFloat(value) : Number(value);
  return value !== undefined && value !== null && Number.isFinite(result)
    ? result
    : fallback;
}

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0)
    throw new RangeError(`${name} must be a positive finite number.`);
  return value;
}

function insets(value: any, fallback: number, scale = 1): Insets {
  if (value === undefined || value === null)
    return { left: fallback, top: fallback, right: fallback, bottom: fallback };
  if (typeof value === "number")
    return {
      left: value * scale,
      top: value * scale,
      right: value * scale,
      bottom: value * scale,
    };
  if (typeof value === "string") {
    const values = value.split(/[ ,]+/).map(Number);
    if (values.length === 1 && Number.isFinite(values[0]))
      return insets(values[0], fallback, scale);
    if (values.length === 2 && values.every(Number.isFinite))
      return {
        left: values[0] * scale,
        top: values[1] * scale,
        right: values[0] * scale,
        bottom: values[1] * scale,
      };
    if (values.length === 4 && values.every(Number.isFinite))
      return {
        left: values[0] * scale,
        top: values[1] * scale,
        right: values[2] * scale,
        bottom: values[3] * scale,
      };
    throw new TypeError("Invalid Thickness value for PDF export.");
  }
  return {
    left: finite(value.Left ?? value.left, fallback / scale) * scale,
    top: finite(value.Top ?? value.top, fallback / scale) * scale,
    right: finite(value.Right ?? value.right, fallback / scale) * scale,
    bottom: finite(value.Bottom ?? value.bottom, fallback / scale) * scale,
  };
}

function color(value: any, fallback = "#111827"): Color {
  if (value === undefined || value === null || value === "") value = fallback;
  if (typeof value !== "string")
    throw new TypeError(
      "PDF colors must be CSS hex, rgb(), or supported named color strings.",
    );
  const named: Record<string, string> = {
    black: "#000000",
    white: "#ffffff",
    red: "#ff0000",
    green: "#008000",
    blue: "#0000ff",
    yellow: "#ffff00",
    gray: "#808080",
    grey: "#808080",
    orange: "#ffa500",
    purple: "#800080",
    navy: "#000080",
    transparent: "#ffffff",
  };
  const normalized = named[value.toLowerCase()] ?? value.trim();
  const hex = normalized.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (hex) {
    const h =
      hex[1].length === 3
        ? hex[1]
            .split("")
            .map((c) => c + c)
            .join("")
        : hex[1];
    return rgb(
      parseInt(h.slice(0, 2), 16) / 255,
      parseInt(h.slice(2, 4), 16) / 255,
      parseInt(h.slice(4, 6), 16) / 255,
    );
  }
  const match = normalized.match(
    /^rgb\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*\)$/i,
  );
  if (match && match.slice(1).every((n) => Number(n) >= 0 && Number(n) <= 255))
    return rgb(
      Number(match[1]) / 255,
      Number(match[2]) / 255,
      Number(match[3]) / 255,
    );
  throw new TypeError(
    `Unsupported PDF color: ${value}. Use #RGB, #RRGGBB or rgb(r,g,b).`,
  );
}

function fontName(props: Props): StandardFonts {
  const family = String(props.FontFamily ?? "Helvetica").toLowerCase();
  const bold =
    /bold|semibold|demibold|black|heavy/i.test(String(props.FontWeight)) ||
    finite(props.FontWeight, 0) >= 600;
  const italic = /italic|oblique/i.test(String(props.FontStyle));
  if (/courier|mono|consolas/.test(family))
    return bold
      ? italic
        ? StandardFonts.CourierBoldOblique
        : StandardFonts.CourierBold
      : italic
        ? StandardFonts.CourierOblique
        : StandardFonts.Courier;
  if (/times|serif|georgia|cambria/.test(family) && !/sans/.test(family))
    return bold
      ? italic
        ? StandardFonts.TimesRomanBoldItalic
        : StandardFonts.TimesRomanBold
      : italic
        ? StandardFonts.TimesRomanItalic
        : StandardFonts.TimesRoman;
  return bold
    ? italic
      ? StandardFonts.HelveticaBoldOblique
      : StandardFonts.HelveticaBold
    : italic
      ? StandardFonts.HelveticaOblique
      : StandardFonts.Helvetica;
}

function inherited(node: DocumentNode, parent: Props): Props {
  const result = { ...parent, ...node.props };
  if (node.type === "Bold") result.FontWeight = "Bold";
  if (node.type === "Italic") result.FontStyle = "Italic";
  if (node.type === "Underline") result.TextDecorations = "Underline";
  return result;
}

async function embedImage(
  pdf: PDFDocument,
  source: string | Uint8Array | ArrayBuffer | number[],
): Promise<PDFImage> {
  if (typeof source === "string" && /^data:image\/png;base64,/i.test(source))
    return pdf.embedPng(source);
  if (
    typeof source === "string" &&
    /^data:image\/(jpeg|jpg);base64,/i.test(source)
  )
    return pdf.embedJpg(source);
  if (
    source instanceof Uint8Array ||
    source instanceof ArrayBuffer ||
    Array.isArray(source)
  ) {
    const bytes =
      source instanceof Uint8Array
        ? source
        : source instanceof ArrayBuffer
          ? new Uint8Array(source)
          : new Uint8Array(source);
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return pdf.embedPng(bytes);
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return pdf.embedJpg(bytes);
    throw new Error("PDF image bytes must contain a PNG or JPEG.");
  }
  throw new Error(
    "PDF image Source must be embedded PNG/JPEG data or bytes; remote image fetching is not performed.",
  );
}

function inlineFragments(node: DocumentNode, parent: Props): Fragment[] {
  const props = inherited(node, parent);
  if (node.type === "LineBreak") return [{ text: "\n", props }];
  if (node.type === "Image") return [{ text: "", props, image: node }];
  const result: Fragment[] = [];
  if (typeof node.text === "string") result.push({ text: node.text, props });
  for (const child of node.children ?? [])
    result.push(...inlineFragments(child, props));
  return result;
}

/** Export the canonical flow model to a paginated, selectable-text PDF. */
export async function toPDF(
  document: FlowDocument,
  options: PDFExportOptions = {},
): Promise<Uint8Array> {
  const source = document.ToJSON();
  const props = source.props ?? {};
  const width = positive(
    options.pageWidth ?? finite(props.PageWidth, 793.7008) * PIXEL,
    "Page width",
  );
  const height = positive(
    options.pageHeight ?? finite(props.PageHeight, 1122.5197) * PIXEL,
    "Page height",
  );
  const margin =
    options.margin !== undefined
      ? insets(options.margin, 54)
      : insets(props.PagePadding, 54, PIXEL);
  if (Object.values(margin).some((n) => !Number.isFinite(n) || n < 0))
    throw new RangeError("Page margins must be finite and nonnegative.");
  const availableWidth = positive(
    width - margin.left - margin.right,
    "Page content width",
  );
  const availableHeight = positive(
    height - margin.top - margin.bottom,
    "Page content height",
  );
  if (finite(props.ColumnCount, 1) !== 1)
    throw new Error(
      "PDF export does not support multi-column FlowDocument layout.",
    );
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setProducer("RichTextWeb / pdf-lib");
  pdf.setCreator("RichTextWeb");
  if (options.title ?? props.Title) pdf.setTitle(options.title ?? props.Title);
  if (options.author) pdf.setAuthor(options.author);
  if (options.subject) pdf.setSubject(options.subject);
  const fonts = new Map<StandardFonts, PDFFont>();
  const embeddedFonts = new Map<Uint8Array | ArrayBuffer, PDFFont>();
  const characterSets = new Map<PDFFont, Set<number>>();
  const images = new Map<any, PDFImage>();
  const pageFonts = new WeakMap<PDFPage, PDFFont>();
  let page = pdf.addPage([width, height]);
  let y = height - margin.top;

  async function getFont(p: Props): Promise<PDFFont> {
    const name = fontName(p);
    if (options.fontBytes) {
      const bold = /Bold/.test(name);
      const italic = /Italic|Oblique/.test(name);
      const bytes =
        (bold && italic
          ? options.fontStyleBytes?.boldItalic
          : bold
            ? options.fontStyleBytes?.bold
            : italic
              ? options.fontStyleBytes?.italic
              : undefined) ?? options.fontBytes;
      if (!embeddedFonts.has(bytes))
        embeddedFonts.set(bytes, await pdf.embedFont(bytes, { subset: true }));
      return embeddedFonts.get(bytes)!;
    }
    if (!fonts.has(name)) fonts.set(name, await pdf.embedFont(name));
    return fonts.get(name)!;
  }

  function encode(text: string, font: PDFFont): string {
    if (!characterSets.has(font))
      characterSets.set(font, new Set(font.getCharacterSet()));
    const supported = characterSets.get(font)!;
    let result = "";
    for (const character of text) {
      if (character === "\n" || character === "\r") {
        result += character;
        continue;
      }
      const normalized = character === "\t" ? "    " : character;
      try {
        if (
          Array.from(normalized).some(
            (char) => !supported.has(char.codePointAt(0)!),
          )
        )
          throw new Error("Missing glyph");
        font.encodeText(normalized);
        result += normalized;
      } catch {
        const message = `PDF font ${font.name} cannot encode U+${character.codePointAt(0)!.toString(16).toUpperCase()} (${JSON.stringify(character)}).`;
        if (options.unsupportedGlyphs !== "replace")
          throw new Error(
            `${message} Supply fontBytes with the required glyphs, or explicitly select unsupportedGlyphs: 'replace'.`,
          );
        if (!supported.has(0x3f))
          throw new Error(
            `${message} This font also lacks the replacement question mark.`,
          );
        options.onWarning?.(message);
        result += "?";
      }
    }
    return result;
  }

  async function getImage(node: DocumentNode): Promise<PDFImage> {
    const src = node.props.Source;
    if (images.has(src)) return images.get(src)!;
    const image = await embedImage(pdf, src);
    images.set(src, image);
    return image;
  }

  function newPage(): void {
    page = pdf.addPage([width, height]);
    y = height - margin.top;
  }
  function ensureSpace(amount: number): void {
    if (amount > availableHeight + 0.01)
      throw new RangeError(
        "A PDF line or image is taller than the page content area.",
      );
    if (y - amount < margin.bottom - 0.01) newPage();
  }

  async function lines(
    fragments: Fragment[],
    maxWidth: number,
    paragraph: Props,
  ): Promise<Line[]> {
    positive(maxWidth, "Paragraph content width");
    const size = positive(finite(paragraph.FontSize, 16) * PIXEL, "Font size");
    const baseHeight = Math.max(
      size * 1.25,
      finite(paragraph.LineHeight, 0) * PIXEL,
    );
    const result: Line[] = [];
    let current: Line = { pieces: [], width: 0, height: baseHeight };
    const flush = () => {
      result.push(current);
      current = { pieces: [], width: 0, height: baseHeight };
    };
    for (const fragment of fragments) {
      const font = await getFont(fragment.props);
      const fontSize = positive(
        finite(fragment.props.FontSize, 16) * PIXEL,
        "Font size",
      );
      const lineHeight = Math.max(
        fontSize * 1.25,
        finite(fragment.props.LineHeight, 0) * PIXEL,
      );
      if (fragment.image) {
        const image = await getImage(fragment.image);
        let imageWidth =
          finite(fragment.props.Width, image.width / PIXEL) * PIXEL;
        let imageHeight =
          finite(
            fragment.props.Height,
            ((image.height / image.width) * imageWidth) / PIXEL,
          ) * PIXEL;
        positive(imageWidth, "Image width");
        positive(imageHeight, "Image height");
        const scale = Math.min(
          1,
          maxWidth / imageWidth,
          positive(availableHeight - 2, "Image content height") / imageHeight,
        );
        imageWidth *= scale;
        imageHeight *= scale;
        if (current.width + imageWidth > maxWidth && current.pieces.length)
          flush();
        current.pieces.push({
          text: "",
          props: fragment.props,
          font,
          size: fontSize,
          width: imageWidth,
          height: imageHeight,
          image,
        });
        current.width += imageWidth;
        current.height = Math.max(current.height, imageHeight + 2);
        continue;
      }
      const text = encode(fragment.text.replace(/\r\n?/g, "\n"), font);
      const tokens = text.match(/\n|[^\S\n]+|[^\s]+/g) ?? [];
      for (const token of tokens) {
        if (token === "\n") {
          flush();
          continue;
        }
        let remaining = token;
        while (remaining) {
          const tokenWidth = font.widthOfTextAtSize(remaining, fontSize);
          if (tokenWidth <= maxWidth - current.width + 0.0001) {
            current.pieces.push({
              text: remaining,
              props: fragment.props,
              font,
              size: fontSize,
              width: tokenWidth,
              height: lineHeight,
            });
            current.width += tokenWidth;
            current.height = Math.max(current.height, lineHeight);
            break;
          }
          if (current.pieces.length) {
            flush();
            if (/^\s+$/.test(remaining)) break;
            continue;
          }
          let count = 0;
          let partWidth = 0;
          for (const char of remaining) {
            const charWidth = font.widthOfTextAtSize(char, fontSize);
            if (partWidth + charWidth > maxWidth + 0.0001) break;
            partWidth += charWidth;
            count += char.length;
          }
          if (!count)
            throw new RangeError(
              "A text glyph is wider than the available PDF content width.",
            );
          current.pieces.push({
            text: remaining.slice(0, count),
            props: fragment.props,
            font,
            size: fontSize,
            width: partWidth,
            height: lineHeight,
          });
          current.width = partWidth;
          current.height = Math.max(current.height, lineHeight);
          remaining = remaining.slice(count);
          if (remaining) flush();
        }
      }
    }
    if (
      current.pieces.length ||
      !result.length ||
      fragments[fragments.length - 1]?.text.endsWith("\n")
    )
      result.push(current);
    // Adjacent tokens from a run use one drawing operation per line.
    for (const line of result) {
      const merged: Piece[] = [];
      for (const piece of line.pieces) {
        const previous = merged[merged.length - 1];
        if (
          previous &&
          !previous.image &&
          !piece.image &&
          previous.props === piece.props &&
          previous.font === piece.font &&
          previous.size === piece.size
        ) {
          previous.text += piece.text;
          previous.width += piece.width;
        } else merged.push({ ...piece });
      }
      line.pieces = merged;
    }
    return result;
  }

  function drawLine(
    line: Line,
    x: number,
    top: number,
    lineWidth: number,
    p: Props,
  ): void {
    const alignment = String(p.TextAlignment ?? "Left").toLowerCase();
    if (alignment === "right") x += lineWidth - line.width;
    else if (alignment === "center") x += (lineWidth - line.width) / 2;
    for (const piece of line.pieces) {
      if (piece.image) {
        page.drawImage(piece.image, {
          x,
          y: top - piece.height,
          width: piece.width,
          height: piece.height,
        });
      } else if (piece.text) {
        const baseline =
          top - line.height + Math.max(2, (line.height - piece.size) * 0.5);
        if (
          piece.props.Background &&
          String(piece.props.Background).toLowerCase() !== "transparent"
        )
          page.drawRectangle({
            x,
            y: top - line.height,
            width: piece.width,
            height: line.height,
            color: color(piece.props.Background),
          });
        if (pageFonts.get(page) !== piece.font) {
          page.setFont(piece.font);
          pageFonts.set(page, piece.font);
        }
        page.drawText(piece.text, {
          x,
          y: baseline,
          size: piece.size,
          color: color(piece.props.Foreground),
        });
        const decoration = String(
          piece.props.TextDecorations ?? "",
        ).toLowerCase();
        if (decoration.includes("underline"))
          page.drawLine({
            start: { x, y: baseline - 1.5 },
            end: { x: x + piece.width, y: baseline - 1.5 },
            thickness: Math.max(0.5, piece.size / 15),
            color: color(piece.props.Foreground),
          });
        if (decoration.includes("strikethrough"))
          page.drawLine({
            start: { x, y: baseline + piece.size * 0.3 },
            end: { x: x + piece.width, y: baseline + piece.size * 0.3 },
            thickness: Math.max(0.5, piece.size / 15),
            color: color(piece.props.Foreground),
          });
      }
      x += piece.width;
    }
  }

  async function paragraph(
    node: DocumentNode,
    parent: Props,
    x: number,
    span: number,
    prefix = "",
  ): Promise<void> {
    const p = inherited(node, parent);
    const gap = insets(node.props.Margin, 0, PIXEL);
    if (p.BreakPageBefore && y < height - margin.top - 0.01) newPage();
    const fontSize = positive(finite(p.FontSize, 16) * PIXEL, "Font size");
    if (gap.top + fontSize * 1.25 > availableHeight)
      throw new RangeError(
        "Paragraph top margin exceeds the available PDF page height.",
      );
    ensureSpace(gap.top + fontSize * 1.25);
    y -= gap.top;
    const contentWidth = span - gap.left - gap.right;
    const fragments = inlineFragments(node, parent);
    if (prefix) fragments.unshift({ text: prefix, props: p });
    const paragraphLines = await lines(fragments, contentWidth, p);
    const firstIndent = finite(p.TextIndent, 0) * PIXEL;
    if (firstIndent !== 0) {
      // Separate layout ensures a first-line indent can never push text outside its box.
      const indentLines = await lines(
        fragments,
        contentWidth - Math.max(0, firstIndent),
        p,
      );
      for (let index = 0; index < indentLines.length; index++) {
        const line = indentLines[index];
        ensureSpace(line.height);
        drawLine(
          line,
          x + gap.left + (index === 0 ? firstIndent : 0),
          y,
          contentWidth - Math.max(0, firstIndent),
          p,
        );
        y -= line.height;
      }
    } else {
      for (const line of paragraphLines) {
        ensureSpace(line.height);
        drawLine(line, x + gap.left, y, contentWidth, p);
        y -= line.height;
      }
    }
    y -= Math.max(0, gap.bottom || fontSize * 0.4);
  }

  async function table(
    node: DocumentNode,
    parent: Props,
    x: number,
    span: number,
  ): Promise<void> {
    const p = inherited(node, parent);
    const rows = (node.children ?? [])
      .flatMap((group) =>
        group.type === "TableRowGroup" ? (group.children ?? []) : [group],
      )
      .filter((row) => row.type === "TableRow");
    const columns = Math.max(
      1,
      ...rows.map((row) =>
        (row.children ?? []).reduce(
          (count, cell) =>
            count + Math.max(1, finite(cell.props.ColumnSpan, 1)),
          0,
        ),
      ),
    );
    const columnWidth = span / columns;
    for (const row of rows) {
      const cells: {
        lines: Line[];
        width: number;
        props: Props;
        pad: Insets;
        offset: number;
      }[] = [];
      let offset = 0;
      for (const cell of row.children ?? []) {
        if (finite(cell.props.RowSpan, 1) !== 1)
          throw new Error(
            "PDF table export does not support RowSpan greater than one.",
          );
        const cellProps = inherited(cell, inherited(row, p));
        const cellWidth =
          columnWidth * Math.max(1, finite(cell.props.ColumnSpan, 1));
        const pad = insets(cell.props.Padding, 4, PIXEL);
        const cellLines: Line[] = [];
        async function collect(
          block: DocumentNode,
          ancestor: Props,
        ): Promise<void> {
          if (block.type === "Table")
            throw new Error("PDF export does not support nested tables.");
          if (block.type === "Paragraph" || block.type === "Image")
            cellLines.push(
              ...(await lines(
                inlineFragments(block, ancestor),
                cellWidth - pad.left - pad.right,
                inherited(block, ancestor),
              )),
            );
          else
            for (const child of block.children ?? [])
              await collect(child, inherited(block, ancestor));
        }
        for (const block of cell.children ?? [])
          await collect(block, cellProps);
        if (!cellLines.length)
          cellLines.push(
            ...(await lines([], cellWidth - pad.left - pad.right, cellProps)),
          );
        cells.push({
          lines: cellLines,
          width: cellWidth,
          props: cellProps,
          pad,
          offset,
        });
        offset += cellWidth;
      }
      const positions = cells.map(() => 0);
      while (
        cells.some((cell, index) => positions[index] < cell.lines.length)
      ) {
        const minimum = Math.max(
          ...cells.map(
            (cell, index) =>
              (cell.lines[positions[index]]?.height ?? 0) +
              cell.pad.top +
              cell.pad.bottom,
          ),
        );
        ensureSpace(minimum);
        const capacity = y - margin.bottom;
        const chunks = cells.map((cell, index) => {
          let used = cell.pad.top + cell.pad.bottom;
          const chunk: Line[] = [];
          while (
            positions[index] < cell.lines.length &&
            used + cell.lines[positions[index]].height <= capacity + 0.001
          ) {
            const line = cell.lines[positions[index]++];
            chunk.push(line);
            used += line.height;
          }
          return { lines: chunk, height: used };
        });
        const rowHeight = Math.max(...chunks.map((chunk) => chunk.height));
        cells.forEach((cell, index) => {
          page.drawRectangle({
            x: x + cell.offset,
            y: y - rowHeight,
            width: cell.width,
            height: rowHeight,
            borderWidth: 0.5,
            borderColor: color(cell.props.BorderBrush ?? "#cbd5e1"),
            ...(cell.props.Background
              ? { color: color(cell.props.Background) }
              : {}),
          });
          let top = y - cell.pad.top;
          for (const line of chunks[index].lines) {
            drawLine(
              line,
              x + cell.offset + cell.pad.left,
              top,
              cell.width - cell.pad.left - cell.pad.right,
              cell.props,
            );
            top -= line.height;
          }
        });
        y -= rowHeight;
        if (cells.some((cell, index) => positions[index] < cell.lines.length))
          newPage();
      }
    }
    y -= 8;
  }

  async function block(
    node: DocumentNode,
    parent: Props,
    x: number,
    span: number,
  ): Promise<void> {
    const p = inherited(node, parent);
    if (node.type === "Paragraph" || node.type === "Image")
      return paragraph(node, parent, x, span);
    if (node.type === "Table") return table(node, parent, x, span);
    if (node.type === "List") {
      let index = finite(node.props.StartIndex, 1);
      const style = String(node.props.MarkerStyle ?? "Disc").toLowerCase();
      for (const item of node.children ?? []) {
        const ordered =
          /decimal|number|lowerlatin|upperlatin|lowerroman|upperroman/.test(
            style,
          );
        let marker = ordered ? `${index}. ` : style === "none" ? "" : "\u2022 ";
        if (style === "lowerlatin" || style === "upperlatin") {
          let n = Math.max(1, Math.floor(index));
          let letters = "";
          while (n) {
            n--;
            letters = String.fromCharCode(97 + (n % 26)) + letters;
            n = Math.floor(n / 26);
          }
          marker = `${style === "upperlatin" ? letters.toUpperCase() : letters}. `;
        }
        if (style === "lowerroman" || style === "upperroman") {
          let n = Math.max(1, Math.floor(index));
          let roman = "";
          if (n > 3999)
            throw new RangeError(
              "Roman PDF list numbering supports indices from 1 through 3999.",
            );
          for (const [value, label] of [
            [1000, "M"],
            [900, "CM"],
            [500, "D"],
            [400, "CD"],
            [100, "C"],
            [90, "XC"],
            [50, "L"],
            [40, "XL"],
            [10, "X"],
            [9, "IX"],
            [5, "V"],
            [4, "IV"],
            [1, "I"],
          ] as const) {
            while (n >= value) {
              roman += label;
              n -= value;
            }
          }
          marker = `${style === "lowerroman" ? roman.toLowerCase() : roman}. `;
        }
        let first = true;
        for (const child of item.children ?? []) {
          if (first && child.type === "Paragraph")
            await paragraph(
              child,
              inherited(item, p),
              x + 12,
              span - 12,
              marker,
            );
          else await block(child, inherited(item, p), x + 24, span - 24);
          first = false;
        }
        index++;
      }
      return;
    }
    if (
      node.type === "Section" ||
      node.type === "FlowDocument" ||
      node.type === "ListItem" ||
      node.type === "BlockUIContainer"
    ) {
      for (const child of node.children ?? []) await block(child, p, x, span);
      return;
    }
    if (node.children?.length || node.text)
      throw new Error(`Unsupported PDF block type: ${node.type}.`);
  }

  const rootProps = {
    FontFamily: "Helvetica",
    FontSize: 16,
    Foreground: "#111827",
    ...props,
  };
  for (const node of source.children ?? [])
    await block(node, rootProps, margin.left, availableWidth);
  if (options.pageNumbers) {
    if (margin.bottom < 18)
      throw new RangeError(
        "PDF page numbers require a bottom margin of at least 18 points.",
      );
    const font = await getFont({});
    const pages = pdf.getPages();
    pages.forEach((p, index) => {
      const text = `${index + 1} / ${pages.length}`;
      p.drawText(text, {
        x: (width - font.widthOfTextAtSize(text, 9)) / 2,
        y: Math.max(5, margin.bottom / 2 - 4),
        font,
        size: 9,
        color: color("#64748b"),
      });
    });
  }
  return pdf.save();
}

/**
 * Edits existing PDF pages by adding drawing operators and reorganizing pages.
 * Covers/highlights are visual overlays: original content remains recoverable.
 * This class deliberately exposes no destructive-redaction or text-reflow API.
 */
export class PDFEditor {
  private constructor(private readonly pdf: PDFDocument) {
    pdf.registerFontkit(fontkit);
  }

  static async Load(bytes: Uint8Array | ArrayBuffer): Promise<PDFEditor> {
    return new PDFEditor(await PDFDocument.load(bytes));
  }

  static async Create(): Promise<PDFEditor> {
    return new PDFEditor(await PDFDocument.create());
  }

  get PageCount(): number {
    return this.pdf.getPageCount();
  }

  GetPages(): PDFPageInfo[] {
    return this.pdf.getPages().map((page, index) => ({
      index,
      width: page.getWidth(),
      height: page.getHeight(),
      rotation: page.getRotation().angle,
    }));
  }

  private page(index: number): PDFPage {
    if (!Number.isInteger(index) || index < 0 || index >= this.PageCount)
      throw new RangeError(`Invalid PDF page index: ${index}.`);
    return this.pdf.getPage(index);
  }

  /** Adds text without modifying existing text content. Coordinates use the unrotated PDF page. */
  async AddText(
    pageIndex: number,
    text: string,
    options: PDFTextOptions,
  ): Promise<void> {
    const page = this.page(pageIndex);
    this.coordinates(options.x, options.y);
    const size = positive(options.fontSize ?? 12, "Font size");
    if (options.maxWidth !== undefined)
      positive(options.maxWidth, "Maximum text width");
    if (options.lineHeight !== undefined)
      positive(options.lineHeight, "Line height");
    const font = options.fontBytes
      ? await this.pdf.embedFont(options.fontBytes, { subset: true })
      : await this.pdf.embedFont(
          fontName({
            FontFamily: options.fontFamily,
            FontWeight: options.bold ? "Bold" : "Normal",
            FontStyle: options.italic ? "Italic" : "Normal",
          }),
        );
    try {
      const supported = new Set(font.getCharacterSet());
      if (
        Array.from(text.replace(/[\r\n]/g, "")).some(
          (character) => !supported.has(character.codePointAt(0)!),
        )
      )
        throw new Error("Missing glyph");
      font.encodeText(text.replace(/[\r\n]/g, ""));
    } catch (error) {
      throw new Error(
        `PDF overlay text contains a character unsupported by ${font.name}: ${String(error)}`,
      );
    }
    page.drawText(text, {
      x: options.x,
      y: options.y,
      size,
      font,
      color: color(options.color),
      opacity: this.opacity(options.opacity),
      maxWidth: options.maxWidth,
      lineHeight: options.lineHeight ?? size * 1.2,
    });
  }

  async AddImage(
    pageIndex: number,
    source: string | Uint8Array | ArrayBuffer,
    options: PDFImageOptions,
  ): Promise<void> {
    const page = this.page(pageIndex);
    this.coordinates(options.x, options.y);
    if (options.width !== undefined) positive(options.width, "Image width");
    if (options.height !== undefined) positive(options.height, "Image height");
    const opacity = this.opacity(options.opacity);
    const image = await embedImage(this.pdf, source);
    const width =
      options.width ??
      (options.height !== undefined
        ? (options.height * image.width) / image.height
        : image.width);
    const height = options.height ?? (width * image.height) / image.width;
    page.drawImage(image, {
      x: options.x,
      y: options.y,
      width,
      height,
      opacity,
    });
  }

  DrawRectangle(pageIndex: number, options: PDFRectangleOptions): void {
    const page = this.page(pageIndex);
    this.coordinates(options.x, options.y);
    positive(options.width, "Rectangle width");
    positive(options.height, "Rectangle height");
    if (
      options.borderWidth !== undefined &&
      (!Number.isFinite(options.borderWidth) || options.borderWidth < 0)
    )
      throw new RangeError("Border width must be finite and nonnegative.");
    page.drawRectangle({
      x: options.x,
      y: options.y,
      width: options.width,
      height: options.height,
      color: color(options.color ?? "#ffff00"),
      opacity: this.opacity(options.opacity),
      borderColor: options.borderColor ? color(options.borderColor) : undefined,
      borderWidth: options.borderWidth ?? 0,
    });
  }

  Highlight(
    pageIndex: number,
    region: Omit<PDFRectangleOptions, "opacity"> & { opacity?: number },
  ): void {
    this.DrawRectangle(pageIndex, {
      ...region,
      color: region.color ?? "#ffff00",
      opacity: region.opacity ?? 0.3,
    });
  }

  /** Visual covering only. This does not remove text, images, metadata, or sensitive information. */
  CoverRegion(
    pageIndex: number,
    region: Omit<PDFRectangleOptions, "opacity">,
  ): void {
    this.DrawRectangle(pageIndex, {
      ...region,
      color: region.color ?? "#ffffff",
      opacity: 1,
    });
  }

  /** Sets absolute rotation; accepts integer multiples of 90 degrees. */
  RotatePage(pageIndex: number, rotation: number): void {
    if (!Number.isFinite(rotation) || rotation % 90 !== 0)
      throw new RangeError("PDF rotation must be a multiple of 90 degrees.");
    this.page(pageIndex).setRotation(degrees(((rotation % 360) + 360) % 360));
  }

  /** All existing page indices must appear exactly once. */
  ReorderPages(order: readonly number[]): void {
    if (
      order.length !== this.PageCount ||
      new Set(order).size !== this.PageCount
    )
      throw new RangeError(
        "Page order must contain each existing page index exactly once.",
      );
    const pages = order.map((index) => this.page(index));
    for (let index = this.PageCount - 1; index >= 0; index--)
      this.pdf.removePage(index);
    pages.forEach((page) => this.pdf.addPage(page));
  }

  DeletePages(indices: readonly number[]): void {
    indices.forEach((index) => this.page(index));
    const unique = [...new Set(indices)].sort((a, b) => b - a);
    if (unique.length === this.PageCount && unique.length)
      throw new RangeError("A PDF must retain at least one page.");
    unique.forEach((index) => this.pdf.removePage(index));
  }

  AddPage(width = 595.28, height = 841.89): number {
    this.pdf.addPage([
      positive(width, "Page width"),
      positive(height, "Page height"),
    ]);
    return this.PageCount - 1;
  }

  /** Copies selected pages from another PDF into this document. Defaults to appending all source pages. */
  async InsertPages(
    bytes: Uint8Array | ArrayBuffer,
    indices?: readonly number[],
    insertionIndex = this.PageCount,
  ): Promise<void> {
    if (
      !Number.isInteger(insertionIndex) ||
      insertionIndex < 0 ||
      insertionIndex > this.PageCount
    )
      throw new RangeError("Invalid PDF page insertion index.");
    const source = await PDFDocument.load(bytes);
    const selected = indices ? [...indices] : source.getPageIndices();
    if (
      new Set(selected).size !== selected.length ||
      selected.some(
        (index) =>
          !Number.isInteger(index) ||
          index < 0 ||
          index >= source.getPageCount(),
      )
    )
      throw new RangeError(
        "Imported page indices must be unique valid source page indices.",
      );
    const pages = await this.pdf.copyPages(source, selected);
    pages.forEach((page, offset) =>
      this.pdf.insertPage(insertionIndex + offset, page),
    );
  }

  async Save(): Promise<Uint8Array> {
    if (!this.PageCount)
      throw new Error("Add at least one page before saving the PDF.");
    return this.pdf.save();
  }

  private coordinates(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y))
      throw new RangeError("PDF coordinates must be finite.");
  }

  private opacity(value = 1): number {
    if (!Number.isFinite(value) || value < 0 || value > 1)
      throw new RangeError("Opacity must be between zero and one.");
    return value;
  }
}
