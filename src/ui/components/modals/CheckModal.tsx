/**
 * ui/components/modals/CheckModal.tsx
 *
 * Token values that don't resolve (each set viewed on top of the active
 * sets), tokens applied on the current page that no active set defines,
 * and Penpot's own file integrity check.
 */

import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import type { CatalogSnapshot, SnapshotSet, SnapshotToken, ValidationReport } from "../../../shared/protocol";
import { Resolver } from "../../../shared/resolver";
import { requestValidation, runOps } from "../../bridge";
import { plural } from "../../lib/names";
import { closeModal, ModalFrame, openModal } from "../../overlays";
import { locateTokenName, revealToken, snapshot } from "../../store";

export function openCheckModal(): void {
  openModal(<CheckModal />, { wide: true });
}

const LIST_MAX = 100;

interface TokenIssue {
  set: SnapshotSet;
  token: SnapshotToken;
  problem: string;
}

function collectTokenIssues(snap: CatalogSnapshot): TokenIssue[] {
  const issues: TokenIssue[] = [];
  for (const set of snap.sets) {
    const resolver = Resolver.forContext(snap, { kind: "set-on-top", setId: set.id });
    for (const token of set.tokens) {
      const r = resolver.resolveToken(token);
      if (r.status === "ok") continue;
      const problem =
        r.status === "broken" ? `Missing ${r.missing.map((m) => `{${m}}`).join(", ")}`
        : r.status === "cycle" ? "Circular reference"
        : r.error ?? "Invalid value";
      issues.push({ set, token, problem });
    }
  }
  return issues;
}

function Section({ title, count, children }: { title: string; count: number | null; children: ComponentChildren }) {
  return (
    <section class="check-section">
      <h3 class="check-title body-s">
        {title}
        {count !== null && <span class={`check-count${count > 0 ? " check-count--bad" : ""}`}>{count}</span>}
      </h3>
      {children}
    </section>
  );
}

function SelectShapesButton({ shapeIds, pageId, label }: { shapeIds: string[]; pageId: string | null; label: string }) {
  return (
    <button
      type="button"
      class="check-action"
      onClick={() => void runOps([{ op: "select-shapes", shapeIds, pageId: pageId || undefined }])}
    >
      {label}
    </button>
  );
}

function TokenIssues({ issues }: { issues: TokenIssue[] }) {
  if (issues.length === 0) return <p class="body-s check-ok">Every token resolves.</p>;
  return (
    <>
      <ul class="check-list">
        {issues.slice(0, LIST_MAX).map((i) => (
          <li key={i.token.id} class="check-item">
            <button
              type="button"
              class="check-link"
              onClick={() => {
                closeModal();
                revealToken(i.set.id, i.token.id);
              }}
            >
              <span class="check-set">{i.set.name} /</span> {i.token.name}
            </button>
            <span class="check-problem body-s">{i.problem}</span>
          </li>
        ))}
      </ul>
      {issues.length > LIST_MAX && <p class="body-s modal-hint">…and {issues.length - LIST_MAX} more</p>}
    </>
  );
}

function AppliedIssues({ report }: { report: ValidationReport }) {
  const rows = report.applied
    .map((a) => ({ ...a, loc: locateTokenName(a.name) }))
    .filter((a) => !a.loc || !a.loc.active);
  return (
    <Section title={`Applied tokens on page "${report.pageName}"`} count={rows.length}>
      {rows.length === 0 ? (
        <p class="body-s check-ok">
          {report.applied.length === 0
            ? "No tokens are applied on this page."
            : `All ${plural(report.applied.length, "applied token")} resolve with the active sets.`}
        </p>
      ) : (
        <ul class="check-list">
          {rows.map((a) => (
            <li key={a.name} class="check-item">
              <span class="check-name">{a.name}</span>
              <span class="check-problem body-s">
                {a.loc ? `Only in inactive sets ("${a.loc.set.name}")` : "No set defines this token"}
              </span>
              <SelectShapesButton
                shapeIds={a.shapeIds}
                pageId={report.pageId}
                label={`Select ${plural(a.shapeIds.length, "shape")}`}
              />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function FileIssues({ report }: { report: ValidationReport }) {
  return (
    <Section title="File integrity" count={report.validateAvailable ? report.fileIssues.length : null}>
      {!report.validateAvailable ? (
        <p class="body-s modal-hint">This version of Penpot can't validate files from plugins.</p>
      ) : report.fileIssues.length === 0 ? (
        <p class="body-s check-ok">No integrity errors found.</p>
      ) : (
        <ul class="check-list">
          {report.fileIssues.slice(0, LIST_MAX).map((i, idx) => (
            <li key={idx} class="check-item">
              <span class="check-name">{i.code}</span>
              <span class="check-problem body-s">{i.hint}</span>
              {i.shapeId && <SelectShapesButton shapeIds={[i.shapeId]} pageId={i.pageId} label="Select shape" />}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function CheckModal() {
  const snap = snapshot.value;
  const issues = useMemo(() => collectTokenIssues(snap), [snap]);
  const [report, setReport] = useState<ValidationReport | null>(null);

  useEffect(() => {
    let alive = true;
    void requestValidation().then((r) => { if (alive) setReport(r); });
    return () => { alive = false; };
  }, []);

  const loading = <p class="body-s modal-hint">Checking…</p>;

  return (
    <ModalFrame title="Check tokens" bodyClass="check-modal">
      <Section title="Token values" count={issues.length}>
        <TokenIssues issues={issues} />
      </Section>
      {report ? (
        <>
          <AppliedIssues report={report} />
          <FileIssues report={report} />
        </>
      ) : (
        <>
          <Section title="Applied tokens on this page" count={null}>{loading}</Section>
          <Section title="File integrity" count={null}>{loading}</Section>
        </>
      )}
    </ModalFrame>
  );
}
