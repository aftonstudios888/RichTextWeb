# Native .NET hosts

These source adapters embed the **same JavaScript RichTextWeb engine** in WPF, WinUI or Avalonia applications. `Shared/RichTextDocumentClient.cs` provides asynchronous command calls and `INotifyPropertyChanged` state. No separate C# layout engine is supplied.

| Folder     | Contents                                                                          | Required application dependency  |
| ---------- | --------------------------------------------------------------------------------- | -------------------------------- |
| `Shared`   | Standalone .NET 8 project, JSON request client, cancellation and timeout handling | .NET 8+                          |
| `WebView2` | Navigation-restricted WebView2 message transport                                  | Microsoft.Web.WebView2 SDK       |
| `Wpf`      | Existing WPF WebView2 control attachment helper                                   | WPF, Microsoft.Web.WebView2      |
| `WinUI`    | Existing WinUI WebView2 control attachment helper                                 | Windows App SDK                  |
| `Avalonia` | NativeWebView transport and attachment helper                                     | Avalonia NativeWebView component |
| `web`      | `editor.html` with JS bridge initialization                                       | Built RichTextWeb `dist/` assets |

Version 0.2 adds real projects with pinned dependencies in `Directory.Build.props`, an executable C# protocol suite, native package creation, a runnable WPF sample and Windows WebView2 smoke qualification. Reference the appropriate project directly or use the NuGet artifacts produced by the Desktop qualification workflow. Public nuget.org publication requires a separate publishing configuration and is not performed by this workflow.

The local .NET 8 SDK compiled the shared client, WPF host, WPF smoke application and Avalonia host. Seven C# protocol checks passed, including a live C# process exchanging requests and events with the actual JavaScript engine in Node. Windows UI execution is handled by the Windows workflow; the Linux workspace cannot execute the WPF application. A passing Windows job records the WebView2 version, assertions and a rendered screenshot. WinUI/Avalonia UI runtime, physical keyboard/IME, screen readers and physical GPU qualification remain separate application-level checks.

## Prepare the assets

From the repository root:

```sh
npm ci
npm run build
node adapters/dotnet/scripts/prepare-assets.mjs native-assets
```

For WPF/WinUI, include `native-assets` with the application and point `ConnectAsync` at its absolute path. The helper maps this directory to `https://richtextweb.local`, loading the standalone browser bundle without a network service or unresolved npm imports. For Avalonia, serve the directory from a local HTTP server owned by the application, or use a trusted HTTPS deployment whose source and lifecycle you control.

## WPF

Add a WPF WebView2 control to a loaded window and reference `Wpf/RichTextWeb.Wpf.csproj`. It references the shared bridge project and includes the common WebView2 transport. The sample in `Samples/WpfSmoke` is both a runnable editor host and a self-checking CI executable.

```csharp
// Keep the client as a field and dispose it when the window closes.
_client = await WpfRichTextHost.ConnectAsync(EditorWebView, assetsDirectory);
_client.ProtocolError += error => ErrorMessage = error.Message;
await _client.WaitUntilReadyAsync();
await _client.InsertTextAsync("Hello from WPF");
await _client.SelectAsync(0, 5);
await _client.ExecuteAsync("ToggleBold");
DataContext = _client; // Revision, CanUndo, CanRedo, Document notifications
```

The WebView2 helper is based on the documented [`EnsureCoreWebView2Async`, virtual hosts and WebView2 messaging APIs](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/communicate-btwn-web-native). Install the required WebView2 runtime with the application's deployment prerequisites. The application controls its WebView lifetime; disposing the bridge detaches handlers and cancels pending requests but does not dispose the supplied visual control.

## WinUI

Reference `WinUI/RichTextWeb.WinUI.csproj`. After the `Microsoft.UI.Xaml.Controls.WebView2` control is loaded:

```csharp
_client = await WinUiRichTextHost.ConnectAsync(EditorWebView, assetsDirectory);
await _client.WaitUntilReadyAsync();
await _client.InsertTextAsync("Hello from WinUI");
```

