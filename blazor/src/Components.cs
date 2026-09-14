using System.Text.Json;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Forms;
using Microsoft.AspNetCore.Components.Rendering;
using Microsoft.JSInterop;
namespace RichTextWeb.Blazor;

public sealed record EditorValue(long Revision, string Value);
public sealed record PaginationInfo(int PageCount, int OverflowCount, long DocumentRevision, int PageNumber);
public sealed record PdfInfo(int PageCount, int PageIndex, double Zoom, bool CanUndo, bool CanRedo, string ViewMode);
public sealed record PdfSearchMatch(int PageIndex, string Text, int MatchIndex, double X, double Y, double Width, double Height);

/// <summary>Native rich-text editing with revision-aware two-way value binding and browser-owned WYSIWYG DOM.</summary>
public class RichTextEditor : BrowserComponent
{
    [Parameter] public string? Value { get; set; }
    [Parameter] public EventCallback<string?> ValueChanged { get; set; }
    [Parameter] public string ValueFormat { get; set; } = "html";
    [Parameter] public long ValueRevision { get; set; }
    [Parameter] public IJSObjectReference? Document { get; set; }
    [Parameter] public string ControlKind { get; set; } = "editor";
    [Parameter] public string Theme { get; set; } = "light";
    [Parameter] public bool ShowToolbar { get; set; } = true;
    [Parameter] public string ToolbarMode { get; set; } = "all";
    [Parameter] public bool IsReadOnly { get; set; }
    [Parameter] public bool AcceptsTab { get; set; } = true;
    [Parameter] public double Zoom { get; set; } = 1;
    [Parameter] public string ViewMode { get; set; } = "page";
    [Parameter] public bool EnableVirtualization { get; set; } = true;
    [Parameter] public int VirtualizationThreshold { get; set; } = 200;
    [Parameter] public int VirtualizationOverscan { get; set; } = 5;
    [Parameter] public int DebounceMilliseconds { get; set; } = 150;
    [Parameter] public string Placeholder { get; set; } = "";
    [Parameter] public string AriaLabel { get; set; } = "Rich text editor";
    private string? _lastBrowserValue;
    private long _lastBrowserRevision = -1;
    protected override IReadOnlyList<string> RequiredEvents => ["dom:blazor-valuechange"];
    protected override IReadOnlyList<string> DefaultEvents => ["dom:documentchange", "dom:selectionchange", "dom:commandstatechange", "dom:paginated", "dom:pagechange", "dom:objectselectionchange"];
    protected override Dictionary<string, object?> BuildOptions()
    {
        var native = base.BuildOptions(); native["IsReadOnly"] = IsReadOnly; native["AcceptsTab"] = AcceptsTab;
        native["Zoom"] = Zoom; native["ViewMode"] = ViewMode; native["EnableVirtualization"] = EnableVirtualization;
        native["VirtualizationThreshold"] = VirtualizationThreshold; native["VirtualizationOverscan"] = VirtualizationOverscan;
        return new() { ["kind"] = ControlKind, ["value"] = Value, ["valueFormat"] = ValueFormat, ["valueRevision"] = ValueRevision,
            ["ackRevision"] = Value == _lastBrowserValue ? _lastBrowserRevision : -1, ["document"] = Document,
            ["native"] = native, ["theme"] = Theme, ["showToolbar"] = ShowToolbar, ["toolbarMode"] = ToolbarMode,
            ["debounceMilliseconds"] = DebounceMilliseconds, ["placeholder"] = Placeholder, ["ariaLabel"] = AriaLabel };
    }
    protected override async Task OnBrowserEventAsync(BrowserEvent notification)
    {
        if (notification.Name == "dom:blazor-valuechange") await ApplyValueAsync(await InvokeJsonAsync<EditorValue>("ReadBinding"));
        await base.OnBrowserEventAsync(notification);
    }
    private async Task ApplyValueAsync(EditorValue value)
    {
        if (value.Revision <= _lastBrowserRevision) return;
        _lastBrowserRevision = value.Revision; _lastBrowserValue = value.Value;
        if (Value != value.Value) await ValueChanged.InvokeAsync(value.Value);
    }
    public async ValueTask FlushChangesAsync() => await ApplyValueAsync(await InvokeJsonAsync<EditorValue>("FlushChanges"));
    public ValueTask<string> GetValueAsync(string? format = null) => InvokeJsonAsync<string>("GetValue", format ?? ValueFormat);
    public ValueTask AppendTextAsync(string text) => InvokeVoidAsync("AppendText", text);
    public ValueTask SelectAsync(int start, int end) => InvokeVoidAsync("Select", start, end);
    public ValueTask SelectAllAsync() => InvokeVoidAsync("SelectAll");
    public ValueTask FocusAsync() => InvokeVoidAsync("Focus");
    public ValueTask UndoAsync() => InvokeVoidAsync("Undo");
    public ValueTask RedoAsync() => InvokeVoidAsync("Redo");
    public ValueTask<JsonElement> ExecuteAsync(string command, object? parameter = null) => InvokeJsonAsync<JsonElement>("Execute", command, parameter);
    public ValueTask<PaginationInfo> RepaginateAsync() => InvokeAsync<PaginationInfo>("Repaginate");
    public ValueTask<bool> GoToPageAsync(int number) => InvokeAsync<bool>("GoToPage", number);
    public ValueTask<byte[]> ExportBytesAsync(string format, object? options = null) => InvokeBytesAsync("ExportBytes", format, options ?? new { });
    public ValueTask ImportBytesAsync(string format, byte[] bytes, object? options = null) => InvokeVoidAsync("ImportBytes", format, bytes, options ?? new { });
    public ValueTask<IJSObjectReference> GetNativeEditorAsync() => InvokeAsync<IJSObjectReference>("GetNativeEditor");
    public ValueTask<IJSObjectReference> GetDocumentAsync() => Module is not null && Control is not null ? Module.GetAsync<IJSObjectReference>(Control, "Document") : ValueTask.FromException<IJSObjectReference>(new InvalidOperationException("Wait for Ready."));
    public ValueTask<IJSObjectReference> GetEngineAsync() => Module is not null && Control is not null ? Module.GetAsync<IJSObjectReference>(Control, "Engine") : ValueTask.FromException<IJSObjectReference>(new InvalidOperationException("Wait for Ready."));
}
public sealed class RichTextPageEditor : RichTextEditor
{
    protected override Dictionary<string, object?> BuildOptions() { var values = base.BuildOptions(); values["kind"] = "pageEditor"; return values; }
}
public class FlowDocumentReader : RichTextEditor
{
    protected override Dictionary<string, object?> BuildOptions()
    {
        var values = base.BuildOptions(); values["kind"] = "reader"; values["showToolbar"] = false;
        ((Dictionary<string, object?>)values["native"]!)["IsReadOnly"] = true; return values;
    }
}
public sealed class FlowDocumentScrollViewer : FlowDocumentReader
{
    protected override Dictionary<string, object?> BuildOptions() { var values = base.BuildOptions(); values["kind"] = "scrollViewer"; ((Dictionary<string, object?>)values["native"]!)["ViewMode"] = "continuous"; return values; }
}
public sealed class FlowDocumentPageViewer : FlowDocumentReader
{
    protected override Dictionary<string, object?> BuildOptions() { var values = base.BuildOptions(); values["kind"] = "pageViewer"; ((Dictionary<string, object?>)values["native"]!)["ViewMode"] = "page"; return values; }
}

