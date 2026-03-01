/**
 * utils/typographyNormalize.ts
 *
 * Normalisation and sanitisation of typography token values.
 *
 * Typography values can arrive from Penpot in several serialisation formats:
 *   • Transit map  { $meta$, $cnt$, $arr$: [keyObj,val,…] }  (primary)
 *   • API JSON     { fontFamilies:"Inter", fontSizes:"16px", … }
 *   • EDN JSON     { "font-family":["Inter"], "font-size":"16px", … }
 *   • Empty / alias strings → {}
 *
 * normalizeTypographyValueToForm() converts any of these into a stable form
 * shape { fontFamily, fontSize, fontWeight, lineHeight, letterSpacing,
 * textCase, textDecoration } used by BOTH the table preview and the edit modal.
 *
 * sanitizeTypographyValueForApi() strips unknown/empty keys before the value
 * is written back to Penpot via the plugin API.
 */

import { transitToPlain } from "./transit";
import { extractFontFamilyBestEffort } from "./fontExtraction";

// ── Allowed API keys ──────────────────────────────────────────────────────

/**
 * Allowed keys for the Penpot TokenTypographyValueString shape.
 * Any key outside this set is dropped by sanitizeTypographyValueForApi.
 */
export const TYPOGRAPHY_API_KEYS = new Set([
  "fontFamilies",
  "fontSizes",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "textCase",
  "textDecoration",
]);

// ── API payload sanitiser ─────────────────────────────────────────────────

/**
 * Sanitize a raw form-field map before sending it to the plugin API.
 *
 * Rules (from TokenTypographyValueString schema):
 *   • Drop keys not in TYPOGRAPHY_API_KEYS.
 *   • Drop any key whose value is an empty string — Penpot's schema
 *     rejects "" (token_value_empty_fn) for numeric fields like fontWeight,
 *     lineHeight, letterSpacing.  Omitting the key lets Penpot apply its
 *     own default.
 *   • Values that are alias references ("{font.size.20}") are kept as-is.
 *   • fontFamilies accepts string | string[]; we keep it as a plain string
 *     here because the form always holds a single family name.
 */
export function sanitizeTypographyValueForApi(
  raw: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!TYPOGRAPHY_API_KEYS.has(k)) continue;  // unknown key
    if (v == null || v === "")       continue;  // empty → let Penpot default
    out[k] = v;
  }
  if (import.meta.env.DEV) {
    console.debug("[DTM] sanitized API payload:", JSON.stringify(out));
  }
  return out;
}

// ── Form-shape normaliser ─────────────────────────────────────────────────

/**
 * Converts any wire-format typography value string → stable UI "form" shape:
 *   { fontFamily, fontSize, fontWeight, lineHeight,
 *     letterSpacing, textCase, textDecoration }
 *
 * Font-family is handled separately via extractFontFamilyBestEffort because
 * Penpot stores it as a ClojureScript PersistentHashSet/Vector — a trie
 * structure whose fields (shift, root, tail) must NOT be treated as the
 * font name.  All other fields arrive as plain strings, alias strings, or
 * numbers.
 */
export function normalizeTypographyValueToForm(raw: string): Record<string, string> {
  if (!raw) return {};
  const s = raw.trim();
  if (!s.startsWith("{") || !s.endsWith("}")) return {};

  let parsed: unknown;
  try { parsed = JSON.parse(s); } catch { return {}; }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};

  // Flatten the outer transit map → plain { "font-family": rawVal, "font-size": "…", … }
  const plain = transitToPlain(parsed);
  if (typeof plain !== "object" || plain === null || Array.isArray(plain)) return {};
  const m = plain as Record<string, unknown>;

  const form: Record<string, string> = {};

  // ── Font family ──────────────────────────────────────────────────────────
  // font-family is a PersistentHashSet/Vector — a HAMT trie whose actual
  // string element is deep inside nested nodes.  extractFontFamilyBestEffort
  // uses collectStringsDeep to traverse the entire structure without assuming
  // any specific field path.
  const rawFamily = m["font-families"] ?? m["font-family"] ?? m.fontFamilies ?? m.fontFamily;
  const family = extractFontFamilyBestEffort(rawFamily);
  if (family) form.fontFamily = family;

  // ── All other typography fields ──────────────────────────────────────────
  // These are plain strings, alias refs ("{…}"), or numbers.  Try kebab-case
  // keys first (Penpot internal), then API camelCase / plural variants.
  const simpleFields: Array<[keys: string[], formKey: string]> = [
    [["font-sizes",      "font-size",    "fontSizes",    "fontSize"], "fontSize"],
    // fontWeights (plural) is used by TokenTypographyValue (resolvedValue);
    // fontWeight (singular) is used by TokenTypographyValueString (value).
    // Probe both so the form populates correctly for either source.
    [["font-weights",    "font-weight",  "fontWeights",  "fontWeight"], "fontWeight"],
    [["line-height",     "lineHeight"],                            "lineHeight"],
    [["letter-spacing",  "letterSpacing"],                         "letterSpacing"],
    [["text-case",       "textCase"],                              "textCase"],
    [["text-decoration", "textDecoration"],                        "textDecoration"],
  ];

  for (const [keys, formKey] of simpleFields) {
    for (const k of keys) {
      const v = m[k];
      if (v === undefined || v === null) continue;
      const str =
        typeof v === "string" ? v.trim() :
        typeof v === "number" ? String(v) :
        undefined;
      if (str) { form[formKey] = str; break; }
    }
  }

  return form;
}
