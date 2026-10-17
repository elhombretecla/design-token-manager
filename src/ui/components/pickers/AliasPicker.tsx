/**
 * ui/components/pickers/AliasPicker.tsx
 *
 * Token picker for alias references: a searchable list of the tokens of one
 * type, grouped by set. Used inline by the alias editor and as a popover
 * next to value inputs in the token editor.
 */

import { useEffect, useRef, useState } from "preact/hooks";
import { TypeIcon, Icon } from "../../icons";
import { useAnchoredPosition, useEscape, useOutsideClick } from "../../overlays";
import { pickerSetsFor } from "../../store";
import { ColorSwatch } from "../cells";

export function AliasPickerList(props: { tokenType: string; onPick(name: string): void; autoFocus?: boolean }) {
  const { tokenType, onPick, autoFocus } = props;
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) searchRef.current?.focus();
  }, []);

  const q = query.toLowerCase();
  const groups = pickerSetsFor(tokenType)
    .map((s) => {
      const sorted = [...s.tokens].sort((a, b) => a.name.localeCompare(b.name));
      return { ...s, tokens: q ? sorted.filter((t) => t.name.toLowerCase().includes(q)) : sorted };
    })
    .filter((s) => s.tokens.length > 0);

  const toggle = (setId: string) => {
    const next = new Set(collapsed);
    if (next.has(setId)) next.delete(setId); else next.add(setId);
    setCollapsed(next);
  };

  const items = () => [...(listRef.current?.querySelectorAll<HTMLElement>(".alias-picker-item") ?? [])];

  const onListKey = (e: KeyboardEvent) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") { e.preventDefault(); list[Math.min(i + 1, list.length - 1)]?.focus(); }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (i <= 0) searchRef.current?.focus();
      else list[i - 1]?.focus();
    }
  };

  return (
    <>
      <div class="alias-picker-search-row">
        <input
          class="alias-picker-search"
          type="text"
          value={query}
          placeholder="Search tokens…"
          spellcheck={false}
          autocomplete="off"
          aria-label="Search tokens"
          ref={searchRef}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); items()[0]?.focus(); }
            if (e.key === "Enter") {
              e.preventDefault();
              const first = groups.find((g) => !collapsed.has(g.setId))?.tokens[0];
              if (first) onPick(first.name);
            }
          }}
        />
      </div>
      <div class="alias-picker-list" role="listbox" aria-label="Tokens" ref={listRef} onKeyDown={onListKey}>
        {groups.length === 0 && <div class="alias-picker-empty">No tokens found</div>}
        {groups.map((s) => {
          const isCollapsed = collapsed.has(s.setId);
          return (
            <div key={s.setId} class="alias-picker-group">
              <div
                class="alias-picker-group-label"
                role="button"
                tabIndex={0}
                aria-expanded={!isCollapsed}
                onClick={() => toggle(s.setId)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(s.setId); }
                }}
              >
                <Icon name={isCollapsed ? "chevronRight" : "chevronDown"} />
                <span>{s.setName}</span>
              </div>
              {!isCollapsed && s.tokens.map((t) => (
                <div
                  key={t.id}
                  class="alias-picker-item"
                  role="option"
                  aria-selected="false"
                  tabIndex={-1}
                  onClick={() => onPick(t.name)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(t.name); }
                  }}
                >
                  <span class="alias-picker-item-name">{t.name}</span>
                  {t.type === "color" && t.resolvedValue
                    ? <ColorSwatch color={t.resolvedValue} />
                    : <span class="alias-picker-item-icon"><TypeIcon type={t.type} /></span>}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}

export function AliasPickerPopover(props: {
  tokenType: string;
  anchor: HTMLElement;
  onPick(name: string): void;
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<Element | null>(props.anchor);
  anchorRef.current = props.anchor;
  useAnchoredPosition(props.anchor, ref, { width: 280, align: "end" });
  useEscape(props.onClose);
  useOutsideClick([ref, anchorRef], props.onClose);
  return (
    <div ref={ref} class="modal-alias-picker">
      <AliasPickerList tokenType={props.tokenType} onPick={props.onPick} autoFocus />
    </div>
  );
}

/**
 * The alias-insert button next to a value input; picking a token calls
 * `onPick` with the token name.
 */
export function AliasTrigger(props: { tokenType: string; onPick(name: string): void; label?: string }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const label = props.label ?? "Insert alias reference";
  return (
    <>
      <button
        type="button"
        class="icon-btn value-alias-trigger"
        title={label}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={anchor !== null}
        onClick={(e) => {
          e.stopPropagation();
          setAnchor(anchor ? null : (e.currentTarget as HTMLElement));
        }}
      >
        <Icon name="aliasInsert" />
      </button>
      {anchor && (
        <AliasPickerPopover
          tokenType={props.tokenType}
          anchor={anchor}
          onPick={(name) => {
            setAnchor(null);
            props.onPick(name);
          }}
          onClose={() => setAnchor(null)}
        />
      )}
    </>
  );
}
