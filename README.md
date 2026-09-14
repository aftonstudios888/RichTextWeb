# RichTextWeb

Reusable rich-text engine, flow documents, browser controls, document formats and Blazor components.

[![npm](https://img.shields.io/npm/v/%40wieslawsoltes%2Frichtextweb)](https://www.npmjs.com/package/@wieslawsoltes/richtextweb)
[![npm downloads](https://img.shields.io/npm/dm/%40wieslawsoltes%2Frichtextweb)](https://www.npmjs.com/package/@wieslawsoltes/richtextweb)
[![NuGet](https://img.shields.io/nuget/v/RichTextWeb.Blazor)](https://www.nuget.org/packages/RichTextWeb.Blazor)
[![NuGet downloads](https://img.shields.io/nuget/dt/RichTextWeb.Blazor)](https://www.nuget.org/packages/RichTextWeb.Blazor)
[![Blazor CI](https://github.com/wieslawsoltes/RichTextWeb/actions/workflows/blazor.yml/badge.svg)](https://github.com/wieslawsoltes/RichTextWeb/actions/workflows/blazor.yml)

## JavaScript and desktop adapters

```sh
npm install @wieslawsoltes/richtextweb
```

The [complete original guide](README.web.md) preserves JavaScript/React/MVVM usage, desktop adapters, architecture, tests, compatibility matrices and licensing. [Open the web demo](https://wieslawsoltes.github.io/RichTextWeb/).

## Blazor

```sh
dotnet add package RichTextWeb.Blazor --version 0.4.1
```

The .NET 8/.NET 10 RCL supports interactive WebAssembly and Server, with locally packaged native rich-text/PDF assets and worker. It includes `RichTextEditor`, `RichTextPageEditor`, read-only flow viewers, `RichTextInput` with EditForm integration, format services and `PdfEditor`. Consumers need neither npm nor a CDN; fonts are not implicitly downloaded.

```razor
@using RichTextWeb.Blazor
<RichTextEditor @bind-Value="html" ValueFormat="html" Theme="light" />
@code {
    private string? html = "<p>Edit this document.</p>";
}
```

See the [Blazor guide](blazor/README.md), [integration contract](blazor/INTEGRATION.md), [sample](blazor/sample/Demo.razor) and [release notes](blazor/RELEASE.md). Typed APIs are complemented by native object/function interop. Underlying document/pagination/PDF/collaboration compatibility limits remain unchanged; this package is not an exhaustive C# desktop-framework port.

```sh
git submodule update --init --recursive
npm ci
npm run build
node blazor/build.mjs
dotnet run --project blazor/sample/Sample.csproj
# Or: dotnet run --project blazor/server/Server.csproj
```

Source builds require the .NET 10 SDK with .NET 8 targeting support. The Server sample uses `/probe/`. CI tests actual NuGet consumers on both frameworks/hosts, including EditForm field notifications, full binding values, pagination, DOCX/PDF output, PDF search/view switching, streams, Razor callbacks and remounting.

NuGet versions are independent of npm in `blazor/Version.props`. Version-changing main merges publish after validation using `NUGET_API_KEY` (`NUGET_TOKEN`/`NUGET_KEY` aliases), verify public package payloads and create `blazor-v*` releases with symbols, samples and checksums. See [LICENSE](LICENSE), [NOTICE](NOTICE) and native compatibility documentation in the original guide.
