import test from "node:test";
import assert from "node:assert/strict";
import {
  RichTextBox,
  FlowDocumentReader,
  FlowDocumentScrollViewer,
  registerRichTextWeb,
} from "../src/control.js";
import { FlowDocument, Paragraph, Run } from "../src/model.js";
import {
  safeNavigationUri,
  safeImageSource,
  thicknessCSS,
} from "../src/control-renderer.js";

test("control module and registration are safe without browser globals", () => {
  assert.doesNotThrow(() => registerRichTextWeb(undefined));
  const editor = new RichTextBox();
  editor.Document = new FlowDocument(new Paragraph(new Run("Hello world")));
  editor.Select(6, 11);
  editor.Execute("InsertText", "browser");
  assert.equal(editor.Text, "Hello browser");
  assert.equal(editor.Selection.End.Offset, 13);
  editor.Undo();
  assert.equal(editor.Text, "Hello world");
  editor.Redo();
  assert.equal(editor.Text, "Hello browser");
  editor.Dispose();
});

test("readonly controls prevent user command mutation and retain programmatic document access", () => {
  const reader = new FlowDocumentReader();
  reader.Document = new FlowDocument(new Paragraph(new Run("Document")));
  assert.equal(reader.IsReadOnly, true);
  assert.equal(reader.Execute("InsertText", "ignored"), false);
  assert.equal(reader.Text, "Document");
  reader.SelectAll();
  assert.equal(reader.Selection.Text, "Document");
  const scroll = new FlowDocumentScrollViewer();
  assert.equal(scroll.ViewMode, "continuous");
  assert.equal(scroll.IsReadOnly, true);
  reader.Dispose();
  scroll.Dispose();
});

test("HTML paste uses one undoable model insertion and strips executable markup", () => {
  const editor = new RichTextBox();
  editor.Text = "Before";
  editor.Select(6);
  editor.PasteHTML("<p><strong>Safe</strong><script>alert(1)</script></p>");
  assert.match(editor.Text, /Safe/);
  assert.doesNotMatch(editor.Text, /alert/);
  editor.Undo();
  assert.equal(editor.Text, "Before");
  editor.Dispose();
});

test("DOM renderer rejects executable navigation and image URLs", () => {
  for (const value of [
    "javascript:alert(1)",
    " java\nscript:alert(1)",
    "data:text/html,<script>",
    "vbscript:msgbox(1)",
  ])
    assert.equal(safeNavigationUri(value), undefined);
  assert.equal(
    safeNavigationUri("https://example.com/docs"),
    "https://example.com/docs",
  );
  assert.equal(safeNavigationUri("#bookmark"), "#bookmark");
  assert.equal(
    safeImageSource("data:image/svg+xml,<svg/onload=alert(1)>"),
    undefined,
  );
  assert.equal(
    safeImageSource("https://example.com/picture.png"),
    "https://example.com/picture.png",
  );
  assert.equal(
    safeImageSource("data:image/png;base64,aGVsbG8="),
    "data:image/png;base64,aGVsbG8=",
  );
});

test("layout values accept .NET Thickness and finite CSS lengths", () => {
  assert.equal(
    thicknessCSS({ Left: 1, Top: 2, Right: 3, Bottom: 4 }),
    "2px 3px 4px 1px",
  );
  assert.equal(thicknessCSS(12), "12px");
  assert.equal(thicknessCSS("1em 2em"), "1em 2em");
  assert.equal(thicknessCSS("10px; background:url(x)"), undefined);
  assert.equal(thicknessCSS(Infinity), undefined);
});
