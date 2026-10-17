/**
 * ui/store.ts
 *
 * Application state as Preact signals, plus the derived data every view
 * reads. The plugin publishes a full CatalogSnapshot; tokens are resolved
 * here with our own Resolver against the context picked in the header
 * (Penpot's resolvedValue only knows about the active sets).
 *
 * Components read signals directly and re-render when they change; actions
 * below are the only place that writes them.
 */

import { batch, computed, signal } from "@preact/signals";
import type { CatalogSnapshot, SelectionInfo, SnapshotSet, SnapshotToken } from "../shared/protocol";
import { Resolver, type ResolveContext } from "../shared/resolver";
import type { AliasPickerSet, SerializedToken, SortKey } from "../shared/types";
import { getPref, setPref, type GroupMode, type ResolveMode } from "./prefs";

// ── Data from the plugin ─────────────────────────────────────────────────

export const snapshot = signal<CatalogSnapshot>({ sets: [], themes: [] });
/** False until the first snapshot arrives (shows a loading state). */
export const loaded = signal(false);
/** Set when the running Penpot has no token API (plugin API < 1.5). */
export const unsupportedVersion = signal<string | null>(null);
export const selection = signal<SelectionInfo>({ shapes: [], total: 0 });
export const documentFonts = signal<string[]>([]);

// ── UI state ─────────────────────────────────────────────────────────────

export const resolveMode = signal<ResolveMode>(getPref("resolveMode"));
export const selectedSetId = signal<string | null>(null);
export const sidebarCollapsed = signal(getPref("sidebarCollapsed"));
export const setQuery = signal("");
export const overviewQuery = signal("");
export const tokenQuery = signal("");
export const sortKey = signal<SortKey | null>("type");
export const sortDir = signal<"asc" | "desc">("asc");
export const groupMode = signal<GroupMode>(getPref("groupMode"));
export const selectedTokenIds = signal<ReadonlySet<string>>(new Set());
export const collapsedSetGroups = signal<ReadonlySet<string>>(new Set(getPref("collapsedSetGroups")));
export const collapsedTokenGroups = signal<ReadonlySet<string>>(new Set(getPref("collapsedTokenGroups")));
export const selectionOpen = signal(getPref("selectionOpen"));
/** Token row to scroll to and highlight once (after "show token"). */
export const flashTokenId = signal<string | null>(null);

export interface CompareColumn {
  kind: "set" | "theme";
  id: string;
}

export const compare = signal<{ primarySetId: string; columns: CompareColumn[] } | null>(null);

// ── Derived data ─────────────────────────────────────────────────────────

export const sets = computed(() => snapshot.value.sets);
export const themes = computed(() => snapshot.value.themes);

/** The resolve mode, falling back when its theme no longer exists. */
export const effectiveResolveMode = computed<ResolveMode>(() => {
  const mode = resolveMode.value;
  if (mode.startsWith("theme:") && !themes.value.some((t) => `theme:${t.id}` === mode)) return "set-on-top";
  return mode;
});

// A fresh resolver cache per snapshot / mode.
const resolverCache = computed(() => {
  void snapshot.value;
  void effectiveResolveMode.value;
  return new Map<string, Resolver>();
});

function cachedResolver(key: string, ctx: ResolveContext): Resolver {
  const cache = resolverCache.value;
  let r = cache.get(key);
  if (!r) {
    r = Resolver.forContext(snapshot.value, ctx);
    cache.set(key, r);
  }
  return r;
}

export function contextFor(setId: string): ResolveContext {
  const mode = effectiveResolveMode.value;
  if (mode === "active") return { kind: "active" };
  if (mode.startsWith("theme:")) return { kind: "theme", themeId: mode.slice(6) };
  return { kind: "set-on-top", setId };
}

