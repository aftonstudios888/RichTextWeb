using System.Net;
using System.Net.Sockets;
using System.Text;

namespace RichTextWeb;

/// <summary>Loopback-only static asset host for desktop WebViews. No administrator URL reservation is required.</summary>
public sealed class LocalAssetServer : IDisposable
{
    private readonly string _root;
    private readonly TcpListener _listener;
    private readonly CancellationTokenSource _stop = new();
    /// <summary>The bound IPv4 loopback address and dynamically allocated port.</summary>
    public Uri BaseUri { get; }
    /// <summary>The trusted document endpoint to supply to an Avalonia host.</summary>
    public Uri EditorUri => new(BaseUri, "editor.html");

    /// <summary>Serves the supplied static asset directory until disposed.</summary>
    public LocalAssetServer(string assetsDirectory)
    {
        _root = Path.GetFullPath(assetsDirectory) + Path.DirectorySeparatorChar;
        if (!File.Exists(Path.Combine(_root, "editor.html"))) throw new FileNotFoundException("Editor assets are missing", Path.Combine(_root, "editor.html"));
        _listener = new TcpListener(IPAddress.Loopback, 0);
        _listener.Start();
        BaseUri = new Uri($"http://127.0.0.1:{((IPEndPoint)_listener.LocalEndpoint).Port}/");
        _ = AcceptAsync();
    }
    private async Task AcceptAsync()
    {
        try
        {
            while (!_stop.IsCancellationRequested)
            {
                var socket = await _listener.AcceptTcpClientAsync(_stop.Token);
                _ = ServeAsync(socket);
            }
        }
        catch (OperationCanceledException) { }
        catch (SocketException) when (_stop.IsCancellationRequested) { }
    }
    private async Task ServeAsync(TcpClient socket)
    {
        using (socket)
        using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(_stop.Token))
        {
            timeout.CancelAfter(TimeSpan.FromSeconds(15));
            try
            {
                var stream = socket.GetStream();
                // Read only a bounded HTTP header. The server accepts no request bodies.
                var header = new List<byte>();
                var single = new byte[1];
                while (header.Count < 8192)
                {
                    if (await stream.ReadAsync(single, timeout.Token) == 0) return;
                    header.Add(single[0]);
                    int n = header.Count;
                    if (n >= 4 && header[n - 4] == 13 && header[n - 3] == 10 && header[n - 2] == 13 && header[n - 1] == 10) break;
                }
                if (header.Count >= 8192) return;
                var request = Encoding.ASCII.GetString(header.ToArray()).Split('\r')[0].Split(' ');
                if (request.Length != 3 || request[0] != "GET" || !request[1].StartsWith('/')) { await ErrorAsync(stream, 405, timeout.Token); return; }
                string relative = Uri.UnescapeDataString(request[1].Split('?')[0]).TrimStart('/');
                if (relative.Length == 0) relative = "editor.html";
                var path = Path.GetFullPath(Path.Combine(_root, relative));
                if (!path.StartsWith(_root, OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal) || !File.Exists(path)) { await ErrorAsync(stream, 404, timeout.Token); return; }
                var type = Path.GetExtension(path).ToLowerInvariant() switch
                {
                    ".html" => "text/html; charset=utf-8", ".js" or ".mjs" => "text/javascript; charset=utf-8",
                    ".css" => "text/css; charset=utf-8", ".json" or ".map" => "application/json", ".wasm" => "application/wasm",
                    ".svg" => "image/svg+xml", ".png" => "image/png", ".woff2" => "font/woff2", _ => "application/octet-stream"
                };
                await using var file = File.OpenRead(path);
                var response = Encoding.ASCII.GetBytes($"HTTP/1.1 200 OK\r\nContent-Type: {type}\r\nContent-Length: {file.Length}\r\nX-Content-Type-Options: nosniff\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n");
                await stream.WriteAsync(response, timeout.Token);
                await file.CopyToAsync(stream, timeout.Token);
            }
            catch (Exception error) when (error is IOException or SocketException or OperationCanceledException or ArgumentException or UnauthorizedAccessException) { }
        }
    }
    private static async Task ErrorAsync(Stream stream, int status, CancellationToken token) =>
        await stream.WriteAsync(Encoding.ASCII.GetBytes($"HTTP/1.1 {status} Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"), token);
    /// <summary>Stops accepting connections and cancels active asset responses.</summary>
    public void Dispose() { if (_stop.IsCancellationRequested) return; _stop.Cancel(); _listener.Stop(); }
}
