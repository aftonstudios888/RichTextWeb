using System;
using System.Threading;
using System.Threading.Tasks;
using System.Text.Json;
using Avalonia.Controls;

namespace RichTextWeb;

/// <summary>Source adapter for Avalonia.Controls.NativeWebView. Use a locally served trusted editor URL.</summary>
public sealed class AvaloniaRichTextTransport : IRichTextTransport
{
    private readonly NativeWebView _webView;
    private readonly Uri _editorUri;
    private bool _disposed;
    public event Action<string>? MessageReceived;

    public AvaloniaRichTextTransport(NativeWebView webView, Uri editorUri)
    {
        if (!editorUri.IsAbsoluteUri || editorUri.Scheme is not ("http" or "https")) throw new ArgumentException("An absolute editor HTTP(S) URL is required", nameof(editorUri));
        _webView = webView;
        _editorUri = editorUri;
        _webView.WebMessageReceived += OnMessage;
        _webView.NavigationStarted += OnNavigation;
    }
    private bool IsEditor(Uri? uri) => uri is not null && uri.GetComponents(UriComponents.SchemeAndServer, UriFormat.SafeUnescaped) == _editorUri.GetComponents(UriComponents.SchemeAndServer, UriFormat.SafeUnescaped)
        && uri.PathAndQuery == _editorUri.PathAndQuery;
    private void OnMessage(object? sender, WebMessageReceivedEventArgs args)
    {
        // NativeWebView's callback does not carry a source URI; navigation is locked to the editor.
        if (IsEditor(_webView.Source)) MessageReceived?.Invoke(args.Body);
    }
    private void OnNavigation(object? sender, WebViewNavigationStartingEventArgs args) { args.Cancel = !IsEditor(args.Request); }
    public async Task SendAsync(string json, CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        cancellationToken.ThrowIfCancellationRequested();
        if (!IsEditor(_webView.Source)) throw new InvalidOperationException("The trusted editor document is not loaded");
        // JSON string serialization keeps message content data, never executable JavaScript.
        await _webView.InvokeScript("window.receiveRichTextWebMessage(" + JsonSerializer.Serialize(json) + ")");
    }
    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _webView.WebMessageReceived -= OnMessage;
        _webView.NavigationStarted -= OnNavigation;
    }
}

public static class AvaloniaRichTextHost
{
    public static RichTextDocumentClient Connect(NativeWebView control, Uri editorUri)
    {
        var client = new RichTextDocumentClient(new AvaloniaRichTextTransport(control, editorUri));
        control.Source = editorUri;
        return client;
    }
}
