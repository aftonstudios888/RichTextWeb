# Document features and reusable toolbar

`DocumentFeatures` operates on an existing `RichTextEngine`. It uses the same model, history and notifications as `RichTextBox`, React and the desktop bridge. No sample application is required.

```ts
import {
  DocumentFeatures,
  createField,
  Paragraph,
  Run,
} from "@wieslawsoltes/richtextweb";
const features = new DocumentFeatures(editor.Engine);
features.InsertField("MERGEFIELD", "Customer");
features.InsertNote("Footnote", "Source: project research, September 2026.");
features.InsertTableOfContents({ MaxLevel: 3 });

const footer = new Paragraph([
  new Run("Page "),
  createField("PAGE"),
  new Run(" of "),
  createField("NUMPAGES"),
]);
features.SetStory("Footers", [footer.ToJSON()]);
features.UpdateFields({ PageNumber: 1, PageCount: 4 });

const documents = features.MailMerge([
  { Customer: "Ada" },
  { Customer: "Grace" },
]);
```

Fields are ordinary `Span` nodes with `props.Field` containing `Type`, `Instruction`, optional `Argument` and `Format`. Children contain the cached result, so every editor and serializer can display text even when a field cannot be resolved. Supported evaluator types are PAGE, NUMPAGES, DATE, TIME, REF, PAGEREF, MERGEFIELD, SEQ, TITLE, AUTHOR and FILENAME. Instructions are data; they never execute scripts, DDE or macros. Unknown instructions retain their cached result and appear in `FieldUpdateResult.Unresolved`. PAGE and NUMPAGES require page context; a paginated viewer substitutes those fields for each visible page. REF accepts a node ID or bookmark name. PAGEREF accepts a node ID or bookmark name with `PageOfNode`. Named bookmarks resolve through their containing paragraph, with a containing-run fallback for renderers that index run IDs. Numeric fields support roman, ROMAN, alphabetic and ALPHABETIC formats. DATE supports `ISO`; its default is an explicit locale with UTC date formatting.

`FieldUpdateResult` reports `Updated`, `Unresolved` and `TextChanges`. Each text change contains `{ Start, RemovedLength, InsertedLength }` in the main document's **pre-update UTF-16 coordinates**; header/footer and note updates do not contribute main-document spans. References read one consistent source snapshot while field results update. The updater maps bookmarks and comments through exact field replacements, and the engine uses the same spans to preserve live text pointers and undo/redo positions, including when several fields change around repeated text. These spans are also available to callers of the detached-tree `updateDocumentFields` function.

Table-of-contents sections collect heading paragraphs, keep their target IDs, and regenerate through `UpdateTableOfContents`. Supply `PageOfNode` to include measured page numbers. Generated entries are cached paragraphs; automatic background update and Word's full TOC instruction language are not implemented.

Headers and footers are block arrays on the document or section. `Headers` and `Footers` provide the default; `FirstPageHeader`, `FirstPageFooter`, `EvenPageHeader` and `EvenPageFooter` override page variants. Notes use `Footnotes` / `Endnotes` arrays of `{Id, Blocks}` and inline `Run` references with `NoteReference:{Kind,Id}`. `InsertNote` stores the definition and inserts the reference in one undoable change. `UpdateNote` changes the definition. These metadata structures survive canonical JSON and the supported DOCX paths.

Mail merge creates independent documents and leaves the template unchanged. Only scalar string, number and boolean record values are substituted. Missing data preserves the visible merge-field placeholder and is reported by the lower-level field updater. This provides document generation; it does not send messages or connect to external recipient lists.

## Reusable toolbar

```html
<rich-text-toolbar for="editor" mode="all"></rich-text-toolbar>
<rich-text-box id="editor"></rich-text-box>
```

Call `registerRichTextWeb()` after the elements exist, or assign `toolbar.Editor = editor`. `RichTextToolbar` is exported from the root and `/web` entry points. Its `Mode` property accepts `home`, `insert`, `layout`, `review` or `all`. Set `Editor` directly from React refs, other frameworks or MVVM view setup. `Target` is the `for` attribute's ID.

The toolbar provides typography, paragraphs, lists, tables, links, images, fields, contents, notes, headers/footers, page setup, find/replace, comments/bookmarks and tracked-change review. Dialogs live inside the control's shadow root. Selection survives toolbar interactions, and every dialog submission checks the attached editor's current read-only state.

`Execute(command, parameter?)` drives the same actions from application menus. `Refresh()` updates command state, and `Dispose()` releases subscriptions. The control emits `commandexecuted`, `commanderror`, `previewrequest` and `documentsgenerated` events. The host displays a `FlowDocumentPageViewer` for `previewrequest`, and saves or presents the independent documents from `documentsgenerated`. This keeps file delivery and application navigation under host control.

Style the toolbar with `--rt-toolbar-background`, `--rt-toolbar-color`, `--rt-toolbar-border`, `--rt-toolbar-hover` and `--rt-ui-font`. Shadow parts `toolbar` and `dialog` provide additional styling hooks. Buttons use accessible names and live error status; physical assistive-technology qualification is separate from automated browser checks.
