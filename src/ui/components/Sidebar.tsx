/**
 * Left sidebar: the set tree (with active toggles), themes grouped by group
 * and the footer actions.
 *
 * The tree follows the ARIA tree pattern: one tab stop, arrows move between
 * items, Left/Right collapse/expand groups, Enter selects, the context-menu
 * key (or Shift+F10) opens the set menu.
 */

import { useEffect, useRef, useState } from "preact/hooks";
import type { SnapshotTheme } from "../../shared/protocol";
import { runOps } from "../bridge";
import { Icon } from "../icons";
import { buildSetTree, type TreeNode } from "../lib/setTree";
import { openContextMenu, openMenuAt } from "../overlays";
import {
  collapsedSetGroups, selectSet, selectedSetId, setQuery, sets, sidebarCollapsed, snapshotSet, themes, toggleSetGroup,
} from "../store";
import { setMenuItems } from "./menus";
import { openCheckModal } from "./modals/CheckModal";
import { openMathInfoModal } from "./modals/MathInfoModal";
import { openNewSetModal } from "./modals/SetModals";
import { openThemesModal } from "./modals/ThemesModal";

function ActiveToggle({ setId }: { setId: string }) {
  const set = snapshotSet(setId);
  if (!set) return null;
  return (
    <input
      type="checkbox"
      class="checkbox-input set-active-toggle"
      checked={set.active}
      aria-label={`${set.name} active in Penpot`}
      title={`${set.active ? "Active" : "Inactive"} in Penpot. Toggling a set directly turns off all themes.`}
      tabIndex={-1}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => void runOps([{ op: "set-set-active", setId, active: e.currentTarget.checked }])}
    />
  );
}

function openSetMenu(e: MouseEvent | KeyboardEvent, setId: string) {
  e.preventDefault();
  if (e instanceof MouseEvent && e.type === "contextmenu") openContextMenu(e.clientX, e.clientY, setMenuItems(setId));
  else openMenuAt(e.currentTarget as Element, setMenuItems(setId));
}

const nodeKey = (node: TreeNode) => (node.kind === "set" ? node.setId : node.setId ?? `g:${node.path}`);

function TreeItems({ nodes, depth, tabKey }: { nodes: TreeNode[]; depth: number; tabKey: string | null }) {
  const selected = selectedSetId.value;
  return (
    <>
      {nodes.map((node) => {
        const indent = { paddingLeft: `${depth * 14 + 10}px` };
        if (node.kind === "set") {
          const isSelected = node.setId === selected;
          return (
            <li
              key={node.setId}
              class={`set-item${isSelected ? " active" : ""}`}
              role="treeitem"
              aria-selected={isSelected}
              aria-level={depth + 1}
              data-set-id={node.setId}
              title={node.fullName}
              style={indent}
              tabIndex={nodeKey(node) === tabKey ? 0 : -1}
              onClick={() => selectSet(node.setId)}
              onContextMenu={(e) => openSetMenu(e, node.setId)}
            >
              <span class="set-icon"><Icon name="set" /></span>
              <span class="set-name">{node.label}</span>
              <ActiveToggle setId={node.setId} />
            </li>
          );
        }
        const expanded = !collapsedSetGroups.value.has(node.path);
        const isSelected = Boolean(node.setId) && node.setId === selected;
        return (
          <li
            key={`g:${node.path}`}
            class={`set-tree-group${isSelected ? " active" : ""}`}
            role="treeitem"
            aria-expanded={expanded}
            aria-selected={node.setId ? isSelected : undefined}
            aria-level={depth + 1}
            data-group-path={node.path}
            data-set-id={node.setId}
            tabIndex={nodeKey(node) === tabKey ? 0 : -1}
          >
            <div
              class="set-tree-group-row"
              style={indent}
              onClick={() => {
                toggleSetGroup(node.path);
                if (node.setId) selectSet(node.setId);
              }}
              onContextMenu={node.setId ? (e) => openSetMenu(e, node.setId!) : undefined}
            >
              <button
                type="button"
                class="set-tree-chevron"
                tabIndex={-1}
                aria-hidden="true"
                onClick={(e) => { e.stopPropagation(); toggleSetGroup(node.path); }}
              >
                <Icon name={expanded ? "chevronDown" : "chevronRight"} />
              </button>
              {node.setId && <span class="set-icon"><Icon name="set" /></span>}
              <span class="set-name">{node.label}</span>
              {node.setId && <ActiveToggle setId={node.setId} />}
            </div>
            {expanded && (
              <ul class="set-tree-children" role="group">
                <TreeItems nodes={node.children} depth={depth + 1} tabKey={tabKey} />
              </ul>
            )}
          </li>
        );
      })}
    </>
  );
}

