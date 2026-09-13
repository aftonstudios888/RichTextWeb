using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using RichTextWeb;

internal static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        try { return AppBuilder.Configure<SmokeApplication>().UsePlatformDetect().LogToTrace().StartWithClassicDesktopLifetime(args); }
        catch (Exception error)
        {
            Console.Error.WriteLine(error);
            if (args.Contains("--smoke"))
            {
                string report = NativeSmoke.Argument(args, "--report") ?? Path.Combine(Environment.CurrentDirectory, "artifacts", "desktop", "avalonia");
                NativeSmoke.ReportAsync(report, "avalonia-webview", false, new List<string>(), error).GetAwaiter().GetResult();
            }
            return 1;
        }
    }
}
public sealed class SmokeApplication : Application
{
    public override void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            var args = desktop.Args ?? Array.Empty<string>();
            var view = new NativeWebView();
            var window = new Window { Title = "RichTextWeb Avalonia editor", Width = 1120, Height = 820, Content = view };
            desktop.MainWindow = window;
            RichTextDocumentClient? client = null;
            LocalAssetServer? server = null;
            window.Closed += (_, _) => { client?.Dispose(); server?.Dispose(); };
            window.Opened += async (_, _) =>
            {
                var checks = new List<string>();
                string assets = NativeSmoke.Argument(args, "--assets") ?? Path.Combine(AppContext.BaseDirectory, "web");
                string report = NativeSmoke.Argument(args, "--report") ?? Path.Combine(Environment.CurrentDirectory, "artifacts", "desktop", "avalonia");
                try
                {
                    server = new LocalAssetServer(assets);
                    client = AvaloniaRichTextHost.Connect(view, server.EditorUri);
                    if (!args.Contains("--smoke")) return;
                    await NativeSmoke.RunAsync(client, code => view.InvokeScript(code), checks);
                    Directory.CreateDirectory(report);
                    await using var pdf = await view.PrintToPdfStreamAsync();
                    NativeSmoke.Require(pdf is not null, "Native WebView PDF rendering is unavailable");
                    await using (var output = File.Create(Path.Combine(report, "avalonia-rendered.pdf"))) await pdf!.CopyToAsync(output);
                    NativeSmoke.Require(new FileInfo(Path.Combine(report, "avalonia-rendered.pdf")).Length > 1000, "Native rendered PDF output");
                    checks.Add("Avalonia native WebView produced rendered PDF output");
                    await NativeSmoke.ReportAsync(report, "avalonia-webview", true, checks);
                    desktop.Shutdown(0);
                }
                catch (Exception error)
                {
                    Console.Error.WriteLine(error);
                    await NativeSmoke.ReportAsync(report, "avalonia-webview", false, checks, error);
                    desktop.Shutdown(1);
                }
            };
        }
        base.OnFrameworkInitializationCompleted();
    }
}
