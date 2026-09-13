using System.Collections.Concurrent;
using System.ComponentModel;
using System.Text.Json;

namespace RichTextWeb;

/// <summary>A WebView transport; create, call and dispose the host adapter on its UI thread.</summary>
public interface IRichTextTransport : IDisposable
{
    event Action<string>? MessageReceived;
    Task SendAsync(string json, CancellationToken cancellationToken = default);
}

public sealed class RichTextBridgeException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}

/// <summary>Shared async command client for the JavaScript engine, with native MVVM notifications.</summary>
public sealed class RichTextDocumentClient : INotifyPropertyChanged, IDisposable
{
    private readonly IRichTextTransport _transport;
    private readonly ConcurrentDictionary<string, TaskCompletionSource<JsonElement>> _pending = new();
    private readonly TaskCompletionSource _ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly SynchronizationContext? _context = SynchronizationContext.Current;
    private long _sequence;
    private bool _disposed;
    public TimeSpan RequestTimeout { get; set; } = TimeSpan.FromSeconds(30);
    public int MaximumIncomingMessageLength { get; set; } = 8 * 1024 * 1024;
    public long Revision { get; private set; }
    public bool CanUndo { get; private set; }
    public bool CanRedo { get; private set; }
    public JsonElement? Document { get; private set; }
    public event PropertyChangedEventHandler? PropertyChanged;
    public event Action<string, JsonElement>? EventReceived;
    public event Action<Exception>? ProtocolError;

    public RichTextDocumentClient(IRichTextTransport transport)
    {
        _transport = transport;
        _transport.MessageReceived += Receive;
    }

    public Task WaitUntilReadyAsync(CancellationToken cancellationToken = default) =>
        _ready.Task.WaitAsync(RequestTimeout, cancellationToken);

    public async Task<JsonElement> InvokeAsync(string method, object? parameters = null, CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (string.IsNullOrWhiteSpace(method)) throw new ArgumentException("A bridge method is required", nameof(method));
        string id = Interlocked.Increment(ref _sequence).ToString(System.Globalization.CultureInfo.InvariantCulture);
        var completion = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (!_pending.TryAdd(id, completion)) throw new InvalidOperationException("Duplicate request id");
        try
        {
            string json = JsonSerializer.Serialize(new { channel = "richtextweb", version = 1, kind = "request", id, method, @params = parameters ?? new { } });
            await _transport.SendAsync(json, cancellationToken);
            return await completion.Task.WaitAsync(RequestTimeout, cancellationToken);
        }
        finally { _pending.TryRemove(id, out _); }
    }

    public Task<JsonElement> GetDocumentAsync(CancellationToken token = default) => InvokeAsync("getDocument", cancellationToken: token);
    public Task<JsonElement> SetDocumentAsync(JsonElement document, long? expectedRevision = null, CancellationToken token = default) =>
        InvokeAsync("setDocument", Parameters(("document", document), ("expectedRevision", expectedRevision)), token);
    public Task<JsonElement> SelectAsync(int start, int end, CancellationToken token = default) => InvokeAsync("select", new { start, end }, token);
    public Task<JsonElement> InsertTextAsync(string text, CancellationToken token = default) => InvokeAsync("insertText", new { text }, token);
    public Task<JsonElement> ApplyPropertyValueAsync(string name, object? value, CancellationToken token = default) => InvokeAsync("applyProperty", new { name, value }, token);
    public Task<JsonElement> ExecuteAsync(string command, object? parameter = null, CancellationToken token = default) => InvokeAsync("execute", new { command, parameter }, token);
    public Task<JsonElement> UndoAsync(CancellationToken token = default) => InvokeAsync("undo", cancellationToken: token);
    public Task<JsonElement> RedoAsync(CancellationToken token = default) => InvokeAsync("redo", cancellationToken: token);

    private static Dictionary<string, object?> Parameters(params (string Name, object? Value)[] pairs) =>
        pairs.Where(pair => pair.Value is not null).ToDictionary(pair => pair.Name, pair => pair.Value);

    private void Receive(string json)
    {
        if (_disposed) return;
        try
        {
            if (json.Length > MaximumIncomingMessageLength) throw new JsonException("Incoming bridge message is too large");
            using var parsed = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 128 });
            var root = parsed.RootElement;
            if (root.ValueKind != JsonValueKind.Object || root.GetProperty("channel").GetString() != "richtextweb" || root.GetProperty("version").GetInt32() != 1)
                throw new JsonException("Unexpected bridge protocol");
            switch (root.GetProperty("kind").GetString())
            {
                case "response":
                    string? id = root.GetProperty("id").GetString();
                    if (id is null || !_pending.TryGetValue(id, out var pending)) return;
                    try
                    {
                        if (root.TryGetProperty("error", out var error))
                            pending.TrySetException(new RichTextBridgeException(error.GetProperty("code").GetString() ?? "error", error.GetProperty("message").GetString() ?? "Bridge request failed"));
                        else pending.TrySetResult(root.GetProperty("result").Clone());
                    }
                    catch (Exception malformed) when (malformed is JsonException or KeyNotFoundException or InvalidOperationException or FormatException)
                    {
                        pending.TrySetException(new RichTextBridgeException("invalid_response", malformed.Message));
                    }
                    finally { _pending.TryRemove(id, out _); }
                    break;
                case "event":
                    string eventName = root.GetProperty("event").GetString() ?? throw new JsonException("Missing event name");
                    JsonElement payload = root.GetProperty("payload").Clone();
                    if (eventName == "ready") _ready.TrySetResult();
                    Dispatch(() =>
                    {
                        if (_disposed) return;
                        if (eventName is "ready" or "documentChanged") ApplyState(payload);
                        EventReceived?.Invoke(eventName, payload);
                    });
                    break;
                default: throw new JsonException("Unexpected bridge message kind");
            }
        }
        catch (Exception error) when (error is JsonException or KeyNotFoundException or InvalidOperationException or FormatException)
        {
            Dispatch(() => ProtocolError?.Invoke(error));
        }
    }

    private void ApplyState(JsonElement state)
    {
        if (state.TryGetProperty("revision", out var revision)) { Revision = revision.GetInt64(); Notify(nameof(Revision)); }
        if (state.TryGetProperty("canUndo", out var undo)) { CanUndo = undo.GetBoolean(); Notify(nameof(CanUndo)); }
        if (state.TryGetProperty("canRedo", out var redo)) { CanRedo = redo.GetBoolean(); Notify(nameof(CanRedo)); }
        if (state.TryGetProperty("document", out var document)) { Document = document.Clone(); Notify(nameof(Document)); }
    }
    private void Notify(string propertyName) => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    private void Dispatch(Action callback)
    {
        if (_context is not null && SynchronizationContext.Current != _context) _context.Post(_ => callback(), null);
        else callback();
    }
    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _transport.MessageReceived -= Receive;
        _transport.Dispose();
        _ready.TrySetCanceled();
        foreach (var item in _pending.Values) item.TrySetCanceled();
        _pending.Clear();
    }
}