/** Resolver for viewing `setId` in the current mode. */
export function resolverFor(setId: string): Resolver {
  const mode = effectiveResolveMode.value;
  return cachedResolver(mode === "set-on-top" ? `set:${setId}` : mode, contextFor(setId));
}

/** Penpot's own context (the active sets), whatever the view mode. */
export function activeResolver(): Resolver {
  return cachedResolver("penpot-active", { kind: "active" });
}

export function themeResolver(themeId: string): Resolver {
  return cachedResolver(`theme:${themeId}`, { kind: "theme", themeId });
}

export function toViewToken(token: SnapshotToken, resolver: Resolver): SerializedToken {
  const r = resolver.resolveToken(token);
  let resolvedValue = r.value;
  // In "as in Penpot" mode, prefer Penpot's own result for anything our
  // evaluator couldn't handle (it has the final word on the canvas).
  if (effectiveResolveMode.value === "active" && r.status !== "ok" && token.penpotResolved) {
    resolvedValue = token.penpotResolved;
  }
  return {
    id: token.id,
    name: token.name,
    type: token.type,
    value: token.value,
    description: token.description,
    resolvedValue,
    resolveStatus: r.status,
    missingRefs: r.missing,
    resolveError: r.error,
  };
}

export function snapshotSet(setId: string | null): SnapshotSet | undefined {
  return setId ? sets.value.find((s) => s.id === setId) : undefined;
}

export function viewTokensForSet(setId: string): SerializedToken[] {
  const set = snapshotSet(setId);
  if (!set) return [];
  const resolver = resolverFor(setId);
  return set.tokens.map((t) => toViewToken(t, resolver));
}

export const selectedSet = computed(() => snapshotSet(selectedSetId.value));
export const selectedTokens = computed(() =>
  selectedSetId.value ? viewTokensForSet(selectedSetId.value) : [],
);

/** Tokens of one type across all sets, for the alias pickers. */
export function pickerSetsFor(tokenType: string): AliasPickerSet[] {
  return sets.value
    .map((set) => {
      const resolver = resolverFor(set.id);
      return {
        setId: set.id,
        setName: set.name,
        tokens: set.tokens.filter((t) => t.type === tokenType).map((t) => toViewToken(t, resolver)),
      };
    })
    .filter((s) => s.tokens.length > 0);
}

export interface NameLocation {
  token: SnapshotToken;
  set: SnapshotSet;
  /** False when only inactive sets define the name. */
  active: boolean;
}

/** Where Penpot would take a token name from (or any set defining it). */
export function locateTokenName(name: string): NameLocation | null {
  const winner = activeResolver().winner(name);
  if (winner) {
    const set = sets.value.find((s) => s.tokens.some((t) => t.id === winner.id));
    if (set) return { token: winner, set, active: true };
  }
  for (const set of sets.value) {
    const token = set.tokens.find((t) => t.name === name);
    if (token) return { token, set, active: false };
  }
  return null;
}

// ── Actions ──────────────────────────────────────────────────────────────

function ancestorsOf(setName: string): string[] {
  const parts = setName.split("/");
  return parts.slice(1).map((_, i) => parts.slice(0, i + 1).join("/"));
}

export function selectSet(setId: string | null): void {
  batch(() => {
    if (compare.value && compare.value.primarySetId !== setId) compare.value = null;
    if (selectedSetId.value !== setId) {
      selectedTokenIds.value = new Set();
      sortKey.value = "type";
      sortDir.value = "asc";
      tokenQuery.value = "";
    }
    selectedSetId.value = setId;
    const set = snapshotSet(setId);
    if (set) {
      const ancestors = ancestorsOf(set.name);
      if (ancestors.some((a) => collapsedSetGroups.value.has(a))) {
        const next = new Set(collapsedSetGroups.value);
        for (const a of ancestors) next.delete(a);
        setCollapsedSetGroups(next);
      }
    }
  });
  setPref("lastSetId", setId);
}

export function setResolveMode(mode: ResolveMode): void {
  resolveMode.value = mode;
  setPref("resolveMode", mode);
}

