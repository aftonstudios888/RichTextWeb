# RichTextWeb.Blazor

Self-contained .NET 8 / .NET 10 components for the actual RichTextWeb engine: rich-text editing, measured pagination, read-only flow viewers, native toolbar, EditForm integration, document formats and PDF workspace. Browser scripts, the local PDF.js worker/decoders, licenses and XML API documentation ship in the NuGet package. Consumers need no npm or CDN.

```sh
dotnet add package RichTextWeb.Blazor --version 0.4.0
```

## Two-way editing and forms

```razor
@using RichTextWeb.Blazor
<RichTextEditor @bind-Value="html" ValueFormat="html" Theme="light" />
@code { private string? html = "<p>Hello from Blazor.</p>"; }
```

```razor
@using Microsoft.AspNetCore.Components.Forms
<EditForm Model="model" OnValidSubmit="Save" FormName="document">
    <DataAnnotationsValidator />
    <RichTextInput @ref="input" @bind-Value="model.Body" ControlKind="pageEditor" />
    <ValidationMessage For="@(() => model.Body)" />
    <button type="submit">Save</button>
</EditForm>
```

`RichTextInput` derives from the standard InputBase implementation and participates in EditContext field changes, validation CSS and `@bind-Value`. Its default debounce is zero. `RichTextEditor` defaults to 150 ms. Before a form/application action that needs the latest browser edits, await `input.FlushAsync()` or `editor.FlushChangesAsync()`; use `EditForm.OnSubmit` to flush before calling `EditContext.Validate()` when debouncing is enabled. A `[Required]` string validator validates serialized content, not semantic text emptiness; use an application validator for empty HTML paragraphs or document-specific rules.

Value formats are `html`, `text`, `json`, `rtf`, `markdown` and `xaml`. HTML and other import safety/compatibility semantics are those of the native format handlers. `ValueRevision` explicitly forces an external reload even when the string is unchanged. Replacing Value updates the document; acknowledgments of older browser revisions do not overwrite newer unacknowledged edits. Ordinary parent renders and echoed values do not reset selection/history. Value-change events carry only a revision, then the C# wrapper reads the complete value explicitly: document strings are not truncated by bounded generic event snapshots. For very large Server documents configure appropriate SignalR limits or use application-level persistence/streaming rather than repeatedly transferring full serialized documents.

`Document` optionally accepts a native FlowDocument reference instead of a value string. JSON transfer does not create shared CLR/JavaScript identity. Do not mutate a browser-owned document through an unrelated CLR DTO and expect implicit synchronization.

## Controls, toolbar and pagination

`RichTextEditor.ControlKind` selects `editor`, `pageEditor`, `reader`, `scrollViewer` or `pageViewer`. Changing it recreates the native presentation while preserving document data; this intentionally resets presentation-specific undo/selection state. Separate `RichTextPageEditor`, `FlowDocumentReader`, `FlowDocumentScrollViewer` and `FlowDocumentPageViewer` components provide the native control families directly. Viewer components enforce read-only behavior. The scroll viewer enforces continuous mode and the page viewer measured page mode.

Parameters include Theme, ShowToolbar, ToolbarMode, IsReadOnly, AcceptsTab, Zoom, ViewMode, EnableVirtualization, VirtualizationThreshold, VirtualizationOverscan, Placeholder and AriaLabel. `Options` applies additional native properties. Replace nested option references or increment `Revision` after in-place mutations. `Style`, `Class` and unmatched attributes configure the Blazor host; `AriaLabel` labels the actual native editor. The native toolbar remains browser-owned and exposes the engine's formatting, structure, layout and review commands without routing every operation through a Server round-trip.

Common methods cover focus/selection, text insertion, undo/redo, native command execution, document/engine references, measured pagination and page navigation. `Changed` forwards compact document, selection, command-state, page and object notifications; `Events` selects optional notifications without disabling the required value-binding channel. `RepaginateAsync` applies to a visible, connected page editor/viewer in page mode. Native layout/font/browser limitations remain those documented by the core project; the wrapper does not claim Word-identical pagination beyond existing engine qualification.

## Formats and engine services

`ExportBytesAsync` and `ImportBytesAsync` support native DOCX/PDF and UTF-8 text/HTML/JSON/RTF/Markdown/XAML operations. Import parses before replacing the document and rejects an asynchronous result when the document changed while it was loading. Native format compatibility and unsupported-content reports are preserved; this wrapper does not silently declare arbitrary documents lossless. The PDF optional namespace is bundled under `Pdf`.

