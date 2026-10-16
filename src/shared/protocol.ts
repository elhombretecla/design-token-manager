/**
 * shared/protocol.ts
 *
 * Message protocol between the plugin sandbox (plugin.ts) and the UI iframe
 * (main.ts), plus the catalog snapshot the plugin publishes.
 *
 * Data flow:
 *   • The plugin owns the truth. It publishes a full `CatalogSnapshot`
 *     whenever the catalog changes (after an operation, on `contentsave`,
 *     or when its periodic check notices an external edit).
 *   • The UI never asks for partial data; it derives every view (token
 *     table, alias picker, comparison, resolved values) from the snapshot.
 *   • Mutations travel as a list of `Op`s tagged with a `reqId`; the plugin
 *     answers with one `OpResult` per op so the UI can report failures.
 */

// ── Snapshot ──────────────────────────────────────────────────────────────

export interface SnapshotToken {
  id: string;
  name: string;
  type: string;
  /** Display/edit form of the value (composites as JSON strings). */
  value: string;
  description: string;
  /** Penpot's own resolved value (active sets only); kept as a fallback. */
  penpotResolved?: string;
}

export interface SnapshotSet {
  id: string;
  name: string;
  active: boolean;
  tokens: SnapshotToken[];
}

export interface SnapshotTheme {
  id: string;
  group: string;
  name: string;
  active: boolean;
  /** Ids of the sets this theme activates. */
  setIds: string[];
}

export interface CatalogSnapshot {
  /** In Penpot's order: on a name clash, the later active set wins. */
  sets: SnapshotSet[];
  themes: SnapshotTheme[];
}

// ── Operations (UI → plugin) ──────────────────────────────────────────────

export type Op =
  | { op: "create-set"; name: string }
  | { op: "rename-set"; setId: string; newName: string }
  | { op: "duplicate-set"; setId: string }
  | { op: "delete-set"; setId: string }
  | { op: "create-token"; setId: string; tokenType: string; name: string; value: string; description: string }
  | { op: "update-token"; setId: string; tokenId: string; name: string; value: string; description: string }
  | { op: "duplicate-token"; setId: string; tokenId: string }
  | { op: "delete-token"; setId: string; tokenId: string }
  | { op: "move-token"; fromSetId: string; toSetId: string; tokenId: string; copy: boolean };

export type UiMessage =
  | { type: "init" }
  | { type: "scan-fonts" }
  | { type: "ops"; reqId: number; ops: Op[] };

// ── Plugin → UI ───────────────────────────────────────────────────────────

export interface OpResult {
  ok: boolean;
  error?: string;
}

export type PluginMessage =
  | { source: "penpot"; type: "themechange"; theme: string }
  | { type: "snapshot"; snapshot: CatalogSnapshot }
  | { type: "ops-result"; reqId: number; results: OpResult[] }
  | { type: "fonts-loaded"; fonts: string[] }
  | { type: "error"; message: string }
  | { type: "unsupported"; penpotVersion: string };
