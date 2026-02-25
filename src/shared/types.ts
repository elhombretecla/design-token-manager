/**
 * shared/types.ts
 *
 * Shared data-transfer interfaces that cross the UI ↔ plugin boundary.
 * These types are used on the UI side (main.ts) and describe the serialised
 * payloads that arrive from the plugin sandbox via postMessage.
 *
 * The plugin sandbox (plugin.ts) has its OWN internal types (IToken,
 * ITokenSet, etc.) which are intentionally NOT shared here — they only
 * exist inside the Penpot sandbox runtime.
 */

// ── Serialised Penpot entities ────────────────────────────────────────────

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
  resolvedValue?: string;
}

export interface SerializedTheme {
  id: string;
  group: string;
  name: string;
  active: boolean;
}

export interface AliasPickerSet {
  setId: string;
  setName: string;
  tokens: SerializedToken[];
}

// ── Message protocol (plugin sandbox → UI iframe) ─────────────────────────
// Messages sent from the plugin sandbox to the UI via penpot.ui.sendMessage.

export type PluginMessage =
  | { source: "penpot"; type: "themechange"; theme: string }
  | { type: "loaded"; sets: SerializedSet[]; themes: SerializedTheme[] }
  | { type: "tokens-loaded"; setId: string; tokens: SerializedToken[] }
  | { type: "sets-updated"; sets: SerializedSet[]; themes: SerializedTheme[] }
  | { type: "tokens-updated"; setId: string; tokens: SerializedToken[] }
  | { type: "all-tokens-by-type-loaded"; tokenType: string; sets: AliasPickerSet[] }
  | { type: "fonts-loaded"; fonts: string[] }
  | { type: "error"; message: string };

// ── UI-level sort state ───────────────────────────────────────────────────

export type SortKey = "name" | "value" | "resolvedValue" | "type";
