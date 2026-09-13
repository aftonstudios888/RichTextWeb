# Document Studio sample dependencies

The Document Studio sample integrates the following published libraries. These are sample dependencies; RichTextWeb's document engine and controls do not import them.

| Library                                                             | Use in the sample                                                                    | License                          |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------- |
| [RibbonWeb](https://github.com/wieslawsoltes/RibbonWeb)             | Main ribbon, quick access, command search, galleries, backstage, responsive commands | MIT                              |
| [Dockyard](https://github.com/wieslawsoltes/Dockyard)               | Document and tool panes, docking, floating, auto-hide, layout persistence            | MIT                              |
| [TreeDataGridWeb](https://github.com/wieslawsoltes/TreeDataGridWeb) | Virtualized document explorer with styles, revisions, fields, headings, and objects  | MIT                              |
| [DynamicDataWeb](https://github.com/wieslawsoltes/DynamicDataWeb)   | Keyed document item cache with incremental updates, filtering and sorting            | MIT                              |
| [ReactiveWeb](https://github.com/wieslawsoltes/ReactiveWeb)         | Observable sample view model, commands, status bindings and subscription ownership   | MIT                              |
| [RBushWeb](https://github.com/wieslawsoltes/RBushWeb)               | Bounds index, point hit testing and nearest-object navigation                        | MIT                              |
| [QuikGraphWeb](https://github.com/wieslawsoltes/QuikGraphWeb)       | Document/reference graph, related-item traversal and interactive viewer              | Microsoft Public License (MS-PL) |
| [RxJS](https://github.com/ReactiveX/rxjs)                           | Observable streams used by ReactiveWeb and DynamicDataWeb                            | Apache-2.0                       |

The built sample includes the full license texts in `licenses/` and exact package versions in `sample-dependencies.json`. QuikGraphWeb-derived sample bundle portions retain the MS-PL terms; they are not relicensed as MIT. The engine's PDF and format dependencies retain their separate licenses and notices.

All document operations are performed by RichTextWeb's reusable controls and engine. RibbonWeb command handlers call `RichTextToolbar.Execute`; the complete toolbar remains available in the dockable All tools pane. The sample's two-peer collaboration transport runs locally for demonstration and does not provide a hosted collaboration service.
