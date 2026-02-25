/**
 * utils/fontExtraction.ts
 *
 * Utilities for extracting font-family names and other string values from
 * deeply-nested ClojureScript/Transit proxy objects returned by Penpot.
 *
 * Penpot stores the font-family as a ClojureScript PersistentHashSet or
 * PersistentVector — a HAMT trie whose actual string element lives inside
 * nested BitmapIndexedNode / ArrayNode structures.  The exact field path
 * varies with the hash of the string and the trie depth, so we use a
 * depth-first harvester (collectStringsDeep) rather than probing fixed paths.
 */

import { transitToPlain, TRAVERSE_SKIP_KEYS, FONT_NAME_STOP_WORDS } from "./transit";
import { isAlias } from "./alias";

// ── Font-name heuristic ───────────────────────────────────────────────────

/**
 * True when the string is a plausible font-family name.
 * Must contain at least one letter, be 2–80 chars, and not be a known
 * internal CLJS identifier or contain special characters.
 */
export function isPlausibleFontName(s: string): boolean {
  if (s.length < 2 || s.length > 80) return false;
  if (!/[a-zA-Z]/.test(s)) return false;
  if (FONT_NAME_STOP_WORDS.has(s.toLowerCase())) return false;
  if (s.includes("$") || s.includes("/")) return false;
  if (s.includes("(") || s.includes("[") || s.startsWith("{")) return false;
  return true;
}

// ── Deep string harvester ─────────────────────────────────────────────────

/**
 * Depth-first string harvester for deeply nested ClojureScript/Transit objects.
 *
 * Recurses into every value that is an object or array, skipping known-noisy
 * internal keys (shift, $cnt$, edit, __hash__, cljs$lang$ masks).  Any string
 * encountered is tested against two criteria:
 *   a) alias ref  → starts with "{" and ends with "}"  (preserved verbatim)
 *   b) font name  → contains a letter, 2-80 chars, no special chars
 *
 * Numbers are never collected — they are always trie internals, never names.
 *
 * @param val      Value to traverse (may be anything).
 * @param out      Accumulator — candidates are pushed here.
 * @param depth    Current recursion depth (call with 0).
 * @param maxDepth Stop recursing below this depth (8 is enough for any HAMT).
 */
export function collectStringsDeep(
  val: unknown,
  out: string[],
  depth: number,
  maxDepth: number,
): void {
  if (depth > maxDepth || val === null || val === undefined) return;

  if (typeof val === "string") {
    const s = val.trim();
    if (s && (isAlias(s) || isPlausibleFontName(s))) out.push(s);
    return;
  }

  if (typeof val !== "object") return; // skip numbers, booleans

  if (Array.isArray(val)) {
    for (const item of val) collectStringsDeep(item, out, depth + 1, maxDepth);
    return;
  }

  const obj = val as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (TRAVERSE_SKIP_KEYS.has(k)) continue;
    if (k.startsWith("cljs$")) continue;
    collectStringsDeep(v, out, depth + 1, maxDepth);
  }
}

// ── Font family extractor ─────────────────────────────────────────────────

/**
 * Best-effort extraction of a font-family string from any Penpot value shape.
 *
 * Uses collectStringsDeep to harvest all candidate strings from the structure
 * (no assumptions about field names or trie layout), then returns:
 *   1. The first alias string found ("{font.family.x}"), or
 *   2. The first plausible font name found ("Inter", "Open Sans", …).
 *
 * Returns undefined (not an empty string) when nothing is found.
 */
export function extractFontFamilyBestEffort(raw: unknown): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === "string") return raw.trim() || undefined;

  const candidates: string[] = [];
  collectStringsDeep(raw, candidates, 0, 8);

  if (candidates.length === 0) return undefined;
  return candidates.find(isAlias) ?? candidates[0];
}

// ── General first-string extractor ────────────────────────────────────────

/**
 * Extract the first meaningful string from a non-font-family typography
 * value (font-size, font-weight, line-height, etc.).
 *
 * These fields arrive as plain strings or alias strings; they may also be
 * top-level numbers in some Penpot versions.  They are NEVER deeply nested
 * transit collections, so we do NOT need the full extractFontFamilies logic.
 *
 * Key safety rule: numbers are converted to strings ONLY when they arrive as
 * top-level primitives.  We never scan Object.values() of unknown objects —
 * that would pick up trie internals like shift:5, cnt:1, __hash__:0.
 */
export function extractFirstString(val: unknown): string | undefined {
  if (val === null || val === undefined) return undefined;
  if (typeof val === "string") return val.trim() || undefined;
  // Top-level number: legitimate for size/weight/spacing fields.
  if (typeof val === "number") return String(val);

  // Run transitToPlain once more in case of unconverted remainder.
  const plain = transitToPlain(val);
  if (typeof plain === "string") return (plain as string).trim() || undefined;
  if (typeof plain === "number") return String(plain as number);

  if (Array.isArray(plain)) {
    for (const item of plain as unknown[]) {
      const found = extractFirstString(item);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  // For plain objects probe only specific semantic fields.
  // Do NOT call Object.values() — that path leads to shift:5 → "5".
  if (typeof plain === "object" && plain !== null) {
    const obj = plain as Record<string, unknown>;
    for (const k of ["value", "name"]) {
      const v = obj[k];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (typeof v === "number") return String(v);
    }
  }

  return undefined;
}
