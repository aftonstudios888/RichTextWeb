import assert from "node:assert/strict";

/** Public package integrations exercised through the actual sample controls. */
export async function runWorkspaceBrowserChecks(page) {
  const results = [];
  const viewport = page.viewportSize();
  const initial = await page.evaluate(() => ({
    document: richTextStudio.editor.Document.ToJSON(),
    title: document.querySelector("#document-title").value,
    zoom: richTextStudio.editor.Zoom,
    layout: richTextStudio.workspace.Docking.SaveLayout(),
    theme: document.body.classList.contains("dark"),
  }));
  const ribbon = page.locator("#word-ribbon");
  try {
    const integration = await page.evaluate(() => {
      const workspace = richTextStudio.workspace;
      return {
        tabs: workspace.Ribbon.model.tabs.length,
        panes: workspace.Docking.Layout.RootPanel.Children.Count,
        columns: workspace.Grid.Model.Columns.Count,
        cache: typeof workspace.Catalog.connect === "function",
        reactive:
          typeof workspace.ViewModel.RaiseAndSetIfChanged === "function",
        spatial: typeof workspace.SpatialIndex.Knn === "function",
        graph: typeof workspace.GraphViewer.Layout === "function",
      };
    });
    assert(
      integration.tabs >= 9 &&
        integration.panes >= 2 &&
        integration.columns === 3,
    );
    assert(
      integration.cache &&
        integration.reactive &&
        integration.spatial &&
        integration.graph,
    );
    results.push(
      "Published RibbonWeb, Dockyard, TreeDataGridWeb, DynamicDataWeb, ReactiveWeb, RBushWeb and QuikGraphWeb components are instantiated",
    );

    await page.evaluate(() => {
      const { editor, RT } = richTextStudio;
      editor.Document = RT.fromHTML(
        "<h1>Workspace checks</h1><p>Selection survives ribbon commands.</p>",
      );
      editor.IsReadOnly = false;
      editor.Engine.Select(17, 26);
    });
    await ribbon.getByRole("tab", { name: "Home", exact: true }).click();
    await ribbon.locator('button[data-control-id="ToggleBold"]').click();
    const formatted = await page.evaluate(() => ({
      text: richTextStudio.editor.Selection.Text,
      bold: richTextStudio.editor.Selection.GetPropertyValue("FontWeight"),
    }));
    assert.equal(formatted.text, "Selection");
    assert.equal(formatted.bold, "Bold");
    results.push(
      "RibbonWeb formatting preserves the RichTextWeb selection and routes through the reusable toolbar",
    );

    await ribbon.getByRole("tab", { name: "Insert", exact: true }).click();
    await ribbon.locator('button[data-control-id="Table"]').click();
    const dialog = page.locator("#document-command-service dialog[open]");
    await dialog.locator('[name="rows"]').fill("2");
    await dialog.locator('[name="columns"]').fill("2");
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    await page.waitForFunction(() =>
      richTextStudio.RT.toHTML(richTextStudio.editor.Document).includes(
        "<table",
      ),
    );
    results.push(
      "Ribbon Table opens the reusable control dialog and commits an editable model table",
    );

    await page.evaluate(() => richTextStudio.workspace.OpenCatalog("headings"));
    await page.waitForFunction(
      () => richTextStudio.workspace.Grid.Model.Rows.Count === 1,
    );
    await page.locator("#catalog-search").fill("no matching heading");
    await page.waitForFunction(
      () => richTextStudio.workspace.Grid.Model.Rows.Count === 0,
    );
    await page.locator("#catalog-search").fill("Workspace");
    await page.waitForFunction(
      () => richTextStudio.workspace.Grid.Model.Rows.Count === 1,
    );
    assert.equal(
      await page.evaluate(() => richTextStudio.workspace.ViewModel.Filter),
      "Workspace",
    );
    await page.locator("#catalog-search").fill("");
    results.push(
      "ReactiveWeb filter state drives DynamicData cache filtering into the real virtualized TreeDataGrid",
    );

    await page.evaluate(() => {
      const { editor, RT } = richTextStudio;
      editor.Document = RT.fromText("Tracked formatting in the workspace.");
      editor.Engine.TrackChanges = true;
      editor.Engine.Select(0, 7);
      editor.Engine.ApplyProperty("FontStyle", "Italic");
      richTextStudio.workspace.OpenCatalog("revisions");
    });
    await page.waitForFunction(
      () => richTextStudio.workspace.Grid.Model.Rows.Count === 1,
    );
    assert.equal(
      await page.evaluate(() => richTextStudio.editor.Engine.Revisions[0].Kind),
      "Formatting",
    );
    await page.evaluate(() =>
      richTextStudio.workspace.Grid.Model.RowSelection.Select(0),
    );
    await page.locator("#catalog-reject").click();
    assert.equal(
      await page.evaluate(() => richTextStudio.editor.Engine.Revisions.length),
      0,
    );
    assert.notEqual(
      await page.evaluate(() =>
        richTextStudio.editor.Selection.GetPropertyValue("FontStyle"),
      ),
      "Italic",
    );
    results.push(
      "Tracked formatting is inspectable and rejectable from the reusable document explorer grid",
    );

    const docked = await page.evaluate(async () => {
      const { editor, workspace } = richTextStudio;
      editor.Engine.TrackChanges = false;
      const identity = editor;
      workspace.Docking.Find("document").Float();
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const floating = workspace.Docking.Find("document").IsFloating;
      editor.Engine.Select(
        editor.Document.Text.length,
        editor.Document.Text.length,
      );
      editor.Engine.InsertText(" Docked safely.");
      workspace.Docking.Find("document").Dock();
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const preserved =
        document.getElementById("editor") === identity &&
        editor.Document.Text.endsWith(" Docked safely.");
      editor.Engine.Undo();
      return {
        floating,
        preserved,
        undo: !editor.Document.Text.endsWith(" Docked safely."),
      };
    });
    assert(docked.floating && docked.preserved && docked.undo);
    results.push(
      "Dockyard floating and docking preserve the actual rich editor, document text and undo history",
    );

    await page.evaluate(() => {
      const { editor, RT, workspace } = richTextStudio;
      editor.Document = RT.fromHTML(
        "<h1>References</h1><p>Bookmark destination.</p><p>Source field: </p><table><tr><td><p>Indexed table</p></td></tr></table>",
      );
      editor.Engine.Select(11, 19);
      editor.Engine.AddBookmark("destination");
      editor.Engine.Select(45, 45);
      new RT.DocumentFeatures(editor.Engine).InsertField("REF", "destination");
      workspace.Refresh();
    });
    await page.waitForTimeout(60);
    await page.evaluate(() => richTextStudio.workspace.ShowGraph());
    await page.waitForFunction(() =>
      [...richTextStudio.workspace.GraphViewer.Graph.Edges].some(
        (edge) => edge.Tag === "references",
      ),
    );
    await page.evaluate(() => {
      const viewer = richTextStudio.workspace.GraphViewer;
      const edge = [...viewer.Graph.Edges].find(
        (edge) => edge.Tag === "references",
      );
      viewer.SelectVertex(edge.Source);
    });
    await page.locator("#graph-related").click();
    assert(
      (await page.locator("#graph-status").textContent()).includes(
        "related items",
      ),
    );
    results.push(
      "QuikGraph displays actual document-to-bookmark reference edges and executes related-item breadth-first traversal",
    );

    const spatial = await page.evaluate(async () => {
      const { editor, workspace } = richTextStudio;
      editor.ViewMode = "continuous";
      editor.ScrollToHome();
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      workspace.UpdateSpatial();
      const items = workspace.SpatialIndex.Search();
      const first = items[0];
      if (!first) return { count: 0 };
      const envelope = first.Envelope;
      const nearest = workspace.SpatialIndex.Knn(
        1,
        envelope.MinX,
        envelope.MinY,
      )[0];
      return { count: items.length, nearest: nearest.Id === first.Id };
    });
    assert(spatial.count > 0 && spatial.nearest);
    results.push(
      "RBush indexes actual rendered object bounds and answers nearest-object queries",
    );

    await page.evaluate(() => {
      richTextStudio.editor.IsReadOnly = true;
      richTextStudio.workspace.Refresh();
      richTextStudio.workspace.Ribbon.selectTab("home");
    });
    await page.waitForFunction(
      () =>
        document.querySelector("#word-ribbon").getControl("ToggleBold")
          .enabled === false,
    );
    assert(
      await ribbon.locator('button[data-control-id="ToggleBold"]').isDisabled(),
    );
    await page.evaluate(() => richTextStudio.workspace.OpenCatalog("styles"));
    assert(await page.locator("#catalog-apply-style").isDisabled());
    results.push(
      "Read-only state disables mutating ribbon and explorer actions while retaining inspection",
    );
    await page.evaluate(() => {
      document.body.classList.add("dark");
      richTextStudio.workspace.SetTheme("dark");
    });
    assert.equal(
      await page.evaluate(() =>
        getComputedStyle(document.querySelector("#word-ribbon"))
          .getPropertyValue("--rw-surface")
          .trim(),
      ),
      "#282d36",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => richTextStudio.editor.Zoom < 1);
    await page.evaluate(() => richTextStudio.workspace.ShowPane("navigation"));
    await page.waitForFunction(
      () => richTextStudio.workspace.Docking.Find("navigation").IsFloating,
    );
    assert(await page.locator(".navigation").isVisible());
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    assert((await page.evaluate(() => richTextStudio.editor.Zoom)) < 1);
    results.push(
      "Dark theme keeps ribbon tabs legible; mobile layout fits the page and floats tool panes without horizontal page overflow",
    );
  } finally {
    if (viewport) await page.setViewportSize(viewport);
    await page.evaluate((initial) => {
      const { editor, RT, workspace } = richTextStudio;
      editor.IsReadOnly = false;
      editor.Engine.TrackChanges = false;
      editor.Document = RT.FlowDocument.FromJSON(initial.document);
      document.getElementById("document-title").value = initial.title;
      workspace.ViewModel.Filter = "";
      workspace.ViewModel.Catalog = "all";
      workspace.Docking.LoadLayout(initial.layout);
      workspace.Ribbon.selectTab("home");
      editor.ViewMode = "page";
      document.body.classList.toggle("dark", initial.theme);
      workspace.SetTheme(initial.theme ? "dark" : "light");
      workspace.SetZoom(initial.zoom * 100);
      workspace.Refresh();
    }, initial);
  }
  return results;
}
