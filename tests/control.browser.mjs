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
    return 14 + (await runPaginationBrowserChecks(page));
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

export async function runPaginationBrowserChecks(page) {
  const identity = await page.evaluate(() => {
    const e = window.controlTestEditor;
    e.Text = "First\nSecond\nThird";
    const paragraphs = e.shadowRoot.querySelectorAll("[data-rt-paragraph]");
    const second = paragraphs[1],
      span = second.querySelector("span"),
      text = span.firstChild;
    const observer = new MutationObserver(() => {});
    observer.observe(second, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    e.Engine.Select(0);
    e.Engine.InsertText("Changed ");
    const afterTyping = {
      sameParagraph:
        e.shadowRoot.querySelectorAll("[data-rt-paragraph]")[1] === second,
      sameSpan: second.querySelector("span") === span,
      sameText: span.firstChild === text,
      mutations: observer.takeRecords().length,
      stats: e.RenderStatistics,
    };
    e.Document.BeginChange();
    const block = e.Document.Blocks.Get(1);
    e.Document.Blocks.Remove(block);
    e.Document.Blocks.Insert(0, block);
    e.Document.EndChange();
    const sameAfterMove =
      e.shadowRoot.querySelectorAll("[data-rt-paragraph]")[0] === second;
    observer.disconnect();
    return { ...afterTyping, sameAfterMove };
  });
  assert(
    identity.sameParagraph &&
      identity.sameSpan &&
      identity.sameText &&
      identity.sameAfterMove,
  );
  assert.equal(identity.mutations, 0);
  assert(identity.stats.Reused > 0);

  await page.evaluate(() => {
    const R = window.richTextStudio.RT,
      viewer = document.createElement("flow-document-page-viewer");
    viewer.id = "pagination-test-viewer";
    viewer.style.cssText = "position:fixed;inset:0;height:620px;z-index:11000";
    const doc = R.fromText(
      Array.from(
        { length: 20 },
        (_, index) =>
          `Paragraph ${index}: ` + "Measured page content. ".repeat(10),
      ).join("\n"),
    );
    doc.PageWidth = 420;
    doc.PageHeight = 350;
    doc.PagePadding = 40;
    viewer.Document = doc;
    document.body.append(viewer);
    window.paginationTestViewer = viewer;
  });
  try {
    const measured = await page.evaluate(async () => {
      const v = window.paginationTestViewer,
        layout = await v.Repaginate();
      return {
        layout,
        textLength: v.Document.Text.length,
        windowHeight:
          v.shadowRoot.querySelector(".rt-page-window").clientHeight,
        flowHeight: v.shadowRoot.querySelector(".rt-page-flow").clientHeight,
      };
    });
    assert(measured.layout.PageCount >= 3);
    assert.equal(measured.layout.Method, "css-column-fragmentation");
    assert.equal(measured.windowHeight, 270);
    assert.equal(measured.flowHeight, 270);
    assert.equal(measured.layout.Pages[0].StartOffset, 0);
    assert.equal(measured.layout.Pages.at(-1).EndOffset, measured.textLength);
    for (let index = 0; index < measured.layout.Pages.length - 1; index++) {
      assert.equal(
        measured.layout.Pages[index].EndOffset,
        measured.layout.Pages[index + 1].StartOffset,
      );
      assert(
        measured.layout.Pages[index].EndOffset >
          measured.layout.Pages[index].StartOffset,
      );
    }
    const navigation = await page.evaluate(() => {
      const v = window.paginationTestViewer,
        flow = v.shadowRoot.querySelector(".rt-page-flow");
      const firstX = flow.getBoundingClientRect().left;
      v.NextPage();
      const next = v.PageNumber,
        displacement = firstX - flow.getBoundingClientRect().left;
      v.LastPage();
      const atLast = !v.CanGoToNextPage && v.PageNumber === v.PageCount;
      const invalid = v.GoToPage(v.PageCount + 1);
      v.FirstPage();
      v.Focus();
      return { next, displacement, atLast, invalid };
    });
    assert.equal(navigation.next, 2);
    assert.equal(navigation.displacement, 372);
    assert.equal(navigation.atLast, true);
    assert.equal(navigation.invalid, false);
    await page.keyboard.press("PageDown");
    assert.equal(
      await page.evaluate(() => window.paginationTestViewer.PageNumber),
      2,
    );

    const explicit = await page.evaluate(async () => {
      const R = window.richTextStudio.RT,
        v = window.paginationTestViewer,
        doc = R.fromText("First\nSecond");
      doc.PageWidth = 340;
      doc.PageHeight = 320;
      doc.PagePadding = 40;
      doc.Blocks.Get(1).BreakPageBefore = true;
      v.Document = doc;
      const layout = await v.Repaginate();
      return {
        count: layout.PageCount,
        secondStart: layout.Pages[1]?.StartOffset,
      };
    });
    assert.deepEqual(explicit, { count: 2, secondStart: 6 });

    const keep = await page.evaluate(async () => {
      const R = window.richTextStudio.RT,
        v = window.paginationTestViewer,
        doc = R.fromText("Spacer\nHeading\nFollowing");
      doc.PageWidth = 340;
      doc.PageHeight = 320;
      doc.PagePadding = 40;
      for (const block of doc.Blocks) block.Margin = 0;
      doc.Blocks.Get(0).SetValue("Height", 180);
      doc.Blocks.Get(1).KeepWithNext = true;
      doc.Blocks.Get(2).SetValue("Height", 60);
      doc.Blocks.Get(2).KeepTogether = true;
      v.Document = doc;
      const layout = await v.Repaginate();
      return {
        count: layout.PageCount,
        secondStart: layout.Pages[1]?.StartOffset,
      };
    });
    assert.deepEqual(keep, { count: 2, secondStart: 7 });

    const widows = await page.evaluate(async () => {
      const R = window.richTextStudio.RT,
        v = window.paginationTestViewer;
      const paragraph = new R.Paragraph(
        new R.Run(
          Array.from({ length: 8 }, (_, i) => `Line ${i + 1}`).join("\n"),
        ),
      );
      paragraph.Margin = 0;
      paragraph.LineHeight = 24;
      paragraph.SetValue("Widows", 3);
      paragraph.SetValue("Orphans", 3);
      const doc = new R.FlowDocument(paragraph);
      doc.PageWidth = 340;
      doc.PageHeight = 224;
      doc.PagePadding = 40;
      v.Document = doc;
      const layout = await v.Repaginate();
      return {
        count: layout.PageCount,
        finalLines: doc.Text.slice(layout.Pages.at(-1).StartOffset)
          .trim()
          .split("\n").length,
        firstLines: doc.Text.slice(0, layout.Pages[0].EndOffset)
          .trim()
          .split("\n").length,
      };
    });
    assert.equal(widows.count, 2);
    assert(widows.firstLines >= 3 && widows.finalLines >= 3);

    const overflow = await page.evaluate(async () => {
      const R = window.richTextStudio.RT,
        v = window.paginationTestViewer;
      const doc = R.FlowDocument.FromJSON({
        type: "FlowDocument",
        id: "overflow-doc",
        props: { PageWidth: 340, PageHeight: 320, PagePadding: 40 },
        children: [
          {
            type: "Paragraph",
            id: "overflow-paragraph",
            props: {},
            children: [
              {
                type: "Image",
                id: "oversize-image",
                props: {
                  Width: 80,
                  Height: 500,
                  Source:
                    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
                },
              },
            ],
          },
        ],
      });
      v.Document = doc;
      return await v.Repaginate();
    });
    assert(
      overflow.Overflows.some(
        (item) =>
          item.ElementId === "oversize-image" && item.Reason === "height",
      ),
    );
    assert(overflow.Pages.some((item) => item.HasOverflow));

    const stories = await page.evaluate(async () => {
      const R = window.richTextStudio.RT,
        v = window.paginationTestViewer,
        doc = R.fromText("First1\nSecond");
      doc.PageWidth = 380;
      doc.PageHeight = 400;
      doc.PagePadding = 50;
      doc.Blocks.Get(1).BreakPageBefore = true;
      const node = doc.ToJSON();
      node.children[0].children[0].props.NoteReference = {
        Kind: "Footnote",
        Id: "note-1",
      };
      const story = (id, label, field) => [
        {
          type: "Paragraph",
          id: `${id}-p`,
          props: {},
          children: [
            { type: "Run", id: `${id}-label`, props: {}, text: label },
            {
              type: "Span",
              id: `${id}-field`,
              props: { Field: { Type: field, Instruction: field } },
              children: [
                { type: "Run", id: `${id}-cached`, props: {}, text: "0" },
              ],
            },
          ],
        },
      ];
      node.props.FirstPageHeader = story("first", "First page ", "PAGE");
      node.props.EvenPageHeader = story("even", "Even page ", "PAGE");
      node.props.Footers = story("footer", "Total ", "NUMPAGES");
      node.props.Footnotes = [
        {
          Id: "note-1",
          Blocks: [
            {
              type: "Paragraph",
              id: "note-paragraph",
              props: {},
              children: [
                {
                  type: "Run",
                  id: "note-text",
                  props: {},
                  text: "A referenced footnote.",
                },
              ],
            },
          ],
        },
      ];
      node.props.FootnoteAreaHeight = 40;
      v.Document = R.FlowDocument.FromJSON(node);
      await v.Repaginate();
      v.FirstPage();
      const header1 =
          v.shadowRoot.querySelector("[part=page-header]").textContent,
        footer = v.shadowRoot.querySelector("[part=page-footer]").textContent,
        note1 = v.shadowRoot.querySelector("[part=page-footnotes]").textContent;
      v.NextPage();
      return {
        header1,
        footer,
        note1,
        header2: v.shadowRoot.querySelector("[part=page-header]").textContent,
        notes2Hidden:
          v.shadowRoot.querySelector("[part=page-footnotes]").style.display ===
          "none",
        sourceCache:
          v.Document.ToJSON().props.FirstPageHeader[0].children[1].children[0]
            .text,
      };
    });
    assert.equal(stories.header1, "First page 1");
    assert.equal(stories.header2, "Even page 2");
    assert.equal(stories.footer, "Total 2");
    assert.match(stories.note1, /referenced footnote/);
    assert.equal(stories.notes2Hidden, true);
    assert.equal(stories.sourceCache, "0");
    return 8;
  } finally {
    await page.evaluate(() => {
      window.paginationTestViewer?.Dispose();
      window.paginationTestViewer?.remove();
      delete window.paginationTestViewer;
    });
  }
}
