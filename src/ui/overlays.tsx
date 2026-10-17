/**
 * ui/overlays.tsx
 *
 * Layered UI: one modal at a time, a context menu, toasts, and an Escape
 * stack so Escape closes only the topmost layer (popover → menu → modal).
 *
 *   openModal(<SomeModal />, { wide })  /  closeModal()
 *   openContextMenu(x, y, items)
 *   useEscape(onClose)  — register a layer while a component is mounted
 */

import { signal } from "@preact/signals";
import { Fragment, type ComponentChildren, type JSX, type VNode } from "preact";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { toasts } from "./bridge";

// ── Escape stack ─────────────────────────────────────────────────────────

const escapeStack: { current: () => void }[] = [];

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || escapeStack.length === 0) return;
  e.preventDefault();
  e.stopPropagation();
  escapeStack[escapeStack.length - 1].current();
});

/** Close this layer on Escape while mounted (and `active`). */
export function useEscape(onClose: () => void, active = true): void {
  const handler = useRef(onClose);
  handler.current = onClose;
  useEffect(() => {
    if (!active) return;
    const entry = { current: () => handler.current() };
    escapeStack.push(entry);
    return () => {
      const i = escapeStack.indexOf(entry);
      if (i >= 0) escapeStack.splice(i, 1);
    };
  }, [active]);
}

/** Close when a mousedown lands outside every element in `refs`. */
export function useOutsideClick(refs: { current: Element | null }[], onClose: () => void, active = true): void {
  const handler = useRef(onClose);
  handler.current = onClose;
  useEffect(() => {
    if (!active) return;
    const listener = (e: MouseEvent) => {
      const t = e.target as Node;
      if (refs.every((r) => !r.current?.contains(t))) handler.current();
    };
    // Defer so the click that opened the layer doesn't close it.
    const id = setTimeout(() => document.addEventListener("mousedown", listener, true), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("mousedown", listener, true);
    };
  }, [active]);
}

// ── Anchored positioning ─────────────────────────────────────────────────

/**
 * Position a fixed element below `anchor` (flipping above when there's no
 * room), keeping it inside the viewport.
 */
export function useAnchoredPosition(
  anchor: Element | null,
  popover: { current: HTMLElement | null },
  opts: { width?: number; align?: "start" | "end"; gap?: number } = {},
): void {
  useLayoutEffect(() => {
    const el = popover.current;
    if (!anchor || !el) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const gap = opts.gap ?? 4;
      const width = opts.width ?? Math.max(r.width, el.offsetWidth);
      if (opts.width) el.style.width = `${width}px`;
      let left = opts.align === "end" ? r.right - width : r.left;
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      let top = r.bottom + gap;
      const h = el.offsetHeight;
      if (top + h > window.innerHeight - 8 && r.top - gap - h > 8) top = r.top - gap - h;
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  });
}

// ── Focus trap ───────────────────────────────────────────────────────────

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
}

