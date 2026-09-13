/** Small inert markup tokenizer. It never creates browser DOM or evaluates entities/code. */
export interface MarkupNode {
  name: string;
  attrs: Record<string, string>;
  children: MarkupNode[];
  text?: string;
}
const entities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  ndash: "–",
  mdash: "—",
  bull: "•",
  hellip: "…",
  copy: "©",
  reg: "®",
  trade: "™",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};
export function decodeEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi,
    (all, key: string) => {
      if (key[0] !== "#") return entities[key.toLowerCase()] ?? all;
      const n =
        key[1]?.toLowerCase() === "x"
          ? parseInt(key.slice(2), 16)
          : parseInt(key.slice(1), 10);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
        ? String.fromCodePoint(n)
        : "\ufffd";
    },
  );
}
export const escapeMarkup = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
export function parseMarkup(source: string, xml = false): MarkupNode {
  if (source.length > 32 * 1024 * 1024)
    throw new RangeError("Markup exceeds the 32 MiB import limit.");
  if (xml && /<!DOCTYPE|<!ENTITY/i.test(source))
    throw new Error("DTD and custom XML entities are not supported.");
  const root: MarkupNode = { name: "#root", attrs: {}, children: [] };
  const stack = [root];
  const voidTags = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
  ]);
  let i = 0,
    count = 0;
  const addText = (text: string) => {
    if (text)
      stack[stack.length - 1]!.children.push({
        name: "#text",
        attrs: {},
        children: [],
        text: decodeEntities(text),
      });
  };
  while (i < source.length) {
    if (++count > 500000)
      throw new RangeError("Markup exceeds the node limit.");
    if (source[i] !== "<") {
      const end = source.indexOf("<", i);
      addText(source.slice(i, end < 0 ? source.length : end));
      i = end < 0 ? source.length : end;
      continue;
    }
    if (source.startsWith("<!--", i)) {
      const end = source.indexOf("-->", i + 4);
      i = end < 0 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith("<![CDATA[", i)) {
      const end = source.indexOf("]]>", i + 9);
      addText(source.slice(i + 9, end < 0 ? source.length : end));
      i = end < 0 ? source.length : end + 3;
      continue;
    }
    let end = i + 1,
      quote = "";
    for (; end < source.length; end++) {
      const c = source[end]!;
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
    }
    if (end >= source.length) {
      addText(source.slice(i));
      break;
    }
    const raw = source.slice(i + 1, end);
    i = end + 1;
    if (/^[!?]/.test(raw)) continue;
    const closing = /^\s*\//.test(raw);
    const match = raw.match(/^\s*\/?\s*([A-Za-z_][\w:.-]*)/);
    if (!match) {
      addText("<" + raw + ">");
      continue;
    }
    const name = xml ? match[1]! : match[1]!.toLowerCase();
    if (closing) {
      const index = stack.map((n) => n.name).lastIndexOf(name);
      if (index > 0) stack.length = index;
      continue;
    }
    const attrs: Record<string, string> = Object.create(null);
    const attrSource = raw.slice(match[0].length).replace(/\/\s*$/, "");
    const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let attr: RegExpExecArray | null;
    while ((attr = re.exec(attrSource))) {
      const key = xml ? attr[1]! : attr[1]!.toLowerCase();
      if (key !== "__proto__" && key !== "constructor" && key !== "prototype")
        attrs[key] = decodeEntities(attr[2] ?? attr[3] ?? attr[4] ?? "");
    }
    const node: MarkupNode = { name, attrs, children: [] };
    stack[stack.length - 1]!.children.push(node);
    if (!/\/\s*$/.test(raw) && !(voidTags.has(name) && !xml)) {
      if (stack.length > 256)
        throw new RangeError("Markup nesting exceeds 256 levels.");
      stack.push(node);
    }
  }
  return root;
}
export function textContent(node: MarkupNode): string {
  return node.text ?? node.children.map(textContent).join("");
}
export function descendants(node: MarkupNode, name: string): MarkupNode[] {
  const result: MarkupNode[] = [];
  const visit = (n: MarkupNode) => {
    if (n.name === name) result.push(n);
    for (const c of n.children) visit(c);
  };
  visit(node);
  return result;
}
export function child(
  node: MarkupNode | undefined,
  name: string,
): MarkupNode | undefined {
  return node?.children.find((n) => n.name === name);
}
export function safeURL(value: unknown, image = false): string {
  const text = String(value ?? "").trim();
  if (!text || /[\u0000-\u0020\u007f]/.test(text)) return "";
  if (
    image &&
    /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(text)
  )
    return text;
  if (
    /^(?:https?:|blob:)/i.test(text) ||
    (!image && /^(?:mailto:|tel:)/i.test(text))
  )
    return text;
  if (/^[#/?]|^\.\.?\//.test(text)) return text;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text) && !/[<>"'`\\]/.test(text))
    return text;
  return "";
}
