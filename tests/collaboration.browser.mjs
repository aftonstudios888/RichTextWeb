import assert from "node:assert/strict";

/** Works against the sample and its reusable full-document coauthoring dialog. */
export async function runRichCollaborationBrowserChecks(page) {
  const results = [];
  await page.evaluate(() => richTextStudio.run("collaboration-demo"));
  const dialog = page.locator(".collaboration-dialog");
  await dialog.locator("[data-network]").click();
  await dialog
    .getByRole("button", { name: "Add table", exact: true })
    .nth(0)
    .click();
  await dialog
    .getByRole("button", { name: "Add picture", exact: true })
    .nth(1)
    .click();
  await dialog
    .getByRole("button", { name: "Add paragraph", exact: true })
    .nth(0)
    .click();
  await page.evaluate(() => {
    const dialog = document.querySelector(".collaboration-dialog");
    dialog.editors[0].Engine.Select(0);
    dialog.editors[0].Engine.InsertText("Ada: ");
    dialog.editors[1].Engine.Select(0);
    dialog.editors[1].Engine.InsertText("Grace: ");
  });
  await dialog.locator("[data-network]").click();
  const merged = await page.evaluate(() => {
    const dialog = document.querySelector(".collaboration-dialog"),
      documents = dialog.editors.map((editor) => editor.Document.ToJSON());
    return {
      documents,
      text: dialog.editors[0].Document.Text,
      statistics: dialog.sessions.map((session) => session.Statistics),
      status: dialog.querySelector("[data-status]").textContent,
      images: dialog.editors.map((editor) =>
        [...editor.shadowRoot.querySelectorAll("img")].map((img) => ({
          src: img.src,
          width: img.naturalWidth,
        })),
      ),
    };
  });
  assert.deepEqual(merged.documents[0], merged.documents[1]);
  assert(merged.text.includes("Ada: ") && merged.text.includes("Grace: "));
  assert(merged.documents[0].children.some((node) => node.type === "Table"));
  assert(
    merged.images.every(
      (images) =>
        images.length > 0 && images[0].src.startsWith("data:image/png"),
    ),
  );
  assert.match(merged.status, /replicas agree/);
  results.push(
    "Full rich controls converge after offline text, paragraph, table, and PNG insertion with reversed delivery",
  );
  await dialog
    .getByRole("button", { name: "Format title", exact: true })
    .nth(0)
    .click();
  const formatted = await page.evaluate(() =>
    document
      .querySelector(".collaboration-dialog")
      .editors.map((editor) => editor.Document.ToJSON()),
  );
  assert.deepEqual(formatted[0], formatted[1]);
  results.push(
    "Reusable rich control formatting propagates through the full-document binding",
  );
  await dialog.locator("[data-checkpoint]").click();
  const compacted = await page.evaluate(() =>
    document.querySelector(".collaboration-dialog").sessions.map((session) => ({
      Epoch: session.Epoch,
      Statistics: session.Statistics,
    })),
  );
  assert.equal(compacted[0].Epoch, compacted[1].Epoch);
  assert(compacted[0].Epoch.startsWith("checkpoint-"));
  assert(compacted.every((item) => item.Statistics.Operations === 0));
  results.push(
    "Acknowledged collaboration checkpoint compacts both live peers without losing document content",
  );
  await dialog.locator("[data-close]").click();
  return results;
}
