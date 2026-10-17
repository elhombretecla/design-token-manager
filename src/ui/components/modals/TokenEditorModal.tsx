/**
 * ui/components/modals/TokenEditorModal.tsx
 *
 * Create / edit a token: type (create only), name with inline validation,
 * the value editor for its type (simple, shadow layers, typography) and an
 * optional description. Renaming a token that other tokens reference asks
 * whether to update those references.
 */

import { Fragment } from "preact";
import { useState } from "preact/hooks";
import type { Op } from "../../../shared/protocol";
import { replaceReference } from "../../../utils/alias";
import { normalizeShadowLayers, shadowLayersToValue } from "../../../utils/shadowNormalize";
import { normalizeTypographyValueToForm } from "../../../utils/typographyNormalize";
import { runOps, showToast } from "../../bridge";
import { Icon } from "../../icons";
import { findReferences, otherSetsDefining, plural, tokenNameError, type TokenRef } from "../../lib/names";
import {
  COMPOSITE_TYPES, DEFAULT_SHADOW_LAYER, SELECT_OPTIONS, TOKEN_TYPES, getTypeDef, legacyTextDecoration,
  typographyFormToValue,
} from "../../lib/tokenTypes";
import { ModalFrame, closeModal, openModal } from "../../overlays";
import { snapshot, snapshotSet } from "../../store";
import { AliasTrigger } from "../pickers/AliasPicker";
import { ColorInput } from "../pickers/ColorPicker";
import { FontFamilyInput } from "../pickers/FontPicker";

export function openCreateTokenModal(setId: string, initialType = "color"): void {
  openModal(<TokenEditor setId={setId} initialType={initialType} />);
}

export function openEditTokenModal(setId: string, tokenId: string): void {
  const token = snapshotSet(setId)?.tokens.find((t) => t.id === tokenId);
  if (!token) {
    showToast("That token no longer exists", "error");
    return;
  }
  openModal(<TokenEditor setId={setId} tokenId={tokenId} />, { wide: COMPOSITE_TYPES.has(token.type) });
}

type Layer = Record<string, string>;

function initialSimple(type: string, value: string): string {
  const options = SELECT_OPTIONS[type];
  if (!options) return value;
  const current = type === "textDecoration" ? legacyTextDecoration(value) : value;
  return options.includes(current) ? current : options[0];
}

function initialTypography(value: string): Record<string, string> {
  const form = normalizeTypographyValueToForm(value);
  return {
    ...form,
    textCase: initialSimple("textCase", form.textCase ?? ""),
    textDecoration: initialSimple("textDecoration", form.textDecoration ?? ""),
  };
}

