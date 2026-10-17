import "./style.css";
import { FONT_CATALOG } from "./assets/fontCatalog.generated";
import type { SerializedSet, SerializedToken, SerializedTheme, AliasPickerSet, SortKey } from "./shared/types";
import type { CatalogSnapshot, Op, OpResult, PluginMessage, SnapshotSet, SnapshotToken, UiMessage } from "./shared/protocol";
import { Resolver, type ResolveContext } from "./shared/resolver";
import { esc } from "./utils/esc";
import { isAlias, parseMixedValue, referencesName, replaceReference } from "./utils/alias";
import { hsvToRgb, rgbToHsv, hexToRgb, rgbToHex, rgbToHsl, hslToRgb, parseCssColor } from "./utils/color";
import { normalizeShadowLayers, normalizeShadowValueToPreview, shadowLayersToValue } from "./utils/shadowNormalize";
import { sanitizeTypographyValueForApi, normalizeTypographyValueToForm } from "./utils/typographyNormalize";

// Pre-compute a flat sorted array of family names once at module load.
// Used by the font picker to avoid re-mapping on every keystroke.
const CATALOG_FAMILIES: string[] = FONT_CATALOG.map((f) => f.family);

// Maximum catalog rows shown in the picker when no search query is active.
// Prevents DOM overload; users narrow the list by typing.
const CATALOG_MAX_UNFILTERED = 200;

// ════════════════════════════════════════════════════════════════════════
//  STATE
// ════════════════════════════════════════════════════════════════════════

const state = {
  snapshot: { sets: [], themes: [] } as CatalogSnapshot,
  sets: [] as SerializedSet[],
  themes: [] as SerializedTheme[],
  tokens: [] as SerializedToken[],
  selectedSetId: null as string | null,
  sidebarCollapsed: false,
  sortKey: "type" as SortKey | null,
  sortDir: "asc" as "asc" | "desc",
  documentFonts: [] as string[],
};

// ── Bulk-selection state ──────────────────────────────────────────────────
const selectedTokenIds = new Set<string>();

// ── Compare-mode state ────────────────────────────────────────────────────
// Isolated from `state` because it is UI-only (not synced to the plugin).
const compareState = {
  active: false,
  primarySetId: null as string | null,
  comparedSetIds: [] as string[],
  // O(1) token-by-name lookup per compared set, rebuilt from each snapshot.
  comparedTokenMaps: new Map<string, Map<string, SerializedToken>>(),
};

// ── Set tree expansion state ──────────────────────────────────────────────
// Stores group.path values for groups that are manually collapsed.
// Groups are expanded by default; only those explicitly closed are tracked here.
const collapsedGroups = new Set<string>();

type TreeNode =
  | { kind: "group"; path: string; label: string; children: TreeNode[]; hasSet: boolean; setId?: string }
  | { kind: "set"; fullName: string; label: string; setId: string };

function buildSetTree(sets: SerializedSet[]): TreeNode[] {
  type GroupNode = Extract<TreeNode, { kind: "group" }>;

  // Identify which slash-separated prefixes serve as group containers.
  const groupPaths = new Set<string>();
  const setsByName = new Map<string, SerializedSet>();
  for (const set of sets) {
    setsByName.set(set.name, set);
    const parts = set.name.split("/");
    for (let i = 1; i < parts.length; i++) {
      groupPaths.add(parts.slice(0, i).join("/"));
    }
  }

  const groupMap = new Map<string, GroupNode>();
  const roots: TreeNode[] = [];

  function getOrCreateGroup(path: string): GroupNode {
    if (groupMap.has(path)) return groupMap.get(path)!;
    const parts = path.split("/");
    const label = parts[parts.length - 1];
    const existingSet = setsByName.get(path);
    const node: GroupNode = {
      kind: "group",
      path,
      label,
      children: [],
      hasSet: !!existingSet,
      setId: existingSet?.id,
    };
    groupMap.set(path, node);
    if (parts.length === 1) {
      roots.push(node);
    } else {
      const parent = getOrCreateGroup(parts.slice(0, -1).join("/"));
      parent.children.push(node);
    }
    return node;
  }

  // Process sets in creation order. Groups are created lazily the first time a
  // child set is encountered, so their position in roots/children reflects when
  // they first appear — preserving the original creation order throughout.
  for (const set of sets) {
    const parts = set.name.split("/");
    if (groupPaths.has(set.name)) {
      // This set name is also a group prefix: ensure the group node exists so
      // that hasSet / setId are registered, but don't add it to roots here —
      // getOrCreateGroup handles insertion on first call.
      getOrCreateGroup(set.name);
    } else {
      const leaf: Extract<TreeNode, { kind: "set" }> = {
        kind: "set",
        fullName: set.name,
        label: parts[parts.length - 1],
        setId: set.id,
      };
      if (parts.length === 1) {
        roots.push(leaf);
      } else {
        const parent = getOrCreateGroup(parts.slice(0, -1).join("/"));
        parent.children.push(leaf);
      }
    }
  }

  return roots;
}

/** Ensure all ancestor group paths for a given set name are not collapsed. */
function expandAncestors(setName: string): void {
  const parts = setName.split("/");
  for (let i = 1; i < parts.length; i++) {
    collapsedGroups.delete(parts.slice(0, i).join("/"));
  }
}

// ── Alias editor ephemeral state ─────────────────────────────────────────

interface AliasEditorState {
  token: SerializedToken;
  inputValue: string;
  searchValue: string;
  mode: "edit" | "list";
  pickerSets: AliasPickerSet[];
  chipEl: HTMLElement;
  collapsedGroups: Set<string>; // setIds currently collapsed
  // When set, the editor is targeting a sub-property of a composite token.
  compositeCtx?: { propKey: string; propType: string };
}

let aliasEditor: AliasEditorState | null = null;

interface ModalAliasPickerState {
  tokenType: string;
  searchValue: string;
  pickerSets: AliasPickerSet[];
  collapsedGroups: Set<string>;
  anchorEl: HTMLElement;
  targetInputId: string; // which input receives the inserted alias
}

let modalAliasPicker: ModalAliasPickerState | null = null;

// ════════════════════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════════════════════

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

// Send a message to the plugin sandbox (plugin.ts).
// The plugin UI runs in an iframe; `penpot` is NOT available here — it only
// exists in the plugin sandbox context.  The correct channel is
// parent.postMessage, which Penpot's host intercepts and forwards to the
// plugin via penpot.ui.onMessage.
function sendToPlugin(message: UiMessage): void {
  parent.postMessage(message, "*");
}

// ════════════════════════════════════════════════════════════════════════
//  COLUMN RESIZE
//  Column widths are stored here and reflected onto the CSS custom property
//  --col-widths on .tokens-table-wrap so that every row shares the same
//  grid template as the sticky header.
// ════════════════════════════════════════════════════════════════════════

// Default widths in px  — index matches grid column order
// [check, name, value, resolved, type, actions]
const COL_DEFAULT = [52, 170, 185, 160, 110, 36];
const COL_MIN     = [52,  80,  80,  80,  80, 36];
const COL_FIXED   = new Set([0, 5]); // check + actions are not user-resizable

const colWidths = [...COL_DEFAULT];

function applyColWidths(): void {
  const wrap = document.querySelector<HTMLElement>(".tokens-table-wrap");
  if (!wrap) return;
  wrap.style.setProperty("--col-widths", colWidths.map((w) => `${w}px`).join(" "));
}

interface ColDrag {
  colIdx: number;
  startX: number;
  startWidth: number;
  handle: HTMLElement;
}
let activeDrag: ColDrag | null = null;

function onHandleMouseDown(e: MouseEvent): void {
  const handle = e.currentTarget as HTMLElement;
  const colIdx = parseInt(handle.dataset.col ?? "1");
  if (COL_FIXED.has(colIdx)) return;

  activeDrag = {
    colIdx,
    startX: e.clientX,
    startWidth: colWidths[colIdx],
    handle,
  };

  handle.classList.add("is-dragging");
  document.documentElement.classList.add("col-resizing");
  e.preventDefault();
  e.stopPropagation();
}

function onDocMouseMove(e: MouseEvent): void {
  if (!activeDrag) return;
  const delta = e.clientX - activeDrag.startX;
  colWidths[activeDrag.colIdx] = Math.max(
    COL_MIN[activeDrag.colIdx],
    Math.round(activeDrag.startWidth + delta)
  );
  applyColWidths();
}

function onDocMouseUp(): void {
  if (!activeDrag) return;
  activeDrag.handle.classList.remove("is-dragging");
  document.documentElement.classList.remove("col-resizing");
  activeDrag = null;
}

function initColResize(): void {
  // Apply default widths immediately so the table is correctly sized on load
  applyColWidths();

  // Bind to resize handles that are already in the static header HTML
  document.querySelectorAll<HTMLElement>(".col-resize-handle").forEach((h) => {
    h.addEventListener("mousedown", onHandleMouseDown);
  });

  // Global move/up listeners (added once, live for the page lifetime)
  document.addEventListener("mousemove", onDocMouseMove);
  document.addEventListener("mouseup", onDocMouseUp);
}

// ════════════════════════════════════════════════════════════════════════
//  BOOTSTRAP
// ════════════════════════════════════════════════════════════════════════

// Sync theme from URL param (Penpot passes ?theme=dark|light)
const params = new URLSearchParams(window.location.search);
document.body.dataset.theme = params.get("theme") ?? "light";

document.addEventListener("DOMContentLoaded", () => {
  initColResize();
  bindGlobalListeners();
  sendToPlugin({ type: "init" });
});

// ════════════════════════════════════════════════════════════════════════
//  DATA LAYER
//  The plugin publishes a full CatalogSnapshot whenever the catalog
//  changes; every view is derived from it here. Values are resolved with
//  our own Resolver against the context picked in the header, instead of
//  Penpot's resolvedValue (which only knows about the active sets).
// ════════════════════════════════════════════════════════════════════════

type ResolveMode = "set-on-top" | "active" | `theme:${string}`;
const RESOLVE_MODE_KEY = "dtm-resolve-mode";

function loadResolveMode(): ResolveMode {
  try {
    const v = localStorage.getItem(RESOLVE_MODE_KEY);
    if (v === "active" || v === "set-on-top" || v?.startsWith("theme:")) return v as ResolveMode;
  } catch { /* storage unavailable */ }
  return "set-on-top";
}

let resolveMode: ResolveMode = loadResolveMode();

function setResolveMode(mode: ResolveMode): void {
  resolveMode = mode;
  try { localStorage.setItem(RESOLVE_MODE_KEY, mode); } catch { /* ignore */ }
  resolverCache.clear();
  refreshSelectedTokens();
}

function contextFor(setId: string): ResolveContext {
  if (resolveMode === "active") return { kind: "active" };
  if (resolveMode.startsWith("theme:")) return { kind: "theme", themeId: resolveMode.slice(6) };
  return { kind: "set-on-top", setId };
}

// One resolver per (snapshot, mode, viewed set); cleared on every change.
const resolverCache = new Map<string, Resolver>();

function resolverFor(setId: string): Resolver {
  const key = resolveMode === "set-on-top" ? `set:${setId}` : resolveMode;
  let r = resolverCache.get(key);
  if (!r) {
    r = Resolver.forContext(state.snapshot, contextFor(setId));
    resolverCache.set(key, r);
  }
  return r;
}

