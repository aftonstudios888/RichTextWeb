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
    assert.deepEqual(errors, []);
    return 5;
  } finally {
    await fixture.close();
  }
}
