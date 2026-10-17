/**
 * The selected set: header (breadcrumb, grouping, resolution context,
 * search) and the token table — or the comparison when compare mode is on.
 *
 * Table features: sortable columns, resizable columns (widths persisted),
 * grouping by name path or type with collapsible groups, bulk selection,
 * inline value editing (double-click a simple value), per-row "apply to
 * selection" and the token menu (button, right-click or context-menu key).
 */

import { signal } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";
import type { SerializedToken, SortKey } from "../../shared/types";
import { runOps } from "../bridge";
import { Icon, TypeIcon } from "../icons";
import { plural } from "../lib/names";
import { COMPOSITE_TYPES, getTypeDef, SELECT_OPTIONS, TOKEN_TYPES } from "../lib/tokenTypes";
import { openContextMenu, openMenuAt } from "../overlays";
import { getPref, setPref, type GroupMode, type ResolveMode } from "../prefs";
import {
  clearTokenSelection, collapsedTokenGroups, compare, effectiveResolveMode, exitCompare, flashTokenId, groupMode,
  selectedSet, selectedTokenIds, selectedTokens, selection, setGroupMode, setResolveMode, setSort, setTokenSelected,
  sortDir, sortKey, themes, toggleSidebar, toggleTokenGroup, tokenQuery,
} from "../store";
import { ResolvedCell, ValueCell } from "./cells";
import { CompareTable } from "./CompareTable";
import { setMenuItems, tokenMenuItems } from "./menus";
import { openApplyTokenModal } from "./modals/ApplyTokenModal";
import { openDeleteTokensModal, openMoveTokensModal } from "./modals/TokenActions";
import { openCreateTokenModal, openEditTokenModal } from "./modals/TokenEditorModal";

// ── Column widths ────────────────────────────────────────────────────────

// [check, name, value, resolved, type, actions]
const COL_DEFAULT = [56, 170, 185, 160, 110, 64];
const COL_MIN = [56, 80, 80, 80, 80, 64];
const COL_FIXED = new Set([0, 5]);

function initialWidths(): number[] {
  const saved = getPref("colWidths");
  return saved?.length === COL_DEFAULT.length ? saved : [...COL_DEFAULT];
}

const colWidths = signal<number[]>(initialWidths());

function ResizeHandle({ col }: { col: number }) {
  const onMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidths.value[col];
    const handle = e.currentTarget as HTMLElement;
    handle.classList.add("is-dragging");
    document.documentElement.classList.add("col-resizing");
    const move = (ev: MouseEvent) => {
      const next = [...colWidths.value];
      next[col] = Math.max(COL_MIN[col], Math.round(startW + ev.clientX - startX));
      colWidths.value = next;
    };
    const up = () => {
      handle.classList.remove("is-dragging");
      document.documentElement.classList.remove("col-resizing");
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      setPref("colWidths", colWidths.value);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };
  return <div class="col-resize-handle" aria-hidden="true" onMouseDown={onMouseDown} onClick={(e) => e.stopPropagation()} />;
}

// ── Sorting, filtering, grouping ─────────────────────────────────────────

function sortTokens(tokens: SerializedToken[], key: SortKey | null, dir: "asc" | "desc"): SerializedToken[] {
  if (!key) return tokens;
  const sign = dir === "asc" ? 1 : -1;
  const pick = (t: SerializedToken) => (key === "resolvedValue" ? t.resolvedValue ?? t.value : t[key]).toLowerCase();
  return [...tokens].sort((a, b) => {
    const av = pick(a);
    const bv = pick(b);
    return av < bv ? -sign : av > bv ? sign : 0;
  });
}

interface TokenGroup {
  key: string;
  label: string;
  tokens: SerializedToken[];
}

function groupTokens(tokens: SerializedToken[], mode: GroupMode): TokenGroup[] {
  if (mode === "none") return [{ key: "all", label: "All tokens", tokens }];
  const groups = new Map<string, TokenGroup>();
  for (const t of tokens) {
    const key = mode === "type" ? t.type : t.name.includes(".") ? t.name.slice(0, t.name.lastIndexOf(".")) : "";
    const label = mode === "type" ? getTypeDef(t.type).label : key || "(top level)";
    const g = groups.get(key) ?? { key, label, tokens: [] };
    g.tokens.push(t);
    groups.set(key, g);
  }
  const list = [...groups.values()];
  if (mode === "type") {
    const order = TOKEN_TYPES.map((t) => t.value);
    return list.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  }
  return list.sort((a, b) => a.key.localeCompare(b.key));
}

// ── Header ───────────────────────────────────────────────────────────────

// Header (identity + main action) and a toolbar below it (how the table is
// viewed): splitting them keeps both readable when the plugin is narrow.

