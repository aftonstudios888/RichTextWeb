# RichTextWeb.Blazor 0.4.0

Add .NET 8 / .NET 10 rich-text and paginated editors, read-only flow viewers, native toolbar, revision-aware two-way content binding, EditForm InputBase integration, document-format services and the native PDF workspace. Bundle local JavaScript, PDF worker/decoders/maps/profiles and dependency licenses without distributing font binaries or requiring npm/CDN access for consumers.

Add actual-package WebAssembly and Server samples that verify field changes, measured pagination, DOCX/PDF export, PDF search/save and lifecycle cleanup. NuGet and blazor-v* release publishing are gated on successful validation.

Native engine compatibility boundaries remain unchanged. Generic interop covers APIs beyond typed convenience methods, and synchronous callbacks remain browser functions. PDF overlays are not secure redaction; reconstructed-flow export creates a new document rather than preserving arbitrary original operators.
