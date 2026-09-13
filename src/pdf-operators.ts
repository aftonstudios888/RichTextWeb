import {
  PDFArray,
  PDFContentStream,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFRawStream,
  PDFRef,
  PDFStream,
  StandardFontEmbedder,
  StandardFonts,
  decodePDFRawStream,
} from "pdf-lib";

/** An actual text-showing operator, including operators inside Form XObjects. */
export interface PDFTextOperator {
  /** Opaque source fingerprint. Re-inspect after any source edit; stale ids reject. */
  id: string;
  pageIndex: number;
  operator: "Tj" | "TJ" | "'" | '"';
  text: string | null;
  fontName: string;
  fontSize: number;
  editable: boolean;
  reason?: string;
  /** Approximate glyph bounds in unrotated PDF user space, not CSS/display coordinates. */
  bounds: { x: number; y: number; width: number; height: number } | null;
  /** Baseline transform into unrotated PDF user space. */
  transform: number[];
  /** True when this occurrence is inside one or more Form XObjects. */
  inForm: boolean;
}
export interface PDFTextDiagnostic {
  pageIndex: number;
  source: string;
  message: string;
}
export interface PDFTextInspection {
  operators: PDFTextOperator[];
  diagnostics: PDFTextDiagnostic[];
}
export interface PDFTextReplacementOptions {
  /** Preserve the following operator's original position. Default true. */
  preserveAdvance?: boolean;
  /** Additional optimistic concurrency guard, compared against decoded source text. */
  expectedText?: string;
  /** Optional replacement font. It is installed in the edited stream's resource scope. */
  fontBytes?: Uint8Array | ArrayBuffer;
  /** Standard font used for replacement; mutually exclusive with fontBytes. */
  standardFont?: `${StandardFonts}`;
}
export interface PDFSourceTextReplaceOptions extends PDFTextReplacementOptions {
  pageIndices?: readonly number[];
  caseSensitive?: boolean;
  /** Default true. False replaces the first occurrence in content order. */
  all?: boolean;
  /** Explicitly permit leaving undecodable/unsupported source text untouched. */
  allowPartial?: boolean;
}
export interface PDFTextEditResult {
  operatorsChanged: number;
  occurrences: number;
  pages: number[];
}

type Matrix = [number, number, number, number, number, number];
const identity = (): Matrix => [1, 0, 0, 1, 0, 0];
const name = PDFName.of;
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_ITEMS = 200000;
function fail(message: string): never {
  throw new Error(`PDF source text: ${message}`);
}
class PDFTextLimitError extends RangeError {}
function limit(message: string): never {
  throw new PDFTextLimitError(`PDF source text: ${message}`);
}
function latin(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return text;
}
function bytes(text: string): Uint8Array {
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}
function hex(value: Uint8Array): string {
  return Array.from(value, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}
function unhex(value: string): Uint8Array {
  const text = value.replace(/\s/g, "");
  if (!/^[\da-f]*$/i.test(text)) fail("invalid hexadecimal string.");
  const padded = text.length % 2 ? text + "0" : text;
  return Uint8Array.from(padded.match(/../g) ?? [], (b) => parseInt(b, 16));
}
function hash(text: string): string {
  let a = 2166136261,
    b = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619);
    b = Math.imul(b ^ text.charCodeAt(i), 2246822519);
  }
  return `${text.length.toString(36)}-${(a >>> 0).toString(36)}-${(b >>> 0).toString(36)}`;
}
function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
function move(m: Matrix, x: number, y: number): Matrix {
  return multiply(m, [1, 0, 0, 1, x, y]);
}
function number(value: PDFObject | undefined, fallback?: number): number {
  if (value instanceof PDFNumber) return value.asNumber();
  if (fallback !== undefined) return fallback;
  return fail("missing font width or numeric resource value.");
}
function dict(value: PDFObject | undefined): PDFDict | undefined {
  return value instanceof PDFDict ? value : undefined;
}
function named(value: PDFObject | undefined): string {
  return value instanceof PDFName ? value.decodeText() : "";
}
/** Decode each filter stage separately so its allocation growth can be bounded. */
function streamText(stream: PDFStream): string {
  let data: Uint8Array;
  if (stream instanceof PDFRawStream) {
    data = stream.getContents();
    if (data.length > MAX_BYTES)
      limit("compressed content stream exceeds the 64 MiB limit.");
    const filters = stream.dict.lookup(name("Filter"));
    const filterNames =
      filters instanceof PDFArray
        ? filters.asArray()
        : filters
          ? [filters]
          : [];
    const parameters = stream.dict.lookup(name("DecodeParms"));
    for (let index = 0; index < filterNames.length; index++) {
      const stage = PDFDict.withContext(stream.dict.context);
      stage.set(name("Filter"), filterNames[index]);
      const parameter =
        parameters instanceof PDFArray ? parameters.lookup(index) : parameters;
      if (parameter) stage.set(name("DecodeParms"), parameter);
      const decoder = decodePDFRawStream(PDFRawStream.of(stage, data));
      // pdf-lib 1.17's incremental decoders expose this protected allocation
      // hook at runtime. Guard before growing, including one huge deflate block.
      const guarded = decoder as typeof decoder & {
        ensureBuffer?: (requested: number) => Uint8Array;
      };
      const ensure = guarded.ensureBuffer;
      if (!ensure) fail("PDF decoder cannot enforce a bounded allocation.");
      guarded.ensureBuffer = function (requested: number): Uint8Array {
        if (requested > MAX_BYTES)
          limit("decoded content stream exceeds the 64 MiB limit.");
        return ensure.call(decoder, requested);
      };
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const count = Math.min(65536, MAX_BYTES - total);
        if (!count) {
          if (decoder.getByte() !== -1)
            limit("decoded content stream exceeds the 64 MiB limit.");
          break;
        }
        const chunk = decoder.getBytes(count);
        if (chunk.length) {
          chunks.push(new Uint8Array(chunk));
          total += chunk.length;
        }
        if (chunk.length < count) break;
      }
      data = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.length;
      }
    }
  } else if (stream instanceof PDFContentStream)
    data = stream.getUnencodedContents();
  else return fail("unsupported content stream implementation.");
  if (data.length > MAX_BYTES)
    limit("content stream exceeds the 64 MiB decoded limit.");
  return latin(data);
}