/// <summary>InputBase integration for EditForm validation, field state, CSS and standard @bind-Value.</summary>
public sealed class RichTextInput : InputBase<string?>
{
    [Parameter] public string ValueFormat { get; set; } = "html";
    [Parameter] public long ValueRevision { get; set; }
    [Parameter] public string ControlKind { get; set; } = "editor";
    [Parameter] public string Theme { get; set; } = "light";
    [Parameter] public bool ShowToolbar { get; set; } = true;
    [Parameter] public string ToolbarMode { get; set; } = "all";
    [Parameter] public bool IsReadOnly { get; set; }
    [Parameter] public string Style { get; set; } = "display:block;height:500px;min-height:0";
    [Parameter] public int DebounceMilliseconds { get; set; }
    [Parameter] public string AriaLabel { get; set; } = "Rich text input";
    [Parameter] public EventCallback<IJSObjectReference> Ready { get; set; }
    [Parameter] public EventCallback<BrowserEvent> Changed { get; set; }
    [Parameter] public IReadOnlyDictionary<string, object?>? Options { get; set; }
    public RichTextEditor? Editor { get; private set; }
    protected override bool TryParseValueFromString(string? value, out string? result, out string? validationErrorMessage) { result = value; validationErrorMessage = null; return true; }
    protected override void BuildRenderTree(RenderTreeBuilder builder)
    {
        builder.OpenComponent<RichTextEditor>(0);
        builder.AddAttribute(1, "Value", CurrentValue);
        builder.AddAttribute(2, "ValueChanged", EventCallback.Factory.Create<string?>(this, value => CurrentValue = value));
        builder.AddAttribute(3, "ValueFormat", ValueFormat); builder.AddAttribute(4, "ValueRevision", ValueRevision);
        builder.AddAttribute(5, "ControlKind", ControlKind); builder.AddAttribute(6, "Theme", Theme);
        builder.AddAttribute(7, "ShowToolbar", ShowToolbar); builder.AddAttribute(8, "ToolbarMode", ToolbarMode);
        builder.AddAttribute(9, "IsReadOnly", IsReadOnly); builder.AddAttribute(10, "Style", Style);
        builder.AddAttribute(11, "DebounceMilliseconds", DebounceMilliseconds); builder.AddAttribute(12, "AriaLabel", AriaLabel);
        builder.AddAttribute(13, "Ready", Ready); builder.AddAttribute(14, "Changed", Changed);
        builder.AddAttribute(15, "Options", Options); builder.AddAttribute(16, "AdditionalAttributes", AdditionalAttributes);
        builder.AddAttribute(17, "Class", CssClass);
        builder.AddComponentReferenceCapture(18, value => Editor = (RichTextEditor)value);
        builder.CloseComponent();
    }
    public ValueTask FlushAsync() => Editor?.FlushChangesAsync() ?? ValueTask.CompletedTask;
}

