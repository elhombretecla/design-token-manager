/**
 * utils/shadowNormalize.ts
 *
 * Normalisation of shadow token values for display in the tokens table and
 * the edit modal.
 *
 * Shadow token values can arrive from Penpot in several serialisation formats:
 *   • Plain API JSON:    { type, x, y, blur, spread, color }
 *   • Transit map:       { $meta$, $cnt$, $arr$: [keyObj,val,…] }
 *   • EDN key variants:  { "offset-x": …, "offset-y": … }
 *
 * normalizeShadowValueToPreview() converts any of these into a stable plain
 * object { x, y, blur, spread, color, type } (all optional strings) that
 * the composite preview renderer can display without knowing the wire format.
 */

import { transitToPlain } from "./transit";
import { extractFirstString } from "./fontExtraction";

// ── Color string extractor ────────────────────────────────────────────────

/**
 * Extract a displayable color string from a shadow "color" value.
 *
 * Penpot may store shadow colors as plain CSS strings ("rgba(0,0,0,0.25)"),
 * alias references ("{color.shadow}"), or nested Transit/CLJS maps.
 * We handle all three without risking "[object Object]" in the output.
 */
export function extractShadowColorString(val: unknown): string | undefined {
  if (typeof val === "string") return val.trim() || undefined;

  // Unwrap any Transit/CLJS wrapper first
  const plain = transitToPlain(val);
  if (typeof plain === "string") return (plain as string).trim() || undefined;

  if (Array.isArray(plain)) {
    for (const item of plain as unknown[]) {
      const s = extractShadowColorString(item);
      if (s) return s;
    }
    return undefined;
  }

  if (typeof plain === "object" && plain !== null) {
    const obj = plain as Record<string, unknown>;
    // Probe common property names that might hold the actual color string
    for (const k of ["value", "color", "hex", "rgba", "name"]) {
      if (typeof obj[k] === "string" && (obj[k] as string).trim()) {
        return (obj[k] as string).trim();
      }
    }
    // Fall back to extractFirstString for other shapes
    return extractFirstString(plain);
  }

  return extractFirstString(val);
}

// ── Shadow value normaliser ───────────────────────────────────────────────

/**
 * Normalise any shadow token wire-format value → stable preview object.
 *
 * Single adapter used by BOTH the table composite preview and the Edit modal.
 *
 * Output keys are always: x, y, blur, spread, color, type  (all optional).
 * Values are kept as strings; aliases stay intact ("{color.xxx}").
 */
export function normalizeShadowValueToPreview(raw: string): Record<string, string> {
  if (!raw) return {};
  const s = raw.trim();
  if (!s.startsWith("{") || !s.endsWith("}")) return {};

  let parsed: unknown;
  try { parsed = JSON.parse(s); } catch { return {}; }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};

  // Flatten ClojureScript/Transit maps into plain JS objects
  const plain = transitToPlain(parsed);
  if (typeof plain !== "object" || plain === null || Array.isArray(plain)) return {};
  const m = plain as Record<string, unknown>;

  const result: Record<string, string> = {};

  // Simple numeric/string fields with multiple possible key-name variants
  const simpleFields: Array<[string[], string]> = [
    [["x", "offset-x", "offsetX"],  "x"],
    [["y", "offset-y", "offsetY"],  "y"],
    [["blur"],                       "blur"],
    [["spread"],                     "spread"],
    [["type"],                       "type"],
  ];

  for (const [keys, outKey] of simpleFields) {
    for (const k of keys) {
      const v = m[k];
      if (v === undefined || v === null) continue;
      const str =
        typeof v === "string" ? v.trim() :
        typeof v === "number" ? String(v) :
        undefined;
      if (str !== undefined) { result[outKey] = str; break; }
    }
  }

  // Color: may be a plain CSS string, alias ref, or a nested Transit object
  const rawColor = m["color"];
  if (rawColor !== undefined && rawColor !== null) {
    const colorStr = extractShadowColorString(rawColor);
    if (colorStr) result.color = colorStr;
  }

  return result;
}