function onTreeKeyDown(e: KeyboardEvent) {
  const tree = e.currentTarget as HTMLElement;
  const items = [...tree.querySelectorAll<HTMLElement>('[role="treeitem"]')];
  const current = (document.activeElement as HTMLElement)?.closest<HTMLElement>('[role="treeitem"]');
  const i = current ? items.indexOf(current) : -1;
  const focus = (el: HTMLElement | undefined) => {
    if (!el) return;
    e.preventDefault();
    el.focus();
  };
  const setId = current?.dataset.setId;
  const groupPath = current?.dataset.groupPath;

  switch (e.key) {
    case "ArrowDown": focus(items[i + 1] ?? items[0]); break;
    case "ArrowUp": focus(items[i - 1] ?? items[items.length - 1]); break;
    case "Home": focus(items[0]); break;
    case "End": focus(items[items.length - 1]); break;
    case "ArrowRight":
      if (groupPath && collapsedSetGroups.value.has(groupPath)) { e.preventDefault(); toggleSetGroup(groupPath); }
      break;
    case "ArrowLeft":
      if (groupPath && !collapsedSetGroups.value.has(groupPath)) { e.preventDefault(); toggleSetGroup(groupPath); }
      else focus(current?.parentElement?.closest<HTMLElement>('[role="treeitem"]') ?? undefined);
      break;
    case "Enter":
    case " ":
      if (setId) { e.preventDefault(); selectSet(setId); }
      else if (groupPath) { e.preventDefault(); toggleSetGroup(groupPath); }
      break;
    case "ContextMenu":
      if (setId && current) { e.preventDefault(); openMenuAt(current, setMenuItems(setId)); }
      break;
    case "F10":
      if (e.shiftKey && setId && current) { e.preventDefault(); openMenuAt(current, setMenuItems(setId)); }
      break;
  }
}

function SetTree() {
  const query = setQuery.value.toLowerCase();
  const filtered = sets.value.filter((s) => !query || s.name.toLowerCase().includes(query));
  if (filtered.length === 0) {
    return (
      <ul class="sets-list">
        <li class="sets-empty-state body-s">{query ? "No sets match your search." : "No sets yet."}</li>
      </ul>
    );
  }
  const tree = buildSetTree(filtered);
  // Roving tab stop: the selected set if visible, else the first item.
  const visibleKeys: string[] = [];
  const walk = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      visibleKeys.push(nodeKey(n));
      if (n.kind === "group" && !collapsedSetGroups.value.has(n.path)) walk(n.children);
    }
  };
  walk(tree);
  const selected = selectedSetId.value;
  const tabKey = selected && visibleKeys.includes(selected) ? selected : visibleKeys[0] ?? null;

  return (
    <ul class="sets-list" role="tree" aria-label="Token sets" onKeyDown={onTreeKeyDown}>
      <TreeItems nodes={tree} depth={0} tabKey={tabKey} />
    </ul>
  );
}

function themesByGroup(list: SnapshotTheme[]): [string, SnapshotTheme[]][] {
  const groups = new Map<string, SnapshotTheme[]>();
  for (const t of list) groups.set(t.group, [...(groups.get(t.group) ?? []), t]);
  return [...groups.entries()];
}

// Penpot keeps at most one active theme per group; activating one turns
// the others in its group off.
function SidebarThemes() {
  const list = themes.value;
  if (list.length === 0) {
    return <p class="body-s themes-description">Set up themes to switch between sets of values (e.g. light and dark).</p>;
  }
  return (
    <ul class="themes-list">
      {themesByGroup(list).map(([group, items]) => (
        <li key={group} class="themes-group" role="group" aria-label={group || "Themes without group"}>
          {group && <div class="theme-group-label body-s">{group}</div>}
          <ul>
            {items.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  class={`set-item theme-item${t.active ? " theme-item--active" : ""}`}
                  aria-pressed={t.active}
                  title={t.active ? "Active — click to turn off" : "Click to activate"}
                  onClick={() => void runOps([{ op: "set-theme-active", themeId: t.id, active: !t.active }])}
                >
                  <span class="theme-dot" aria-hidden="true" />
                  <span class="set-name">{t.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function SetSearch() {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div class="sidebar-search-box">
      <input
        ref={ref}
        type="search"
        class="input"
        placeholder="Search sets…"
        aria-label="Search sets"
        autocomplete="off"
        value={setQuery.value}
        onInput={(e) => { setQuery.value = e.currentTarget.value; }}
      />
    </div>
  );
}

export function Sidebar() {
  const [searchOpen, setSearchOpen] = useState(false);
  return (
    <aside class={`sidebar${sidebarCollapsed.value ? " collapsed" : ""}`} aria-label="Sets and themes">
      <div class="sidebar-header">
        <div class="sidebar-title-group">
          <h2 class="body-s sidebar-label">Sets</h2>
          <span class="body-s sidebar-count">{sets.value.length}</span>
        </div>
        <div class="sidebar-actions">
          <button
            type="button"
            class="icon-btn"
            title="Search sets"
            aria-label="Search sets"
            aria-expanded={searchOpen}
            onClick={() => {
              setSearchOpen(!searchOpen);
              if (searchOpen) setQuery.value = "";
            }}
          >
            <Icon name="search" />
          </button>
          <button type="button" class="icon-btn" title="New set" aria-label="New set" onClick={openNewSetModal}>
            <Icon name="plus" />
          </button>
        </div>
      </div>

      {searchOpen && <SetSearch />}

      <SetTree />

      <div class="themes-section">
        <div class="themes-header">
          <div class="themes-title-group">
            <h2 class="body-s sidebar-label">Themes</h2>
            <span class="body-s sidebar-count">{themes.value.length}</span>
          </div>
          <button type="button" class="icon-btn" title="Edit themes" aria-label="Edit themes" onClick={() => openThemesModal()}>
            <Icon name="gear" />
          </button>
        </div>
        <SidebarThemes />
      </div>

      <div class="sidebar-footer">
        <button
          type="button"
          class="sidebar-math-btn"
          title="Find broken references, unknown applied tokens and file errors"
          onClick={openCheckModal}
        >
          <Icon name="check" />
          Check tokens
        </button>
        <button type="button" class="sidebar-math-btn" title="Learn about math in token values" onClick={openMathInfoModal}>
          <Icon name="info" />
          Math in token values
        </button>
      </div>
    </aside>
  );
}
