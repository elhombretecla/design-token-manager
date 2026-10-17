/**
 * ui/components/modals/ThemesModal.tsx
 *
 * Left: themes grouped by group + creation form. Right: the selected
 * theme's group/name, its active state and the sets it activates. Reads the
 * snapshot signals, so changes made elsewhere show up immediately.
 */

import { useEffect, useState } from "preact/hooks";
import type { SnapshotTheme } from "../../../shared/protocol";
import { runOps } from "../../bridge";
import { Icon } from "../../icons";
import { ModalFrame, openModal } from "../../overlays";
import { sets, themes } from "../../store";

export function openThemesModal(selectedThemeId: string | null = null): void {
  openModal(<ThemesModal initialThemeId={selectedThemeId} />, { wide: true });
}

function themesByGroup(list: SnapshotTheme[]): [string, SnapshotTheme[]][] {
  const groups = new Map<string, SnapshotTheme[]>();
  for (const t of list) {
    const items = groups.get(t.group) ?? [];
    items.push(t);
    groups.set(t.group, items);
  }
  return [...groups.entries()];
}

function ThemesModal({ initialThemeId }: { initialThemeId: string | null }) {
  const all = themes.value;
  const [selectedId, setSelectedId] = useState<string | null>(initialThemeId ?? all[0]?.id ?? null);
  // A just-created theme, selected once it reaches the snapshot.
  const [pending, setPending] = useState<{ group: string; name: string } | null>(null);
  const [draftGroup, setDraftGroup] = useState("");
  const [draftName, setDraftName] = useState("");
  const [nameError, setNameError] = useState(false);

  const created = pending ? all.find((t) => t.name === pending.name && t.group === pending.group) : undefined;
  useEffect(() => {
    if (!created) return;
    setSelectedId(created.id);
    setPending(null);
  }, [created?.id]);

  let effectiveId = created?.id ?? selectedId;
  if (effectiveId && !all.some((t) => t.id === effectiveId)) effectiveId = all[0]?.id ?? null;
  const selected = all.find((t) => t.id === effectiveId) ?? null;

  const create = () => {
    const name = draftName.trim();
    if (!name) { setNameError(true); return; }
    const group = draftGroup.trim();
    setPending({ group, name });
    setDraftName("");
    setNameError(false);
    void runOps([{ op: "create-theme", group, name }]).then((r) => {
      if (!r[0]?.ok) setPending(null);
    });
  };

  return (
    <ModalFrame title="Themes" bodyClass="themes-modal">
      <div class="themes-modal-list">
        {all.length === 0 && <p class="body-s empty-state-msg">No themes yet.</p>}
        {themesByGroup(all).map(([group, items]) => (
          <div key={group} class="themes-modal-group">
            <div class="themes-modal-group-label body-s">{group || "No group"}</div>
            {items.map((t) => (
              <button
                key={t.id}
                type="button"
                class={`themes-modal-item${t.id === selected?.id ? " is-selected" : ""}`}
                aria-pressed={t.id === selected?.id}
                onClick={() => setSelectedId(t.id)}
              >
                <span class={`theme-dot${t.active ? " theme-dot--active" : ""}`} aria-hidden="true" />
                <span class="set-name">{t.name}</span>
                <span class="themes-modal-count" title={`${t.setIds.length} sets`}>{t.setIds.length}</span>
              </button>
            ))}
          </div>
        ))}
        <div class="themes-modal-new">
          <input
            type="text"
            class="input form-input"
            placeholder="Group (optional)"
            aria-label="New theme group"
            value={draftGroup}
            onInput={(e) => setDraftGroup(e.currentTarget.value)}
          />
          <input
            type="text"
            class={`input form-input${nameError ? " error" : ""}`}
            placeholder="New theme name"
            aria-label="New theme name"
            aria-invalid={nameError}
            value={draftName}
            onInput={(e) => { setDraftName(e.currentTarget.value); setNameError(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") create(); }}
          />
          <button type="button" data-appearance="secondary" onClick={create}>+ Add theme</button>
        </div>
      </div>
      <div class="themes-modal-detail">
        {selected
          ? <ThemeDetail key={selected.id} theme={selected} />
          : <p class="body-s empty-state-msg">Create a theme to choose which sets it activates.</p>}
      </div>
    </ModalFrame>
  );
}

function ThemeDetail({ theme }: { theme: SnapshotTheme }) {
  const [group, setGroup] = useState(theme.group);
  const [name, setName] = useState(theme.name);
  const [nameError, setNameError] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const saveNames = () => {
    const g = group.trim();
    const n = name.trim();
    if (!n) { setNameError(true); return; }
    if (g !== theme.group || n !== theme.name) {
      void runOps([{ op: "update-theme", themeId: theme.id, group: g, name: n }]);
    }
  };

  const toggleSet = (setId: string, checked: boolean) => {
    const next = checked ? [...theme.setIds, setId] : theme.setIds.filter((id) => id !== setId);
    void runOps([{ op: "set-theme-sets", themeId: theme.id, setIds: next }]);
  };

  const groupId = `theme-group-${theme.id}`;
  const nameId = `theme-name-${theme.id}`;

  return (
    <>
      <div class="themes-modal-fields">
        <div class="form-field">
          <label class="form-label" for={groupId}>Group</label>
          <input
            id={groupId}
            type="text"
            class="input form-input"
            placeholder="e.g. mode"
            value={group}
            onInput={(e) => setGroup(e.currentTarget.value)}
            onChange={saveNames}
            onKeyDown={(e) => { if (e.key === "Enter") saveNames(); }}
          />
        </div>
        <div class="form-field">
          <label class="form-label" for={nameId}>Name</label>
          <input
            id={nameId}
            type="text"
            class={`input form-input${nameError ? " error" : ""}`}
            aria-invalid={nameError}
            value={name}
            onInput={(e) => { setName(e.currentTarget.value); setNameError(false); }}
            onChange={saveNames}
            onKeyDown={(e) => { if (e.key === "Enter") saveNames(); }}
          />
        </div>
      </div>
      <div class="themes-modal-actions">
        <label class="checkbox-container body-s">
          <input
            type="checkbox"
            class="checkbox-input"
            checked={theme.active}
            onChange={(e) => void runOps([{ op: "set-theme-active", themeId: theme.id, active: e.currentTarget.checked }])}
          />
          <span>Active</span>
        </label>
        <span class="themes-modal-spacer" />
        {confirmDelete ? (
          <span class="theme-delete-confirm body-s">
            Delete theme?
            <button type="button" data-appearance="secondary" onClick={() => setConfirmDelete(false)}>Cancel</button>
            <button
              type="button"
              data-appearance="primary"
              data-variant="destructive"
              onClick={() => void runOps([{ op: "delete-theme", themeId: theme.id }])}
            >
              Delete
            </button>
          </span>
        ) : (
          <>
            <button
              type="button"
              class="icon-btn"
              title="Duplicate theme"
              aria-label="Duplicate theme"
              onClick={() => void runOps([{ op: "duplicate-theme", themeId: theme.id }])}
            >
              <Icon name="duplicate" />
            </button>
            <button
              type="button"
              class="icon-btn"
              title="Delete theme"
              aria-label="Delete theme"
              onClick={() => setConfirmDelete(true)}
            >
              <Icon name="trash" />
            </button>
          </>
        )}
      </div>
      <div class="form-label">Sets in this theme</div>
      <div class="themes-modal-sets">
        {sets.value.length === 0 && <p class="body-s empty-state-msg">No sets yet.</p>}
        {sets.value.map((set) => (
          <label key={set.id} class="checkbox-container body-s themes-modal-set">
            <input
              type="checkbox"
              class="checkbox-input"
              checked={theme.setIds.includes(set.id)}
              onChange={(e) => toggleSet(set.id, e.currentTarget.checked)}
            />
            <span>{set.name}</span>
          </label>
        ))}
      </div>
    </>
  );
}
