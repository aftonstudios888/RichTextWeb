using System.Collections.Concurrent;
using System.ComponentModel;
using System.Text.Json;

namespace RichTextWeb;

/// <summary>A WebView transport; create, call and dispose the host adapter on its UI thread.</summary>
public interface IRichTextTransport : IDisposable
{
    /// <summary>Raises a complete JSON message received from the engine.</summary>
    event Action<string>? MessageReceived;
    /// <summary>Sends one validated protocol envelope to the hosted engine.</summary>
    Task SendAsync(string json, CancellationToken cancellationToken = default);
}

/// <summary>A rejected bridge request with its machine-readable protocol error code.</summary>
/// <param name="code">The remote protocol error code.</param>
/// <param name="message">The error description.</param>
public sealed class RichTextBridgeException(string code, string message) : Exception(message)
{
    /// <summary>Gets the error code, such as read_only or revision_conflict.</summary>
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
    /// <summary>Gets or sets the maximum time to wait for a response or ready handshake.</summary>
    public TimeSpan RequestTimeout { get; set; } = TimeSpan.FromSeconds(30);
    /// <summary>Gets or sets the largest accepted incoming JSON message in UTF-16 code units.</summary>
    public int MaximumIncomingMessageLength { get; set; } = 8 * 1024 * 1024;
    /// <summary>Gets the most recently notified document revision.</summary>
    public long Revision { get; private set; }
    /// <summary>Gets whether the engine reports undo history.</summary>
    public bool CanUndo { get; private set; }
    /// <summary>Gets whether the engine reports redo history.</summary>
    public bool CanRedo { get; private set; }
    /// <summary>Gets the latest snapshot when the host enables includeDocumentInEvents.</summary>
    public JsonElement? Document { get; private set; }
    /// <summary>Raises native MVVM notifications on the captured synchronization context.</summary>
    public event PropertyChangedEventHandler? PropertyChanged;
    /// <summary>Raises engine events with detached JSON payloads.</summary>
    public event Action<string, JsonElement>? EventReceived;
    /// <summary>Reports malformed or oversized incoming messages.</summary>
    public event Action<Exception>? ProtocolError;

    /// <summary>Creates a client that owns the supplied transport.</summary>
    public RichTextDocumentClient(IRichTextTransport transport)
    {
        _transport = transport;
        _transport.MessageReceived += Receive;
    }

    /// <summary>Waits for the ready handshake from the loaded editor page.</summary>
    public Task WaitUntilReadyAsync(CancellationToken cancellationToken = default) =>
        _ready.Task.WaitAsync(RequestTimeout, cancellationToken);

    /// <summary>Invokes a supported bridge method and returns its correlated JSON result.</summary>
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

    /// <summary>Fetches the full canonical document snapshot.</summary>
    public Task<JsonElement> GetDocumentAsync(CancellationToken token = default) => InvokeAsync("getDocument", cancellationToken: token);
    /// <summary>Replaces the document, optionally rejecting a stale revision.</summary>
    public Task<JsonElement> SetDocumentAsync(JsonElement document, long? expectedRevision = null, CancellationToken token = default) =>
        InvokeAsync("setDocument", Parameters(("document", document), ("expectedRevision", expectedRevision)), token);
    /// <summary>Selects a UTF-16 plain-text offset range.</summary>
    public Task<JsonElement> SelectAsync(int start, int end, CancellationToken token = default) => InvokeAsync("select", new { start, end }, token);
    /// <summary>Replaces the current selection with plain text.</summary>
    public Task<JsonElement> InsertTextAsync(string text, CancellationToken token = default) => InvokeAsync("insertText", new { text }, token);
    /// <summary>Applies a formatting property to the selection.</summary>
    public Task<JsonElement> ApplyPropertyValueAsync(string name, object? value, CancellationToken token = default) => InvokeAsync("applyProperty", new { name, value }, token);
    /// <summary>Executes a named editing command supported by the engine.</summary>
    public Task<JsonElement> ExecuteAsync(string command, object? parameter = null, CancellationToken token = default) => InvokeAsync("execute", new { command, parameter }, token);
    /// <summary>Undoes the last engine transaction.</summary>
    public Task<JsonElement> UndoAsync(CancellationToken token = default) => InvokeAsync("undo", cancellationToken: token);
    /// <summary>Reapplies the last undone transaction.</summary>
    public Task<JsonElement> RedoAsync(CancellationToken token = default) => InvokeAsync("redo", cancellationToken: token);

    /// <summary>Invokes a named document feature using JSON arguments and optional revision checking.</summary>
    /// <remarks>Supported operations: InsertField, UpdateFields, SetStory, InsertNote, UpdateNote, InsertTableOfContents, UpdateTableOfContents, MailMerge.</remarks>
    public Task<JsonElement> DocumentFeatureAsync(string operation, object? arguments = null, long? expectedRevision = null, CancellationToken cancellationToken = default)
    {
        string method = operation switch
        {
            "InsertField" => "insertField", "UpdateFields" => "updateFields", "SetStory" => "setStory",
            "InsertNote" => "insertNote", "UpdateNote" => "updateNote", "InsertTableOfContents" => "insertTableOfContents",
            "UpdateTableOfContents" => "updateTableOfContents", "MailMerge" => "mailMerge",
            _ => throw new ArgumentException("Unknown document feature operation", nameof(operation))
        };
        var parameters = new Dictionary<string, object?>();
        if (arguments is not null)
        {
            JsonElement json = JsonSerializer.SerializeToElement(arguments);
            if (json.ValueKind != JsonValueKind.Object) throw new ArgumentException("Feature arguments must serialize to a JSON object", nameof(arguments));
            foreach (var property in json.EnumerateObject()) parameters.Add(property.Name, property.Value.Clone());
        }
        if (expectedRevision.HasValue) parameters["expectedRevision"] = expectedRevision.Value;
        return InvokeAsync(method, parameters, cancellationToken);
    }

    /// <summary>Fetches tracking state, current author and recorded revisions.</summary>
    public Task<JsonElement> GetReviewStateAsync(CancellationToken cancellationToken = default) => InvokeAsync("getReviewState", cancellationToken: cancellationToken);

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
                    if (eventName is "ready" or "documentChanged") ValidateState(payload);
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

    private static void ValidateState(JsonElement state)
    {
        if (state.ValueKind != JsonValueKind.Object) throw new JsonException("State payload must be an object");
        if (state.TryGetProperty("revision", out var revision) && (!revision.TryGetInt64(out long value) || value < 0)) throw new JsonException("Invalid document revision");
        foreach (string name in new[] { "canUndo", "canRedo" })
            if (state.TryGetProperty(name, out var boolean) && boolean.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) throw new JsonException("Invalid command state");
        if (state.TryGetProperty("document", out var document) && document.ValueKind != JsonValueKind.Object) throw new JsonException("Invalid document snapshot");
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
    /// <summary>Detaches the transport and cancels all pending requests.</summary>
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
