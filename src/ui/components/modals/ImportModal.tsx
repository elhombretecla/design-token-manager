/**
 * ui/components/modals/ImportModal.tsx
 *
 * Import a token file (Penpot / DTCG / Tokens Studio JSON) from a file or
 * pasted text, with a summary of what will be created or merged before
 * anything is written.
 */

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { parseTokenFile, setNameFromFileName, type ImportResult } from "../../../shared/dtcg";
import type { Op } from "../../../shared/protocol";
import { runOps } from "../../bridge";
import { plural } from "../../lib/names";
import { closeModal, ModalFrame, openModal } from "../../overlays";
import { sets, themes } from "../../store";

export function openImportModal(): void {
  openModal(<ImportModal />, { wide: true });
}

type Parsed = { ok: true; data: unknown } | { ok: false; error: string } | null;

function parseJson(text: string): Parsed {
  if (!text.trim()) return null;
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: `Not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function ImportModal() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<Parsed>(null);
  const [forceMultiSet, setForceMultiSet] = useState(false);
  const [setName, setSetName] = useState("imported");
  const [mode, setMode] = useState<"skip" | "overwrite">("skip");
  const [withThemes, setWithThemes] = useState(true);

  const load = (raw: string, name: string | null) => {
    setParsed(parseJson(raw));
    setForceMultiSet(false);
    setSetName(setNameFromFileName(name ?? "imported"));
  };

  // Debounced parse of pasted text.
  const pasteTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(pasteTimer.current), []);

  const result = useMemo<{ result?: ImportResult; error?: string }>(() => {
    if (!parsed) return {};
    if (!parsed.ok) return { error: parsed.error };
    try {
      return { result: parseTokenFile(parsed.data, setName, forceMultiSet) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }, [parsed, setName, forceMultiSet]);

  const existingSets = sets.value;
  const r = result.result;
  const total = r ? r.sets.reduce((n, s) => n + s.tokens.length, 0) : 0;
  const newThemes = r ? r.themes.filter((t) => !themes.value.some((x) => x.group === t.group && x.name === t.name)) : [];
  let overlapping = 0;
  const rows = (r?.sets ?? []).map((s) => {
    const existing = existingSets.find((x) => x.name === s.name);
    const names = new Set(existing?.tokens.map((t) => t.name));
    const common = s.tokens.filter((t) => names.has(t.name)).length;
    overlapping += common;
    return {
      name: s.name,
      tokens: s.tokens.length,
      status: !existing ? "new set" : common > 0 ? `exists · ${common} with the same name` : "exists",
    };
  });

  const doImport = () => {
    if (!r) return;
    const ops: Op[] = r.sets
      .filter((s) => s.tokens.length > 0 || !existingSets.some((x) => x.name === s.name))
      .map((s) => ({ op: "import-set", name: s.name, tokens: s.tokens, mode: overlapping > 0 ? mode : "skip" }));
    if (withThemes) {
      for (const t of newThemes) ops.push({ op: "create-theme", group: t.group, name: t.name, setNames: t.setNames });
    }
    closeModal();
    void runOps(ops);
  };

  return (
    <ModalFrame
      title="Import tokens"
      footer={
        <>
          <button type="button" data-appearance="secondary" onClick={closeModal}>Cancel</button>
          <button
            type="button"
            data-appearance="primary"
            disabled={!r || (total === 0 && newThemes.length === 0)}
            onClick={doImport}
          >
            Import
          </button>
        </>
      }
    >
      <div class="import-source">
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          class="hidden"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            if (!file) return;
            void file.text().then((content) => {
              setFileName(file.name);
              setText(content);
              load(content, file.name);
            });
          }}
        />
        <button type="button" data-appearance="secondary" onClick={() => fileInput.current?.click()}>
          Choose JSON file
        </button>
        <span class="body-s import-file-name">{fileName ?? "or paste the JSON below"}</span>
      </div>
      <textarea
        class="input import-paste"
        spellcheck={false}
        placeholder='{ "color": { "primary": { "$value": "#0055ff", "$type": "color" } } }'
        aria-label="Token JSON"
        value={text}
        onInput={(e) => {
          const value = e.currentTarget.value;
          setText(value);
          clearTimeout(pasteTimer.current);
          pasteTimer.current = setTimeout(() => load(value, fileName), 300);
        }}
      />
      <p class="body-s modal-hint">
        Penpot / DTCG / Tokens Studio JSON. A file with <code>$themes</code> or <code>$metadata</code> holds
        several sets; otherwise it's one set.
      </p>

      {result.error && <p class="body-s modal-warning">{result.error}</p>}

      {r && (
        <div class="import-options">
          {r.ambiguous && (
            <label class="checkbox-container body-s">
              <input
                type="checkbox"
                class="checkbox-input"
                checked={forceMultiSet}
                onChange={(e) => setForceMultiSet(e.currentTarget.checked)}
              />
              <span>Top-level groups are sets</span>
            </label>
          )}
          {!r.multiSet && (
            <div class="form-field">
              <label class="form-label" for="import-set-name">Import into set</label>
              <input
                id="import-set-name"
                type="text"
                class="input form-input"
                autocomplete="off"
                value={setName}
                onInput={(e) => setSetName(e.currentTarget.value)}
              />
            </div>
          )}
        </div>
      )}

      {r && (
        <div class="import-summary">
          <ul class="import-sets">
            {rows.map((row) => (
              <li key={row.name} class="import-set-row body-s">
                <span>{row.name}</span>
                <span class="import-set-meta">{plural(row.tokens, "token")} · {row.status}</span>
              </li>
            ))}
          </ul>
          {overlapping > 0 && (
            <div class="form-field">
              <label class="form-label" for="import-mode">Tokens that already exist</label>
              <select
                id="import-mode"
                class="select"
                value={mode}
                onChange={(e) => setMode(e.currentTarget.value === "overwrite" ? "overwrite" : "skip")}
              >
                <option value="skip">Keep the existing ones</option>
                <option value="overwrite">Replace them with the imported ones</option>
              </select>
            </div>
          )}
          {r.themes.length > 0 && (
            <label class="checkbox-container body-s">
              <input
                type="checkbox"
                class="checkbox-input"
                checked={withThemes && newThemes.length > 0}
                disabled={newThemes.length === 0}
                onChange={(e) => setWithThemes(e.currentTarget.checked)}
              />
              <span>
                Import {plural(newThemes.length, "theme")}
                {r.themes.length > newThemes.length && ` (${r.themes.length - newThemes.length} already exist and are kept)`}
              </span>
            </label>
          )}
          {r.warnings.length > 0 && (
            <div class="body-s modal-warning">{r.warnings.map((w, i) => <div key={i}>{w}</div>)}</div>
          )}
        </div>
      )}
    </ModalFrame>
  );
}
