# RichTextWeb native bridge

These .NET adapters host the RichTextWeb JavaScript rich text engine in desktop WebViews. They expose asynchronous document, selection, formatting and history commands plus native `INotifyPropertyChanged` notifications.

- **RichTextWeb.Bridge**: shared .NET 8 protocol client, timeouts, cancellation and deterministic cleanup.
- **RichTextWeb.Wpf**: WPF WebView2 host and navigation-restricted transport.
- **RichTextWeb.WinUI**: WinUI 3 WebView2 host using Windows App SDK types.
- **RichTextWeb.Avalonia**: Avalonia NativeWebView integration. The official Avalonia WebView dependency requires an Avalonia Accelerate runtime license.

The engine remains JavaScript running inside the application's WebView. Packages do not implement a native C# text layout engine or complete Word/WPF API parity. The application must also deploy the standalone RichTextWeb browser bundle and the supplied editor host page.

See the [native integration guide](https://github.com/wieslawsoltes/RichTextWeb/blob/main/adapters/dotnet/README.md) for build, packaging, asset preparation, threading, source validation and qualification details. [Desktop workflow artifacts](https://github.com/wieslawsoltes/RichTextWeb/actions/workflows/desktop.yml) include packages and Windows smoke evidence. Verify the run and commit matching the package before relying on qualification results.