export function setGroupMode(mode: GroupMode): void {
  groupMode.value = mode;
  setPref("groupMode", mode);
}

export function toggleSidebar(): void {
  sidebarCollapsed.value = !sidebarCollapsed.value;
  setPref("sidebarCollapsed", sidebarCollapsed.value);
}

export function toggleSelectionPanel(): void {
  selectionOpen.value = !selectionOpen.value;
  setPref("selectionOpen", selectionOpen.value);
}

function setCollapsedSetGroups(next: ReadonlySet<string>): void {
  collapsedSetGroups.value = next;
  setPref("collapsedSetGroups", [...next]);
}

export function toggleSetGroup(path: string): void {
  const next = new Set(collapsedSetGroups.value);
  if (next.has(path)) next.delete(path); else next.add(path);
  setCollapsedSetGroups(next);
}

export function toggleTokenGroup(key: string): void {
  const next = new Set(collapsedTokenGroups.value);
  if (next.has(key)) next.delete(key); else next.add(key);
  collapsedTokenGroups.value = next;
  setPref("collapsedTokenGroups", [...next]);
}

export function setSort(key: SortKey): void {
  batch(() => {
    if (sortKey.value === key) {
      sortDir.value = sortDir.value === "asc" ? "desc" : "asc";
    } else {
      sortKey.value = key;
      sortDir.value = "asc";
    }
  });
}

export function setTokenSelected(tokenId: string, selected: boolean): void {
  const next = new Set(selectedTokenIds.value);
  if (selected) next.add(tokenId); else next.delete(tokenId);
  selectedTokenIds.value = next;
}

export function clearTokenSelection(): void {
  selectedTokenIds.value = new Set();
}

export function enterCompare(primarySetId: string): void {
  batch(() => {
    compare.value = null;
    selectSet(primarySetId);
    compare.value = { primarySetId, columns: [] };
  });
}

export function exitCompare(): void {
  compare.value = null;
}

export function addCompareColumn(column: CompareColumn): void {
  const c = compare.value;
  if (!c || c.columns.some((x) => x.kind === column.kind && x.id === column.id)) return;
  compare.value = { ...c, columns: [...c.columns, column] };
}

export function removeCompareColumn(column: CompareColumn): void {
  const c = compare.value;
  if (!c) return;
  compare.value = { ...c, columns: c.columns.filter((x) => !(x.kind === column.kind && x.id === column.id)) };
}

/** Open a set and scroll to (and briefly highlight) one of its tokens. */
export function revealToken(setId: string, tokenId: string): void {
  batch(() => {
    compare.value = null;
    selectSet(setId);
    tokenQuery.value = "";
    flashTokenId.value = tokenId;
  });
}

export function applySnapshot(next: CatalogSnapshot): void {
  batch(() => {
    const first = !loaded.value;
    snapshot.value = next;
    loaded.value = true;

    if (first && selectedSetId.value === null) {
      const last = getPref("lastSetId");
      if (last && next.sets.some((s) => s.id === last)) selectSet(last);
    }
    if (selectedSetId.value && !next.sets.some((s) => s.id === selectedSetId.value)) {
      selectSet(null);
    }

    const ids = new Set(next.sets.flatMap((s) => s.tokens.map((t) => t.id)));
    if ([...selectedTokenIds.value].some((id) => !ids.has(id))) {
      selectedTokenIds.value = new Set([...selectedTokenIds.value].filter((id) => ids.has(id)));
    }

    const c = compare.value;
    if (c) {
      const setIds = new Set(next.sets.map((s) => s.id));
      const themeIds = new Set(next.themes.map((t) => t.id));
      const columns = c.columns.filter((col) => (col.kind === "set" ? setIds : themeIds).has(col.id));
      if (columns.length !== c.columns.length) compare.value = { ...c, columns };
    }
  });
}