function toViewToken(token: SnapshotToken, resolver: Resolver): SerializedToken {
  const r = resolver.resolveToken(token);
  let resolvedValue = r.value;
  // In "as in Penpot" mode, prefer Penpot's own result for anything our
  // evaluator couldn't handle (it has the final word on the canvas).
  if (resolveMode === "active" && r.status !== "ok" && token.penpotResolved) {
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

function snapshotSet(setId: string): SnapshotSet | undefined {
  return state.snapshot.sets.find((s) => s.id === setId);
}

function viewTokensForSet(setId: string): SerializedToken[] {
  const set = snapshotSet(setId);
  if (!set) return [];
  const resolver = resolverFor(setId);
  return set.tokens.map((t) => toViewToken(t, resolver));
}

function comparedTokenMap(setId: string): Map<string, SerializedToken> {
  return new Map(viewTokensForSet(setId).map((t) => [t.name, t]));
}

/** Tokens of one type across all sets, for the alias pickers. */
function pickerSetsFor(tokenType: string): AliasPickerSet[] {
  return state.snapshot.sets
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

/** Recompute the selected set's tokens (and compare columns) and re-render. */
function refreshSelectedTokens(): void {
  if (!state.selectedSetId) return;
  state.tokens = viewTokensForSet(state.selectedSetId);

  const validIds = new Set(state.tokens.map((t) => t.id));
  for (const id of [...selectedTokenIds]) {
    if (!validIds.has(id)) selectedTokenIds.delete(id);
  }

  if (compareState.active) {
    const existing = new Set(state.sets.map((s) => s.id));
    compareState.comparedSetIds = compareState.comparedSetIds.filter((id) => existing.has(id));
    compareState.comparedTokenMaps.clear();
    for (const id of compareState.comparedSetIds) {
      compareState.comparedTokenMaps.set(id, comparedTokenMap(id));
    }
    renderCompareTable();
  } else {
    renderTokenTable();
  }
}

function applySnapshot(snapshot: CatalogSnapshot): void {
  state.snapshot = snapshot;
  resolverCache.clear();
  state.sets = snapshot.sets.map((s) => ({
    id: s.id,
    name: s.name,
    active: s.active,
    tokenCount: s.tokens.length,
  }));
  state.themes = snapshot.themes.map((t) => ({ ...t, setIds: [...t.setIds] }));

  // A theme picked as context may have been deleted.
  if (resolveMode.startsWith("theme:") && !state.themes.some((t) => `theme:${t.id}` === resolveMode)) {
    resolveMode = "set-on-top";
  }

  renderSidebar();
  renderOverview();
  renderContextSelect();
  renderThemesModal();

  if (state.selectedSetId && !snapshotSet(state.selectedSetId)) {
    selectSet(null); // also exits compare mode
  } else if (state.selectedSetId) {
    const set = state.sets.find((s) => s.id === state.selectedSetId);
    if (set) el("breadcrumb-set-name").textContent = set.name;
    refreshSelectedTokens();
  }

  // Keep open pickers fresh; only re-render lists that aren't being typed in.
  if (aliasEditor) {
    aliasEditor.pickerSets = pickerSetsFor(aliasEditor.compositeCtx?.propType ?? aliasEditor.token.type);
    if (aliasEditor.mode === "list") renderAliasEditor();
  }
  if (modalAliasPicker) {
    modalAliasPicker.pickerSets = pickerSetsFor(modalAliasPicker.tokenType);
  }
}

function renderContextSelect(): void {
  const select = el<HTMLSelectElement>("resolve-context-select");
  if (!select) return;
  const themeOptions = state.themes
    .map((t) => {
      const label = t.group ? `${t.group} / ${t.name}` : t.name;
      return `<option value="theme:${esc(t.id)}">Theme: ${esc(label)}</option>`;
    })
    .join("");
  select.innerHTML = `
    <option value="set-on-top">This set over active sets</option>
    <option value="active">Active sets (as in Penpot)</option>
    ${themeOptions}`;
  select.value = resolveMode;
}

// ── Requests ─────────────────────────────────────────────────────────────

const pendingRequests = new Map<number, (results: OpResult[]) => void>();
let nextReqId = 1;

/** Send operations to the plugin; failures are reported as toasts. */
function runOps(ops: Op[]): Promise<OpResult[]> {
  if (ops.length === 0) return Promise.resolve([]);
  const reqId = nextReqId++;
  return new Promise<OpResult[]>((resolve) => {
    pendingRequests.set(reqId, resolve);
    sendToPlugin({ type: "ops", reqId, ops });
  }).then((results) => {
    const failures = results.filter((r) => !r.ok);
    if (failures.length === 1 && ops.length === 1) {
      showToast(failures[0].error ?? "The operation failed", "error");
    } else if (failures.length > 0) {
      showToast(`${failures.length} of ${ops.length} operations failed: ${failures[0].error ?? ""}`, "error");
    }
    return results;
  });
}

// ── Toasts ───────────────────────────────────────────────────────────────

function showToast(message: string, kind: "info" | "error" = "info"): void {
  let region = document.getElementById("toast-region");
  if (!region) {
    region = document.createElement("div");
    region.id = "toast-region";
    region.className = "toast-region";
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    document.body.appendChild(region);
  }
  const toast = document.createElement("div");
  toast.className = `toast toast--${kind} body-s`;
  toast.textContent = message;
  region.appendChild(toast);
  setTimeout(() => toast.remove(), kind === "error" ? 6000 : 3000);
}

// ── Messages from the plugin ─────────────────────────────────────────────

window.addEventListener("message", (event: MessageEvent) => {
  const msg = event.data as PluginMessage;

  switch (msg?.type) {
    case "themechange":
      document.body.dataset.theme = msg.theme;
      break;

    case "snapshot":
      applySnapshot(msg.snapshot);
      break;

    case "ops-result": {
      const resolve = pendingRequests.get(msg.reqId);
      pendingRequests.delete(msg.reqId);
      resolve?.(msg.results);
      break;
    }

    case "fonts-loaded":
      state.documentFonts = msg.fonts;
      // Refresh the picker if it's currently open so the Document Fonts
      // section populates without the user needing to close and reopen.
      if (fontPickerInput) renderFontPicker();
      break;

    case "error":
      showToast(msg.message, "error");
      break;

    case "unsupported":
      showUnsupportedNotice(msg.penpotVersion);
      break;
  }
});

// ════════════════════════════════════════════════════════════════════════
//  VIEW SWITCHING
// ════════════════════════════════════════════════════════════════════════

function selectSet(setId: string | null): void {
  // Navigating to a different set while in compare mode would leave the
  // comparison columns pointing at the wrong primary — exit silently.
  if (compareState.active && setId !== state.selectedSetId) {
    exitCompareModeQuiet();
  }

  state.selectedSetId = setId;
  selectedTokenIds.clear();

  if (setId) {
    el("view-sets-overview").classList.add("hidden");
    el("view-tokens").classList.remove("hidden");
    const set = state.sets.find((s) => s.id === setId);
    if (set) {
      el("breadcrumb-set-name").textContent = set.name;
      // Auto-expand all ancestor groups so the selected leaf is visible.
      expandAncestors(set.name);
    }
    state.tokens = viewTokensForSet(setId);
    state.sortKey = "type";
    state.sortDir = "asc";
    renderTokenTable();
  } else {
    el("view-sets-overview").classList.remove("hidden");
    el("view-tokens").classList.add("hidden");
  }

  // Re-render sidebar to reflect new active state and any ancestor expansion.
  renderSidebar();
}

// The running Penpot doesn't expose the token API (plugin API < 1.5).
function showUnsupportedNotice(penpotVersion: string): void {
  const version = penpotVersion ? ` (Penpot ${esc(penpotVersion)})` : "";
  el("main-content").innerHTML = `
    <div class="empty-state-msg body-s">
      This version of Penpot${version} doesn't support design tokens in plugins.
      Please update Penpot to use Design Token Manager.
    </div>`;
  el("sidebar").classList.add("hidden");
}

function toggleSidebar(): void {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  el("sidebar").classList.toggle("collapsed", state.sidebarCollapsed);
}

// ════════════════════════════════════════════════════════════════════════
//  SIDEBAR RENDERING
// ════════════════════════════════════════════════════════════════════════

// Cube-shaped set icon matching Penpot's component icon style.
const ICON_SET_SVG = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 1.5L13.5 4.75V11.25L8 14.5L2.5 11.25V4.75Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M2.5 4.75L8 8L13.5 4.75" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 8V14.5" stroke="currentColor" stroke-width="1.3"/></svg>`;
const ICON_CHEVRON_RIGHT = `<svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_CHEVRON_DOWN  = `<svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// Checkbox mirroring the set's `active` flag in Penpot.
function setActiveToggleHtml(setId: string): string {
  const set = state.sets.find((s) => s.id === setId);
  if (!set) return "";
  return `<input type="checkbox" class="checkbox-input set-active-toggle" data-active-set-id="${esc(setId)}"
    ${set.active ? "checked" : ""} aria-label="Active"
    title="${set.active ? "Active" : "Inactive"} in Penpot. Toggling a set directly turns off all themes." />`;
}

function renderTreeNodes(nodes: TreeNode[], depth: number): string {
  return nodes
    .map((node) => {
      const indent = depth * 14;
      if (node.kind === "group") {
        const isExpanded = !collapsedGroups.has(node.path);
        const isActive   = node.hasSet && node.setId === state.selectedSetId;
        const children   = isExpanded
          ? `<ul class="set-tree-children">${renderTreeNodes(node.children, depth + 1)}</ul>`
          : "";
        const setIcon = node.hasSet ? `<span class="set-icon">${ICON_SET_SVG}</span>` : "";
        return `<li class="set-tree-group${isActive ? " active" : ""}" data-group-path="${esc(node.path)}"${node.hasSet ? ` data-set-id="${esc(node.setId!)}"` : ""}><div class="set-tree-group-row" style="padding-left:${indent + 10}px"><button class="set-tree-chevron" data-toggle-group="${esc(node.path)}" aria-expanded="${isExpanded}" aria-label="${isExpanded ? "Collapse" : "Expand"} ${esc(node.label)}">${isExpanded ? ICON_CHEVRON_DOWN : ICON_CHEVRON_RIGHT}</button>${setIcon}<span class="set-name">${esc(node.label)}</span>${node.hasSet ? setActiveToggleHtml(node.setId!) : ""}</div>${children}</li>`;
      } else {
        const isActive = node.setId === state.selectedSetId;
        return `<li class="set-item${isActive ? " active" : ""}" data-set-id="${esc(node.setId)}" title="${esc(node.fullName)}" role="option" aria-selected="${isActive}" style="padding-left:${indent + 10}px"><span class="set-icon">${ICON_SET_SVG}</span><span class="set-name">${esc(node.label)}</span>${setActiveToggleHtml(node.setId)}</li>`;
      }
    })
    .join("");
}

function renderSidebar(): void {
  el("sidebar-sets-count").textContent = String(state.sets.length);
  el("sidebar-themes-count").textContent = String(state.themes.length);

  const query = (el<HTMLInputElement>("sidebar-search-input")?.value ?? "").toLowerCase();
  const filtered = state.sets.filter(
    (s) => !query || s.name.toLowerCase().includes(query)
  );

  const listEl = el("sidebar-sets-list");

  if (filtered.length === 0) {
    listEl.innerHTML = `<li class="sets-empty-state body-s">${
      query ? "No sets match your search." : "No sets yet."
    }</li>`;
  } else {
    const tree = buildSetTree(filtered);
    listEl.innerHTML = renderTreeNodes(tree, 0);

    // Leaf set items: click selects, right-click opens context menu.
    listEl.querySelectorAll<HTMLElement>(".set-item[data-set-id]").forEach((item) => {
      item.addEventListener("click", () => selectSet(item.dataset.setId!));
      item.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showSetContextMenu(e as MouseEvent, item.dataset.setId!);
      });
    });

    // Active toggles: change the set's state in Penpot, never select it.
    listEl.querySelectorAll<HTMLInputElement>(".set-active-toggle").forEach((cb) => {
      cb.addEventListener("click", (e) => e.stopPropagation());
      cb.addEventListener("change", () => {
        void runOps([{ op: "set-set-active", setId: cb.dataset.activeSetId!, active: cb.checked }]);
      });
    });

    // Chevron buttons toggle expand/collapse without triggering selection.
    listEl.querySelectorAll<HTMLElement>("[data-toggle-group]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const path = (btn as HTMLElement).dataset.toggleGroup!;
        if (collapsedGroups.has(path)) collapsedGroups.delete(path);
        else collapsedGroups.add(path);
        renderSidebar();
      });
    });

    // Group rows: click toggles expand/collapse; also selects when group is a real set.
    listEl.querySelectorAll<HTMLElement>(".set-tree-group-row").forEach((row) => {
      const groupLi = row.closest<HTMLElement>(".set-tree-group");
      if (!groupLi) return;
      row.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest("[data-toggle-group]")) return;
        const path = groupLi.dataset.groupPath!;
        if (collapsedGroups.has(path)) collapsedGroups.delete(path);
        else collapsedGroups.add(path);
        if (groupLi.dataset.setId) {
          selectSet(groupLi.dataset.setId);
        } else {
          renderSidebar();
        }
      });
      if (groupLi.dataset.setId) {
        row.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          showSetContextMenu(e as MouseEvent, groupLi.dataset.setId!);
        });
      }
    });
  }

  renderSidebarThemes();
}

// Themes grouped by their group; clicking one toggles it in Penpot (Penpot
// keeps at most one active theme per group).
function themesByGroup(): [string, SerializedTheme[]][] {
  const groups = new Map<string, SerializedTheme[]>();
  for (const t of state.themes) {
    const list = groups.get(t.group) ?? [];
    list.push(t);
    groups.set(t.group, list);
  }
  return [...groups.entries()];
}

function renderSidebarThemes(): void {
  const themesDesc = el("themes-description");
  const themesList = el("themes-list");
  if (state.themes.length === 0) {
    themesDesc.classList.remove("hidden");
    themesList.classList.add("hidden");
    return;
  }
  themesDesc.classList.add("hidden");
  themesList.classList.remove("hidden");
  themesList.innerHTML = themesByGroup()
    .map(([group, themes]) => {
      const header = group ? `<li class="theme-group-label body-s">${esc(group)}</li>` : "";
      const items = themes
        .map((t) => `
          <li class="set-item theme-item${t.active ? " theme-item--active" : ""}" data-theme-id="${esc(t.id)}"
              role="button" tabindex="0" aria-pressed="${t.active}"
              title="${t.active ? "Active — click to turn off" : "Click to activate"}">
            <span class="theme-dot" aria-hidden="true"></span>
            <span class="set-name">${esc(t.name)}</span>
          </li>`)
        .join("");
      return header + items;
    })
    .join("");

  themesList.querySelectorAll<HTMLElement>(".theme-item").forEach((item) => {
    const toggle = () => {
      const theme = state.themes.find((t) => t.id === item.dataset.themeId);
      if (theme) void runOps([{ op: "set-theme-active", themeId: theme.id, active: !theme.active }]);
    };
    item.addEventListener("click", toggle);
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });
  });
}

// ════════════════════════════════════════════════════════════════════════
//  SETS OVERVIEW RENDERING
// ════════════════════════════════════════════════════════════════════════

function renderOverview(): void {
  const query = (el<HTMLInputElement>("overview-search-input")?.value ?? "").toLowerCase();
  const filtered = state.sets.filter(
    (s) => !query || s.name.toLowerCase().includes(query)
  );

  const listEl = el("sets-overview-list");

  if (filtered.length === 0) {
    listEl.innerHTML = `<p class="empty-state-msg body-s">${
      query
        ? "No sets match your search."
        : 'No token sets yet. Click "+ New set" to create one.'
    }</p>`;
    return;
  }

  listEl.innerHTML = filtered
    .map(
      (set) => `
    <div class="set-card" data-set-id="${esc(set.id)}">
      <span class="set-card-icon"><svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 1.5L13.5 4.75V11.25L8 14.5L2.5 11.25V4.75Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M2.5 4.75L8 8L13.5 4.75" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 8V14.5" stroke="currentColor" stroke-width="1.3"/></svg></span>
      <span class="set-card-name">${esc(set.name)}</span>
      <div class="set-card-meta">
        <span class="set-card-count">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4.75 2.37L11.25 2.37L14.5 8L11.25 13.63L4.75 13.63L1.5 8Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
            <circle cx="8" cy="8" r="1.2" fill="currentColor"/>
          </svg>
          ${set.tokenCount}
        </span>
      </div>
      <button class="icon-btn set-card-menu" data-set-id="${esc(set.id)}"
              data-stop-nav title="Set options">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="3.5" cy="8" r="1.2" fill="currentColor"/>
          <circle cx="8" cy="8" r="1.2" fill="currentColor"/>
          <circle cx="12.5" cy="8" r="1.2" fill="currentColor"/>
        </svg>
      </button>
    </div>`
    )
    .join("");

  listEl.querySelectorAll<HTMLElement>(".set-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("[data-stop-nav]")) return;
      selectSet(card.dataset.setId!);
    });
  });

  listEl.querySelectorAll<HTMLElement>(".set-card-menu").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      showSetContextMenu(e as MouseEvent, btn.dataset.setId!);
    });
  });
}

// ════════════════════════════════════════════════════════════════════════
//  COLUMN SORT
// ════════════════════════════════════════════════════════════════════════

function getSortedTokens(tokens: SerializedToken[]): SerializedToken[] {
  if (!state.sortKey) return tokens;
  const key = state.sortKey;
  const dir = state.sortDir === "asc" ? 1 : -1;
  return [...tokens].sort((a, b) => {
    const av = (key === "resolvedValue"
      ? (a.resolvedValue ?? a.value)
      : a[key]
    )?.toLowerCase() ?? "";
    const bv = (key === "resolvedValue"
      ? (b.resolvedValue ?? b.value)
      : b[key]
    )?.toLowerCase() ?? "";
    return av < bv ? -dir : av > bv ? dir : 0;
  });
}

function updateSortHeaders(): void {
  document.querySelectorAll<HTMLElement>(".th-sortable[data-sort-key]").forEach((th) => {
    const icon = th.querySelector<HTMLElement>(".sort-icon");
    if (!icon) return;
    const isActive = th.dataset.sortKey === state.sortKey;
    icon.classList.toggle("is-active", isActive);
    icon.classList.toggle("is-desc", isActive && state.sortDir === "desc");
    th.setAttribute(
      "aria-sort",
      isActive ? (state.sortDir === "asc" ? "ascending" : "descending") : "none"
    );
  });
}

function onSortHeaderClick(e: MouseEvent): void {
  // Ignore clicks on the resize handle inside the header cell
  if ((e.target as HTMLElement).closest(".col-resize-handle")) return;
  const th = e.currentTarget as HTMLElement;
  const key = th.dataset.sortKey as SortKey;
  if (state.sortKey === key) {
    state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
  } else {
    state.sortKey = key;
    state.sortDir = "asc";
  }
  renderTokenTable();
}

// ════════════════════════════════════════════════════════════════════════
//  TOKEN TABLE RENDERING
// ════════════════════════════════════════════════════════════════════════

const TOKEN_TYPE_ICONS: Record<string, string> = {
  // Dashed arcs on two opposite corners showing a rounded rectangle corner
  borderRadius: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 9V5.5A2.5 2.5 0 0 1 5.5 3H9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-dasharray="2.5 1.8"/><path d="M13 7v3.5A2.5 2.5 0 0 1 10.5 13H7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-dasharray="2.5 1.8"/></svg>`,
  // Water drop / ink drop
  color: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 2C8 2 4 7 4 10a4 4 0 0 0 8 0C12 7 8 2 8 2Z" stroke="currentColor" stroke-width="1.3"/></svg>`,
  // Diagonal line with perpendicular tick marks at each end (resize / scale)
  dimension: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M4 12L12 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M2.5 10.5L5.5 13.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M10.5 2.5L13.5 5.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
  // Large A (main) + small superscript A (top-right)
  fontFamilies: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 13.5L6.5 3L11 13.5M3.5 11H9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 8L13.5 4.5L15 8M12.4 7H14.6" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  // Vertical double-headed arrow (left) + capital A (right)
  fontSizes: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M4 2.5V13.5M2.5 4L4 2.5L5.5 4M2.5 12L4 13.5L5.5 12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 13.5L11 5.5L14 13.5M9 11H13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  // Bold B letterform
  fontWeights: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M5 3V13M5 3H9.5a2.5 2.5 0 0 1 0 5H5M5 8H10a3 3 0 0 1 0 6H5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  // A and V glyphs with a double-ended horizontal arrow below (kerning indicator)
  letterSpacing: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 9.5L5 3L8 9.5M3 7.5H7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 3L11.5 9.5L14 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M1.5 13H14.5M3.5 11.5L1.5 13L3.5 14.5M12.5 11.5L14.5 13L12.5 14.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  // Simplified "1 2 3" numeral forms
  number: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3.5 5L2.5 6V12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 6.5a1.5 1.5 0 0 1 3 0C9 7.8 6 9.2 6 10.5H9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 6.5a1.5 1.5 0 0 1 3 0C14 8 11.5 8 11.5 8.5S14 9 14 10.5a1.5 1.5 0 0 1-3 0" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`,
  // % symbol: two small circles with a diagonal slash between them
  opacity: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="5.5" cy="5.5" r="2" stroke="currentColor" stroke-width="1.3"/><circle cx="10.5" cy="10.5" r="2" stroke="currentColor" stroke-width="1.3"/><path d="M13 3L3 13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
  // Right-angle L bracket with a curved arc showing the rotation sweep
  rotation: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 3V13H13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 9.5A6.5 6.5 0 0 1 9.5 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
  // Solid inner circle with dashed outer halo (shadow/glow)
  shadow: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.2" stroke-dasharray="1.8 1.5"/></svg>`,
  // Same diagonal-with-ticks as dimension (scale icon)
  sizing: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M4 12L12 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M2.5 10.5L5.5 13.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M10.5 2.5L13.5 5.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
  // Centered box with horizontal spacing indicators on each side
  spacing: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="4.5" y="5" width="7" height="6" rx="1" stroke="currentColor" stroke-width="1.3"/><path d="M1.5 5V11M1.5 8H4.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M14.5 5V11M14.5 8H11.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
  // Three horizontal lines of increasing stroke thickness
  borderWidth: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 5H14" stroke="currentColor" stroke-width="1" stroke-linecap="round"/><path d="M2 8.5H14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M2 12.5H14" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/></svg>`,
  // Capital A (large) + lowercase a (circle + stem, small, right side)
  textCase: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M1.5 13L5.5 4.5L9.5 13M2.8 10.5H8.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12.5" cy="11" r="2" stroke="currentColor" stroke-width="1.2"/><path d="M14.5 9V13" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`,
  // U shape with a horizontal underline
  textDecoration: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M5 3V9.5a3 3 0 0 0 6 0V3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M3 14H13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  // T letterform inside a rounded square box
  typography: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2.5" stroke="currentColor" stroke-width="1.3"/><path d="M6 5.5H10M8 5.5V11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
};

function tokenIcon(type: string): string {
  return TOKEN_TYPE_ICONS[type] ?? TOKEN_TYPE_ICONS.number;
}

function colorSwatchHtml(token: SerializedToken): string {
  if (token.type !== "color") return "";
  const bg = token.resolvedValue ?? token.value;
  return `<span class="color-swatch" style="background:${esc(bg)}" aria-hidden="true"></span>`;
}

// ── Alias chip ───────────────────────────────────────────────────────────

const ALIAS_GEAR_ICON = `<svg class="alias-chip-icon" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4.75 2.37L11.25 2.37L14.5 8L11.25 13.63L4.75 13.63L1.5 8Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
            <circle cx="8" cy="8" r="1.2" fill="currentColor"/>
          </svg>
`;

// Icon used on the "insert alias" trigger button inside the Value input group
const VALUE_ALIAS_INSERT_ICON = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
  <path d="M4.75 2.37L11.25 2.37L14.5 8L11.25 13.63L4.75 13.63L1.5 8Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
  <circle cx="8" cy="8" r="1.2" fill="currentColor"/>
</svg>`;

function aliasChipHtml(token: SerializedToken): string {
  const aliasName = token.value.trim().slice(1, -1);
  const resolvedBg = token.type === "color" ? (token.resolvedValue ?? "") : "";
  const swatchHtml = resolvedBg
    ? `<span class="color-swatch" style="background:${esc(resolvedBg)}" aria-hidden="true"></span>`
    : "";
  const broken = (token.missingRefs ?? []).includes(aliasName.trim());
  const title = broken ? `Broken reference: ${token.value}` : token.value;
  return `<div class="alias-chip${broken ? " alias-chip--broken" : ""}" data-token-id="${esc(token.id)}" title="${esc(title)}" role="button" tabindex="0" aria-label="Alias: ${esc(aliasName)}">${swatchHtml}<span class="alias-chip-name">${esc(aliasName)}</span>${ALIAS_GEAR_ICON}</div>`;
}

function inlineAliasChipHtml(aliasName: string, parentTokenId: string, broken: boolean): string {
  if (broken) {
    return `<span class="mixed-alias-broken" title="Broken reference: {${esc(aliasName)}}">{${esc(aliasName)}}</span>`;
  }
  return `<div class="alias-chip alias-chip--inline" data-token-id="${esc(parentTokenId)}" title="{${esc(aliasName)}}" role="button" tabindex="0" aria-label="Alias: ${esc(aliasName)}"><span class="alias-chip-name">${esc(aliasName)}</span>${ALIAS_GEAR_ICON}</div>`;
}

// ── Composite token preview ───────────────────────────────────────────────
//  Renders a compact multi-property summary for composite token types
//  (typography, shadow).  Each sub-value goes through compositeSubValueHtml
//  so alias references get rendered as mini alias chips.

interface CompositePropDef {
  key: string;
  label: string;
  iconKey: string;
}

// Keys match the UI "form" shape produced by normalizeTypographyValueToForm:
// fontFamily / fontSize (singular) for the two irregular fields.
const TYPOGRAPHY_PROP_ORDER: CompositePropDef[] = [
  { key: "fontFamily",     label: "Family",      iconKey: "fontFamilies"   },
  { key: "fontSize",       label: "Size",        iconKey: "fontSizes"      },
  { key: "fontWeight",     label: "Weight",      iconKey: "fontWeights"    },
  { key: "lineHeight",     label: "Line Height", iconKey: "dimension"      },
  { key: "letterSpacing",  label: "Spacing",     iconKey: "letterSpacing"  },
  { key: "textCase",       label: "Case",        iconKey: "textCase"       },
  { key: "textDecoration", label: "Decoration",  iconKey: "textDecoration" },
];

// Maps each composite sub-property key to the token type used when fetching
// candidates for the alias picker.
const COMPOSITE_PROP_TYPE: Record<string, string> = {
  // Shadow sub-props
  color:  "color",
  x:      "dimension",
  y:      "dimension",
  blur:   "dimension",
  spread: "dimension",
  // Typography sub-props (UI keys from normalizeTypographyValueToForm)
  fontFamily:     "fontFamilies",
  fontSize:       "fontSizes",
  fontWeight:     "fontWeights",
  // Penpot has no lineHeight token type; line heights reference number tokens.
  lineHeight:     "number",
  letterSpacing:  "letterSpacing",
  textCase:       "textCase",
  textDecoration: "textDecoration",
};

/** Extract the current value of one sub-property from a composite token. */
function getCompositeSubValue(token: SerializedToken, propKey: string): string {
  if (token.type === "shadow") {
    const vals = normalizeShadowValueToPreview(token.value);
    return (vals as Record<string, string>)[propKey] ?? "";
  }
  if (token.type === "typography") {
    const vals = normalizeTypographyValueToForm(token.value);
    return (vals as Record<string, string>)[propKey] ?? "";
  }
  return "";
}

/** Rebuild the full composite value after changing one sub-property. */
function buildCompositeValueWithProp(
  token: SerializedToken,
  propKey: string,
  newSubValue: string
): string {
  if (token.type === "shadow") {
    // Table chips edit the first layer; the other layers are kept as-is.
    const layers = normalizeShadowLayers(token.value);
    const u = { ...(layers[0] ?? {}), [propKey]: newSubValue };
    layers[0] = {
      type:   u.type   ?? "drop-shadow",
      x:      u.x      ?? "0",
      y:      u.y      ?? "0",
      blur:   u.blur   ?? "0",
      spread: u.spread ?? "0",
      color:  u.color  ?? "rgba(0,0,0,0.25)",
    };
    return shadowLayersToValue(layers);
  }
  if (token.type === "typography") {
    const v = normalizeTypographyValueToForm(token.value) as Record<string, string>;
    const u = { ...v, [propKey]: newSubValue };
    const apiForm: Record<string, string> = {
      fontFamilies:   u.fontFamily     ?? "",
      fontSizes:      u.fontSize       ?? "",
      fontWeight:     u.fontWeight     ?? "",
      lineHeight:     u.lineHeight     ?? "",
      letterSpacing:  u.letterSpacing  ?? "",
      textCase:       u.textCase       ?? "",
      textDecoration: u.textDecoration ?? "",
    };
    return JSON.stringify(sanitizeTypographyValueForApi(apiForm));
  }
  return token.value;
}

/** Render one sub-property value: alias chip (interactive or read-only), mixed, or plain text.
 *  Pass tokenId + propKey to make alias chips interactive (clickable to change the alias). */
function compositeSubValueHtml(
  value: string,
  tokenId?: string,
  propKey?: string
): string {
  if (!value) return `<span class="cprop-val cprop-val--muted">—</span>`;

  const propType = propKey ? (COMPOSITE_PROP_TYPE[propKey] ?? "") : "";
  const interactive = !!(tokenId && propKey && propType);

  if (isAlias(value)) {
    const name = value.trim().slice(1, -1);
    if (interactive) {
      return `<div class="alias-chip" data-token-id="${esc(tokenId!)}" data-prop-key="${esc(propKey!)}" data-prop-type="${esc(propType)}" role="button" tabindex="0" title="${esc(value)}"><span class="alias-chip-name">${esc(name)}</span>${ALIAS_GEAR_ICON}</div>`;
    }
    return `<span class="alias-chip" title="${esc(value)}"><span class="alias-chip-name">${esc(name)}</span></span>`;
  }

  if (/\{[^{}]+\}/.test(value)) {
    // Mixed value: plain text interleaved with {alias} references.
    // Mixed composite sub-values are rendered read-only (no interactive chip).
    const parts = parseMixedValue(value).map((seg) => {
      if (seg.kind === "alias") {
        return `<span class="alias-chip" title="{${esc(seg.name)}}"><span class="alias-chip-name">${esc(seg.name)}</span></span>`;
      }
      return `<span class="cprop-val">${esc(seg.content)}</span>`;
    });
    return parts.join("");
  }

  return `<span class="cprop-val">${esc(value)}</span>`;
}

const COMPOSITE_MAX_VISIBLE = 4;

function compositeTypographyPreviewHtml(vals: Record<string, string>, tokenId?: string): string {
  const entries = TYPOGRAPHY_PROP_ORDER
    .map(({ key, label, iconKey }) => ({
      key,
      label,
      icon: TOKEN_TYPE_ICONS[iconKey] ?? "",
      value: vals[key] ?? "",
    }))
    // Skip empty, "none", "normal" to keep the preview compact
    .filter(({ value }) => value !== "" && value !== "none" && value !== "normal");

  if (entries.length === 0) {
    return `<span class="composite-empty">—</span>`;
  }

  const visible = entries.slice(0, COMPOSITE_MAX_VISIBLE);
  const hidden  = entries.slice(COMPOSITE_MAX_VISIBLE);

  const items = visible
    .map(({ key, label, icon, value }) =>
      `<span class="cprop" title="${esc(label)}: ${esc(value)}">${icon}${compositeSubValueHtml(value, tokenId, key)}</span>`
    )
    .join("");

  const moreHint =
    hidden.length > 0
      ? `<span class="cprop-more" title="${esc(hidden.map((e) => `${e.label}: ${e.value}`).join(", "))}">+${hidden.length}</span>`
      : "";

  return `<div class="composite-preview">${items}${moreHint}</div>`;
}

function compositeShadowPreviewHtml(vals: Record<string, string>, tokenId?: string, layerCount = 1): string {
  if (!vals || Object.keys(vals).length === 0) {
    return `<span class="composite-empty">—</span>`;
  }
  const parts: string[] = [];

  // Multi-layer shadows: the preview shows the first layer plus a count.
  if (layerCount > 1) {
    parts.push(`<span class="cprop-badge" title="${layerCount} shadow layers">${layerCount} layers</span>`);
  }

  // Shadow type badge (only shown when not the default "drop-shadow")
  if (vals.type && vals.type !== "drop-shadow") {
    parts.push(`<span class="cprop-badge">${esc(vals.type)}</span>`);
  }

  // Color: alias chip if it is/contains an alias ref, otherwise a color swatch.
  // This prevents "[object Object]" swatch backgrounds from broken proxies.
  if (vals.color) {
    if (isAlias(vals.color) || /\{[^{}]+\}/.test(vals.color)) {
      parts.push(
        `<span class="cprop" title="Color: ${esc(vals.color)}">${TOKEN_TYPE_ICONS.color}${compositeSubValueHtml(vals.color, tokenId, "color")}</span>`
      );
    } else {
      parts.push(
        `<span class="cprop" title="Color: ${esc(vals.color)}">` +
        `<span class="color-swatch" style="background:${esc(vals.color)}" aria-hidden="true"></span>` +
        `<span class="cprop-val">${esc(vals.color)}</span>` +
        `</span>`
      );
    }
  }

  // X / Y: show together with the dimension icon, each value rendered through
  // compositeSubValueHtml so that alias chips work (e.g. "{spacing.sm}").
  if (vals.x || vals.y) {
    const titleParts = [vals.x && `x: ${vals.x}`, vals.y && `y: ${vals.y}`].filter(Boolean);
    parts.push(
      `<span class="cprop" title="${esc(titleParts.join(", "))}">` +
      TOKEN_TYPE_ICONS.dimension +
      (vals.x ? compositeSubValueHtml(vals.x, tokenId, "x") : "") +
      (vals.x && vals.y ? `<span class="cprop-sep">,</span>` : "") +
      (vals.y ? compositeSubValueHtml(vals.y, tokenId, "y") : "") +
      `</span>`
    );
  }

  // Blur
  if (vals.blur) {
    parts.push(
      `<span class="cprop" title="Blur: ${esc(vals.blur)}">${TOKEN_TYPE_ICONS.opacity}${compositeSubValueHtml(vals.blur, tokenId, "blur")}</span>`
    );
  }

  // Spread (omit when zero / empty to keep the preview compact)
  if (vals.spread && vals.spread !== "0") {
    parts.push(
      `<span class="cprop" title="Spread: ${esc(vals.spread)}">${TOKEN_TYPE_ICONS.dimension}${compositeSubValueHtml(vals.spread, tokenId, "spread")}</span>`
    );
  }

  if (parts.length === 0) return `<span class="composite-empty">—</span>`;
  return `<div class="composite-preview">${parts.join("")}</div>`;
}

/** Render the "Resolved value" cell, with composite-aware formatting. */
function resolvedValueCellHtml(token: SerializedToken): string {
  if (token.resolveStatus === "broken" && token.resolvedValue === undefined) {
    const missing = (token.missingRefs ?? []).map((n) => `{${n}}`).join(", ");
    return `<span class="token-resolved-issue" title="${esc(`Not found in this context: ${missing}`)}">Missing ${esc(missing)}</span>`;
  }
  if (token.resolveStatus === "cycle" && token.resolvedValue === undefined) {
    return `<span class="token-resolved-issue" title="These references point back to this token">Circular reference</span>`;
  }
  if (token.resolveStatus === "invalid") {
    const text = token.resolvedValue ?? token.value;
    return `<span class="token-resolved-text token-resolved-text--warn" title="${esc(token.resolveError ?? "Invalid value")}">${esc(text)}</span>`;
  }
  const raw = token.resolvedValue ?? token.value;
  if (token.type === "typography") {
    const form = normalizeTypographyValueToForm(raw);
    // Supplement fields that Penpot omits from the resolved value (fontFamilies
    // is always null; other fields may be missing if the CLJS proxy was empty).
    // Only copy PLAIN (non-alias) values from the stored form.
    if (token.resolvedValue) {
      const valueForm = normalizeTypographyValueToForm(token.value);
      for (const key of [
        "fontFamily", "fontSize", "fontWeight",
        "lineHeight", "letterSpacing", "textCase", "textDecoration",
      ]) {
        if (!form[key] && valueForm[key] && !isAlias(valueForm[key])) {
          form[key] = valueForm[key];
        }
      }
    }
    // Strip any alias values that ended up in the resolved form — the resolved
    // column must never show alias references, only plain resolved values.
    for (const key of Object.keys(form)) {
      if (isAlias(form[key])) delete form[key];
    }
    return compositeTypographyPreviewHtml(form);
  }
  if (token.type === "shadow") {
    const form = normalizeShadowValueToPreview(raw);
    // Supplement missing shadow fields with plain (non-alias) values from stored.
    if (token.resolvedValue) {
      const valueForm = normalizeShadowValueToPreview(token.value);
      for (const key of ["x", "y", "blur", "spread", "color", "type"]) {
        if (!form[key] && valueForm[key] && !isAlias(valueForm[key])) {
          form[key] = valueForm[key];
        }
      }
    }
    // Strip any alias values from the resolved form.
    for (const key of Object.keys(form)) {
      if (isAlias(form[key])) delete form[key];
    }
    return compositeShadowPreviewHtml(form, undefined, normalizeShadowLayers(raw).length);
  }
  return `<span class="token-resolved-text" title="${esc(raw)}">${esc(raw)}</span>`;
}

function valueCellHtml(token: SerializedToken): string {
  // Composite types: render structured preview instead of raw JSON.
  // Both table and modal go through the same normalizer adapter so key
  // names are always consistent between the preview and the edit form.
  if (token.type === "typography") {
    return compositeTypographyPreviewHtml(normalizeTypographyValueToForm(token.value), token.id);
  }
  if (token.type === "shadow") {
    return compositeShadowPreviewHtml(
      normalizeShadowValueToPreview(token.value), token.id, normalizeShadowLayers(token.value).length,
    );
  }

  // Pure alias: entire value is a single {reference}
  if (isAlias(token.value)) return aliasChipHtml(token);

  // Check for any alias references embedded in the value
  if (!/\{[^{}]+\}/.test(token.value)) {
    // Plain value: no alias references at all
    return `${colorSwatchHtml(token)}<span class="token-value-text" title="${esc(token.value)}">${esc(token.value)}</span>`;
  }

  // Mixed value: one or more {alias} refs alongside plain text / math operators.
  // "Broken" means missing in the current resolution context, not just in
  // this set — references to other sets are normal.
  const missing = new Set(token.missingRefs ?? []);
  const parts = parseMixedValue(token.value).map((seg) => {
    if (seg.kind === "alias") {
      return inlineAliasChipHtml(seg.name, token.id, missing.has(seg.name.trim()));
    }
    return `<span class="mixed-value-text">${esc(seg.content)}</span>`;
  });
  return `<div class="mixed-value-cell">${parts.join("")}</div>`;
}

// ── Alias editor ─────────────────────────────────────────────────────────

const CHEV_DOWN = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CHEV_UP   = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 10 4-4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function getOrCreateEditorPopover(): HTMLElement {
  let el = document.getElementById("alias-editor-popover");
  if (!el) {
    el = document.createElement("div");
    el.id = "alias-editor-popover";
    el.className = "alias-editor-popover";
    document.body.appendChild(el);
  }
  return el;
}

function positionAliasEditor(): void {
  if (!aliasEditor) return;
  const popover = document.getElementById("alias-editor-popover");
  if (!popover) return;
  const rect = aliasEditor.chipEl.getBoundingClientRect();
  const popWidth = Math.max(rect.width, 264);
  popover.style.width = `${popWidth}px`;
  popover.style.top = `${rect.bottom + 4}px`;
  popover.style.left = `${Math.min(rect.left, window.innerWidth - popWidth - 8)}px`;
}

function onAliasEditorOutsideClick(e: MouseEvent): void {
  const popover = document.getElementById("alias-editor-popover");
  if (!popover || !aliasEditor) return;
  const target = e.target as Node;
  if (!popover.contains(target) && !aliasEditor.chipEl.contains(target)) {
    closeAliasEditor();
  }
}

function closeAliasEditor(): void {
  aliasEditor = null;
  const popover = document.getElementById("alias-editor-popover");
  if (popover) popover.classList.add("alias-editor-hidden");
  document.removeEventListener("mousedown", onAliasEditorOutsideClick, true);
}

// ── Modal alias picker (triggered from the Value input in Create/Edit modals) ──

function getOrCreateModalAliasPicker(): HTMLElement {
  let el = document.getElementById("modal-alias-picker");
  if (!el) {
    el = document.createElement("div");
    el.id = "modal-alias-picker";
    el.className = "modal-alias-picker modal-alias-picker--hidden";
    document.body.appendChild(el);
  }
  return el;
}

function positionModalAliasPicker(): void {
  if (!modalAliasPicker) return;
  const popover = document.getElementById("modal-alias-picker");
  if (!popover) return;
  const rect = modalAliasPicker.anchorEl.getBoundingClientRect();
  const popWidth = 280;
  const left = Math.min(rect.right - popWidth, window.innerWidth - popWidth - 8);
  popover.style.width = `${popWidth}px`;
  popover.style.top  = `${rect.bottom + 4}px`;
  popover.style.left = `${Math.max(8, left)}px`;
}

function renderModalAliasPicker(): void {
  if (!modalAliasPicker) return;
  const popover = document.getElementById("modal-alias-picker");
  if (!popover) return;

  const { pickerSets, searchValue, collapsedGroups } = modalAliasPicker;
  const listContent = buildAliasPickerListHtml(pickerSets, searchValue, collapsedGroups);

  popover.innerHTML = `
    <div class="alias-picker-search-row">
      <input class="alias-picker-search" type="text" value="${esc(searchValue)}"
             placeholder="Search tokens…" spellcheck="false" autocomplete="off" />
    </div>
    <div class="alias-picker-list" role="listbox">${listContent}</div>`;

  const searchInput = popover.querySelector<HTMLInputElement>(".alias-picker-search")!;
  searchInput.focus();
  searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
  searchInput.addEventListener("input", () => {
    if (modalAliasPicker) { modalAliasPicker.searchValue = searchInput.value; renderModalAliasPicker(); }
  });
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModalAliasPicker();
  });

  popover.querySelectorAll<HTMLElement>(".alias-picker-group-label[data-set-id]").forEach((label) => {
    label.addEventListener("click", () => {
      if (!modalAliasPicker) return;
      const setId = label.dataset.setId!;
      if (modalAliasPicker.collapsedGroups.has(setId)) {
        modalAliasPicker.collapsedGroups.delete(setId);
      } else {
        modalAliasPicker.collapsedGroups.add(setId);
      }
      renderModalAliasPicker();
    });
  });

  popover.querySelectorAll<HTMLElement>(".alias-picker-item").forEach((item) => {
    item.addEventListener("click", () => {
      insertAliasIntoValueInput(item.dataset.tokenName!);
      closeModalAliasPicker();
    });
  });
}

function insertAliasIntoValueInput(tokenName: string): void {
  const targetId = modalAliasPicker?.targetInputId ?? "token-value-input";
  const input = document.getElementById(targetId) as HTMLInputElement | null;
  if (!input) return;
  const alias = `{${tokenName}}`;
  input.value = alias;
  input.setSelectionRange(alias.length, alias.length);
  input.focus();
}

function onModalAliasPickerOutsideClick(e: MouseEvent): void {
  const popover = document.getElementById("modal-alias-picker");
  if (!popover || !modalAliasPicker) return;
  const target = e.target as Node;
  if (!popover.contains(target) && !modalAliasPicker.anchorEl.contains(target)) {
    closeModalAliasPicker();
  }
}

function closeModalAliasPicker(): void {
  modalAliasPicker = null;
  const popover = document.getElementById("modal-alias-picker");
  if (popover) popover.classList.add("modal-alias-picker--hidden");
  document.removeEventListener("mousedown", onModalAliasPickerOutsideClick, true);
}

function openModalAliasPicker(tokenType: string, anchorEl: HTMLElement, targetInputId = "token-value-input"): void {
  // Toggle: close if already open for the same trigger
  if (modalAliasPicker && modalAliasPicker.anchorEl === anchorEl) { closeModalAliasPicker(); return; }
  if (modalAliasPicker) closeModalAliasPicker();

  modalAliasPicker = { tokenType, searchValue: "", pickerSets: [], collapsedGroups: new Set(), anchorEl, targetInputId };

  const popover = getOrCreateModalAliasPicker();
  popover.classList.remove("modal-alias-picker--hidden");
  positionModalAliasPicker();
  modalAliasPicker.pickerSets = pickerSetsFor(tokenType);
  renderModalAliasPicker();

  setTimeout(() => {
    document.addEventListener("mousedown", onModalAliasPickerOutsideClick, true);
  }, 0);
}

// ════════════════════════════════════════════════════════════════════════
//  SMART FONT PICKER
//  A lightweight searchable dropdown that floats below a font-family input.
//  Two sections: "Document Fonts" (scanned live) + "Popular Fonts" (static).
//  Custom / unknown font names typed directly are always accepted.
// ════════════════════════════════════════════════════════════════════════

// The input element currently driving the open picker (null = closed).
let fontPickerInput: HTMLInputElement | null = null;

function openFontPicker(inputEl: HTMLInputElement): void {
  // Clicking an already-open picker's own input is a no-op
  if (fontPickerInput === inputEl && document.getElementById("font-picker-dropdown")) return;
  closeFontPicker();
  fontPickerInput = inputEl;

  // Kick off a fresh document-font scan every time the picker opens
  sendToPlugin({ type: "scan-fonts" });

  renderFontPicker();

  inputEl.addEventListener("input", renderFontPicker);
  inputEl.addEventListener("keydown", onFontPickerKeydown);
  setTimeout(() => {
    document.addEventListener("mousedown", onFontPickerOutsideClick, true);
  }, 0);
}

function closeFontPicker(): void {
  if (!fontPickerInput) return;
  fontPickerInput.removeEventListener("input", renderFontPicker);
  fontPickerInput.removeEventListener("keydown", onFontPickerKeydown);
  document.removeEventListener("mousedown", onFontPickerOutsideClick, true);
  document.getElementById("font-picker-dropdown")?.remove();
  fontPickerInput = null;
}

function onFontPickerKeydown(e: KeyboardEvent): void {
  // Enter / Escape: commit the typed value and close
  if (e.key === "Enter" || e.key === "Escape") {
    e.preventDefault();
    closeFontPicker();
  }
}

function onFontPickerOutsideClick(e: MouseEvent): void {
  const dropdown = document.getElementById("font-picker-dropdown");
  const t = e.target as Node;
  if (dropdown?.contains(t) || fontPickerInput?.contains(t)) return;
  closeFontPicker();
}

function renderFontPicker(): void {
  if (!fontPickerInput) return;
  const query = fontPickerInput.value.toLowerCase().trim();

  // Document fonts: always show all matches (usually a small set)
  const docFonts = query
    ? state.documentFonts.filter((f) => f.toLowerCase().includes(query))
    : state.documentFonts;

  // Catalog fonts: exclude anything already in the document section,
  // apply the query filter, then cap the unfiltered list to avoid DOM overload.
  const docFontSet = new Set(state.documentFonts);
  const catalogBase = CATALOG_FAMILIES.filter((f) => !docFontSet.has(f));
  const catalogMatches = query
    ? catalogBase.filter((f) => f.toLowerCase().includes(query))
    : catalogBase.slice(0, CATALOG_MAX_UNFILTERED);
  const catalogTruncated =
    !query && catalogBase.length > CATALOG_MAX_UNFILTERED;

  const renderItems = (fonts: string[]): string =>
    fonts
      .map((f) => `<div class="fp-item" data-font="${esc(f)}">${esc(f)}</div>`)
      .join("");

  const hasDoc = docFonts.length > 0;
  const hasCat = catalogMatches.length > 0;

  const html =
    !hasDoc && !hasCat
      ? '<div class="fp-empty">No fonts match</div>'
      : (hasDoc
          ? `<div class="fp-section-header">Document Fonts</div>${renderItems(docFonts)}`
          : "") +
        (hasDoc && hasCat ? '<div class="fp-divider"></div>' : "") +
        (hasCat
          ? `<div class="fp-section-header">Fonts</div>${renderItems(catalogMatches)}` +
            (catalogTruncated
              ? `<div class="fp-hint">Showing ${CATALOG_MAX_UNFILTERED} of ${catalogBase.length} — type to search all</div>`
              : "")
          : "");

  // Create or reuse the dropdown element (attached to body to escape modal overflow)
  let dropdown = document.getElementById("font-picker-dropdown");
  if (!dropdown) {
    dropdown = document.createElement("div");
    dropdown.id = "font-picker-dropdown";
    document.body.appendChild(dropdown);
  }
  dropdown.innerHTML = html;

  // Position directly below the input
  const rect = fontPickerInput.getBoundingClientRect();
  dropdown.style.left = `${rect.left}px`;
  dropdown.style.top = `${rect.bottom + 4}px`;
  dropdown.style.width = `${Math.max(rect.width, 220)}px`;

  // mousedown (not click) fires before the input loses focus, so we can
  // prevent blur with e.preventDefault() and keep the input focused.
  dropdown.querySelectorAll<HTMLElement>(".fp-item").forEach((item) => {
    item.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const font = item.dataset.font!;
      const target = fontPickerInput; // capture before closeFontPicker clears it
      closeFontPicker();
      if (target) {
        target.value = font;
        // Notify any other listeners (e.g. color swatch preview)
        target.dispatchEvent(new Event("input", { bubbles: true }));
        target.focus();
      }
    });
  });
}

// Called after every modal render that may contain font-picker inputs.
// Attaches the picker to every [data-font-picker] input and its paired chevron.
function bindFontPicker(): void {
  document
    .querySelectorAll<HTMLInputElement>('[data-font-picker="true"]')
    .forEach((input) => {
      input.addEventListener("click", () => openFontPicker(input));
    });

  // Chevron buttons carry data-font-picker-trigger="<inputId>" so they open
  // the same picker as clicking the input itself.
  document
    .querySelectorAll<HTMLButtonElement>("[data-font-picker-trigger]")
    .forEach((btn) => {
      const inputId = btn.dataset.fontPickerTrigger!;
      const input = document.getElementById(inputId) as HTMLInputElement | null;
      if (input) btn.addEventListener("click", () => openFontPicker(input));
    });
}

function bindValueAliasTrigger(): void {
  const btn = document.getElementById("value-alias-trigger-btn") as HTMLButtonElement | null;
  if (!btn) return;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    openModalAliasPicker(btn.dataset.tokenType ?? "color", btn);
  });
}

function bindCompositePropAliasTriggers(): void {
  document.querySelectorAll<HTMLButtonElement>(".composite-alias-trigger").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openModalAliasPicker(
        btn.dataset.tokenType ?? "dimension",
        btn,
        btn.dataset.targetInput ?? ""
      );
    });
  });
}

function saveAlias(): void {
  if (!aliasEditor) return;
  const { token, inputValue, compositeCtx } = aliasEditor;
  const value = compositeCtx
    ? buildCompositeValueWithProp(token, compositeCtx.propKey, inputValue.trim())
    : inputValue;
  if (state.selectedSetId) {
    void runOps([{
      op: "update-token",
      setId: state.selectedSetId,
      tokenId: token.id,
      name: token.name,
      value,
      description: token.description,
    }]);
  }
  closeAliasEditor();
}

// ── Shared picker list renderer ───────────────────────────────────────────
// Used by both the chip alias editor (list mode) and the modal alias picker.

function buildAliasPickerListHtml(
  pickerSets: AliasPickerSet[],
  searchValue: string,
  collapsedGroups: Set<string>
): string {
  const query = searchValue.toLowerCase();
  const filtered = pickerSets
    .map((s) => {
      const sorted = [...s.tokens].sort((a, b) => a.name.localeCompare(b.name));
      return {
        ...s,
        tokens: query ? sorted.filter((t) => t.name.toLowerCase().includes(query)) : sorted,
      };
    })
    .filter((s) => s.tokens.length > 0);

  if (filtered.length === 0)   return `<div class="alias-picker-empty">No tokens found</div>`;

  const chevRight = `<svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6 4 4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const chevDown  = `<svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  return filtered.map((s) => {
    const collapsed = collapsedGroups.has(s.setId);
    const chevron = collapsed ? chevRight : chevDown;
    const items = collapsed ? "" : s.tokens.map((t) => {
      const bg = t.type === "color" ? (t.resolvedValue ?? "") : "";
      const preview = bg
        ? `<span class="color-swatch" style="background:${esc(bg)}" aria-hidden="true"></span>`
        : `<span class="alias-picker-item-icon">${tokenIcon(t.type)}</span>`;
      return `<div class="alias-picker-item" data-token-name="${esc(t.name)}" role="option">
          <span class="alias-picker-item-name">${esc(t.name)}</span>
          ${preview}
        </div>`;
    }).join("");
    return `<div class="alias-picker-group">
      <div class="alias-picker-group-label" data-set-id="${esc(s.setId)}" role="button" tabindex="0">
        ${chevron}
        <span>${esc(s.setName)}</span>
      </div>
      ${items}
    </div>`;
  }).join("");
}

function renderAliasEditor(): void {
  if (!aliasEditor) return;
  const popover = document.getElementById("alias-editor-popover");
  if (!popover) return;

  const { token, inputValue, searchValue, mode, pickerSets } = aliasEditor;
  const resolvedBg = token.type === "color" ? (token.resolvedValue ?? "") : "";
  const swatchHtml = resolvedBg
    ? `<span class="color-swatch alias-editor-swatch" style="background:${esc(resolvedBg)}" aria-hidden="true"></span>`
    : `<span class="alias-editor-swatch-placeholder"></span>`;

  if (mode === "edit") {
    popover.innerHTML = `
      <div class="alias-editor-input-row">
        ${swatchHtml}
        <input class="alias-editor-input" type="text"
               value="${esc(inputValue)}" spellcheck="false" autocomplete="off" />
        <button class="icon-btn alias-editor-chevron" id="ae-toggle" title="Browse tokens">
          ${CHEV_DOWN}
        </button>
      </div>
      <div class="alias-editor-actions">
        <button class="alias-editor-cancel" id="ae-cancel" type="button" data-appearance="secondary">Cancel</button>
        <button class="alias-editor-save"   id="ae-save"   type="button" data-appearance="primary">Save</button>
      </div>`;

    const input = popover.querySelector<HTMLInputElement>(".alias-editor-input")!;
    input.focus();
    input.select();
    input.addEventListener("input", () => { if (aliasEditor) aliasEditor.inputValue = input.value; });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter")  { e.preventDefault(); saveAlias(); }
      if (e.key === "Escape") closeAliasEditor();
    });
    popover.querySelector("#ae-toggle")?.addEventListener("click", () => {
      if (!aliasEditor) return;
      aliasEditor.mode = "list";
      aliasEditor.pickerSets = pickerSetsFor(aliasEditor.compositeCtx?.propType ?? aliasEditor.token.type);
      renderAliasEditor();
    });
    popover.querySelector("#ae-cancel")?.addEventListener("click", closeAliasEditor);
    popover.querySelector("#ae-save")?.addEventListener("click",   saveAlias);

  } else {
    // ── List mode ────────────────────────────────────────────────────────
    const listContent = buildAliasPickerListHtml(pickerSets, searchValue, aliasEditor.collapsedGroups);

    popover.innerHTML = `
      <div class="alias-editor-input-row">
        ${swatchHtml}
        <span class="alias-editor-preview-name">${esc(inputValue)}</span>
        <button class="icon-btn alias-editor-chevron" id="ae-toggle" title="Close list">
          ${CHEV_UP}
        </button>
      </div>
      <div class="alias-picker-search-row">
        <input class="alias-picker-search" type="text" value="${esc(searchValue)}"
               placeholder="Search tokens…" spellcheck="false" autocomplete="off" />
      </div>
      <div class="alias-picker-list" role="listbox">${listContent}</div>`;

    const searchInput = popover.querySelector<HTMLInputElement>(".alias-picker-search")!;
    searchInput.focus();
    searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
    searchInput.addEventListener("input", () => {
      if (aliasEditor) { aliasEditor.searchValue = searchInput.value; renderAliasEditor(); }
    });
    popover.querySelector("#ae-toggle")?.addEventListener("click", () => {
      if (aliasEditor) { aliasEditor.mode = "edit"; renderAliasEditor(); }
    });
    popover.querySelectorAll<HTMLElement>(".alias-picker-group-label[data-set-id]").forEach((label) => {
      label.addEventListener("click", () => {
        if (!aliasEditor) return;
        const setId = label.dataset.setId!;
        if (aliasEditor.collapsedGroups.has(setId)) {
          aliasEditor.collapsedGroups.delete(setId);
        } else {
          aliasEditor.collapsedGroups.add(setId);
        }
        renderAliasEditor();
      });
    });

    popover.querySelectorAll<HTMLElement>(".alias-picker-item").forEach((item) => {
      item.addEventListener("click", () => {
        if (!aliasEditor) return;
        aliasEditor.inputValue = `{${item.dataset.tokenName!}}`;
        aliasEditor.mode = "edit";
        renderAliasEditor();
      });
    });
  }
}

function onAliasChipClick(tokenId: string, chipEl: HTMLElement): void {
  const token = state.tokens.find((t) => t.id === tokenId);
  if (!token) return;

  const propKey  = chipEl.dataset.propKey;
  const propType = chipEl.dataset.propType;
  const compositeCtx = propKey && propType ? { propKey, propType } : undefined;

  // If clicking the already-open chip for the same prop, just close
  if (
    aliasEditor &&
    aliasEditor.token.id === tokenId &&
    aliasEditor.compositeCtx?.propKey === propKey
  ) {
    closeAliasEditor();
    return;
  }

  closeAliasEditor();

  const inputValue = compositeCtx
    ? getCompositeSubValue(token, compositeCtx.propKey)
    : token.value;

  aliasEditor = {
    token,
    inputValue,
    searchValue: "",
    mode: "edit",
    pickerSets: [],
    chipEl,
    collapsedGroups: new Set(),
    compositeCtx,
  };

  const popover = getOrCreateEditorPopover();
  popover.classList.remove("alias-editor-hidden");
  positionAliasEditor();
  renderAliasEditor();

  // Defer outside-click to avoid the current click from closing immediately
  setTimeout(() => {
    document.addEventListener("mousedown", onAliasEditorOutsideClick, true);
  }, 0);
}

function renderTokenTable(): void {
  const bodyEl = el("tokens-table-body");
  const query = (el<HTMLInputElement>("tokens-search-input")?.value ?? "").toLowerCase();

  const filtered = getSortedTokens(
    state.tokens.filter(
      (t) =>
        !query ||
        t.name.toLowerCase().includes(query) ||
        t.type.toLowerCase().includes(query) ||
        t.value.toLowerCase().includes(query)
    )
  );

  if (filtered.length === 0) {
    bodyEl.innerHTML = `<div class="empty-state-msg body-s">${
      state.tokens.length === 0
        ? 'No tokens yet. Click "+ New token" to add one.'
        : "No tokens match your search."
    }</div>`;
    updateSortHeaders();
    return;
  }

  const groupHeader = `
    <div class="token-group-header">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.5"
              stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span>${filtered.length}</span>
    </div>`;

  const rows = filtered
    .map(
      (token, idx) => `
    <div class="token-row" data-token-id="${esc(token.id)}" role="row">
      <div class="tcol-check">
        <span class="row-num">${idx + 1}</span>
        <input type="checkbox" class="checkbox-input token-check"
               data-token-id="${esc(token.id)}" aria-label="Select ${esc(token.name)}" />
      </div>
      <div class="tcol-name">
        <span class="col-name-text" title="${esc(token.name)}">${esc(token.name)}</span>
      </div>
      <div class="tcol-value">
        <div class="col-value-inner">
          ${valueCellHtml(token)}
        </div>
      </div>
      <div class="tcol-resolved">
        ${resolvedValueCellHtml(token)}
      </div>
      <div class="tcol-type">
        <div class="col-type-inner">
          <span class="token-type-icon">${tokenIcon(token.type)}</span>
          <span class="token-type-label">${esc(token.type)}</span>
        </div>
      </div>
      <div class="tcol-actions">
        <button class="icon-btn token-menu-btn" data-token-id="${esc(token.id)}"
                title="Token options" aria-label="Options for ${esc(token.name)}">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="3.5" cy="8" r="1.2" fill="currentColor"/>
            <circle cx="8" cy="8" r="1.2" fill="currentColor"/>
            <circle cx="12.5" cy="8" r="1.2" fill="currentColor"/>
          </svg>
        </button>
      </div>
    </div>`
    )
    .join("");

  bodyEl.innerHTML = groupHeader + rows;
  updateSortHeaders();

  bodyEl.querySelectorAll<HTMLElement>(".token-menu-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const tokenId = btn.dataset.tokenId!;
      const token = state.tokens.find((t) => t.id === tokenId);
      if (token) showTokenContextMenu(e as MouseEvent, token);
    });
  });

  bodyEl.querySelectorAll<HTMLElement>(".alias-chip").forEach((chip) => {
    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      onAliasChipClick(chip.dataset.tokenId!, chip);
    });
  });

  // Sync checkbox states and wire change listeners
  bodyEl.querySelectorAll<HTMLInputElement>(".token-check").forEach((cb) => {
    const tokenId = cb.dataset.tokenId!;
    cb.checked = selectedTokenIds.has(tokenId);
    cb.addEventListener("change", () => {
      if (cb.checked) {
        selectedTokenIds.add(tokenId);
      } else {
        selectedTokenIds.delete(tokenId);
      }
      syncSelectAllCheckbox();
      renderBulkBar();
    });
  });

  syncSelectAllCheckbox();
  renderBulkBar();
}

// ════════════════════════════════════════════════════════════════════════
//  CONTEXT MENU
// ════════════════════════════════════════════════════════════════════════

interface MenuItem {
  label: string;
  icon: string;
  action: () => void;
  danger?: boolean;
  /** If true, render a thin separator line immediately before this item. */
  divider?: boolean;
}

let contextCleanup: (() => void) | null = null;

function showContextMenu(x: number, y: number, items: MenuItem[]): void {
  if (contextCleanup) contextCleanup();

  const menu = el("context-menu");
  menu.innerHTML = items
    .map((item, i) => {
      const dividerHtml = item.divider
        ? `<div class="context-menu-divider" aria-hidden="true"></div>`
        : "";
      return `${dividerHtml}<div class="context-menu-item${item.danger ? " danger" : ""}"
         data-idx="${i}" role="menuitem" tabindex="0">
      ${item.icon}
      <span>${esc(item.label)}</span>
    </div>`;
    })
    .join("");

  menu.classList.remove("hidden");

  // Smart positioning — account for dividers adding ~9 px each
  const dividerCount = items.filter((i) => i.divider).length;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const mW = 160;
  const mH = items.length * 38 + dividerCount * 9 + 8;
  menu.style.left = `${Math.min(x, vw - mW - 4)}px`;
  menu.style.top = `${Math.min(y, vh - mH - 4)}px`;

  menu.querySelectorAll<HTMLElement>(".context-menu-item").forEach((item) => {
    item.addEventListener("click", () => {
      items[parseInt(item.dataset.idx!)]?.action();
      closeContextMenu();
    });
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter") item.click();
    });
  });

  const closeOnOutside = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) closeContextMenu();
  };
  setTimeout(() => document.addEventListener("click", closeOnOutside), 10);
  contextCleanup = () => {
    document.removeEventListener("click", closeOnOutside);
    contextCleanup = null;
  };
}

function closeContextMenu(): void {
  el("context-menu").classList.add("hidden");
  if (contextCleanup) contextCleanup();
}

// SVG icon snippets for menus
const ICON_RENAME = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10.5 2.5 13.5 5.5 6 13H3v-3l7.5-7.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M9 4 12 7" stroke="currentColor" stroke-width="1.3"/></svg>`;
const ICON_DUPLICATE = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="5" y="5" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M3 11V3h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_DELETE = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 5h10M6 5V3h4v2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 5 12 13H4L3 5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_EDIT = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10.5 2.5 13.5 5.5 6 13H3v-3l7.5-7.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
const ICON_MOVE = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13 8H3M10 5l3 3-3 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_COMPARE = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="1.5" y="3" width="5" height="10" rx="1" stroke="currentColor" stroke-width="1.3"/><rect x="9.5" y="3" width="5" height="10" rx="1" stroke="currentColor" stroke-width="1.3"/></svg>`;

function showSetContextMenu(e: MouseEvent, setId: string): void {
  const set = state.sets.find((s) => s.id === setId);
  if (!set) return;
  showContextMenu(e.clientX, e.clientY, [
    {
      label: "Rename",
      icon: ICON_RENAME,
      action: () => showRenameSetModal(set),
    },
    {
      label: "Duplicate",
      icon: ICON_DUPLICATE,
      action: () => void runOps([{ op: "duplicate-set", setId }]),
    },
    {
      label: "Delete",
      icon: ICON_DELETE,
      danger: true,
      action: () => showDeleteSetConfirm(set),
    },
    {
      label: "Compare sets",
      icon: ICON_COMPARE,
      divider: true,
      action: () => enterCompareMode(setId),
    },
  ]);
}

function showTokenContextMenu(e: MouseEvent, token: SerializedToken): void {
  showContextMenu(e.clientX, e.clientY, [
    {
      label: "Edit",
      icon: ICON_EDIT,
      action: () => showEditTokenModal(token),
    },
    {
      label: "Move",
      icon: ICON_MOVE,
      action: () => showMoveTokenModal(token),
    },
    {
      label: "Duplicate",
      icon: ICON_DUPLICATE,
      action: () => {
        if (state.selectedSetId) {
          void runOps([{ op: "duplicate-token", setId: state.selectedSetId, tokenId: token.id }]);
        }
      },
    },
    {
      label: "Delete",
      icon: ICON_DELETE,
      danger: true,
      action: () => showDeleteTokenConfirm(token),
    },
  ]);
}

// ════════════════════════════════════════════════════════════════════════
//  MODAL HELPERS
// ════════════════════════════════════════════════════════════════════════

function showModal(html: string): void {
  el("modal-container").innerHTML = html;
  el("modal-overlay").classList.remove("hidden");
  // Bind [data-modal-close] buttons
  el("modal-container")
    .querySelectorAll<HTMLElement>("[data-modal-close]")
    .forEach((btn) => btn.addEventListener("click", closeModal));
  // Focus first input
  setTimeout(
    () => el("modal-container").querySelector<HTMLElement>("input, select, textarea")?.focus(),
    50
  );
}

function closeModal(): void {
  themesModal = null;
  closeModalAliasPicker();
  closeFontPicker();
  el("modal-overlay").classList.add("hidden");
  el("modal-container").innerHTML = "";
  el("modal-container").className = "modal"; // reset any modifier classes (e.g. modal--wide)
}

// Close modal when clicking the dark overlay
el("modal-overlay")?.addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeModal();
});

const CLOSE_BTN_SVG = `
  <button class="icon-btn" data-modal-close title="Close" aria-label="Close">
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 4 12 12M12 4 4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>
  </button>`;

// ════════════════════════════════════════════════════════════════════════
//  MODAL: CREATE NEW SET
// ════════════════════════════════════════════════════════════════════════

function showNewSetModal(): void {
  showModal(`
    <div class="modal-header">
      <h2 class="modal-title">Create new set</h2>
      ${CLOSE_BTN_SVG}
    </div>
    <div class="modal-body">
      <input type="text" class="input form-input" id="new-set-name-input"
             placeholder='Enter name (use "/" for groups)' autocomplete="off" />
    </div>
    <div class="modal-footer">
      <div class="modal-footer-left">
        <button type="button" class="upload-btn" id="upload-set-btn">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 10V3M5.5 5.5 8 3l2.5 2.5" stroke="currentColor" stroke-width="1.3"
                  stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M3 12v1.5h10V12" stroke="currentColor" stroke-width="1.3"
                  stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          UPLOAD SET
        </button>
      </div>
      <button type="button" data-appearance="primary" id="confirm-create-set-btn">
        CREATE SET
      </button>
    </div>`);

  const nameInput = el<HTMLInputElement>("new-set-name-input");
  const confirmBtn = el("confirm-create-set-btn");

  const doCreate = () => {
    const name = nameInput.value.trim();
    if (!name) { nameInput.classList.add("error"); return; }
    void runOps([{ op: "create-set", name }]);
    closeModal();
  };

  confirmBtn.addEventListener("click", doCreate);
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doCreate();
    if (e.key === "Escape") closeModal();
  });
}

// ════════════════════════════════════════════════════════════════════════
//  MODAL: RENAME SET
// ════════════════════════════════════════════════════════════════════════

function showRenameSetModal(set: SerializedSet): void {
  showModal(`
    <div class="modal-header">
      <h2 class="modal-title">Rename set</h2>
      ${CLOSE_BTN_SVG}
    </div>
    <div class="modal-body">
      <div class="form-field">
        <label class="form-label" for="rename-set-input">Name</label>
        <input type="text" class="input form-input" id="rename-set-input"
               value="${esc(set.name)}" autocomplete="off" />
      </div>
    </div>
    <div class="modal-footer">
      <button type="button" data-appearance="secondary" data-modal-close>CANCEL</button>
      <button type="button" data-appearance="primary" id="confirm-rename-set-btn">RENAME</button>
    </div>`);

  const input = el<HTMLInputElement>("rename-set-input");
  input.select();

  const doRename = () => {
    const newName = input.value.trim();
    if (!newName || newName === set.name) { closeModal(); return; }
    void runOps([{ op: "rename-set", setId: set.id, newName }]);
    closeModal();
  };

  el("confirm-rename-set-btn").addEventListener("click", doRename);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doRename();
    if (e.key === "Escape") closeModal();
  });
}

// ════════════════════════════════════════════════════════════════════════
//  MODAL: DELETE SET CONFIRMATION
// ════════════════════════════════════════════════════════════════════════

function showDeleteSetConfirm(set: SerializedSet): void {
  showModal(`
    <div class="modal-header">
      <h2 class="modal-title">Delete Set</h2>
      ${CLOSE_BTN_SVG}
    </div>
    <div class="modal-body">
      <p class="body-s">
        Are you sure you want to delete <strong>${esc(set.name)}</strong>?
        This will also delete all its tokens.
      </p>
    </div>
    <div class="modal-footer">
      <button type="button" data-appearance="secondary" data-modal-close>Cancel</button>
      <button type="button" data-appearance="primary" data-variant="destructive"
              id="confirm-delete-set-btn">Delete</button>
    </div>`);

  el("confirm-delete-set-btn").addEventListener("click", () => {
    void runOps([{ op: "delete-set", setId: set.id }]);
    if (state.selectedSetId === set.id) selectSet(null);
    closeModal();
  });
}

// ════════════════════════════════════════════════════════════════════════
//  MODAL: DELETE TOKEN CONFIRMATION
// ════════════════════════════════════════════════════════════════════════

function showDeleteTokenConfirm(token: SerializedToken): void {
  showModal(`
    <div class="modal-header">
      <h2 class="modal-title">Delete Token</h2>
      ${CLOSE_BTN_SVG}
    </div>
    <div class="modal-body">
      <p class="body-s">
        Are you sure you want to delete <strong>${esc(token.name)}</strong>?
      </p>
      ${deleteWarningHtml([token.name], new Set([token.id]))}
    </div>
    <div class="modal-footer">
      <button type="button" data-appearance="secondary" data-modal-close>Cancel</button>
      <button type="button" data-appearance="primary" data-variant="destructive"
              id="confirm-delete-token-btn">Delete</button>
    </div>`);

  el("confirm-delete-token-btn").addEventListener("click", () => {
    if (state.selectedSetId) {
      void runOps([{ op: "delete-token", setId: state.selectedSetId, tokenId: token.id }]);
    }
    closeModal();
  });
}

// ════════════════════════════════════════════════════════════════════════
//  MODAL: MOVE TOKEN
// ════════════════════════════════════════════════════════════════════════

function showMoveTokenModal(token: SerializedToken): void {
  const otherSets = state.sets.filter((s) => s.id !== state.selectedSetId);

  showModal(`
    <div class="modal-header">
      <h2 class="modal-title">Move Token ${esc(token.name)}</h2>
      ${CLOSE_BTN_SVG}
    </div>
    <div class="modal-body">
      <div class="form-field">
        <div class="move-select-wrapper">
          <span class="body-s">To:</span>
          <select class="select" id="move-token-target">
            <option value="">Choose</option>
            ${otherSets.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="checkbox-container">
        <input type="checkbox" class="checkbox-input" id="move-token-copy" />
        <label for="move-token-copy" class="body-s">Copy (keep original)</label>
      </div>
    </div>
    <div class="modal-footer">
      <button type="button" data-appearance="secondary" data-modal-close>Cancel</button>
      <button type="button" data-appearance="primary" id="confirm-move-token-btn">Move</button>
    </div>`);

  el("confirm-move-token-btn").addEventListener("click", () => {
    const toSetId = el<HTMLSelectElement>("move-token-target").value;
    const copy = el<HTMLInputElement>("move-token-copy").checked;
    if (!toSetId || !state.selectedSetId) return;
    moveTokens([token.id], state.selectedSetId, toSetId, copy);
  });
}

// ════════════════════════════════════════════════════════════════════════
//  TOKEN TYPE DEFINITIONS
// ════════════════════════════════════════════════════════════════════════

interface TokenTypeDef {
  value: string;
  label: string;
  placeholder: string;
}

const TOKEN_TYPES: TokenTypeDef[] = [
  { value: "color", label: "Color", placeholder: "Enter a value or alias with {alias}" },
  { value: "borderRadius", label: "Border Radius", placeholder: "e.g. 4px or {alias.radius}" },
  { value: "dimension", label: "Dimension", placeholder: "e.g. 16px or {alias}" },
  { value: "fontFamilies", label: "Font Family", placeholder: "e.g. Inter, sans-serif" },
  { value: "fontSizes", label: "Font Size", placeholder: "e.g. 16px or {alias}" },
  { value: "fontWeights", label: "Font Weight", placeholder: "e.g. 400 or bold" },
  { value: "letterSpacing", label: "Letter Spacing", placeholder: "e.g. 0.05em or {alias}" },
  { value: "number", label: "Number", placeholder: "e.g. 8" },
  { value: "opacity", label: "Opacity", placeholder: "e.g. 0.5 or 50%" },
  { value: "rotation", label: "Rotation", placeholder: "e.g. 45" },
  { value: "shadow", label: "Shadow", placeholder: "" },
  { value: "sizing", label: "Sizing", placeholder: "e.g. 100px or {alias}" },
  { value: "spacing", label: "Spacing", placeholder: "e.g. 8px or {alias}" },
  { value: "borderWidth", label: "Stroke Width", placeholder: "e.g. 1px or {alias}" },
  { value: "textCase", label: "Text Case", placeholder: "uppercase | lowercase | capitalize | none" },
  { value: "textDecoration", label: "Text Decoration", placeholder: "none | underline | strike-through" },
  { value: "typography", label: "Typography", placeholder: "" },
];

function getTypeDef(value: string): TokenTypeDef {
  return TOKEN_TYPES.find((t) => t.value === value) ?? TOKEN_TYPES[0];
}

// POPULAR_FONTS retired — replaced by the full FONT_CATALOG imported at the
// top of this file (src/assets/fontCatalog.generated.ts, 1910+ fonts).
// The picker now shows the full catalog in alphabetical order, capped at
// CATALOG_MAX_UNFILTERED rows when no search query is active.

// Builds the value fields section for shadow tokens
const DEFAULT_SHADOW_LAYER: Record<string, string> = {
  type: "drop-shadow", x: "0", y: "4", blur: "8", spread: "0", color: "rgba(0,0,0,0.25)",
};

function shadowAliasTrigger(type: string, inputId: string): string {
  return `<button type="button" class="icon-btn value-alias-trigger composite-alias-trigger"
                  title="Insert alias reference"
                  data-token-type="${type}" data-target-input="${inputId}">${VALUE_ALIAS_INSERT_ICON}</button>`;
}

function shadowLayerHtml(layer: Record<string, string>, i: number, total: number): string {
  const v = (k: string) => esc(layer[k] ?? DEFAULT_SHADOW_LAYER[k]);
  const type = layer.type ?? "drop-shadow";
  const numField = (key: string, label: string) => `
      <div class="form-field">
        <label class="form-label" for="shadow-${key}-${i}">${label}</label>
        <div class="value-input-wrapper">
          <input type="text" class="input form-input" id="shadow-${key}-${i}" value="${v(key)}" />
          ${shadowAliasTrigger("dimension", `shadow-${key}-${i}`)}
        </div>
      </div>`;
  const header = total > 1
    ? `<div class="shadow-layer-header">
        <span class="form-label">Layer ${i + 1}</span>
        <button type="button" class="icon-btn shadow-layer-remove" data-remove-layer="${i}"
                title="Remove layer" aria-label="Remove layer ${i + 1}">${ICON_DELETE}</button>
      </div>`
    : "";
  return `
  <div class="shadow-layer" data-layer="${i}">
    ${header}
    <div class="form-field">
      <label class="form-label">Shadow type</label>
      <div style="display:flex;gap:14px;margin-top:2px">
        <div class="radio-container">
          <input type="radio" class="radio-input" name="shadow-type-${i}"
                 id="shadow-drop-${i}" value="drop-shadow" ${type !== "inner-shadow" ? "checked" : ""} />
          <label class="radio-label" for="shadow-drop-${i}">Drop shadow</label>
        </div>
        <div class="radio-container">
          <input type="radio" class="radio-input" name="shadow-type-${i}"
                 id="shadow-inner-${i}" value="inner-shadow" ${type === "inner-shadow" ? "checked" : ""} />
          <label class="radio-label" for="shadow-inner-${i}">Inner shadow</label>
        </div>
      </div>
    </div>
    <div class="shadow-grid">
      ${numField("x", "X")}
      ${numField("y", "Y")}
      ${numField("blur", "Blur")}
      ${numField("spread", "Spread")}
    </div>
    <div class="form-field">
      <label class="form-label" for="shadow-color-${i}">Color</label>
      <div class="value-input-wrapper">
        <span class="color-swatch-small" id="shadow-color-swatch-${i}"
              style="background:${v("color")}"></span>
        <input type="text" class="input form-input has-swatch" id="shadow-color-${i}"
               value="${v("color")}" placeholder="rgba(0,0,0,0.25)" />
        ${shadowAliasTrigger("color", `shadow-color-${i}`)}
      </div>
    </div>
  </div>`;
}

/** Shadow value editor: one block per layer plus an "Add layer" button. */
function shadowFieldsHtml(layers: Record<string, string>[] = [DEFAULT_SHADOW_LAYER]): string {
  const list = layers.length > 0 ? layers : [DEFAULT_SHADOW_LAYER];
  return `
    <div id="shadow-layers">${list.map((l, i) => shadowLayerHtml(l, i, list.length)).join("")}</div>
    <button type="button" class="shadow-add-layer-btn" id="shadow-add-layer">+ Add layer</button>`;
}

function readShadowLayers(): Record<string, string>[] {
  return [...document.querySelectorAll<HTMLElement>("#shadow-layers .shadow-layer")].map((node) => {
    const i = node.dataset.layer;
    const val = (key: string) => el<HTMLInputElement>(`shadow-${key}-${i}`)?.value ?? DEFAULT_SHADOW_LAYER[key];
    return {
      type: document.querySelector<HTMLInputElement>(`input[name="shadow-type-${i}"]:checked`)?.value ?? "drop-shadow",
      x: val("x"),
      y: val("y"),
      blur: val("blur"),
      spread: val("spread"),
      color: val("color"),
    };
  });
}

// Builds the value fields section for typography tokens.
// `vals` is produced by normalizeTypographyValueToForm → always uses the
// UI-form key names: fontFamily, fontSize (singular), fontWeight, etc.
function typographyFieldsHtml(vals: Record<string, string> = {}): string {
  const v = (k: string) => esc(vals[k] ?? "");
  return `
    <div class="typo-grid">
      <div class="form-field">
        <label class="form-label" for="typo-family">Font Family</label>
        <div class="value-input-wrapper">
          <input type="text" class="input form-input has-fp-chevron" id="typo-family"
                 value="${v("fontFamily")}" placeholder="Inter"
                 data-font-picker="true" autocomplete="off" />
          <button type="button" class="icon-btn fp-chevron-btn"
                  data-font-picker-trigger="typo-family"
                  title="Browse fonts">${CHEV_DOWN}</button>
          <button type="button" class="icon-btn value-alias-trigger composite-alias-trigger"
                  title="Insert alias reference"
                  data-token-type="fontFamilies" data-target-input="typo-family">${VALUE_ALIAS_INSERT_ICON}</button>
        </div>
      </div>
      <div class="form-field">
        <label class="form-label" for="typo-size">Font Size</label>
        <div class="value-input-wrapper">
          <input type="text" class="input form-input" id="typo-size"
                 value="${v("fontSize")}" placeholder="16px" />
          <button type="button" class="icon-btn value-alias-trigger composite-alias-trigger"
                  title="Insert alias reference"
                  data-token-type="fontSizes" data-target-input="typo-size">${VALUE_ALIAS_INSERT_ICON}</button>
        </div>
      </div>
      <div class="form-field">
        <label class="form-label" for="typo-weight">Font Weight</label>
        <div class="value-input-wrapper">
          <input type="text" class="input form-input" id="typo-weight"
                 value="${v("fontWeight")}" placeholder="400" />
          <button type="button" class="icon-btn value-alias-trigger composite-alias-trigger"
                  title="Insert alias reference"
                  data-token-type="fontWeights" data-target-input="typo-weight">${VALUE_ALIAS_INSERT_ICON}</button>
        </div>
      </div>
      <div class="form-field">
        <label class="form-label" for="typo-line-height">Line Height</label>
        <div class="value-input-wrapper">
          <input type="text" class="input form-input" id="typo-line-height"
                 value="${v("lineHeight")}" placeholder="1.5" />
          <button type="button" class="icon-btn value-alias-trigger composite-alias-trigger"
                  title="Insert alias reference"
                  data-token-type="number" data-target-input="typo-line-height">${VALUE_ALIAS_INSERT_ICON}</button>
        </div>
      </div>
      <div class="form-field">
        <label class="form-label" for="typo-letter-spacing">Letter Spacing</label>
        <div class="value-input-wrapper">
          <input type="text" class="input form-input" id="typo-letter-spacing"
                 value="${v("letterSpacing")}" placeholder="0" />
          <button type="button" class="icon-btn value-alias-trigger composite-alias-trigger"
                  title="Insert alias reference"
                  data-token-type="letterSpacing" data-target-input="typo-letter-spacing">${VALUE_ALIAS_INSERT_ICON}</button>
        </div>
      </div>
      <div class="form-field">
        <label class="form-label" for="typo-text-case">Text Case</label>
        <select class="select" id="typo-text-case">
          ${SELECT_OPTIONS.textCase.map((o) => `<option value="${o}"${o === v("textCase") ? " selected" : ""}>${o}</option>`).join("")}
        </select>
      </div>
      <div class="form-field" style="grid-column: 1/-1">
        <label class="form-label" for="typo-text-decoration">Text Decoration</label>
        <select class="select" id="typo-text-decoration">
          ${SELECT_OPTIONS.textDecoration.map((o) => `<option value="${o}"${o === legacyTextDecoration(v("textDecoration")) ? " selected" : ""}>${o}</option>`).join("")}
        </select>
      </div>
    </div>`;
}

const SELECT_OPTIONS: Record<string, string[]> = {
  textCase:       ["none", "uppercase", "lowercase", "capitalize"],
  // Penpot's value is "strike-through" (not CSS's "line-through").
  textDecoration: ["none", "underline", "strike-through"],
};

// Tokens created by earlier versions of the plugin used "line-through".
function legacyTextDecoration(value: string): string {
  return value === "line-through" ? "strike-through" : value;
}

// Builds the simple single-value input area
function simpleValueFieldHtml(type: string, value = ""): string {
  const isColor = type === "color";
  const isFontFamily = type === "fontFamilies";
  const selectOptions = SELECT_OPTIONS[type];

  if (selectOptions) {
    const current = type === "textDecoration" ? legacyTextDecoration(value) : value;
    const opts = selectOptions.map(
      (o) => `<option value="${o}"${o === current ? " selected" : ""}>${o}</option>`
    ).join("");
    return `
    <div class="form-field">
      <label class="form-label" for="token-value-input">Value</label>
      <select class="select" id="token-value-input">${opts}</select>
    </div>`;
  }

  const { placeholder } = getTypeDef(type);
  return `
    <div class="form-field">
      <label class="form-label" for="token-value-input">Value</label>
      <div class="value-input-wrapper">
        ${isColor ? `<span class="color-swatch-small" id="token-value-swatch" style="background:${esc(value || "#cccccc")}"></span>` : ""}
        ${isFontFamily ? `<div class="fp-input-wrap">` : ""}
        <input type="text" class="input form-input${isColor ? " has-swatch" : ""}${isFontFamily ? " has-fp-chevron" : ""}"
               id="token-value-input"
               value="${esc(value)}"
               placeholder="${esc(placeholder)}"
               autocomplete="off"${isFontFamily ? ' data-font-picker="true"' : ''} />
        ${isFontFamily ? `<button type="button" class="icon-btn fp-chevron-btn"
                data-font-picker-trigger="token-value-input"
                title="Browse fonts">${CHEV_DOWN}</button></div>` : ""}
        <button type="button" class="icon-btn value-alias-trigger" id="value-alias-trigger-btn"
                title="Insert alias reference" data-token-type="${esc(type)}">
          ${VALUE_ALIAS_INSERT_ICON}
        </button>
      </div>
    </div>`;
}

function readShadowValue(): string {
  return shadowLayersToValue(readShadowLayers());
}

function readTypographyValue(): string {
  // Collect raw values from the form using the canonical API key names.
  // fontFamilies / fontSizes use the plural form required by
  // TokenTypographyValueString.  Empty strings are stripped by the
  // sanitizer so Penpot never receives token_value_empty_fn errors.
  const raw: Record<string, string> = {
    fontFamilies:   el<HTMLInputElement>("typo-family")?.value       ?? "",
    fontSizes:      el<HTMLInputElement>("typo-size")?.value         ?? "",
    fontWeight:     el<HTMLInputElement>("typo-weight")?.value       ?? "",
    lineHeight:     el<HTMLInputElement>("typo-line-height")?.value  ?? "",
    letterSpacing:  el<HTMLInputElement>("typo-letter-spacing")?.value ?? "",
    textCase:       el<HTMLInputElement>("typo-text-case")?.value   ?? "",
    textDecoration: el<HTMLInputElement>("typo-text-decoration")?.value ?? "",
  };
  return JSON.stringify(sanitizeTypographyValueForApi(raw));
}

function readTokenValue(type: string): string {
  if (type === "shadow") return readShadowValue();
  if (type === "typography") return readTypographyValue();
  return el<HTMLInputElement>("token-value-input")?.value?.trim() ?? "";
}

// ════════════════════════════════════════════════════════════════════════
//  COLOR PICKER
// ════════════════════════════════════════════════════════════════════════

// ── State ─────────────────────────────────────────────────────────────

interface CpState {
  h: number; s: number; v: number; // 0-360, 0-100, 0-100
  a: number;                        // alpha 0-100
  mode: "hex" | "rgb" | "hsl";
  inputId: string;
  swatchId: string;
}

let cpState: CpState | null = null;

// ── DOM — built once, reused ──────────────────────────────────────────

function getOrCreateCp(): HTMLElement {
  let pop = document.getElementById("cp-popover");
  if (!pop) {
    pop = document.createElement("div");
    pop.id = "cp-popover";
    pop.className = "cp-popover cp-hidden";
    pop.innerHTML = `
      <div class="cp-sv-area" id="cp-sv-area">
        <div class="cp-sv-cursor" id="cp-sv-cursor"></div>
      </div>
      <div class="cp-sliders-wrap">
        <div class="cp-track cp-hue-track" id="cp-hue-track">
          <div class="cp-thumb" id="cp-hue-thumb"></div>
        </div>
        <div class="cp-track cp-alpha-track" id="cp-alpha-track">
          <div class="cp-alpha-gradient" id="cp-alpha-gradient"></div>
          <div class="cp-thumb" id="cp-alpha-thumb"></div>
        </div>
      </div>
      <div class="cp-inputs-wrap">
        <button class="cp-mode-btn" id="cp-mode-btn" type="button">HEX</button>
        <div class="cp-fields" id="cp-fields-hex">
          <input class="cp-field" id="cp-hex" maxlength="9" spellcheck="false" autocomplete="off" />
        </div>
        <div class="cp-fields cp-hidden" id="cp-fields-rgb">
          <input class="cp-field" id="cp-r"  type="number" min="0" max="255" />
          <input class="cp-field" id="cp-g"  type="number" min="0" max="255" />
          <input class="cp-field" id="cp-b"  type="number" min="0" max="255" />
        </div>
        <div class="cp-fields cp-hidden" id="cp-fields-hsl">
          <input class="cp-field" id="cp-hl" type="number" min="0" max="360" />
          <input class="cp-field" id="cp-sl" type="number" min="0" max="100" />
          <input class="cp-field" id="cp-ll" type="number" min="0" max="100" />
        </div>
        <div class="cp-alpha-wrap">
          <input class="cp-field" id="cp-al" type="number" min="0" max="100" />
          <span class="cp-alpha-pct">%</span>
        </div>
      </div>`;
    document.body.appendChild(pop);
    cpBindEvents();
  }
  return pop;
}

// ── Drag helper ───────────────────────────────────────────────────────

function cpDrag(
  target: HTMLElement,
  onMove: (x: number, y: number, w: number, h: number) => void
): void {
  target.addEventListener("mousedown", (e: MouseEvent) => {
    e.preventDefault();
    const fire = (ev: MouseEvent) => {
      const r = target.getBoundingClientRect();
      onMove(ev.clientX - r.left, ev.clientY - r.top, r.width, r.height);
    };
    fire(e);
    const mm = (ev: MouseEvent) => fire(ev);
    const mu = () => {
      document.removeEventListener("mousemove", mm);
      document.removeEventListener("mouseup", mu);
    };
    document.addEventListener("mousemove", mm);
    document.addEventListener("mouseup", mu);
  });
}

function cpClamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// ── Event binding ─────────────────────────────────────────────────────

function cpBindEvents(): void {
  // Saturation-Value area
  cpDrag(document.getElementById("cp-sv-area")!, (x, y, w, h) => {
    if (!cpState) return;
    cpState.s = cpClamp(x / w * 100, 0, 100);
    cpState.v = cpClamp(100 - y / h * 100, 0, 100);
    cpSync(); cpApply();
  });

  // Hue slider
  cpDrag(document.getElementById("cp-hue-track")!, (x, _y, w) => {
    if (!cpState) return;
    cpState.h = cpClamp(x / w * 360, 0, 360);
    cpSync(); cpApply();
  });

  // Alpha slider
  cpDrag(document.getElementById("cp-alpha-track")!, (x, _y, w) => {
    if (!cpState) return;
    cpState.a = cpClamp(x / w * 100, 0, 100);
    cpSync(); cpApply();
  });

  // Mode cycle: HEX → RGB → HSL → HEX
  document.getElementById("cp-mode-btn")!.addEventListener("click", () => {
    if (!cpState) return;
    const modes = ["hex", "rgb", "hsl"] as const;
    cpState.mode = modes[(modes.indexOf(cpState.mode) + 1) % 3];
    cpSyncMode();
    cpSyncInputs();
  });

  // Hex input
  (document.getElementById("cp-hex") as HTMLInputElement).addEventListener("input", function() {
    if (!cpState) return;
    const rgb = hexToRgb(this.value);
    if (rgb) {
      [cpState.h, cpState.s, cpState.v] = rgbToHsv(...rgb);
      // Also parse alpha from 8-digit hex
      const h = this.value.replace(/^#/, "");
      if (h.length === 8) cpState.a = parseInt(h.slice(6), 16) / 255 * 100;
      cpSync(); cpApply();
    }
  });

  // RGB inputs
  const syncRgb = () => {
    if (!cpState) return;
    const r = cpClamp(parseInt((document.getElementById("cp-r") as HTMLInputElement).value)||0, 0, 255);
    const g = cpClamp(parseInt((document.getElementById("cp-g") as HTMLInputElement).value)||0, 0, 255);
    const b = cpClamp(parseInt((document.getElementById("cp-b") as HTMLInputElement).value)||0, 0, 255);
    [cpState.h, cpState.s, cpState.v] = rgbToHsv(r, g, b);
    cpSync(); cpApply();
  };
  ["cp-r","cp-g","cp-b"].forEach(id =>
    (document.getElementById(id) as HTMLInputElement).addEventListener("input", syncRgb)
  );

  // HSL inputs
  const syncHsl = () => {
    if (!cpState) return;
    const hh = cpClamp(parseInt((document.getElementById("cp-hl") as HTMLInputElement).value)||0, 0, 360);
    const ss = cpClamp(parseInt((document.getElementById("cp-sl") as HTMLInputElement).value)||0, 0, 100);
    const ll = cpClamp(parseInt((document.getElementById("cp-ll") as HTMLInputElement).value)||0, 0, 100);
    const [r, g, b] = hslToRgb(hh, ss, ll);
    [cpState.h, cpState.s, cpState.v] = rgbToHsv(r, g, b);
    cpSync(); cpApply();
  };
  ["cp-hl","cp-sl","cp-ll"].forEach(id =>
    (document.getElementById(id) as HTMLInputElement).addEventListener("input", syncHsl)
  );

  // Alpha input
  (document.getElementById("cp-al") as HTMLInputElement).addEventListener("input", function() {
    if (!cpState) return;
    cpState.a = cpClamp(parseInt(this.value)||0, 0, 100);
    cpSync(); cpApply();
  });
}

// ── Sync visuals from state ───────────────────────────────────────────

function cpSync(): void {
  if (!cpState) return;
  const { h, s, v, a } = cpState;
  const [r, g, b] = hsvToRgb(h, s, v);

  // SV gradient background (3 layers: black↑, white→, pure hue)
  (document.getElementById("cp-sv-area") as HTMLElement).style.background =
    `linear-gradient(to bottom, transparent, #000),
     linear-gradient(to right,  #fff, transparent),
     hsl(${h}deg, 100%, 50%)`;

  // SV cursor
  const cur = document.getElementById("cp-sv-cursor") as HTMLElement;
  cur.style.left        = `${s}%`;
  cur.style.top         = `${100 - v}%`;
  cur.style.borderColor = v > 45 ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.8)";

  // Hue thumb
  (document.getElementById("cp-hue-thumb") as HTMLElement).style.left = `${h / 360 * 100}%`;

  // Alpha gradient overlay + thumb
  (document.getElementById("cp-alpha-gradient") as HTMLElement).style.background =
    `linear-gradient(to right, rgba(${r},${g},${b},0), rgb(${r},${g},${b}))`;
  (document.getElementById("cp-alpha-thumb") as HTMLElement).style.left = `${a}%`;

  cpSyncInputs();
}

function cpSyncInputs(): void {
  if (!cpState) return;
  const [r, g, b] = hsvToRgb(cpState.h, cpState.s, cpState.v);
  const [hl, sl, ll] = rgbToHsl(r, g, b);
  const setIdle = (id: string, val: string) => {
    const inp = document.getElementById(id) as HTMLInputElement;
    if (inp && document.activeElement !== inp) inp.value = val;
  };
  setIdle("cp-hex", rgbToHex(r, g, b));
  setIdle("cp-r",   String(r));
  setIdle("cp-g",   String(g));
  setIdle("cp-b",   String(b));
  setIdle("cp-hl",  String(hl));
  setIdle("cp-sl",  String(sl));
  setIdle("cp-ll",  String(ll));
  setIdle("cp-al",  String(Math.round(cpState.a)));
}

function cpSyncMode(): void {
  if (!cpState) return;
  (document.getElementById("cp-mode-btn") as HTMLElement).textContent = cpState.mode.toUpperCase();
  (document.getElementById("cp-fields-hex") as HTMLElement).classList.toggle("cp-hidden", cpState.mode !== "hex");
  (document.getElementById("cp-fields-rgb") as HTMLElement).classList.toggle("cp-hidden", cpState.mode !== "rgb");
  (document.getElementById("cp-fields-hsl") as HTMLElement).classList.toggle("cp-hidden", cpState.mode !== "hsl");
}

// ── Write colour back to modal input + swatch ─────────────────────────

function cpApply(): void {
  if (!cpState) return;
  const [r, g, b] = hsvToRgb(cpState.h, cpState.s, cpState.v);
  const value = cpState.a < 100
    ? `rgba(${r}, ${g}, ${b}, ${(cpState.a / 100).toFixed(2)})`
    : rgbToHex(r, g, b);
  const inp = document.getElementById(cpState.inputId) as HTMLInputElement;
  const swt = document.getElementById(cpState.swatchId) as HTMLElement;
  if (inp) inp.value = value;
  if (swt) swt.style.background = value;
}

// ── Open / close ──────────────────────────────────────────────────────

function cpOutsideClick(e: MouseEvent): void {
  const pop = document.getElementById("cp-popover");
  if (!pop || !cpState) return;
  const t = e.target as Node;
  if (!pop.contains(t) &&
      !document.getElementById(cpState.inputId)?.contains(t) &&
      !document.getElementById(cpState.swatchId)?.contains(t)) {
    closeCp();
  }
}

function closeCp(): void {
  cpState = null;
  document.getElementById("cp-popover")?.classList.add("cp-hidden");
  document.removeEventListener("mousedown", cpOutsideClick, true);
}

function openColorPicker(inputId: string, swatchId: string): void {
  const inp = document.getElementById(inputId) as HTMLInputElement;
  const parsed = inp ? parseCssColor(inp.value) : null;
  let h = 0, s = 0, v = 0, a = 100;
  if (parsed) {
    [h, s, v] = rgbToHsv(parsed[0], parsed[1], parsed[2]);
    a = Math.round(parsed[3] * 100);
  }

  closeCp();
  cpState = { h, s, v, a, mode: "hex", inputId, swatchId };

  const pop = getOrCreateCp();
  pop.classList.remove("cp-hidden");

  // Position below the trigger input
  const ref = document.getElementById(inputId);
  if (ref) {
    const rect = ref.getBoundingClientRect();
    const PW = 240;
    pop.style.width = `${PW}px`;
    pop.style.top   = `${rect.bottom + 6}px`;
    pop.style.left  = `${Math.min(rect.left, window.innerWidth - PW - 8)}px`;
  }

  cpSyncMode();
  cpSync();
  setTimeout(() => document.addEventListener("mousedown", cpOutsideClick, true), 0);
}

// ════════════════════════════════════════════════════════════════════════

function bindColorSwatchPreview(): void {
  const input = el<HTMLInputElement>("token-value-input");
  const swatch = el("token-value-swatch");
  if (!input || !swatch) return;

  // Live text-typed preview
  input.addEventListener("input", () => {
    swatch.style.background = input.value || "#cccccc";
  });

  // Swatch click → open picker
  swatch.style.pointerEvents = "auto";
  swatch.style.cursor = "pointer";
  swatch.addEventListener("click", (e) => {
    e.stopPropagation();
    openColorPicker("token-value-input", "token-value-swatch");
  });
}

// `bindAliasTriggers`: only after re-rendering layers — on first render the
// modal's bindCompositePropAliasTriggers() already covers these buttons.
function bindShadowColorPicker(bindAliasTriggers = false): void {
  const container = el("shadow-layers");
  if (!container) return;

  container.querySelectorAll<HTMLElement>(".shadow-layer").forEach((node) => {
    const i = node.dataset.layer;
    const input = el<HTMLInputElement>(`shadow-color-${i}`);
    const swatch = el(`shadow-color-swatch-${i}`);
    if (!input || !swatch) return;
    // Live text-typed preview
    input.addEventListener("input", () => {
      swatch.style.background = input.value || "rgba(0,0,0,0.25)";
    });
    // Swatch click → open picker
    swatch.style.pointerEvents = "auto";
    swatch.style.cursor = "pointer";
    swatch.addEventListener("click", (e) => {
      e.stopPropagation();
      openColorPicker(`shadow-color-${i}`, `shadow-color-swatch-${i}`);
    });
  });

  if (bindAliasTriggers) {
    container.querySelectorAll<HTMLButtonElement>(".composite-alias-trigger").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        openModalAliasPicker(btn.dataset.tokenType ?? "dimension", btn, btn.dataset.targetInput ?? "");
      });
    });
  }

  const rerender = (layers: Record<string, string>[]) => {
    container.innerHTML = layers.map((l, i) => shadowLayerHtml(l, i, layers.length)).join("");
    bindShadowColorPicker(true);
  };

  container.querySelectorAll<HTMLButtonElement>("[data-remove-layer]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const layers = readShadowLayers();
      layers.splice(Number(btn.dataset.removeLayer), 1);
      rerender(layers);
    });
  });

  const addBtn = el("shadow-add-layer");
  if (addBtn && !addBtn.dataset.bound) {
    addBtn.dataset.bound = "1";
    addBtn.addEventListener("click", () => {
      rerender([...readShadowLayers(), { ...DEFAULT_SHADOW_LAYER }]);
    });
  }
}

// ════════════════════════════════════════════════════════════════════════
//  MODAL: CREATE NEW TOKEN
// ════════════════════════════════════════════════════════════════════════

function buildValueSection(type: string, existingValue = ""): string {
  if (type === "shadow") return shadowFieldsHtml();
  if (type === "typography") return typographyFieldsHtml();
  return simpleValueFieldHtml(type, existingValue);
}

function showNewTokenModal(initialType = "color"): void {
  const typeOptions = TOKEN_TYPES.map(
    (t) => `<option value="${t.value}"${t.value === initialType ? " selected" : ""}>${t.label}</option>`
  ).join("");

  showModal(`
    <div class="modal-header">
      <h2 class="modal-title" id="token-modal-title">
        CREATE NEW ${getTypeDef(initialType).label.toUpperCase()} TOKEN
      </h2>
      ${CLOSE_BTN_SVG}
    </div>
    <div class="modal-body">
      <div class="form-field">
        <label class="form-label" for="token-type-select">Type</label>
        <select class="select form-input" id="token-type-select">${typeOptions}</select>
      </div>
      <div class="form-field">
        <label class="form-label" for="token-name-input">Name</label>
        <input type="text" class="input form-input" id="token-name-input"
               placeholder="Enter ${getTypeDef(initialType).label.toLowerCase()} token name"
               autocomplete="off" />
      </div>
      <div id="token-value-section">${buildValueSection(initialType)}</div>
      <div class="form-field">
        <label class="form-label" for="token-description-input">
          Description <span class="optional">(Optional)</span>
        </label>
        <input type="text" class="input form-input" id="token-description-input"
               placeholder="Description" autocomplete="off" />
      </div>
    </div>
    <div class="modal-footer">
      <button type="button" data-appearance="secondary" data-modal-close>CANCEL</button>
      <button type="button" data-appearance="primary" id="confirm-create-token-btn">SAVE</button>
    </div>`);

  if (initialType === "color") bindColorSwatchPreview();
  if (initialType === "shadow") bindShadowColorPicker();
  bindValueAliasTrigger();
  bindCompositePropAliasTriggers();
  bindFontPicker();

  // Update fields when type changes
  const typeSelect = el<HTMLSelectElement>("token-type-select");
  typeSelect.addEventListener("change", () => {
    const newType = typeSelect.value;
    closeModalAliasPicker();
    closeFontPicker();
    el("token-modal-title").textContent =
      `CREATE NEW ${getTypeDef(newType).label.toUpperCase()} TOKEN`;
    const nameInput = el<HTMLInputElement>("token-name-input");
    if (nameInput) nameInput.placeholder = `Enter ${getTypeDef(newType).label.toLowerCase()} token name`;
    el("token-value-section").innerHTML = buildValueSection(newType);
    if (newType === "color") bindColorSwatchPreview();
    if (newType === "shadow") bindShadowColorPicker();
    bindValueAliasTrigger();
    bindCompositePropAliasTriggers();
    bindFontPicker();
  });

  // Save
  el("confirm-create-token-btn").addEventListener("click", () => {
    const name = el<HTMLInputElement>("token-name-input")?.value?.trim();
    const type = typeSelect.value;
    const description = el<HTMLInputElement>("token-description-input")?.value?.trim() ?? "";
    const value = readTokenValue(type);

    if (!name) { el<HTMLInputElement>("token-name-input").classList.add("error"); return; }
    if (!value && type !== "shadow" && type !== "typography") {
      el<HTMLInputElement>("token-value-input")?.classList.add("error");
      return;
    }

    if (state.selectedSetId) {
      void runOps([{
        op: "create-token",
        setId: state.selectedSetId,
        tokenType: type,
        name,
        value,
        description,
      }]);
    }
    closeModal();
  });
}

// ════════════════════════════════════════════════════════════════════════
//  MODAL: EDIT TOKEN
// ════════════════════════════════════════════════════════════════════════

function buildEditValueSection(token: SerializedToken): string {
  if (token.type === "shadow") {
    return shadowFieldsHtml(normalizeShadowLayers(token.value));
  }
  if (token.type === "typography") {
    return typographyFieldsHtml(normalizeTypographyValueToForm(token.value));
  }
  return simpleValueFieldHtml(token.type, token.value);
}

function showEditTokenModal(token: SerializedToken): void {
  showModal(`
    <div class="modal-header">
      <h2 class="modal-title">EDIT ${getTypeDef(token.type).label.toUpperCase()} TOKEN</h2>
      ${CLOSE_BTN_SVG}
    </div>
    <div class="modal-body">
      <div class="form-field">
        <label class="form-label" for="edit-token-name">Name</label>
        <input type="text" class="input form-input" id="edit-token-name"
               value="${esc(token.name)}" autocomplete="off" />
      </div>
      ${buildEditValueSection(token)}
      <div class="form-field">
        <label class="form-label" for="edit-token-description">
          Description <span class="optional">(Optional)</span>
        </label>
        <input type="text" class="input form-input" id="edit-token-description"
               value="${esc(token.description ?? "")}" autocomplete="off" />
      </div>
    </div>
    <div class="modal-footer">
      <button type="button" data-appearance="secondary" data-modal-close>CANCEL</button>
      <button type="button" data-appearance="primary" id="confirm-edit-token-btn">SAVE</button>
    </div>`);

  if (token.type === "color") bindColorSwatchPreview();
  if (token.type === "shadow") bindShadowColorPicker();
  bindValueAliasTrigger();
  bindCompositePropAliasTriggers();
  bindFontPicker();

  el("confirm-edit-token-btn").addEventListener("click", () => {
    const name = el<HTMLInputElement>("edit-token-name")?.value?.trim();
    const description = el<HTMLInputElement>("edit-token-description")?.value?.trim() ?? "";
    const value = readTokenValue(token.type);

    if (!name || !state.selectedSetId) return;
    saveTokenEdit(state.selectedSetId, token, name, value, description);
  });
}

// ════════════════════════════════════════════════════════════════════════
//  REFERENCES & NAME CONFLICTS
//  Renaming or deleting a token silently breaks `{name}` references to it,
//  and moving tokens can collide with names in the target set. These
//  helpers find the affected tokens in the snapshot and build the ops.
// ════════════════════════════════════════════════════════════════════════

interface TokenRef {
  set: SnapshotSet;
  token: SnapshotToken;
}


/** Tokens (in any set) whose value references one of `names`. */
function findReferences(names: string[], excludeIds: Set<string> = new Set()): TokenRef[] {
  const refs: TokenRef[] = [];
  for (const set of state.snapshot.sets) {
    for (const token of set.tokens) {
      if (excludeIds.has(token.id)) continue;
      if (names.some((name) => referencesName(token.value, name))) {
        refs.push({ set, token });
      }
    }
  }
  return refs;
}

/** Sets other than `setId` that also define `name` (e.g. theme variants). */
function otherSetsDefining(name: string, setId: string): SnapshotSet[] {
  return state.snapshot.sets.filter((s) => s.id !== setId && s.tokens.some((t) => t.name === name));
}


function refsListHtml(refs: TokenRef[], max = 6): string {
  const items = refs
    .slice(0, max)
    .map((r) => `<li><span class="ref-set">${esc(r.set.name)}</span> / ${esc(r.token.name)}</li>`)
    .join("");
  const more = refs.length > max ? `<li class="ref-more">and ${refs.length - max} more…</li>` : "";
  return `<ul class="ref-list body-s">${items}${more}</ul>`;
}

function deleteWarningHtml(names: string[], excludeIds: Set<string>): string {
  const refs = findReferences(names, excludeIds);
  if (refs.length === 0) return "";
  return `
    <div class="modal-warning body-s">
      ${refs.length} token${refs.length === 1 ? " references" : "s reference"} ${names.length === 1 ? "it" : "them"}
      and will break unless another active set defines the same name:
      ${refsListHtml(refs)}
    </div>`;
}

/**
 * Save an edited token. When the name changes and other tokens reference
 * the old name, ask whether to update those references too.
 */
function saveTokenEdit(setId: string, token: SerializedToken, name: string, value: string, description: string): void {
  const update: Op = { op: "update-token", setId, tokenId: token.id, name, value, description };
  const refs = name !== token.name ? findReferences([token.name], new Set([token.id])) : [];
  const siblings = name !== token.name ? otherSetsDefining(token.name, setId) : [];

  if (refs.length === 0 && siblings.length === 0) {
    void runOps([update]);
    closeModal();
    return;
  }

  const siblingNote = siblings.length
    ? `<p class="body-s">Also defined in ${siblings.map((s) => `<strong>${esc(s.name)}</strong>`).join(", ")} — those tokens keep the old name.</p>`
    : "";
  const refsNote = refs.length
    ? `<p class="body-s">${refs.length} token${refs.length === 1 ? " references" : "s reference"} <strong>{${esc(token.name)}}</strong>:</p>${refsListHtml(refs)}`
    : "";

  showModal(`
    <div class="modal-header">
      <h2 class="modal-title">Rename ${esc(token.name)}</h2>
      ${CLOSE_BTN_SVG}
    </div>
    <div class="modal-body">
      ${refsNote}
      ${siblingNote}
      <p class="body-s modal-hint">Shapes with this token applied refer to it by name and may need it re-applied.</p>
    </div>
    <div class="modal-footer">
      <button type="button" data-appearance="secondary" id="rename-only-btn">Rename only</button>
      ${refs.length ? `<button type="button" data-appearance="primary" id="rename-update-btn">Rename and update references</button>` : ""}
    </div>`);

  el("rename-only-btn").addEventListener("click", () => {
    void runOps([update]);
    closeModal();
  });
  document.getElementById("rename-update-btn")?.addEventListener("click", () => {
    const refOps: Op[] = refs.map((r) => ({
      op: "update-token",
      setId: r.set.id,
      tokenId: r.token.id,
      name: r.token.name,
      value: replaceReference(r.token.value, token.name, name),
      description: r.token.description,
    }));
    void runOps([update, ...refOps]);
    closeModal();
  });
}

function uniqueName(base: string, taken: Set<string>): string {
  let name = `${base}-copy`;
  for (let n = 2; taken.has(name); n++) name = `${base}-copy-${n}`;
  taken.add(name);
  return name;
}

/** Move/copy tokens, asking how to resolve names that already exist in the target. */
function moveTokens(tokenIds: string[], fromSetId: string, toSetId: string, copy: boolean): void {
  const from = snapshotSet(fromSetId);
  const to = snapshotSet(toSetId);
  if (!from || !to) return;

  const targetByName = new Map(to.tokens.map((t) => [t.name, t]));
  const tokens = tokenIds
    .map((id) => from.tokens.find((t) => t.id === id))
    .filter((t): t is SnapshotToken => Boolean(t));
  const conflicts = tokens.filter((t) => targetByName.has(t.name));
  const moveOp = (t: SnapshotToken, newName?: string): Op =>
    ({ op: "move-token", fromSetId, toSetId, tokenId: t.id, copy, ...(newName ? { newName } : {}) });

  if (conflicts.length === 0) {
    void runOps(tokens.map((t) => moveOp(t)));
    closeModal();
    return;
  }

  const clean = tokens.filter((t) => !targetByName.has(t.name));
  showModal(`
    <div class="modal-header">
      <h2 class="modal-title">Name conflicts in ${esc(to.name)}</h2>
      ${CLOSE_BTN_SVG}
    </div>
    <div class="modal-body">
      <p class="body-s">
        ${conflicts.length} of ${tokens.length} token${tokens.length === 1 ? "" : "s"} already exist in
        <strong>${esc(to.name)}</strong>:
      </p>
      <ul class="ref-list body-s">${conflicts.slice(0, 6).map((t) => `<li>${esc(t.name)}</li>`).join("")}${conflicts.length > 6 ? `<li class="ref-more">and ${conflicts.length - 6} more…</li>` : ""}</ul>
    </div>
    <div class="modal-footer">
      <button type="button" data-appearance="secondary" id="conflict-skip-btn">Skip them</button>
      <button type="button" data-appearance="secondary" id="conflict-rename-btn">Keep both</button>
      <button type="button" data-appearance="primary" data-variant="destructive" id="conflict-replace-btn">Replace</button>
    </div>`);

  el("conflict-skip-btn").addEventListener("click", () => {
    void runOps(clean.map((t) => moveOp(t)));
    closeModal();
  });
  el("conflict-rename-btn").addEventListener("click", () => {
    const taken = new Set(targetByName.keys());
    void runOps([...clean.map((t) => moveOp(t)), ...conflicts.map((t) => moveOp(t, uniqueName(t.name, taken)))]);
    closeModal();
  });
  el("conflict-replace-btn").addEventListener("click", () => {
    const ops: Op[] = [];
    for (const t of conflicts) {
      ops.push({ op: "delete-token", setId: toSetId, tokenId: targetByName.get(t.name)!.id });
      ops.push(moveOp(t));
    }
    void runOps([...clean.map((t) => moveOp(t)), ...ops]);
    closeModal();
  });
}

// ════════════════════════════════════════════════════════════════════════
//  BULK SELECTION
// ════════════════════════════════════════════════════════════════════════

function syncSelectAllCheckbox(): void {
  const allCbs = document.querySelectorAll<HTMLInputElement>(".token-check");
  const selectAll = el<HTMLInputElement>("select-all-tokens");
  if (!selectAll) return;
  const total = allCbs.length;
  const checked = [...allCbs].filter((cb) => cb.checked).length;
  selectAll.checked = total > 0 && checked === total;
  selectAll.indeterminate = checked > 0 && checked < total;
}

function renderBulkBar(): void {
  const bar = el("bulk-bar");
  if (!bar) return;
  const count = selectedTokenIds.size;
  if (count === 0) {
    bar.classList.add("hidden");
    return;
  }
  bar.classList.remove("hidden");
  el("bulk-bar-label").textContent = `${count} selected`;
}

function bindBulkBar(): void {
  const actionsEl = el("bulk-bar-actions");
  if (!actionsEl) return;
  actionsEl.innerHTML = `
    <button class="icon-btn" id="bulk-move-btn" title="Move selected">${ICON_MOVE}</button>
    <button class="icon-btn" id="bulk-duplicate-btn" title="Duplicate selected">${ICON_DUPLICATE}</button>
    <button class="icon-btn bulk-danger-btn" id="bulk-delete-btn" title="Delete selected">${ICON_DELETE}</button>`;

  el("bulk-move-btn").addEventListener("click", () =>
    handleBulkMove(new Set(selectedTokenIds))
  );
  el("bulk-duplicate-btn").addEventListener("click", () =>
    handleBulkDuplicate(new Set(selectedTokenIds))
  );
  el("bulk-delete-btn").addEventListener("click", () =>
    handleBulkDelete(new Set(selectedTokenIds))
  );
}

// ── Bulk action handlers ──────────────────────────────────────────────────

function handleBulkMove(ids: Set<string>): void {
  if (!state.selectedSetId) return;
  const fromSetId = state.selectedSetId;
  const otherSets = state.sets.filter((s) => s.id !== fromSetId);

  showModal(`
    <div class="modal-header">
      <h2 class="modal-title">Move ${ids.size} token${ids.size === 1 ? "" : "s"}</h2>
      ${CLOSE_BTN_SVG}
    </div>
    <div class="modal-body">
      <div class="form-field">
        <div class="move-select-wrapper">
          <span class="body-s">To:</span>
          <select class="select" id="bulk-move-target">
            <option value="">Choose a set</option>
            ${otherSets.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="checkbox-container">
        <input type="checkbox" class="checkbox-input" id="bulk-move-copy" />
        <label for="bulk-move-copy" class="body-s">Copy (keep originals)</label>
      </div>
    </div>
    <div class="modal-footer">
      <button type="button" data-appearance="secondary" data-modal-close>Cancel</button>
      <button type="button" data-appearance="primary" id="confirm-bulk-move-btn">Move</button>
    </div>`);

  el("confirm-bulk-move-btn").addEventListener("click", () => {
    const toSetId = el<HTMLSelectElement>("bulk-move-target").value;
    const copy = el<HTMLInputElement>("bulk-move-copy").checked;
    if (!toSetId) return;
    selectedTokenIds.clear();
    moveTokens([...ids], fromSetId, toSetId, copy);
  });
}

function handleBulkDuplicate(ids: Set<string>): void {
  if (!state.selectedSetId) return;
  const setId = state.selectedSetId;
  // Each message carries only the tokenId; the plugin fetches live data from
  // the Penpot API so composite values (shadow, typography) are never stale.
  void runOps([...ids].map((tokenId) => ({ op: "duplicate-token" as const, setId, tokenId })));
  selectedTokenIds.clear();
  renderBulkBar();
}

function handleBulkDelete(ids: Set<string>): void {
  if (!state.selectedSetId) return;
  const setId = state.selectedSetId;
  const count = ids.size;

  showModal(`
    <div class="modal-header">
      <h2 class="modal-title">Delete ${count} token${count === 1 ? "" : "s"}</h2>
      ${CLOSE_BTN_SVG}
    </div>
    <div class="modal-body">
      <p class="body-s">
        Are you sure you want to delete <strong>${count} token${count === 1 ? "" : "s"}</strong>?
        This action cannot be undone.
      </p>
      ${deleteWarningHtml(
        state.tokens.filter((t) => ids.has(t.id)).map((t) => t.name),
        ids,
      )}
    </div>
    <div class="modal-footer">
      <button type="button" data-appearance="secondary" data-modal-close>Cancel</button>
      <button type="button" data-appearance="primary" data-variant="destructive"
              id="confirm-bulk-delete-btn">Delete</button>
    </div>`);

  el("confirm-bulk-delete-btn").addEventListener("click", () => {
    void runOps([...ids].map((tokenId) => ({ op: "delete-token" as const, setId, tokenId })));
    selectedTokenIds.clear();
    closeModal();
  });
}

// ════════════════════════════════════════════════════════════════════════
//  MODAL: THEMES
//  Left: themes grouped by group + creation form. Right: the selected
//  theme's group/name and the sets it activates. Re-rendered on every
//  snapshot while open, so changes made elsewhere show up immediately.
// ════════════════════════════════════════════════════════════════════════

// `pendingName`: a just-created theme to select once it reaches the snapshot.
let themesModal: { selectedThemeId: string | null; pendingName?: string } | null = null;

function showThemesModal(selectedThemeId: string | null = null): void {
  themesModal = { selectedThemeId: selectedThemeId ?? state.themes[0]?.id ?? null };
  showModal(`<div id="themes-modal-root"></div>`);
  el("modal-container").classList.add("modal--wide");
  renderThemesModal();
}

function renderThemesModal(): void {
  const root = document.getElementById("themes-modal-root");
  if (!themesModal || !root) return;

  if (themesModal.pendingName) {
    const created = state.themes.find((t) => t.name === themesModal!.pendingName);
    if (created) {
      themesModal.selectedThemeId = created.id;
      themesModal.pendingName = undefined;
    }
  }
  if (themesModal.selectedThemeId && !state.themes.some((t) => t.id === themesModal!.selectedThemeId)) {
    themesModal.selectedThemeId = state.themes[0]?.id ?? null;
  }
  const selected = state.themes.find((t) => t.id === themesModal!.selectedThemeId) ?? null;

  // Keep in-progress input across re-renders.
  const keep = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? "";
  const draftGroup = keep("new-theme-group");
  const draftName = keep("new-theme-name");
  const focusedId = document.activeElement?.id ?? "";

  const list = themesByGroup()
    .map(([group, themes]) => `
      <div class="themes-modal-group">
        <div class="themes-modal-group-label body-s">${esc(group || "No group")}</div>
        ${themes.map((t) => `
          <button type="button" class="themes-modal-item${t.id === selected?.id ? " is-selected" : ""}" data-select-theme="${esc(t.id)}">
            <span class="theme-dot${t.active ? " theme-dot--active" : ""}" aria-hidden="true"></span>
            <span class="set-name">${esc(t.name)}</span>
            <span class="themes-modal-count">${t.setIds.length}</span>
          </button>`).join("")}
      </div>`)
    .join("");

  const detail = selected
    ? `
      <div class="themes-modal-fields">
        <div class="form-field">
          <label class="form-label" for="theme-group-input">Group</label>
          <input type="text" class="input form-input" id="theme-group-input" value="${esc(selected.group)}" placeholder="e.g. mode" />
        </div>
        <div class="form-field">
          <label class="form-label" for="theme-name-input">Name</label>
          <input type="text" class="input form-input" id="theme-name-input" value="${esc(selected.name)}" />
        </div>
      </div>
      <div class="themes-modal-actions">
        <label class="checkbox-container body-s">
          <input type="checkbox" class="checkbox-input" id="theme-active-input" ${selected.active ? "checked" : ""} />
          Active
        </label>
        <span class="themes-modal-spacer"></span>
        <button type="button" class="icon-btn" id="theme-duplicate-btn" title="Duplicate theme">${ICON_DUPLICATE}</button>
        <button type="button" class="icon-btn" id="theme-delete-btn" title="Delete theme">${ICON_DELETE}</button>
      </div>
      <div class="form-label">Sets in this theme</div>
      <div class="themes-modal-sets">
        ${state.sets.length === 0 ? `<p class="body-s empty-state-msg">No sets yet.</p>` : state.sets.map((set) => `
          <label class="checkbox-container body-s themes-modal-set">
            <input type="checkbox" class="checkbox-input theme-set-cb" value="${esc(set.id)}"
                   ${selected.setIds.includes(set.id) ? "checked" : ""} />
            <span>${esc(set.name)}</span>
          </label>`).join("")}
      </div>`
    : `<p class="body-s empty-state-msg">Create a theme to choose which sets it activates.</p>`;

  root.innerHTML = `
    <div class="modal-header">
      <h2 class="modal-title">Themes</h2>
      ${CLOSE_BTN_SVG}
    </div>
    <div class="modal-body themes-modal">
      <div class="themes-modal-list">
        ${list || `<p class="body-s empty-state-msg">No themes yet.</p>`}
        <div class="themes-modal-new">
          <input type="text" class="input form-input" id="new-theme-group" placeholder="Group (optional)" value="${esc(draftGroup)}" />
          <input type="text" class="input form-input" id="new-theme-name" placeholder="New theme name" value="${esc(draftName)}" />
          <button type="button" data-appearance="secondary" id="create-theme-btn">+ Add theme</button>
        </div>
      </div>
      <div class="themes-modal-detail">${detail}</div>
    </div>`;

  root.querySelectorAll<HTMLElement>("[data-modal-close]").forEach((b) => b.addEventListener("click", closeModal));
  if (focusedId) document.getElementById(focusedId)?.focus();

  root.querySelectorAll<HTMLElement>("[data-select-theme]").forEach((btn) => {
    btn.addEventListener("click", () => {
      themesModal!.selectedThemeId = btn.dataset.selectTheme!;
      renderThemesModal();
    });
  });

  const create = () => {
    const name = keep("new-theme-name").trim();
    if (!name) { el("new-theme-name").classList.add("error"); return; }
    themesModal!.pendingName = name;
    el<HTMLInputElement>("new-theme-name").value = "";
    void runOps([{ op: "create-theme", group: keep("new-theme-group").trim(), name }]).then((r) => {
      if (!r[0]?.ok && themesModal) themesModal.pendingName = undefined;
    });
  };
  el("create-theme-btn").addEventListener("click", create);
  el("new-theme-name").addEventListener("keydown", (e) => { if (e.key === "Enter") create(); });

  if (!selected) return;

  const saveNames = () => {
    const group = keep("theme-group-input").trim();
    const name = keep("theme-name-input").trim();
    if (!name) { el("theme-name-input").classList.add("error"); return; }
    if (group !== selected.group || name !== selected.name) {
      void runOps([{ op: "update-theme", themeId: selected.id, group, name }]);
    }
  };
  for (const id of ["theme-group-input", "theme-name-input"]) {
    el(id).addEventListener("change", saveNames);
    el(id).addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") saveNames(); });
  }

  el<HTMLInputElement>("theme-active-input").addEventListener("change", (e) => {
    void runOps([{ op: "set-theme-active", themeId: selected.id, active: (e.target as HTMLInputElement).checked }]);
  });
  el("theme-duplicate-btn").addEventListener("click", () => {
    void runOps([{ op: "duplicate-theme", themeId: selected.id }]);
  });
  el("theme-delete-btn").addEventListener("click", () => {
    void runOps([{ op: "delete-theme", themeId: selected.id }]);
  });

  root.querySelectorAll<HTMLInputElement>(".theme-set-cb").forEach((cb) => {
    cb.addEventListener("change", () => {
      const setIds = [...root.querySelectorAll<HTMLInputElement>(".theme-set-cb:checked")].map((c) => c.value);
      void runOps([{ op: "set-theme-sets", themeId: selected.id, setIds }]);
    });
  });
}

// ════════════════════════════════════════════════════════════════════════
//  MODAL: MATH IN TOKEN VALUES
// ════════════════════════════════════════════════════════════════════════

function showMathInfoModal(): void {
  showModal(`
    <div class="modal-header">
      <h2 class="modal-title">Math in Token Values</h2>
      ${CLOSE_BTN_SVG}
    </div>
    <div class="modal-body">
      <div class="math-modal-grid">

        <!-- ── LEFT COLUMN ── -->
        <div>
          <h3 class="math-section-heading">Basic Operators</h3>

          <div class="math-op-block">
            <p class="math-op-name">Add <code>(+)</code></p>
            <p class="math-op-desc">Add two values or tokens.</p>
            <code class="math-example">spacing.sm + 4</code>
            <p class="math-example-note">→ Adds 4 to the spacing value.</p>
          </div>

          <div class="math-op-block">
            <p class="math-op-name">Subtract <code>(-)</code></p>
            <p class="math-op-desc">Subtract one value or token from another.</p>
            <code class="math-example">spacing.lg - spacing.sm</code>
            <p class="math-example-note">→ Calculates the difference.</p>
          </div>

          <div class="math-op-block">
            <p class="math-op-name">Multiply <code>(*)</code></p>
            <p class="math-op-desc">Multiply values or tokens.</p>
            <code class="math-example">spacing.md * 2</code>
            <p class="math-example-note">→ Doubles the value.</p>
          </div>

          <div class="math-op-block">
            <p class="math-op-name">Divide <code>(/)</code></p>
            <p class="math-op-desc">Divide values or tokens.</p>
            <code class="math-example">value / rem-base</code>
            <p class="math-example-note">→ Scales a unitless number for rem conversion.</p>
          </div>

          <h3 class="math-section-heading" style="margin-top:16px;">Parentheses for Grouping</h3>
          <p class="math-body-text">You can use parentheses to control order of operations.</p>
          <code class="math-example">(8 * 8)</code>
          <p class="math-example-note">→ 64.</p>

          <hr class="math-divider"/>

          <h3 class="math-section-heading">🔁 Functions</h3>
          <div class="math-op-block">
            <p class="math-op-name"><code>roundTo(value, decimals)</code></p>
            <p class="math-op-desc">Rounds a computed result to a specific precision.</p>
            <p class="math-body-text">What it does: Removes decimals or limits decimals to the given number.</p>
            <code class="math-example">roundTo({sizing.sm} * 1.33, 0)</code>
            <p class="math-example-note">→ rounds to a whole number.</p>
          </div>
        </div>

        <!-- ── RIGHT COLUMN ── -->
        <div>
          <h3 class="math-section-heading">Notes &amp; Constraints</h3>

          <div class="math-note-block">
            <p class="math-note-title">Incompatible Cases</p>
            <p class="math-note-text">You cannot use math with tokens that contain multiple values (like composite spacing tokens with two numbers).</p>
          </div>

          <div class="math-note-block">
            <p class="math-note-text">You cannot mix units in the same equation (e.g., rem + px). The parser only works if units are the same or if values are unitless.</p>
          </div>

          <h3 class="math-section-heading" style="margin-top:16px;">Syntax Rules</h3>
          <p class="math-body-text">Always include spaces around math operators
            (e.g.,&nbsp;<code class="math-example math-example--inline">8 * 8</code>,
            not&nbsp;<code class="math-example math-example--inline">8*8</code>).
            This is required for correct transformation.</p>

          <hr class="math-divider"/>

          <h3 class="math-section-heading">Common Use Cases</h3>
          <p class="math-body-text">Here are typical patterns you'll see in real token systems:</p>

          <div class="math-use-case-block">
            <p class="math-use-case-label">Scaling values:</p>
            <code class="math-example">base-size * 1.2</code>
            <p class="math-use-case-note">→ scale up a token value.</p>
          </div>

          <div class="math-use-case-block">
            <p class="math-use-case-label">Calculating ratios or multipliers:</p>
            <p class="math-use-case-note">Use math to generate percentages or dynamic spacings based on other tokens.</p>
          </div>

          <div class="math-use-case-block">
            <p class="math-use-case-label">Unit conversions:</p>
            <p class="math-use-case-note">Convert numeric scales into rem units by dividing by a base token value.</p>
          </div>
        </div>

      </div>
    </div>`);
  el("modal-container").classList.add("modal--wide");
}

// ════════════════════════════════════════════════════════════════════════
//  COMPARE MODE
//
//  enterCompareMode(setId)  – activates comparison UI for the given primary set.
//  exitCompareModeQuiet()   – tears down compare state/UI without re-rendering
//                             the token table (used internally before another
//                             render is about to happen anyway).
//  exitCompareMode()        – same + calls renderTokenTable() to restore normal view.
//  addComparedSet(setId)    – appends a compared column (built from the snapshot).
//  removeComparedSet(setId) – removes a compared column.
//  renderCompareTable()     – full render of compare header + body.
//  valueCellHtmlReadOnly()  – non-interactive variant of valueCellHtml (no alias editor).
//  showAddSetDropdown()     – shows a context-menu picker of addable sets.
// ════════════════════════════════════════════════════════════════════════

/** Non-interactive value cell — used in comparison columns so no alias editor opens. */
function valueCellHtmlReadOnly(token: SerializedToken): string {
  if (token.type === "typography") {
    // Pass no tokenId → compositeSubValueHtml renders non-interactive chips
    return compositeTypographyPreviewHtml(normalizeTypographyValueToForm(token.value));
  }
  if (token.type === "shadow") {
    return compositeShadowPreviewHtml(
      normalizeShadowValueToPreview(token.value), undefined, normalizeShadowLayers(token.value).length,
    );
  }
  if (isAlias(token.value)) {
    const aliasName = token.value.trim().slice(1, -1);
    const resolvedBg = token.type === "color" ? (token.resolvedValue ?? "") : "";
    const swatchHtml = resolvedBg
      ? `<span class="color-swatch" style="background:${esc(resolvedBg)}" aria-hidden="true"></span>`
      : "";
    return `<span class="alias-chip" title="${esc(token.value)}">${swatchHtml}<span class="alias-chip-name">${esc(aliasName)}</span></span>`;
  }
  if (!/\{[^{}]+\}/.test(token.value)) {
    return `${colorSwatchHtml(token)}<span class="token-value-text" title="${esc(token.value)}">${esc(token.value)}</span>`;
  }
  // Mixed value — render alias refs as mini (non-interactive) chips
  const parts = parseMixedValue(token.value).map((seg) => {
    if (seg.kind === "alias") {
      return `<span class="alias-chip" title="{${esc(seg.name)}}"><span class="alias-chip-name">${esc(seg.name)}</span></span>`;
    }
    return `<span class="mixed-value-text">${esc(seg.content)}</span>`;
  });
  return `<div class="mixed-value-cell">${parts.join("")}</div>`;
}

/** Render (or re-render) the full comparison table header and body. */
function renderCompareTable(): void {
  if (!compareState.active) return;
  const headerEl = el("compare-table-header");
  const bodyEl   = el("compare-table-body");
  const wrapEl   = el("compare-table-wrap");
  if (!headerEl || !bodyEl || !wrapEl) return;

  const N = compareState.comparedSetIds.length;
  // Grid: [170px name] [minmax(120px,1fr) primary] [same × N compared] [110px add-set]
  const colTemplate = `170px repeat(${1 + N}, minmax(120px, 1fr)) 110px`;
  wrapEl.style.setProperty("--cmp-col-template", colTemplate);

  // ── Header ──────────────────────────────────────────────────────────────
  const otherSets   = state.sets.filter(
    (s) => s.id !== compareState.primarySetId && !compareState.comparedSetIds.includes(s.id)
  );
  const addDisabled = otherSets.length === 0;
  const addTitle    = addDisabled ? "No other sets available" : "Add a set to compare";

  const comparedHeaders = compareState.comparedSetIds
    .map((setId) => {
      const setName = state.sets.find((s) => s.id === setId)?.name ?? setId;
      return `<div class="cmp-th cmp-th-compared" data-compare-set-id="${esc(setId)}">
        <span class="th-label">${esc(`Value (${setName})`)}</span>
        <button class="cmp-col-remove-btn icon-btn" data-remove-set-id="${esc(setId)}"
                title="Remove ${esc(setName)}" aria-label="Remove ${esc(setName)}">
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 4 12 12M12 4 4 12" stroke="currentColor" stroke-width="2"
                  stroke-linecap="round"/>
          </svg>
        </button>
      </div>`;
    })
    .join("");

  headerEl.innerHTML = `
    <div class="cmp-th cmp-th-name body-s">Name</div>
    <div class="cmp-th cmp-th-primary body-s">
      <span class="th-label">Value</span>
    </div>
    ${comparedHeaders}
    <div class="cmp-th cmp-th-add">
      <button class="cmp-add-set-btn" id="cmp-add-set-btn" type="button"
              ${addDisabled ? "disabled" : ""} title="${esc(addTitle)}">+ Add set</button>
    </div>`;

  // Wire remove buttons
  headerEl.querySelectorAll<HTMLElement>("[data-remove-set-id]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeComparedSet(btn.dataset.removeSetId!);
    });
  });

  // Wire add-set button
  const addBtn = el("cmp-add-set-btn");
  if (addBtn && !addDisabled) {
    addBtn.addEventListener("click", (e) => showAddSetDropdown(e as MouseEvent));
  }

  // ── Body ──────────────────────────────────────────────────────────────
  // Rows are the union of names across all compared sets: the primary set's
  // tokens first (in table order), then names that only exist elsewhere.
  const primaryTokens = getSortedTokens(state.tokens);
  const primaryByName = new Map(primaryTokens.map((t) => [t.name, t]));
  const extraNames = new Set<string>();
  for (const map of compareState.comparedTokenMaps.values()) {
    for (const name of map.keys()) if (!primaryByName.has(name)) extraNames.add(name);
  }
  const names = [...primaryTokens.map((t) => t.name), ...[...extraNames].sort()];

  if (names.length === 0) {
    bodyEl.innerHTML = `<div class="empty-state-msg body-s">No tokens yet.</div>`;
    return;
  }

  const compareKey = (t: SerializedToken) => t.resolvedValue ?? t.value;

  const cellHtml = (token: SerializedToken | undefined, diff: boolean): string => {
    if (!token) return `<div class="cmp-td cmp-td-missing">Not in this set</div>`;
    const showResolved =
      token.resolveStatus !== "ok" ||
      (token.resolvedValue !== undefined && token.resolvedValue !== token.value);
    const resolved = showResolved
      ? `<div class="cmp-resolved">${resolvedValueCellHtml(token)}</div>`
      : "";
    return `<div class="cmp-td${diff ? " cmp-td--diff" : ""}">` +
      `<div class="col-value-inner">${valueCellHtmlReadOnly(token)}</div>${resolved}</div>`;
  };

  const rows = names
    .map((name) => {
      const primary = primaryByName.get(name);
      const compared = compareState.comparedSetIds.map(
        (setId) => compareState.comparedTokenMaps.get(setId)?.get(name),
      );
      const baseKey = primary ? compareKey(primary) : undefined;
      const cellDiff = compared.map((t) => !t || !primary || compareKey(t) !== baseKey);
      const rowDiff = !primary || cellDiff.some(Boolean);

      return `<div class="cmp-row${rowDiff ? " cmp-row--diff" : ""}" role="row">
        <div class="cmp-td cmp-td-name">
          <span class="col-name-text" title="${esc(name)}">${esc(name)}</span>
        </div>
        ${cellHtml(primary, false)}
        ${compared.map((t, idx) => cellHtml(t, cellDiff[idx])).join("")}
        <div class="cmp-td"></div>
      </div>`;
    })
    .join("");

  bodyEl.innerHTML = rows;
}

/**
 * Show a dropdown (reusing the existing context-menu) listing sets that can
 * be added to the comparison.  Positioned below the "Add set" button.
 */
function showAddSetDropdown(e: MouseEvent): void {
  const btn  = e.currentTarget as HTMLElement;
  const rect = btn.getBoundingClientRect();
  const otherSets = state.sets.filter(
    (s) => s.id !== compareState.primarySetId && !compareState.comparedSetIds.includes(s.id)
  );
  if (otherSets.length === 0) return;
  showContextMenu(
    rect.left,
    rect.bottom + 4,
    otherSets.map((set) => ({
      label: set.name,
      icon: ICON_SET_SVG,
      action: () => addComparedSet(set.id),
    }))
  );
}

/** Apply all compare-mode UI changes without triggering a table re-render. */
function exitCompareModeQuiet(): void {
  compareState.active        = false;
  compareState.primarySetId  = null;
  compareState.comparedSetIds = [];
  compareState.comparedTokenMaps.clear();

  el("tokens-table-wrap").classList.remove("hidden");
  el("compare-table-wrap").classList.add("hidden");
  el("compare-exit-btn").classList.add("hidden");
  el("new-token-btn").classList.remove("hidden");
  el("set-more-btn").classList.remove("hidden");
}

/** Exit compare mode and restore the normal token table. */
function exitCompareMode(): void {
  exitCompareModeQuiet();
  renderTokenTable();
}

/**
 * Enter comparison mode for `primarySetId`.
 *
 * If the given set is not currently selected, selectSet() is called first
 * so that tokens are loaded.  compareState.active is set to true only after
 * selectSet() returns so that selectSet's own exitCompareModeQuiet() call
 * (triggered when navigating away) does not interfere.
 *
 * Edge case — user invokes "Compare sets" on a different set while already in
 * compare mode: the old compare state is cleared and compare mode restarts
 * with the new primary set.
 */
function enterCompareMode(primarySetId: string): void {
  // Reset silently so selectSet() below doesn't trigger another exitCompareModeQuiet()
  compareState.active        = false;
  compareState.primarySetId  = null;
  compareState.comparedSetIds = [];
  compareState.comparedTokenMaps.clear();

  // Navigate to the set (loads tokens, shows token view)
  if (state.selectedSetId !== primarySetId) {
    selectSet(primarySetId);
  }

  // Activate compare mode
  compareState.active       = true;
  compareState.primarySetId = primarySetId;

  // Switch table views
  el("tokens-table-wrap").classList.add("hidden");
  el("compare-table-wrap").classList.remove("hidden");
  el("compare-exit-btn").classList.remove("hidden");
  el("new-token-btn").classList.add("hidden");
  el("set-more-btn").classList.add("hidden");

  renderCompareTable();
}

/** Append a new compared-set column and request its tokens from the plugin. */
function addComparedSet(setId: string): void {
  if (compareState.comparedSetIds.includes(setId)) return;
  compareState.comparedSetIds.push(setId);
  compareState.comparedTokenMaps.set(setId, comparedTokenMap(setId));
  renderCompareTable();
}

/** Remove a compared-set column. */
function removeComparedSet(setId: string): void {
  compareState.comparedSetIds = compareState.comparedSetIds.filter((id) => id !== setId);
  compareState.comparedTokenMaps.delete(setId);
  renderCompareTable();
}

// ════════════════════════════════════════════════════════════════════════
//  GLOBAL EVENT LISTENERS
// ════════════════════════════════════════════════════════════════════════

function bindGlobalListeners(): void {
  // Sidebar search toggle
  el("sidebar-search-btn")?.addEventListener("click", () => {
    const box = el("sidebar-search-box");
    box.classList.toggle("hidden");
    if (!box.classList.contains("hidden")) {
      el<HTMLInputElement>("sidebar-search-input")?.focus();
    }
  });

  el("sidebar-search-input")?.addEventListener("input", () => renderSidebar());

  // New set
  el("sidebar-new-set-btn")?.addEventListener("click", showNewSetModal);
  el("main-new-set-btn")?.addEventListener("click", showNewSetModal);

  // Math info
  el("math-info-btn")?.addEventListener("click", showMathInfoModal);

  // Themes
  el("themes-settings-btn")?.addEventListener("click", () => showThemesModal());

  // Exit comparison mode
  el("compare-exit-btn")?.addEventListener("click", exitCompareMode);

  // Toggle sidebar
  el("toggle-sidebar-overview")?.addEventListener("click", toggleSidebar);
  el("toggle-sidebar-tokens")?.addEventListener("click", toggleSidebar);

  // Overview search
  el("overview-search-input")?.addEventListener("input", renderOverview);

  // New token
  el("new-token-btn")?.addEventListener("click", () => showNewTokenModal());

  // Token search
  el("tokens-search-input")?.addEventListener("input", renderTokenTable);

  // Resolution context
  el<HTMLSelectElement>("resolve-context-select")?.addEventListener("change", (e) => {
    setResolveMode((e.target as HTMLSelectElement).value as ResolveMode);
  });

  // Set "more" button (show context menu)
  el("set-more-btn")?.addEventListener("click", (e) => {
    const set = state.sets.find((s) => s.id === state.selectedSetId);
    if (set) showSetContextMenu(e as MouseEvent, set.id);
  });

  // Select all tokens checkbox
  el("select-all-tokens")?.addEventListener("change", (e) => {
    const checked = (e.target as HTMLInputElement).checked;
    document.querySelectorAll<HTMLInputElement>(".token-check").forEach((cb) => {
      cb.checked = checked;
      const tokenId = cb.dataset.tokenId!;
      if (checked) {
        selectedTokenIds.add(tokenId);
      } else {
        selectedTokenIds.delete(tokenId);
      }
    });
    renderBulkBar();
  });

  // Bulk action bar — initialise icons and bind buttons once
  bindBulkBar();

  // Sort header clicks
  document.querySelectorAll<HTMLElement>(".th-sortable[data-sort-key]").forEach((th) => {
    th.addEventListener("click", onSortHeaderClick);
  });

  // Global Escape key: close context menu / modal
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeContextMenu();
      closeModal();
    }
  });
}