function ResolveSelect() {
  return (
    <label class="toolbar-field" title="Which sets resolve aliases and math in the Resolved value column">
      <span class="toolbar-field-label body-s">Resolve</span>
      <select
        class="select toolbar-select"
        aria-label="Resolve values with"
        value={effectiveResolveMode.value}
        onChange={(e) => setResolveMode(e.currentTarget.value as ResolveMode)}
      >
        <option value="set-on-top">This set on top</option>
        <option value="active">Active sets (Penpot)</option>
        {themes.value.map((t) => (
          <option key={t.id} value={`theme:${t.id}`}>Theme: {t.group ? `${t.group} / ${t.name}` : t.name}</option>
        ))}
      </select>
    </label>
  );
}

function GroupSelect() {
  return (
    <label class="toolbar-field" title="Group the tokens in the table">
      <span class="toolbar-field-label body-s">Group</span>
      <select class="select toolbar-select" aria-label="Group tokens by" value={groupMode.value}
        onChange={(e) => setGroupMode(e.currentTarget.value as GroupMode)}>
        <option value="path">Name path</option>
        <option value="type">Type</option>
        <option value="none">None</option>
      </select>
    </label>
  );
}

function TokensHeader({ setId, setName }: { setId: string; setName: string }) {
  const comparing = compare.value !== null;
  return (
    <>
      <div class="main-header">
        <div class="main-header-left">
          <button type="button" class="icon-btn" title="Toggle sidebar" aria-label="Toggle sidebar" onClick={toggleSidebar}>
            <Icon name="sidebarToggle" />
          </button>
          <nav class="breadcrumb" aria-label="Breadcrumb">
            <span class="body-s breadcrumb-prefix">Tokens /</span>
            <h1 class="body-s breadcrumb-set" title={setName}>{setName}</h1>
          </nav>
          {!comparing && (
            <button
              type="button"
              class="icon-btn"
              title="Set options"
              aria-label={`Options for ${setName}`}
              onClick={(e) => openMenuAt(e.currentTarget, setMenuItems(setId))}
            >
              <Icon name="dots" />
            </button>
          )}
        </div>
        <div class="main-header-right">
          {comparing ? (
            <button type="button" class="compare-exit-btn" onClick={exitCompare}>Exit comparison</button>
          ) : (
            <button type="button" data-appearance="primary" onClick={() => openCreateTokenModal(setId)}>+ New token</button>
          )}
        </div>
      </div>
      <div class="tokens-toolbar" role="toolbar" aria-label="Table options">
        <div class="search-wrapper toolbar-search">
          <Icon name="searchSmall" />
          <input
            type="search"
            class="input search-input"
            placeholder="Search tokens"
            aria-label="Search tokens"
            autocomplete="off"
            value={tokenQuery.value}
            onInput={(e) => { tokenQuery.value = e.currentTarget.value; }}
          />
        </div>
        {!comparing && <GroupSelect />}
        <ResolveSelect />
      </div>
    </>
  );
}

// ── Inline value editing ─────────────────────────────────────────────────

/** Simple (non-composite) values can be edited in place with a double-click. */
function canEditInline(token: SerializedToken): boolean {
  return !COMPOSITE_TYPES.has(token.type);
}

