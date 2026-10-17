/**
 * Delete and move tokens (one or several). Deleting lists the tokens whose
 * references will break; moving asks how to resolve names that already
 * exist in the target set.
 */

import { useState } from "preact/hooks";
import type { Op, SnapshotToken } from "../../../shared/protocol";
import { runOps } from "../../bridge";
import { findReferences, plural, uniqueName } from "../../lib/names";
import { closeModal, ModalFrame, openModal } from "../../overlays";
import { clearTokenSelection, sets, snapshot, snapshotSet } from "../../store";
import { RefsList } from "./TokenEditorModal";

const LIST_MAX = 6;

function tokensOf(setId: string, tokenIds: string[]): SnapshotToken[] {
  const set = snapshotSet(setId);
  if (!set) return [];
  const wanted = new Set(tokenIds);
  return set.tokens.filter((t) => wanted.has(t.id));
}

// ── Delete ───────────────────────────────────────────────────────────────

export function openDeleteTokensModal(setId: string, tokenIds: string[]): void {
  const tokens = tokensOf(setId, tokenIds);
  if (tokens.length === 0) return;
  const ids = new Set(tokens.map((t) => t.id));
  const refs = findReferences(snapshot.value, tokens.map((t) => t.name), ids);
  const what = tokens.length === 1 ? <strong>{tokens[0].name}</strong> : <strong>{plural(tokens.length, "token")}</strong>;

  openModal(
    <ModalFrame
      title={tokens.length === 1 ? "Delete token" : `Delete ${plural(tokens.length, "token")}`}
      footer={
        <>
          <button type="button" data-appearance="secondary" onClick={closeModal}>Cancel</button>
          <button
            type="button"
            data-appearance="primary"
            data-variant="destructive"
            onClick={() => {
              void runOps(tokens.map((t) => ({ op: "delete-token" as const, setId, tokenId: t.id })));
              clearTokenSelection();
              closeModal();
            }}
          >
            Delete
          </button>
        </>
      }
    >
      <p class="body-s">Delete {what}? You can undo it in Penpot.</p>
      {refs.length > 0 && (
        <div class="modal-warning body-s">
          {refs.length === 1 ? "1 token references" : `${refs.length} tokens reference`}{" "}
          {tokens.length === 1 ? "it" : "them"} and will break unless another active set defines the same name:
          <RefsList refs={refs} />
        </div>
      )}
    </ModalFrame>,
  );
}

// ── Move ─────────────────────────────────────────────────────────────────

function MoveTokensModal({ setId, tokenIds }: { setId: string; tokenIds: string[] }) {
  const [target, setTarget] = useState("");
  const [copy, setCopy] = useState(false);
  const [error, setError] = useState(false);
  const others = sets.value.filter((s) => s.id !== setId);
  const count = tokenIds.length;
  const single = count === 1 ? tokensOf(setId, tokenIds)[0] : undefined;

  const submit = () => {
    if (!target) { setError(true); return; }
    moveTokens(tokenIds, setId, target, copy);
  };

  return (
    <ModalFrame
      title={single ? `Move ${single.name}` : `Move ${plural(count, "token")}`}
      footer={
        <>
          <button type="button" data-appearance="secondary" onClick={closeModal}>Cancel</button>
          <button type="button" data-appearance="primary" onClick={submit}>{copy ? "Copy" : "Move"}</button>
        </>
      }
    >
      <div class="form-field">
        <div class="move-select-wrapper">
          <label class="body-s" for="move-target">To</label>
          <select
            class={`select${error ? " error" : ""}`}
            id="move-target"
            value={target}
            aria-invalid={error ? "true" : undefined}
            onChange={(e) => { setTarget(e.currentTarget.value); setError(false); }}
          >
            <option value="">Choose a set</option>
            {others.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        {error && <p class="form-error body-s">Choose the target set</p>}
      </div>
      <label class="checkbox-container body-s">
        <input type="checkbox" class="checkbox-input" checked={copy} onChange={(e) => setCopy(e.currentTarget.checked)} />
        <span>Copy (keep the original{count === 1 ? "" : "s"})</span>
      </label>
    </ModalFrame>
  );
}

export function openMoveTokensModal(setId: string, tokenIds: string[]): void {
  if (tokenIds.length === 0) return;
  openModal(<MoveTokensModal setId={setId} tokenIds={tokenIds} />);
}

/** Move/copy tokens, asking how to resolve names that already exist in the target. */
export function moveTokens(tokenIds: string[], fromSetId: string, toSetId: string, copy: boolean): void {
  const to = snapshotSet(toSetId);
  if (!to) return;
  const tokens = tokensOf(fromSetId, tokenIds);
  const targetByName = new Map(to.tokens.map((t) => [t.name, t]));
  const conflicts = tokens.filter((t) => targetByName.has(t.name));
  const clean = tokens.filter((t) => !targetByName.has(t.name));
  const moveOp = (t: SnapshotToken, newName?: string): Op =>
    ({ op: "move-token", fromSetId, toSetId, tokenId: t.id, copy, ...(newName ? { newName } : {}) });
  const run = (ops: Op[]) => {
    void runOps(ops);
    clearTokenSelection();
    closeModal();
  };

  if (conflicts.length === 0) {
    run(tokens.map((t) => moveOp(t)));
    return;
  }

  openModal(
    <ModalFrame
      title={`Name conflicts in ${to.name}`}
      footer={
        <>
          <button type="button" data-appearance="secondary" onClick={() => run(clean.map((t) => moveOp(t)))}>
            Skip them
          </button>
          <button
            type="button"
            data-appearance="secondary"
            onClick={() => {
              const taken = new Set(targetByName.keys());
              run([...clean.map((t) => moveOp(t)), ...conflicts.map((t) => moveOp(t, uniqueName(t.name, taken)))]);
            }}
          >
            Keep both
          </button>
          <button
            type="button"
            data-appearance="primary"
            data-variant="destructive"
            onClick={() => {
              const ops: Op[] = clean.map((t) => moveOp(t));
              for (const t of conflicts) {
                ops.push({ op: "delete-token", setId: toSetId, tokenId: targetByName.get(t.name)!.id });
                ops.push(moveOp(t));
              }
              run(ops);
            }}
          >
            Replace
          </button>
        </>
      }
    >
      <p class="body-s">
        {conflicts.length} of {plural(tokens.length, "token")} already exist in <strong>{to.name}</strong>:
      </p>
      <ul class="ref-list body-s">
        {conflicts.slice(0, LIST_MAX).map((t) => <li key={t.id}>{t.name}</li>)}
        {conflicts.length > LIST_MAX && <li class="ref-more">and {conflicts.length - LIST_MAX} more…</li>}
      </ul>
      <p class="body-s modal-hint">"Keep both" adds the moved ones with a "-copy" suffix.</p>
    </ModalFrame>,
  );
}
