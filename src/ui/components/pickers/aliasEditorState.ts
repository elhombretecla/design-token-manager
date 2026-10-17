/**
 * State of the alias editor popover opened from an alias chip in the token
 * table. Kept apart from the component so cells can open it without a
 * circular import.
 */

import { signal } from "@preact/signals";

export interface AliasEditorTarget {
  setId: string;
  tokenId: string;
  /** Set when editing one field of a composite token (typography, shadow). */
  composite?: { propKey: string; propType: string };
  anchor: HTMLElement;
}

export const aliasEditor = signal<AliasEditorTarget | null>(null);

export function toggleAliasEditor(target: AliasEditorTarget): void {
  const cur = aliasEditor.value;
  if (cur && cur.tokenId === target.tokenId && cur.composite?.propKey === target.composite?.propKey) {
    aliasEditor.value = null;
    return;
  }
  aliasEditor.value = target;
}

export function closeAliasEditor(): void {
  aliasEditor.value = null;
}
