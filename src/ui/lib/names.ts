/**
 * ui/lib/names.ts
 *
 * Token and set name rules, references between tokens, and unique names.
 * Pure functions over the snapshot so they can be unit tested.
 */

import type { CatalogSnapshot, SnapshotSet, SnapshotToken } from "../../shared/protocol";
import { referencesName } from "../../utils/alias";

/**
 * Inline validation of a token name, mirroring Penpot's rules: dot-separated
 * segments of letters, digits, "-" and "_" (no spaces, braces or "$"), and
 * unique within the set. Returns an error message or null.
 */
export function tokenNameError(name: string, takenNames: Iterable<string>): string | null {
  const n = name.trim();
  if (!n) return "Enter a name";
  if (/\s/.test(n)) return "Names can't contain spaces";
  if (/[{}$]/.test(n)) return 'Names can\'t contain "{", "}" or "$"';
  if (n.startsWith(".") || n.endsWith(".") || n.includes("..")) return "Use dots only between name segments";
  if (!/^[\p{L}\p{N}_\-.]+$/u.test(n)) return 'Use letters, numbers, "-", "_" and "."';
  for (const taken of takenNames) {
    if (taken === n) return "A token with this name already exists in this set";
  }
  return null;
}

/** Set names: "/" separates groups; segments can't be empty. */
export function setNameError(name: string, takenNames: Iterable<string>): string | null {
  const n = name.trim();
  if (!n) return "Enter a name";
  if (n.split("/").some((part) => !part.trim())) return 'Group segments separated by "/" can\'t be empty';
  for (const taken of takenNames) {
    if (taken === n) return "A set with this name already exists";
  }
  return null;
}

export interface TokenRef {
  set: SnapshotSet;
  token: SnapshotToken;
}

/** Tokens (in any set) whose value references one of `names`. */
export function findReferences(
  snapshot: CatalogSnapshot,
  names: string[],
  excludeIds: ReadonlySet<string> = new Set(),
): TokenRef[] {
  const refs: TokenRef[] = [];
  for (const set of snapshot.sets) {
    for (const token of set.tokens) {
      if (excludeIds.has(token.id)) continue;
      if (names.some((name) => referencesName(token.value, name))) refs.push({ set, token });
    }
  }
  return refs;
}

/** Sets other than `setId` that also define `name` (e.g. theme variants). */
export function otherSetsDefining(snapshot: CatalogSnapshot, name: string, setId: string): SnapshotSet[] {
  return snapshot.sets.filter((s) => s.id !== setId && s.tokens.some((t) => t.name === name));
}

/** `base-copy`, `base-copy-2`, … not in `taken` (which is updated). */
export function uniqueName(base: string, taken: Set<string>): string {
  let name = `${base}-copy`;
  for (let n = 2; taken.has(name); n++) name = `${base}-copy-${n}`;
  taken.add(name);
  return name;
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
