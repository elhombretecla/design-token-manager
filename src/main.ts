import "./style.css";

// ════════════════════════════════════════════════════════════════════════
//  TYPES
// ════════════════════════════════════════════════════════════════════════

interface SerializedSet {
  id: string;
  name: string;
  active: boolean;
  tokenCount: number;
}

interface SerializedToken {
  id: string;
  name: string;
  type: string;
  value: string;
  description: string;
  resolvedValue?: string;
}

interface SerializedTheme {
  id: string;
  group: string;
  name: string;
  active: boolean;
}

interface AliasPickerSet {
  setId: string;
  setName: string;
  tokens: SerializedToken[];
}

type PluginMessage =
  | { source: "penpot"; type: "themechange"; theme: string }
  | { type: "loaded"; sets: SerializedSet[]; themes: SerializedTheme[] }
  | { type: "tokens-loaded"; setId: string; tokens: SerializedToken[] }
  | { type: "sets-updated"; sets: SerializedSet[]; themes: SerializedTheme[] }
  | { type: "tokens-updated"; setId: string; tokens: SerializedToken[] }
  | { type: "all-tokens-by-type-loaded"; tokenType: string; sets: AliasPickerSet[] }
  | { type: "error"; message: string };

type SortKey = "name" | "value" | "resolvedValue" | "type";

// ════════════════════════════════════════════════════════════════════════
//  STATE
// ════════════════════════════════════════════════════════════════════════

const state = {
  sets: [] as SerializedSet[],
  themes: [] as SerializedTheme[],
  tokens: [] as SerializedToken[],
  selectedSetId: null as string | null,
  sidebarCollapsed: false,
  sortKey: "type" as SortKey | null,
  sortDir: "asc" as "asc" | "desc",
};

// ── Bulk-selection state ──────────────────────────────────────────────────
const selectedTokenIds = new Set<string>();

// ── Alias editor ephemeral state ─────────────────────────────────────────

interface AliasEditorState {
  token: SerializedToken;
  inputValue: string;
  searchValue: string;
  mode: "edit" | "list";
  pickerSets: AliasPickerSet[];
  chipEl: HTMLElement;
  collapsedGroups: Set<string>; // setIds currently collapsed
}

let aliasEditor: AliasEditorState | null = null;

interface ModalAliasPickerState {
  tokenType: string;
  searchValue: string;
  pickerSets: AliasPickerSet[];
  collapsedGroups: Set<string>;
  anchorEl: HTMLElement;
}

let modalAliasPicker: ModalAliasPickerState | null = null;

// ════════════════════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════════════════════

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function sendToPlugin(message: object): void {
  parent.postMessage(message, "*");
}

function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

let colWidths = [...COL_DEFAULT];

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
//  MESSAGE HANDLER (plugin.ts → main.ts)
// ════════════════════════════════════════════════════════════════════════

window.addEventListener("message", (event: MessageEvent) => {
  const msg = event.data as PluginMessage;

  // Penpot theme change
  if ((msg as any).source === "penpot" && (msg as any).type === "themechange") {
    document.body.dataset.theme = (msg as any).theme;
    return;
  }

  switch (msg.type) {
    case "loaded":
      state.sets = msg.sets;
      state.themes = msg.themes;
      renderSidebar();
      renderOverview();
      break;

    case "tokens-loaded":
      if (msg.setId === state.selectedSetId) {
        state.tokens = msg.tokens;
        renderTokenTable();
      }
      break;

    case "sets-updated":
      state.sets = msg.sets;
      state.themes = msg.themes;
      renderSidebar();
      renderOverview();
      // If active set was deleted, go back to overview
      if (state.selectedSetId && !state.sets.find((s) => s.id === state.selectedSetId)) {
        selectSet(null);
      } else if (state.selectedSetId) {
        // Refresh breadcrumb name in case it was renamed
        const set = state.sets.find((s) => s.id === state.selectedSetId);
        if (set) el("breadcrumb-set-name").textContent = set.name;
      }
      break;

    case "tokens-updated":
      if (msg.setId === state.selectedSetId) {
        state.tokens = msg.tokens;
        // Prune selections for tokens that no longer exist
        const validIds = new Set(msg.tokens.map((t) => t.id));
        for (const id of [...selectedTokenIds]) {
          if (!validIds.has(id)) selectedTokenIds.delete(id);
        }
        renderTokenTable();
        // Also refresh sidebar count
        renderSidebar();
      }
      break;

    case "all-tokens-by-type-loaded":
      if (aliasEditor && msg.tokenType === aliasEditor.token.type) {
        aliasEditor.pickerSets = msg.sets;
        renderAliasEditor();
      }
      if (modalAliasPicker && msg.tokenType === modalAliasPicker.tokenType) {
        modalAliasPicker.pickerSets = msg.sets;
        renderModalAliasPicker();
      }
      break;

    case "error":
      console.error("[Token Manager]", msg.message);
      break;
  }
});

