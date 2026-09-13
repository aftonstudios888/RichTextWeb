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

The shared project can be referenced with `ProjectReference` or its source included directly. Compile the transport and appropriate framework helper source in the host application, which owns the framework dependency versions. The TypeScript bridge is tested in Node; native C# compilation, WebView runtime packaging, native accessibility integration and physical platform testing were **not performed** in the build workspace. The framework helpers are source integrations, not published or qualified native NuGet controls.

## Prepare the assets

From the repository root:

```sh
npm ci
npm run build
mkdir -p native-assets
cp adapters/dotnet/web/editor.html native-assets/editor.html
cp -R dist native-assets/dist
```

For WPF/WinUI, include `native-assets` with the application and point `ConnectAsync` at its absolute path. The helper maps this directory to `https://richtextweb.local`, allowing local ESM imports without a network service. For Avalonia, serve the directory from a local HTTP server owned by the application, or use a trusted HTTPS deployment whose source and lifecycle you control.

## WPF

Add a WPF WebView2 control to a loaded window. Reference `Shared/RichTextWeb.Bridge.csproj`, and include `WebView2/CoreWebView2Transport.cs` and `Wpf/WpfRichTextHost.cs` in that application.

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

Include the shared project, `WebView2/CoreWebView2Transport.cs` and `WinUI/WinUiRichTextHost.cs`. After the `Microsoft.UI.Xaml.Controls.WebView2` control is loaded:

```csharp
_client = await WinUiRichTextHost.ConnectAsync(EditorWebView, assetsDirectory);
await _client.WaitUntilReadyAsync();
await _client.InsertTextAsync("Hello from WinUI");
```

The Windows App SDK provides the WebView2 control; see the [official WinUI WebView2 guide](https://learn.microsoft.com/en-us/microsoft-edge/webview2/get-started/winui). Use the application UI thread for attachment, client commands and disposal.

## Avalonia

Include the shared project and `Avalonia/AvaloniaRichTextHost.cs`. Use the `Avalonia.Controls.NativeWebView` component supported by the application's Avalonia version and native platform. Attach before navigating:

```csharp
_client = AvaloniaRichTextHost.Connect(EditorWebView,
    new Uri("http://127.0.0.1:51234/editor.html"));
await _client.WaitUntilReadyAsync();
await _client.InsertTextAsync("Hello from Avalonia");
```

The host uses `NativeWebView.InvokeScript` for requests and `WebMessageReceived` / `invokeCSharpAction` for replies. The corresponding [official NativeWebView API](https://docs.avaloniaui.net/controls/web/nativewebview) describes the platform-specific runtime prerequisites. Linux/macOS/Windows support and component availability depend on the installed Avalonia WebView distribution. This repository does not supply those native runtimes or commercial component licenses.

## Documents, threading and lifecycle

`GetDocumentAsync` returns a `JsonElement` snapshot of the canonical flow-document tree. `SetDocumentAsync(document, expectedRevision)` optionally rejects an update made against an older revision. Set-document replacement resets the JavaScript engine's undo history. `SelectAsync`, `InsertTextAsync`, `ApplyPropertyValueAsync`, `ExecuteAsync`, `UndoAsync` and `RedoAsync` forward to the same editing operations used by browser controls. `InvokeAsync` exposes every supported protocol method.

The native host page enables full document snapshots in change events, so the client's `Document` property updates for MVVM consumers. For large documents disable `includeDocumentInEvents` in `editor.html`, use revision notifications, and fetch snapshots when required. Selection events remain available through `EventReceived`. Explicitly catch rejected requests, including `RichTextBridgeException` with `Code == "revision_conflict"`, and preserve the user's intended update before resolving conflicts.

Create the client on the UI thread. Notifications marshal back to the captured synchronization context when one exists. The supplied WebView APIs require commands on their UI thread; the client does not dispatch arbitrary cross-thread WebView operations. Call `Dispose()` before destroying the view to detach listeners and cancel pending work. Recreate the client/transport if you reload the page or change its trusted document URL.

Navigation is restricted to the configured editor URL. WebView2 also checks each incoming message's source URI. Avalonia's callback lacks an equivalent source field, so its transport relies on the locked top-level document. Do not add arbitrary scripts or untrusted subframes to the privileged host page. Document imports render through the library's safe conversion path.

The bridge uses UTF-16 plain-text offsets. They are not WPF `TextPointer` symbol positions. Native WPF/WinUI/Avalonia visual trees, platform-specific text services, Word's COM object model and binary document compatibility require application migration work beyond this adapter.
