import assert from "node:assert/strict";

/** Exercise the sample UI's review state and its own read-only boundary. */
export async function runReviewBrowserChecks(page) {
  const results = [];
  const previous = await page.evaluate(() => ({
    document: richTextStudio.editor.Document.ToJSON(),
    title: document.getElementById("document-title").value,
    readOnly: richTextStudio.editor.IsReadOnly,
  }));
  try {
    await page.evaluate(() => {
      const { editor, RT } = richTextStudio;
      editor.IsReadOnly = false;
      editor.Document = RT.fromText("same target same target");
      editor.Engine.Select(17, 23);
      richTextStudio.run("comment");
    });
    await page.locator("#comment-text").fill("Review the second occurrence.");
    await page.locator("#dialog-submit").click();
    await page.waitForFunction(
      () => richTextStudio.editor.Engine.Annotations.length === 1,
    );
    assert.deepEqual(
      await page.evaluate(() => {
        const a = richTextStudio.editor.Engine.Annotations[0];
        return [a.Kind, a.Start, a.End, a.Data.Text];
      }),
      ["Comment", 17, 23, "Review the second occurrence."],
    );
    await page.evaluate(() => {
      const e = richTextStudio.editor.Engine;
      e.Select(0);
      e.InsertText("prefix ");
    });
    await page.locator("[data-comment-go]").click();
    assert.deepEqual(
      await page.evaluate(() => [
        richTextStudio.editor.Selection.Start.Offset,
        richTextStudio.editor.Selection.End.Offset,
      ]),
      [24, 30],
    );
    results.push(
      "Comments target exact duplicate-text ranges and follow preceding edits",
    );

    await page.locator("[data-comment-resolve]").click();
    assert.equal(
      await page.evaluate(
        () => richTextStudio.editor.Engine.Annotations[0].Data.Resolved,
      ),
      true,
    );
    await page.evaluate(() => richTextStudio.run("undo"));
    assert.equal(
      await page.evaluate(
        () => richTextStudio.editor.Engine.Annotations[0].Data.Resolved,
      ),
      false,
    );
    await page.locator("[data-comment-delete]").click();
    assert.equal(
      await page.evaluate(
        () => richTextStudio.editor.Engine.Annotations.length,
      ),
      0,
    );
    await page.evaluate(() => richTextStudio.run("undo"));
    assert.equal(await page.locator("[data-comment-go]").count(), 1);
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("richtextweb-document"))?.document
          ?.props?.Annotations?.length === 1,
    );
    assert.equal(
      await page.evaluate(() => {
        const saved = JSON.parse(localStorage.getItem("richtextweb-document"));
        return (
          saved.comments === undefined &&
          saved.document.props.Annotations[0].Start === 24
        );
      }),
      true,
    );
    results.push(
      "Comment resolution and deletion undo correctly and persist in document JSON",
    );

    await page.evaluate(() => {
      richTextStudio.editor.Engine.Select(7, 11);
      richTextStudio.run("bookmark");
    });
    await page.locator("#bookmark-name").fill("second-section");
    await page.locator("#dialog-submit").click();
    await page.waitForFunction(() =>
      richTextStudio.editor.Engine.Annotations.some(
        (a) => a.Kind === "Bookmark",
      ),
    );
    await page.evaluate(() => richTextStudio.editor.Engine.Select(0));
    await page.locator("[data-bookmark-go]").click();
    assert.deepEqual(
      await page.evaluate(() => [
        richTextStudio.editor.Selection.Start.Offset,
        richTextStudio.editor.Selection.End.Offset,
      ]),
      [7, 11],
    );
    results.push("Bookmark dialog stores and navigates engine annotations");

    const readOnlyBefore = await page.evaluate(() => {
      richTextStudio.editor.IsReadOnly = true;
      return JSON.stringify(richTextStudio.editor.Document.ToJSON());
    });
    await page.evaluate(() => {
      for (const command of [
        "bold",
        "italic",
        "underline",
        "strike",
        "superscript",
        "heading1",
        "normal",
        "clear-format",
        "bullets",
        "numbering",
        "indent",
        "outdent",
        "align-center",
        "page-break",
        "date",
        "a4",
        "letter",
        "landscape",
        "table-row-after",
        "table-column-before",
        "table-delete",
        "undo",
        "redo",
        "new",
        "open",
        "comment",
        "bookmark",
        "large-document",
      ])
        richTextStudio.run(command);
      richTextStudio.loadTemplate("blank");
    });
    await page.getByRole("button", { name: "Home", exact: true }).click();
    assert.equal(await page.locator("#font-size").isDisabled(), true);
    await page.evaluate(() => {
      for (const [id, value, event] of [
        ["font-size", "42", "change"],
        ["font-family", "Georgia", "change"],
        ["text-color", "#ff0000", "input"],
        ["highlight-color", "#00ff00", "input"],
      ]) {
        const input = document.getElementById(id);
        input.value = value;
        input.dispatchEvent(new Event(event, { bubbles: true }));
      }
    });
    await page.evaluate(() => richTextStudio.run("source-json"));
    assert.equal(await page.locator("#apply-source").isDisabled(), true);
    assert.equal(
      (await page.locator("#source-code").getAttribute("readonly")) !== null,
      true,
    );
    await page.evaluate(() => {
      document.getElementById("source-code").value = JSON.stringify(
        richTextStudio.RT.fromText("should not replace").ToJSON(),
      );
      document.getElementById("apply-source").onclick();
      document.getElementById("replace-all").onclick();
    });
    await page.locator("#file-input").setInputFiles({
      name: "readonly.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("should not import"),
    });
    assert.equal(
      await page.evaluate(() =>
        JSON.stringify(richTextStudio.editor.Document.ToJSON()),
      ),
      readOnlyBefore,
    );
    assert.equal(
      await page.locator("#dialog").evaluate((el) => el.open),
      false,
    );
    await page.evaluate(() => richTextStudio.run("comments"));
    assert.equal(
      await page.locator("[data-comment-resolve]").isDisabled(),
      true,
    );
    await page.evaluate(() => {
      document.querySelector("[data-comment-resolve]").onclick();
      document.querySelector("[data-comment-delete]").onclick();
      document.querySelector("[data-bookmark-delete]").onclick();
    });
    assert.equal(
      await page.evaluate(() =>
        JSON.stringify(richTextStudio.editor.Document.ToJSON()),
      ),
      readOnlyBefore,
    );
    results.push(
      "Read-only mode blocks sample commands, dropdowns, colors, source, import, review, and templates",
    );

    await page.evaluate(() => {
      richTextStudio.editor.IsReadOnly = false;
      richTextStudio.run("comment");
    });
    await page.locator("#comment-text").fill("Blocked after opening");
    await page.evaluate(() => (richTextStudio.editor.IsReadOnly = true));
    await page.locator("#dialog-submit").click();
    await page.waitForFunction(() => !document.getElementById("dialog").open);
    assert.equal(
      await page.evaluate(
        () =>
          richTextStudio.editor.Engine.Annotations.filter(
            (a) => a.Kind === "Comment",
          ).length,
      ),
      1,
    );
    results.push("Dialog submission rechecks read-only state");

    await page.evaluate(() => {
      const { editor, RT } = richTextStudio;
      editor.IsReadOnly = false;
      editor.Document = RT.fromText("");
      editor.Engine.Select(0);
      richTextStudio.run("table");
    });
    await page.locator("#table-rows").fill("2");
    await page.locator("#table-columns").fill("2");
    await page.locator("#dialog-submit").click();
    await page.waitForFunction(() =>
      richTextStudio.RT.toHTML(richTextStudio.editor.Document).includes(
        "<table",
      ),
    );
    await page.evaluate(() => richTextStudio.editor.Engine.Select(0));
    await page.getByRole("button", { name: "Insert", exact: true }).click();
    const geometry = () =>
      page.evaluate(() => {
        const counts = { rows: 0, cells: 0 };
        const visit = (n) => {
          if (n.type === "TableRow") counts.rows++;
          if (n.type === "TableCell") counts.cells++;
          n.children?.forEach(visit);
        };
        visit(richTextStudio.editor.Document.ToJSON());
        return counts;
      });
    await page.locator('[data-command="table-row-before"]').click();
    assert.deepEqual(await geometry(), { rows: 3, cells: 6 });
    await page.locator('[data-command="table-column-before"]').click();
    assert.deepEqual(await geometry(), { rows: 3, cells: 9 });
    await page.locator('[data-command="table-row-delete"]').click();
    assert.deepEqual(await geometry(), { rows: 2, cells: 6 });
    await page.locator('[data-command="table-column-delete"]').click();
    assert.deepEqual(await geometry(), { rows: 2, cells: 4 });
    results.push(
      "Table toolbar inserts and deletes actual model rows and columns",
    );
  } finally {
    await page.evaluate((previous) => {
      const { editor, RT } = richTextStudio;
      editor.IsReadOnly = false;
      editor.Document = RT.FlowDocument.FromJSON(previous.document);
      document.getElementById("document-title").value = previous.title;
      editor.IsReadOnly = previous.readOnly;
    }, previous);
  }
  return results;
}
