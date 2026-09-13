import test from "node:test";
import assert from "node:assert/strict";
import {
  DependencyProperty,
  FlowDocument,
  Figure,
  Floater,
  FigureLength,
  Paragraph,
  Run,
  Bold,
  Hyperlink,
  List,
  ListItem,
  Table,
  TableRowGroup,
  TableRow,
  TableCell,
  TableColumn,
  Image,
  walkElements,
} from "../src/model.js";
import {
  toHTML,
  fromHTML,
  sanitizeHTML,
  toXAML,
  fromXAML,
  toMarkdown,
  toRTF,
  fromRTF,
} from "../src/formats.js";
import { RichTextWebBridge, BridgeProtocol } from "../src/bridge.js";
import { RichTextEngine } from "../src/engine.js";
import { parseMarkup, escapeMarkup } from "../src/formats-markup.js";

function documentWithFloats(): FlowDocument {
  const table = new Table(
    new TableRowGroup(
      new TableRow([
        new TableCell(new Paragraph(new Bold("Cell A"))),
        new TableCell(new Paragraph("Cell B")),
      ]),
    ),
  );
  table.Columns.Add(new TableColumn(140));
  table.Columns.Add(new TableColumn("*"));
  const figure = new Figure([
    new Paragraph([
      new Bold("Caption"),
      new Run(" edited here"),
      new Hyperlink(" link", "https://example.com"),
    ]),
    table,
    new List([
      new ListItem(new Paragraph("first")),
      new ListItem(new Paragraph("second")),
    ]),
  ]);
  figure.Width = new FigureLength(0.4, "Content");
  figure.Height = new FigureLength(120, "Pixel");
  figure.HorizontalAnchor = "ContentRight";
  figure.VerticalAnchor = "ParagraphTop";
  figure.WrapDirection = "Left";
  figure.HorizontalOffset = 12;
  figure.CanDelayPlacement = false;
  figure.SetValue("WrapStyle", "Tight");
  figure.SetValue("Shape", "Ellipse");
  figure.SetValue("Rotation", 12);
  const floater = new Floater(new Paragraph("Side note"));
  floater.Width = 180;
  floater.HorizontalAlignment = "Left";
  return new FlowDocument(
    new Paragraph([
      new Run("Before "),
      figure,
      new Run(" between "),
      floater,
      new Run(" after"),
    ]),
  );
}

test("floating HTML uses valid phrasing wrappers and imports rich child paragraphs tables lists and layout", () => {
  const doc = documentWithFloats(),
    html = toHTML(doc),
    tree = parseMarkup(html);
  const check = (
    node: ReturnType<typeof parseMarkup>,
    insideParagraph = false,
  ): void => {
    if (insideParagraph)
      assert.ok(
        !["p", "table", "tbody", "tr", "td", "ul", "li", "div"].includes(
          node.name,
        ),
        `invalid paragraph child ${node.name}`,
      );
    for (const child of node.children)
      check(child, insideParagraph || node.name === "p");
  };
  check(tree);
  assert.match(html, /data-rt-block="table"/);
  assert.match(html, /data-rt-floating="Figure"/);
  assert.match(html, /shape-outside:ellipse/);
  const imported = fromHTML(html),
    nodes = walkElements(imported);
  assert.equal(imported.Text, doc.Text);
  const figure = nodes.find((node) => node instanceof Figure) as Figure;
  const floater = nodes.find((node) => node instanceof Floater) as Floater;
  assert.equal(figure.Blocks.Count, 3);
  assert.ok(figure.Blocks.Get(1) instanceof Table);
  assert.ok(figure.Blocks.Get(2) instanceof List);
  assert.match(
    figure.StoryText,
    /Caption edited here link\nCell A\nCell B\nfirst\nsecond/,
  );
  assert.ok(walkElements(figure).some((node) => node instanceof Bold));
  assert.equal(
    (
      walkElements(figure).find(
        (node) => node instanceof Hyperlink,
      ) as Hyperlink
    ).NavigateUri,
    "https://example.com",
  );
  assert.deepEqual(figure.Width, { Value: 0.4, FigureUnitType: "Content" });
  assert.equal(figure.HorizontalAnchor, "ContentRight");
  assert.equal(figure.WrapDirection, "Left");
  assert.equal(figure.CanDelayPlacement, false);
  assert.equal(figure.GetValue("Rotation"), 12);
  assert.equal(floater.Width, 180);
  assert.equal(floater.HorizontalAlignment, "Left");
});

