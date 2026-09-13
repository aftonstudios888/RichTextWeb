using System.Text.Json;
using RichTextWeb;

internal static class NativeSmoke
{
    public static string? Argument(string[] args, string name) { int i = Array.IndexOf(args, name); return i >= 0 && i + 1 < args.Length ? args[i + 1] : null; }
    public static void Require(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
    public static async Task RunAsync(RichTextDocumentClient client, Func<string, Task<string?>> script, List<string> checks)
    {
        client.RequestTimeout = TimeSpan.FromSeconds(45);
        await client.WaitUntilReadyAsync().WaitAsync(TimeSpan.FromSeconds(90));
        checks.Add("Native browser loaded packaged assets and completed the C# bridge handshake");
        await client.InsertTextAsync("Desktop text");
        Require((await client.InvokeAsync("getText")).GetString() == "Desktop text", "Insert text");
        checks.Add("C# insertion changed the JavaScript document");
        await client.SelectAsync(0, 7); await client.ExecuteAsync("ToggleBold");
        Require((await client.GetDocumentAsync()).GetRawText().Contains("Bold", StringComparison.OrdinalIgnoreCase), "Format selection");
        checks.Add("Selection and formatting passed through the real native transport");
        await client.InsertTextAsync("Native");
        await client.UndoAsync(); Require((await client.InvokeAsync("getText")).GetString() == "Desktop text", "Undo");
        await client.RedoAsync(); Require((await client.InvokeAsync("getText")).GetString() == "Native text", "Redo");
        checks.Add("Undo and redo restored document text");
        var dom = await script("document.querySelector('rich-text-box').shadowRoot.querySelector('[part=editor]').textContent");
        Require(dom?.Contains("Native text") == true, "Native DOM output");
        checks.Add("The native browser rendered the edited document");
        Require(client.Document.HasValue && client.Revision > 0 && client.CanUndo, "MVVM state");
        checks.Add("C# MVVM document, revision and history state updated");
        await script("document.querySelector('rich-text-box').IsReadOnly=true");
        try { await client.InsertTextAsync("blocked"); throw new InvalidOperationException("Read-only edit succeeded"); }
        catch (RichTextBridgeException e) when (e.Code == "read_only") { }
        await script("document.querySelector('rich-text-box').IsReadOnly=false");
        checks.Add("Read-only policy rejected a native edit");
        try { await client.SetDocumentAsync(await client.GetDocumentAsync(), -1); throw new InvalidOperationException("Stale document accepted"); }
        catch (RichTextBridgeException e) when (e.Code == "revision_conflict") { }
        checks.Add("Stale revision replacement was rejected");
        int end = (await client.InvokeAsync("getText")).GetString()!.Length;
        await client.SelectAsync(end, end);
        await client.DocumentFeatureAsync("InsertField", new { type = "PAGE" });
        await client.DocumentFeatureAsync("UpdateFields", new { context = new { PageNumber = 3, PageCount = 5 } });
        Require((await client.InvokeAsync("getText")).GetString()!.EndsWith("3"), "Page field");
        await client.DocumentFeatureAsync("InsertNote", new { kind = "Footnote", content = "Native runtime qualification" });
        Require((await client.GetDocumentAsync()).GetRawText().Contains("Native runtime qualification"), "Note");
        checks.Add("Fields and notes executed through the reusable document API");
        await client.ExecuteAsync("TrackChanges", true);
        await client.InsertTextAsync(" tracked");
        Require((await client.GetReviewStateAsync()).GetProperty("revisions").GetArrayLength() > 0, "Tracked insertion");
        await client.ExecuteAsync("RejectAllRevisions");
        Require(!(await client.InvokeAsync("getText")).GetString()!.Contains(" tracked"), "Reject revision");
        checks.Add("Tracked insertion and rejection executed through native commands");
    }
    public static Task ReportAsync(string directory, string host, bool passed, List<string> checks, Exception? error = null)
    {
        Directory.CreateDirectory(directory);
        Console.WriteLine($"{(passed ? "PASS" : "FAIL")}: {checks.Count} real {host} checks");
        return File.WriteAllTextAsync(Path.Combine(directory, host + ".json"), JsonSerializer.Serialize(new
        {
            passed, checks, host, os = Environment.OSVersion.ToString(), dotnet = Environment.Version.ToString(),
            timestampUtc = DateTimeOffset.UtcNow, error = error?.ToString(),
            boundaries = new[] { "Programmatic native runtime and rendered output qualification", "Physical input devices, OS IMEs and screen readers need separate device testing" }
        }, new JsonSerializerOptions { WriteIndented = true }));
    }
}
