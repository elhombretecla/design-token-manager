/**
 * ui/components/modals/ApplyTokenModal.tsx
 *
 * Apply a token to the shapes selected in Penpot, choosing the properties.
 * Re-renders live as the selection changes. Penpot applies tokens by name
 * and resolves them with the active sets, so the modal warns when that
 * isn't this token.
 */

import { useState } from "preact/hooks";
import { propertiesForType } from "../../../shared/tokenProperties";
import { runOps } from "../../bridge";
import { plural } from "../../lib/names";
import { closeModal, ModalFrame, openModal } from "../../overlays";
import { activeResolver, selection, sets, snapshotSet } from "../../store";

export function openApplyTokenModal(setId: string, tokenId: string): void {
  openModal(<ApplyTokenModal setId={setId} tokenId={tokenId} />);
}

function shortValue(type: string, value: string | undefined): string {
  if (value === undefined) return "";
  if (type === "typography" || type === "shadow") return type;
  return value.length > 28 ? `${value.slice(0, 27)}…` : value;
}

function ApplyTokenModal({ setId, tokenId }: { setId: string; tokenId: string }) {
  const set = snapshotSet(setId);
  const token = set?.tokens.find((t) => t.id === tokenId);
  const [checked, setChecked] = useState<ReadonlySet<string>>(
    () => new Set(token ? propertiesForType(token.type).defaults : []),
  );

  if (!set || !token) {
    return (
      <ModalFrame title="Apply token" footer={<button type="button" data-appearance="secondary" onClick={closeModal}>Close</button>}>
        <p class="body-s">This token no longer exists.</p>
      </ModalFrame>
    );
  }

  const { shapes, total } = selection.value;
  const fullyApplied = (prop: string) => shapes.length > 0 && shapes.every((s) => s.tokens[prop] === token.name);
  const pending = [...checked].filter((p) => !fullyApplied(p));

  const winner = activeResolver().winner(token.name);
  let warning = null;
  if (!winner) {
    warning = (
      <>"{set.name}" isn't active. Penpot applies tokens by name and resolves them with the active sets, so
        the shapes won't take this value until a set defining <strong>{token.name}</strong> is active.</>
    );
  } else if (winner.id !== token.id) {
    const winSet = sets.value.find((s) => s.tokens.some((t) => t.id === winner.id));
    const value = activeResolver().resolveName(token.name).value;
    warning = (
      <>Penpot applies tokens by name: with the current active sets, <strong>{token.name}</strong> comes
        from "{winSet?.name ?? ""}"{value ? ` (${shortValue(token.type, value)})` : ""}, not from this set.</>
    );
  }

  const toggle = (key: string, on: boolean) => {
    const next = new Set(checked);
    if (on) next.add(key); else next.delete(key);
    setChecked(next);
  };

  return (
    <ModalFrame
      title="Apply token"
      footer={
        <>
          <button type="button" data-appearance="secondary" onClick={closeModal}>Cancel</button>
          <button
            type="button"
            data-appearance="primary"
            disabled={total === 0 || pending.length === 0}
            onClick={() => {
              void runOps([{ op: "apply-token", setId, tokenId, properties: pending }]);
              closeModal();
            }}
          >
            Apply
          </button>
        </>
      }
    >
      <p class="body-s">
        {total === 0
          ? <>Select one or more shapes in Penpot to apply <strong>{token.name}</strong>.</>
          : <>Apply <strong>{token.name}</strong> to <strong>{plural(total, "selected shape")}</strong>.</>}
      </p>
      {warning && <p class="body-s modal-warning">{warning}</p>}
      <div class="apply-groups">
        {propertiesForType(token.type).groups.map((g) => (
          <fieldset key={g.label} class="apply-group">
            <legend class="apply-group-label body-s">{g.label}</legend>
            {g.props.map((p) => {
              const applied = fullyApplied(p.key);
              return (
                <label key={p.key} class="checkbox-container body-s apply-prop">
                  <input
                    type="checkbox"
                    class="checkbox-input"
                    checked={applied || checked.has(p.key)}
                    disabled={applied}
                    onChange={(e) => toggle(p.key, e.currentTarget.checked)}
                  />
                  <span>{p.label}</span>
                  {applied && <span class="cprop-badge cprop-badge--accent apply-applied">Applied</span>}
                </label>
              );
            })}
          </fieldset>
        ))}
      </div>
      <p class="body-s modal-hint">To remove an applied token, use the Selection panel at the bottom.</p>
    </ModalFrame>
  );
}
