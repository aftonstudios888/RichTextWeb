/** Two local peers demonstrate the reusable transport-neutral collaboration API. */
export function openCollaborationDemo(RT) {
  const dialog = document.createElement("dialog");
  dialog.className = "collaboration-dialog";
  dialog.innerHTML =
    '<div class="dialog-title"><h2>Collaborative editing</h2><button data-close>Close</button></div><p class="note">Two local replicas exchange character operations. Pause delivery, edit both documents, then reconnect to test concurrent changes. Your application supplies authentication, persistence, and the network transport.</p><div class="collaboration-actions"><button data-network>Pause delivery</button><span data-status role="status">Connected · local demonstration</span></div><div class="collaboration-peers"></div>';
  const text =
    "A shared document\nEdit this text from either peer. Changes merge through the reusable engine.";
  const sessions = ["Ada", "Grace"].map(
    (ActorId) =>
      new RT.CollaborativeTextSession({
        DocumentId: "local-demo",
        ActorId,
        Text: text,
      }),
  );
  const disposables = [],
    editors = [],
    queue = [];
  let paused = false;
  const status = () =>
    (dialog.querySelector("[data-status]").textContent = paused
      ? `Delivery paused · ${queue.length} queued operations`
      : `Connected · replicas ${sessions[0].Text === sessions[1].Text ? "agree" : "are synchronizing"}`);
  sessions.forEach((session, index) => {
    const peer = document.createElement("section");
    const label = document.createElement("h3");
    label.textContent = session.ActorId;
    const editor = document.createElement("rich-text-box");
    editor.Document = RT.fromText(text);
    editor.ViewMode = "continuous";
    editor.setAttribute("aria-label", `${session.ActorId}'s document`);
    editors.push(editor);
    const toolbar = document.createElement("rich-text-toolbar");
    toolbar.Editor = editor;
    toolbar.Mode = "home";
    peer.append(label, toolbar, editor);
    dialog.querySelector(".collaboration-peers").append(peer);
    disposables.push(session.BindEngine(editor.Engine));
    disposables.push(
      session.OperationGenerated.Subscribe((operation) => {
        if (paused) queue.push([1 - index, operation]);
        else sessions[1 - index].Receive(operation);
        status();
      }),
    );
    disposables.push(
      session.Conflict.Subscribe((event) => {
        dialog.querySelector("[data-status]").textContent = event.Error.message;
      }),
    );
  });
  dialog.querySelector("[data-network]").onclick = () => {
    paused = !paused;
    if (!paused) {
      for (const [index, operation] of queue.splice(0).reverse())
        sessions[index].Receive(operation);
    }
    dialog.querySelector("[data-network]").textContent = paused
      ? "Reconnect and merge"
      : "Pause delivery";
    status();
  };
  dialog.querySelector("[data-close]").onclick = () => dialog.close();
  dialog.onclose = () => {
    disposables.forEach((item) => item.Dispose());
    dialog
      .querySelectorAll("rich-text-toolbar")
      .forEach((toolbar) => toolbar.Dispose());
    editors.forEach((editor) => editor.Dispose());
    dialog.remove();
  };
  document.body.append(dialog);
  dialog.showModal();
  dialog.sessions = sessions;
  dialog.editors = editors;
}