function TokenEditor(props: { setId: string; tokenId?: string; initialType?: string }) {
  // Snapshot of the token when the editor opened; edits aren't overwritten
  // by snapshots arriving while it's open.
  const [original] = useState(() => snapshotSet(props.setId)?.tokens.find((t) => t.id === props.tokenId));
  const isEdit = Boolean(original);

  const [type, setType] = useState(original?.type ?? props.initialType ?? "color");
  const [name, setName] = useState(original?.name ?? "");
  const [description, setDescription] = useState(original?.description ?? "");
  const [simple, setSimple] = useState(() => initialSimple(type, original?.value ?? ""));
  const [layers, setLayers] = useState<Layer[]>(() => {
    const parsed = original?.type === "shadow" ? normalizeShadowLayers(original.value) : [];
    return parsed.length > 0 ? parsed : [{ ...DEFAULT_SHADOW_LAYER }];
  });
  const [typo, setTypo] = useState<Record<string, string>>(() =>
    initialTypography(original?.type === "typography" ? original.value : ""));
  const [showErrors, setShowErrors] = useState(false);
  const [nameTouched, setNameTouched] = useState(false);

  const otherNames = (snapshotSet(props.setId)?.tokens ?? [])
    .filter((t) => t.id !== original?.id)
    .map((t) => t.name);
  const nameError = tokenNameError(name, otherNames);
  const isComposite = COMPOSITE_TYPES.has(type);
  const valueError = !isComposite && !simple.trim() ? "Enter a value" : null;
  const showNameError = (showErrors || nameTouched) && nameError;
  const showValueError = showErrors && valueError;

  const label = getTypeDef(type).label.toLowerCase();

  const changeType = (next: string) => {
    setType(next);
    setSimple(initialSimple(next, ""));
    setLayers([{ ...DEFAULT_SHADOW_LAYER }]);
    setTypo(initialTypography(""));
    setShowErrors(false);
  };

  const submit = (e?: Event) => {
    e?.preventDefault();
    if (nameError || valueError) {
      setShowErrors(true);
      document.getElementById(nameError ? "token-name-input" : "token-value-input")?.focus();
      return;
    }
    const value = type === "shadow" ? shadowLayersToValue(layers)
      : type === "typography" ? typographyFormToValue(typo)
      : simple.trim();
    const trimmedName = name.trim();
    const desc = description.trim();

    if (!original) {
      void runOps([{ op: "create-token", setId: props.setId, tokenType: type, name: trimmedName, value, description: desc }]);
      closeModal();
      return;
    }
    saveTokenEdit(props.setId, original.id, original.name, trimmedName, value, desc);
  };

  return (
    <form class="modal-form" onSubmit={submit} noValidate>
      <ModalFrame
        title={isEdit ? `Edit ${label} token` : `New ${label} token`}
        footer={
          <>
            <button type="button" data-appearance="secondary" onClick={closeModal}>Cancel</button>
            <button type="submit" data-appearance="primary">Save</button>
          </>
        }
      >
        {!isEdit && (
          <div class="form-field">
            <label class="form-label" for="token-type-select">Type</label>
            <select
              class="select form-input"
              id="token-type-select"
              value={type}
              onChange={(e) => changeType((e.target as HTMLSelectElement).value)}
            >
              {TOKEN_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        )}

        <div class="form-field">
          <label class="form-label" for="token-name-input">Name</label>
          <input
            type="text"
            class={`input form-input${showNameError ? " error" : ""}`}
            id="token-name-input"
            data-autofocus
            value={name}
            placeholder={`Enter ${label} token name`}
            autocomplete="off"
            aria-invalid={showNameError ? "true" : undefined}
            aria-describedby={showNameError ? "token-name-error" : undefined}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            onBlur={() => setNameTouched(true)}
          />
          {showNameError && <p class="form-error body-s" id="token-name-error" role="alert">{nameError}</p>}
        </div>

        {type === "shadow" ? (
          <ShadowLayersEditor layers={layers} onChange={setLayers} />
        ) : type === "typography" ? (
          <TypographyFields form={typo} onChange={setTypo} />
        ) : (
          <SimpleValueField type={type} value={simple} onInput={setSimple} error={showValueError ? valueError : null} />
        )}

        <div class="form-field">
          <label class="form-label" for="token-description-input">
            Description <span class="optional">(Optional)</span>
          </label>
          <input
            type="text"
            class="input form-input"
            id="token-description-input"
            value={description}
            placeholder="Description"
            autocomplete="off"
            onInput={(e) => setDescription((e.target as HTMLInputElement).value)}
          />
        </div>
      </ModalFrame>
    </form>
  );
}

// ── Value fields ─────────────────────────────────────────────────────────

function SimpleValueField(props: { type: string; value: string; onInput(v: string): void; error: string | null }) {
  const { type, value, onInput, error } = props;
  const options = SELECT_OPTIONS[type];
  const describedBy = error ? "token-value-error" : undefined;
  const placeholder = getTypeDef(type).placeholder;
  const pickAlias = (name: string) => onInput(`{${name}}`);

  let control;
  if (options) {
    control = (
      <select class="select" id="token-value-input" value={value} onChange={(e) => onInput((e.target as HTMLSelectElement).value)}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  } else if (type === "color") {
    control = <ColorInput id="token-value-input" value={value} onInput={onInput} placeholder={placeholder} aliasType={type} />;
  } else if (type === "fontFamilies") {
    control = (
      <div class="value-input-wrapper">
        <FontFamilyInput id="token-value-input" value={value} onInput={onInput} placeholder={placeholder} class={error ? "error" : undefined} />
        <AliasTrigger tokenType={type} onPick={pickAlias} />
      </div>
    );
  } else {
    control = (
      <div class="value-input-wrapper">
        <input
          type="text"
          class={`input form-input${error ? " error" : ""}`}
          id="token-value-input"
          value={value}
          placeholder={placeholder}
          autocomplete="off"
          aria-invalid={error ? "true" : undefined}
          aria-describedby={describedBy}
          onInput={(e) => onInput((e.target as HTMLInputElement).value)}
        />
        <AliasTrigger tokenType={type} onPick={pickAlias} />
      </div>
    );
  }

  return (
    <div class="form-field">
      <label class="form-label" for="token-value-input">Value</label>
      {control}
      {error && <p class="form-error body-s" id="token-value-error" role="alert">{error}</p>}
    </div>
  );
}

function ShadowLayersEditor({ layers, onChange }: { layers: Layer[]; onChange(layers: Layer[]): void }) {
  const set = (i: number, key: string, v: string) =>
    onChange(layers.map((l, j) => (j === i ? { ...l, [key]: v } : l)));
  const remove = (i: number) => onChange(layers.filter((_, j) => j !== i));

  return (
    <>
      <div class="shadow-layers">
        {layers.map((layer, i) => {
          const val = (key: string) => layer[key] ?? DEFAULT_SHADOW_LAYER[key];
          const type = layer.type ?? "drop-shadow";
          const num = (key: string, labelText: string) => (
            <div class="form-field">
              <label class="form-label" for={`shadow-${key}-${i}`}>{labelText}</label>
              <div class="value-input-wrapper">
                <input
                  type="text"
                  class="input form-input"
                  id={`shadow-${key}-${i}`}
                  value={val(key)}
                  onInput={(e) => set(i, key, (e.target as HTMLInputElement).value)}
                />
                <AliasTrigger tokenType="dimension" onPick={(name) => set(i, key, `{${name}}`)} />
              </div>
            </div>
          );
          return (
            <div key={i} class="shadow-layer">
              {layers.length > 1 && (
                <div class="shadow-layer-header">
                  <span class="form-label">Layer {i + 1}</span>
                  <button
                    type="button"
                    class="icon-btn shadow-layer-remove"
                    title="Remove layer"
                    aria-label={`Remove layer ${i + 1}`}
                    onClick={() => remove(i)}
                  >
                    <Icon name="trash" />
                  </button>
                </div>
              )}
              <fieldset class="form-field shadow-type-field">
                <legend class="form-label">Shadow type</legend>
                <div class="shadow-type-options">
                  {(["drop-shadow", "inner-shadow"] as const).map((t) => (
                    <div key={t} class="radio-container">
                      <input
                        type="radio"
                        class="radio-input"
                        name={`shadow-type-${i}`}
                        id={`shadow-${t}-${i}`}
                        value={t}
                        checked={t === "inner-shadow" ? type === "inner-shadow" : type !== "inner-shadow"}
                        onChange={() => set(i, "type", t)}
                      />
                      <label class="radio-label" for={`shadow-${t}-${i}`}>
                        {t === "drop-shadow" ? "Drop shadow" : "Inner shadow"}
                      </label>
                    </div>
                  ))}
                </div>
              </fieldset>
              <div class="shadow-grid">
                {num("x", "X")}
                {num("y", "Y")}
                {num("blur", "Blur")}
                {num("spread", "Spread")}
              </div>
              <div class="form-field">
                <label class="form-label" for={`shadow-color-${i}`}>Color</label>
                <ColorInput
                  id={`shadow-color-${i}`}
                  value={val("color")}
                  placeholder="rgba(0,0,0,0.25)"
                  aliasType="color"
                  onInput={(v) => set(i, "color", v)}
                />
              </div>
            </div>
          );
        })}
      </div>
      <button type="button" class="shadow-add-layer-btn" onClick={() => onChange([...layers, { ...DEFAULT_SHADOW_LAYER }])}>
        + Add layer
      </button>
    </>
  );
}

function TypographyFields({ form, onChange }: { form: Record<string, string>; onChange(form: Record<string, string>): void }) {
  const set = (key: string, v: string) => onChange({ ...form, [key]: v });
  const text = (key: string, id: string, labelText: string, placeholder: string, aliasType: string) => (
    <div class="form-field">
      <label class="form-label" for={id}>{labelText}</label>
      <div class="value-input-wrapper">
        <input
          type="text"
          class="input form-input"
          id={id}
          value={form[key] ?? ""}
          placeholder={placeholder}
          onInput={(e) => set(key, (e.target as HTMLInputElement).value)}
        />
        <AliasTrigger tokenType={aliasType} onPick={(name) => set(key, `{${name}}`)} />
      </div>
    </div>
  );
  const select = (key: string, id: string, labelText: string, wide = false) => (
    <div class="form-field" style={wide ? { gridColumn: "1/-1" } : undefined}>
      <label class="form-label" for={id}>{labelText}</label>
      <select class="select" id={id} value={form[key]} onChange={(e) => set(key, (e.target as HTMLSelectElement).value)}>
        {SELECT_OPTIONS[key].map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );

  return (
    <div class="typo-grid">
      <div class="form-field">
        <label class="form-label" for="typo-family">Font Family</label>
        <div class="value-input-wrapper">
          <FontFamilyInput id="typo-family" value={form.fontFamily ?? ""} placeholder="Inter" onInput={(v) => set("fontFamily", v)} />
          <AliasTrigger tokenType="fontFamilies" onPick={(name) => set("fontFamily", `{${name}}`)} />
        </div>
      </div>
      {text("fontSize", "typo-size", "Font Size", "16px", "fontSizes")}
      {text("fontWeight", "typo-weight", "Font Weight", "400", "fontWeights")}
      {text("lineHeight", "typo-line-height", "Line Height", "1.5", "number")}
      {text("letterSpacing", "typo-letter-spacing", "Letter Spacing", "0", "letterSpacing")}
      {select("textCase", "typo-text-case", "Text Case")}
      {select("textDecoration", "typo-text-decoration", "Text Decoration", true)}
    </div>
  );
}

// ── Rename with references ───────────────────────────────────────────────

/**
 * Save an edited token. When the name changes and other tokens reference
 * the old name (or other sets define it), ask what to do first.
 */
function saveTokenEdit(setId: string, tokenId: string, oldName: string, name: string, value: string, description: string): void {
  const update: Op = { op: "update-token", setId, tokenId, name, value, description };
  const renamed = name !== oldName;
  const refs = renamed ? findReferences(snapshot.value, [oldName], new Set([tokenId])) : [];
  const siblings = renamed ? otherSetsDefining(snapshot.value, oldName, setId) : [];

  if (refs.length === 0 && siblings.length === 0) {
    void runOps([update]);
    closeModal();
    return;
  }
  openModal(<RenameConfirm update={update} oldName={oldName} newName={name} refs={refs} siblingNames={siblings.map((s) => s.name)} />);
}

export function RefsList({ refs, max = 6 }: { refs: TokenRef[]; max?: number }) {
  return (
    <ul class="ref-list body-s">
      {refs.slice(0, max).map((r) => (
        <li key={r.token.id}><span class="ref-set">{r.set.name}</span> / {r.token.name}</li>
      ))}
      {refs.length > max && <li class="ref-more">and {refs.length - max} more…</li>}
    </ul>
  );
}

function RenameConfirm(props: { update: Op; oldName: string; newName: string; refs: TokenRef[]; siblingNames: string[] }) {
  const { update, oldName, newName, refs, siblingNames } = props;
  const renameOnly = () => {
    void runOps([update]);
    closeModal();
  };
  const renameAll = () => {
    const refOps: Op[] = refs.map((r) => ({
      op: "update-token",
      setId: r.set.id,
      tokenId: r.token.id,
      name: r.token.name,
      value: replaceReference(r.token.value, oldName, newName),
      description: r.token.description,
    }));
    void runOps([update, ...refOps]);
    closeModal();
  };
  return (
    <ModalFrame
      title={`Rename ${oldName}`}
      footer={
        <>
          <button type="button" data-appearance="secondary" onClick={renameOnly}>Rename only</button>
          {refs.length > 0 && (
            <button type="button" data-appearance="primary" onClick={renameAll}>Rename and update references</button>
          )}
        </>
      }
    >
      {refs.length > 0 && (
        <>
          <p class="body-s">
            {plural(refs.length, "token")} {refs.length === 1 ? "references" : "reference"} <strong>{`{${oldName}}`}</strong>:
          </p>
          <RefsList refs={refs} />
        </>
      )}
      {siblingNames.length > 0 && (
        <p class="body-s">
          Also defined in {siblingNames.map((n, i) => <Fragment key={n}>{i > 0 && ", "}<strong>{n}</strong></Fragment>)} — those tokens keep the old name.
        </p>
      )}
      <p class="body-s modal-hint">Shapes with this token applied refer to it by name and may need it re-applied.</p>
    </ModalFrame>
  );
}
