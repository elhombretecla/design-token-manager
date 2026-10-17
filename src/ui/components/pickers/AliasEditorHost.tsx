/**
 * ui/components/pickers/AliasEditorHost.tsx
 *
 * Popover opened from an alias chip in the token table: edit the reference
 * as text, or browse tokens of the same type and pick one. For composite
 * tokens it edits a single field (shadows: the first layer).
 */

import { useEffect, useRef, useState } from "preact/hooks";
import { runOps } from "../../bridge";
import { Icon } from "../../icons";
import { getCompositeSubValue, withCompositeSubValue } from "../../lib/tokenTypes";
import { useAnchoredPosition, useEscape, useOutsideClick } from "../../overlays";
import { resolverFor, snapshotSet, toViewToken } from "../../store";
import { AliasPickerList } from "./AliasPicker";
import { aliasEditor, closeAliasEditor, type AliasEditorTarget } from "./aliasEditorState";

export function AliasEditorHost() {
  const target = aliasEditor.value;
  if (!target) return null;
  return <AliasEditor key={`${target.tokenId}:${target.composite?.propKey ?? ""}`} target={target} />;
}

function AliasEditor({ target }: { target: AliasEditorTarget }) {
  const set = snapshotSet(target.setId);
  const raw = set?.tokens.find((t) => t.id === target.tokenId);
  const token = raw && set ? toViewToken(raw, resolverFor(set.id)) : undefined;

  const [value, setValue] = useState(() =>
    token ? (target.composite ? getCompositeSubValue(token.type, token.value, target.composite.propKey) : token.value) : "",
  );
  const [mode, setMode] = useState<"edit" | "list">("edit");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<Element | null>(target.anchor);

  useAnchoredPosition(target.anchor, ref, { width: Math.max(target.anchor.getBoundingClientRect().width, 264) });
  useEscape(closeAliasEditor);
  useOutsideClick([ref, anchorRef], closeAliasEditor);

  useEffect(() => {
    if (mode !== "edit") return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [mode]);

  // The token was deleted (or its set) while the editor was open.
  useEffect(() => {
    if (!token) closeAliasEditor();
  }, [token === undefined]);
  if (!token) return null;

  const save = () => {
    const next = target.composite
      ? withCompositeSubValue(token.type, token.value, target.composite.propKey, value.trim())
      : value;
    void runOps([{
      op: "update-token",
      setId: target.setId,
      tokenId: token.id,
      name: token.name,
      value: next,
      description: token.description,
    }]);
    closeAliasEditor();
  };

  const swatch = token.type === "color" && token.resolvedValue
    ? <span class="color-swatch alias-editor-swatch" style={{ background: token.resolvedValue }} aria-hidden="true" />
    : <span class="alias-editor-swatch-placeholder" />;

  return (
    <div ref={ref} class="alias-editor-popover" role="dialog" aria-label={`Edit reference of ${token.name}`}>
      {mode === "edit" ? (
        <>
          <div class="alias-editor-input-row">
            {swatch}
            <input
              ref={inputRef}
              class="alias-editor-input"
              type="text"
              value={value}
              spellcheck={false}
              autocomplete="off"
              aria-label="Reference"
              onInput={(e) => setValue((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); save(); }
              }}
            />
            <button
              type="button"
              class="icon-btn alias-editor-chevron"
              title="Browse tokens"
              aria-label="Browse tokens"
              onClick={() => setMode("list")}
            >
              <Icon name="chevDown12" />
            </button>
          </div>
          <div class="alias-editor-actions">
            <button type="button" class="alias-editor-cancel" data-appearance="secondary" onClick={closeAliasEditor}>Cancel</button>
            <button type="button" class="alias-editor-save" data-appearance="primary" onClick={save}>Save</button>
          </div>
        </>
      ) : (
        <>
          <div class="alias-editor-input-row">
            {swatch}
            <span class="alias-editor-preview-name">{value}</span>
            <button
              type="button"
              class="icon-btn alias-editor-chevron"
              title="Close list"
              aria-label="Close list"
              onClick={() => setMode("edit")}
            >
              <Icon name="chevUp12" />
            </button>
          </div>
          <AliasPickerList
            tokenType={target.composite?.propType ?? token.type}
            autoFocus
            onPick={(name) => {
              setValue(`{${name}}`);
              setMode("edit");
            }}
          />
        </>
      )}
    </div>
  );
}