test("HTML edits inside exported floating markup update the imported story without stale hidden snapshots", () => {
  const html = toHTML(documentWithFloats())
    .replace("edited here", "changed in HTML")
    .replace("Cell B", "Changed cell");
  const figure = walkElements(fromHTML(html)).find(
    (node) => node instanceof Figure,
  ) as Figure;
  assert.match(figure.StoryText, /changed in HTML/);
  assert.match(figure.StoryText, /Changed cell/);
  assert.doesNotMatch(figure.StoryText, /edited here|Cell B/);
});

test("malformed floating metadata is stripped per property and cannot activate attributes or arbitrary node kinds", () => {
  const layout = escapeMarkup(
    JSON.stringify({
      Width: { Value: 0.5, FigureUnitType: "Page" },
      Height: { Value: 1 },
      HorizontalAnchor: "InvalidAnchor",
      VerticalAnchor: "PageLeft",
      WrapDirection: "Impossible",
      CanDelayPlacement: "true",
      Rotation: Infinity,
      WrapStyle: "expression(evil)",
      Shape: "Ellipse",
      onclick: "evil()",
      Source: "javascript:evil()",
    }),
  );
  const html = `<p>A<span data-rt-floating="Figure" data-rt-layout="${layout}" onclick="evil()" style="width:-2px;height:200%;background-image:url(javascript:evil())"><span data-rt-block="p">safe <script>evil</script><span data-rt-block="__proto__"> text</span></span></span>B</p>`;
  const doc = fromHTML(html),
    figure = walkElements(doc).find((node) => node instanceof Figure) as Figure;
  assert.equal(doc.Text, "A\uFFFCB");
  assert.match(figure.StoryText, /safe.*text/);
  assert.deepEqual(figure.Width, { Value: 0.5, FigureUnitType: "Page" });
  assert.equal(
    figure.ReadLocalValue("HorizontalAnchor"),
    DependencyProperty.UnsetValue,
  );
  assert.equal(figure.ReadLocalValue("Height"), DependencyProperty.UnsetValue);
  const safe = sanitizeHTML(html);
  assert.doesNotMatch(
    safe,
    /onclick|javascript:|expression\(|<script|InvalidAnchor|Impossible/,
  );
});

test("malformed JSON and percentage CSS on floating nodes preserve safe text without import exceptions", () => {
  for (const data of [
    "null",
    "[]",
    "{",
    '"string"',
    JSON.stringify({ unknown: "x" }),
    " ".repeat(5000),
  ]) {
    const doc = fromHTML(
      `<p><span data-rt-floating="Figure" data-rt-layout="${escapeMarkup(data)}" style="width:50%;height:-3px"><span data-rt-block="p">kept</span></span></p>`,
    );
    const figure = walkElements(doc).find(
      (node) => node instanceof Figure,
    ) as Figure;
    assert.equal(figure.StoryText, "kept");
    assert.deepEqual(figure.Width, { Value: 0.5, FigureUnitType: "Content" });
  }
  const floater = walkElements(
    fromHTML(
      '<p><span data-rt-floating="Floater" style="width:50%;height:100px"><span data-rt-block="p">note</span></span></p>',
    ),
  ).find((node) => node instanceof Floater) as Floater;
  assert.equal(floater.Width, undefined);
  assert.equal(floater.GetValue("Height"), undefined);
});

test("floating images retain safe geometry wrapping and text alternatives through HTML", () => {
  const image = new Image("https://example.com/image.png", "photo");
  image.Width = 160;
  image.Height = 90;
  image.SetValue("WrapStyle", "Square");
  image.SetValue("HorizontalAlignment", "Left");
  image.SetValue("WrapDistance", 8);
  const imported = walkElements(
    fromHTML(
      toHTML(new FlowDocument(new Paragraph([image, new Run(" text")]))),
    ),
  ).find((node) => node instanceof Image) as Image;
  assert.equal(imported.Source, image.Source);
  assert.equal(imported.Width, 160);
  assert.equal(imported.GetValue("WrapStyle"), "Square");
  assert.equal(imported.GetValue("HorizontalAlignment"), "Left");
  assert.equal(imported.GetValue("WrapDistance"), 8);
});

test("floating XAML round trips FigureLength units rich child trees and native property elements", () => {
  const doc = documentWithFloats(),
    xaml = toXAML(doc),
    imported = fromXAML(xaml);
  assert.match(xaml, /Width="0.4 Content"/);
  assert.match(xaml, /Height="120"/);
  assert.equal(imported.Text, doc.Text);
  const figure = walkElements(imported).find(
    (node) => node instanceof Figure,
  ) as Figure;
  assert.equal(
    figure.StoryText,
    (walkElements(doc).find((node) => node instanceof Figure) as Figure)
      .StoryText,
  );
  assert.equal(figure.WrapDirection, "Left");
  assert.deepEqual(figure.Width, { Value: 0.4, FigureUnitType: "Content" });
  const table = walkElements(figure).find(
    (node) => node instanceof Table,
  ) as Table;
  assert.equal(table.Columns.Count, 2);
  assert.equal(table.Columns.Get(0).Width, 140);
  assert.equal(table.Columns.Get(1).Width, "*");
  const native = fromXAML(
    '<FlowDocument><Paragraph><Figure Width="2 Column" Height="Auto"><Figure.Blocks><Paragraph><Bold>Native</Bold></Paragraph></Figure.Blocks></Figure><Floater Width="120"><Floater.Blocks><Paragraph>Side</Paragraph></Floater.Blocks></Floater></Paragraph></FlowDocument>',
  );
  assert.equal(native.Text, "\uFFFC\uFFFC");
  assert.equal(
    (walkElements(native).find((node) => node instanceof Figure) as Figure)
      .StoryText,
    "Native",
  );
  assert.throws(
    () =>
      fromXAML(
        '<FlowDocument><Paragraph><Figure Width="2 Page" /></Paragraph></FlowDocument>',
      ),
    /Invalid/,
  );
  assert.throws(
    () =>
      fromXAML(
        '<FlowDocument><Paragraph><Figure Width="{Binding Secret}" /></Paragraph></FlowDocument>',
      ),
    /markup extensions/,
  );
});

test("native bridge accepts floating documents and rejects malformed child types before replacing live content", () => {
  const engine = new RichTextEngine(new FlowDocument(new Paragraph("before"))),
    bridge = new RichTextWebBridge(engine, () => {});
  const request = (document: unknown) =>
    bridge.HandleMessage({
      ...BridgeProtocol,
      kind: "request",
      id: "floating",
      method: "setDocument",
      params: { document },
    });
  const doc = documentWithFloats();
  assert.equal(request(doc.ToJSON()).error, undefined);
  assert.equal(engine.Document.Text, doc.Text);
  assert.deepEqual(engine.Document.ToJSON(), doc.ToJSON());
  const bad = doc.ToJSON();
  bad.children![0]!.children![1]!.children = [
    { type: "Run", id: "bad-inline-child", props: {}, text: "bad" },
  ];
  assert.ok(request(bad).error);
  assert.deepEqual(engine.Document.ToJSON(), doc.ToJSON());
  bridge.Dispose();
});

test("bridge limits count table columns inside floating stories and detect duplicate column identities", () => {
  const engine = new RichTextEngine(),
    bridge = new RichTextWebBridge(engine, () => {}, { maxDocumentNodes: 8 });
  const doc = documentWithFloats();
  const request = (document: unknown) =>
    bridge.HandleMessage({
      ...BridgeProtocol,
      kind: "request",
      id: "limit",
      method: "setDocument",
      params: { document },
    });
  assert.equal(request(doc.ToJSON()).error?.code, "document_too_large");
  const small = new FlowDocument(new Table());
  (small.Blocks.Get(0) as Table).Columns.AddRange(
    Array.from({ length: 7 }, () => new TableColumn(10)),
  );
  assert.equal(request(small.ToJSON()).error?.code, "document_too_large");
  const duplicate = new FlowDocument(new Table()).ToJSON();
  duplicate.children![0]!.props.Columns = [
    { type: "TableColumn", id: duplicate.id, props: {} },
  ];
  assert.equal(request(duplicate).error?.code, "invalid_document");
  bridge.Dispose();
});

test("Markdown and RTF preserve floating story text as linear content with formatting fallback", () => {
  const doc = documentWithFloats(),
    markdown = toMarkdown(doc),
    rtf = toRTF(doc);
  assert.match(markdown, /\*\*Caption\*\*/);
  assert.match(markdown, /Cell A/);
  assert.match(markdown, /Side note/);
  assert.match(markdown, /\|.*Cell A.*\|/);
  assert.match(fromRTF(rtf).Text, /Caption edited here link/);
  assert.match(fromRTF(rtf).Text, /Side note/);
});
