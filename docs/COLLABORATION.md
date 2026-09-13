# Rich document coauthoring

`CollaborativeDocumentSession` shares a complete `FlowDocument` between existing `RichTextEngine` instances and therefore between `RichTextBox`, framework wrappers, and desktop bridge hosts. It is exported from the root, core, and collaboration entry points. The previous `CollaborativeTextSession` and its protocol remain compatible.

```ts
import {
  CollaborativeDocumentSession,
  FlowDocument,
  RichTextEngine,
} from "@wieslawsoltes/richtextweb/core";

const seed = originalDocument.ToJSON(); // Preserve the SAME node IDs on every peer.
const alice = new CollaborativeDocumentSession({
  DocumentId: "report-2026",
  ActorId: "alice-device-1",
  Document: seed,
});
const bob = new CollaborativeDocumentSession({
  DocumentId: "report-2026",
  ActorId: "bob-device-1",
  Document: seed,
});
const left = new RichTextEngine(FlowDocument.FromJSON(seed));
const right = new RichTextEngine(FlowDocument.FromJSON(seed));
const bindings = [alice.BindEngine(left), bob.BindEngine(right)];
const wires = [
  alice.OperationGenerated.Subscribe((operation) => bob.Receive(operation)),
  bob.OperationGenerated.Subscribe((operation) => alice.Receive(operation)),
];
// Bind existing rich controls to left/right. Their normal commands now replicate.
// On disposal, call Dispose() on each binding and transport subscription.
```

Use a unique actor ID per concurrently active writer. Persist its snapshot before reusing its actor ID. Model-generated node IDs are UUIDs where Web Crypto is available. Imported or application-assigned IDs must also be globally unique; conflicting reuse is rejected. Independent calls to `fromText` create different IDs and are not a shared seed.

## Protocol and merge behavior

Protocol 2 carries atomic transactions. Every transaction has a document identity, checkpoint epoch, initial-content fingerprint, actor sequence, Lamport clock, causal version vector, and node/property/text actions. Invalid ready transactions are rejected before any state is committed. Out-of-order transactions wait in a bounded causal queue; exact duplicate delivery is idempotent, and reusing an accepted operation identity with different content is rejected.

| Content                                                                                               | Merge rule                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Run text                                                                                              | Replicated character sequence. Concurrent insertions survive overlapping deletions. Offsets are UTF-16; surrogate pairs cannot be split.                                                         |
| Paragraphs, sections, lists, inline objects, figures/floater bodies, tables, rows, cells, and columns | Stable node identities and replicated ordering placements. Concurrent inserts retain both subtrees. Old placements remain as ordering anchors after removal or movement.                         |
| Node movement                                                                                         | Deterministic Lamport/actor ordering with cycle detection and fallback to earlier valid placements. Crossed concurrent moves cannot create cyclic document trees.                                |
| Node properties                                                                                       | Separate last-writer registers per property, ordered by causal clock and actor identity. Independent property changes merge.                                                                     |
| Deletion and restore                                                                                  | Deletion hides an observed subtree. Children inserted concurrently into a deleted container remain retained but hidden. A causally acknowledged restore can expose the retained content.         |
| Comments, bookmarks, tracked revisions                                                                | `Annotations` entries merge by `Id`, with per-entry update/delete registers. Independent annotations survive. Concurrent changes to the same annotation use deterministic last-writer selection. |
| Other structured property values                                                                      | Each value is atomic. For example, concurrently replacing the same header/story property selects one value; it does not merge the story's interior.                                              |

The engine binding captures each completed engine transaction by stable identity. It uses a longest increasing subsequence per child collection to retain unchanged ordering, and per-Run text differences instead of replacing the whole document as a network message. The receiver reconciles through the engine, retaining matching live model objects. Text-session forks copy the current CRDT state without replaying its entire history.

Remote application clears local undo/redo through `ApplyRemoteDocument`: ordinary snapshot/patch history is not a collaborative selective-undo algorithm. Local undo before a remote transaction is itself captured as another shared edit. Review inverse patches may report a conflict after another participant changes their target; they do not silently overwrite that participant's work.

