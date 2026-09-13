using System;
using System.IO;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;
using Microsoft.UI.Xaml.Controls;

namespace RichTextWeb;

public static class WinUiRichTextHost
{
    /// <summary>Call on the UI thread after the control is loaded.</summary>
    public static async Task<RichTextDocumentClient> ConnectAsync(WebView2 control, string assetsDirectory)
    {
        await control.EnsureCoreWebView2Async();
        control.CoreWebView2.SetVirtualHostNameToFolderMapping("richtextweb.local", Path.GetFullPath(assetsDirectory), CoreWebView2HostResourceAccessKind.DenyCors);
        var uri = new Uri("https://richtextweb.local/editor.html");
        var client = new RichTextDocumentClient(new CoreWebView2Transport(control.CoreWebView2, uri));
        control.Source = uri;
        return client;
    }
}
