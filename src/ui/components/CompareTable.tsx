/**
 * ui/components/CompareTable.tsx
 *
 * Side-by-side comparison of the open set with other sets or themes.
 * Rows are the union of token names: the primary set's tokens first (in the
 * table's sort order), then names that only exist in compared columns.
 * A theme column shows, for each name, the token that wins in that theme.
 */

import type { SerializedToken } from "../../shared/types";
import { Icon } from "../icons";
import { openMenuAt, type MenuItem } from "../overlays";
import {
  addCompareColumn,
  compare,
  removeCompareColumn,
  sets,
  snapshotSet,
  sortDir,
  sortKey,
  themeResolver,
  themes,
  toViewToken,
  viewTokensForSet,
  type CompareColumn,
} from "../store";
import { ResolvedCell, ValueCell } from "./cells";

function sortTokens(tokens: SerializedToken[]): SerializedToken[] {
  const key = sortKey.value;
  if (!key) return tokens;
  const dir = sortDir.value === "asc" ? 1 : -1;
  const pick = (t: SerializedToken) =>
    ((key === "resolvedValue" ? t.resolvedValue ?? t.value : t[key]) ?? "").toLowerCase();
  return [...tokens].sort((a, b) => {
    const av = pick(a);
    const bv = pick(b);
    return av < bv ? -dir : av > bv ? dir : 0;
  });
}

function columnLabel(col: CompareColumn): string {
  if (col.kind === "set") return `Value (${snapshotSet(col.id)?.name ?? col.id})`;
  const theme = themes.value.find((t) => t.id === col.id);
  const name = theme ? (theme.group ? `${theme.group} / ${theme.name}` : theme.name) : col.id;
  return `Value (Theme: ${name})`;
}

/** Name → view token for one compared column. */
function columnTokens(col: CompareColumn, names: string[]): Map<string, SerializedToken> {
  if (col.kind === "set") return new Map(viewTokensForSet(col.id).map((t) => [t.name, t]));
  const resolver = themeResolver(col.id);
  const map = new Map<string, SerializedToken>();
  for (const name of names) {
    const token = resolver.winner(name);
    if (token) map.set(name, toViewToken(token, resolver));
  }
  return map;
}

const compareKey = (t: SerializedToken) => t.resolvedValue ?? t.value;

function Cell(props: { token: SerializedToken | undefined; diff: boolean; missing?: string }) {
  const { token, diff, missing = "Not in this set" } = props;
  if (!token) return <div class="cmp-td cmp-td-missing" role="cell">{missing}</div>;
  const showResolved =
    token.resolveStatus !== "ok" || (token.resolvedValue !== undefined && token.resolvedValue !== token.value);
  return (
    <div class={`cmp-td${diff ? " cmp-td--diff" : ""}`} role="cell">
      <div class="col-value-inner"><ValueCell token={token} /></div>
      {showResolved && <div class="cmp-resolved"><ResolvedCell token={token} /></div>}
    </div>
  );
}

export function CompareTable() {
  const c = compare.value;
  if (!c) return null;
  const { primarySetId, columns } = c;

  const primaryTokens = sortTokens(viewTokensForSet(primarySetId));
  const primaryByName = new Map(primaryTokens.map((t) => [t.name, t]));

  // Theme columns are looked up by name, so set columns define the extra names.
  const setMaps = new Map(columns.filter((col) => col.kind === "set").map((col) => [col.id, columnTokens(col, [])]));
  const extra = new Set<string>();
  for (const map of setMaps.values()) for (const name of map.keys()) if (!primaryByName.has(name)) extra.add(name);
  const names = [...primaryTokens.map((t) => t.name), ...[...extra].sort()];
  const maps = columns.map((col) => (col.kind === "set" ? setMaps.get(col.id)! : columnTokens(col, names)));

  const isCompared = (kind: CompareColumn["kind"], id: string) => columns.some((x) => x.kind === kind && x.id === id);
  const addableSets = sets.value.filter((s) => s.id !== primarySetId && !isCompared("set", s.id));
  const addableThemes = themes.value.filter((t) => !isCompared("theme", t.id));
  const canAdd = addableSets.length + addableThemes.length > 0;

  const openAddMenu = (anchor: Element) => {
    const items: MenuItem[] = [
      ...addableSets.map((s) => ({
        label: s.name,
        icon: <Icon name="set" />,
        action: () => addCompareColumn({ kind: "set", id: s.id }),
      })),
      ...addableThemes.map((t, i) => ({
        label: `Theme: ${t.group ? `${t.group} / ${t.name}` : t.name}`,
        icon: <Icon name="gear" />,
        divider: i === 0 && addableSets.length > 0,
        action: () => addCompareColumn({ kind: "theme", id: t.id }),
      })),
    ];
    openMenuAt(anchor, items);
  };

  const template = `170px repeat(${1 + columns.length}, minmax(120px, 1fr)) 110px`;

  return (
    <div class="compare-table-wrap" role="table" aria-label="Token comparison" style={`--cmp-col-template: ${template}`}>
      <div class="compare-table-header" role="row">
        <div class="cmp-th cmp-th-name body-s" role="columnheader">Name</div>
        <div class="cmp-th cmp-th-primary body-s" role="columnheader">
          <span class="th-label">Value</span>
        </div>
        {columns.map((col) => {
          const label = columnLabel(col);
          return (
            <div key={`${col.kind}:${col.id}`} class="cmp-th cmp-th-compared" role="columnheader">
              <span class="th-label" title={label}>{label}</span>
              <button
                type="button"
                class="cmp-col-remove-btn icon-btn"
                title={`Remove ${label}`}
                aria-label={`Remove column ${label}`}
                onClick={() => removeCompareColumn(col)}
              >
                <Icon name="close10" />
              </button>
            </div>
          );
        })}
        <div class="cmp-th cmp-th-add" role="columnheader">
          <button
            type="button"
            class="cmp-add-set-btn"
            disabled={!canAdd}
            title={canAdd ? "Add a set or theme to compare" : "Nothing else to compare"}
            aria-haspopup="menu"
            onClick={(e) => openAddMenu(e.currentTarget)}
          >
            + Add
          </button>
        </div>
      </div>
      <div class="compare-table-body" role="rowgroup">
        {names.length === 0 && <div class="empty-state-msg body-s">No tokens yet.</div>}
        {names.map((name) => {
          const primary = primaryByName.get(name);
          const compared = maps.map((m) => m.get(name));
          const baseKey = primary ? compareKey(primary) : undefined;
          const cellDiff = compared.map((t) => !t || !primary || compareKey(t) !== baseKey);
          const rowDiff = !primary || cellDiff.some(Boolean);
          return (
            <div key={name} class={`cmp-row${rowDiff ? " cmp-row--diff" : ""}`} role="row">
              <div class="cmp-td cmp-td-name" role="rowheader">
                <span class="col-name-text" title={name}>{name}</span>
              </div>
              <Cell token={primary} diff={false} />
              {compared.map((t, i) => (
                <Cell
                  key={i}
                  token={t}
                  diff={cellDiff[i]}
                  missing={columns[i].kind === "theme" ? "Not in this theme" : undefined}
                />
              ))}
              <div class="cmp-td" role="cell" />
            </div>
          );
        })}
      </div>
    </div>
  );
}
