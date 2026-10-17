/**
 * ui/icons.tsx
 *
 * SVG icons as Preact elements. The markup is kept as strings (one source of
 * truth, easy to diff with the original design) and rendered as a real
 * <svg> element whose children are set from the inner markup — no wrapper
 * element, so existing CSS that targets `svg` keeps working.
 */

import type { JSX } from "preact";

const ICON_MARKUP = {
  set: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 1.5L13.5 4.75V11.25L8 14.5L2.5 11.25V4.75Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M2.5 4.75L8 8L13.5 4.75" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 8V14.5" stroke="currentColor" stroke-width="1.3"/></svg>`,
  chevronRight: `<svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  chevronDown: `<svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  aliasGear: `<svg class="alias-chip-icon" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"> <path d="M4.75 2.37L11.25 2.37L14.5 8L11.25 13.63L4.75 13.63L1.5 8Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/> <circle cx="8" cy="8" r="1.2" fill="currentColor"/> </svg>`,
  aliasInsert: `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"> <path d="M4.75 2.37L11.25 2.37L14.5 8L11.25 13.63L4.75 13.63L1.5 8Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/> <circle cx="8" cy="8" r="1.2" fill="currentColor"/> </svg>`,
  chevDown12: `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  chevUp12: `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 10 4-4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  rename: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10.5 2.5 13.5 5.5 6 13H3v-3l7.5-7.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M9 4 12 7" stroke="currentColor" stroke-width="1.3"/></svg>`,
  duplicate: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="5" y="5" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M3 11V3h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  trash: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 5h10M6 5V3h4v2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 5 12 13H4L3 5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  edit: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10.5 2.5 13.5 5.5 6 13H3v-3l7.5-7.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`,
  move: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13 8H3M10 5l3 3-3 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  apply: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.3"/><path d="m5.5 8.25 1.75 1.75 3.25-3.75" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  target: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 3l4 10 1.5-4.5L13 7 3 3Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`,
  exportIcon: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3v7M5.5 7.5 8 10l2.5-2.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 11.5V13h10v-1.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  compare: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="1.5" y="3" width="5" height="10" rx="1" stroke="currentColor" stroke-width="1.3"/><rect x="9.5" y="3" width="5" height="10" rx="1" stroke="currentColor" stroke-width="1.3"/></svg>`,
  sidebarToggle: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M5.75 2.75v10.5" stroke="currentColor" stroke-width="1.3"/></svg>`,
  search: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.5"/><path d="m10.5 10.5 2.5 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  searchSmall: `<svg class="search-icon" width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.5"/><path d="m10.5 10.5 2.5 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  plus: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  dots: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="3.5" cy="8" r="1.2" fill="currentColor"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><circle cx="12.5" cy="8" r="1.2" fill="currentColor"/></svg>`,
  gear: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M14.33 6.54A6.5 6.5 0 0 1 14.33 9.46L12.62 9.91 13.51 11.45A6.5 6.5 0 0 1 11.45 13.51L9.91 12.62 9.46 14.33A6.5 6.5 0 0 1 6.54 14.33L6.09 12.62 4.55 13.51A6.5 6.5 0 0 1 2.49 11.45L3.38 9.91 1.67 9.46A6.5 6.5 0 0 1 1.67 6.54L3.38 6.09 2.49 4.55A6.5 6.5 0 0 1 4.55 2.49L6.09 3.38 6.54 1.67A6.5 6.5 0 0 1 9.46 1.67L9.91 3.38 11.45 2.49A6.5 6.5 0 0 1 13.51 4.55L12.62 6.09Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.3"/></svg>`,
  info: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.3"/><path d="M8 7.5v4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="4.75" r="0.85" fill="currentColor"/></svg>`,
  check: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.3"/><path d="m5.25 8.25 1.75 1.75 3.75-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  upload: `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 10.5V3.5M5.5 6 8 3.5 10.5 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 11.5v1.5h10v-1.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  download: `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3.5v7M5.5 8l2.5 2.5L10.5 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 11.5v1.5h10v-1.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  sortArrow: `<svg width="10" height="7" viewBox="0 0 10 7" fill="none"><path d="M1 1.5 5 5.5 9 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  close10: `<svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 4 12 12M12 4 4 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  setCard: `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 1.5L13.5 4.75V11.25L8 14.5L2.5 11.25V4.75Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M2.5 4.75L8 8L13.5 4.75" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 8V14.5" stroke="currentColor" stroke-width="1.3"/></svg>`,
  tokenCount: `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4.75 2.37L11.25 2.37L14.5 8L11.25 13.63L4.75 13.63L1.5 8Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/></svg>`,
  chevUpSmall: `<svg class="selection-bar-chevron" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 10 4-4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
} as const;

const TOKEN_TYPE_MARKUP: Record<string, string> = {
  borderRadius: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 9V5.5A2.5 2.5 0 0 1 5.5 3H9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-dasharray="2.5 1.8"/><path d="M13 7v3.5A2.5 2.5 0 0 1 10.5 13H7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-dasharray="2.5 1.8"/></svg>`,
  color: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 2C8 2 4 7 4 10a4 4 0 0 0 8 0C12 7 8 2 8 2Z" stroke="currentColor" stroke-width="1.3"/></svg>`,
  dimension: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M4 12L12 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M2.5 10.5L5.5 13.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M10.5 2.5L13.5 5.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
  fontFamilies: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 13.5L6.5 3L11 13.5M3.5 11H9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 8L13.5 4.5L15 8M12.4 7H14.6" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  fontSizes: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M4 2.5V13.5M2.5 4L4 2.5L5.5 4M2.5 12L4 13.5L5.5 12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 13.5L11 5.5L14 13.5M9 11H13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  fontWeights: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M5 3V13M5 3H9.5a2.5 2.5 0 0 1 0 5H5M5 8H10a3 3 0 0 1 0 6H5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  letterSpacing: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 9.5L5 3L8 9.5M3 7.5H7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 3L11.5 9.5L14 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M1.5 13H14.5M3.5 11.5L1.5 13L3.5 14.5M12.5 11.5L14.5 13L12.5 14.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  number: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3.5 5L2.5 6V12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 6.5a1.5 1.5 0 0 1 3 0C9 7.8 6 9.2 6 10.5H9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 6.5a1.5 1.5 0 0 1 3 0C14 8 11.5 8 11.5 8.5S14 9 14 10.5a1.5 1.5 0 0 1-3 0" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`,
  opacity: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="5.5" cy="5.5" r="2" stroke="currentColor" stroke-width="1.3"/><circle cx="10.5" cy="10.5" r="2" stroke="currentColor" stroke-width="1.3"/><path d="M13 3L3 13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
  rotation: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 3V13H13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 9.5A6.5 6.5 0 0 1 9.5 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
  shadow: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.2" stroke-dasharray="1.8 1.5"/></svg>`,
  sizing: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M4 12L12 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M2.5 10.5L5.5 13.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M10.5 2.5L13.5 5.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
  spacing: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="4.5" y="5" width="7" height="6" rx="1" stroke="currentColor" stroke-width="1.3"/><path d="M1.5 5V11M1.5 8H4.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M14.5 5V11M14.5 8H11.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
  borderWidth: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 5H14" stroke="currentColor" stroke-width="1" stroke-linecap="round"/><path d="M2 8.5H14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M2 12.5H14" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/></svg>`,
  textCase: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M1.5 13L5.5 4.5L9.5 13M2.8 10.5H8.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12.5" cy="11" r="2" stroke="currentColor" stroke-width="1.2"/><path d="M14.5 9V13" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`,
  textDecoration: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M5 3V9.5a3 3 0 0 0 6 0V3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M3 14H13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  typography: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2.5" stroke="currentColor" stroke-width="1.3"/><path d="M6 5.5H10M8 5.5V11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
};

