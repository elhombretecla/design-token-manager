/**
 * ui/components/pickers/FontPicker.tsx
 *
 * Font family input with a searchable dropdown: "Document Fonts" (scanned
 * live from the current page) and the bundled font catalog. Any typed name
 * is accepted, listed or not.
 */

import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { FONT_CATALOG } from "../../../assets/fontCatalog.generated";
import { requestDocumentFonts } from "../../bridge";
import { Icon } from "../../icons";
import { useAnchoredPosition, useEscape, useOutsideClick } from "../../overlays";
import { documentFonts } from "../../store";

const CATALOG_FAMILIES: string[] = FONT_CATALOG.map((f) => f.family);

// Rows shown without a query; typing searches the whole catalog.
const CATALOG_MAX_UNFILTERED = 200;

export function FontFamilyInput(props: {
  id: string;
  value: string;
  onInput(v: string): void;
  placeholder?: string;
  class?: string;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const query = props.value.toLowerCase().trim();
  const docFonts = query ? documentFonts.value.filter((f) => f.toLowerCase().includes(query)) : documentFonts.value;
  const docSet = new Set(documentFonts.value);
  const catalogBase = CATALOG_FAMILIES.filter((f) => !docSet.has(f));
  const catalog = query
    ? catalogBase.filter((f) => f.toLowerCase().includes(query))
    : catalogBase.slice(0, CATALOG_MAX_UNFILTERED);
  const truncated = !query && catalogBase.length > CATALOG_MAX_UNFILTERED;
  const options = [...docFonts, ...catalog];

  const show = () => {
    if (open) return;
    requestDocumentFonts();
    setHighlight(-1);
    setOpen(true);
  };
  const close = () => setOpen(false);
  const pick = (font: string) => {
    props.onInput(font);
    close();
    inputRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) show();
      setHighlight((h) => Math.min(h + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && open) {
      // Enter keeps the typed text unless an option is highlighted; it
      // doesn't submit the form while the dropdown is open.
      e.preventDefault();
      e.stopPropagation();
      if (highlight >= 0 && options[highlight]) pick(options[highlight]);
      else close();
    }
  };

  const listId = `${props.id}-fonts`;
  const item = (font: string, index: number) => (
    <div
      key={font}
      id={`${listId}-${index}`}
      class={`fp-item${index === highlight ? " is-highlighted" : ""}`}
      role="option"
      aria-selected={index === highlight}
      onMouseDown={(e) => {
        e.preventDefault();
        pick(font);
      }}
    >
      {font}
    </div>
  );

  return (
    <div class="fp-input-wrap" ref={wrapRef}>
      <input
        ref={inputRef}
        type="text"
        id={props.id}
        class={`input form-input has-fp-chevron${props.class ? ` ${props.class}` : ""}`}
        value={props.value}
        placeholder={props.placeholder}
        autocomplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={open && highlight >= 0 ? `${listId}-${highlight}` : undefined}
        onClick={show}
        onInput={(e) => {
          props.onInput((e.target as HTMLInputElement).value);
          setHighlight(-1);
          if (!open) show();
        }}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        class="icon-btn fp-chevron-btn"
        title="Browse fonts"
        aria-label="Browse fonts"
        tabIndex={-1}
        onClick={() => (open ? close() : (show(), inputRef.current?.focus()))}
      >
        <Icon name="chevDown12" />
      </button>
      {open && wrapRef.current && (
        <FontDropdown anchor={wrapRef.current} listId={listId} onClose={close}>
          {options.length === 0 && <div class="fp-empty">No fonts match</div>}
          {docFonts.length > 0 && <div class="fp-section-header">Document Fonts</div>}
          {docFonts.map((f, i) => item(f, i))}
          {docFonts.length > 0 && catalog.length > 0 && <div class="fp-divider" />}
          {catalog.length > 0 && <div class="fp-section-header">Fonts</div>}
          {catalog.map((f, i) => item(f, docFonts.length + i))}
          {truncated && (
            <div class="fp-hint">Showing {CATALOG_MAX_UNFILTERED} of {catalogBase.length} — type to search all</div>
          )}
        </FontDropdown>
      )}
    </div>
  );
}

function FontDropdown(props: { anchor: HTMLElement; listId: string; onClose(): void; children: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<Element | null>(props.anchor);
  useAnchoredPosition(props.anchor, ref, { width: Math.max(props.anchor.getBoundingClientRect().width, 220) });
  useEscape(props.onClose);
  useOutsideClick([ref, anchorRef], props.onClose);

  // Keep the highlighted option visible while moving with the arrows.
  useLayoutEffect(() => {
    ref.current?.querySelector<HTMLElement>(".fp-item.is-highlighted")?.scrollIntoView({ block: "nearest" });
  });

  return (
    <div ref={ref} id={props.listId} class="fp-dropdown" role="listbox" aria-label="Fonts">
      {props.children}
    </div>
  );
}
