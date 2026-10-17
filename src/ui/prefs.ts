/**
 * ui/prefs.ts
 *
 * Per-viewer UI preferences kept in the iframe's localStorage (column
 * widths, collapsed groups, last open set…). Storage can be unavailable
 * (private mode, blocked site data), so every access is guarded and the UI
 * works with the defaults.
 */

const KEY = "dtm-prefs-v2";

export type GroupMode = "none" | "path" | "type";
export type ResolveMode = "set-on-top" | "active" | `theme:${string}`;

export interface Prefs {
  resolveMode: ResolveMode;
  lastSetId: string | null;
  colWidths: number[] | null;
  collapsedSetGroups: string[];
  collapsedTokenGroups: string[];
  groupMode: GroupMode;
  selectionOpen: boolean;
  sidebarCollapsed: boolean;
}

const DEFAULTS: Prefs = {
  resolveMode: "set-on-top",
  lastSetId: null,
  colWidths: null,
  collapsedSetGroups: [],
  collapsedTokenGroups: [],
  groupMode: "path",
  selectionOpen: false,
  sidebarCollapsed: false,
};

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    return { ...DEFAULTS };
  }
}

const prefs = load();

export function getPref<K extends keyof Prefs>(key: K): Prefs[K] {
  return prefs[key];
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  prefs[key] = value;
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable: keep the in-memory value */
  }
}
