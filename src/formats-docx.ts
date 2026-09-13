import JSZip from "jszip";
import { FlowDocument, type DocumentNode } from "./model.js";
import {
  parseMarkup,
  child,
  descendants,
  textContent,
  escapeMarkup as esc,
  safeURL,
  type MarkupNode,
} from "./formats-markup.js";
const NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
/** Canonicalize declared namespace prefixes; Office XML is namespace-based, not prefix-based. */
function parseOfficeXML(source: string): MarkupNode {
  const root = parseMarkup(source, true);
  const prefixes: Record<string, string> = {
    [NS]: "w",
    [REL]: "r",
    "http://schemas.openxmlformats.org/package/2006/relationships": "",
    "http://schemas.openxmlformats.org/drawingml/2006/main": "a",
    "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing":
      "wp",
    "http://schemas.openxmlformats.org/drawingml/2006/picture": "pic",
  };
  const visit = (n: MarkupNode, inherited: Record<string, string>) => {
    const namespaces = { ...inherited };
    for (const [key, value] of Object.entries(n.attrs))
      if (key === "xmlns") namespaces[""] = value;
      else if (key.startsWith("xmlns:")) namespaces[key.slice(6)] = value;
    const normalize = (name: string, attribute = false): string => {
      const index = name.indexOf(":"),
        prefix = index < 0 ? "" : name.slice(0, index),
        local = index < 0 ? name : name.slice(index + 1);
      if (attribute && index < 0) return name;
      const canonical = prefixes[namespaces[prefix] ?? ""];
      return canonical === undefined
        ? name
        : canonical
          ? canonical + ":" + local
          : local;
    };
    n.name = normalize(n.name);
    const attrs: Record<string, string> = Object.create(null);
    for (const [key, value] of Object.entries(n.attrs))
      attrs[normalize(key, true)] = value;
    n.attrs = attrs;
    for (const c of n.children) if (c.name !== "#text") visit(c, namespaces);
  };
  for (const n of root.children) visit(n, {});
  return root;
}
let id = 0;
const node = (
  type: string,
  children: DocumentNode[] = [],
  props: Record<string, any> = {},
  text?: string,
): DocumentNode => ({
  type,
  id: "docx-" + ++id,
  props,
  ...(children.length ? { children } : {}),
  ...(text !== undefined ? { text } : {}),
});
const pxToTwip = (n: unknown) => Math.round((Number(n) || 0) * 15);
const hexColor = (value: unknown): string | undefined => {
  const v = String(value ?? "");
  if (/^#[\da-f]{6}$/i.test(v)) return v.slice(1);
  if (/^#[\da-f]{3}$/i.test(v))
    return v
      .slice(1)
      .split("")
      .map((c) => c + c)
      .join("");
  return (
    {
      black: "000000",
      white: "FFFFFF",
      red: "FF0000",
      blue: "0000FF",
      green: "008000",
      yellow: "FFFF00",
    } as Record<string, string>
  )[v.toLowerCase()];
};
function base64Bytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
function bytesBase64(value: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < value.length; i += 8192)
    binary += String.fromCharCode(...value.subarray(i, i + 8192));
  return btoa(binary);
}

/** Produces a real OPC/WordprocessingML package with styled text, tables, lists and embedded images. */
export async function toDOCX(document: FlowDocument): Promise<Uint8Array> {
  const zip = new JSZip(),
    rels: string[] = [],
    numberings: string[] = [],
    mediaTypes = new Set<string>();
  let relationId = 0,
    numberingId = 0,
    imageId = 0;
  const relationship = (type: string, target: string, external = false) => {
    const rid = "rId" + ++relationId;
    rels.push(
      `<Relationship Id="${rid}" Type="${REL}/${type}" Target="${esc(target)}"${external ? ' TargetMode="External"' : ""}/>`,
    );
    return rid;
  };
  const runProperties = (props: Record<string, any>) => {
    let xml = "";
    if (props.FontWeight != null)
      xml += `<w:b w:val="${/bold|[6-9]00/i.test(String(props.FontWeight)) ? 1 : 0}"/>`;
    if (props.FontStyle != null)
      xml += `<w:i w:val="${/italic|oblique/i.test(String(props.FontStyle)) ? 1 : 0}"/>`;
    if (props.TextDecorations) {
      if (/underline/i.test(String(props.TextDecorations)))
        xml += '<w:u w:val="single"/>';
      if (/strike|line-through/i.test(String(props.TextDecorations)))
        xml += "<w:strike/>";
    }
    if (props.BaselineAlignment)
      xml += `<w:vertAlign w:val="${props.BaselineAlignment === "Superscript" ? "superscript" : props.BaselineAlignment === "Subscript" ? "subscript" : "baseline"}"/>`;
    if (props.FontFamily)
      xml += `<w:rFonts w:ascii="${esc(props.FontFamily)}" w:hAnsi="${esc(props.FontFamily)}" w:eastAsia="${esc(props.FontFamily)}"/>`;
    if (Number(props.FontSize) > 0)
      xml += `<w:sz w:val="${Math.round(Number(props.FontSize) * 1.5)}"/>`;
    const color = hexColor(props.Foreground),
      background = hexColor(props.Background);
    if (color) xml += `<w:color w:val="${color}"/>`;
    if (background) xml += `<w:shd w:fill="${background}"/>`;
    return xml ? "<w:rPr>" + xml + "</w:rPr>" : "";
  };
  const inline = (
    n: DocumentNode,
    inherited: Record<string, any> = {},
  ): string => {
    const props = { ...inherited, ...n.props };
    if (n.type === "Bold") props.FontWeight = "Bold";
    if (n.type === "Italic") props.FontStyle = "Italic";
    if (n.type === "Underline") props.TextDecorations = "Underline";
    if (n.type === "Run")
      return (
        "<w:r>" +
        runProperties(props) +
        (n.text ?? "")
          .split(/(\n|\t)/)
          .map((t) =>
            t === "\n"
              ? "<w:br/>"
              : t === "\t"
                ? "<w:tab/>"
                : `<w:t xml:space="preserve">${esc(t)}</w:t>`,
          )
          .join("") +
        "</w:r>"
      );
    if (n.type === "LineBreak") return "<w:r><w:br/></w:r>";
    if (n.type === "Hyperlink") {
      const uri = safeURL(props.NavigateUri),
        body = (n.children ?? []).map((c) => inline(c, props)).join("");
      return uri
        ? `<w:hyperlink r:id="${relationship("hyperlink", uri, true)}">${body}</w:hyperlink>`
        : body;
    }
    if (n.type === "Image") {
      const match = String(props.Source ?? "").match(
        /^data:image\/(png|jpeg|gif);base64,([a-z0-9+/=]+)$/i,
      );
      if (!match)
        return `<w:r><w:t>${esc(props.AlternativeText ?? "[image]")}</w:t></w:r>`;
      const ext =
        match[1]!.toLowerCase() === "jpeg" ? "jpg" : match[1]!.toLowerCase();
      mediaTypes.add(ext);
      const image = ++imageId,
        filename = `image${image}.${ext}`;
      zip.file("word/media/" + filename, base64Bytes(match[2]!));
      const rid = relationship("image", "media/" + filename),
        width = Math.round((Number(props.Width) || 192) * 9525),
        height = Math.round((Number(props.Height) || 128) * 9525);
      return `<w:r><w:drawing><wp:inline><wp:extent cx="${width}" cy="${height}"/><wp:docPr id="${image}" name="Image ${image}" descr="${esc(props.AlternativeText ?? "")}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${image}" name="${filename}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
    }
    return (n.children ?? []).map((c) => inline(c, props)).join("");
  };
  const paragraph = (
    n: DocumentNode,
    props: Record<string, any>,
    num?: number,
    level = 0,
  ): string => {
    let pPr = "";
    if (n.props.HeadingLevel)
      pPr += `<w:pStyle w:val="Heading${Math.max(1, Math.min(6, Number(n.props.HeadingLevel)))}"/>`;
    if (props.FlowDirection)
      pPr += `<w:bidi w:val="${props.FlowDirection === "RightToLeft" ? "1" : "0"}"/>`;
    if (props.TextAlignment)
      pPr += `<w:jc w:val="${esc(String(props.TextAlignment).toLowerCase().replace("justify", "both"))}"/>`;
    if (props.BreakPageBefore) pPr += "<w:pageBreakBefore/>";
    if (props.KeepTogether) pPr += "<w:keepLines/>";
    if (props.KeepWithNext) pPr += "<w:keepNext/>";
    if (props.Margin && typeof props.Margin === "object")
      pPr += `<w:spacing w:before="${pxToTwip(props.Margin.Top)}" w:after="${pxToTwip(props.Margin.Bottom)}"/><w:ind w:left="${pxToTwip(props.Margin.Left)}" w:right="${pxToTwip(props.Margin.Right)}"/>`;
    if (num)
      pPr += `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${num}"/></w:numPr>`;
    return (
      "<w:p>" +
      (pPr ? "<w:pPr>" + pPr + "</w:pPr>" : "") +
      (n.children ?? []).map((c) => inline(c, props)).join("") +
      "</w:p>"
    );
  };
  const blocks = (
    nodes: DocumentNode[],
    inherited: Record<string, any> = {},
    num?: number,
    level = 0,
  ): string =>
    nodes
      .map((n) => {
        const props = { ...inherited, ...n.props };
        if (n.type === "Paragraph") return paragraph(n, props, num, level);
        if (n.type === "List") {
          const number = ++numberingId,
            ordered = /decimal|latin|roman|number/i.test(
              String(props.MarkerStyle),
            ),
            formats: Record<string, string> = {
              LowerLatin: "lowerLetter",
              UpperLatin: "upperLetter",
              LowerRoman: "lowerRoman",
              UpperRoman: "upperRoman",
            },
            format = ordered
              ? (formats[String(props.MarkerStyle)] ?? "decimal")
              : "bullet";
          numberings.push(
            `<w:abstractNum w:abstractNumId="${number}"><w:multiLevelType w:val="multilevel"/>${Array.from({ length: 9 }, (_, i) => `<w:lvl w:ilvl="${i}"><w:start w:val="${Number(props.StartIndex) || 1}"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${ordered ? "%" + (i + 1) + "." : "•"}"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="${720 * (i + 1)}"/></w:tabs><w:ind w:left="${720 * (i + 1)}" w:hanging="360"/></w:pPr></w:lvl>`).join("")}</w:abstractNum><w:num w:numId="${number}"><w:abstractNumId w:val="${number}"/></w:num>`,
          );
          return (n.children ?? [])
            .map((item) =>
              blocks(
                item.children ?? [],
                props,
                number,
                Math.min(8, num ? level + 1 : level),
              ),
            )
            .join("");
        }
        if (n.type === "Table") {
          const rows: DocumentNode[] = [];
          const gather = (n: DocumentNode) => {
            if (n.type === "TableRow") rows.push(n);
            else for (const c of n.children ?? []) gather(c);
          };
          gather(n);
          let columns = 1;
          const active = new Map<number, { remaining: number; span: number }>();
          const rowXML = rows
            .map((row) => {
              const cells = row.children ?? [],
                fragments: string[] = [];
              let column = 0,
                index = 0;
              while (
                index < cells.length ||
                [...active.keys()].some((key) => key >= column)
              ) {
                const continuing = active.get(column);
                if (continuing) {
                  fragments.push(
                    "<w:tc><w:tcPr>" +
                      (continuing.span > 1
                        ? `<w:gridSpan w:val="${continuing.span}"/>`
                        : "") +
                      "<w:vMerge/></w:tcPr><w:p/></w:tc>",
                  );
                  if (--continuing.remaining <= 0) active.delete(column);
                  column += continuing.span;
                  continue;
                }
                const cell = cells[index++];
                if (!cell) {
                  fragments.push("<w:tc><w:p/></w:tc>");
                  column++;
                  continue;
                }
                const span = Math.max(1, Number(cell.props.ColumnSpan) || 1),
                  rowSpan = Math.max(1, Number(cell.props.RowSpan) || 1);
                fragments.push(
                  "<w:tc><w:tcPr>" +
                    (span > 1 ? `<w:gridSpan w:val="${span}"/>` : "") +
                    (rowSpan > 1 ? '<w:vMerge w:val="restart"/>' : "") +
                    (hexColor(cell.props.Background)
                      ? `<w:shd w:fill="${hexColor(cell.props.Background)}"/>`
                      : "") +
                    "</w:tcPr>" +
                    (blocks(cell.children ?? [], { ...props, ...cell.props }) ||
                      "<w:p/>") +
                    ((cell.children ?? []).at(-1)?.type === "Table"
                      ? "<w:p/>"
                      : "") +
                    "</w:tc>",
                );
                if (rowSpan > 1)
                  active.set(column, { remaining: rowSpan - 1, span });
                column += span;
              }
              columns = Math.max(columns, column);
              return "<w:tr>" + fragments.join("") + "</w:tr>";
            })
            .join("");
          return (
            '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>' +
            ["top", "left", "bottom", "right", "insideH", "insideV"]
              .map(
                (side) =>
                  `<w:${side} w:val="single" w:sz="4" w:color="808080"/>`,
              )
              .join("") +
            "</w:tblBorders></w:tblPr><w:tblGrid>" +
            '<w:gridCol w:w="2400"/>'.repeat(columns) +
            "</w:tblGrid>" +
            rowXML +
            "</w:tbl>"
          );
        }
        return blocks(n.children ?? [], props, num, level);
      })
      .join("");
  const root = document.ToJSON(),
    content = blocks(root.children ?? [], root.props),
    p = root.props;
  let margins = p.PagePadding ?? 72;
  if (typeof margins !== "object")
    margins = { Left: margins, Top: margins, Right: margins, Bottom: margins };
  const sectPr = `<w:sectPr><w:pgSz w:w="${pxToTwip(p.PageWidth || 816)}" w:h="${pxToTwip(p.PageHeight || 1056)}"/><w:pgMar w:top="${pxToTwip(margins.Top)}" w:right="${pxToTwip(margins.Right)}" w:bottom="${pxToTwip(margins.Bottom)}" w:left="${pxToTwip(margins.Left)}" w:header="720" w:footer="720" w:gutter="0"/><w:cols w:num="${Math.max(1, Number(p.ColumnCount) || 1)}"/></w:sectPr>`;
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${NS}" xmlns:r="${REL}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${content}${sectPr}</w:body></w:document>`,
  );
  relationship("styles", "styles.xml");
  zip.file(
    "word/styles.xml",
    `<w:styles xmlns:w="${NS}"><w:docDefaults><w:rPrDefault>${runProperties(root.props)}</w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${Array.from({ length: 6 }, (_, i) => `<w:style w:type="paragraph" w:styleId="Heading${i + 1}"><w:name w:val="heading ${i + 1}"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="${i}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${48 - i * 4}"/></w:rPr></w:style>`).join("")}</w:styles>`,
  );
  if (numberings.length) {
    relationship("numbering", "numbering.xml");
    zip.file(
      "word/numbering.xml",
      `<w:numbering xmlns:w="${NS}">${numberings.join("")}</w:numbering>`,
    );
  }
  zip.file(
    "word/_rels/document.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`,
  );
  zip.file(
    "_rels/.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "[Content_Types].xml",
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${[...mediaTypes].map((ext) => `<Default Extension="${ext}" ContentType="image/${ext === "jpg" ? "jpeg" : ext}"/>`).join("")}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>${numberings.length ? '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' : ""}</Types>`,
  );
  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

/** Reads the principal WordprocessingML story. Does not execute macros, fields or linked resources. */
export async function fromDOCX(
  bytes: Uint8Array | ArrayBuffer,
): Promise<FlowDocument> {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (input.byteLength > 64 * 1024 * 1024)
    throw new RangeError("DOCX input exceeds 64 MiB.");
  const zip = await JSZip.loadAsync(input);
  if (Object.keys(zip.files).length > 10000)
    throw new RangeError("DOCX has too many ZIP entries.");
  let expandedSize = 0;
  const readBytes = async (name: string): Promise<Uint8Array | undefined> => {
    const file = zip.file(name);
    if (!file) return undefined;
    return new Promise<Uint8Array>((resolve, reject) => {
      const chunks: Uint8Array[] = [];
      let size = 0,
        failed = false;
      // JSZip 3.10.1 exposes this browser stream API, omitted from its published TS interface.
      const stream = (
        file as typeof file & {
          internalStream(
            type: "uint8array",
          ): JSZip.JSZipStreamHelper<Uint8Array>;
        }
      ).internalStream("uint8array");
      stream.on("data", (chunk: Uint8Array) => {
        size += chunk.length;
        expandedSize += chunk.length;
        if (size > 32 * 1024 * 1024 || expandedSize > 128 * 1024 * 1024) {
          failed = true;
          stream.pause();
          reject(new RangeError("DOCX expanded data exceeds import limits."));
          return;
        }
        chunks.push(chunk);
      });
      stream.on("error", reject);
      stream.on("end", () => {
        if (failed) return;
        const data = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          data.set(chunk, offset);
          offset += chunk.length;
        }
        resolve(data);
      });
      stream.resume();
    });
  };
  const read = async (name: string): Promise<string> => {
    const data = await readBytes(name);
    return data ? new TextDecoder().decode(data) : "";
  };
  const rootRels = parseOfficeXML(await read("_rels/.rels")),
    mainRel = descendants(rootRels, "Relationship").find((r) =>
      r.attrs.Type?.endsWith("/officeDocument"),
    );
  const mainPath = mainRel
    ? mainRel.attrs.Target!.replace(/^\//, "")
    : "word/document.xml";
  if (mainPath.includes("..") || mainRel?.attrs.TargetMode === "External")
    throw new Error("Invalid DOCX main document relationship.");
  const main = await read(mainPath);
  if (!main) throw new Error("DOCX document.xml is missing.");
  const dir = mainPath.slice(0, mainPath.lastIndexOf("/") + 1),
    filename = mainPath.slice(mainPath.lastIndexOf("/") + 1);
  const relationshipNodes = descendants(
    parseOfficeXML(await read(dir + "_rels/" + filename + ".rels")),
    "Relationship",
  );
  const relationships = new Map(
    relationshipNodes.map((r) => [r.attrs.Id!, r.attrs]),
  );
  const resolve = (target: string): string => {
    if (target.startsWith("/")) return target.slice(1);
    const parts = (dir + target).split("/"),
      clean: string[] = [];
    for (const p of parts) {
      if (p === "..") clean.pop();
      else if (p !== ".") clean.push(p);
    }
    return clean.join("/");
  };
  const findPart = (suffix: string, fallback: string) => {
    const r = relationshipNodes.find((r) =>
      r.attrs.Type?.endsWith("/" + suffix),
    );
    return r && r.attrs.TargetMode !== "External"
      ? resolve(r.attrs.Target!)
      : dir + fallback;
  };
  const styleRoot = parseOfficeXML(
      await read(findPart("styles", "styles.xml")),
    ),
    numberingRoot = parseOfficeXML(
      await read(findPart("numbering", "numbering.xml")),
    );
  const val = (n?: MarkupNode) => n?.attrs["w:val"];
  const bool = (n?: MarkupNode) =>
    !!n && !["0", "false", "off"].includes(val(n) ?? "");
  const runProps = (pr?: MarkupNode): Record<string, any> => {
    const p: Record<string, any> = {};
    if (!pr) return p;
    if (child(pr, "w:b"))
      p.FontWeight = bool(child(pr, "w:b")) ? "Bold" : "Normal";
    if (child(pr, "w:i"))
      p.FontStyle = bool(child(pr, "w:i")) ? "Italic" : "Normal";
    if (child(pr, "w:u"))
      p.TextDecorations =
        val(child(pr, "w:u")) === "none" ? "None" : "Underline";
    if (bool(child(pr, "w:strike")))
      p.TextDecorations =
        (p.TextDecorations ? p.TextDecorations + " " : "") + "line-through";
    const size = Number(val(child(pr, "w:sz")));
    if (size > 0) p.FontSize = size / 1.5;
    const baseline = val(child(pr, "w:vertAlign"));
    if (baseline)
      p.BaselineAlignment =
        baseline === "superscript"
          ? "Superscript"
          : baseline === "subscript"
            ? "Subscript"
            : "Baseline";
    const fonts = child(pr, "w:rFonts");
    if (fonts) p.FontFamily = fonts.attrs["w:ascii"] ?? fonts.attrs["w:hAnsi"];
    const color = val(child(pr, "w:color"));
    if (/^[a-f0-9]{6}$/i.test(color ?? "")) p.Foreground = "#" + color;
    const fill = child(pr, "w:shd")?.attrs["w:fill"];
    if (/^[a-f0-9]{6}$/i.test(fill ?? "")) p.Background = "#" + fill;
    const highlight = val(child(pr, "w:highlight"));
    if (highlight && highlight !== "none") p.Background = highlight;
    return p;
  };
  const styles = new Map(
    descendants(styleRoot, "w:style").map((s) => [s.attrs["w:styleId"]!, s]),
  );
  const inheritedStyle = (
    id?: string,
    seen = new Set<string>(),
  ): Record<string, any> => {
    if (!id || seen.has(id)) return {};
    seen.add(id);
    const style = styles.get(id);
    if (!style) return {};
    return {
      ...inheritedStyle(val(child(style, "w:basedOn")), seen),
      ...runProps(child(style, "w:rPr")),
    };
  };
  const paragraphProps = (pr?: MarkupNode): Record<string, any> => {
    const styleId = val(child(pr, "w:pStyle")),
      p = inheritedStyle(styleId);
    if (!pr) return p;
    if (child(pr, "w:bidi"))
      p.FlowDirection = bool(child(pr, "w:bidi"))
        ? "RightToLeft"
        : "LeftToRight";
    const align = val(child(pr, "w:jc"));
    if (align)
      p.TextAlignment =
        align === "both" ? "Justify" : align[0]!.toUpperCase() + align.slice(1);
    const heading = styleId?.match(/^Heading([1-6])$/i);
    const outline =
      val(child(pr, "w:outlineLvl")) ??
      val(child(child(styles.get(styleId ?? ""), "w:pPr"), "w:outlineLvl"));
    if (heading) p.HeadingLevel = Number(heading[1]);
    else if (outline != null && Number(outline) < 6)
      p.HeadingLevel = Number(outline) + 1;
    if (bool(child(pr, "w:pageBreakBefore"))) p.BreakPageBefore = true;
    if (bool(child(pr, "w:keepLines"))) p.KeepTogether = true;
    if (bool(child(pr, "w:keepNext"))) p.KeepWithNext = true;
    const spacing = child(pr, "w:spacing"),
      indent = child(pr, "w:ind");
    if (spacing || indent)
      p.Margin = {
        Top: Number(spacing?.attrs["w:before"] || 0) / 15,
        Bottom: Number(spacing?.attrs["w:after"] || 0) / 15,
        Left: Number(indent?.attrs["w:left"] || 0) / 15,
        Right: Number(indent?.attrs["w:right"] || 0) / 15,
      };
    return p;
  };
  const images = new Map<string, string>();
  for (const [rid, rel] of relationships) {
    if (!rel.Type?.endsWith("/image") || rel.TargetMode === "External")
      continue;
    const path = resolve(rel.Target!),
      ext = path.split(".").pop()!.toLowerCase();
    if (!["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) continue;
    const data = await readBytes(path);
    if (!data) continue;
    images.set(
      rid,
      `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${bytesBase64(data)}`,
    );
  }
  const inlines = (
    nodes: MarkupNode[],
    inherited: Record<string, any> = {},
  ): DocumentNode[] =>
    nodes.flatMap((n) => {
      if (n.name === "w:r")
        return inlines(
          n.children.filter((c) => c.name !== "w:rPr"),
          { ...inherited, ...runProps(child(n, "w:rPr")) },
        );
      if (n.name === "w:t") return [node("Run", [], inherited, textContent(n))];
      if (n.name === "w:tab") return [node("Run", [], inherited, "\t")];
      if (n.name === "w:br" || n.name === "w:cr") return [node("LineBreak")];
      if (n.name === "w:noBreakHyphen")
        return [node("Run", [], inherited, "‑")];
      if (n.name === "w:softHyphen")
        return [node("Run", [], inherited, "\u00ad")];
      if (n.name === "w:hyperlink") {
        const rel = relationships.get(n.attrs["r:id"] ?? ""),
          uri = safeURL(
            rel?.Target ??
              (n.attrs["w:anchor"] ? "#" + n.attrs["w:anchor"] : ""),
          );
        return [
          node(
            "Hyperlink",
            inlines(n.children, inherited),
            uri ? { NavigateUri: uri } : {},
          ),
        ];
      }
      if (n.name === "w:drawing") {
        const blip = descendants(n, "a:blip")[0],
          src = images.get(blip?.attrs["r:embed"] ?? ""),
          extent = descendants(n, "wp:extent")[0],
          description = descendants(n, "wp:docPr")[0]?.attrs.descr ?? "";
        return src
          ? [
              node("Image", [], {
                Source: src,
                AlternativeText: description,
                Width: Number(extent?.attrs.cx || 0) / 9525,
                Height: Number(extent?.attrs.cy || 0) / 9525,
              }),
            ]
          : description
            ? [node("Run", [], {}, description)]
            : [];
      }
      if (
        [
          "w:ins",
          "w:smartTag",
          "w:sdtContent",
          "w:sdt",
          "w:fldSimple",
        ].includes(n.name)
      )
        return inlines(n.children, inherited);
      return [];
    });
  const nums = new Map(
    descendants(numberingRoot, "w:num").map((n) => [
      n.attrs["w:numId"]!,
      val(child(n, "w:abstractNumId")),
    ]),
  );
  const abstractNums = new Map(
    descendants(numberingRoot, "w:abstractNum").map((n) => [
      n.attrs["w:abstractNumId"]!,
      n,
    ]),
  );
  const listProps = (numId: string, level: string) => {
    const abstract = abstractNums.get(nums.get(numId) ?? ""),
      lvl = abstract?.children.find(
        (c) => c.name === "w:lvl" && c.attrs["w:ilvl"] === level,
      );
    const format = val(child(lvl, "w:numFmt"));
    return {
      MarkerStyle:
        (
          {
            bullet: "Disc",
            lowerLetter: "LowerLatin",
            upperLetter: "UpperLatin",
            lowerRoman: "LowerRoman",
            upperRoman: "UpperRoman",
          } as Record<string, string>
        )[format ?? ""] ?? "Decimal",
      StartIndex: Number(val(child(lvl, "w:start"))) || 1,
    };
  };
  const convertBlocks = (children: MarkupNode[]): DocumentNode[] => {
    const result: DocumentNode[] = [];
    const listStack: { num: string; level: number; list: DocumentNode }[] = [];
    for (const n of children) {
      if (n.name === "w:p") {
        const pr = child(n, "w:pPr"),
          props = paragraphProps(pr),
          para = node("Paragraph", inlines(n.children, props), props),
          numPr = child(pr, "w:numPr"),
          numId = val(child(numPr, "w:numId"));
        if (numId && numId !== "0") {
          const level = Math.max(
            0,
            Math.min(8, Number(val(child(numPr, "w:ilvl"))) || 0),
          );
          while (
            listStack.length &&
            (listStack.at(-1)!.level > level ||
              (listStack.at(-1)!.level === level &&
                listStack.at(-1)!.num !== numId))
          )
            listStack.pop();
          let entry = listStack.at(-1);
          if (!entry || entry.level < level) {
            const list = node("List", [], listProps(numId, String(level)));
            list.children = [];
            const parentItem = entry?.list.children?.at(-1);
            if (parentItem) (parentItem.children ??= []).push(list);
            else result.push(list);
            entry = { num: numId, level, list };
            listStack.push(entry);
          }
          entry.list.children!.push(node("ListItem", [para]));
        } else {
          listStack.length = 0;
          result.push(para);
        }
      } else if (n.name === "w:tbl") {
        listStack.length = 0;
        const active = new Map<number, DocumentNode>();
        const rows = n.children
          .filter((c) => c.name === "w:tr")
          .map((row) => {
            let column = 0;
            const cells: DocumentNode[] = [],
              touched = new Set<number>();
            for (const cell of row.children.filter((c) => c.name === "w:tc")) {
              const pr = child(cell, "w:tcPr"),
                span = Math.max(1, Number(val(child(pr, "w:gridSpan"))) || 1),
                merge = child(pr, "w:vMerge"),
                existing = active.get(column);
              if (merge && val(merge) !== "restart" && existing) {
                existing.props.RowSpan =
                  (Number(existing.props.RowSpan) || 1) + 1;
                touched.add(column);
                column += span;
                continue;
              }
              const props: Record<string, any> = { ColumnSpan: span };
              const fill = child(pr, "w:shd")?.attrs["w:fill"];
              if (/^[a-f0-9]{6}$/i.test(fill ?? ""))
                props.Background = "#" + fill;
              const imported = node(
                "TableCell",
                convertBlocks(cell.children),
                props,
              );
              cells.push(imported);
              if (merge && val(merge) === "restart") {
                props.RowSpan = 1;
                active.set(column, imported);
                touched.add(column);
              } else active.delete(column);
              column += span;
            }
            for (const key of active.keys())
              if (!touched.has(key)) active.delete(key);
            return node("TableRow", cells);
          });
        result.push(node("Table", [node("TableRowGroup", rows)]));
      } else if (["w:sdt", "w:sdtContent", "w:ins"].includes(n.name))
        result.push(...convertBlocks(n.children));
    }
    return result;
  };
  const parsed = parseOfficeXML(main),
    body = descendants(parsed, "w:body")[0];
  if (!body) throw new Error("DOCX body is missing.");
  const defaults = runProps(
    child(descendants(styleRoot, "w:rPrDefault")[0], "w:rPr"),
  );
  const sectPr = child(body, "w:sectPr"),
    pageSize = child(sectPr, "w:pgSz"),
    margin = child(sectPr, "w:pgMar");
  if (pageSize) {
    defaults.PageWidth = Number(pageSize.attrs["w:w"]) / 15;
    defaults.PageHeight = Number(pageSize.attrs["w:h"]) / 15;
  }
  if (margin)
    defaults.PagePadding = {
      Left: Number(margin.attrs["w:left"]) / 15,
      Top: Number(margin.attrs["w:top"]) / 15,
      Right: Number(margin.attrs["w:right"]) / 15,
      Bottom: Number(margin.attrs["w:bottom"]) / 15,
    };
  const cols = child(sectPr, "w:cols");
  if (cols) defaults.ColumnCount = Number(cols.attrs["w:num"]) || 1;
  return FlowDocument.FromJSON(
    node("FlowDocument", convertBlocks(body.children), defaults),
  );
}
