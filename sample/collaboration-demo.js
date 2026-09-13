/** Two full control instances share the transport-neutral rich document protocol. */
export function openCollaborationDemo(RT) {
  const dialog = document.createElement("dialog");
  dialog.className = "collaboration-dialog";
  dialog.innerHTML =
    '<div class="dialog-title"><h2>Coauthor a rich document</h2><button data-close>Close</button></div><p class="note">Edit text, tables, pictures, and formatting in both documents. Pause delivery to work independently, then reconnect to merge changes. This local demonstration sends the same operations an application can carry over its authenticated transport.</p><div class="collaboration-actions"><button data-network>Pause delivery</button><button data-checkpoint>Compact acknowledged history</button><span data-status role="status">Connected</span></div><div class="collaboration-peers"></div>';
  const picture = document.createElement("canvas");
  picture.width = 160;
  picture.height = 90;
  const context = picture.getContext("2d");
  context.fillStyle = "#185abd";
  context.fillRect(0, 0, 160, 90);
  context.fillStyle = "white";
  context.beginPath();
  context.arc(38, 45, 23, 0, Math.PI * 2);
  context.fill();
  context.font = "bold 18px sans-serif";
  context.fillText("Shared", 72, 52);
  const sharedPicture = picture.toDataURL("image/png");
  const seed = RT.fromText(
    "A shared document\nEdit this document together. Text, tables, pictures, and document properties can merge while peers are offline.",
  );
  const sessions = ["Ada", "Grace"].map(
    (ActorId) =>
      new RT.CollaborativeDocumentSession({
        DocumentId: "local-rich-demo",
        ActorId,
        Document: seed.ToJSON(),
      }),
  );
  const disposables = [],
    editors = [],
    queue = [];
  let paused = false;
  const status = () => {
    const agrees =
      JSON.stringify(sessions[0].DocumentJSON) ===
      JSON.stringify(sessions[1].DocumentJSON);
    dialog.querySelector("[data-status]").textContent = paused
      ? `Delivery paused · ${queue.length} queued transactions`
      : `Connected · replicas ${agrees ? "agree" : "are synchronizing"} · ${sessions[0].Statistics.Nodes} nodes · ${sessions[0].Statistics.Operations} transactions`;
    dialog.querySelector("[data-checkpoint]").disabled =
      paused || queue.length > 0 || !agrees;
  };
  const execute = (action) => {
    try {
      action();
      status();
    } catch (error) {
      dialog.querySelector("[data-status]").textContent = error.message;
    }
  };
  sessions.forEach((session, index) => {
    const peer = document.createElement("section"),
      label = document.createElement("h3");
    label.textContent = session.ActorId;
    const editor = document.createElement("rich-text-box");
    editor.Document = RT.FlowDocument.FromJSON(seed.ToJSON());
    editor.ViewMode = "continuous";
    editor.setAttribute("aria-label", `${session.ActorId}'s document`);
    editors.push(editor);
    const toolbar = document.createElement("rich-text-toolbar");
    toolbar.Editor = editor;
    toolbar.Mode = "all";
    const scenarios = document.createElement("div");
    scenarios.className = "collaboration-actions";
    for (const [label, action] of [
      [
        "Add paragraph",
        () =>
          editor.Engine.Change(() => {
            editor.Document.Blocks.Add(
              new RT.Paragraph(
                new RT.Run(`${session.ActorId} added a paragraph.`),
              ),
            );
          }),
      ],
      [
        "Add table",
        () => {
          editor.Engine.Select(editor.Document.Text.length);
          editor.Engine.InsertTable(2, 2);
        },
      ],
      [
        "Add picture",
        () => {
          editor.Engine.Select(editor.Document.Text.length);
          editor.Engine.InsertImage(
            sharedPicture,
            `${session.ActorId}'s shared picture`,
            160,
            90,
          );
        },
      ],
      [
        "Format title",
        () => {
          editor.Engine.Select(0, "A shared document".length);
          editor.Engine.ApplyProperty("FontWeight", "Bold");
          editor.Engine.ApplyProperty(
            "Foreground",
            index ? "#7c3aed" : "#185abd",
          );
        },
      ],
    ]) {
      const button = document.createElement("button");
      button.textContent = label;
      button.onclick = () => execute(action);
      scenarios.append(button);
    }
    peer.append(label, toolbar, scenarios, editor);
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
  dialog.querySelector("[data-network]").onclick = () =>
    execute(() => {
      paused = !paused;
      if (!paused)
        for (const [index, operation] of queue.splice(0).reverse())
          sessions[index].Receive(operation);
      dialog.querySelector("[data-network]").textContent = paused
        ? "Reconnect and merge"
        : "Pause delivery";
    });
  dialog.querySelector("[data-checkpoint]").onclick = () =>
    execute(() => {
      const acknowledgements = Object.fromEntries(
        sessions.map((session) => [session.ActorId, session.VersionVector]),
      );
      const checkpoint = sessions[0].CreateCheckpoint(acknowledgements);
      sessions.forEach((session) => session.AdoptCheckpoint(checkpoint));
    });
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
  status();
}
