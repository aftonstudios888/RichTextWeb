# RichTextWeb.Blazor 0.4.1

Updates the pinned shared runtime to tested Dockyard revision `1c895b7184451071e1c7131063249d2d9eb145b9`, with no Dockyard runtime dependency.

- Preserve cyclic/deep native arguments and shared callback identity without mutating inputs.
- Await concurrent native/module/subscription cleanup and asynchronous unsubscribe, continuing teardown after individual failures.
- Preserve property/method/disposal access through callable references and add `CallFunctionJsonAsync<T>` for complete streamed results.
- Honor initialization-wait cancellation independently for each caller and prevent late native work after disposal.
- Exercise expanded shared JavaScript and managed regressions in both package-consumer matrices.

Rich-text/page editors, read-only viewers, native toolbar, revision-aware two-way binding, InputBase/EditForm, document formats, native PDF source/flow modes and full-value streaming remain available. .NET 8/.NET 10 WebAssembly/Server tests verify EditForm modifications, pagination, DOCX/PDF output, PDF search/view transitions and remounting before publication. Public NuGet payloads are verified before creating the release. Native document/pagination/PDF/collaboration limits remain unchanged; no fonts are implicitly downloaded.