/** Include resources and earlier stream state in optimistic operator identities. */
function contextFingerprint(objects: PDFObject[], pdf: PDFDocument): string {
  let a = 2166136261,
    b = 0x9e3779b9,
    length = 0;
  const seen = new Set<PDFObject>(),
    pending = [...objects];
  const feed = (data: Uint8Array) => {
    length += data.length;
    if (length > MAX_BYTES)
      limit("page resource fingerprint exceeds the 64 MiB limit.");
    for (const byte of data) {
      a = Math.imul(a ^ byte, 16777619);
      b = Math.imul(b ^ byte, 2246822519);
    }
  };
  const text = (value: string) => feed(bytes(value));
  while (pending.length) {
    const value = pending.pop()!;
    if (value instanceof PDFRef) {
      text(`ref:${value.toString()};`);
      if (seen.has(value)) continue;
      seen.add(value);
      const resolved = pdf.context.lookup(value);
      if (resolved) pending.push(resolved);
    } else if (seen.has(value)) continue;
    else {
      seen.add(value);
      if (value instanceof PDFArray) {
        text(`array:${value.size()};`);
        pending.push(...value.asArray());
      } else if (value instanceof PDFDict) {
        text("dict;");
        for (const [key, item] of value
          .entries()
          .sort(([a], [b]) => a.decodeText().localeCompare(b.decodeText()))) {
          if (key.decodeText() === "Length") continue;
          text(key.toString());
          pending.push(item);
        }
      } else if (value instanceof PDFStream) {
        text("stream;");
        feed(value.getContents());
        pending.push(value.dict);
      } else text(value.toString() + ";");
    }
  }
  return `${length.toString(36)}-${(a >>> 0).toString(36)}-${(b >>> 0).toString(36)}`;
}

