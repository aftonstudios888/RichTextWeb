import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import {
  fromText,
  toText,
  fromHTML,
  toHTML,
  sanitizeHTML,
  fromMarkdown,
  toMarkdown,
  fromXAML,
  toXAML,
  fromRTF,
  toRTF,
  fromDOCX,
  toDOCX,
  DocumentSerializer,
} from "../src/formats.js";
import {
  FlowDocument,
  Paragraph,
  Run,
  Bold,
  List,
  ListItem,
  Table,
  TableRowGroup,
  TableRow,
  TableCell,
  Hyperlink,
  Image,
} from "../src/model.js";

test("plain text round trips Unicode, empty paragraphs and literal whitespace", () => {
  const original = "Zażółć gęślą jaźń 😀\n\n  end\t";
  const doc = fromText(original);
  assert.equal(toText(doc), original);
  assert.equal(fromText("a\r\nb\rc").Text, "a\nb\nc");
  assert.equal(
    DocumentSerializer.Deserialize(DocumentSerializer.Serialize(doc)).Text,
    original,
  );
});
test("HTML imports structured headings, formatting, ordered lists and table spans", () => {
  const doc = fromHTML(
    '<h2>Title</h2><p>Hello <strong>world</strong> <a href="https://example.com">link</a></p><ol start="3"><li>First</li><li>Second</li></ol><table><tr><th colspan="2">Cell</th></tr></table>',
  );
  assert.equal(doc.Blocks.Get(0).GetValue("HeadingLevel"), 2);
  assert.match(doc.Text, /Title\nHello world link\nFirst\nSecond\nCell/);
  const html = toHTML(doc);
  assert.match(html, /<h2>Title<\/h2>/);
  assert.match(html, /<ol start="3">/);
  assert.match(html, /colspan="2"/);
  assert.equal(fromHTML(html).Text, doc.Text);
});
test("HTML sanitization removes executable content and scriptable URLs in imports and exports", () => {
  const html = sanitizeHTML(
    '<script>alert(1)</script><p onclick="evil()" style="color:red;background-image:url(javascript:evil())">safe <a href="jav&#x61;script:evil()">link</a><img src="data:image/svg+xml,&lt;svg onload=evil()&gt;" onerror="evil()"></p><svg><script>bad</script></svg>',
  );
  assert.equal(fromHTML(html).Text, "safe link");
  assert.doesNotMatch(html, /script|onclick|onerror|javascript|<svg|url\(/i);
  assert.match(html, /color:red/);
  const link = new Hyperlink(new Run("unsafe"));
  link.NavigateUri = "javascript:alert(1)";
  assert.doesNotMatch(
    toHTML(new FlowDocument(new Paragraph(link))),
    /javascript/,
  );
});
test("Markdown parses GFM tables, links, headings and nested emphasis", () => {
  const doc = fromMarkdown(
    "# Heading\n\n**Bold** and *italic* [link](https://example.com)\n\n- first\n- second\n\n| A | B |\n|---|---|\n| C | D |",
  );
  assert.match(doc.Text, /Heading/);
  assert.match(toHTML(doc), /<strong[^>]*>Bold<\/strong>/);
  assert.match(toHTML(doc), /<table>/);
  const markdown = toMarkdown(doc);
  assert.match(markdown, /^# Heading/);
  assert.match(markdown, /\*\*Bold\*\*/);
  assert.match(markdown, /\| A \| B \|/);
});
test("Markdown raw HTML follows the HTML sanitization boundary", () => {
  const doc = fromMarkdown(
    "Hello\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))",
  );
  assert.doesNotMatch(toHTML(doc), /script|alert\(1\)/);
});
test("XAML round trips all structured flow basics and rejects active markup", () => {
  const doc = fromHTML(
    "<h1>Title</h1><p><b>bold</b> plain<br>second</p><ul><li>item</li></ul><table><tr><td>cell</td></tr></table>",
  );
  const xml = toXAML(doc);
  assert.equal(fromXAML(xml).Text, doc.Text);
  assert.match(xml, /FlowDocument/);
  assert.throws(
    () =>
      fromXAML(
        '<!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]><FlowDocument/>',
      ),
    /DTD/,
  );
  assert.throws(
    () =>
      fromXAML(
        '<FlowDocument><Paragraph FontFamily="{Binding Evil}"><Run>x</Run></Paragraph></FlowDocument>',
      ),
    /markup extensions/,
  );
  assert.equal(
    fromXAML(
      '<FlowDocument><ObjectDataProvider/><Paragraph><Run Text="safe"/></Paragraph></FlowDocument>',
    ).Text,
    "safe",
  );
});
test("RTF round trips text, Unicode surrogate pairs, literal braces and styling", () => {
  const doc = fromHTML("<p>Hello <b>bold 😀 ż</b> {\\}</p><p>Next<br>line</p>");
  const rtf = toRTF(doc);
  const imported = fromRTF(rtf);
  assert.equal(imported.Text, doc.Text);
  assert.match(toHTML(imported), /font-weight:bold/);
  assert.equal(
    fromRTF("{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}hi \\'e9\\par bye}").Text,
    "hi é\nbye",
  );
});
test("DOCX produces real ZIP relationships, lists, styled text, links, images and tables", async () => {
  const doc = fromHTML(
    '<h2>Document</h2><p>Hello <b>bold</b> <a href="https://example.com">world</a> 😀</p><ol start="4"><li>one</li><li>two</li></ol><table><tr><td>A</td><td>B</td></tr><tr><td colspan="2">wide</td></tr></table>',
  );
  const png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
  const image = new Image();
  image.Source = png;
  image.Width = 24;
  image.Height = 12;
  image.AlternativeText = "Red dot";
  doc.Blocks.Add(new Paragraph(image));
  const data = await toDOCX(doc);
  assert.equal(String.fromCharCode(...data.slice(0, 2)), "PK");
  const zip = await JSZip.loadAsync(data);
  assert.ok(zip.file("[Content_Types].xml"));
  assert.ok(zip.file("word/numbering.xml"));
  assert.ok(zip.file("word/media/image1.png"));
  assert.match(
    await zip.file("word/document.xml")!.async("string"),
    /w:gridSpan w:val="2"/,
  );
  const imported = await fromDOCX(data);
  assert.equal(imported.Text, doc.Text);
  assert.match(toHTML(imported), /https:\/\/example.com/);
  assert.match(toHTML(imported), /data:image\/png;base64/);
  assert.match(toHTML(imported), /<ol start="4">/);
});
test("DOCX import respects package relationship location and omits deleted/field instructions", async () => {
  const zip = new JSZip();
  zip.file(
    "_rels/.rels",
    '<Relationships><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="custom/main.xml"/></Relationships>',
  );
  zip.file(
    "custom/main.xml",
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Visible</w:t></w:r><w:del><w:r><w:delText>deleted</w:delText></w:r></w:del><w:r><w:instrText>EXECUTE</w:instrText></w:r><w:ins><w:r><w:t> added</w:t></w:r></w:ins></w:p></w:body></w:document>',
  );
  assert.equal(
    (await fromDOCX(await zip.generateAsync({ type: "uint8array" }))).Text,
    "Visible added",
  );
  await assert.rejects(fromDOCX(new Uint8Array([1, 2, 3])));
});
test("large inert imports enforce nesting limits", () => {
  assert.throws(
    () => fromHTML("<span>".repeat(300) + "x" + "</span>".repeat(300)),
    /nesting/,
  );
});

test("RTF preserves explicit font, color, highlight and nested format resets", () => {
  const doc = fromHTML(
    '<p><b>bold <span style="font-weight:normal;font-family:Georgia;color:#123456;background-color:#ff00aa">normal</span></b></p>',
  );
  const imported = fromRTF(toRTF(doc));
  const html = toHTML(imported);
  assert.match(html, /font-family:Georgia/);
  assert.match(html, /color:#123456/);
  assert.match(html, /background-color:#ff00aa/);
  assert.match(html, /font-weight:normal/);
});
test("HTML relative font sizing is converted to model pixels and invalid sizes are ignored", () => {
  assert.equal(
    fromHTML('<p><span style="font-size:2em">hello</span></p>')
      .Blocks.Get(0)
      .Children[0].GetValue("FontSize"),
    32,
  );
  assert.equal(fromHTML('<p style="font-size:0">hello</p>').Text, "hello");
});

test("DOCX translates horizontal and vertical table merges into model spans", async () => {
  const doc = fromHTML(
    '<table><tr><td rowspan="2" colspan="2">merged</td><td>top</td></tr><tr><td>bottom</td></tr></table>',
  );
  const data = await toDOCX(doc);
  const zip = await JSZip.loadAsync(data);
  const xml = await zip.file("word/document.xml")!.async("string");
  assert.match(xml, /w:vMerge w:val="restart"/);
  assert.match(xml, /<w:vMerge\/>/);
  const imported = await fromDOCX(data);
  assert.equal(imported.Text, doc.Text);
  const table = imported.Blocks.Get(0) as Table;
  const cell = table.RowGroups.Get(0).Rows.Get(0).Cells.Get(0);
  assert.equal(cell.RowSpan, 2);
  assert.equal(cell.ColumnSpan, 2);
  assert.equal(table.RowGroups.Get(0).Rows.Get(1).Cells.Count, 1);
});

test("HTML export/import preserves canonical literal whitespace and baseline formatting", () => {
  const doc = fromText("  two  spaces\tend  \nnext");
  assert.equal(fromHTML(toHTML(doc)).Text, doc.Text);
  const formatted = fromHTML(
    '<p style="direction:rtl">H<sub>2</sub>O and x<sup>2</sup></p>',
  );
  const html = toHTML(formatted);
  assert.match(html, /direction:rtl/);
  assert.match(html, /vertical-align:sub/);
  assert.match(html, /vertical-align:super/);
});

test("DOCX import resolves namespace prefixes rather than requiring literal w prefix", async () => {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    '<doc:document xmlns:doc="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><doc:body><doc:p><doc:r><doc:rPr><doc:b/></doc:rPr><doc:t>Renamed prefix</doc:t></doc:r></doc:p></doc:body></doc:document>',
  );
  const doc = await fromDOCX(await zip.generateAsync({ type: "uint8array" }));
  assert.equal(doc.Text, "Renamed prefix");
  assert.match(toHTML(doc), /font-weight:bold/);
});
test("XAML xml:space preserves intentional whitespace between inline children", () => {
  assert.equal(
    fromXAML(
      '<FlowDocument xml:space="preserve"><Paragraph><Run>a</Run> <Run>b</Run></Paragraph></FlowDocument>',
    ).Text,
    "a b",
  );
});

test("HTML inherited pre-wrap preserves editing whitespace across div and block containers", () => {
  assert.equal(
    fromHTML(
      '<div style="white-space:pre-wrap"><p>a  b</p><div>c  d</div></div>',
    ).Text,
    "a  b\nc  d",
  );
  assert.equal(
    fromHTML('<div style="white-space:pre-wrap">x  y</div>').Text,
    "x  y",
  );
});