/// <summary>Native PDF viewing, page editing, annotation, search and reconstructed-flow editing.</summary>
public sealed class PdfEditor : BrowserComponent
{
    [Parameter] public byte[]? Source { get; set; }
    [Parameter] public long SourceRevision { get; set; }
    [Parameter] public object? ImportOptions { get; set; }
    [Parameter] public string Theme { get; set; } = "light";
    [Parameter] public bool IsReadOnly { get; set; }
    [Parameter] public double Zoom { get; set; } = 1;
    [Parameter] public string Tool { get; set; } = "select";
    [Parameter] public string ViewMode { get; set; } = "pdf";
    protected override IReadOnlyList<string> DefaultEvents => ["dom:pdfload", "dom:pdfchange", "dom:pdferror", "dom:pagechange", "dom:flowdocumentchange", "dom:flowdocumentimport"];
    protected override Dictionary<string, object?> BuildOptions()
    {
        var native = base.BuildOptions(); native["IsReadOnly"] = IsReadOnly; native["Zoom"] = Zoom; native["Tool"] = Tool; native["ViewMode"] = ViewMode;
        return new() { ["kind"] = "pdf", ["source"] = Source, ["sourceRevision"] = SourceRevision, ["importOptions"] = ImportOptions, ["native"] = native, ["theme"] = Theme };
    }
    public ValueTask LoadAsync(byte[] bytes, object? options = null) => InvokeVoidAsync("Load", bytes, options ?? new { });
    public ValueTask SetViewModeAsync(string mode) => InvokeVoidAsync("SetViewMode", mode);
    public ValueTask<byte[]> SaveAsync() => InvokeBytesAsync("Save");
    public ValueTask<PdfInfo> GetInfoAsync() => InvokeAsync<PdfInfo>("GetInfo");
    public ValueTask<PdfSearchMatch[]> FindAsync(string query, bool caseSensitive = false) => InvokeJsonAsync<PdfSearchMatch[]>("Find", query, new { caseSensitive });
    public ValueTask AddPageAsync(double? width = null, double? height = null) => InvokeVoidAsync("AddPage", width, height);
    public ValueTask InsertPagesAsync(byte[] bytes, int[]? indices = null, int? insertionIndex = null) => InvokeVoidAsync("InsertPages", bytes, indices, insertionIndex);
    public ValueTask UndoAsync() => InvokeVoidAsync("Undo");
    public ValueTask RedoAsync() => InvokeVoidAsync("Redo");
    public ValueTask FitWidthAsync() => InvokeVoidAsync("FitWidth");
    public ValueTask<IJSObjectReference> ImportToFlowDocumentAsync(object? options = null) => InvokeAsync<IJSObjectReference>("ImportToFlowDocument", options ?? new { });
    public ValueTask<byte[]> ExportReflowAsync(object? options = null) => InvokeBytesAsync("ExportReflow", options ?? new { });
}
public sealed class RichTextProvider : BrowserProvider { }
public sealed class RichTextModule(IJSRuntime js) : BrowserModule(js)
{
    public ValueTask<IJSObjectReference> FromTextAsync(string text) => InvokeAsync<IJSObjectReference>("fromText", [text]);
    public ValueTask<IJSObjectReference> FromHtmlAsync(string html) => InvokeAsync<IJSObjectReference>("fromHTML", [html]);
    public ValueTask<IJSObjectReference> FromDocxAsync(byte[] bytes) => InvokeAsync<IJSObjectReference>("fromDOCX", [bytes]);
    public ValueTask<byte[]> ToDocxAsync(IJSObjectReference document) => InvokeBytesAsync("toDOCX", [document]);
    public ValueTask<byte[]> ToPdfAsync(IJSObjectReference document, object? options = null) => InvokeBytesAsync("toPDF", [document, options ?? new { }]);
}