function trapTab(e: KeyboardEvent, root: HTMLElement): void {
  if (e.key !== "Tab") return;
  const items = focusables(root);
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

// ── Modal ────────────────────────────────────────────────────────────────

interface ModalState {
  node: VNode;
  wide: boolean;
  key: number;
}

const modal = signal<ModalState | null>(null);
let modalKey = 0;

export function openModal(node: VNode, opts: { wide?: boolean } = {}): void {
  modal.value = { node, wide: opts.wide ?? false, key: ++modalKey };
}

export function closeModal(): void {
  modal.value = null;
}

function ModalLayer({ state }: { state: ModalState }) {
  const ref = useRef<HTMLDivElement>(null);
  useEscape(closeModal);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    // Focus the [data-autofocus] element, else the first field or control.
    const id = setTimeout(() => {
      const root = ref.current;
      if (!root || root.contains(document.activeElement)) return;
      const field = root.querySelector<HTMLElement>("[data-autofocus]")
        ?? root.querySelector<HTMLElement>("input:not([type=hidden]):not([disabled]), select, textarea");
      (field ?? focusables(root)[0])?.focus();
    }, 30);
    return () => {
      clearTimeout(id);
      previous?.focus?.();
    };
  }, []);

  return (
    <div
      class="modal-overlay"
      role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget) closeModal(); }}
    >
      <div
        ref={ref}
        class={`modal${state.wide ? " modal--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        onKeyDown={(e) => ref.current && trapTab(e, ref.current)}
      >
        {state.node}
      </div>
    </div>
  );
}

export function ModalHost() {
  const state = modal.value;
  return state ? <ModalLayer key={state.key} state={state} /> : null;
}

/** Standard modal layout: header with title + close, body, optional footer. */
export function ModalFrame(props: {
  title: ComponentChildren;
  children: ComponentChildren;
  footer?: ComponentChildren;
  bodyClass?: string;
}) {
  return (
    <>
      <div class="modal-header">
        <h2 class="modal-title">{props.title}</h2>
        <CloseButton onClick={closeModal} />
      </div>
      <div class={`modal-body${props.bodyClass ? ` ${props.bodyClass}` : ""}`}>{props.children}</div>
      {props.footer && <div class="modal-footer">{props.footer}</div>}
    </>
  );
}

export function CloseButton({ onClick, label = "Close" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" class="icon-btn" onClick={onClick} title={label} aria-label={label}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M4 4 12 12M12 4 4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
    </button>
  );
}

// ── Context menu ─────────────────────────────────────────────────────────

export interface MenuItem {
  label: string;
  icon?: JSX.Element;
  action: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Render a separator line before this item. */
  divider?: boolean;
}

const menu = signal<{ x: number; y: number; items: MenuItem[]; key: number } | null>(null);
let menuKey = 0;

export function openContextMenu(x: number, y: number, items: MenuItem[]): void {
  menu.value = { x, y, items, key: ++menuKey };
}

export function closeContextMenu(): void {
  menu.value = null;
}

/** Open a menu below a button (keyboard-friendly alternative to x/y). */
export function openMenuAt(anchor: Element, items: MenuItem[]): void {
  const r = anchor.getBoundingClientRect();
  openContextMenu(r.left, r.bottom + 4, items);
}

function ContextMenuLayer({ x, y, items }: { x: number; y: number; items: MenuItem[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef(document.activeElement as HTMLElement | null);
  useEscape(closeContextMenu);
  useOutsideClick([ref], closeContextMenu);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.left = `${Math.max(4, Math.min(x, window.innerWidth - el.offsetWidth - 4))}px`;
    el.style.top = `${Math.max(4, Math.min(y, window.innerHeight - el.offsetHeight - 4))}px`;
    el.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
    const prev = previous.current;
    return () => prev?.focus?.();
  }, []);

  const move = (e: KeyboardEvent) => {
    const list = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    if (e.key === "Home") { e.preventDefault(); list[0]?.focus(); }
    if (e.key === "End") { e.preventDefault(); list[list.length - 1]?.focus(); }
    if (e.key === "Tab") { e.preventDefault(); closeContextMenu(); }
  };

  return (
    <div ref={ref} class="context-menu" role="menu" onKeyDown={move}>
      {items.map((item, i) => (
        <Fragment key={i}>
          {item.divider && <div class="context-menu-divider" aria-hidden="true" />}
          <div
            class={`context-menu-item${item.danger ? " danger" : ""}${item.disabled ? " is-disabled" : ""}`}
            role="menuitem"
            tabIndex={-1}
            aria-disabled={item.disabled ? "true" : undefined}
            onClick={() => {
              if (item.disabled) return;
              closeContextMenu();
              item.action();
            }}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && !item.disabled) {
                e.preventDefault();
                closeContextMenu();
                item.action();
              }
            }}
          >
            {item.icon}
            <span>{item.label}</span>
          </div>
        </Fragment>
      ))}
    </div>
  );
}

export function ContextMenuHost() {
  const m = menu.value;
  return m ? <ContextMenuLayer key={m.key} x={m.x} y={m.y} items={m.items} /> : null;
}

// ── Toasts ───────────────────────────────────────────────────────────────

export function Toasts() {
  return (
    <div class="toast-region" role="status" aria-live="polite">
      {toasts.value.map((t) => (
        <div key={t.id} class={`toast toast--${t.kind} body-s`}>{t.message}</div>
      ))}
    </div>
  );
}