// ════════════════════════════════════════════════════════════════════════
//  VIEW SWITCHING
// ════════════════════════════════════════════════════════════════════════

function selectSet(setId: string | null): void {
  state.selectedSetId = setId;
  selectedTokenIds.clear();

  if (setId) {
    el("view-sets-overview").classList.add("hidden");
    el("view-tokens").classList.remove("hidden");
    const set = state.sets.find((s) => s.id === setId);
    if (set) el("breadcrumb-set-name").textContent = set.name;
    // Clear previous tokens while loading and reset sort to type
    state.tokens = [];
    state.sortKey = "type";
    state.sortDir = "asc";
    renderTokenTable();
    sendToPlugin({ type: "get-tokens", setId });
  } else {
    el("view-sets-overview").classList.remove("hidden");
    el("view-tokens").classList.add("hidden");
  }

  // Update sidebar highlight
  document.querySelectorAll<HTMLElement>(".set-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.setId === setId);
  });
}

function toggleSidebar(): void {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  el("sidebar").classList.toggle("collapsed", state.sidebarCollapsed);
}

// ════════════════════════════════════════════════════════════════════════
//  SIDEBAR RENDERING
// ════════════════════════════════════════════════════════════════════════

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
    return;
  }

  listEl.innerHTML = filtered
    .map(
      (set) => `
    <li class="set-item${set.id === state.selectedSetId ? " active" : ""}"
        data-set-id="${esc(set.id)}"
        title="${esc(set.name)}"
        role="option"
        aria-selected="${set.id === state.selectedSetId}">
      <span class="set-icon">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
          <path d="M2.5 6.5h11" stroke="currentColor" stroke-width="1.3"/>
        </svg>
      </span>
      <span class="set-name">${esc(set.name)}</span>
    </li>`
    )
    .join("");

  listEl.querySelectorAll<HTMLElement>(".set-item").forEach((item) => {
    item.addEventListener("click", () => selectSet(item.dataset.setId!));
    item.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showSetContextMenu(e as MouseEvent, item.dataset.setId!);
    });
  });

  // Themes
  const themesDesc = el("themes-description");
  const themesList = el("themes-list");
  if (state.themes.length === 0) {
    themesDesc.classList.remove("hidden");
    themesList.classList.add("hidden");
  } else {
    themesDesc.classList.add("hidden");
    themesList.classList.remove("hidden");
    themesList.innerHTML = state.themes
      .map(
        (t) =>
          `<li class="set-item body-s" title="${esc(t.group ? t.group + "/" + t.name : t.name)}">
        <span class="set-name">${esc(t.group ? t.group + "/" + t.name : t.name)}</span>
       </li>`
      )
      .join("");
  }
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
      <span class="set-card-icon">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
          <path d="M2.5 6.5h11" stroke="currentColor" stroke-width="1.3"/>
        </svg>
      </span>
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

const ALIAS_RE = /^\{[^{}]+\}$/;

function isAlias(value: string): boolean {
  return ALIAS_RE.test(value.trim());
}

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
  return `<div class="alias-chip" data-token-id="${esc(token.id)}" title="${esc(token.value)}" role="button" tabindex="0" aria-label="Alias: ${esc(aliasName)}">${swatchHtml}<span class="alias-chip-name">${esc(aliasName)}</span>${ALIAS_GEAR_ICON}</div>`;
}