function InlineValueEditor({ setId, token, onDone }: { setId: string; token: SerializedToken; onDone(): void }) {
  const ref = useRef<HTMLInputElement & HTMLSelectElement>(null);
  const [value, setValue] = useState(token.value);
  const options = SELECT_OPTIONS[token.type];

  useEffect(() => {
    ref.current?.focus();
    if (!options) (ref.current as HTMLInputElement | null)?.select();
  }, []);

  const commit = () => {
    const next = value.trim();
    if (next && next !== token.value) {
      void runOps([{ op: "update-token", setId, tokenId: token.id, name: token.name, value: next, description: token.description }]);
    }
    onDone();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    if (e.key === "Escape") { e.preventDefault(); onDone(); }
  };

  if (options) {
    return (
      <select ref={ref} class="select inline-value-input" value={value} aria-label={`Value of ${token.name}`}
        onChange={(e) => setValue(e.currentTarget.value)} onKeyDown={onKeyDown} onBlur={commit}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  return (
    <input
      ref={ref}
      type="text"
      class="input inline-value-input"
      value={value}
      aria-label={`Value of ${token.name}`}
      spellcheck={false}
      onInput={(e) => setValue(e.currentTarget.value)}
      onKeyDown={onKeyDown}
      // Leaving the field cancels: only Enter (or picking an option) saves.
      onBlur={options ? commit : onDone}
    />
  );
}

// ── Rows ─────────────────────────────────────────────────────────────────

function TokenRow({ setId, token, index }: { setId: string; token: SerializedToken; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const checked = selectedTokenIds.value.has(token.id);
  const flash = flashTokenId.value === token.id;

  useEffect(() => {
    if (!flash || !ref.current) return;
    ref.current.scrollIntoView({ block: "center" });
    ref.current.classList.add("token-row--flash");
    const id = setTimeout(() => {
      ref.current?.classList.remove("token-row--flash");
      flashTokenId.value = null;
    }, 1600);
    return () => clearTimeout(id);
  }, [flash]);

  const menu = (e: MouseEvent) => {
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY, tokenMenuItems(setId, token));
  };

  return (
    <div
      ref={ref}
      class={`token-row${checked ? " is-selected" : ""}`}
      role="row"
      data-token-id={token.id}
      onContextMenu={menu}
      onKeyDown={(e) => {
        if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
          e.preventDefault();
          openMenuAt(e.currentTarget, tokenMenuItems(setId, token));
        }
      }}
    >
      <div class="tcol-check" role="cell">
        <span class="row-num" aria-hidden="true">{index + 1}</span>
        <input
          type="checkbox"
          class="checkbox-input token-check"
          checked={checked}
          aria-label={`Select ${token.name}`}
          onChange={(e) => setTokenSelected(token.id, e.currentTarget.checked)}
        />
      </div>
      <div class="tcol-name" role="cell" onDblClick={() => openEditTokenModal(setId, token.id)}>
        <span class="col-name-text" title={token.description ? `${token.name}\n${token.description}` : token.name}>
          {token.name}
        </span>
      </div>
      <div
        class={`tcol-value${canEditInline(token) ? " tcol-value--editable" : ""}`}
        role="cell"
        title={canEditInline(token) && !editing ? "Double-click to edit" : undefined}
        onDblClick={(e) => {
          if (!canEditInline(token) || (e.target as HTMLElement).closest(".alias-chip")) return;
          setEditing(true);
        }}
      >
        <div class="col-value-inner">
          {editing
            ? <InlineValueEditor setId={setId} token={token} onDone={() => setEditing(false)} />
            : <ValueCell token={token} editable={{ setId, tokenId: token.id }} />}
        </div>
      </div>
      <div class="tcol-resolved" role="cell">
        <ResolvedCell token={token} />
      </div>
      <div class="tcol-type" role="cell">
        <div class="col-type-inner">
          <span class="token-type-icon"><TypeIcon type={token.type} /></span>
          <span class="token-type-label">{token.type}</span>
        </div>
      </div>
      <div class="tcol-actions" role="cell">
        {selection.value.total > 0 && (
          <button
            type="button"
            class="icon-btn token-apply-btn"
            title={`Apply ${token.name} to the selection`}
            aria-label={`Apply ${token.name} to the selection`}
            onClick={() => openApplyTokenModal(setId, token.id)}
          >
            <Icon name="apply" />
          </button>
        )}
        <button
          type="button"
          class="icon-btn token-menu-btn"
          title="Token options"
          aria-label={`Options for ${token.name}`}
          aria-haspopup="menu"
          onClick={(e) => openMenuAt(e.currentTarget, tokenMenuItems(setId, token))}
        >
          <Icon name="dots" />
        </button>
      </div>
    </div>
  );
}

// ── Table ────────────────────────────────────────────────────────────────

function SortHeader({ col, label, sortBy }: { col: number; label: string; sortBy: SortKey }) {
  const active = sortKey.value === sortBy;
  const ariaSort = active ? (sortDir.value === "asc" ? "ascending" : "descending") : "none";
  return (
    <div class={`tcol-${sortBy === "resolvedValue" ? "resolved" : sortBy} body-s th-cell th-sortable`} role="columnheader" aria-sort={ariaSort}>
      <button type="button" class="th-sort-btn" onClick={() => setSort(sortBy)} title={`Sort by ${label.toLowerCase()}`}>
        <span class="th-label">{label}</span>
        <span class={`sort-icon${active ? " is-active" : ""}${active && sortDir.value === "desc" ? " is-desc" : ""}`} aria-hidden="true">
          <Icon name="sortArrow" />
        </span>
      </button>
      {!COL_FIXED.has(col) && <ResizeHandle col={col} />}
    </div>
  );
}

function BulkBar({ setId, visibleIds }: { setId: string; visibleIds: string[] }) {
  const ids = [...selectedTokenIds.value].filter((id) => visibleIds.includes(id));
  if (selectedTokenIds.value.size === 0) return null;
  const all = [...selectedTokenIds.value];
  return (
    <div class="bulk-bar" role="toolbar" aria-label="Actions for the selected tokens">
      <span class="body-s bulk-bar-label">
        {all.length} selected{ids.length < all.length ? ` (${all.length - ids.length} hidden by the search)` : ""}
      </span>
      <div class="bulk-bar-actions">
        <button type="button" class="icon-btn" title="Move selected" aria-label="Move selected tokens"
          onClick={() => openMoveTokensModal(setId, all)}>
          <Icon name="move" />
        </button>
        <button type="button" class="icon-btn" title="Duplicate selected" aria-label="Duplicate selected tokens"
          onClick={() => {
            void runOps(all.map((tokenId) => ({ op: "duplicate-token" as const, setId, tokenId })));
            clearTokenSelection();
          }}>
          <Icon name="duplicate" />
        </button>
        <button type="button" class="icon-btn bulk-danger-btn" title="Delete selected" aria-label="Delete selected tokens"
          onClick={() => openDeleteTokensModal(setId, all)}>
          <Icon name="trash" />
        </button>
        <button type="button" class="bulk-clear-btn body-s" onClick={clearTokenSelection}>Clear</button>
      </div>
    </div>
  );
}

function TokenTable({ setId }: { setId: string }) {
  const all = selectedTokens.value;
  const query = tokenQuery.value.toLowerCase();
  const filtered = sortTokens(
    all.filter((t) => !query || t.name.toLowerCase().includes(query) || t.type.toLowerCase().includes(query)
      || t.value.toLowerCase().includes(query) || (t.resolvedValue ?? "").toLowerCase().includes(query)),
    sortKey.value,
    sortDir.value,
  );
  const mode = groupMode.value;
  // While searching, show every match (collapsed groups would hide them).
  const groups = groupTokens(filtered, mode);
  const visibleIds = filtered.map((t) => t.id);
  const selectedVisible = visibleIds.filter((id) => selectedTokenIds.value.has(id)).length;
  const selectAll = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectAll.current) {
      selectAll.current.indeterminate = selectedVisible > 0 && selectedVisible < visibleIds.length;
    }
  });

  let rowIndex = 0;
  return (
    <div
      class="tokens-table-wrap"
      role="table"
      aria-label="Tokens"
      aria-rowcount={filtered.length + 1}
      style={{ "--col-widths": colWidths.value.map((w) => `${w}px`).join(" ") }}
    >
      <div class="tokens-table-header" role="row">
        <div class="tcol-check" role="columnheader">
          <input
            ref={selectAll}
            type="checkbox"
            class="checkbox-input"
            aria-label="Select all visible tokens"
            checked={visibleIds.length > 0 && selectedVisible === visibleIds.length}
            onChange={(e) => {
              const next = new Set(selectedTokenIds.value);
              for (const id of visibleIds) {
                if (e.currentTarget.checked) next.add(id); else next.delete(id);
              }
              selectedTokenIds.value = next;
            }}
          />
        </div>
        <SortHeader col={1} label="Name" sortBy="name" />
        <SortHeader col={2} label="Value" sortBy="value" />
        <SortHeader col={3} label="Resolved value" sortBy="resolvedValue" />
        <SortHeader col={4} label="Type" sortBy="type" />
        <div class="tcol-actions" role="columnheader"><span class="visually-hidden">Actions</span></div>
      </div>

      <BulkBar setId={setId} visibleIds={visibleIds} />

      <div class="tokens-table-body" role="rowgroup">
        {filtered.length === 0 ? (
          <div class="empty-state-msg body-s" role="row">
            <span role="cell">{all.length === 0 ? 'No tokens yet. Click "+ New token" to add one.' : "No tokens match your search."}</span>
          </div>
        ) : (
          groups.map((g) => {
            const collapseKey = `${mode}:${g.key}`;
            const collapsed = !query && mode !== "none" && collapsedTokenGroups.value.has(collapseKey);
            const startIndex = rowIndex;
            rowIndex += g.tokens.length;
            return (
              <div key={collapseKey} role="rowgroup" class="token-group">
                <div class="token-group-header" role="row">
                  <div role="cell" class="token-group-cell">
                    {mode === "none" ? (
                      <span class="token-group-label body-s">{plural(g.tokens.length, "token")}</span>
                    ) : (
                      <button
                        type="button"
                        class="token-group-toggle body-s"
                        aria-expanded={!collapsed}
                        onClick={() => toggleTokenGroup(collapseKey)}
                      >
                        <Icon name={collapsed ? "chevronRight" : "chevronDown"} />
                        {mode === "type" && <TypeIcon type={g.key} />}
                        <span class="token-group-label">{g.label}</span>
                        <span class="token-group-count">{g.tokens.length}</span>
                      </button>
                    )}
                  </div>
                </div>
                {!collapsed && g.tokens.map((t, i) => (
                  <TokenRow key={t.id} setId={setId} token={t} index={startIndex + i} />
                ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export function TokensView() {
  const set = selectedSet.value;
  if (!set) return null;
  return (
    <div class="view">
      <TokensHeader setId={set.id} setName={set.name} />
      {compare.value ? <CompareTable /> : <TokenTable setId={set.id} />}
    </div>
  );
}
