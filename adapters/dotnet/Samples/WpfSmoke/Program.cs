using System.IO;
using System.Text.Json;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using RichTextWeb;

internal static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        bool smoke = args.Contains("--smoke");
        string assets = Value(args, "--assets") ?? Path.Combine(AppContext.BaseDirectory, "web");
        string reportDirectory = Value(args, "--report") ?? Path.Combine(Environment.CurrentDirectory, "artifacts", "desktop", "smoke");
        Directory.CreateDirectory(reportDirectory);
        var application = new Application();
        var view = new WebView2();
        var window = new Window { Title = "RichTextWeb native WPF host", Width = 1120, Height = 820, Content = view };
        RichTextDocumentClient? client = null;
        bool initialized = false;
        window.Closed += (_, _) => { client?.Dispose(); view.Dispose(); };
        window.Loaded += async (_, _) =>
        {
            if (initialized) return;
            initialized = true;
            var checks = new List<string>();
            try
            {
                client = await WpfRichTextHost.ConnectAsync(view, assets).WaitAsync(TimeSpan.FromSeconds(90));
                client.RequestTimeout = TimeSpan.FromSeconds(45);
                await client.WaitUntilReadyAsync(); checks.Add("WebView2 loaded packaged editor and completed the native handshake");
                if (!smoke) return;
                await client.InsertTextAsync("Desktop text");
                Require((await client.InvokeAsync("getText")).GetString() == "Desktop text", "Text insertion");
                checks.Add("C# editing request changed the real JavaScript document");
                await client.SelectAsync(0, 7); await client.ExecuteAsync("ToggleBold");
                string model = (await client.GetDocumentAsync()).GetRawText();
                Require(model.Contains("Bold", StringComparison.OrdinalIgnoreCase), "Bold format");
                checks.Add("Formatting and native selection crossed the message channel");
                await client.SelectAsync(0, 7); await client.InsertTextAsync("Native");
                Require((await client.InvokeAsync("getText")).GetString() == "Native text", "Replace selection");
                await client.UndoAsync(); Require((await client.InvokeAsync("getText")).GetString() == "Desktop text", "Undo");
                await client.RedoAsync(); Require((await client.InvokeAsync("getText")).GetString() == "Native text", "Redo");
                checks.Add("Undo and redo restored expected text");
                string rendered = await view.ExecuteScriptAsync("document.querySelector('rich-text-box').shadowRoot.querySelector('[part=editor]').textContent");
                Require(JsonSerializer.Deserialize<string>(rendered)?.Contains("Native text") == true, "DOM renderer");
                checks.Add("The native WebView rendered the edited document");
                Require(client.Document.HasValue && client.Revision > 0 && client.CanUndo, "MVVM notification");
                checks.Add("Native MVVM document, revision and undo properties updated");
                await view.ExecuteScriptAsync("document.querySelector('rich-text-box').IsReadOnly=true");
                try { await client.InsertTextAsync("blocked"); throw new InvalidOperationException("Read-only request unexpectedly succeeded"); }
                catch (RichTextBridgeException error) when (error.Code == "read_only") { }
                checks.Add("Host read-only policy rejected native edits");
                await view.ExecuteScriptAsync("document.querySelector('rich-text-box').IsReadOnly=false");
                var source = await client.GetDocumentAsync();
                try { await client.SetDocumentAsync(source, -1); throw new InvalidOperationException("Stale revision unexpectedly succeeded"); }
                catch (RichTextBridgeException error) when (error.Code == "revision_conflict") { }
                checks.Add("Revision checking rejected a stale replacement");
                int end = (await client.InvokeAsync("getText")).GetString()!.Length;
                await client.SelectAsync(end, end);
                await client.DocumentFeatureAsync("InsertField", new { type = "PAGE" });
                await client.DocumentFeatureAsync("UpdateFields", new { context = new { PageNumber = 2, PageCount = 4 } });
                Require((await client.InvokeAsync("getText")).GetString()!.EndsWith("2"), "Native document field");
                await client.DocumentFeatureAsync("InsertNote", new { kind = "Footnote", content = "Native host note" });
                Require((await client.GetDocumentAsync()).GetRawText().Contains("Native host note"), "Native footnote");
                checks.Add("Document fields and notes executed through validated native feature messages");
                await client.ExecuteAsync("CurrentAuthor", "Native smoke reviewer");
                await client.ExecuteAsync("TrackChanges", true);
                await client.InsertTextAsync(" tracked insertion");
                Require((await client.GetReviewStateAsync()).GetProperty("revisions").GetArrayLength() > 0, "Native tracked edit");
                await client.ExecuteAsync("AcceptAllRevisions");
                Require((await client.GetReviewStateAsync()).GetProperty("revisions").GetArrayLength() == 0, "Native revision acceptance");
                checks.Add("Tracked editing and review acceptance executed through native commands");
                using (var screenshot = File.Create(Path.Combine(reportDirectory, "wpf-webview2.png")))
                    await view.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, screenshot);
                await File.WriteAllTextAsync(Path.Combine(reportDirectory, "wpf-webview2.json"), JsonSerializer.Serialize(new
                {
                    passed = true, checks, runtime = view.CoreWebView2.Environment.BrowserVersionString,
                    os = Environment.OSVersion.ToString(), dotnet = Environment.Version.ToString(), timestampUtc = DateTimeOffset.UtcNow,
                    boundaries = new[] { "Programmatic bridge and renderer smoke only", "Physical keyboard, IME, screen reader and GPU qualification are not covered", "WPF runtime exercised; WinUI and Avalonia runtime are separate targets" }
                }, new JsonSerializerOptions { WriteIndented = true }));
                Console.WriteLine($"PASS: {checks.Count} real WPF/WebView2 checks");
                application.Shutdown(0);
            }
            catch (Exception error)
            {
                Console.Error.WriteLine(error);
                await File.WriteAllTextAsync(Path.Combine(reportDirectory, "wpf-webview2.json"), JsonSerializer.Serialize(new { passed = false, checks, error = error.ToString(), timestampUtc = DateTimeOffset.UtcNow }, new JsonSerializerOptions { WriteIndented = true }));
                application.Shutdown(1);
            }
        };
        return application.Run(window);
    }
    private static string? Value(string[] args, string name) { int index = Array.IndexOf(args, name); return index >= 0 && index + 1 < args.Length ? args[index + 1] : null; }
    private static void Require(bool condition, string operation) { if (!condition) throw new InvalidOperationException($"Native smoke assertion failed: {operation}"); }
}