// ── Mixed-value parser ────────────────────────────────────────────────────

type MixedSegment = { kind: "alias"; name: string } | { kind: "text"; content: string };

function parseMixedValue(value: string): MixedSegment[] {
  const segments: MixedSegment[] = [];
  for (const part of value.split(/(\{[^{}]+\})/g)) {
    if (part === "") continue;
    if (part.startsWith("{") && part.endsWith("}")) {
      segments.push({ kind: "alias", name: part.slice(1, -1) });
    } else {
      segments.push({ kind: "text", content: part });
    }
  }
  return segments;
}

function inlineAliasChipHtml(aliasName: string, parentTokenId: string, broken: boolean): string {
  if (broken) {
    return `<span class="mixed-alias-broken" title="Broken reference: {${esc(aliasName)}}">{${esc(aliasName)}}</span>`;
  }
  return `<div class="alias-chip alias-chip--inline" data-token-id="${esc(parentTokenId)}" title="{${esc(aliasName)}}" role="button" tabindex="0" aria-label="Alias: ${esc(aliasName)}"><span class="alias-chip-name">${esc(aliasName)}</span>${ALIAS_GEAR_ICON}</div>`;
}

function valueCellHtml(token: SerializedToken): string {
  // Pure alias: entire value is a single {reference}
  if (isAlias(token.value)) return aliasChipHtml(token);

  // Check for any alias references embedded in the value
  if (!/\{[^{}]+\}/.test(token.value)) {
    // Plain value: no alias references at all
    return `${colorSwatchHtml(token)}<span class="token-value-text" title="${esc(token.value)}">${esc(token.value)}</span>`;
  }

  // Mixed value: one or more {alias} refs alongside plain text / math operators
  const knownNames = new Set(state.tokens.map((t) => t.name));
  const parts = parseMixedValue(token.value).map((seg) => {
    if (seg.kind === "alias") {
      return inlineAliasChipHtml(seg.name, token.id, !knownNames.has(seg.name));
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
  const input = document.getElementById("token-value-input") as HTMLInputElement | null;
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
  const triggerBtn = document.getElementById("value-alias-trigger-btn");
  if (!popover.contains(target) && (!triggerBtn || !triggerBtn.contains(target))) {
    closeModalAliasPicker();
  }
}

function closeModalAliasPicker(): void {
  modalAliasPicker = null;
  const popover = document.getElementById("modal-alias-picker");
  if (popover) popover.classList.add("modal-alias-picker--hidden");
  document.removeEventListener("mousedown", onModalAliasPickerOutsideClick, true);
}

function openModalAliasPicker(tokenType: string, anchorEl: HTMLElement): void {
  // Toggle: close if already open
  if (modalAliasPicker) { closeModalAliasPicker(); return; }

  modalAliasPicker = { tokenType, searchValue: "", pickerSets: [], collapsedGroups: new Set(), anchorEl };

  const popover = getOrCreateModalAliasPicker();
  popover.classList.remove("modal-alias-picker--hidden");
  positionModalAliasPicker();
  renderModalAliasPicker();
  sendToPlugin({ type: "get-all-tokens-by-type", tokenType });

  setTimeout(() => {
    document.addEventListener("mousedown", onModalAliasPickerOutsideClick, true);
  }, 0);
}

function bindValueAliasTrigger(): void {
  const btn = document.getElementById("value-alias-trigger-btn") as HTMLButtonElement | null;
  if (!btn) return;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    openModalAliasPicker(btn.dataset.tokenType ?? "color", btn);
  });
}

function saveAlias(): void {
  if (!aliasEditor) return;
  const { token, inputValue } = aliasEditor;
  sendToPlugin({
    type: "update-token",
    setId: state.selectedSetId,
    tokenId: token.id,
    name: token.name,
    value: inputValue,
    description: token.description,
  });
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

  if (pickerSets.length === 0) return `<div class="alias-picker-empty">Loading…</div>`;
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
      if (aliasEditor.pickerSets.length === 0) {
        sendToPlugin({ type: "get-all-tokens-by-type", tokenType: aliasEditor.token.type });
      }
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

  // If clicking the already-open chip, just close
  if (aliasEditor && aliasEditor.token.id === tokenId) {
    closeAliasEditor();
    return;
  }

  closeAliasEditor();

  aliasEditor = {
    token,
    inputValue: token.value,
    searchValue: "",
    mode: "edit",
    pickerSets: [],
    chipEl,
    collapsedGroups: new Set(),
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
        <span class="token-resolved-text"
              title="${esc(token.resolvedValue ?? token.value)}">
          ${esc(token.resolvedValue ?? token.value)}
        </span>
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
}

let contextCleanup: (() => void) | null = null;

function showContextMenu(x: number, y: number, items: MenuItem[]): void {
  if (contextCleanup) contextCleanup();

  const menu = el("context-menu");
  menu.innerHTML = items
    .map(
      (item, i) => `
    <div class="context-menu-item${item.danger ? " danger" : ""}"
         data-idx="${i}" role="menuitem" tabindex="0">
      ${item.icon}
      <span>${esc(item.label)}</span>
    </div>`
    )
    .join("");

  menu.classList.remove("hidden");

  // Smart positioning
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const mW = 160;
  const mH = items.length * 38 + 8;
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
      action: () => sendToPlugin({ type: "duplicate-set", setId }),
    },
    {
      label: "Delete",
      icon: ICON_DELETE,
      danger: true,
      action: () => showDeleteSetConfirm(set),
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
          sendToPlugin({
            type: "duplicate-token",
            setId: state.selectedSetId,
            tokenId: token.id,
          });
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
  closeModalAliasPicker();
  el("modal-overlay").classList.add("hidden");
  el("modal-container").innerHTML = "";
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
    sendToPlugin({ type: "create-set", name });
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
    sendToPlugin({ type: "rename-set", setId: set.id, newName });
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
    sendToPlugin({ type: "delete-set", setId: set.id });
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
    </div>
    <div class="modal-footer">
      <button type="button" data-appearance="secondary" data-modal-close>Cancel</button>
      <button type="button" data-appearance="primary" data-variant="destructive"
              id="confirm-delete-token-btn">Delete</button>
    </div>`);

  el("confirm-delete-token-btn").addEventListener("click", () => {
    if (state.selectedSetId) {
      sendToPlugin({
        type: "delete-token",
        setId: state.selectedSetId,
        tokenId: token.id,
      });
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
    sendToPlugin({
      type: "move-token",
      fromSetId: state.selectedSetId,
      tokenId: token.id,
      toSetId,
      copy,
    });
    closeModal();
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
  { value: "textDecoration", label: "Text Decoration", placeholder: "none | underline | line-through" },
  { value: "typography", label: "Typography", placeholder: "" },
];

function getTypeDef(value: string): TokenTypeDef {
  return TOKEN_TYPES.find((t) => t.value === value) ?? TOKEN_TYPES[0];
}

// Builds the value fields section for shadow tokens
function shadowFieldsHtml(x = "0", y = "4", blur = "8", spread = "0", color = "rgba(0,0,0,0.25)", type = "drop-shadow"): string {
  return `
    <div class="form-field">
      <label class="form-label">Shadow type</label>
      <div style="display:flex;gap:14px;margin-top:2px">
        <div class="radio-container">
          <input type="radio" class="radio-input" name="shadow-type"
                 id="shadow-drop" value="drop-shadow" ${type === "drop-shadow" ? "checked" : ""} />
          <label class="radio-label" for="shadow-drop">Drop shadow</label>
        </div>
        <div class="radio-container">
          <input type="radio" class="radio-input" name="shadow-type"
                 id="shadow-inner" value="inner-shadow" ${type === "inner-shadow" ? "checked" : ""} />
          <label class="radio-label" for="shadow-inner">Inner shadow</label>
        </div>
      </div>
    </div>
    <div class="shadow-grid">
      <div class="form-field">
        <label class="form-label" for="shadow-x">X</label>
        <input type="number" class="input form-input" id="shadow-x" value="${esc(x)}" />
      </div>
      <div class="form-field">
        <label class="form-label" for="shadow-y">Y</label>
        <input type="number" class="input form-input" id="shadow-y" value="${esc(y)}" />
      </div>
      <div class="form-field">
        <label class="form-label" for="shadow-blur">Blur</label>
        <input type="number" class="input form-input" id="shadow-blur" value="${esc(blur)}" min="0" />
      </div>
      <div class="form-field">
        <label class="form-label" for="shadow-spread">Spread</label>
        <input type="number" class="input form-input" id="shadow-spread" value="${esc(spread)}" />
      </div>
    </div>
    <div class="form-field">
      <label class="form-label" for="shadow-color">Color</label>
      <input type="text" class="input form-input" id="shadow-color" value="${esc(color)}"
             placeholder="rgba(0,0,0,0.25)" />
    </div>`;
}

// Builds the value fields section for typography tokens
function typographyFieldsHtml(vals: Record<string, string> = {}): string {
  const v = (k: string, fallback = "") => esc(vals[k] ?? fallback);
  return `
    <div class="typo-grid">
      <div class="form-field">
        <label class="form-label" for="typo-family">Font Family</label>
        <input type="text" class="input form-input" id="typo-family"
               value="${v("fontFamily")}" placeholder="Inter" />
      </div>
      <div class="form-field">
        <label class="form-label" for="typo-size">Font Size</label>
        <input type="text" class="input form-input" id="typo-size"
               value="${v("fontSize")}" placeholder="16px" />
      </div>
      <div class="form-field">
        <label class="form-label" for="typo-weight">Font Weight</label>
        <input type="text" class="input form-input" id="typo-weight"
               value="${v("fontWeight")}" placeholder="400" />
      </div>
      <div class="form-field">
        <label class="form-label" for="typo-line-height">Line Height</label>
        <input type="text" class="input form-input" id="typo-line-height"
               value="${v("lineHeight")}" placeholder="1.5" />
      </div>
      <div class="form-field">
        <label class="form-label" for="typo-letter-spacing">Letter Spacing</label>
        <input type="text" class="input form-input" id="typo-letter-spacing"
               value="${v("letterSpacing")}" placeholder="0" />
      </div>
      <div class="form-field">
        <label class="form-label" for="typo-text-case">Text Case</label>
        <select class="select form-input" id="typo-text-case">
          ${["none", "uppercase", "lowercase", "capitalize"]
            .map((o) => `<option value="${o}"${vals.textCase === o ? " selected" : ""}>${o}</option>`)
            .join("")}
        </select>
      </div>
      <div class="form-field" style="grid-column: 1/-1">
        <label class="form-label" for="typo-text-decoration">Text Decoration</label>
        <select class="select form-input" id="typo-text-decoration">
          ${["none", "underline", "line-through"]
            .map((o) => `<option value="${o}"${vals.textDecoration === o ? " selected" : ""}>${o}</option>`)
            .join("")}
        </select>
      </div>
    </div>`;
}

// Builds the simple single-value input area
function simpleValueFieldHtml(type: string, value = ""): string {
  const isColor = type === "color";
  const { placeholder } = getTypeDef(type);
  return `
    <div class="form-field">
      <label class="form-label" for="token-value-input">Value</label>
      <div class="value-input-wrapper">
        ${isColor ? `<span class="color-swatch-small" id="token-value-swatch" style="background:${esc(value || "#cccccc")}"></span>` : ""}
        <input type="text" class="input form-input${isColor ? " has-swatch" : ""}"
               id="token-value-input"
               value="${esc(value)}"
               placeholder="${esc(placeholder)}"
               autocomplete="off" />
        <button type="button" class="icon-btn value-alias-trigger" id="value-alias-trigger-btn"
                title="Insert alias reference" data-token-type="${esc(type)}">
          ${VALUE_ALIAS_INSERT_ICON}
        </button>
      </div>
    </div>`;
}

function readShadowValue(): string {
  const type = (document.querySelector<HTMLInputElement>('input[name="shadow-type"]:checked'))?.value ?? "drop-shadow";
  return JSON.stringify({
    type,
    x: el<HTMLInputElement>("shadow-x")?.value ?? "0",
    y: el<HTMLInputElement>("shadow-y")?.value ?? "0",
    blur: el<HTMLInputElement>("shadow-blur")?.value ?? "0",
    spread: el<HTMLInputElement>("shadow-spread")?.value ?? "0",
    color: el<HTMLInputElement>("shadow-color")?.value ?? "rgba(0,0,0,0.25)",
  });
}

function readTypographyValue(): string {
  return JSON.stringify({
    fontFamily: el<HTMLInputElement>("typo-family")?.value ?? "",
    fontSize: el<HTMLInputElement>("typo-size")?.value ?? "",
    fontWeight: el<HTMLInputElement>("typo-weight")?.value ?? "",
    lineHeight: el<HTMLInputElement>("typo-line-height")?.value ?? "",
    letterSpacing: el<HTMLInputElement>("typo-letter-spacing")?.value ?? "",
    textCase: el<HTMLSelectElement>("typo-text-case")?.value ?? "none",
    textDecoration: el<HTMLSelectElement>("typo-text-decoration")?.value ?? "none",
  });
}

function readTokenValue(type: string): string {
  if (type === "shadow") return readShadowValue();
  if (type === "typography") return readTypographyValue();
  return el<HTMLInputElement>("token-value-input")?.value?.trim() ?? "";
}

// ════════════════════════════════════════════════════════════════════════
//  COLOR PICKER
// ════════════════════════════════════════════════════════════════════════

// ── Colour conversion utilities ───────────────────────────────────────

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const sv = s / 100, vv = v / 100;
  const c = vv * sv, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = vv - c;
  let r = 0, g = 0, b = 0;
  if      (h <  60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }
  return [Math.round((r+m)*255), Math.round((g+m)*255), Math.round((b+m)*255)];
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rr = r/255, gg = g/255, bb = b/255;
  const max = Math.max(rr,gg,bb), min = Math.min(rr,gg,bb), d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d/max*100, v = max*100;
  if (d !== 0) {
    if (max === rr)      h = 60*(((gg-bb)/d)%6);
    else if (max === gg) h = 60*((bb-rr)/d+2);
    else                 h = 60*((rr-gg)/d+4);
    if (h < 0) h += 360;
  }
  return [h, s, v];
}

function hexToRgb(hex: string): [number, number, number] | null {
  const h = hex.replace(/^#/, "");
  if (h.length === 3) return [parseInt(h[0]+h[0],16), parseInt(h[1]+h[1],16), parseInt(h[2]+h[2],16)];
  if (h.length >= 6)  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  return null;
}

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r,g,b].map(n => Math.round(n).toString(16).padStart(2,"0")).join("");
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rr=r/255, gg=g/255, bb=b/255;
  const max=Math.max(rr,gg,bb), min=Math.min(rr,gg,bb), l=(max+min)/2, d=max-min;
  let h=0, s=0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2*l-1));
    if (max===rr)      h = 60*(((gg-bb)/d)%6);
    else if (max===gg) h = 60*((bb-rr)/d+2);
    else               h = 60*((rr-gg)/d+4);
    if (h < 0) h += 360;
  }
  return [Math.round(h), Math.round(s*100), Math.round(l*100)];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const ss=s/100, ll=l/100, c=(1-Math.abs(2*ll-1))*ss;
  const x=c*(1-Math.abs(((h/60)%2)-1)), m=ll-c/2;
  let r=0, g=0, b=0;
  if      (h <  60) { r=c; g=x; b=0; }
  else if (h < 120) { r=x; g=c; b=0; }
  else if (h < 180) { r=0; g=c; b=x; }
  else if (h < 240) { r=0; g=x; b=c; }
  else if (h < 300) { r=x; g=0; b=c; }
  else              { r=c; g=0; b=x; }
  return [Math.round((r+m)*255), Math.round((g+m)*255), Math.round((b+m)*255)];
}

function parseCssColor(v: string): [number, number, number, number] | null {
  const hexM = v.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hexM) {
    const h = hexM[1], rgb = hexToRgb("#"+h);
    if (!rgb) return null;
    return [...rgb, h.length === 8 ? parseInt(h.slice(6),16)/255 : 1];
  }
  const rgbM = v.trim().match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/i);
  if (rgbM) return [parseInt(rgbM[1]), parseInt(rgbM[2]), parseInt(rgbM[3]),
                    rgbM[4] !== undefined ? parseFloat(rgbM[4]) : 1];
  return null;
}

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
  bindValueAliasTrigger();

  // Update fields when type changes
  const typeSelect = el<HTMLSelectElement>("token-type-select");
  typeSelect.addEventListener("change", () => {
    const newType = typeSelect.value;
    closeModalAliasPicker();
    el("token-modal-title").textContent =
      `CREATE NEW ${getTypeDef(newType).label.toUpperCase()} TOKEN`;
    const nameInput = el<HTMLInputElement>("token-name-input");
    if (nameInput) nameInput.placeholder = `Enter ${getTypeDef(newType).label.toLowerCase()} token name`;
    el("token-value-section").innerHTML = buildValueSection(newType);
    if (newType === "color") bindColorSwatchPreview();
    bindValueAliasTrigger();
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
      sendToPlugin({
        type: "create-token",
        setId: state.selectedSetId,
        tokenType: type,
        name,
        value,
        description,
      });
    }
    closeModal();
  });
}

// ════════════════════════════════════════════════════════════════════════
//  MODAL: EDIT TOKEN
// ════════════════════════════════════════════════════════════════════════

function parseShadowValue(raw: string): Record<string, string> {
  try { return JSON.parse(raw); } catch { return {}; }
}

function parseTypographyValue(raw: string): Record<string, string> {
  try { return JSON.parse(raw); } catch { return {}; }
}

function buildEditValueSection(token: SerializedToken): string {
  if (token.type === "shadow") {
    const v = parseShadowValue(token.value);
    return shadowFieldsHtml(v.x, v.y, v.blur, v.spread, v.color, v.type);
  }
  if (token.type === "typography") {
    return typographyFieldsHtml(parseTypographyValue(token.value));
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
  bindValueAliasTrigger();

  el("confirm-edit-token-btn").addEventListener("click", () => {
    const name = el<HTMLInputElement>("edit-token-name")?.value?.trim();
    const description = el<HTMLInputElement>("edit-token-description")?.value?.trim() ?? "";
    const value = readTokenValue(token.type);

    if (!name) return;
    if (state.selectedSetId) {
      sendToPlugin({
        type: "update-token",
        setId: state.selectedSetId,
        tokenId: token.id,
        name,
        value,
        description,
      });
    }
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
    ids.forEach((tokenId) =>
      sendToPlugin({ type: "move-token", fromSetId, tokenId, toSetId, copy })
    );
    selectedTokenIds.clear();
    closeModal();
  });
}

function handleBulkDuplicate(ids: Set<string>): void {
  if (!state.selectedSetId) return;
  const setId = state.selectedSetId;
  // Each message carries only the tokenId; the plugin fetches live data from
  // the Penpot API so composite values (shadow, typography) are never stale.
  ids.forEach((tokenId) => {
    sendToPlugin({ type: "duplicate-token", setId, tokenId });
  });
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
    </div>
    <div class="modal-footer">
      <button type="button" data-appearance="secondary" data-modal-close>Cancel</button>
      <button type="button" data-appearance="primary" data-variant="destructive"
              id="confirm-bulk-delete-btn">Delete</button>
    </div>`);

  el("confirm-bulk-delete-btn").addEventListener("click", () => {
    ids.forEach((tokenId) => sendToPlugin({ type: "delete-token", setId, tokenId }));
    selectedTokenIds.clear();
    closeModal();
  });
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

  // Toggle sidebar
  el("toggle-sidebar-overview")?.addEventListener("click", toggleSidebar);
  el("toggle-sidebar-tokens")?.addEventListener("click", toggleSidebar);

  // Overview search
  el("overview-search-input")?.addEventListener("input", renderOverview);

  // New token
  el("new-token-btn")?.addEventListener("click", () => showNewTokenModal());

  // Token search
  el("tokens-search-input")?.addEventListener("input", renderTokenTable);

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
