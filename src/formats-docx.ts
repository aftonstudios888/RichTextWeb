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
    "http://schemas.microsoft.com/office/word/2010/wordml": "w14",
    "http://schemas.microsoft.com/office/word/2012/wordml": "w15",
    "http://schemas.openxmlformats.org/officeDocument/2006/math": "m",
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
function officeMarkup(n: MarkupNode): string {
  if (n.name === "#text") return esc(n.text ?? "");
  if (n.name === "#root") return n.children.map(officeMarkup).join("");
  return `<${n.name}${Object.entries(n.attrs)
    .map(([k, v]) => ` ${k}="${esc(v)}"`)
    .join("")}>${n.children.map(officeMarkup).join("")}</${n.name}>`;
}
/** Fold native begin/instruction/separate/end fields into a single inert field node. */
function normalizeFields(nodes: MarkupNode[]): MarkupNode[] {
  const output: MarkupNode[] = [],
    stack: { instruction: string; result: MarkupNode[]; separated: boolean }[] =
      [];
  const append = (n: MarkupNode) => {
    const field = stack.at(-1);
    if (!field) output.push(n);
    else if (field.separated) field.result.push(n);
  };
  for (const n of nodes) {
    const fld = n.name === "w:r" ? child(n, "w:fldChar") : undefined,
      kind = fld?.attrs["w:fldCharType"];
    if (kind === "begin") {
      stack.push({ instruction: "", result: [], separated: false });
      continue;
    }
    if (kind === "separate" && stack.length) {
      stack.at(-1)!.separated = true;
      continue;
    }
    if (kind === "end" && stack.length) {
      const field = stack.pop()!;
      append({
        name: "w:fldSimple",
        attrs: { "w:instr": field.instruction.trim() },
        children: field.result,
      });
      continue;
    }
    const instruction = descendants(n, "w:instrText").map(textContent).join("");
    if (instruction && stack.length && !stack.at(-1)!.separated) {
      stack.at(-1)!.instruction += instruction;
      continue;
    }
    append(n);
  }
  for (const field of stack) output.push(...field.result);
  return output;
}
function groupTableOfContents(children: MarkupNode[]): MarkupNode[] {
  const output: MarkupNode[] = [];
  for (let index = 0; index < children.length; index++) {
    const first = children[index]!,
      instruction = descendants(first, "w:instrText")
        .map(textContent)
        .join("")
        .trim();
    if (
      first.name !== "w:p" ||
      !/^TOC(?:\s|$)/i.test(instruction) ||
      !descendants(first, "w:fldChar").some(
        (c) => c.attrs["w:fldCharType"] === "begin",
      )
    ) {
      output.push(first);
      continue;
    }
    let depth = 0,
      end = index,
      started = false;
    outer: for (; end < children.length; end++) {
      for (const marker of descendants(children[end]!, "w:fldChar")) {
        if (marker.attrs["w:fldCharType"] === "begin") {
          depth++;
          started = true;
        } else if (marker.attrs["w:fldCharType"] === "end") {
          depth--;
          if (started && depth === 0) break outer;
        }
      }
    }
    if (end >= children.length) {
      output.push(first);
      continue;
    }
    const members = JSON.parse(
      JSON.stringify(children.slice(index, end + 1)),
    ) as MarkupNode[];
    depth = 0;
    let separated = false;
    const clean = (n: MarkupNode): MarkupNode | undefined => {
      if (n.name === "w:fldChar") {
        const kind = n.attrs["w:fldCharType"];
        if (kind === "begin") {
          depth++;
          if (depth === 1) return undefined;
        } else if (kind === "separate" && depth === 1) {
          separated = true;
          return undefined;
        } else if (kind === "end") {
          depth--;
          if (depth === 0) return undefined;
        }
      }
      if (n.name === "w:instrText" && depth === 1 && !separated)
        return undefined;
      n.children = n.children.map(clean).filter((x): x is MarkupNode => !!x);
      if (n.name === "w:r" && n.children.every((c) => c.name === "w:rPr"))
        return undefined;
      return n;
    };
    const body = members.map(clean).filter((x): x is MarkupNode => !!x);
    output.push({
      name: "rtw:toc",
      attrs: { Instruction: instruction },
      children: body,
    });
    index = end;
  }
  return output;
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
function resolveRelativePart(base: string, target: string): string {
  const source = target.startsWith("/")
    ? target.slice(1)
    : base.slice(0, base.lastIndexOf("/") + 1) + target;
  const result: string[] = [];
  for (const part of source.split("/")) {
    if (part === "..") result.pop();
    else if (part !== "." && part) result.push(part);
  }
  return result.join("/");
}
const originalPartName = (name: string): string =>
  name.replace(/^(?:rtw-preserved\/)+/, "");
const retainedPartName = (name: string): boolean =>
  /^word\/(?:charts|diagrams|drawings|media|theme)\/[a-z0-9_./ ()-]+\.(?:xml|rels|png|jpe?g|gif|webp)$/i.test(
    name,
  ) && !name.split("/").includes("..");
const retainedRelationship = (type: string): boolean =>
  /\/(?:chart|chartStyle|chartColorStyle|image|diagramData|diagramLayout|diagramQuickStyle|diagramColors|theme|hyperlink)$/.test(
    type,
  );
function safeOpaqueXML(xml: string): MarkupNode | undefined {
  const parsed = parseOfficeXML(xml),
    root = parsed.children.find((n) => n.name !== "#text");
  if (!root || !["w:drawing", "m:oMath", "m:oMathPara"].includes(root.name))
    return undefined;
  const blocked = new Set([
    "w:object",
    "w:altChunk",
    "o:OLEObject",
    "w:control",
    "script",
    "iframe",
    "w:instrText",
    "w:fldSimple",
    "w:fldChar",
  ]);
  const inspect = (n: MarkupNode): boolean =>
    !blocked.has(n.name) &&
    !Object.keys(n.attrs).some((k) => /^on[a-z]/i.test(k)) &&
    n.children.every(inspect);
  return inspect(root) ? root : undefined;
}
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
  const root = document.ToJSON();
  const zip = new JSZip(),
    rels: string[] = [],
    numberings: string[] = [],
    mediaTypes = new Set<string>();
  let activeRels = rels;
  const extraTypes: string[] = [];
  const noteIds = new Map<string, number>();
  for (const kind of ["Footnote", "Endnote"])
    for (const [index, note] of (root.props[kind + "s"] ?? []).entries())
      noteIds.set(kind + ":" + note.Id, index + 1);
  let reviewActive = true,
    exportOffset = 0,
    paragraphCount = 0;
  let relationId = 0,
    numberingId = 0,
    imageId = 0;
  const relationship = (type: string, target: string, external = false) => {
    const rid = "rId" + ++relationId;
    activeRels.push(
      `<Relationship Id="${rid}" Type="${type.startsWith("http") ? esc(type) : REL + "/" + type}" Target="${esc(target)}"${external ? ' TargetMode="External"' : ""}/>`,
    );
    return rid;
  };
  const retainedParts: any[] = (
    Array.isArray(root.props.DocxPreservedParts)
      ? root.props.DocxPreservedParts
      : []
  ).filter(
    (part: any) =>
      typeof part.Name === "string" &&
      retainedPartName(part.Name) &&
      typeof part.Data === "string",
  );
  const retainedNames = new Set(retainedParts.map((p) => p.Name));
  let retainedSize = 0;
  for (const part of retainedParts) {
    let data = base64Bytes(part.Data);
    retainedSize += data.length;
    if (data.length > 32 * 1024 * 1024 || retainedSize > 128 * 1024 * 1024)
      throw new RangeError("Preserved DOCX parts exceed resource limits.");
    if (part.Name.endsWith(".rels")) {
      const relRoot = parseOfficeXML(new TextDecoder().decode(data));
      const base = part.Name.replace("/_rels/", "/").replace(/\.rels$/, "");
      const safe = descendants(relRoot, "Relationship").filter(
        (r) =>
          retainedRelationship(r.attrs.Type ?? "") &&
          (r.attrs.TargetMode === "External"
            ? r.attrs.Type?.endsWith("/hyperlink") && !!safeURL(r.attrs.Target)
            : retainedNames.has(
                originalPartName(
                  resolveRelativePart(base, r.attrs.Target ?? ""),
                ),
              )),
      );
      for (const r of safe)
        if (
          r.attrs.TargetMode !== "External" &&
          r.attrs.Target?.startsWith("/")
        )
          r.attrs.Target =
            "/rtw-preserved/" + originalPartName(r.attrs.Target.slice(1));
      data = new TextEncoder().encode(
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${safe.map(officeMarkup).join("")}</Relationships>`,
      );
    }
    if (part.Name.endsWith(".xml"))
      parseOfficeXML(new TextDecoder().decode(data));
    zip.file("rtw-preserved/" + part.Name, data);
    if (
      typeof part.ContentType === "string" &&
      /^[a-z0-9.+/-]+$/i.test(part.ContentType) &&
      !/macro|oleobject|activex|executable/i.test(part.ContentType)
    )
      extraTypes.push(
        `<Override PartName="/rtw-preserved/${esc(part.Name)}" ContentType="${esc(part.ContentType)}"/>`,
      );
  }
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
  const reviews: any[] = Array.isArray(root.props.Annotations)
    ? root.props.Annotations
    : [];
  const events = new Map<number, (() => string)[]>();
  const event = (offset: number, emit: () => string) => {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > document.Text.length
    )
      return;
    const list = events.get(offset) ?? [];
    list.push(emit);
    events.set(offset, list);
  };
  const deletedXML = (nodes: DocumentNode[]): string =>
    nodes
      .map((n) =>
        n.type === "Run"
          ? `<w:r>${runProperties(n.props)}<w:delText xml:space="preserve">${esc(n.text ?? "")}</w:delText></w:r>`
          : n.type === "LineBreak"
            ? "<w:r><w:br/></w:r>"
            : deletedXML(n.children ?? []),
      )
      .join("");
  const commentReviews = reviews.filter((a) => a.Kind === "Comment");
  for (const [index, a] of reviews.entries()) {
    const data = a.Data ?? {},
      author = ` w:author="${esc(data.Author ?? "")}"`,
      date = data.CreatedAt ? ` w:date="${esc(data.CreatedAt)}"` : "";
    if (a.Kind === "Comment") {
      const cid = commentReviews.indexOf(a);
      event(a.Start, () => `<w:commentRangeStart w:id="${cid}"/>`);
      event(
        a.End,
        () =>
          `<w:commentRangeEnd w:id="${cid}"/><w:r><w:commentReference w:id="${cid}"/></w:r>`,
      );
    }
    if (a.Kind === "Bookmark") {
      event(
        a.Start,
        () =>
          `<w:bookmarkStart w:id="${index}" w:name="${esc(data.Name ?? "Bookmark" + index)}"/>`,
      );
      event(a.End, () => `<w:bookmarkEnd w:id="${index}"/>`);
    }
    if (a.Kind === "Deletion")
      event(
        a.Start,
        () =>
          `<w:del w:id="${index}"${author}${date}>${deletedXML(data.Nodes ?? [node("Run", [], {}, String(data.Text ?? ""))])}</w:del>`,
      );
  }
  const emitMarkers = (): string => {
    if (!reviewActive) return "";
    const list = events.get(exportOffset);
    events.delete(exportOffset);
    return list?.map((emit) => emit()).join("") ?? "";
  };
  const insertions = reviews.filter(
    (a) => a.Kind === "Insertion" && a.End > a.Start,
  );
  const wrapInsertion = (xml: string, offset: number): string => {
    if (!reviewActive) return xml;
    const a = insertions.find((a) => a.Start <= offset && a.End > offset);
    if (!a) return xml;
    return `<w:ins w:id="${reviews.indexOf(a)}" w:author="${esc(a.Data?.Author ?? "")}"${a.Data?.CreatedAt ? ` w:date="${esc(a.Data.CreatedAt)}"` : ""}>${xml}</w:ins>`;
  };
  const rawRun = (text: string, props: Record<string, any>) =>
    "<w:r>" +
    runProperties(props) +
    text
      .split(/(\n|\t)/)
      .map((t) =>
        t === "\n"
          ? "<w:br/>"
          : t === "\t"
            ? "<w:tab/>"
            : `<w:t xml:space="preserve">${esc(t)}</w:t>`,
      )
      .join("") +
    "</w:r>";
  const emitText = (text: string, props: Record<string, any>): string => {
    if (!reviewActive) return rawRun(text, props);
    const end = exportOffset + text.length,
      start = exportOffset;
    const points = [
      ...new Set([
        exportOffset,
        end,
        ...events.keys(),
        ...insertions.flatMap((a) => [a.Start, a.End]),
      ]),
    ]
      .filter((v) => v >= start && v <= end)
      .sort((a, b) => a - b);
    let xml = emitMarkers();
    for (let i = 1; i < points.length; i++) {
      const to = points[i]!;
      xml += wrapInsertion(
        rawRun(text.slice(exportOffset - start, to - start), props),
        exportOffset,
      );
      exportOffset = to;
      xml += emitMarkers();
    }
    return xml || rawRun("", props);
  };
  const inline = (
    n: DocumentNode,
    inherited: Record<string, any> = {},
  ): string => {
    const props = { ...inherited, ...n.props };
    if (n.type === "Bold") props.FontWeight = "Bold";
    if (n.type === "Italic") props.FontStyle = "Italic";
    if (n.type === "Underline") props.TextDecorations = "Underline";
    if (typeof n.props.DocxOpaqueXML === "string") {
      const opaque = safeOpaqueXML(n.props.DocxOpaqueXML);
      if (opaque) {
        const mapping = new Map<string, string>();
        for (const rel of n.props.DocxOpaqueRelationships ?? []) {
          if (!retainedRelationship(String(rel.Type ?? ""))) continue;
          if (rel.TargetMode === "External") {
            const uri = safeURL(rel.Target);
            if (rel.Type.endsWith("/hyperlink") && uri)
              mapping.set(rel.Id, relationship(rel.Type, uri, true));
          } else if (retainedNames.has(rel.Target))
            mapping.set(
              rel.Id,
              relationship(rel.Type, "../rtw-preserved/" + rel.Target),
            );
        }
        const rewrite = (n: MarkupNode) => {
          for (const key of Object.keys(n.attrs))
            if (/^r:(?:id|embed|link|dm|lo|qs|cs)$/.test(key)) {
              const value = mapping.get(n.attrs[key]!);
              if (value) n.attrs[key] = value;
              else delete n.attrs[key];
            }
          for (const c of n.children) rewrite(c);
        };
        rewrite(opaque);
        return (
          emitMarkers() +
          (opaque.name === "w:drawing"
            ? "<w:r>" + officeMarkup(opaque) + "</w:r>"
            : officeMarkup(opaque))
        );
      }
    }
    if (n.props.Field) {
      const field = n.props.Field,
        instruction = String(field.Instruction ?? field.Type ?? ""),
        type = instruction.trim().split(/\s+/)[0]?.toUpperCase();
      const body = (n.children ?? []).map((c) => inline(c, props)).join("");
      return [
        "PAGE",
        "NUMPAGES",
        "DATE",
        "REF",
        "MERGEFIELD",
        "TOC",
        "TIME",
        "SAVEDATE",
        "CREATEDATE",
        "TITLE",
        "AUTHOR",
        "SECTION",
        "SECTIONPAGES",
        "SEQ",
        "NOTEREF",
        "PAGEREF",
        "FILENAME",
      ].includes(type)
        ? `<w:fldSimple w:instr="${esc(instruction)}" w:dirty="${field.Dirty ? "true" : "false"}">${body}</w:fldSimple>`
        : body;
    }
    if (n.props.NoteReference) {
      const note = n.props.NoteReference,
        kind = note.Kind === "Endnote" ? "Endnote" : "Footnote",
        nid = noteIds.get(kind + ":" + note.Id);
      if (!nid) return emitText(n.text ?? "", props);
      const prefix = emitMarkers(),
        start = exportOffset;
      if (reviewActive) exportOffset += (n.text ?? String(nid)).length;
      return (
        prefix +
        wrapInsertion(
          `<w:r>${runProperties(props)}<w:${kind.toLowerCase()}Reference w:id="${nid}"/></w:r>`,
          start,
        ) +
        emitMarkers()
      );
    }
    if (n.type === "Run") return emitText(n.text ?? "", props);
    if (n.type === "LineBreak") {
      const prefix = emitMarkers(),
        start = exportOffset;
      if (reviewActive) exportOffset++;
      return (
        prefix + wrapInsertion("<w:r><w:br/></w:r>", start) + emitMarkers()
      );
    }
    if (n.type === "Hyperlink") {
      const uri = safeURL(props.NavigateUri),
        body = (n.children ?? []).map((c) => inline(c, props)).join("");
      return uri
        ? `<w:hyperlink r:id="${relationship("hyperlink", uri, true)}">${body}</w:hyperlink>`
        : body;
    }
    if (n.type === "Image") {
      const imageMarkers = emitMarkers(),
        imageOffset = exportOffset;
      if (reviewActive) exportOffset++;
      const match = String(props.Source ?? "").match(
        /^data:image\/(png|jpeg|gif);base64,([a-z0-9+/=]+)$/i,
      );
      if (!match)
        return (
          imageMarkers +
          wrapInsertion(
            `<w:r><w:t>${esc(props.AlternativeText ?? "[image]")}</w:t></w:r>`,
            imageOffset,
          ) +
          emitMarkers()
        );
      const ext =
        match[1]!.toLowerCase() === "jpeg" ? "jpg" : match[1]!.toLowerCase();
      mediaTypes.add(ext);
      const image = ++imageId,
        filename = `image${image}.${ext}`;
      zip.file("word/media/" + filename, base64Bytes(match[2]!));
      const rid = relationship("image", "media/" + filename),
        width = Math.round((Number(props.Width) || 192) * 9525),
        height = Math.round((Number(props.Height) || 128) * 9525);
      return (
        imageMarkers +
        wrapInsertion(
          `<w:r><w:drawing><wp:inline><wp:extent cx="${width}" cy="${height}"/><wp:docPr id="${image}" name="Image ${image}" descr="${esc(props.AlternativeText ?? "")}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${image}" name="${filename}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`,
          imageOffset,
        ) +
        emitMarkers()
      );
    }
    return (n.children ?? []).map((c) => inline(c, props)).join("");
  };
  const paragraph = (
    n: DocumentNode,
    props: Record<string, any>,
    num?: number,
    level = 0,
  ): string => {
    if (reviewActive && paragraphCount++ > 0) exportOffset++;
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
      emitMarkers() +
      (n.children ?? []).map((c) => inline(c, props)).join("") +
      emitMarkers() +
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
        if (n.type === "Section" && n.props.TableOfContents) {
          const xml = parseOfficeXML(
              blocks(n.children ?? [], props, num, level),
            ),
            paragraphs = descendants(xml, "w:p");
          if (!paragraphs.length) return "";
          const first = paragraphs[0]!,
            last = paragraphs.at(-1)!,
            instruction = String(
              /^TOC(?:\s|$)/i.test(
                String(n.props.TableOfContents.Instruction ?? ""),
              )
                ? n.props.TableOfContents.Instruction
                : `TOC \\o "1-${Math.max(1, Math.min(9, Number(n.props.TableOfContents.MaxLevel) || 3))}" \\h`,
            );
          const begin = parseOfficeXML(
            `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve">${esc(instruction)}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>`,
          ).children;
          first.children.splice(
            first.children[0]?.name === "w:pPr" ? 1 : 0,
            0,
            ...begin,
          );
          last.children.push(
            ...parseOfficeXML('<w:r><w:fldChar w:fldCharType="end"/></w:r>')
              .children,
          );
          return officeMarkup(xml);
        }
        if (
          n.type === "Section" &&
          (n.props.SectionBreak ||
            n.props.PageWidth ||
            n.props.Headers ||
            n.props.Footers)
        ) {
          const body = parseOfficeXML(
              blocks(n.children ?? [], props, num, level),
            ),
            section = parseOfficeXML(sectionProperties(props)).children[0]!;
          let last = body.children.at(-1);
          if (last?.name !== "w:p") {
            last = { name: "w:p", attrs: {}, children: [] };
            body.children.push(last);
          }
          let pr = child(last, "w:pPr");
          if (!pr) {
            pr = { name: "w:pPr", attrs: {}, children: [] };
            last.children.unshift(pr);
          }
          pr.children.push(section);
          return officeMarkup(body);
        }
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
  const storyNamespaces = `xmlns:w="${NS}" xmlns:r="${REL}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"`;
  let storyId = 0;
  const createStory = (kind: string, story: DocumentNode[]): string => {
    const filename = `${kind}${++storyId}.xml`,
      previousRels = activeRels,
      previousReview = reviewActive,
      ownRels: string[] = [];
    activeRels = ownRels;
    reviewActive = false;
    const body = blocks(story);
    activeRels = previousRels;
    reviewActive = previousReview;
    zip.file(
      "word/" + filename,
      `<w:${kind === "header" ? "hdr" : "ftr"} ${storyNamespaces}>${body || "<w:p/>"}</w:${kind === "header" ? "hdr" : "ftr"}>`,
    );
    if (ownRels.length)
      zip.file(
        "word/_rels/" + filename + ".rels",
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${ownRels.join("")}</Relationships>`,
      );
    extraTypes.push(
      `<Override PartName="/word/${filename}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml"/>`,
    );
    return relationship(kind, filename);
  };
  const sectionProperties = (p: Record<string, any>): string => {
    let margins = p.PagePadding ?? 72;
    if (typeof margins !== "object")
      margins = {
        Left: margins,
        Top: margins,
        Right: margins,
        Bottom: margins,
      };
    let refs = "";
    for (const [key, kind, variant] of [
      ["Headers", "header", "default"],
      ["Footers", "footer", "default"],
      ["FirstPageHeader", "header", "first"],
      ["FirstPageFooter", "footer", "first"],
      ["EvenPageHeader", "header", "even"],
      ["EvenPageFooter", "footer", "even"],
    ])
      if (Array.isArray(p[key!]))
        refs += `<w:${kind}Reference w:type="${variant}" r:id="${createStory(kind!, p[key!])}"/>`;
    const columnWidths = Array.isArray(p.ColumnWidths)
      ? p.ColumnWidths.map(
          (w: number) =>
            `<w:col w:w="${pxToTwip(w)}" w:space="${pxToTwip(p.ColumnGap ?? 24)}"/>`,
        ).join("")
      : "";
    return `<w:sectPr>${refs}${p.SectionBreak ? `<w:type w:val="${esc(p.SectionBreak)}"/>` : ""}<w:pgSz w:w="${pxToTwip(p.PageWidth || 816)}" w:h="${pxToTwip(p.PageHeight || 1056)}"${p.PageOrientation ? ` w:orient="${esc(String(p.PageOrientation).toLowerCase())}"` : ""}/><w:pgMar w:top="${pxToTwip(margins.Top)}" w:right="${pxToTwip(margins.Right)}" w:bottom="${pxToTwip(margins.Bottom)}" w:left="${pxToTwip(margins.Left)}" w:header="${pxToTwip(p.HeaderDistance ?? 48)}" w:footer="${pxToTwip(p.FooterDistance ?? 48)}" w:gutter="${pxToTwip(p.Gutter ?? 0)}"/><w:cols w:num="${Math.max(1, Number(p.ColumnCount) || 1)}" w:space="${pxToTwip(p.ColumnGap ?? 24)}"${columnWidths ? ' w:equalWidth="0"' : ""}>${columnWidths}</w:cols>${p.FirstPageHeader || p.FirstPageFooter ? "<w:titlePg/>" : ""}${p.PageNumberStart ? `<w:pgNumType w:start="${Number(p.PageNumberStart)}"/>` : ""}</w:sectPr>`;
  };
  const content = blocks(root.children ?? [], root.props),
    sectPr = sectionProperties(root.props);
  reviewActive = false;
  for (const kind of ["Footnote", "Endnote"]) {
    const notes = root.props[kind + "s"];
    if (!Array.isArray(notes) || !notes.length) continue;
    const ownRels: string[] = [];
    activeRels = ownRels;
    const tag = kind.toLowerCase(),
      filename = tag + "s.xml";
    const body = notes
      .map(
        (note: any) =>
          `<w:${tag} w:id="${noteIds.get(kind + ":" + note.Id)}">${blocks(note.Blocks ?? []) || "<w:p/>"}</w:${tag}>`,
      )
      .join("");
    activeRels = rels;
    zip.file(
      "word/" + filename,
      `<w:${tag}s ${storyNamespaces}><w:${tag} w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:${tag}><w:${tag} w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:${tag}>${body}</w:${tag}s>`,
    );
    if (ownRels.length)
      zip.file(
        "word/_rels/" + filename + ".rels",
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${ownRels.join("")}</Relationships>`,
      );
    relationship(tag + "s", filename);
    extraTypes.push(
      `<Override PartName="/word/${filename}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${tag}s+xml"/>`,
    );
  }
  if (commentReviews.length) {
    relationship("comments", "comments.xml");
    extraTypes.push(
      '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>',
    );
    const commentRels: string[] = [];
    activeRels = commentRels;
    const commentBody = commentReviews
      .map((a, index) => {
        const content = parseOfficeXML(
          blocks(
            a.Data?.Blocks ?? [
              node("Paragraph", [
                node("Run", [], {}, String(a.Data?.Text ?? "")),
              ]),
            ],
          ),
        );
        const last = descendants(content, "w:p").at(-1);
        if (last)
          last.attrs["w14:paraId"] = (index + 1)
            .toString(16)
            .padStart(8, "0")
            .toUpperCase();
        return `<w:comment w:id="${index}" w:author="${esc(a.Data?.Author ?? "")}"${a.Data?.CreatedAt ? ` w:date="${esc(a.Data.CreatedAt)}"` : ""}>${officeMarkup(content)}</w:comment>`;
      })
      .join("");
    activeRels = rels;
    zip.file(
      "word/comments.xml",
      `<w:comments ${storyNamespaces} xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">${commentBody}</w:comments>`,
    );
    if (commentRels.length)
      zip.file(
        "word/_rels/comments.xml.rels",
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${commentRels.join("")}</Relationships>`,
      );
    relationship(
      "http://schemas.microsoft.com/office/2011/relationships/commentsExtended",
      "commentsExtended.xml",
    );
    extraTypes.push(
      '<Override PartName="/word/commentsExtended.xml" ContentType="application/vnd.ms-word.commentsExtended+xml"/>',
    );
    zip.file(
      "word/commentsExtended.xml",
      `<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">${commentReviews
        .map((a, index) => {
          const parent = commentReviews.findIndex(
            (c) => c.Id === a.Data?.ParentId,
          );
          return `<w15:commentEx w15:paraId="${(index + 1).toString(16).padStart(8, "0").toUpperCase()}" w15:done="${a.Data?.Resolved ? 1 : 0}"${parent >= 0 ? ` w15:paraIdParent="${(parent + 1).toString(16).padStart(8, "0").toUpperCase()}"` : ""}/>`;
        })
        .join("")}</w15:commentsEx>`,
    );
  }
  if (
    root.props.EvenPageHeader ||
    root.props.EvenPageFooter ||
    root.props.TrackChanges
  ) {
    relationship("settings", "settings.xml");
    zip.file(
      "word/settings.xml",
      `<w:settings xmlns:w="${NS}">${root.props.EvenPageHeader || root.props.EvenPageFooter ? "<w:evenAndOddHeaders/>" : ""}${root.props.TrackChanges ? "<w:trackRevisions/>" : ""}</w:settings>`,
    );
    extraTypes.push(
      '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>',
    );
  }
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
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${[...mediaTypes].map((ext) => `<Default Extension="${ext}" ContentType="image/${ext === "jpg" ? "jpeg" : ext}"/>`).join("")}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>${numberings.length ? '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' : ""}${extraTypes.join("")}</Types>`,
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
  let relationships = new Map(
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
  let images = new Map<string, string>();
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
  let sourceNamespaces: Record<string, string> = {},
    currentPartPath = mainPath,
    hasOpaque = false;
  const neededParts = new Set<string>();
  const captureOpaque = (n: MarkupNode): DocumentNode | undefined => {
    const copy = JSON.parse(JSON.stringify(n)) as MarkupNode;
    Object.assign(copy.attrs, sourceNamespaces);
    const opaque = safeOpaqueXML(officeMarkup(copy));
    if (!opaque) return undefined;
    const ids = new Set<string>();
    const gather = (n: MarkupNode) => {
      for (const [key, value] of Object.entries(n.attrs))
        if (/^r:(?:id|embed|link|dm|lo|qs|cs)$/.test(key)) ids.add(value);
      for (const c of n.children) gather(c);
    };
    gather(n);
    const refs = [...ids].flatMap((id) => {
      const rel = relationships.get(id);
      if (!rel || !retainedRelationship(rel.Type ?? "")) return [];
      if (rel.TargetMode === "External")
        return rel.Type?.endsWith("/hyperlink") && safeURL(rel.Target)
          ? [
              {
                Id: id,
                Type: rel.Type,
                Target: rel.Target,
                TargetMode: "External",
              },
            ]
          : [];
      return [
        {
          Id: id,
          Type: rel.Type,
          Target: originalPartName(
            resolveRelativePart(currentPartPath, rel.Target ?? ""),
          ),
        },
      ];
    });
    for (const ref of refs)
      if (!("TargetMode" in ref)) neededParts.add(ref.Target!);
    hasOpaque = true;
    return node("Span", [], {
      DocxOpaqueXML: officeMarkup(opaque),
      DocxOpaqueRelationships: refs,
    });
  };
  let importOffset = 0,
    importParagraphs = 0,
    recordReview = true;
  const annotations: any[] = [],
    annotationStarts = new Map<string, any>();
  const commentsRoot = parseOfficeXML(
      await read(findPart("comments", "comments.xml")),
    ),
    comments = new Map(
      descendants(commentsRoot, "w:comment").map((c) => [c.attrs["w:id"]!, c]),
    );
  const readText = (
    text: string,
    props: Record<string, any> = inheritedEmpty,
  ): DocumentNode => {
    importOffset += text.length;
    return node("Run", [], props, text);
  };
  const inheritedEmpty: Record<string, any> = {};
  const sectionProps = (section?: MarkupNode): Record<string, any> => {
    const p: Record<string, any> = {};
    if (!section) return p;
    const size = child(section, "w:pgSz"),
      margin = child(section, "w:pgMar"),
      cols = child(section, "w:cols");
    if (size) {
      p.PageWidth = Number(size.attrs["w:w"]) / 15;
      p.PageHeight = Number(size.attrs["w:h"]) / 15;
      if (size.attrs["w:orient"]) p.PageOrientation = size.attrs["w:orient"];
    }
    if (margin) {
      p.PagePadding = {
        Left: Number(margin.attrs["w:left"] ?? 0) / 15,
        Top: Number(margin.attrs["w:top"] ?? 0) / 15,
        Right: Number(margin.attrs["w:right"] ?? 0) / 15,
        Bottom: Number(margin.attrs["w:bottom"] ?? 0) / 15,
      };
      p.HeaderDistance = Number(margin.attrs["w:header"] ?? 720) / 15;
      p.FooterDistance = Number(margin.attrs["w:footer"] ?? 720) / 15;
      p.Gutter = Number(margin.attrs["w:gutter"] ?? 0) / 15;
    }
    if (cols) {
      p.ColumnCount = Number(cols.attrs["w:num"]) || 1;
      p.ColumnGap = Number(cols.attrs["w:space"] ?? 360) / 15;
      const widths = cols.children
        .filter((c) => c.name === "w:col")
        .map((c) => Number(c.attrs["w:w"]) / 15);
      if (widths.length) p.ColumnWidths = widths;
    }
    const type = val(child(section, "w:type"));
    if (type) p.SectionBreak = type;
    const start = child(section, "w:pgNumType")?.attrs["w:start"];
    if (start) p.PageNumberStart = Number(start);
    const refs = section.children
      .filter(
        (c) => c.name === "w:headerReference" || c.name === "w:footerReference",
      )
      .map((c) => ({
        Kind: c.name === "w:headerReference" ? "Header" : "Footer",
        Type: c.attrs["w:type"] ?? "default",
        Id: c.attrs["r:id"],
      }));
    if (refs.length) p.DocxStoryReferences = refs;
    return p;
  };
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
      if (n.name === "w:t" || n.name === "w:delText")
        return [readText(textContent(n), inherited)];
      if (n.name === "w:tab") return [readText("\t", inherited)];
      if (n.name === "w:br" || n.name === "w:cr") {
        importOffset++;
        return [node("LineBreak")];
      }
      if (n.name === "w:noBreakHyphen") return [readText("‑", inherited)];
      if (n.name === "w:softHyphen") return [readText("\u00ad", inherited)];
      if (n.name === "w:fldSimple") {
        const instruction = n.attrs["w:instr"] ?? "",
          result = inlines(normalizeFields(n.children), inherited);
        return [
          node("Span", result, {
            Field: {
              Instruction: instruction,
              Type: instruction.trim().split(/\s+/)[0]?.toUpperCase() ?? "",
              Dirty: n.attrs["w:dirty"] === "true",
            },
          }),
        ];
      }
      if (n.name === "w:footnoteReference" || n.name === "w:endnoteReference") {
        const nid = n.attrs["w:id"] ?? "1";
        return [
          readText(nid, {
            ...inherited,
            BaselineAlignment: "Superscript",
            NoteReference: {
              Kind: n.name === "w:footnoteReference" ? "Footnote" : "Endnote",
              Id: nid,
            },
          }),
        ];
      }
      if (n.name === "w:ins") {
        const start = importOffset,
          children = inlines(n.children, inherited);
        if (recordReview)
          annotations.push({
            Id: "docx-insertion-" + ++id,
            Kind: "Insertion",
            Start: start,
            End: importOffset,
            Data: {
              Author: n.attrs["w:author"] ?? "",
              CreatedAt: n.attrs["w:date"] ?? "",
              DocxId: n.attrs["w:id"],
            },
          });
        return children;
      }
      if (n.name === "w:del") {
        const start = importOffset,
          oldRecord = recordReview;
        recordReview = false;
        const children = inlines(n.children, inherited);
        const fragment = node("Paragraph", children);
        const text = FlowDocument.FromJSON(
          node("FlowDocument", [fragment]),
        ).Text;
        importOffset = start;
        recordReview = oldRecord;
        if (recordReview)
          annotations.push({
            Id: "docx-deletion-" + ++id,
            Kind: "Deletion",
            Start: start,
            End: start,
            Data: {
              Author: n.attrs["w:author"] ?? "",
              CreatedAt: n.attrs["w:date"] ?? "",
              Text: text,
              Nodes: [fragment],
              DocxId: n.attrs["w:id"],
            },
          });
        return [];
      }
      if (n.name === "w:commentReference") {
        const cid = n.attrs["w:id"],
          exists = annotations.some(
            (a) => a.Kind === "Comment" && a.Data.DocxId === cid,
          );
        if (
          recordReview &&
          !exists &&
          !annotationStarts.has("w:commentRangeStart:" + cid)
        ) {
          const comment = comments.get(cid ?? "");
          annotations.push({
            Id: "docx-annotation-" + ++id,
            Kind: "Comment",
            Start: importOffset,
            End: importOffset,
            Data: {
              DocxId: cid,
              Text: comment
                ? descendants(comment, "w:p")
                    .map((p) => descendants(p, "w:t").map(textContent).join(""))
                    .join("\n")
                : "",
              Author: comment?.attrs["w:author"] ?? "",
              CreatedAt: comment?.attrs["w:date"] ?? "",
              Resolved: false,
            },
          });
        }
        return [];
      }
      if (n.name === "w:bookmarkStart" || n.name === "w:commentRangeStart") {
        if (recordReview)
          annotationStarts.set(n.name + ":" + n.attrs["w:id"], {
            Start: importOffset,
            Name: n.attrs["w:name"],
          });
        return [];
      }
      if (n.name === "w:bookmarkEnd" || n.name === "w:commentRangeEnd") {
        const bookmark = n.name === "w:bookmarkEnd",
          prefix = bookmark ? "w:bookmarkStart:" : "w:commentRangeStart:",
          start = annotationStarts.get(prefix + n.attrs["w:id"]);
        if (recordReview && start) {
          const comment = comments.get(n.attrs["w:id"] ?? ""),
            data = bookmark
              ? { Name: start.Name ?? "Bookmark" }
              : {
                  Text: comment
                    ? descendants(comment, "w:p")
                        .map((p) =>
                          descendants(p, "w:t").map(textContent).join(""),
                        )
                        .join("\n")
                    : "",
                  Author: comment?.attrs["w:author"] ?? "",
                  CreatedAt: comment?.attrs["w:date"] ?? "",
                  Resolved: false,
                  DocxId: n.attrs["w:id"],
                };
          annotations.push({
            Id: "docx-annotation-" + ++id,
            Kind: bookmark ? "Bookmark" : "Comment",
            Start: start.Start,
            End: importOffset,
            Data: data,
          });
          annotationStarts.delete(prefix + n.attrs["w:id"]);
        }
        return [];
      }
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
      if (n.name === "m:oMath" || n.name === "m:oMathPara") {
        const opaque = captureOpaque(n);
        return opaque ? [opaque] : [];
      }
      if (n.name === "w:drawing") {
        const blip = descendants(n, "a:blip")[0],
          src = images.get(blip?.attrs["r:embed"] ?? ""),
          extent = descendants(n, "wp:extent")[0],
          description = descendants(n, "wp:docPr")[0]?.attrs.descr ?? "";
        if (!src) {
          const opaque = captureOpaque(n);
          if (opaque) return [opaque];
        }
        if (src) importOffset++;
        else if (description) importOffset += description.length;
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
    const result: DocumentNode[] = [],
      sections: DocumentNode[] = [];
    const listStack: { num: string; level: number; list: DocumentNode }[] = [];
    for (const n of groupTableOfContents(children)) {
      if (n.name === "rtw:toc") {
        const max = n.attrs.Instruction?.match(/\\o\s+"?\d+-(\d+)/)?.[1];
        result.push(
          node("Section", convertBlocks(n.children), {
            TableOfContents: {
              Instruction: n.attrs.Instruction,
              MaxLevel: Number(max) || 3,
              IncludePageNumbers: true,
            },
          }),
        );
        listStack.length = 0;
      } else if (n.name === "w:p") {
        const section = child(child(n, "w:pPr"), "w:sectPr");
        const isSectionOnly =
          !!section &&
          n.children.every((c) => c.name === "w:pPr" || c.name === "#text");
        if (isSectionOnly) {
          if (result.length)
            sections.push(
              node("Section", result.splice(0), sectionProps(section)),
            );
          continue;
        }
        if (importParagraphs++ > 0) importOffset++;
        const pr = child(n, "w:pPr"),
          props = paragraphProps(pr),
          para = node(
            "Paragraph",
            inlines(normalizeFields(n.children), props),
            props,
          ),
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
        if (section) {
          sections.push(
            node("Section", result.splice(0), sectionProps(section)),
          );
          listStack.length = 0;
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
    return [...sections, ...result];
  };
  const parsed = parseOfficeXML(main),
    body = descendants(parsed, "w:body")[0];
  if (!body) throw new Error("DOCX body is missing.");
  sourceNamespaces = Object.fromEntries(
    Object.entries(
      parsed.children.find((n) => n.name === "w:document")?.attrs ?? {},
    ).filter(([key]) => key === "xmlns" || key.startsWith("xmlns:")),
  );
  const defaults = runProps(
    child(descendants(styleRoot, "w:rPrDefault")[0], "w:rPr"),
  );
  const sectPr = child(body, "w:sectPr");
  Object.assign(defaults, sectionProps(sectPr));
  const documentBlocks = convertBlocks(body.children);
  if (annotations.length) defaults.Annotations = annotations;
  const bodyRelationships = relationships,
    bodyImages = images;
  recordReview = false;
  const loadStory = async (path: string): Promise<MarkupNode> => {
    const xml = parseOfficeXML(await read(path)),
      storyDir = path.slice(0, path.lastIndexOf("/") + 1),
      storyFile = path.slice(path.lastIndexOf("/") + 1);
    const relNodes = descendants(
      parseOfficeXML(await read(storyDir + "_rels/" + storyFile + ".rels")),
      "Relationship",
    );
    relationships = new Map(relNodes.map((r) => [r.attrs.Id!, r.attrs]));
    images = new Map();
    for (const [rid, rel] of relationships) {
      if (!rel.Type?.endsWith("/image") || rel.TargetMode === "External")
        continue;
      const imagePath = resolveRelativePart(path, rel.Target ?? ""),
        ext = imagePath.split(".").pop()!.toLowerCase();
      if (!["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) continue;
      const bytes = await readBytes(imagePath);
      if (bytes)
        images.set(
          rid,
          `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${bytesBase64(bytes)}`,
        );
    }
    currentPartPath = path;
    sourceNamespaces = Object.fromEntries(
      Object.entries(
        xml.children.find((n) => n.name !== "#text")?.attrs ?? {},
      ).filter(([key]) => key === "xmlns" || key.startsWith("xmlns:")),
    );
    importOffset = 0;
    importParagraphs = 0;
    return xml;
  };
  const storyProps = [defaults];
  const gatherSections = (nodes: DocumentNode[]) => {
    for (const n of nodes) {
      if (n.type === "Section") storyProps.push(n.props);
      gatherSections(n.children ?? []);
    }
  };
  gatherSections(documentBlocks);
  for (const props of storyProps) {
    for (const ref of props.DocxStoryReferences ?? []) {
      const rel = bodyRelationships.get(ref.Id);
      if (!rel || rel.TargetMode === "External") continue;
      const story = await loadStory(resolve(rel.Target!)),
        content = descendants(
          story,
          ref.Kind === "Header" ? "w:hdr" : "w:ftr",
        )[0];
      if (!content) continue;
      const key =
        ref.Type === "first"
          ? "FirstPage" + ref.Kind
          : ref.Type === "even"
            ? "EvenPage" + ref.Kind
            : ref.Kind + "s";
      props[key] = convertBlocks(content.children);
    }
    delete props.DocxStoryReferences;
  }
  for (const kind of ["Footnote", "Endnote"]) {
    const rel = relationshipNodes.find((r) =>
      r.attrs.Type?.endsWith("/" + kind.toLowerCase() + "s"),
    );
    if (!rel || rel.attrs.TargetMode === "External") continue;
    const story = await loadStory(resolve(rel.attrs.Target!));
    defaults[kind + "s"] = descendants(story, "w:" + kind.toLowerCase())
      .filter((n) => !n.attrs["w:type"] && Number(n.attrs["w:id"]) > 0)
      .map((n) => ({ Id: n.attrs["w:id"], Blocks: convertBlocks(n.children) }));
  }
  const commentRel = relationshipNodes.find((r) =>
    r.attrs.Type?.endsWith("/comments"),
  );
  if (commentRel && commentRel.attrs.TargetMode !== "External") {
    const story = await loadStory(resolve(commentRel.attrs.Target!)),
      nativeComments = new Map(
        descendants(story, "w:comment").map((c) => [c.attrs["w:id"], c]),
      );
    const extended = parseOfficeXML(
        await read(findPart("commentsExtended", "commentsExtended.xml")),
      ),
      extra = new Map(
        descendants(extended, "w15:commentEx").map((c) => [
          c.attrs["w15:paraId"],
          c,
        ]),
      );
    const paraAnnotation = new Map<string, any>();
    for (const annotation of annotations.filter((a) => a.Kind === "Comment")) {
      const comment = nativeComments.get(annotation.Data.DocxId);
      if (!comment) continue;
      const blocks = convertBlocks(comment.children);
      annotation.Data.Blocks = blocks;
      const paraId = descendants(comment, "w:p").at(-1)?.attrs["w14:paraId"];
      if (paraId) {
        paraAnnotation.set(paraId, annotation);
        const ex = extra.get(paraId);
        annotation.Data.Resolved = ["1", "true", "on"].includes(
          ex?.attrs["w15:done"] ?? "",
        );
      }
    }
    for (let pass = 0; pass < nativeComments.size; pass++) {
      let added = false;
      for (const [cid, comment] of nativeComments) {
        const paraId = descendants(comment, "w:p").at(-1)?.attrs["w14:paraId"];
        if (!paraId || paraAnnotation.has(paraId)) continue;
        const ex = extra.get(paraId),
          parent = paraAnnotation.get(ex?.attrs["w15:paraIdParent"] ?? "");
        if (!parent) continue;
        const blocks = convertBlocks(comment.children);
        const annotation = {
          Id: "docx-annotation-" + ++id,
          Kind: "Comment",
          Start: parent.Start,
          End: parent.End,
          Data: {
            DocxId: cid,
            Text: FlowDocument.FromJSON(node("FlowDocument", blocks)).Text,
            Blocks: blocks,
            Author: comment.attrs["w:author"] ?? "",
            CreatedAt: comment.attrs["w:date"] ?? "",
            Resolved: ["1", "true", "on"].includes(ex?.attrs["w15:done"] ?? ""),
            ParentId: parent.Id,
          },
        };
        annotations.push(annotation);
        paraAnnotation.set(paraId, annotation);
        added = true;
      }
      if (!added) break;
    }
    for (const [paraId, annotation] of paraAnnotation) {
      const parent = paraAnnotation.get(
        extra.get(paraId)?.attrs["w15:paraIdParent"] ?? "",
      );
      if (parent) annotation.Data.ParentId = parent.Id;
    }
  }
  relationships = bodyRelationships;
  images = bodyImages;
  const settings = parseOfficeXML(
    await read(findPart("settings", "settings.xml")),
  );
  if (descendants(settings, "w:trackRevisions").length)
    defaults.TrackChanges = true;
  if (hasOpaque) {
    const types = parseOfficeXML(await read("[Content_Types].xml")),
      overrides = new Map(
        descendants(types, "Override").map((n) => [
          n.attrs.PartName?.replace(/^\//, ""),
          n.attrs.ContentType,
        ]),
      ),
      extensions = new Map(
        descendants(types, "Default").map((n) => [
          n.attrs.Extension,
          n.attrs.ContentType,
        ]),
      );
    const parts: any[] = [],
      files = new Map(
        Object.keys(zip.files).map((name) => [originalPartName(name), name]),
      );
    const queue = [...neededParts],
      visited = new Set<string>();
    for (let index = 0; index < queue.length; index++) {
      const original = queue[index]!;
      if (visited.has(original) || !retainedPartName(original)) continue;
      visited.add(original);
      const name = files.get(original);
      if (!name) continue;
      if (!original.endsWith(".rels")) {
        const slash = original.lastIndexOf("/"),
          relName =
            original.slice(0, slash + 1) +
            "_rels/" +
            original.slice(slash + 1) +
            ".rels";
        if (files.has(relName)) queue.push(relName);
      }
      const bytes = await readBytes(name);
      if (!bytes) continue;
      const contentType =
        overrides.get(name) ?? extensions.get(name.split(".").pop()!);
      if (
        contentType &&
        /macro|oleobject|activex|executable/i.test(contentType)
      )
        continue;
      if (name.endsWith(".xml")) {
        try {
          parseOfficeXML(new TextDecoder().decode(bytes));
        } catch {
          continue;
        }
      }
      if (original.endsWith(".rels")) {
        const base = original.replace("/_rels/", "/").replace(/\.rels$/, "");
        const relRoot = parseOfficeXML(new TextDecoder().decode(bytes));
        for (const rel of descendants(relRoot, "Relationship"))
          if (
            rel.attrs.TargetMode !== "External" &&
            retainedRelationship(rel.attrs.Type ?? "")
          )
            queue.push(
              originalPartName(
                resolveRelativePart(base, rel.attrs.Target ?? ""),
              ),
            );
      }
      parts.push({
        Name: originalPartName(name),
        Data: bytesBase64(bytes),
        ContentType:
          contentType ??
          (name.endsWith(".xml")
            ? "application/xml"
            : name.endsWith(".rels")
              ? "application/vnd.openxmlformats-package.relationships+xml"
              : "application/octet-stream"),
      });
    }
    if (parts.length) defaults.DocxPreservedParts = parts;
  }
  // A Word revision may span several runs with the same native ID. Join adjacent imported fragments.
  if (defaults.Annotations) {
    const merged: any[] = [];
    for (const annotation of defaults.Annotations) {
      const previous = merged.find(
        (a) =>
          a.Kind === "Insertion" &&
          annotation.Kind === "Insertion" &&
          a.Data.DocxId === annotation.Data.DocxId &&
          a.End === annotation.Start &&
          a.Data.Author === annotation.Data.Author,
      );
      if (previous) previous.End = annotation.End;
      else merged.push(annotation);
    }
    defaults.Annotations = merged;
  }
  return FlowDocument.FromJSON(node("FlowDocument", documentBlocks, defaults));
}