type Token = {
  kind: "number" | "name" | "bytes" | "word" | "array" | "dict";
  value?: number | string | Uint8Array;
  items?: Token[];
  start: number;
  end: number;
};
type Operation = {
  operator: string;
  args: Token[];
  start: number;
  end: number;
  index: number;
};
/** PDF lexical parsing; offsets preserve untouched stream bytes exactly. */
class Lexer {
  position = 0;
  count = 0;
  constructor(readonly source: string) {}
  skip(): void {
    while (this.position < this.source.length) {
      const c = this.source[this.position];
      if (/[\0\t\n\f\r ]/.test(c)) {
        this.position++;
        continue;
      }
      if (c === "%") {
        while (
          this.position < this.source.length &&
          !/[\r\n]/.test(this.source[this.position])
        )
          this.position++;
        continue;
      }
      break;
    }
  }
  next(depth = 0): Token | null {
    this.skip();
    if (this.position >= this.source.length) return null;
    if (++this.count > 2000000 || depth > 64)
      fail("content token or nesting limit exceeded.");
    const start = this.position,
      c = this.source[this.position++];
    if (c === "(") {
      const out: number[] = [];
      let level = 1;
      while (this.position < this.source.length) {
        let x = this.source[this.position++];
        if (x === "\\") {
          x = this.source[this.position++];
          if (x === undefined) fail("unterminated literal string.");
          if (x === "\r" || x === "\n") {
            if (x === "\r" && this.source[this.position] === "\n")
              this.position++;
            continue;
          }
          if (/[0-7]/.test(x)) {
            let octal = x;
            for (
              let j = 0;
              j < 2 && /[0-7]/.test(this.source[this.position] ?? "x");
              j++
            )
              octal += this.source[this.position++];
            out.push(parseInt(octal, 8) & 255);
            continue;
          }
          out.push(
            ({ n: 10, r: 13, t: 9, b: 8, f: 12 } as Record<string, number>)[
              x
            ] ?? x.charCodeAt(0),
          );
          continue;
        }
        if (x === "(") level++;
        if (x === ")") {
          level--;
          if (level === 0)
            return {
              kind: "bytes",
              value: Uint8Array.from(out),
              start,
              end: this.position,
            };
        }
        if (x === "\r") {
          if (this.source[this.position] === "\n") this.position++;
          x = "\n";
        }
        out.push(x.charCodeAt(0));
      }
      return fail("unterminated literal string.");
    }
    if (c === "<" && this.source[this.position] !== "<") {
      const end = this.source.indexOf(">", this.position);
      if (end < 0) fail("unterminated hexadecimal string.");
      const value = unhex(this.source.slice(this.position, end));
      this.position = end + 1;
      return { kind: "bytes", value, start, end: this.position };
    }
    if (c === "[" || c === "<") {
      const isDict = c === "<";
      if (isDict) this.position++;
      const items: Token[] = [];
      for (;;) {
        this.skip();
        if (
          isDict
            ? this.source.slice(this.position, this.position + 2) === ">>"
            : this.source[this.position] === "]"
        ) {
          this.position += isDict ? 2 : 1;
          break;
        }
        const item = this.next(depth + 1);
        if (!item) fail("unterminated array or dictionary.");
        items.push(item);
      }
      return {
        kind: isDict ? "dict" : "array",
        items,
        start,
        end: this.position,
      };
    }
    if (c === "]" || c === ">" || c === ")")
      fail("unexpected closing delimiter.");
    while (
      this.position < this.source.length &&
      !/[\0\t\n\f\r ()<>\[\]{}/%]/.test(this.source[this.position])
    )
      this.position++;
    const raw = this.source.slice(start, this.position);
    if (c === "/")
      return {
        kind: "name",
        value: raw
          .slice(1)
          .replace(/#([\da-f]{2})/gi, (_, h) =>
            String.fromCharCode(parseInt(h, 16)),
          ),
        start,
        end: this.position,
      };
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(raw))
      return { kind: "number", value: Number(raw), start, end: this.position };
    return { kind: "word", value: raw, start, end: this.position };
  }
}
function operations(source: string): Operation[] {
  const lexer = new Lexer(source),
    result: Operation[] = [];
  let args: Token[] = [];
  for (let token = lexer.next(); token; token = lexer.next()) {
    if (
      token.kind !== "word" ||
      ["true", "false", "null"].includes(token.value as string)
    ) {
      args.push(token);
      continue;
    }
    if (token.value === "BI")
      fail(
        "inline-image content streams are not rewritten; convert inline images to image XObjects first.",
      );
    result.push({
      operator: token.value as string,
      args,
      start: args[0]?.start ?? token.start,
      end: token.end,
      index: result.length,
    });
    args = [];
  }
  if (args.length)
    fail("content stream ends with operands without an operator.");
  return result;
}
function numeric(op: Operation, index: number): number {
  const item = op.args[index];
  if (item?.kind !== "number" || !Number.isFinite(item.value))
    fail(`invalid numeric operand of ${op.operator}.`);
  return item.value as number;
}
function utf16(data: Uint8Array): string {
  if (!data.length || data.length % 2)
    fail("invalid ToUnicode UTF-16BE destination.");
  let text = "";
  for (let i = 0; i < data.length; i += 2)
    text += String.fromCharCode((data[i] << 8) | data[i + 1]);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
function unicodeMap(stream: PDFStream, length: number): Map<number, string> {
  if (stream.dict.has(name("UseCMap")))
    fail("inherited ToUnicode CMaps require a resolved mapping.");
  const lexer = new Lexer(streamText(stream)),
    tokens: Token[] = [];
  for (let t = lexer.next(); t; t = lexer.next()) tokens.push(t);
  const result = new Map<number, string>();
  function code(t: Token): number {
    if (t?.kind !== "bytes" || (t.value as Uint8Array).length !== length)
      fail("ToUnicode source codes do not match the font encoding.");
    return parseInt(hex(t.value as Uint8Array), 16);
  }
  function set(c: number, t: Token) {
    if (t?.kind !== "bytes") fail("invalid ToUnicode destination.");
    if (result.size >= 65536 && !result.has(c))
      fail("ToUnicode mapping exceeds 65536 entries.");
    result.set(c, utf16(t.value as Uint8Array));
  }
  for (let i = 0; i < tokens.length; i++) {
    const kind = tokens[i].value;
    if (kind === "usecmap")
      fail("inherited ToUnicode CMaps require a resolved mapping.");
    if (kind === "beginbfchar") {
      while (tokens[++i]?.value !== "endbfchar") {
        if (i >= tokens.length) fail("unterminated ToUnicode bfchar.");
        const c = code(tokens[i]);
        set(c, tokens[++i]);
      }
    }
    if (kind === "beginbfrange") {
      while (tokens[++i]?.value !== "endbfrange") {
        if (i >= tokens.length) fail("unterminated ToUnicode bfrange.");
        const first = code(tokens[i]),
          last = code(tokens[++i]),
          target = tokens[++i];
        if (last < first || last - first >= 65536)
          fail("invalid or excessive ToUnicode range.");
        if (target?.kind === "array") {
          if (target.items!.length !== last - first + 1)
            fail("ToUnicode range array length mismatch.");
          target.items!.forEach((item, j) => set(first + j, item));
        } else {
          if (target?.kind !== "bytes")
            fail("invalid ToUnicode range destination.");
          const value = new Uint8Array(target.value as Uint8Array);
          for (let c = first; c <= last; c++) {
            set(c, { ...target, value: new Uint8Array(value) });
            for (let k = value.length - 1; k >= 0; k--) {
              value[k] = (value[k] + 1) & 255;
              if (value[k]) break;
            }
          }
        }
      }
    }
  }
  if (!result.size) fail("ToUnicode CMap has no supported mappings.");
  return result;
}

const standardCache = new Map<string, StandardFontEmbedder>();
function standard(font: string): StandardFontEmbedder | undefined {
  if (!Object.values(StandardFonts).includes(font as StandardFonts)) return;
  let result = standardCache.get(font);
  if (!result) {
    result = StandardFontEmbedder.for(
      font as Parameters<typeof StandardFontEmbedder.for>[0],
    );
    standardCache.set(font, result);
  }
  return result;
}
const glyphNames = new Map<string, string>();
function glyphUnicode(glyph: string): string | undefined {
  if (!glyphNames.size)
    for (const face of [
      StandardFonts.Helvetica,
      StandardFonts.Symbol,
      StandardFonts.ZapfDingbats,
    ]) {
      const e = standard(face)!;
      for (const cp of e.encoding.supportedCodePoints)
        glyphNames.set(
          e.encoding.encodeUnicodeCodePoint(cp).name,
          String.fromCodePoint(cp),
        );
    }
  const g = glyph.split(".")[0];
  if (g.includes("_")) {
    const pieces = g.split("_").map(glyphUnicode);
    return pieces.every((x) => x !== undefined) ? pieces.join("") : undefined;
  }
  if (/^uni(?:[\da-f]{4})+$/i.test(g)) return utf16(unhex(g.slice(3)));
  if (/^u[\da-f]{4,6}$/i.test(g)) {
    const cp = parseInt(g.slice(1), 16);
    return cp <= 0x10ffff ? String.fromCodePoint(cp) : undefined;
  }
  return (
    glyphNames.get(g) ??
    (
      {
        fi: "fi",
        fl: "fl",
        ff: "ff",
        ffi: "ffi",
        ffl: "ffl",
        Lslash: "Ł",
        lslash: "ł",
        dotlessi: "ı",
        breve: "˘",
        dotaccent: "˙",
        ring: "˚",
        hungarumlaut: "˝",
        ogonek: "˛",
        caron: "ˇ",
      } as Record<string, string>
    )[g]
  );
}
const standardHigh: Record<number, string> = {
  161: "¡",
  162: "¢",
  163: "£",
  164: "⁄",
  165: "¥",
  166: "ƒ",
  167: "§",
  168: "¤",
  169: "'",
  170: "“",
  171: "«",
  172: "‹",
  173: "›",
  174: "fi",
  175: "fl",
  177: "–",
  178: "†",
  179: "‡",
  180: "·",
  182: "¶",
  183: "•",
  184: "‚",
  185: "„",
  186: "”",
  187: "»",
  188: "…",
  189: "‰",
  191: "¿",
  193: "`",
  194: "´",
  195: "ˆ",
  196: "˜",
  197: "¯",
  198: "˘",
  199: "˙",
  200: "¨",
  202: "˚",
  203: "¸",
  205: "˝",
  206: "˛",
  207: "ˇ",
  208: "—",
  225: "Æ",
  227: "ª",
  232: "Ł",
  233: "Ø",
  234: "Œ",
  235: "º",
  241: "æ",
  245: "ı",
  248: "ł",
  249: "ø",
  250: "œ",
  251: "ß",
};
interface Glyph {
  code: number;
  text: string;
  width: number;
  bytes: Uint8Array;
}
interface Codec {
  name: string;
  size: 1 | 2;
  decode(value: Uint8Array): Glyph[];
  encode(value: string): Glyph[];
}
function fontCodec(font: PDFDict): Codec {
  const subtype = named(font.lookup(name("Subtype"))),
    base = named(font.lookup(name("BaseFont"))),
    std = standard(base);
  if (subtype === "Type3")
    fail("Type3 font text requires a glyph-program editor.");
  const composite = subtype === "Type0",
    size = composite ? 2 : 1;
  if (composite && named(font.lookup(name("Encoding"))) !== "Identity-H")
    fail(
      `font ${base} uses an unsupported composite encoding (horizontal Identity-H is required).`,
    );
  const toUnicode = font.lookup(name("ToUnicode"));
  let mapping =
    toUnicode instanceof PDFStream
      ? unicodeMap(toUnicode, size)
      : new Map<number, string>();
  const encoding = font.lookup(name("Encoding")),
    encodingDict = dict(encoding),
    encodingName =
      named(encoding) || named(encodingDict?.lookup(name("BaseEncoding")));
  const glyphByCode = new Map<number, string>();
  const encodingMapping = new Map<number, string>();
  if (!composite) {
    if (
      std &&
      (base === StandardFonts.Symbol || base === StandardFonts.ZapfDingbats) &&
      !encodingName
    ) {
      for (const cp of std.encoding.supportedCodePoints) {
        const g = std.encoding.encodeUnicodeCodePoint(cp);
        encodingMapping.set(g.code, String.fromCodePoint(cp));
        glyphByCode.set(g.code, g.name);
      }
    } else if (
      encodingName === "WinAnsiEncoding" ||
      encodingName === "MacRomanEncoding"
    ) {
      const decoder = new TextDecoder(
        encodingName === "WinAnsiEncoding" ? "windows-1252" : "macintosh",
      );
      for (let c = 32; c <= 255; c++)
        encodingMapping.set(c, decoder.decode(Uint8Array.of(c)));
    } else if (
      encodingName === "StandardEncoding" ||
      (!encodingName && subtype === "Type1" && std)
    ) {
      for (let c = 32; c < 127; c++)
        encodingMapping.set(c, String.fromCharCode(c));
      encodingMapping.set(39, "’");
      encodingMapping.set(96, "‘");
      Object.entries(standardHigh).forEach(([c, t]) =>
        encodingMapping.set(Number(c), t),
      );
    } else if (!mapping.size)
      fail(
        `font ${base || "unnamed"} has no usable ToUnicode or supported simple encoding.`,
      );
    const differences = encodingDict?.lookup(name("Differences"));
    if (differences instanceof PDFArray) {
      let c = -1;
      for (const item of differences.asArray()) {
        if (item instanceof PDFNumber) {
          c = item.asNumber();
          continue;
        }
        if (!(item instanceof PDFName) || c < 0 || c > 255)
          fail("malformed font Encoding Differences.");
        const glyph = item.decodeText(),
          value = glyphUnicode(glyph);
        encodingMapping.delete(c);
        if (value !== undefined) encodingMapping.set(c, value);
        glyphByCode.set(c++, glyph);
      }
    }
  }
  if (!mapping.size) mapping = encodingMapping;
  if (!mapping.size) fail(`font ${base} requires a ToUnicode mapping.`);
  let width: (code: number) => number;
  if (composite) {
    const descendants = font.lookup(name("DescendantFonts"));
    const child =
      descendants instanceof PDFArray ? dict(descendants.lookup(0)) : undefined;
    if (!child) fail("missing CIDFont descendant.");
    const widths = child.lookup(name("W")),
      values = new Map<number, number>(),
      fallback = number(child.lookup(name("DW")), 1000);
    if (widths instanceof PDFArray)
      for (let i = 0; i < widths.size();) {
        const first = number(widths.lookup(i++)),
          second = widths.lookup(i++);
        if (!Number.isInteger(first) || first < 0 || first > 65535)
          fail("invalid CID width range.");
        if (second instanceof PDFArray) {
          if (first + second.size() > 65536) fail("excessive CID widths.");
          second
            .asArray()
            .forEach((_, j) => values.set(first + j, number(second.lookup(j))));
        } else {
          const last = number(second),
            w = number(widths.lookup(i++));
          if (last < first || last > 65535) fail("invalid CID width range.");
          for (let c = first; c <= last; c++) values.set(c, w);
        }
      }
    width = (c) => values.get(c) ?? fallback;
  } else {
    const widths = font.lookup(name("Widths")),
      first = number(font.lookup(name("FirstChar")), 0),
      descriptor = dict(font.lookup(name("FontDescriptor")));
    width = (c) => {
      if (widths instanceof PDFArray) {
        const index = c - first;
        return index >= 0 && index < widths.size()
          ? number(widths.lookup(index))
          : number(descriptor?.lookup(name("MissingWidth")), 0);
      }
      if (std) {
        const t = encodingMapping.get(c),
          g =
            glyphByCode.get(c) ??
            (t &&
            Array.from(t).length === 1 &&
            std.encoding.canEncodeUnicodeCodePoint(t.codePointAt(0)!)
              ? std.encoding.encodeUnicodeCodePoint(t.codePointAt(0)!).name
              : undefined);
        if (g) {
          const w = std.font.getWidthOfGlyph(g);
          if (w !== undefined) return w;
        }
      }
      return fail(`font ${base} lacks a width for code ${c}.`);
    };
  }
  const reverse = [...mapping]
    .filter(([, t]) => t.length)
    .sort((a, b) => b[1].length - a[1].length || a[0] - b[0]);
  function glyph(c: number): Glyph {
    const text = mapping.get(c);
    if (text === undefined)
      fail(`font ${base} cannot decode character code 0x${c.toString(16)}.`);
    const w = width(c);
    if (!Number.isFinite(w)) fail(`font ${base} has non-finite glyph metrics.`);
    return {
      code: c,
      text,
      width: w,
      bytes: size === 1 ? Uint8Array.of(c) : Uint8Array.of(c >> 8, c & 255),
    };
  }
  return {
    name: base,
    size,
    decode(value) {
      if (value.length % size)
        fail(`font ${base} has a truncated character code.`);
      const result: Glyph[] = [];
      for (let i = 0; i < value.length; i += size)
        result.push(
          glyph(size === 1 ? value[i] : (value[i] << 8) | value[i + 1]),
        );
      return result;
    },
    encode(value) {
      const result: Glyph[] = [];
      let offset = 0;
      while (offset < value.length) {
        const entry = reverse.find(([, text]) =>
          value.startsWith(text, offset),
        );
        if (!entry)
          fail(
            `font ${base} cannot encode U+${value.codePointAt(offset)!.toString(16).toUpperCase()}; supply fontBytes or a replacement standardFont.`,
          );
        result.push(glyph(entry[0]));
        offset += entry[1].length;
      }
      return result;
    },
  };
}

interface State {
  ctm: Matrix;
  tm: Matrix;
  line: Matrix;
  font?: PDFDict;
  fontKey: string;
  size: number;
  charSpace: number;
  wordSpace: number;
  scale: number;
  leading: number;
  rise: number;
  inText: boolean;
  positionKnown: boolean;
  actualText: boolean[];
}
function initial(): State {
  return {
    ctm: identity(),
    tm: identity(),
    line: identity(),
    fontKey: "",
    size: 0,
    charSpace: 0,
    wordSpace: 0,
    scale: 1,
    leading: 0,
    rise: 0,
    inText: false,
    positionKnown: true,
    actualText: [],
  };
}
function cloneState(s: State): State {
  return {
    ...s,
    ctm: [...s.ctm],
    tm: [...s.tm],
    line: [...s.line],
    actualText: [...s.actualText],
  };
}
interface Edit {
  start: number;
  end: number;
  text: string;
}
interface Frame {
  rootIndex?: number;
  source: string;
  stream: PDFStream;
  original: PDFObject;
  resources: PDFDict;
  operations: Operation[];
  children: { call: Operation; frame: Frame }[];
  edits: Edit[];
  fonts: Map<string, PDFRef>;
}
interface InternalOperator {
  public: PDFTextOperator;
  frame: Frame;
  operation: Operation;
  state: State;
  codec?: Codec;
  advance: number;
}
interface PageScan {
  index: number;
  resources: PDFDict;
  frames: Frame[];
  original: PDFObject[];
}
interface Scan {
  pages: PageScan[];
  operators: InternalOperator[];
  diagnostics: PDFTextDiagnostic[];
}
function units(glyphs: Glyph[], s: State): number {
  return glyphs.reduce(
    (sum, g) =>
      sum +
      g.width +
      ((s.charSpace +
        (g.bytes.length === 1 && g.code === 32 ? s.wordSpace : 0)) *
        1000) /
        s.size,
    0,
  );
}
function scan(pdf: PDFDocument, indices: readonly number[]): Scan {
  const result: Scan = { pages: [], operators: [], diagnostics: [] },
    codecs = new Map<PDFDict, Codec | Error>();
  let totalBytes = 0;
  for (const pageIndex of indices) {
    if (
      !Number.isInteger(pageIndex) ||
      pageIndex < 0 ||
      pageIndex >= pdf.getPageCount()
    )
      throw new RangeError("Invalid PDF page index.");
    const page = pdf.getPage(pageIndex),
      resources = page.node.Resources() ?? PDFDict.withContext(pdf.context),
      content = page.node.Contents();
    const original =
      content instanceof PDFArray
        ? content.asArray()
        : content
          ? [page.node.get(name("Contents"))!]
          : [];
    const pageFingerprint = contextFingerprint([resources, ...original], pdf);
    const pageScan: PageScan = {
      index: pageIndex,
      resources,
      frames: [],
      original,
    };
    result.pages.push(pageScan);
    const state = initial(),
      graphics: State[] = [];
    function walk(
      object: PDFObject,
      res: PDFDict,
      s: State,
      path: string,
      ancestors: Set<PDFStream>,
      stack: State[],
    ): Frame | undefined {
      const stream = pdf.context.lookup(object);
      if (!(stream instanceof PDFStream)) {
        result.diagnostics.push({
          pageIndex,
          source: path,
          message: "Content reference is not a stream.",
        });
        return;
      }
      if (ancestors.has(stream) || ancestors.size >= 32) {
        result.diagnostics.push({
          pageIndex,
          source: path,
          message: "Recursive or excessively nested Form XObject.",
        });
        return;
      }
      let source: string, ops: Operation[];
      try {
        source = streamText(stream);
        totalBytes += source.length;
        if (totalBytes > MAX_BYTES)
          limit("inspection exceeds the 64 MiB decoded-content limit.");
        ops = operations(source);
      } catch (error) {
        if (error instanceof PDFTextLimitError) throw error;
        result.diagnostics.push({
          pageIndex,
          source: path,
          message: String((error as Error).message),
        });
        s.positionKnown = false;
        return;
      }
      const frame: Frame = {
          source,
          stream,
          original: object,
          resources: res,
          operations: ops,
          children: [],
          edits: [],
          fonts: new Map(),
        },
        fingerprint = hash(source);
      for (const op of ops) {
        try {
          const k = op.operator;
          if (k === "q") {
            stack.push(cloneState(s));
            continue;
          }
          if (k === "Q") {
            const saved = stack.pop();
            if (!saved) fail("unbalanced graphics-state restore.");
            Object.assign(s, saved, {
              tm: s.tm,
              line: s.line,
              inText: s.inText,
              positionKnown: s.positionKnown,
              actualText: s.actualText,
            });
            continue;
          }
          if (k === "cm") {
            s.ctm = multiply(
              s.ctm,
              [0, 1, 2, 3, 4, 5].map((i) => numeric(op, i)) as Matrix,
            );
            continue;
          }
          if (k === "BT") {
            s.tm = identity();
            s.line = identity();
            s.inText = true;
            s.positionKnown = true;
            continue;
          }
          if (k === "ET") {
            s.inText = false;
            continue;
          }
          if (k === "Tf") {
            s.fontKey =
              op.args[0]?.kind === "name"
                ? (op.args[0].value as string)
                : fail("invalid Tf font resource.");
            s.size = numeric(op, 1);
            s.font = dict(
              dict(res.lookup(name("Font")))?.lookup(name(s.fontKey)),
            );
            continue;
          }
          if (k === "gs") {
            const gs = dict(
              dict(res.lookup(name("ExtGState")))?.lookup(
                name(String(op.args[0]?.value)),
              ),
            );
            const font = gs?.lookup(name("Font"));
            if (font instanceof PDFArray) {
              s.font = dict(font.lookup(0));
              s.fontKey = "";
              s.size = number(font.lookup(1));
            }
            continue;
          }
          if (["Tc", "Tw", "Tz", "TL", "Ts"].includes(k)) {
            const key = (
              {
                Tc: "charSpace",
                Tw: "wordSpace",
                Tz: "scale",
                TL: "leading",
                Ts: "rise",
              } as const
            )[k as "Tc"];
            s[key] = numeric(op, 0) / (k === "Tz" ? 100 : 1);
            continue;
          }
          if (k === "Tm") {
            s.tm = s.line = [0, 1, 2, 3, 4, 5].map((i) =>
              numeric(op, i),
            ) as Matrix;
            s.positionKnown = true;
            continue;
          }
          if (k === "Td" || k === "TD") {
            const x = numeric(op, 0),
              y = numeric(op, 1);
            if (k === "TD") s.leading = -y;
            s.tm = s.line = move(s.line, x, y);
            s.positionKnown = true;
            continue;
          }
          if (k === "T*") {
            s.tm = s.line = move(s.line, 0, -s.leading);
            s.positionKnown = true;
            continue;
          }
          if (k === "BMC" || k === "BDC") {
            const p = op.args[1];
            const external =
              p?.kind === "name"
                ? dict(
                    dict(res.lookup(name("Properties")))?.lookup(
                      name(String(p.value)),
                    ),
                  )
                : undefined;
            s.actualText.push(
              Boolean(
                external?.has(name("ActualText")) ||
                p?.items?.some(
                  (t) => t.kind === "name" && t.value === "ActualText",
                ),
              ),
            );
            continue;
          }
          if (k === "EMC") {
            s.actualText.pop();
            continue;
          }
          if (k === "Do") {
            const key =
                op.args[0]?.kind === "name" ? String(op.args[0].value) : "",
              obj = dict(res.lookup(name("XObject")))?.get(name(key));
            const form = obj ? pdf.context.lookup(obj) : undefined;
            if (
              form instanceof PDFStream &&
              named(form.dict.lookup(name("Subtype"))) === "Form"
            ) {
              const childState = cloneState(s),
                matrix = form.dict.lookup(name("Matrix"));
              if (matrix instanceof PDFArray && matrix.size() === 6)
                childState.ctm = multiply(
                  s.ctm,
                  matrix
                    .asArray()
                    .map((_, i) => number(matrix.lookup(i))) as Matrix,
                );
              const child = walk(
                obj!,
                dict(form.dict.lookup(name("Resources"))) ?? res,
                childState,
                `${path}/f${op.index}`,
                new Set([...ancestors, stream]),
                [],
              );
              if (child) frame.children.push({ call: op, frame: child });
            }
            continue;
          }
          if (!["Tj", "TJ", "'", '"'].includes(k)) continue;
          if (result.operators.length >= MAX_ITEMS)
            limit("inspection exceeds 200000 text operators.");
          if (k === '"') {
            s.wordSpace = numeric(op, 0);
            s.charSpace = numeric(op, 1);
          }
          if (k === "'" || k === '"') {
            s.tm = s.line = move(s.line, 0, -s.leading);
            s.positionKnown = true;
          }
          const snapshot = cloneState(s),
            transform = multiply(s.ctm, move(s.tm, 0, s.rise));
          const entry: InternalOperator = {
            public: {
              id: `${pageIndex}:${pageFingerprint}:${path}:${fingerprint}:${op.index}`,
              pageIndex,
              operator: k as PDFTextOperator["operator"],
              text: null,
              fontName: s.font
                ? named(s.font.lookup(name("BaseFont")))
                : s.fontKey,
              fontSize: s.size,
              editable: false,
              bounds: null,
              transform,
              inForm: ancestors.size > 0,
            },
            frame,
            operation: op,
            state: snapshot,
            advance: 0,
          };
          result.operators.push(entry);
          try {
            if (!s.inText) fail("text-showing operator outside a text object.");
            if (!s.font) fail("text-showing operator has no resolved font.");
            if (!(s.size > 0))
              fail("non-positive font sizes cannot preserve text advance.");
            let codec = codecs.get(s.font);
            if (!codec) {
              try {
                codec = fontCodec(s.font);
              } catch (error) {
                if (error instanceof PDFTextLimitError) throw error;
                codec = error as Error;
              }
              codecs.set(s.font, codec);
            }
            if (codec instanceof Error) throw codec;
            entry.codec = codec;
            const values =
              k === "TJ" ? op.args[0]?.items : [op.args[k === '"' ? 2 : 0]];
            if (!values || (k === "TJ" && op.args[0].kind !== "array"))
              fail("invalid text-showing operands.");
            let text = "",
              advance = 0;
            for (const value of values) {
              if (value?.kind === "number" && k === "TJ")
                advance -= value.value as number;
              else if (value?.kind === "bytes") {
                const glyphs = codec.decode(value.value as Uint8Array);
                text += glyphs.map((g) => g.text).join("");
                advance += units(glyphs, s);
              } else fail("text-showing array contains invalid operands.");
            }
            entry.public.text = text;
            entry.advance = advance;
            const length = (advance * s.size * s.scale) / 1000,
              points = [
                [0, -s.size * 0.25],
                [length, -s.size * 0.25],
                [0, s.size],
                [length, s.size],
              ].map(([x, y]) => [
                transform[0] * x + transform[2] * y + transform[4],
                transform[1] * x + transform[3] * y + transform[5],
              ]);
            if (s.positionKnown) {
              const x = Math.min(...points.map((p) => p[0])),
                y = Math.min(...points.map((p) => p[1]));
              entry.public.bounds = {
                x,
                y,
                width: Math.max(...points.map((p) => p[0])) - x,
                height: Math.max(...points.map((p) => p[1])) - y,
              };
            }
            s.tm = move(s.tm, length, 0);
            if (s.actualText.some(Boolean))
              fail(
                "ActualText marked-content groups require an explicit semantic-text edit.",
              );
            entry.public.editable = true;
          } catch (error) {
            if (error instanceof PDFTextLimitError) throw error;
            entry.public.reason = (error as Error).message;
            if (entry.public.text === null) s.positionKnown = false;
          }
        } catch (error) {
          if (error instanceof PDFTextLimitError) throw error;
          result.diagnostics.push({
            pageIndex,
            source: `${path}/op${op.index}`,
            message: (error as Error).message,
          });
          s.positionKnown = false;
        }
      }
      return frame;
    }
    original.forEach((object, i) => {
      const frame = walk(
        object,
        resources,
        state,
        `s${i}`,
        new Set(),
        graphics,
      );
      if (frame) {
        frame.rootIndex = i;
        pageScan.frames.push(frame);
      }
    });
  }
  return result;
}

export async function inspectPDFText(
  pdf: PDFDocument,
  pageIndex?: number,
): Promise<PDFTextInspection> {
  await pdf.flush();
  const result = scan(
    pdf,
    pageIndex === undefined ? pdf.getPageIndices() : [pageIndex],
  );
  return {
    operators: result.operators.map((x) => x.public),
    diagnostics: result.diagnostics,
  };
}
function validateReplacement(
  text: string,
  options: PDFTextReplacementOptions,
): void {
  if (typeof text !== "string" || /[\u0000-\u001f\u007f]/.test(text))
    throw new TypeError(
      "PDF source replacement must be a single line without control characters.",
    );
  if (text.length > 1000000)
    throw new RangeError(
      "PDF replacement text exceeds one million UTF-16 units.",
    );
  if (options.fontBytes && options.standardFont)
    throw new TypeError("Choose fontBytes or standardFont, not both.");
  if (
    options.standardFont &&
    !Object.values(StandardFonts).includes(
      options.standardFont as StandardFonts,
    )
  )
    throw new TypeError("Unknown PDF standard font.");
}
function pdfNumber(n: number): string {
  if (!Number.isFinite(n))
    fail("replacement produced non-finite text advance.");
  return n.toFixed(8).replace(/\.?0+$/, "") || "0";
}
function cloneResources(resources: PDFDict): PDFDict {
  return resources.clone();
}
function setResource(
  resources: PDFDict,
  category: string,
  key: PDFName,
  value: PDFRef,
): void {
  let values =
    dict(resources.lookup(name(category)))?.clone() ??
    PDFDict.withContext(resources.context);
  values.set(key, value);
  resources.set(name(category), values);
}
function materialize(
  pdf: PDFDocument,
  frame: Frame,
  resources: PDFDict,
  retired: Set<PDFRef>,
): PDFRef | undefined {
  const edits = [...frame.edits];
  for (const child of frame.children) {
    const childResources = cloneResources(child.frame.resources),
      ref = materialize(pdf, child.frame, childResources, retired);
    if (ref) {
      const xobjects =
          dict(resources.lookup(name("XObject"))) ??
          PDFDict.withContext(pdf.context),
        key = xobjects.uniqueKey("RichTextForm");
      setResource(resources, "XObject", key, ref);
      edits.push({
        start: child.call.start,
        end: child.call.end,
        text: `${key.toString()} Do`,
      });
    }
  }
  if (!edits.length) return;
  for (const [key, ref] of frame.fonts)
    setResource(resources, "Font", name(key), ref);
  edits.sort((a, b) => b.start - a.start);
  let source = frame.source,
    last = source.length;
  for (const edit of edits) {
    if (edit.end > last) fail("overlapping text edits.");
    source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
    last = edit.start;
  }
  const replacement = pdf.context.flateStream(bytes(source));
  for (const [key, value] of frame.stream.dict.entries())
    if (
      !["Length", "Filter", "DecodeParms", "Resources"].includes(
        key.decodeText(),
      )
    )
      replacement.dict.set(key, value);
  if (named(frame.stream.dict.lookup(name("Subtype"))) === "Form")
    replacement.dict.set(name("Resources"), resources);
  if (frame.original instanceof PDFRef) retired.add(frame.original);
  return pdf.context.register(replacement);
}
function removeUnreachableReplacedStreams(
  pdf: PDFDocument,
  retired: Set<PDFRef>,
): void {
  const seen = new Set<PDFObject>(),
    reachable = new Set<PDFRef>();
  const pending = Object.values(pdf.context.trailerInfo).filter(
    (x): x is PDFObject => Boolean(x),
  );
  while (pending.length) {
    const value = pending.pop()!;
    if (seen.has(value)) continue;
    seen.add(value);
    if (value instanceof PDFRef) {
      reachable.add(value);
      const target = pdf.context.lookup(value);
      if (target) pending.push(target);
    } else if (value instanceof PDFArray) pending.push(...value.asArray());
    else if (value instanceof PDFDict) pending.push(...value.values());
    else if (value instanceof PDFStream) pending.push(value.dict);
  }
  for (const ref of retired) if (!reachable.has(ref)) pdf.context.delete(ref);
}
async function commitEdits(
  pdf: PDFDocument,
  scanResult: Scan,
  changes: { entry: InternalOperator; text: string; occurrences: number }[],
  options: PDFTextReplacementOptions,
): Promise<PDFTextEditResult> {
  changes = changes.filter(
    (change) =>
      change.entry.public.text !== change.text ||
      options.fontBytes ||
      options.standardFont,
  );
  if (!changes.length)
    return { operatorsChanged: 0, occurrences: 0, pages: [] };
  let newCodec: Codec | undefined, newRef: PDFRef | undefined;
  if (options.fontBytes || options.standardFont) {
    const font = options.fontBytes
      ? await pdf.embedFont(options.fontBytes, { subset: false })
      : await pdf.embedFont(options.standardFont as StandardFonts);
    for (const change of changes) font.encodeText(change.text);
    await pdf.flush();
    newRef = font.ref;
    newCodec = fontCodec(pdf.context.lookup(font.ref, PDFDict));
  }
  // Every replacement is encoded and checked before the first source stream is changed.
  const prepared = changes.map(({ entry, text, occurrences }) => {
    if (!entry.public.editable || !entry.codec)
      fail(entry.public.reason ?? "selected operator is not editable.");
    if (
      options.expectedText !== undefined &&
      entry.public.text !== options.expectedText
    )
      fail("source text changed; inspect it again before replacing.");
    const codec = newCodec ?? entry.codec,
      glyphs = codec.encode(text),
      newAdvance = units(glyphs, entry.state),
      adjustment =
        options.preserveAdvance === false ? 0 : newAdvance - entry.advance;
    const encoded = hex(
      Uint8Array.from(glyphs.flatMap((g) => Array.from(g.bytes))),
    );
    const op = entry.operation.operator,
      prefix =
        op === '"'
          ? `${pdfNumber(entry.state.wordSpace)} Tw ${pdfNumber(entry.state.charSpace)} Tc T* `
          : op === "'"
            ? "T* "
            : "";
    let body = `[${encoded ? `<${encoded}>` : ""}${adjustment ? ` ${pdfNumber(adjustment)}` : ""}] TJ`;
    // Some PDF readers apply Tc once even to a number-only TJ. Neutralize it
    // around a deletion while retaining the same mathematically defined advance.
    if (!encoded && entry.state.charSpace)
      body = `0 Tc ${body} ${pdfNumber(entry.state.charSpace)} Tc`;
    if (newRef) {
      const resources =
        dict(entry.frame.resources.lookup(name("Font"))) ??
        PDFDict.withContext(pdf.context);
      let key = resources.uniqueKey("RichTextReplacement").decodeText();
      while (entry.frame.fonts.has(key)) key += "x";
      entry.frame.fonts.set(key, newRef);
      const oldFontKey =
        entry.state.fontKey ||
        resources.uniqueKey("RichTextOriginal").decodeText();
      if (!entry.state.fontKey)
        entry.frame.fonts.set(
          oldFontKey,
          pdf.context.register(entry.state.font!),
        );
      body = `${name(key).toString()} ${pdfNumber(entry.state.size)} Tf ${body} ${name(oldFontKey).toString()} ${pdfNumber(entry.state.size)} Tf`;
    }
    return { entry, text: prefix + body, occurrences };
  });
  for (const change of prepared)
    change.entry.frame.edits.push({
      start: change.entry.operation.start,
      end: change.entry.operation.end,
      text: change.text,
    });
  const retired = new Set<PDFRef>(),
    pages: number[] = [];
  for (const page of scanResult.pages) {
    const resources = cloneResources(page.resources),
      contents = [...page.original];
    let changed = false;
    for (const frame of page.frames) {
      const ref = materialize(pdf, frame, resources, retired);
      if (ref) {
        contents[frame.rootIndex!] = ref;
        changed = true;
      }
    }
    if (changed) {
      pdf
        .getPage(page.index)
        .node.set(name("Contents"), pdf.context.obj(contents));
      pdf.getPage(page.index).node.set(name("Resources"), resources);
      pages.push(page.index);
    }
  }
  removeUnreachableReplacedStreams(pdf, retired);
  return {
    operatorsChanged: prepared.length,
    occurrences: prepared.reduce((n, x) => n + x.occurrences, 0),
    pages,
  };
}
export async function replacePDFTextOperator(
  pdf: PDFDocument,
  pageIndex: number,
  id: string,
  text: string,
  options: PDFTextReplacementOptions = {},
): Promise<PDFTextEditResult> {
  validateReplacement(text, options);
  await pdf.flush();
  const inspected = scan(pdf, [pageIndex]),
    entry = inspected.operators.find((x) => x.public.id === id);
  if (!entry)
    fail(
      "text operator id is stale or does not belong to this page; inspect it again.",
    );
  return commitEdits(
    pdf,
    inspected,
    [{ entry, text, occurrences: 1 }],
    options,
  );
}
export async function replacePDFSourceText(
  pdf: PDFDocument,
  query: string,
  replacement: string,
  options: PDFSourceTextReplaceOptions = {},
): Promise<PDFTextEditResult> {
  if (typeof query !== "string" || !query.length)
    throw new TypeError("PDF source search text cannot be empty.");
  validateReplacement(replacement, options);
  await pdf.flush();
  const indices = options.pageIndices
      ? [...new Set(options.pageIndices)]
      : pdf.getPageIndices(),
    inspected = scan(pdf, indices);
  if (!options.allowPartial) {
    const failure =
      inspected.diagnostics[0]?.message ??
      inspected.operators.find((x) => !x.public.editable)?.public.reason;
    if (failure)
      fail(
        `search cannot inspect all source text: ${failure} Use allowPartial only to explicitly skip unsupported text.`,
      );
  }
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    pattern = new RegExp(escaped, options.caseSensitive ? "gu" : "giu"),
    changes: { entry: InternalOperator; text: string; occurrences: number }[] =
      [];
  for (const entry of inspected.operators) {
    if (!entry.public.editable || entry.public.text === null) continue;
    let occurrences = 0;
    const text = entry.public.text.replace(pattern, (match) => {
      if (options.all === false && occurrences) return match;
      occurrences++;
      return replacement;
    });
    if (occurrences) {
      changes.push({ entry, text, occurrences });
      if (options.all === false) break;
    }
  }
  return commitEdits(pdf, inspected, changes, options);
}
