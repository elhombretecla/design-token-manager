/**
 * Sets overview (no set selected): one card per set.
 */

import { Icon } from "../icons";
import { openContextMenu, openMenuAt } from "../overlays";
import { overviewQuery, selectSet, sets, toggleSidebar } from "../store";
import { setMenuItems } from "./menus";
import { openExportModal } from "./modals/ExportModal";
import { openImportModal } from "./modals/ImportModal";
import { openNewSetModal } from "./modals/SetModals";

export function Overview() {
  const query = overviewQuery.value.toLowerCase();
  const filtered = sets.value.filter((s) => !query || s.name.toLowerCase().includes(query));

  return (
    <div class="view">
      <div class="main-header">
        <div class="main-header-left">
          <button type="button" class="icon-btn" title="Toggle sidebar" aria-label="Toggle sidebar" onClick={toggleSidebar}>
            <Icon name="sidebarToggle" />
          </button>
          <h1 class="body-m header-title">Tokens</h1>
        </div>
        <div class="main-header-right">
          <div class="search-wrapper">
            <Icon name="searchSmall" />
            <input
              type="search"
              class="input search-input"
              placeholder="Search for token sets"
              aria-label="Search for token sets"
              autocomplete="off"
              value={overviewQuery.value}
              onInput={(e) => { overviewQuery.value = e.currentTarget.value; }}
            />
          </div>
          <button type="button" class="icon-btn" title="Import tokens (JSON)" aria-label="Import tokens" onClick={openImportModal}>
            <Icon name="upload" />
          </button>
          <button type="button" class="icon-btn" title="Export tokens (JSON)" aria-label="Export tokens" onClick={() => openExportModal(null)}>
            <Icon name="download" />
          </button>
          <button type="button" data-appearance="primary" onClick={openNewSetModal}>+ New set</button>
        </div>
      </div>

      <div class="sets-overview-list">
        {filtered.length === 0 ? (
          <p class="empty-state-msg body-s">
            {query ? "No sets match your search." : 'No token sets yet. Click "+ New set" to create one, or import a JSON file.'}
          </p>
        ) : (
          <ul class="sets-overview-grid" aria-label="Token sets">
            {filtered.map((set) => (
              <li
                key={set.id}
                class="set-card"
                onContextMenu={(e) => { e.preventDefault(); openContextMenu(e.clientX, e.clientY, setMenuItems(set.id)); }}
              >
                <button type="button" class="set-card-open" onClick={() => selectSet(set.id)}>
                  <span class="set-card-icon"><Icon name="setCard" /></span>
                  <span class="set-card-name">{set.name}</span>
                  <span class="set-card-meta">
                    <span class="set-card-count" aria-label={`${set.tokens.length} tokens`}>
                      <Icon name="tokenCount" />
                      {set.tokens.length}
                    </span>
                    {set.active && <span class="set-card-active body-s">Active</span>}
                  </span>
                </button>
                <button
                  type="button"
                  class="icon-btn set-card-menu"
                  title="Set options"
                  aria-label={`Options for ${set.name}`}
                  onClick={(e) => openMenuAt(e.currentTarget, setMenuItems(set.id))}
                >
                  <Icon name="dots" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
