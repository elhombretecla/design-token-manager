/**
 * shared/types.ts
 *
 * UI-side view models. They are derived from the plugin's CatalogSnapshot
 * (see protocol.ts) plus the resolver output for the current context.
 */

import type { ResolutionStatus } from "./resolver";

export interface SerializedSet {
  id: string;
  name: string;
  active: boolean;
  tokenCount: number;
}

export interface SerializedToken {
  id: string;
  name: string;
  type: string;
  value: string;
  description: string;
  /** Value resolved in the current context (undefined if it can't be). */
  resolvedValue?: string;
  resolveStatus?: ResolutionStatus;
  /** Referenced names that don't exist in the current context. */
  missingRefs?: string[];
  resolveError?: string;
}

export interface SerializedTheme {
  id: string;
  group: string;
  name: string;
  active: boolean;
  setIds: string[];
}

export interface AliasPickerSet {
  setId: string;
  setName: string;
  tokens: SerializedToken[];
}

// ── UI-level sort state ───────────────────────────────────────────────────

export type SortKey = "name" | "value" | "resolvedValue" | "type";