`RichTextModule` includes text/HTML/DOCX factories and DOCX/PDF export helpers. `RichTextProvider` is a lifecycle owner with `RenderFragment<BrowserModule>` content for nonvisual operations. `BrowserModule` exposes every bundled native export through `GetExportsAsync`, `CreateAsync`, `InvokeAsync`, `CallAsync`, `GetAsync`, `SetAsync`, `SubscribeAsync` and `ReleaseAsync`. This includes model classes, selections, commands, document features, collaboration and history APIs. `GetNativeEditorAsync`, `GetDocumentAsync` and `GetEngineAsync` return actual native references, not JSON copies.

The typed convenience API is not an exhaustive generated strongly typed C# port of every native model/property. All remaining native methods can be invoked through `InvokeAsync<T>` / `InvokeVoidAsync` or BrowserModule. `BrowserFunction.Property`, Setter, Constant and `Module("./callbacks.js", "callback")` create synchronous browser functions without eval. DotNet descriptors are asynchronous and only valid for promise-aware APIs; synchronous native factories, converters, cancellation and layout callbacks cannot synchronously call a Server circuit. Collaboration still requires the application's configured backend/transport and inherits the core collaboration semantics; installing a wrapper does not provision a collaboration server.

## PDF workspace

`PdfEditor` wraps the actual native PDF control with its toolbar, page viewing, annotations, history, search, original-text tools and reconstructed-flow mode. Load `Source` bytes declaratively (increment SourceRevision after modifying an array in place), or call `LoadAsync`. Typed methods cover save, search, info, adding/inserting pages, undo/redo, fit-width, importing reconstructed flow and exporting that flow. Generic native interop reaches all remaining PDF methods and engine properties.

PDF export from a flow document creates a new PDF. Reconstructed-flow editing does not preserve arbitrary original PDF operators/layout. Native original-text editing retains its documented scope and constraints. A cover/white rectangle is an overlay, **not secure redaction**; it must not be used as evidence that underlying content has been removed. Verify sensitive-document processing with an appropriate independently validated workflow.

The package supplies a local PDF.js worker, character maps, image decoder WASM and color profiles. It does not include or implicitly download font binaries. Embedded document fonts and available system fonts are handled by the native PDF engine; applications requiring deterministic additional fonts must provide their own licensed font assets/configuration. Browser PDF support and fidelity are not universal or certified by the wrapper.

## Hosting and ownership

Use interactive WebAssembly or Interactive Server render modes. Static prerender emits inert hosts without JavaScript calls. Local `_content/RichTextWeb.Blazor` asset URLs follow the application base URI, including non-root deployments. Serve JavaScript/WASM with appropriate MIME types and deploy the worker/decoder directories. Clipboard, file, printing and permission-sensitive actions retain browser user-activation/security requirements.

Components own native DOM, listeners, toolbar/editor resources and .NET callback references and dispose them on unmount, including disconnected Server circuits. Do not place Blazor child nodes inside the native editable subtree. Use per-component/per-circuit modules, never Server application singletons. Constructor-created objects are session-owned; native factory results and externally supplied model references require explicit owner-managed lifetime. `IJSObjectReference.DisposeAsync` releases the interop handle; `ReleaseAsync` additionally invokes native disposal. Do not dispose an external document/engine while a control uses it.

Generic notifications are bounded snapshots that omit private backing graphs and may contain `$reference` or `$truncated` markers. Explicit document values and format bytes are read through non-snapshot methods. Typed form binding therefore never accepts a truncated generic event as document content.

## Source builds, samples and qualification

```sh
git submodule update --init --recursive
npm ci
npm run build
node blazor/build.mjs
dotnet run --project blazor/sample/Sample.csproj
dotnet run --project blazor/server/Server.csproj --urls http://localhost:5080
# Interactive Server: http://localhost:5080/probe/
```

The common lifecycle code, project/host templates and tests are generated from a commit-pinned source submodule. Project-specific components, adapters and sample are reviewed files here; generated files are ignored and recreated before builds. The resulting NuGet package has no Dockyard NuGet or GitHub runtime dependency.

CI packs both frameworks, inspects the actual nupkg, runs bridge and managed lifecycle/prerender tests, restores both sample hosts from that package and drives them in Chromium. The sample exercises a paginated EditForm input, real two-way field notifications, a read-only viewer, measured pagination, native DOCX/PDF export, local PDF loading/search/save and repeated unmount/remount. Packages, published samples and browser diagnostics are retained. This does not establish all-browser, physical-device or native desktop qualification.

## Releases

NuGet versions are independent of npm in `blazor/Version.props`. A version-changing PR merged to main publishes only after both validation matrices pass, using `NUGET_API_KEY` (fallback `NUGET_TOKEN` or `NUGET_KEY`). Manual dispatch defaults to validation-only. `blazor-v<version>` releases attach packages and the runnable WebAssembly sample without changing npm release tags. Update the shared source submodule and reusable workflow SHA together through reviewed PRs.
