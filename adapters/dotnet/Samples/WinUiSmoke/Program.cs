using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;
using RichTextWeb;

internal static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        WinRT.ComWrappersSupport.InitializeComWrappers();
        Application.Start(initialization =>
        {
            SynchronizationContext.SetSynchronizationContext(new DispatcherQueueSynchronizationContext(DispatcherQueue.GetForCurrentThread()));
            _ = new SmokeApplication(args);
        });
        return Environment.ExitCode;
    }
}
internal sealed class SmokeApplication : Application
{
    private readonly string[] _args;
    private Window? _window;
    public SmokeApplication(string[] args) => _args = args;
    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        var view = new WebView2();
        _window = new Window { Title = "RichTextWeb WinUI editor", Content = view };
        _window.AppWindow.Resize(new Windows.Graphics.SizeInt32(1120, 820));
        bool initialized = false;
        RichTextDocumentClient? client = null;
        _window.Closed += (_, _) => { client?.Dispose(); view.Close(); };
        view.Loaded += async (_, _) =>
        {
            if (initialized) return;
            initialized = true;
            var checks = new List<string>();
            var assets = NativeSmoke.Argument(_args, "--assets") ?? Path.Combine(AppContext.BaseDirectory, "web");
            var report = NativeSmoke.Argument(_args, "--report") ?? Path.Combine(Environment.CurrentDirectory, "artifacts", "desktop", "winui");
            try
            {
                client = await WinUiRichTextHost.ConnectAsync(view, assets).WaitAsync(TimeSpan.FromSeconds(90));
                if (!_args.Contains("--smoke")) return;
                await NativeSmoke.RunAsync(client, async code => await view.ExecuteScriptAsync(code), checks);
                Directory.CreateDirectory(report);
                using var image = File.Create(Path.Combine(report, "winui-webview2.png"));
                using var randomAccessImage = image.AsRandomAccessStream();
                await view.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, randomAccessImage);
                checks.Add("Native WinUI WebView2 captured the rendered editor image");
                await NativeSmoke.ReportAsync(report, "winui-webview2", true, checks);
                Environment.ExitCode = 0; Exit();
            }
            catch (Exception error)
            {
                Console.Error.WriteLine(error);
                await NativeSmoke.ReportAsync(report, "winui-webview2", false, checks, error);
                Environment.ExitCode = 1; Exit();
            }
        };
        _window.Activate();
    }
}
