import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/** Runs against the hosted sample, including the separately bundled optional PDF control. */
export async function runPDFBrowserChecks(page) {
  const results = [];
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.locator('[data-command="pdf-tools"]').click();
  await page.waitForFunction(() =>
    document
      .querySelector("rich-pdf-editor")
      ?.shadowRoot?.querySelector(".textLayer span"),
  );
  const control = page.locator("rich-pdf-editor");
  await control
    .locator('[data-file="open"]')
    .setInputFiles("tests/fixtures/pdf-import-source.pdf");
  await page.waitForFunction(() => {
    const pdf = document.querySelector("rich-pdf-editor");
    return (
      pdf?.PageCount === 3 &&
      pdf.shadowRoot
        .querySelector(".status")
        ?.textContent.startsWith("3 pages loaded")
    );
  });
  const rendered = await control.evaluate((element) => {
    const canvas = element.shadowRoot.querySelector("canvas");
    const spans = [...element.shadowRoot.querySelectorAll(".textLayer span")];
    const span = spans.find((span) => span.textContent.includes("Independent"));
    const range = document.createRange();
    range.selectNodeContents(span);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const text = selection.toString();
    selection.removeAllRanges();
    const data = canvas
      .getContext("2d")
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0;
    for (let index = 0; index < data.length; index += 64)
      if (data[index] < 210 && data[index + 3]) ink++;
    return { text, ink, width: canvas.width, spans: spans.length };
  });
  assert.match(rendered.text, /Independent PDF source/);
  assert.ok(rendered.ink > 30 && rendered.spans >= 8 && rendered.width > 500);
  results.push(
    "Reusable PDF control opens independent PDF with rendered canvas and selectable text",
  );

  await control.locator('[data-input="find"]').fill("Left column");
  await control.locator('[data-command="find"]').click();
  await page.waitForFunction(
    () =>
      document
        .querySelector("rich-pdf-editor")
        .shadowRoot.querySelector('[data-label="matches"]').textContent ===
      "1 / 3",
  );
  assert.equal(await control.locator(".search-hit").count(), 3);
  await control.locator('[data-command="find-next"]').click();
  assert.equal(
    await control.locator('[data-label="matches"]').textContent(),
    "2 / 3",
  );
  results.push(
    "PDF search navigates actual extracted text and highlights matching lines",
  );

  await control.locator('[data-input="text"]').fill("Browser overlay");
  await control.locator('[data-tool="text"]').click();
  const bounds = await control.locator(".page").boundingBox();
  await page.mouse.click(bounds.x + 260, bounds.y + 180);
  await page.waitForFunction(
    () => document.querySelector("rich-pdf-editor")?.CanUndo,
  );
  let found = await control.evaluate(
    async (element) => (await element.Find("Browser overlay")).length,
  );
  assert.equal(found, 1);
  await control.locator('[data-command="undo"]').click();
  await page.waitForFunction(
    () => document.querySelector("rich-pdf-editor")?.CanRedo,
  );
  found = await control.evaluate(
    async (element) => (await element.Find("Browser overlay")).length,
  );
  assert.equal(found, 0);
  await control.locator('[data-command="redo"]').click();
  await page.waitForFunction(
    () => document.querySelector("rich-pdf-editor")?.CanUndo,
  );
  assert.equal(
    await control.evaluate(
      async (element) => (await element.Find("Browser overlay")).length,
    ),
    1,
  );
  results.push("PDF pointer text overlays participate in real undo and redo");

  await control.locator('[data-command="rotate"]').click();
  await page.waitForFunction(
    () =>
      document.querySelector("rich-pdf-editor")?.Engine?.GetPages()[0]
        .rotation === 90,
  );
  await control.evaluate((element) => element.Undo());
  assert.equal(
    await control.evaluate((element) => element.Engine.GetPages()[0].rotation),
    0,
  );
  await control.evaluate((element) => element.AddPage(320, 420));
  assert.equal(await control.evaluate((element) => element.PageCount), 4);
  await control.evaluate((element) => element.DeletePages([3]));
  assert.equal(await control.evaluate((element) => element.PageCount), 3);
  results.push(
    "PDF page rotation and page organization preserve editable source state",
  );

  const fontBytes = [...(await readFile("tests/fixtures/pdf-test-font.ttf"))];
  await control.evaluate((element, font) => {
    element.ReflowExportOptions = { fontBytes: new Uint8Array(font) };
  }, fontBytes);
  await control.locator('[data-command="reflow"]').click();
  await page.waitForFunction(
    () => document.querySelector("rich-pdf-editor")?.ViewMode === "flow",
  );
  assert.match(
    await control.evaluate((element) => element.FlowDocument.Text),
    /Łódź/,
  );
  await control.evaluate((element) => {
    const editor = element.shadowRoot.querySelector("rich-text-box");
    editor.Focus();
    editor.Engine.Select(0, 0);
  });
  await page.keyboard.insertText("Browser reflow edit. ");
  await page.waitForFunction(() =>
    document
      .querySelector("rich-pdf-editor")
      .FlowDocument.Text.startsWith("Browser reflow edit."),
  );
  const pending = page.waitForEvent("download");
  await control.locator('[data-command="save"]').click();
  const download = await pending;
  assert.equal(download.suggestedFilename(), "reconstructed-flow.pdf");
  const bytes = [...(await readFile(await download.path()))];
  const extracted = await page.evaluate(async (bytes) => {
    const PDF = await import(
      new URL("./richtextweb.pdf.js", location.href).href
    );
    return (await PDF.fromPDF(new Uint8Array(bytes))).Text;
  }, bytes);
  assert.match(extracted, /Browser reflow edit/);
  assert.match(extracted, /Łódź/);
  results.push(
    "Independent PDF text becomes editable flow and downloads a reflowed Unicode PDF",
  );
  await page.locator(".pdf-workspace-dialog [data-close]").click();
  return results;
}
