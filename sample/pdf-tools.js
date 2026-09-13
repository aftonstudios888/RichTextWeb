/** Small PDF workbench using the same public formats API distributed in npm. */
export async function openPDFTools(RT, toast, document) {
  const dialog = window.document.createElement("dialog");
  dialog.style.width = "960px";
  dialog.innerHTML = `<div class="dialog-title"><h2>PDF workspace</h2><button data-close aria-label="Close PDF workspace">×</button></div><p class="note">Add text, highlight areas, and organize pages. Coordinates are PDF points measured from the bottom left of the unrotated page. Added content is an overlay; underlying content stays in the PDF.</p><label class="field">Open a PDF<input data-file type="file" accept="application/pdf,.pdf"></label><div class="pdf-tools"><label class="field">Page<select data-page></select></label><label class="field">Overlay text<input data-text value="Reviewed"></label></div><div class="pdf-tools" style="grid-template-columns:repeat(4,1fr)"><label class="field">X<input data-x type="number" value="50"></label><label class="field">Y<input data-y type="number" value="50"></label><label class="field">Font size<input data-size type="number" value="14" min="1" max="144"></label><label class="field">Color<input data-color type="color" value="#1254a3"></label></div><div class="pdf-tools" style="grid-template-columns:repeat(5,1fr)"><button data-add>Add text</button><button data-highlight>Highlight area</button><button data-rotate>Rotate 90°</button><button data-up>Move page earlier</button><button data-delete>Delete page</button></div><div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px"><span data-status class="note">Preparing PDF…</span><button data-save class="primary">Download PDF</button></div><iframe class="pdf-preview" title="PDF preview"></iframe>`;
  window.document.body.append(dialog);
  dialog.showModal();
  let pdf = null,
    previewURL = null;
  const el = (s) => dialog.querySelector(s),
    page = () => Number(el("[data-page]").value),
    number = (s) => Number(el(s).value);
  const guarded = (fn) => async () => {
    try {
      if (!pdf) throw Error("Open a PDF first.");
      await fn();
      await refresh();
    } catch (e) {
      toast(e.message);
    }
  };
  async function refresh() {
    const bytes = await pdf.Save();
    if (previewURL) URL.revokeObjectURL(previewURL);
    previewURL = URL.createObjectURL(
      new Blob([bytes], { type: "application/pdf" }),
    );
    el("iframe").src = previewURL + "#page=" + (page() + 1);
    const selected = page();
    el("[data-page]").innerHTML = pdf
      .GetPages()
      .map(
        (p) =>
          `<option value="${p.index}">Page ${p.index + 1} · ${Math.round(p.width)} × ${Math.round(p.height)} pt</option>`,
      )
      .join("");
    el("[data-page]").value = String(Math.min(selected, pdf.PageCount - 1));
    el("[data-status]").textContent =
      `${pdf.PageCount} pages · ${Math.round(bytes.length / 1024)} KB`;
  }
  el("[data-close]").onclick = () => dialog.close();
  dialog.onclose = () => {
    if (previewURL) URL.revokeObjectURL(previewURL);
    dialog.remove();
  };
  el("[data-file]").onchange = async () => {
    try {
      const file = el("[data-file]").files[0];
      if (!file) return;
      if (file.size > 25 * 1024 * 1024)
        throw Error("Choose a PDF smaller than 25 MB.");
      pdf = await RT.PDFEditor.Load(await file.arrayBuffer());
      await refresh();
    } catch (e) {
      toast(e.message);
    }
  };
  el("[data-page]").onchange = () => {
    if (previewURL) el("iframe").src = previewURL + "#page=" + (page() + 1);
  };
  el("[data-add]").onclick = guarded(() =>
    pdf.AddText(page(), el("[data-text]").value, {
      x: number("[data-x]"),
      y: number("[data-y]"),
      fontSize: number("[data-size]"),
      color: el("[data-color]").value,
    }),
  );
  el("[data-highlight]").onclick = guarded(() =>
    pdf.Highlight(page(), {
      x: number("[data-x]"),
      y: number("[data-y]"),
      width: 180,
      height: 24,
      color: "#ffff00",
    }),
  );
  el("[data-rotate]").onclick = guarded(() =>
    pdf.RotatePage(page(), (pdf.GetPages()[page()].rotation + 90) % 360),
  );
  el("[data-up]").onclick = guarded(() => {
    const index = page();
    if (index === 0) return;
    const order = pdf.GetPages().map((p) => p.index);
    [order[index], order[index - 1]] = [order[index - 1], order[index]];
    pdf.ReorderPages(order);
    el("[data-page]").value = String(index - 1);
  });
  el("[data-delete]").onclick = guarded(() => pdf.DeletePages([page()]));
  el("[data-save]").onclick = guarded(async () => {
    const bytes = await pdf.Save();
    const url = URL.createObjectURL(
      new Blob([bytes], { type: "application/pdf" }),
    );
    const a = window.document.createElement("a");
    a.href = url;
    a.download = "edited-document.pdf";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast("Edited PDF downloaded");
  });
  try {
    pdf = await RT.PDFEditor.Load(await RT.toPDF(document));
    await refresh();
  } catch (e) {
    el("[data-status]").textContent =
      "Open a PDF to begin. Current document could not be converted.";
    toast(e.message);
  }
}
