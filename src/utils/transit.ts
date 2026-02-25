/**
 * utils/transit.ts
 *
 * ClojureScript / Transit-JSON deserialisation utilities.
 *
 * Penpot stores token values (typography, shadow, etc.) as ClojureScript
 * PersistentHashMaps / PersistentVectors.  When those objects are serialised
 * to JSON they produce a Transit-like wire format:
 *
 *   Transit map:
 *     { "$meta$": null, "$cnt$": N, "$arr$": [keyObj, val, keyObj, val, …] }
 *   where keyObj = { ns: null, name: "font-size", "$fqn$": "font-size", … }
 *
 *   Transit vector:
 *     { "$meta$": null, "$cnt$": N, "$arr$": ["Inter", …] }
 *
 * transitToPlain() recursively flattens these into ordinary JS objects/arrays
 * so that downstream key lookups work normally.
 */

// ── Internal keys to skip when recursing through CLJS Transit objects ─────
// These carry metadata / trie internals, never user-visible data.

export const TRAVERSE_SKIP_KEYS = new Set([
  "$meta$", "$cnt$", "shift", "edit", "__hash__",
]);

// Low-information strings that appear as internal identifiers in CLJS trie
// nodes and must NOT be treated as font-family names.
export const FONT_NAME_STOP_WORDS = new Set([
  "root", "tail", "shift", "edit", "ns", "fqn", "meta", "cnt",
]);

// ── Core deserialiser ─────────────────────────────────────────────────────

/**
 * Convert a ClojureScript/Transit proxy structure to a plain JS object or
 * array so downstream key lookups work normally.
 *
 *   Transit map    → plain object  { "font-size": "…", "font-family": "Inter" }
 *   Transit vector → plain array   ["Inter"]
 *   Everything else → returned as-is (strings, numbers, alias refs …)
 */
export function transitToPlain(val: unknown): unknown {
  if (val === null || val === undefined || typeof val !== "object") return val;

  if (Array.isArray(val)) {
    return val.map(transitToPlain);
  }

  const obj = val as Record<string, unknown>;

  // Detect transit map / vector: must have a $arr$ array.
  if (Array.isArray(obj.$arr$)) {
    const arr = obj.$arr$ as unknown[];

    // Distinguish map (even-indexed items are keyword objects) from vector
    // (all items are plain values).  An empty $arr$ → empty map.
    const firstEl = arr[0];
    const isMap =
      firstEl !== null &&
      typeof firstEl === "object" &&
      !Array.isArray(firstEl) &&
      (typeof (firstEl as Record<string, unknown>).$fqn$ === "string" ||
       typeof (firstEl as Record<string, unknown>).name  === "string");

    if (isMap) {
      // Map: iterate key/value pairs
      const result: Record<string, unknown> = {};
      for (let i = 0; i + 1 < arr.length; i += 2) {
        const k = arr[i] as Record<string, unknown>;
        const keyStr =
          (typeof k.$fqn$ === "string" && k.$fqn$) ||
          (typeof k.name  === "string" && k.name)  ||
          String(i / 2);
        result[keyStr] = transitToPlain(arr[i + 1]);
      }
      return result;
    }

    // Vector: return plain array of converted elements
    return arr.map(transitToPlain);
  }

  // Plain JS object — skip $ infrastructure keys, recurse into values.
  // This path handles our own serialised API-shape (fontFamilies, fontSizes…)
  // and any other non-transit object Penpot might emit.
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith("$")) continue;
    result[k] = transitToPlain(v);
  }
  return result;
}