The Windows App SDK provides the WebView2 control; see the [official WinUI WebView2 guide](https://learn.microsoft.com/en-us/microsoft-edge/webview2/get-started/winui). Use the application UI thread for attachment, client commands and disposal.

## Avalonia

Reference `Avalonia/RichTextWeb.Avalonia.csproj`. Its pinned official `Avalonia.Controls.WebView` package requires an Avalonia Accelerate license to run; this repository does not provide or bypass that license. Attach before navigating:

```csharp
_client = AvaloniaRichTextHost.Connect(EditorWebView,
    new Uri("http://127.0.0.1:51234/editor.html"));
await _client.WaitUntilReadyAsync();
await _client.InsertTextAsync("Hello from Avalonia");
```

The host uses `NativeWebView.InvokeScript` for requests and `WebMessageReceived` / `invokeCSharpAction` for replies. The corresponding [official NativeWebView API](https://docs.avaloniaui.net/controls/web/nativewebview) describes the platform-specific runtime prerequisites. Linux/macOS/Windows support and component availability depend on the installed Avalonia WebView distribution. This repository does not supply those native runtimes or commercial component licenses.

## Build, test and package

From the repository root, with .NET 8 and Node.js installed:

```sh
npm ci
npm run build
dotnet run --project adapters/dotnet/Tests/RichTextWeb.Bridge.Tests.csproj -c Release
dotnet build adapters/dotnet/Wpf/RichTextWeb.Wpf.csproj -c Release
dotnet build adapters/dotnet/Avalonia/RichTextWeb.Avalonia.csproj -c Release
dotnet pack adapters/dotnet/Shared/RichTextWeb.Bridge.csproj -c Release -o artifacts/desktop/packages
```

The C# tests exercise out-of-order response correlation, remote errors, malformed responses, timeout/cancellation, disposal, MVVM events, hostile envelopes and real Node engine editing/undo/redo/formatting/revision conflict handling. They run without external test-framework packages.

On Windows, use the Visual Studio Developer Shell to build WinUI with `msbuild adapters/dotnet/WinUI/RichTextWeb.WinUI.csproj /restore /t:Build /p:Configuration=Release /p:Platform=x64`. Windows App SDK packaging tasks require the Visual Studio Windows application build tools; the Linux SDK can compile the facade but cannot complete those packaging tasks. This facade contains no XAML or PRI resources; the consuming application generates its own resources. The project uses Windows App SDK types directly.

To run the native WPF editor or its automatic checks:

```sh
node adapters/dotnet/scripts/prepare-assets.mjs artifacts/desktop/web
dotnet run --project adapters/dotnet/Samples/WpfSmoke/RichTextWeb.WpfSmoke.csproj -c Release -- --assets artifacts/desktop/web
# Windows CI smoke: adds command assertions, captures PNG/JSON, then exits.
dotnet run --project adapters/dotnet/Samples/WpfSmoke/RichTextWeb.WpfSmoke.csproj -c Release -- --smoke --assets artifacts/desktop/web --report artifacts/desktop/smoke
```

The [Desktop qualification workflow](../../.github/workflows/desktop.yml) is reusable from the main release pipeline and can also be dispatched manually. Its Linux job runs the actual C# test program and builds/packages Avalonia. Its Windows job builds WPF and WinUI, installs WebView2 when necessary, runs the real WPF host and packages the runnable sample. Missing WebView2 or failed smoke assertions fail the job; they do not count as skipped passes. Artifacts contain `.nupkg`/`.snupkg` files, the sample, standalone web assets, the smoke JSON and the screenshot. The Windows smoke covers programmatic native messages and browser rendering, not physical input devices or a complete desktop accessibility audit.

Pinned dependency versions are WebView2 1.0.3537.50, Windows App SDK 1.7.260224002, Avalonia 11.3.9 and Avalonia.Controls.WebView 11.3.16. Updating them should rerun desktop qualification.

## Fields, stories, notes, review and mail merge

`DocumentFeatureAsync` exposes the shared document feature layer through validated JSON, without injecting scripts:

```csharp
await _client.DocumentFeatureAsync("InsertField", new { type = "MERGEFIELD", argument = "Name" });
await _client.DocumentFeatureAsync("UpdateFields", new {
    context = new { Data = new { Name = "Ada" }, PageNumber = 1, PageCount = 3,
        Now = "2026-09-13T12:00:00Z" }
});
var documents = await _client.DocumentFeatureAsync("MailMerge", new {
    records = new[] { new { Name = "Ada" }, new { Name = "Lin" } }
});
var note = await _client.DocumentFeatureAsync("InsertNote", new { kind = "Footnote", content = "Review note" });
await _client.DocumentFeatureAsync("UpdateNote", new {
    kind = "Footnote", id = note.GetProperty("id").GetString(), content = "Updated note"
});
await _client.ExecuteAsync("CurrentAuthor", "Document reviewer");
await _client.ExecuteAsync("TrackChanges", true);
var review = await _client.GetReviewStateAsync();
```

Other supported feature operations are `SetStory`, `InsertTableOfContents` and `UpdateTableOfContents`; their argument names are listed in the [protocol reference](../../docs/INTEGRATION.md). Supply `expectedRevision` to the C# wrapper when a command depends on a previously read version. Mutations obey the host's read-only policy. Mail merge creates independent JSON documents and permits read-only template export; it is bounded to 1,000 records and the bridge's output budget. `PageMap` provides page numbers by node ID and `Now` carries an ISO date/time string; native callers never pass executable JavaScript resolvers.

## Documents, threading and lifecycle

`GetDocumentAsync` returns a `JsonElement` snapshot of the canonical flow-document tree. `SetDocumentAsync(document, expectedRevision)` optionally rejects an update made against an older revision. Set-document replacement resets the JavaScript engine's undo history. `SelectAsync`, `InsertTextAsync`, `ApplyPropertyValueAsync`, `ExecuteAsync`, `UndoAsync` and `RedoAsync` forward to the same editing operations used by browser controls. `InvokeAsync` exposes every supported protocol method.

The native host page enables full document snapshots in change events, so the client's `Document` property updates for MVVM consumers. For large documents disable `includeDocumentInEvents` in `editor.html`, use revision notifications, and fetch snapshots when required. Selection events remain available through `EventReceived`. Explicitly catch rejected requests, including `RichTextBridgeException` with `Code == "revision_conflict"`, and preserve the user's intended update before resolving conflicts.

Create the client on the UI thread. Notifications marshal back to the captured synchronization context when one exists. The supplied WebView APIs require commands on their UI thread; the client does not dispatch arbitrary cross-thread WebView operations. Call `Dispose()` before destroying the view to detach listeners and cancel pending work. Recreate the client/transport if you reload the page or change its trusted document URL.

Navigation is restricted to the configured editor URL. WebView2 also checks each incoming message's source URI. Avalonia's callback lacks an equivalent source field, so its transport relies on the locked top-level document. Do not add arbitrary scripts or untrusted subframes to the privileged host page. Document imports render through the library's safe conversion path.

The bridge uses UTF-16 plain-text offsets. They are not WPF `TextPointer` symbol positions. Native WPF/WinUI/Avalonia visual trees, platform-specific text services, Word's COM object model and binary document compatibility require application migration work beyond this adapter.
