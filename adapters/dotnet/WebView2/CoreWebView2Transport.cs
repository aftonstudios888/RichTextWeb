using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;

namespace RichTextWeb;

/// <summary>Compile this source in a WPF or WinUI project with the WebView2 SDK.</summary>
public sealed class CoreWebView2Transport : IRichTextTransport
{
    private readonly CoreWebView2 _webView;
    private readonly Uri _editorUri;
    private bool _disposed;
    public event Action<string>? MessageReceived;

    public CoreWebView2Transport(CoreWebView2 webView, Uri editorUri)
    {
        if (!editorUri.IsAbsoluteUri || editorUri.Scheme is not ("https" or "http"))
            throw new ArgumentException("Serve packaged editor files through an HTTPS virtual host or localhost", nameof(editorUri));
        _webView = webView;
        _editorUri = editorUri;
        webView.WebMessageReceived += OnMessage;
        webView.NavigationStarting += OnNavigation;
        webView.NewWindowRequested += OnNewWindow;
    }
    private bool IsEditor(string uri) => Uri.TryCreate(uri, UriKind.Absolute, out var actual)
        && actual.GetComponents(UriComponents.SchemeAndServer, UriFormat.SafeUnescaped) == _editorUri.GetComponents(UriComponents.SchemeAndServer, UriFormat.SafeUnescaped)
        && actual.PathAndQuery == _editorUri.PathAndQuery;
    private void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        if (IsEditor(args.Source)) MessageReceived?.Invoke(args.WebMessageAsJson);
    }
    private void OnNavigation(object? sender, CoreWebView2NavigationStartingEventArgs args) { args.Cancel = !IsEditor(args.Uri); }
    private void OnNewWindow(object? sender, CoreWebView2NewWindowRequestedEventArgs args) { args.Handled = true; }
    public Task SendAsync(string json, CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        cancellationToken.ThrowIfCancellationRequested();
        if (!IsEditor(_webView.Source)) throw new InvalidOperationException("The trusted editor document is not loaded");
        _webView.PostWebMessageAsJson(json);
        return Task.CompletedTask;
    }
    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _webView.WebMessageReceived -= OnMessage;
        _webView.NavigationStarting -= OnNavigation;
        _webView.NewWindowRequested -= OnNewWindow;
    }
}
