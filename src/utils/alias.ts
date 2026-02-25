/**
 * utils/alias.ts
 *
 * Alias reference detection and mixed-value parsing.
 *
 * An "alias" in the Design Token Manager is a string of the form `{some.token.path}`.
 * A "mixed value" is a string that contains one or more alias references
 * interleaved with plain text, e.g. `calc({spacing.sm} + 4px)`.
 */

// Matches an entire string that is exactly one alias reference: `{foo.bar}`.
const ALIAS_RE = /^\{[^{}]+\}$/;

/** Returns true when the value is a bare alias reference: `{some.token}`. */
export function isAlias(value: string): boolean {
  return ALIAS_RE.test(value.trim());
}

// ── Mixed-value parser ────────────────────────────────────────────────────

export type MixedSegment =
  | { kind: "alias"; name: string }
  | { kind: "text"; content: string };

/**
 * Split a string that may contain one or more `{alias.ref}` tokens into an
 * ordered array of text and alias segments.
 *
 * Example:
 *   parseMixedValue("calc({spacing.sm} + 4px)")
 *   → [{ kind:"alias", name:"spacing.sm" }, { kind:"text", content:" + 4px" }]
 */
export function parseMixedValue(value: string): MixedSegment[] {
  const segments: MixedSegment[] = [];
  for (const part of value.split(/(\{[^{}]+\})/g)) {
    if (part === "") continue;
    if (part.startsWith("{") && part.endsWith("}")) {
      segments.push({ kind: "alias", name: part.slice(1, -1) });
    } else {
      segments.push({ kind: "text", content: part });
    }
  }
  return segments;
}