## Direct model operations

The session can be used without a control:

```ts
session.InsertNode(parentId, index, paragraph.ToJSON());
session.MoveNode(nodeId, parentId, finalIndex);
session.RemoveNode(nodeId);
session.RestoreNodes([nodeId, ...descendantIds]);
session.SetProperty(nodeId, "TextAlignment", "Center");
session.ClearProperty(nodeId, "Background");
session.ReplaceText(runId, start, end, "replacement");
session.InsertNode(tableId, index, column.ToJSON(), "Columns");
session.UpdateDocument(editedFlowDocument);
```

`MoveNode` uses the final index after excluding the moved node from its destination siblings. `InsertNode` accepts a subtree and produces one atomic transaction. `UpdateDocument` accepts a document with the same root and node identities. Inserted nodes must have fresh IDs. A node's element type cannot change while keeping its ID.

Observe `Changed`, `OperationGenerated`, and `Conflict`; inspect `VersionVector`, `PendingCount`, `ResyncRequired`, `RequiresCompaction`, and `Statistics`. `Receive` returns `applied`, `queued`, or `duplicate`.

## Durable snapshots and agreed compaction

`ExportSnapshot()` retains the seed and accepted operations, including text/node tombstones and ordering anchors. `FromSnapshot(snapshot, actorId)` reconstructs them, checks causal completeness, and permits further editing. Snapshot operations may be serialized in a different order. A snapshot does not include undelivered pending operations; persist those in the transport outbox and replay them afterward.

```ts
const snapshot = session.ExportSnapshot();
const resumed = CollaborativeDocumentSession.FromSnapshot(
  snapshot,
  "new-device",
);
```

Compaction is an explicit epoch change, not a time-based deletion of tombstones:

```ts
const acknowledgements = {
  "alice-device-1": alice.VersionVector,
  "bob-device-1": bob.VersionVector,
};
const checkpoint = alice.CreateCheckpoint(acknowledgements);
alice.AdoptCheckpoint(checkpoint);
bob.AdoptCheckpoint(checkpoint);
```

Every known participant must acknowledge exactly the same complete frontier. Pending operations block compaction. Adoption checks the current document and frontier again, so a participant that edited after acknowledging cannot silently discard those edits. The compact snapshot has a new epoch, a current seed, no historical operations, and no old text/node tombstones. Bound engines clear undo/redo at adoption so obsolete history cannot reintroduce retired identities. Late old-epoch packets are rejected explicitly. An application must coordinate membership and drain durable outboxes before adopting; an offline actor's acknowledgement cannot be invented. Rejoining an older actor requires an application reconciliation/resynchronization decision.

## Operational boundaries

This library supplies deterministic local replication, not a hosted coauthoring service. Applications supply authentication, authorization, encrypted transport, durable snapshots/outboxes, actor membership, and checkpoint acknowledgement provenance. Fingerprints detect accidental identity/content mismatches; they are not cryptographic authentication.

Character edits merge within a stable Run. Structural normalization that splits/moves text between different Runs is represented by the corresponding node and text changes; it is not a semantic relocation of the original character identities. Concurrent splits, formatting of overlapping ranges that split Runs, and other structural rewrites can therefore produce a deterministic result different from a human editor's preferred intent. Annotation ranges are stored offsets and same-entry updates use last-writer selection; revision acceptance/rejection must respect the engine's conflict checks after concurrent changes. These are explicit protocol semantics, not a claim of matching Word's coauthoring service.

Operations are limited to 20,000 actions and 16 MiB of serialized JSON. Large replacements split into surrogate-safe character chunks inside one atomic rich transaction; the existing per-Run text protocol still bounds local retained characters. The causal queue defaults to 1,000 transactions. Rendering and transaction capture still perform document/tree work; this protocol does not itself make all editing costs independent of document size. The sample's “Coauthor” workspace exercises two real reusable controls, paused/reversed delivery, tables, pictures, paragraphs, formatting, and acknowledged compaction.
