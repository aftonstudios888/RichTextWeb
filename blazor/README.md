# RichTextWeb.Blazor

Install `RichTextWeb.Blazor` 0.4.0 for .NET 8/.NET 10. The package includes the actual native browser editor/format/PDF engine and local PDF worker/decoders/maps/profiles. Fonts are not distributed or implicitly downloaded.

## Editing and binding

`RichTextEditor` owns the native WYSIWYG DOM and supports `@bind-Value`. ValueFormat accepts html, text, json, rtf, markdown and xaml. The full value is read through streaming when a revision notification arrives; bounded diagnostic event snapshots are never used as document contents. Revision acknowledgements prevent a stale Server round trip from overwriting newer browser edits. Increment ValueRevision to force an intentional replacement. Document can instead reference a caller-owned native FlowDocument.

Use RichTextPageEditor for measured editable pages, FlowDocumentReader/FlowDocumentScrollViewer/FlowDocumentPageViewer for read-only presentation. Theme, toolbar visibility/mode, read-only state, zoom, page/continuous mode, virtualization settings, placeholder and accessibility label are exposed. Advanced native options remain available through Options. Wait for Ready before selection, focus, command, undo/redo, pagination and format operations.

```razor
<EditForm Model="model" OnSubmit="Submit">
    <DataAnnotationsValidator />
    <RichTextInput @ref="input" @bind-Value="model.Body" ControlKind="pageEditor" />
    <ValidationMessage For="@(() => model.Body)" />
    <button type="submit">Save</button>
</EditForm>
```

RichTextInput derives from InputBase and integrates ValueExpression, EditContext field notifications, CSS state and validation. Its default debounce is zero; call `await input.FlushAsync()` before validation/save when using a nonzero debounce. Flush before navigation/unmount to commit pending edits. Required validation of HTML checks its serialized string, not semantic document emptiness; implement a content validator when that distinction matters.

## Formats and PDF

`ExportBytesAsync`/`ImportBytesAsync` support the native formats, with DOCX/PDF binary and textual format encodings. An asynchronous import is rejected if the document changes before it completes. Native Document/Engine/Editor handles expose richer structure and collaboration APIs without discarding identity.

PdfEditor exposes source loading, saving, search, page operations, history, fit, native editor access through generic interop, reconstruction to flow and reflow export. `SetViewModeAsync("flow")` initializes reconstructed content before switching; `SetViewModeAsync("pdf")` restores the source view. The ViewMode parameter uses the same path. SourceRevision signals intentional byte-source updates. PDF source edits and reconstructed flow are separate representations; Save preserves source edits, ExportReflow emits the reconstructed document. A visual cover is not secure redaction. Original PDF-text editing is limited by the native engine's supported operators/fonts.

The [sample](sample/Demo.razor) checks real EditForm modifications, pagination, DOCX/PDF output, PDF search/save and both PDF view transitions. Read [INTEGRATION.md](INTEGRATION.md) for hosting, streaming, callbacks, ownership and release processes.
