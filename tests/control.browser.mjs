import assert from "node:assert/strict";

/** Browser behavior checks shared by local verification and the release CI. */
export async function runControlBrowserChecks(page) {
  await page.evaluate(() => {
    const editor = document.createElement("rich-text-box");
    editor.id = "control-test-editor";
    editor.style.cssText =
      "position:fixed;inset:20px;z-index:10000;height:450px";
    editor.ViewMode = "continuous";
    editor.Text = "Hello world";
    editor.setAttribute("aria-label", "Test document");
    document.body.append(editor);
    window.controlTestEditor = editor;
    window.controlTestEvents = [];
    editor.addEventListener("documentchange", (event) =>
      window.controlTestEvents.push(event.detail.document.Text),
    );
    editor.Focus();
    editor.Select(5);
  });
  const editor = page.locator("#control-test-editor");
  const surface = editor.locator("[role=textbox]");
  const state = () =>
    page.evaluate(() => ({
      text: window.controlTestEditor.Text,
      start: window.controlTestEditor.Selection.Start.Offset,
      end: window.controlTestEditor.Selection.End.Offset,
    }));
  try {
    assert.equal(await surface.getAttribute("aria-label"), "Test document");
    await page.keyboard.type("!");
    assert.deepEqual(await state(), { text: "Hello! world", start: 6, end: 6 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("New");
    assert.equal((await state()).text, "Hello!\nNew world");
    await page.keyboard.press("Backspace");
    assert.equal((await state()).text, "Hello!\nNe world");
    await page.keyboard.press("Control+z");
    assert.equal((await state()).text, "Hello!\nNew world");
    await page.keyboard.press("Control+Shift+z");
    assert.equal((await state()).text, "Hello!\nNe world");

    await page.evaluate(() => {
      const e = window.controlTestEditor;
      e.Text = "Alpha beta";
      e.Focus();
      e.Select(0, 5);
    });
    await page.keyboard.press("Control+b");
    const bold = await page.evaluate(() =>
      window.richTextStudio.RT.toHTML(window.controlTestEditor.Document),
    );
    assert.match(bold, /font-weight:\s*bold|<strong|<b>/i);
    await page.keyboard.type("Bold");
    assert.equal((await state()).text, "Bold beta");

    // Model selection persists when a toolbar button receives focus.
    await page.evaluate(() => {
      const e = window.controlTestEditor;
      e.Select(5, 9);
      const button = document.createElement("button");
      button.id = "control-test-toolbar";
      document.body.append(button);
      button.focus();
      e.Execute("ToggleItalic");
      e.Focus();
    });
    assert.equal((await state()).start, 5);
    assert.equal((await state()).end, 9);
    const italic = await page.evaluate(() =>
      window.richTextStudio.RT.toHTML(window.controlTestEditor.Document),
    );
    assert.match(italic, /font-style:\s*italic|<em|<i>/i);

    // Selection crossing paragraph boundaries uses the model's newline offsets.
    await page.evaluate(() => {
      const e = window.controlTestEditor;
      e.Text = "One\nTwo\nThree";
      e.Focus();
      e.Select(2, 6);
    });
    await page.keyboard.type("X");
    assert.equal((await state()).text, "OnXo\nThree");

    // Rich clipboard data is imported through the safe model serializer.
    await page.evaluate(() => {
      const e = window.controlTestEditor;
      e.Text = "Start ";
      e.Focus();
      e.Select(6);
      const data = new DataTransfer();
      data.setData(
        "text/html",
        '<p><strong>Safe</strong><script>window.unsafePaste=true</script><img src="x" onerror="window.unsafePaste=true"></p>',
      );
      e.shadowRoot.querySelector("[role=textbox]").dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    assert.match((await state()).text, /Safe/);
    assert.equal(await page.evaluate(() => Boolean(window.unsafePaste)), false);
    await page.evaluate(() => window.controlTestEditor.Undo());
    assert.equal((await state()).text, "Start ");

    // Native composition is committed once and is undoable.
    await page.evaluate(() => {
      const e = window.controlTestEditor;
      e.Text = "A";
      e.Focus();
      e.Select(1);
      const s = e.shadowRoot.querySelector("[role=textbox]");
      s.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true, data: "" }),
      );
      const text = s.querySelector("span").firstChild;
      text.textContent = "A日本";
      const selection = window.getSelection();
      const range = document.createRange();
      range.setStart(text, 3);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      s.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertCompositionText",
          data: "日本",
          isComposing: true,
        }),
      );
      if (e.Text !== "A")
        throw new Error("Composition changed the model before commit");
      s.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data: "日本" }),
      );
    });
    await page.waitForFunction(() => window.controlTestEditor.Text === "A日本");
    assert.deepEqual(await state(), { text: "A日本", start: 3, end: 3 });
    await page.evaluate(() => window.controlTestEditor.Undo());
    assert.equal((await state()).text, "A");

    // An empty paragraph's browser caret placeholder is not document content.
    await page.evaluate(() => {
      const e = window.controlTestEditor;
      e.Text = "";
      e.Focus();
      const s = e.shadowRoot.querySelector("[role=textbox]");
      s.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      const text = s.querySelector("span").firstChild;
      text.textContent = "文";
      const selection = window.getSelection();
      const range = document.createRange();
      range.setStart(text, 1);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      s.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data: "文" }),
      );
    });
    await page.waitForFunction(() => window.controlTestEditor.Text === "文");
    assert.deepEqual(await state(), { text: "文", start: 1, end: 1 });

    await page.evaluate(() => {
      const e = window.controlTestEditor;
      e.Text = "Keep  spaces \t\nA";
      e.Focus();
      e.Select(e.Text.length);
      const first = e.Document.Blocks.Get(0);
      first.SetValue("ApplicationMetadata", "retained");
      window.controlTestBlockId = first.Id;
      const s = e.shadowRoot.querySelector("[role=textbox]");
      s.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      const text = s.querySelectorAll("p")[1].querySelector("span").firstChild;
      text.textContent = "A界";
      const selection = window.getSelection();
      const range = document.createRange();
      range.setStart(text, 2);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      s.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data: "界" }),
      );
    });
    await page.waitForFunction(
      () => window.controlTestEditor.Text === "Keep  spaces \t\nA界",
    );
    assert.equal(
      await page.evaluate(
        () =>
          window.controlTestEditor.Document.Blocks.Get(0).Id ===
            window.controlTestBlockId &&
          window.controlTestEditor.Document.Blocks.Get(0).GetValue(
            "ApplicationMetadata",
          ) === "retained",
      ),
      true,
    );
    assert.equal((await state()).end, "Keep  spaces \t\nA界".length);

    await page.evaluate(() => {
      const e = window.controlTestEditor;
      e.Text = "A";
      e.Focus();
      e.Select(1);
      e.addEventListener(
        "compositionconflict",
        (event) => {
          window.controlTestConflict = event.detail.composedText;
        },
        { once: true },
      );
      const s = e.shadowRoot.querySelector("[role=textbox]");
      s.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      s.querySelector("span").firstChild.textContent = "A文";
      e.Engine.InsertText("external");
      s.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data: "文" }),
      );
    });
    await page.waitForFunction(() => window.controlTestConflict === "A文");
    assert.equal((await state()).text, "Aexternal");

    // Read-only input, Tab behavior, and theme/view updates.
    await page.evaluate(() => {
      const e = window.controlTestEditor;
      e.Text = "Locked";
      e.IsReadOnly = true;
      e.Focus();
      e.Select(6);
    });
    await page.keyboard.type("!");
    assert.equal((await state()).text, "Locked");
    assert.equal(await surface.getAttribute("aria-readonly"), "true");
    await page.evaluate(() => {
      const e = window.controlTestEditor;
      e.IsReadOnly = false;
      e.AcceptsTab = true;
      e.Text = "";
      e.Focus();
    });
    await page.keyboard.press("Tab");
    assert.equal((await state()).text, "\t");
    await page.evaluate(() => {
      const e = window.controlTestEditor;
      e.Zoom = 1.25;
      e.ViewMode = "page";
      e.setAttribute("theme", "dark");
    });
    assert.equal(await editor.getAttribute("zoom"), "1.25");

    // All viewer constructors must satisfy the custom-element construction rules.
    const viewers = await page.evaluate(() =>
      [
        "flow-document-reader",
        "flow-document-scroll-viewer",
        "flow-document-page-viewer",
      ].map((tag) => {
        const viewer = document.createElement(tag);
        document.body.append(viewer);
        const result = {
          tag,
          readOnly: viewer.IsReadOnly,
          shadow: !!viewer.shadowRoot,
          mode: viewer.ViewMode,
        };
        viewer.Dispose();
        viewer.remove();
        return result;
      }),
    );
    assert.equal(
      viewers.every((v) => v.readOnly && v.shadow),
      true,
    );
    assert.equal(viewers[1].mode, "continuous");
    assert.equal(
      await page.evaluate(() => window.controlTestEvents.length > 0),
      true,
    );
    return 14;
  } finally {
    await page.evaluate(() => {
      window.controlTestEditor?.Dispose();
      window.controlTestEditor?.remove();
      document.getElementById("control-test-toolbar")?.remove();
      delete window.controlTestEditor;
      delete window.controlTestEvents;
    });
  }
}
