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
  /** `newName` renames the token in the target set (name-conflict resolution). */
  | { op: "move-token"; fromSetId: string; toSetId: string; tokenId: string; copy: boolean; newName?: string }
  | { op: "set-set-active"; setId: string; active: boolean }
  /** `setNames` lets imports reference sets created earlier in the batch. */
  | { op: "create-theme"; group: string; name: string; setIds?: string[]; setNames?: string[] }
  | { op: "update-theme"; themeId: string; group: string; name: string }
  | { op: "duplicate-theme"; themeId: string }
  | { op: "delete-theme"; themeId: string }
  | { op: "set-theme-active"; themeId: string; active: boolean }
  /** Replace the theme's set list with exactly `setIds`. */
  | { op: "set-theme-sets"; themeId: string; setIds: string[] }
  /** Apply to the current selection, one call per property; properties
   *  already carrying this token on every shape are skipped (Penpot's apply
   *  is a toggle and would remove them). */
  | { op: "apply-token"; setId: string; tokenId: string; properties: string[] }
  /** Remove a token (by name) from properties of the given shapes. */
  | { op: "unapply-token"; tokenName: string; shapeIds: string[]; properties: string[] }
  /** `pageId` switches to that page first when it isn't the current one. */
  | { op: "select-shapes"; shapeIds: string[]; pageId?: string }
  /** Select the shapes on the current page that use a token. */
  | { op: "select-token-usages"; tokenName: string }
  /** Create the set if needed and add its tokens; `mode` decides what
   *  happens to tokens that already exist with the same name. */
  | { op: "import-set"; name: string; tokens: ImportToken[]; mode: "skip" | "overwrite" };

export interface ImportToken {
  name: string;
  type: string;
  value: string;
  description: string;
}

export type UiMessage =
  | { type: "init" }
  | { type: "validate"; reqId: number }
  | { type: "scan-fonts" }
  | { type: "ops"; reqId: number; ops: Op[] };

// ── Plugin → UI ───────────────────────────────────────────────────────────

export interface OpResult {
  ok: boolean;
  error?: string;
  /** Optional summary for the user (e.g. "Selected 3 shapes"). */
  message?: string;
}

export interface SelectionShape {
  id: string;
  name: string;
  type: string;
  /** `shape.tokens`: property → token name. */
  tokens: Record<string, string>;
}

export interface SelectionInfo {
  /** Detailed shapes (capped); `total` is the full selection size. */
  shapes: SelectionShape[];
  total: number;
}

export interface FileIssue {
  code: string;
  hint: string;
  shapeId: string | null;
  pageId: string | null;
}

export interface ValidationReport {
  /** False when the running Penpot has no `file.validate()`. */
  validateAvailable: boolean;
  fileIssues: FileIssue[];
  pageId: string;
  pageName: string;
  /** Token names applied on the current page, with the shapes using them. */
  applied: { name: string; shapeIds: string[] }[];
}

export type PluginMessage =
  | { source: "penpot"; type: "themechange"; theme: string }
  | { type: "snapshot"; snapshot: CatalogSnapshot }
  | { type: "ops-result"; reqId: number; results: OpResult[] }
  | { type: "selection"; selection: SelectionInfo }
  | { type: "validation"; reqId: number; report: ValidationReport }
  | { type: "fonts-loaded"; fonts: string[] }
  | { type: "error"; message: string }
  | { type: "unsupported"; penpotVersion: string };
