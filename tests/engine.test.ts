import test from "node:test";
import assert from "node:assert/strict";
import { FlowDocument, TextPointer, type DocumentNode } from "../src/model.js";
import { RichTextEngine, TextRange } from "../src/engine.js";

let id = 0;
const node = (
  type: string,
  children: DocumentNode[] = [],
  props: Record<string, any> = {},
): DocumentNode => ({ type, id: `test-${++id}`, props, children });
const run = (text: string, props: Record<string, any> = {}): DocumentNode => ({
  type: "Run",
  id: `test-${++id}`,
  props,
  text,
});
const paragraph = (text: string) => node("Paragraph", text ? [run(text)] : []);
const doc = (...blocks: DocumentNode[]) =>
  FlowDocument.FromJSON(node("FlowDocument", blocks));
const engine = (...texts: string[]) =>
  new RichTextEngine(doc(...texts.map(paragraph)));
const findNodes = (root: DocumentNode, type: string): DocumentNode[] => [
  ...(root.type === type ? [root] : []),
  ...(root.children ?? []).flatMap((child) => findNodes(child, type)),
];

test("inserts and replaces selected UTF-16 text, restores caret with undo and redo", () => {
  const e = engine("Hello world");
  e.Select(6, 11);
  e.InsertText("web");
  assert.equal(e.Document.Text, "Hello web");
  assert.equal(e.Selection.Start.Offset, 9);
  assert.equal(e.Undo(), true);
  assert.equal(e.Document.Text, "Hello world");
  assert.equal(e.Selection.Text, "world");
  assert.equal(e.Redo(), true);
  assert.equal(e.Document.Text, "Hello web");
  assert.equal(e.CanRedo, false);
});
test("mutations retain document identity and subscribers", () => {
  const e = engine("A"),
    original = e.Document;
  let count = 0;
  original.Changed.Subscribe(() => count++);
  e.InsertText("B");
  e.Undo();
  e.Redo();
  assert.equal(e.Document, original);
  assert.equal(count, 3);
});
test("nested formatting and hyperlink survive unrelated edit", () => {
  const link = node("Hyperlink", [run("link")], {
    NavigateUri: "https://example.com",
  });
  const section = node("Section", [
    node("Paragraph", [node("Bold", [run("Hello ")]), link]),
    paragraph("tail"),
  ]);
  const e = new RichTextEngine(doc(section));
  e.Select(1, 4);
  e.InsertText("i");
  assert.equal(e.Document.Text, "Hio link\ntail");
  const links = findNodes(e.Document.ToJSON(), "Hyperlink");
  assert.equal(links.length, 1);
  assert.equal(links[0].props.NavigateUri, "https://example.com");
  assert.equal(findNodes(e.Document.ToJSON(), "Section")[0].id, section.id);
});
test("paragraph split retains prefix and suffix formatting", () => {
  const e = new RichTextEngine(
    doc(node("Paragraph", [node("Bold", [run("abcd")])])),
  );
  e.Select(2);
  e.InsertParagraph();
  assert.equal(e.Document.Text, "ab\ncd");
  assert.equal(findNodes(e.Document.ToJSON(), "Paragraph").length, 2);
  e.Select(3, 5);
  assert.equal(e.GetProperty("FontWeight"), "Bold");
});
test("delete paragraph separator joins sibling paragraphs", () => {
  const e = engine("one", "two");
  e.Select(4);
  e.DeleteBackward();
  assert.equal(e.Document.Text, "onetwo");
  assert.equal(findNodes(e.Document.ToJSON(), "Paragraph").length, 1);
  e.Undo();
  assert.equal(e.Selection.Start.Offset, 4);
});
test("cross-paragraph replacement removes intermediate paragraphs", () => {
  const e = engine("one", "middle", "three");
  e.Select(1, 14);
  e.InsertText("!");
  assert.equal(e.Document.Text, "o!ee");
  assert.equal(findNodes(e.Document.ToJSON(), "Paragraph").length, 1);
});
test("editing across table cells preserves table geometry and cell IDs", () => {
  const cell1 = node("TableCell", [paragraph("alpha")]),
    cell2 = node("TableCell", [paragraph("beta")]);
  const table = node("Table", [
    node("TableRowGroup", [node("TableRow", [cell1, cell2])]),
  ]);
  const e = new RichTextEngine(doc(table, paragraph("outside")));
  e.Select(1, 9);
  e.InsertText("X");
  assert.equal(e.Document.Text, "aX\na\noutside");
  assert.deepEqual(
    findNodes(e.Document.ToJSON(), "TableCell").map((item) => item.id),
    [cell1.id, cell2.id],
  );
});
test("backspace deletes complete combining and ZWJ graphemes", () => {
  for (const grapheme of ["e\u0301", "👩‍👩‍👧‍👦", "🇵🇱", "👍🏽"]) {
    const e = engine(`a${grapheme}b`);
    e.Select(1 + grapheme.length);
    e.DeleteBackward();
    assert.equal(e.Document.Text, "ab");
    e.Undo();
    e.Select(1);
    e.DeleteForward();
    assert.equal(e.Document.Text, "ab");
  }
});
test("delete word is Unicode-aware", () => {
  const e = engine("Hello świat");
  e.Select(e.Document.Text.length);
  e.DeleteWordBackward();
  assert.equal(e.Document.Text, "Hello ");
  e.Select(0);
  e.DeleteWordForward();
  assert.equal(e.Document.Text, " ");
});
test("applying property splits only selected run and preserves text", () => {
  const e = engine("abcdef");
  e.Select(2, 4);
  e.ApplyProperty("FontWeight", "Bold");
  assert.equal(e.Document.Text, "abcdef");
  assert.equal(e.GetProperty("FontWeight"), "Bold");
  e.Select(0, 6);
  assert.equal(e.GetProperty("FontWeight"), undefined);
  const runs = findNodes(e.Document.ToJSON(), "Run");
  assert.deepEqual(
    runs.map((item) => item.text),
    ["ab", "cd", "ef"],
  );
  assert.equal(new Set(runs.map((item) => item.id)).size, 3);
});
test("caret formatting affects future typing and undo includes it", () => {
  const e = engine("a");
  e.Select(1);
  e.Execute("ToggleBold");
  e.InsertText("b");
  e.Select(1, 2);
  assert.equal(e.GetProperty("FontWeight"), "Bold");
  e.Undo();
  assert.equal(e.Document.Text, "a");
});
test("paragraph properties exclude following paragraph at selection end", () => {
  const e = engine("a", "b");
  e.Select(0, 2);
  e.SetParagraphProperty("TextAlignment", "Center");
  const paragraphs = findNodes(e.Document.ToJSON(), "Paragraph");
  assert.equal(paragraphs[0].props.TextAlignment, "Center");
  assert.notEqual(paragraphs[1].props.TextAlignment, "Center");
});
test("compound changes produce one history unit and document event", () => {
  const e = engine("");
  let count = 0;
  e.Changed.Subscribe(() => count++);
  e.BeginChange();
  e.InsertText("hello");
  e.InsertText(" ");
  e.BeginChange();
  e.InsertText("world");
  e.EndChange();
  e.EndChange();
  assert.equal(e.Document.Text, "hello world");
  assert.equal(count, 1);
  e.Undo();
  assert.equal(e.Document.Text, "");
  assert.equal(e.CanUndo, false);
  assert.throws(() => e.EndChange());
});
test("new edit invalidates redo and undo limit bounds snapshots", () => {
  const e = engine("");
  e.UndoLimit = 2;
  e.InsertText("a");
  e.InsertText("b");
  e.InsertText("c");
  e.Undo();
  e.Undo();
  assert.equal(e.Document.Text, "a");
  assert.equal(e.CanUndo, false);
  e.InsertText("x");
  assert.equal(e.CanRedo, false);
});
test("history-recorded document replacement is undoable", () => {
  const e = engine("before"),
    identity = e.Document;
  e.ReplaceDocument(doc(paragraph("after")));
  assert.equal(e.Document.Text, "after");
  assert.equal(e.Document, identity);
  e.Undo();
  assert.equal(e.Document.Text, "before");
});
test("SetDocument resets selection and history; cross-document selection fails", () => {
  const e = engine("old");
  e.InsertText("x");
  const replacement = doc(paragraph("new"));
  e.SetDocument(replacement);
  assert.equal(e.Document, replacement);
  assert.equal(e.CanUndo, false);
  assert.equal(e.Selection.Start.Offset, 0);
  assert.throws(() =>
    e.Selection.Select(
      new TextPointer(doc(paragraph("other")), 0),
      replacement.ContentEnd,
    ),
  );
  assert.throws(() => e.Select(-1));
  assert.throws(() => e.Select(4));
  assert.throws(() => e.Select(0.5));
});
test("standalone TextRange reads, formats and replaces without changing identity", () => {
  const document = doc(paragraph("abc")),
    range = new TextRange(
      new TextPointer(document, 1),
      new TextPointer(document, 3),
    );
  assert.equal(range.Text, "bc");
  range.ApplyPropertyValue("FontStyle", "Italic");
  assert.equal(range.GetPropertyValue("FontStyle"), "Italic");
  range.Text = "X";
  assert.equal(document.Text, "aX");
});
test("inline insertion retains document flow and inserts line break", () => {
  const e = engine("ab");
  e.Select(1);
  e.Execute("InsertLineBreak");
  assert.equal(e.Document.Text, "a\nb");
  assert.equal(findNodes(e.Document.ToJSON(), "Paragraph").length, 1);
  assert.equal(findNodes(e.Document.ToJSON(), "LineBreak").length, 1);
});
test("multiple paragraph clipboard fragment merges at insertion boundaries", () => {
  const e = engine("abcd");
  e.Select(2);
  e.InsertFragment([paragraph("ONE"), paragraph("TWO")]);
  assert.equal(e.Document.Text, "abONE\nTWOcd");
  assert.equal(e.Selection.Start.Offset, 9);
});
test("block fragment insertion preserves surrounding text and table", () => {
  const e = engine("abcd");
  e.Select(2);
  e.InsertTable(2, 2);
  assert.equal(findNodes(e.Document.ToJSON(), "TableCell").length, 4);
  assert.equal(e.Document.Text.startsWith("ab\n"), true);
  assert.equal(e.Document.Text.endsWith("\ncd"), true);
  assert.throws(() => e.InsertTable(-1, 2));
  assert.throws(() => e.InsertNode(node("TableCell")));
});
test("image atoms use one plain-text offset and delete as an atom", () => {
  const e = engine("ab");
  e.Select(1);
  e.InsertImage("https://example.com/image.png", "Test");
  assert.equal(e.Document.Text, "a\uFFFCb");
  e.DeleteBackward();
  assert.equal(e.Document.Text, "ab");
});
test("list toggling is reversible while keeping paragraph contents", () => {
  const e = engine("one", "two");
  e.Select(0, e.Document.Text.length);
  e.ToggleList("Disc");
  assert.equal(findNodes(e.Document.ToJSON(), "List").length, 1);
  assert.equal(e.Document.Text, "one\ntwo");
  e.ToggleList("Decimal");
  assert.equal(
    findNodes(e.Document.ToJSON(), "List")[0].props.MarkerStyle,
    "Decimal",
  );
  e.ToggleList("Decimal");
  assert.equal(findNodes(e.Document.ToJSON(), "List").length, 0);
  assert.equal(e.Document.Text, "one\ntwo");
});
test("find escapes regex syntax, handles case and whole Unicode words", () => {
  const e = engine("A.b a.b cat concatenate CAT żółw żółwik");
  assert.equal(e.Find("a.b").length, 2);
  assert.equal(e.Find("a.b", { MatchCase: true }).length, 1);
  assert.equal(e.Find("cat", { WholeWord: true }).length, 2);
  assert.equal(e.Find("żółw", { WholeWord: true }).length, 1);
  assert.deepEqual(e.Find(""), []);
  assert.equal(e.Find("a.b", { Start: 4 }).length, 1);
});
test("replace all is literal and one undo transaction", () => {
  const e = engine("foo foo foo");
  assert.equal(e.ReplaceAll("foo", "$&"), 3);
  assert.equal(e.Document.Text, "$& $& $&");
  e.Undo();
  assert.equal(e.Document.Text, "foo foo foo");
  assert.equal(e.CanUndo, false);
});
test("annotations track insertions/deletions, persist and undo with content", () => {
  const e = engine("abc def");
  e.Select(4, 7);
  const comment = e.AddComment("Review", "Ada");
  e.Select(0);
  e.InsertText("X");
  assert.equal(e.Annotations[0].Start, 5);
  assert.equal(e.Annotations[0].End, 8);
  e.Undo();
  assert.equal(e.Annotations[0].Start, 4);
  e.UpdateAnnotation(comment.Id, { Resolved: true });
  assert.equal(e.Annotations[0].Data.Resolved, true);
  assert.equal(e.RemoveAnnotation(comment.Id), true);
  assert.equal(e.Annotations.length, 0);
  assert.equal(e.RemoveAnnotation("missing"), false);
});
test("named bookmarks navigate to a validated range", () => {
  const e = engine("hello world");
  e.Select(6, 11);
  e.AddBookmark("target");
  e.Select(0);
  assert.equal(e.GoToBookmark("target"), true);
  assert.equal(e.Selection.Text, "world");
  assert.throws(() => e.AddBookmark("target"));
  assert.equal(e.GoToBookmark("absent"), false);
});
test("unsupported commands and disposed engine operations fail explicitly", () => {
  const e = engine("test");
  assert.throws(() => e.Execute("PretendWordParity"), /not supported/);
  e.Dispose();
  e.Dispose();
  assert.throws(() => e.InsertText("x"), /disposed/);
});
test("default and inherited properties match the document model", () => {
  const e = engine("plain");
  e.Select(0, 5);
  assert.equal(e.GetProperty("FontWeight"), "Normal");
  assert.equal(e.GetProperty("FontSize"), 16);
  e.Document.FontFamily = "serif";
  assert.equal(e.GetProperty("FontFamily"), "serif");
});
test("clear formatting removes selected nested semantic styles only", () => {
  const e = new RichTextEngine(
    doc(
      node("Paragraph", [
        node("Bold", [node("Span", [run("abcd")], { FontSize: 30 })]),
      ]),
    ),
  );
  e.Select(1, 3);
  e.ClearFormatting();
  assert.equal(e.Document.Text, "abcd");
  assert.equal(e.GetProperty("FontWeight"), "Normal");
  assert.equal(e.GetProperty("FontSize"), 16);
  e.Select(0, 1);
  assert.equal(e.GetProperty("FontWeight"), "Bold");
  assert.equal(e.GetProperty("FontSize"), 30);
  e.Select(4);
  e.ClearFormatting();
  e.InsertText("e");
  e.Select(4, 5);
  assert.equal(e.GetProperty("FontWeight"), "Normal");
  assert.equal(e.GetProperty("FontSize"), 16);
});
test("typing in a hyperlink preserves hyperlink ownership", () => {
  const e = new RichTextEngine(
    doc(
      node("Paragraph", [
        node("Hyperlink", [run("link")], {
          NavigateUri: "https://example.com",
        }),
      ]),
    ),
  );
  e.Select(2);
  e.InsertText("X");
  assert.equal(e.Document.Text, "liXnk");
  assert.equal(
    findNodes(e.Document.ToJSON(), "Hyperlink")
      .map((item) =>
        findNodes(item, "Run")
          .map((child) => child.text)
          .join(""),
      )
      .join(""),
    "liXnk",
  );
});
test("selected rich fragment preserves its structural ancestry and formatting", () => {
  const e = new RichTextEngine(
    doc(
      node("Section", [
        node("Paragraph", [node("Bold", [run("abcdef")])]),
        paragraph("next"),
      ]),
    ),
  );
  e.Select(2, 8);
  const fragment = e.GetSelectedFragment();
  assert.equal(fragment.Text, "cdef\nn");
  assert.equal(findNodes(fragment.ToJSON(), "Section").length, 1);
  assert.equal(findNodes(fragment.ToJSON(), "Bold").length, 1);
  const leading = engine("", "next");
  leading.Select(0, 3);
  assert.equal(leading.GetSelectedFragment().Text, "\nne");
});
test("remove hyperlink can target selected text without removing its neighbors", () => {
  const e = new RichTextEngine(
    doc(
      node("Paragraph", [
        node("Hyperlink", [run("abcdef")], {
          NavigateUri: "https://example.com",
        }),
      ]),
    ),
  );
  e.Select(2, 4);
  e.RemoveHyperlink();
  assert.equal(e.Document.Text, "abcdef");
  assert.deepEqual(
    findNodes(e.Document.ToJSON(), "Hyperlink").map((item) =>
      findNodes(item, "Run")
        .map((child) => child.text)
        .join(""),
    ),
    ["ab", "ef"],
  );
});
test("table rows and columns support actual structural insertion and deletion", () => {
  const e = engine("");
  e.InsertTable(2, 2);
  e.Select(0);
  e.InsertTableRow();
  assert.equal(findNodes(e.Document.ToJSON(), "TableRow").length, 3);
  e.InsertTableColumn();
  assert.equal(findNodes(e.Document.ToJSON(), "TableCell").length, 9);
  e.DeleteTableColumn();
  assert.equal(findNodes(e.Document.ToJSON(), "TableCell").length, 6);
  e.DeleteTableRow();
  assert.equal(findNodes(e.Document.ToJSON(), "TableRow").length, 2);
  e.DeleteTable();
  assert.equal(findNodes(e.Document.ToJSON(), "Table").length, 0);
  e.Undo();
  assert.equal(findNodes(e.Document.ToJSON(), "Table").length, 1);
});
test("deleting the only row or column removes the table cleanly", () => {
  for (const method of ["DeleteTableRow", "DeleteTableColumn"] as const) {
    const e = engine("");
    e.InsertTable(1, 1);
    e.Select(0);
    e[method]();
    assert.equal(findNodes(e.Document.ToJSON(), "Table").length, 0);
    assert.equal(e.Document.Text, "");
  }
});
test("table editing extends merged geometry and restores it on undo", () => {
  const e = new RichTextEngine(
    doc(
      node("Table", [
        node("TableRowGroup", [
          node("TableRow", [
            node("TableCell", [paragraph("merged")], { ColumnSpan: 2 }),
          ]),
        ]),
      ]),
    ),
  );
  const before = e.Document.ToJSON();
  e.InsertTableColumn();
  assert.equal(
    e.Document.ToJSON().children![0]!.children![0]!.children![0]!.children!
      .length,
    2,
  );
  assert.equal(e.CanUndo, true);
  e.Undo();
  assert.deepEqual(e.Document.ToJSON(), before);
});
test("annotations follow unchanged table cell identities during structure edits", () => {
  const e = new RichTextEngine(
    doc(
      node("Table", [
        node("TableRowGroup", [
          node("TableRow", [
            node("TableCell", [paragraph("one")]),
            node("TableCell", [paragraph("two")]),
          ]),
        ]),
      ]),
    ),
  );
  e.Select(4, 7);
  e.AddComment("second cell");
  e.Select(0);
  e.InsertTableColumn(true);
  assert.equal(e.Annotations[0].Start, 5);
  assert.equal(e.Annotations[0].End, 8);
  assert.equal(
    e.Document.Text.slice(e.Annotations[0].Start, e.Annotations[0].End),
    "two",
  );
});
test("indentation command is bounded and undoable", () => {
  const e = engine("text");
  e.Execute("Indent");
  assert.equal(
    findNodes(e.Document.ToJSON(), "Paragraph")[0].props.TextIndent,
    24,
  );
  e.Execute("Outdent");
  e.Execute("Outdent");
  assert.equal(
    findNodes(e.Document.ToJSON(), "Paragraph")[0].props.TextIndent,
    0,
  );
  assert.throws(() => e.Indent(Infinity));
});
test("deterministic edit fuzz preserves plain-text replacement semantics and unique IDs", () => {
  let seed = 123456789;
  const next = (limit: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % limit;
  };
  const e = engine("first", "second", "third");
  let expected = e.Document.Text;
  const inserts = ["abc", "\n", "", "x\ny", " ", "\n\n"];
  for (let step = 0; step < 200; step++) {
    const a = next(expected.length + 1),
      b = next(expected.length + 1),
      start = Math.min(a, b),
      end = Math.max(a, b),
      value = inserts[next(inserts.length)];
    e.Select(start, end);
    e.InsertText(value);
    expected = expected.slice(0, start) + value + expected.slice(end);
    assert.equal(e.Document.Text, expected, `edit ${step}`);
    const ids: string[] = [];
    const visit = (item: DocumentNode) => {
      ids.push(item.id);
      item.children?.forEach(visit);
    };
    visit(e.Document.ToJSON());
    assert.equal(new Set(ids).size, ids.length, `node IDs at edit ${step}`);
    if (step % 7 === 0 && expected.length) {
      e.Select(0, expected.length);
      e.ToggleFormat("FontWeight", "Bold", "Normal");
      assert.equal(e.Document.Text, expected);
    }
  }
});
