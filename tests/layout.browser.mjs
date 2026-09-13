import assert from "node:assert/strict";

export async function runLayoutBrowserChecks(page) {
  const results = [];
  await page.evaluate(() => {
    const R = window.richTextStudio.RT;
    const editor = document.createElement("rich-text-box");
    editor.id = "layout-test-editor";
    editor.style.cssText =
      "position:fixed;inset:20px;z-index:11000;height:520px;background:white";
    editor.ViewMode = "continuous";
    editor.EnableVirtualization = true;
    editor.VirtualizationThreshold = 30;
    const model = new R.FlowDocument();
    for (let index = 0; index < 3000; index++)
      model.Blocks.Add(
        new R.Paragraph(
          `Paragraph ${index}: this text remains in the model when its DOM is not realized.`,
        ),
      );
    editor.Document = model;
    window.layoutTestEditor = editor;
    window.layoutTestOriginal = editor.Text;
    window.document.body.append(editor);
  });
  try {
    await page.waitForFunction(
      () => window.layoutTestEditor.VirtualizationStatistics.Active,
    );
    const realized = await page.evaluate(() => ({
      stats: window.layoutTestEditor.VirtualizationStatistics,
      paragraphs: window.layoutTestEditor.shadowRoot.querySelectorAll(
        "[data-rt-paragraph]",
      ).length,
    }));
    assert.equal(realized.stats.TotalBlocks, 3000);
    assert(
      realized.paragraphs < 60,
      `Retained ${realized.paragraphs} paragraphs`,
    );
    results.push(
      "Virtualized document retains fewer than 60 of 3000 paragraph DOM nodes",
    );
    await page.evaluate(() => {
      const e = window.layoutTestEditor;
      const offset = e.Text.indexOf("Paragraph 2500:");
      e.ScrollToTextOffset(offset);
      e.Focus();
      e.BeginChange();
    });
    await page.keyboard.type("EDIT ");
    await page.evaluate(() => window.layoutTestEditor.EndChange());
    assert.equal(
      await page.evaluate(() =>
        window.layoutTestEditor.Text.includes("EDIT Paragraph 2500:"),
      ),
      true,
    );
    assert(
      await page.evaluate(
        () =>
          window.layoutTestEditor.shadowRoot.querySelectorAll(
            "[data-rt-paragraph]",
          ).length < 100,
      ),
    );
    await page.evaluate(() => window.layoutTestEditor.Undo());
    assert.equal(
      await page.evaluate(
        () => window.layoutTestEditor.Text === window.layoutTestOriginal,
      ),
      true,
    );
    results.push(
      "Offscreen text navigation realizes selection and edits/undo preserve all 3000 blocks",
    );
    await page.evaluate(() => {
      const e = window.layoutTestEditor;
      e.SelectAll();
    });
    assert.equal(
      await page.evaluate(
        () =>
          window.layoutTestEditor.shadowRoot.querySelectorAll(
            "[data-rt-paragraph]",
          ).length,
      ),
      3000,
    );
    assert.equal(
      await page.evaluate(
        () =>
          window.layoutTestEditor.Selection.Text === window.layoutTestOriginal,
      ),
      true,
    );
    await page.evaluate(() => {
      window.layoutTestEditor.Select(0);
      window.layoutTestEditor.Refresh();
    });
    assert(
      await page.evaluate(
        () =>
          window.layoutTestEditor.shadowRoot.querySelectorAll(
            "[data-rt-paragraph]",
          ).length < 100,
      ),
    );
    results.push(
      "Select all materializes the native selection and collapses back to a bounded DOM window",
    );
    await page.evaluate(() => {
      const e = window.layoutTestEditor;
      e.ScrollToTextOffset(0);
      e.Focus();
      const surface = e.shadowRoot.querySelector("[part=editor]");
      surface.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      if (e.VirtualizationStatistics.Active)
        throw new Error("Composition did not materialize full document");
      const text = surface.querySelector("[data-rt-type=Run]").firstChild;
      text.data = `文${text.data}`;
      const selection = window.getSelection(),
        range = window.document.createRange();
      range.setStart(text, 1);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      surface.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data: "文" }),
      );
    });
    await page.waitForFunction(() =>
      window.layoutTestEditor.Text.startsWith("文"),
    );
    assert.equal(
      await page.evaluate(
        () =>
          window.layoutTestEditor.Text.slice(1) === window.layoutTestOriginal,
      ),
      true,
    );
    await page.evaluate(() => window.layoutTestEditor.Undo());
    assert.equal(
      await page.evaluate(
        () => window.layoutTestEditor.Text === window.layoutTestOriginal,
      ),
      true,
    );
    results.push(
      "IME composition temporarily materializes document and commits one lossless undoable edit",
    );

    const floating = await page.evaluate(() => {
      const R = window.richTextStudio.RT,
        e = window.layoutTestEditor;
      e.EnableVirtualization = false;
      const paragraph = new R.Paragraph("Text before ");
      const figure = new R.Figure(new R.Paragraph("Independent text box"));
      figure.Width = 180;
      paragraph.Inlines.Add(figure);
      paragraph.Inlines.Add(
        new R.Run("Text flows beside the text box. ".repeat(20)),
      );
      e.Document = new R.FlowDocument(paragraph);
      e.SetFloatingLayout(figure.Id, {
        WrapStyle: "Square",
        Width: 180,
        HorizontalAlignment: "Left",
        WrapDistance: 12,
      });
      e.SelectObject(figure.Id);
      window.layoutTestObject = figure.Id;
      const element = e.shadowRoot.querySelector(`[data-rt-id="${figure.Id}"]`);
      return {
        float: getComputedStyle(element).cssFloat,
        text: e.Text,
        story: element.textContent,
        editable: element.contentEditable,
        grips: e.shadowRoot.querySelectorAll(".rt-object-grip").length,
      };
    });
    assert.equal(floating.float, "left");
    assert(floating.text.includes("\ufffc"));
    assert(!floating.text.includes("Independent"));
    assert.equal(floating.story, "Independent text box");
    assert.equal(floating.editable, "false");
    assert.equal(floating.grips, 9);
    const grip = page
      .locator("#layout-test-editor")
      .getByRole("button", { name: "Resize selected object e", exact: true });
    await grip.focus();
    await page.keyboard.press("Shift+ArrowRight");
    assert.equal(
      await page.evaluate(
        () => window.layoutTestEditor.GetSelectedObject().props.Width,
      ),
      190,
    );
    await page.evaluate(() => window.layoutTestEditor.Undo());
    assert.equal(
      await page.evaluate(
        () => window.layoutTestEditor.GetSelectedObject().props.Width,
      ),
      180,
    );
    const gripBox = await grip.boundingBox();
    await page.mouse.move(
      gripBox.x + gripBox.width / 2,
      gripBox.y + gripBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      gripBox.x + gripBox.width / 2 + 35,
      gripBox.y + gripBox.height / 2,
      { steps: 5 },
    );
    await page.mouse.up();
    assert.equal(
      await page.evaluate(
        () => window.layoutTestEditor.GetSelectedObject().props.Width,
      ),
      215,
    );
    await page.evaluate(() => window.layoutTestEditor.Undo());
    const moved = await page.evaluate(() => {
      const e = window.layoutTestEditor,
        id = window.layoutTestObject;
      e.SetFloatingLayout(id, { HorizontalAlignment: "Right" });
      const object = () => e.shadowRoot.querySelector(`[data-rt-id="${id}"]`);
      const before = object().getBoundingClientRect().left;
      e.SetFloatingLayout(id, { HorizontalOffset: -30 });
      const after = object().getBoundingClientRect().left;
      e.Undo();
      e.Undo();
      return before - after;
    });
    assert.equal(moved, 30);
    results.push(
      "Floating text wraps beside body text, has atomic story offsets and keyboard-accessible undoable resize grips",
    );

    await page.evaluate(() => {
      const toolbar = document.createElement("rich-text-toolbar");
      toolbar.id = "layout-test-toolbar";
      toolbar.Editor = window.layoutTestEditor;
      document.body.append(toolbar);
      toolbar.Execute("EditTextBox");
    });
    const story = page
      .locator("#layout-test-toolbar")
      .locator("dialog[open] rich-text-box");
    await story.locator("[role=textbox]").click();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("Rich story edited");
    await page
      .locator("#layout-test-toolbar")
      .getByRole("button", { name: "Apply", exact: true })
      .click();
    assert.equal(
      await page.evaluate(
        () =>
          window.layoutTestEditor.GetSelectedObject().children[0].children[0]
            .text,
      ),
      "Rich story edited",
    );
    await page.evaluate(() => window.layoutTestEditor.Undo());
    assert.equal(
      await page.evaluate(
        () =>
          window.layoutTestEditor.GetSelectedObject().children[0].children[0]
            .text,
      ),
      "Independent text box",
    );
    results.push(
      "Floating story dialog uses a nested rich text control and commits one parent undo operation",
    );
    const atomComposition = await page.evaluate(async () => {
      const e = window.layoutTestEditor;
      const before = e.Text;
      e.Focus();
      e.Select(0);
      const surface = e.shadowRoot.querySelector("[part=editor]");
      surface.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      const text = surface.querySelector("[data-rt-type=Run]").firstChild;
      text.data = `文${text.data}`;
      const range = document.createRange(),
        selection = window.getSelection();
      range.setStart(text, 1);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      surface.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data: "文" }),
      );
      await new Promise((resolve) => queueMicrotask(resolve));
      const composed = e.Text === `文${before}`;
      const preserved =
        e.GetSelectedObject()?.children[0]?.children[0]?.text ===
        "Independent text box";
      e.Undo();
      const reverted = e.Text === before;
      surface.dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "formatSetBlockTextDirection",
        }),
      );
      surface.querySelector("[data-rt-type=Run]").style.fontWeight = "bold";
      surface.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "formatSetBlockTextDirection",
        }),
      );
      const fallbackPreserved =
        e.Text === before &&
        e.GetSelectedObject()?.id === window.layoutTestObject;
      return { composed, preserved, reverted, fallbackPreserved };
    });
    assert.deepEqual(atomComposition, {
      composed: true,
      preserved: true,
      reverted: true,
      fallbackPreserved: true,
    });
    results.push(
      "IME and native formatting fallback preserve independent floating stories and their identities",
    );

    await page.evaluate(() => {
      window.layoutTestEditor.remove();
      const R = window.richTextStudio.RT,
        e = document.createElement("rich-text-page-editor");
      e.id = "layout-page-editor";
      e.style.cssText = "position:fixed;inset:20px;z-index:11000;height:650px";
      const doc = R.fromText(
        Array.from(
          { length: 32 },
          (_, i) => `Line ${i} with enough text to wrap in a narrow column.`,
        ).join("\n"),
      );
      doc.PageWidth = 520;
      doc.PageHeight = 460;
      doc.PagePadding = 40;
      doc.SetValue("ColumnCount", 2);
      doc.SetValue("ColumnGap", 24);
      e.Document = doc;
      document.body.append(e);
      window.layoutPageEditor = e;
    });
    const pages = await page.evaluate(async () => {
      const e = window.layoutPageEditor,
        layout = await e.Repaginate();
      e.LastPage();
      e.Focus();
      return {
        count: layout.PageCount,
        lastOffset: layout.Pages.at(-1).StartOffset,
        columnCount: getComputedStyle(
          e.shadowRoot.querySelector("[part=editor]"),
        ).columnCount,
        editable: !e.IsReadOnly,
        bounds: e.shadowRoot
          .querySelector("[part=page]")
          .getBoundingClientRect().height,
      };
    });
    assert(pages.count > 1);
    assert.equal(pages.columnCount, "2");
    assert.equal(pages.editable, true);
    assert.equal(pages.bounds, 460);
    await page.evaluate(() => window.layoutPageEditor.BeginChange());
    await page.keyboard.type("PAGE EDIT ");
    await page.evaluate(() => window.layoutPageEditor.EndChange());
    assert.equal(
      await page.evaluate(
        (offset) =>
          window.layoutPageEditor.Text.slice(offset).startsWith("PAGE EDIT "),
        pages.lastOffset,
      ),
      true,
    );
    await page.evaluate(() => window.layoutPageEditor.Undo());
    assert.equal(
      await page.evaluate(() =>
        window.layoutPageEditor.Text.includes("PAGE EDIT"),
      ),
      false,
    );
    results.push(
      "Finite editable pages group newspaper columns and preserve model selection through page navigation and undo",
    );
    await page.evaluate(() => {
      const e = window.layoutPageEditor;
      e.ViewMode = "continuous";
      e.EnableVirtualization = true;
      e.VirtualizationThreshold = 10;
    });
    assert.equal(
      await page.evaluate(
        () => window.layoutPageEditor.VirtualizationStatistics.Active,
      ),
      true,
    );
    assert.equal(
      await page.evaluate(
        () =>
          window.layoutPageEditor.shadowRoot.querySelector("[part=page]").style
            .display,
      ),
      "contents",
    );
    await page.evaluate(() => {
      window.layoutPageEditor.ViewMode = "page";
    });
    const resumed = await page.evaluate(
      async () => (await window.layoutPageEditor.Repaginate()).PageCount,
    );
    assert(resumed > 1);
    results.push(
      "Page editor switches between finite pages and virtualized continuous editing without changing content",
    );

    const effective = await page.evaluate(() => {
      const R = window.richTextStudio.RT,
        e = window.layoutPageEditor;
      e.ViewMode = "continuous";
      e.EnableVirtualization = false;
      e.Document = R.fromText("Effective style");
      const run = e.Document.Blocks.Get(0).Children[0];
      run.SetStyleValue("Foreground", "rgb(130, 20, 40)");
      run.SetCurrentValue("FontSize", 27);
      e.Refresh();
      const element = e.shadowRoot.querySelector(`[data-rt-id="${run.Id}"]`);
      return {
        color: getComputedStyle(element).color,
        size: getComputedStyle(element).fontSize,
        localSize: run.ToJSON().props.FontSize,
      };
    });
    assert.equal(effective.color, "rgb(130, 20, 40)");
    assert.equal(effective.size, "27px");
    assert.equal(effective.localSize, undefined);
    results.push(
      "Renderer applies style/current effective property values without rewriting portable local values",
    );
    const clipboard = await page.evaluate(async () => {
      const e = window.layoutPageEditor;
      const descriptor = Object.getOwnPropertyDescriptor(
        navigator,
        "clipboard",
      );
      let finish;
      try {
        e.Text = "Clipboard source";
        e.Select(0, 9);
        const written = [];
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            write: async (items) => {
              written.push(await (await items[0].getType("text/plain")).text());
            },
            writeText: async (text) => {
              written.push(text);
            },
            read: async () => [
              {
                types: ["text/html", "text/plain"],
                getType: async (type) =>
                  new Blob(
                    [
                      type === "text/html"
                        ? "<p><strong>Pasted</strong></p>"
                        : "Pasted",
                    ],
                    { type },
                  ),
              },
            ],
          },
        });
        await e.Copy();
        await e.Paste();
        const rich = e.Document.Blocks.Get(0).Children.some(
          (node) =>
            node.Type === "Bold" || node.GetValue("FontWeight") === "Bold",
        );
        e.Text = "Keep everything";
        e.Select(0, 4);
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            write: () =>
              new Promise((resolve) => {
                finish = resolve;
              }),
            writeText: () =>
              new Promise((resolve) => {
                finish = resolve;
              }),
          },
        });
        const cutting = e.Cut();
        e.Select(5, 15);
        finish();
        let conflict = "";
        try {
          await cutting;
        } catch (error) {
          conflict = error.message;
        }
        return { written, rich, text: e.Text, conflict };
      } finally {
        if (descriptor)
          Object.defineProperty(navigator, "clipboard", descriptor);
        else delete navigator.clipboard;
      }
    });
    assert.deepEqual(clipboard.written, ["Clipboard"]);
    assert.equal(clipboard.rich, true);
    assert.equal(clipboard.text, "Keep everything");
    assert.match(clipboard.conflict, /no content was cut/);
    results.push(
      "Reusable clipboard commands preserve rich HTML and reject stale asynchronous cut selection",
    );
    const mvvm = await page.evaluate(async () => {
      const R = window.richTextStudio.RT,
        e = window.layoutPageEditor;
      e.Document = R.fromText(
        Array.from(
          { length: 80 },
          (_, index) => `Bound paragraph ${index}`,
        ).join("\n"),
      );
      e.Document.PageWidth = 400;
      e.Document.PageHeight = 400;
      e.Document.PagePadding = 40;
      e.ViewMode = "page";
      await e.Repaginate();
      const vm = new R.ObservableObject({
        Page: 1,
        Mode: "page",
        Virtualize: false,
      });
      const bindings = [
        new R.Binding({
          Source: vm,
          Path: "Page",
          Mode: R.BindingMode.TwoWay,
          UpdateSourceEvent: "pagechange",
        }).Attach(e, "PageNumber"),
        new R.Binding({ Source: vm, Path: "Mode" }).Attach(e, "ViewMode"),
        new R.Binding({ Source: vm, Path: "Virtualize" }).Attach(
          e,
          "EnableVirtualization",
        ),
      ];
      try {
        e.NextPage();
        const targetToSource = vm.Page === 2;
        vm.Page = 1;
        const sourceToTarget = e.PageNumber === 1;
        e.VirtualizationThreshold = 10;
        vm.Virtualize = true;
        vm.Mode = "continuous";
        return {
          targetToSource,
          sourceToTarget,
          virtualized: e.VirtualizationStatistics.Active,
        };
      } finally {
        bindings.forEach((binding) => binding.Dispose());
      }
    });
    assert.deepEqual(mvvm, {
      targetToSource: true,
      sourceToTarget: true,
      virtualized: true,
    });
    results.push(
      "MVVM bindings drive page navigation in both directions and configure virtualized editing",
    );
    return results;
  } finally {
    await page.evaluate(() => {
      for (const id of [
        "layout-test-editor",
        "layout-test-toolbar",
        "layout-page-editor",
      ]) {
        const e = document.getElementById(id);
        e?.Dispose?.();
        e?.remove();
      }
      window.layoutTestEditor?.Dispose();
    });
  }
}
