/**
 * ui/components/modals/ExportModal.tsx
 *
 * Export tokens as JSON in Penpot's format: all sets with themes, or one
 * set as a plain DTCG file. Download (needs the allow:downloads permission)
 * or copy to the clipboard.
 */

import { useMemo, useState } from "preact/hooks";
import { exportMultiSet, exportSingleSet } from "../../../shared/dtcg";
import { showToast } from "../../bridge";
import { plural } from "../../lib/names";
import { ModalFrame, openModal } from "../../overlays";
import { sets, snapshot, snapshotSet } from "../../store";

export function openExportModal(preferSetId: string | null = null): void {
  if (sets.value.length === 0) {
    showToast("There are no tokens to export yet");
    return;
  }
  openModal(<ExportModal preferSetId={preferSetId} />, { wide: true });
}

function downloadText(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API blocked (no clipboard permission): legacy fallback.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

function ExportModal({ preferSetId }: { preferSetId: string | null }) {
  const all = sets.value;
  const initialSet = preferSetId && snapshotSet(preferSetId) ? preferSetId : all[0]?.id ?? "";
  const [scope, setScope] = useState<"all" | "set">(preferSetId ? "set" : "all");
  const [setId, setSetId] = useState(initialSet);

  const snap = snapshot.value;
  const { text, fileName, warnings } = useMemo(() => {
    const set = snap.sets.find((s) => s.id === setId);
    const single = scope === "set" && set;
    const result = single ? exportSingleSet(set) : exportMultiSet(snap);
    return {
      text: JSON.stringify(result.data, null, 2),
      fileName: single ? `${set.name.replace(/\//g, "-")}.json` : "tokens.json",
      warnings: result.warnings,
    };
  }, [snap, scope, setId]);

  return (
    <ModalFrame
      title="Export tokens"
      footer={
        <>
          <button
            type="button"
            data-appearance="secondary"
            onClick={() => void copyText(text).then((ok) =>
              showToast(ok ? "Copied to the clipboard" : "Couldn't copy; select the text and copy it", ok ? "info" : "error"))}
          >
            Copy
          </button>
          <button type="button" data-appearance="primary" onClick={() => downloadText(fileName, text)}>Download</button>
        </>
      }
    >
      <div class="export-scope" role="radiogroup" aria-label="What to export">
        <label class="radio-container">
          <input type="radio" class="radio-input" name="export-scope" checked={scope === "all"} onChange={() => setScope("all")} />
          <span class="radio-label body-s">All sets, with themes ({plural(all.length, "set")})</span>
        </label>
        <label class="radio-container">
          <input type="radio" class="radio-input" name="export-scope" checked={scope === "set"} onChange={() => setScope("set")} />
          <span class="radio-label body-s">One set</span>
        </label>
        <select
          class="select export-set-select"
          aria-label="Set to export"
          disabled={scope !== "set"}
          value={setId}
          onChange={(e) => setSetId(e.currentTarget.value)}
        >
          {all.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <p class="body-s modal-hint">
        Same JSON format Penpot uses (DTCG / Tokens Studio), so the file can be imported back into Penpot or
        other tools.
      </p>
      {warnings.length > 0 && (
        <div class="body-s modal-warning">{warnings.map((w, i) => <div key={i}>{w}</div>)}</div>
      )}
      <textarea class="input export-preview" readOnly spellcheck={false} aria-label="Exported JSON" value={text} />
    </ModalFrame>
  );
}
