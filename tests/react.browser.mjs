import { build } from "esbuild";
import assert from "node:assert/strict";

/** A separate page avoids loading a second copy of the model into the demo custom-element registry. */
export async function runReactBrowserChecks(page) {
  const result = await build({
    entryPoints: ["tests/react-browser-entry.ts"],
    write: false,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  const browser = page.context().browser();
  const fixture = browser
    ? await browser.newPage()
    : await page.context().newPage();
  const errors = [];
  fixture.on("pageerror", (error) => errors.push(error.message));
  try {
    await fixture.setContent("<!doctype html><html><body></body></html>");
    await fixture.addScriptTag({
      type: "module",
      content: result.outputFiles[0].text,
    });
    await fixture.waitForFunction(
      () =>
        window.richTextReactTest?.control?.Document?.Text === "React initial",
    );
    assert.deepEqual(
      await fixture.evaluate(() => ({
        text: window.richTextReactTest.control.Document.Text,
        zoom: window.richTextReactTest.control.Zoom,
        mode: window.richTextReactTest.control.ViewMode,
        ready: window.richTextReactTest.ready,
        changes: window.richTextReactTest.changes,
      })),
      {
        text: "React initial",
        zoom: 1.25,
        mode: "continuous",
        ready: 1,
        changes: 0,
      },
    );
    await fixture.evaluate(() => {
      const test = window.richTextReactTest;
      test.control.Engine.Select(0, 5);
      test.control.Engine.InsertText("Updated");
    });
    await fixture.waitForFunction(() =>
      document
        .querySelector("#react-status")
        .textContent.includes("Updated initial"),
    );
    assert.equal(
      await fixture.evaluate(() => window.richTextReactTest.changes),
      1,
    );
    await fixture.evaluate(() => window.richTextReactTest.setReadOnly(true));
    await fixture.waitForFunction(
      () => window.richTextReactTest.control.IsReadOnly === true,
    );
    assert.equal(
      await fixture.evaluate(() => window.richTextReactTest.control.IsReadOnly),
      true,
    );
    await fixture.evaluate(() => window.richTextReactTest.replace());
    await fixture.waitForFunction(
      () => window.richTextReactTest.control.Document.Text === "Replacement",
    );
    assert.equal(
      await fixture.evaluate(() => window.richTextReactTest.changes),
      1,
    );
    const detached = await fixture.evaluate(() => {
      const test = window.richTextReactTest;
      const model = test.model;
      test.unmount();
      model.Blocks.Get(0).Inlines.Get(0).Text = "After unmount";
      return {
        ref: test.control,
        changes: test.changes,
        remaining: document.querySelectorAll("rich-text-box").length,
      };
    });
    assert.deepEqual(detached, { ref: null, changes: 1, remaining: 0 });
    await fixture.evaluate(() => window.richTextReactTest.mountPaged());
    await fixture.waitForFunction(() =>
      window.richTextReactPagedTest?.control?.Document?.Text.startsWith(
        "React page",
      ),
    );
    const paged = await fixture.evaluate(async () => {
      const test = window.richTextReactPagedTest,
        control = test.control;
      const layout = await control.Repaginate();
      control.LastPage();
      control.Focus();
      control.BeginChange();
      return {
        tag: control.localName,
        count: layout.PageCount,
        offset: control.Selection.Start.Offset,
        ready: test.events.ready,
      };
    });
    assert.equal(paged.tag, "rich-text-page-editor");
    assert(paged.count > 1);
    assert.equal(paged.ready, 1);
    await fixture.keyboard.type("ReactPage ");
    const edited = await fixture.evaluate((offset) => {
      const test = window.richTextReactPagedTest,
        control = test.control;
      control.EndChange();
      const correct = control.Text.slice(offset).startsWith("ReactPage ");
      control.Undo();
      return {
        correct,
        restored: !control.Text.includes("ReactPage "),
        events: test.events,
      };
    }, paged.offset);
    assert.equal(edited.correct, true);
    assert.equal(edited.restored, true);
    assert(
      edited.events.changes > 0 &&
        edited.events.pages > 0 &&
        edited.events.layouts > 0,
    );
    await fixture.evaluate(() =>
      window.richTextReactPagedTest.setMode("continuous"),
    );
    await fixture.waitForFunction(
      () =>
        window.richTextReactPagedTest.control.VirtualizationStatistics.Active,
    );
    const virtual = await fixture.evaluate(() => {
      const test = window.richTextReactPagedTest,
        control = test.control;
      return {
        threshold: control.VirtualizationThreshold,
        overscan: control.VirtualizationOverscan,
        nodes: control.shadowRoot
          .querySelector("[part=editor]")
          .querySelectorAll("[data-rt-paragraph]").length,
        events: test.events.virtualEvents,
      };
    });
    assert.equal(virtual.threshold, 10);
    assert.equal(virtual.overscan, 2);
    assert(virtual.nodes < 60);
    assert(virtual.events > 0);
    await fixture.evaluate(() =>
      window.richTextReactPagedTest.setVirtualization(false),
    );
    await fixture.waitForFunction(
      () =>
        !window.richTextReactPagedTest.control.VirtualizationStatistics.Active,
    );
    assert.equal(
      await fixture.evaluate(
        () =>
          window.richTextReactPagedTest.control.shadowRoot
            .querySelector("[part=editor]")
            .querySelectorAll("[data-rt-paragraph]").length,
      ),
      120,
    );
    await fixture.evaluate(() => {
      window.richTextReactPagedTest.setMode("page");
      window.richTextReactPagedTest.setReadOnly(true);
    });
    await fixture.waitForFunction(
      () => window.richTextReactPagedTest.control.IsReadOnly,
    );
    assert.equal(
      await fixture.evaluate(() =>
        window.richTextReactPagedTest.control.Execute("InsertText", "blocked"),
      ),
      false,
    );
    const pagedDetached = await fixture.evaluate(() => {
      const test = window.richTextReactPagedTest,
        model = test.model,
        before = test.events.changes;
      test.unmount();
      model.Blocks.Get(0).Inlines.Get(0).Text = "After paged unmount";
      return {
        ref: test.control,
        unchanged: test.events.changes === before,
        remaining: document.querySelectorAll("rich-text-page-editor").length,
      };
    });
    assert.deepEqual(pagedDetached, {
      ref: null,
      unchanged: true,
      remaining: 0,
    });
    assert.deepEqual(errors, []);
    return 9;
  } finally {
    await fixture.close();
  }
}