export type IconName = keyof typeof ICON_MARKUP;

interface ParsedSvg {
  attrs: Record<string, string>;
  inner: string;
}

const parsed = new Map<string, ParsedSvg>();

function parse(markup: string): ParsedSvg {
  let p = parsed.get(markup);
  if (!p) {
    const open = markup.slice(0, markup.indexOf(">") + 1);
    const attrs: Record<string, string> = {};
    for (const m of open.matchAll(/([a-zA-Z:-]+)="([^"]*)"/g)) attrs[m[1]] = m[2];
    p = { attrs, inner: markup.slice(open.length, markup.lastIndexOf("</svg>")) };
    parsed.set(markup, p);
  }
  return p;
}

function render(markup: string, extraClass?: string): JSX.Element {
  const { attrs, inner } = parse(markup);
  const cls = [attrs.class, extraClass].filter(Boolean).join(" ") || undefined;
  return (
    <svg
      {...attrs}
      class={cls}
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  );
}

export function Icon({ name, class: cls }: { name: IconName; class?: string }): JSX.Element {
  return render(ICON_MARKUP[name], cls);
}

/** Icon for a token type (falls back to the number icon). */
export function TypeIcon({ type }: { type: string }): JSX.Element {
  return render(TOKEN_TYPE_MARKUP[type] ?? TOKEN_TYPE_MARKUP.number);
}
