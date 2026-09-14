# RichTextWeb.Blazor 0.4.2

Adopts merged and validated shared runtime c833be49d472583b6f56225862e0aa7d201c1da7 from Dockyard PR #5. Fixes concurrent visual teardown, late template imports/creation, callbacks queued before removal and retained cleanup failures. Adds IsReady/IsDisposed, awaitable Razor factory disposal and coalesced parameter updates.

Built on current main f363b825282346367224d357d06f31235e20ebf5, retaining the recently merged native pagination and structural equation changes. Rich-text/page editors, read-only viewers, toolbar, revision-aware binding, InputBase/EditForm, format services and PDF source/flow controls remain intact.

Both .NET 8/.NET 10 actual-package WebAssembly/Server matrices test EditForm notifications, full values, pagination, DOCX/PDF output, PDF transitions, native callbacks and remounting. New managed/JavaScript lifetime regressions and template movement/update/recreation are added. Publication verifies public NuGet payloads before creating package/symbol/sample releases. Underlying native compatibility boundaries remain applicable; no fonts or runtime Dockyard dependency are added.
