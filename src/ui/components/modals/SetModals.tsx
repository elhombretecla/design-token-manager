/**
 * Create, rename and delete token sets.
 */

import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { runOps } from "../../bridge";
import { Icon } from "../../icons";
import { setNameError } from "../../lib/names";
import { closeModal, ModalFrame, openModal } from "../../overlays";
import { selectSet, selectedSetId, sets, snapshotSet } from "../../store";
import { openImportModal } from "./ImportModal";

function SetNameForm(props: {
  title: string;
  initial: string;
  submitLabel: string;
  excludeName?: string;
  onSubmit(name: string): void;
  extraFooter?: ComponentChildren;
}) {
  const [name, setName] = useState(props.initial);
  const [touched, setTouched] = useState(false);
  const taken = sets.value.map((s) => s.name).filter((n) => n !== props.excludeName);
  const error = setNameError(name, taken);
  const showError = touched && error;

  const submit = () => {
    setTouched(true);
    if (error) return;
    props.onSubmit(name.trim());
  };

  return (
    <ModalFrame
      title={props.title}
      footer={
        <>
          {props.extraFooter}
          <button type="button" data-appearance="secondary" onClick={closeModal}>Cancel</button>
          <button type="button" data-appearance="primary" onClick={submit}>{props.submitLabel}</button>
        </>
      }
    >
      <div class="form-field">
        <label class="form-label" for="set-name-input">Name</label>
        <input
          type="text"
          class={`input form-input${showError ? " error" : ""}`}
          id="set-name-input"
          value={name}
          placeholder='Enter name (use "/" for groups)'
          autocomplete="off"
          aria-invalid={showError ? "true" : undefined}
          aria-describedby={showError ? "set-name-error" : undefined}
          onInput={(e) => setName(e.currentTarget.value)}
          onBlur={() => setTouched(true)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        />
        {showError && <p class="form-error body-s" id="set-name-error">{error}</p>}
      </div>
    </ModalFrame>
  );
}

export function openNewSetModal(): void {
  openModal(
    <SetNameForm
      title="New set"
      initial=""
      submitLabel="Create set"
      onSubmit={(name) => {
        void runOps([{ op: "create-set", name }]);
        closeModal();
      }}
      extraFooter={
        <div class="modal-footer-left">
          <button type="button" class="upload-btn" onClick={() => { closeModal(); openImportModal(); }}>
            <Icon name="upload" />
            Import from file
          </button>
        </div>
      }
    />,
  );
}

export function openRenameSetModal(setId: string): void {
  const set = snapshotSet(setId);
  if (!set) return;
  openModal(
    <SetNameForm
      title="Rename set"
      initial={set.name}
      excludeName={set.name}
      submitLabel="Rename"
      onSubmit={(name) => {
        if (name !== set.name) void runOps([{ op: "rename-set", setId, newName: name }]);
        closeModal();
      }}
    />,
  );
}

export function openDeleteSetModal(setId: string): void {
  const set = snapshotSet(setId);
  if (!set) return;
  openModal(
    <ModalFrame
      title="Delete set"
      footer={
        <>
          <button type="button" data-appearance="secondary" onClick={closeModal}>Cancel</button>
          <button
            type="button"
            data-appearance="primary"
            data-variant="destructive"
            onClick={() => {
              void runOps([{ op: "delete-set", setId }]);
              if (selectedSetId.value === setId) selectSet(null);
              closeModal();
            }}
          >
            Delete
          </button>
        </>
      }
    >
      <p class="body-s">
        Delete <strong>{set.name}</strong> and its {set.tokens.length} token{set.tokens.length === 1 ? "" : "s"}?
      </p>
    </ModalFrame>,
  );
}
