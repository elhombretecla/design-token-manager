// ════════════════════════════════════════════════════════════════════════
//  DESIGN TOKEN MANAGER — plugin.ts
//  Runs inside Penpot (sandboxed), communicates with the UI via postMessage.
//  Accesses design tokens through penpot.library.local.tokens (TokenCatalog).
// ════════════════════════════════════════════════════════════════════════

import type {
  Shape,
  Token,
  TokenCatalog,
  TokenProperty,
  TokenSet,
  TokenTheme,
  TokenType,
  TokenValueString,
} from "@penpot/plugin-types";
import type {
  CatalogSnapshot,
  ImportToken,
  Op,
  OpResult,
  PluginMessage,
  SelectionInfo,
  SnapshotSet,
  SnapshotTheme,
  SnapshotToken,
  UiMessage,
  ValidationReport,
} from "./shared/protocol";

// ── Open the plugin UI ────────────────────────────────────────────────
penpot.ui.open("Design Token Manager", `?theme=${penpot.theme}`, {
  width: 960,
  height: 600,
});

// ── Accessor helper ───────────────────────────────────────────────────
// The token API (TokenCatalog) is typed from @penpot/plugin-types 1.5.0.
// Older Penpot runtimes don't expose it, so callers must check
// `tokensApiAvailable()` before touching the catalog.
function catalog(): TokenCatalog {
  return penpot.library.local.tokens;
}

function tokensApiAvailable(): boolean {
  try {
    return Boolean(penpot.library?.local?.tokens);
  } catch {
    return false;
  }
}

// Token value setters differ per concrete token type, so assigning through
// the `Token` union needs a single, documented widening.
function setTokenValue(token: Token, value: TokenValueString): void {
  (token as { value: TokenValueString }).value = value;
}

// ════════════════════════════════════════════════════════════════════════
//  SERIALISATION HELPERS
//  Convert live Penpot objects → plain JSON-safe objects for postMessage.
// ════════════════════════════════════════════════════════════════════════

function valueToString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

// Typography token values are stored in Penpot as ClojureScript maps exposed
// through a JS Proxy.  JSON.stringify on a Proxy often returns "{}" because the
// underlying CLJS properties are not JS-enumerable.  We bypass that by
// explicitly reading each known property name by string key, which forces the
// Proxy getter and yields the actual stored data.
//
// Penpot may expose the same logical field under several different names
// depending on the version and internal state:
//   API canonical (TokenTypographyValueString): fontFamilies, fontSizes
//   singular camelCase:                         fontFamily,  fontSize
//   CLJS-to-JS kebab:                           font-family, font-size
//   (and similar for the other five fields)
//
// We probe all variants and emit under the API-canonical output key.
// The first non-null/undefined value found for each output key wins.
const TYPO_KEY_VARIANTS: ReadonlyArray<readonly [string, string]> = [
  // [input key to probe on the proxy, canonical output key]
  ["fontFamilies",   "fontFamilies"],
  ["fontFamily",     "fontFamilies"],
  ["font-families",  "fontFamilies"],
  ["font-family",    "fontFamilies"],
  ["fontSizes",      "fontSizes"],
  ["fontSize",       "fontSizes"],
  ["font-sizes",     "fontSizes"],
  ["font-size",      "fontSizes"],
  // TokenTypographyValue (resolvedValue) uses "fontWeights" (plural);
  // TokenTypographyValueString (value) uses "fontWeight" (singular).
  // Probe plural first so resolved values are captured correctly.
  ["fontWeights",    "fontWeight"],
  ["font-weights",   "fontWeight"],
  ["fontWeight",     "fontWeight"],
  ["font-weight",    "fontWeight"],
  ["lineHeight",     "lineHeight"],
  ["line-height",    "lineHeight"],
  ["letterSpacing",  "letterSpacing"],
  ["letter-spacing", "letterSpacing"],
  ["textCase",       "textCase"],
  ["text-case",      "textCase"],
  ["textDecoration", "textDecoration"],
  ["text-decoration","textDecoration"],
] as const;

// Extract the first meaningful scalar from potentially nested proxy objects.
// Used for resolved composite sub-fields that may arrive wrapped in CLJS/Transit
// containers (non-enumerable via JSON.stringify).
function extractCompositeScalar(raw: unknown): string | number | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "string") {
    const s = raw.trim();
    return s || undefined;
  }
  if (typeof raw === "number") return raw;

  if (Array.isArray(raw)) {
    for (const item of raw) {
      const found = extractCompositeScalar(item);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    for (const k of ["value", "name", "color", "hex", "rgba"]) {
      try {
        const found = extractCompositeScalar(obj[k]);
        if (found !== undefined) return found;
      } catch { /* skip */ }
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tail = (raw as any)["$tail$"];
      const found = extractCompositeScalar(tail);
      if (found !== undefined) return found;
    } catch { /* skip */ }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const arr = (raw as any)["$arr$"];
      const found = extractCompositeScalar(arr);
      if (found !== undefined) return found;
    } catch { /* skip */ }
  }

  return undefined;
}

function serializeTypographyValue(rawValue: unknown): string {
  if (rawValue == null)             return "";
  if (typeof rawValue === "string") return rawValue;

  const obj = rawValue as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [srcKey, outKey] of TYPO_KEY_VARIANTS) {
    if (outKey in out) continue; // already captured a value for this output key
    try {
      const val = obj[srcKey];
      if (val === undefined || val === null) continue;
      if (outKey === "fontFamilies") {
        const family = serializeFontFamilyValue(val);
        if (family) out[outKey] = family;
        continue;
      }
      if (typeof val === "object") {
        const scalar = extractCompositeScalar(val);
        if (scalar !== undefined) out[outKey] = scalar;
        continue;
      }
      out[outKey] = val;
    } catch {
      // Proxy getter threw; skip
    }
  }

  if (Object.keys(out).length > 0) {
    return JSON.stringify(out);
  }

  // Last resort: generic stringify.  May still produce "{}" for opaque proxies,
  // but the explicit-key path above should always win for real Penpot tokens.
  try { return JSON.stringify(rawValue) ?? ""; } catch { return ""; }
}

// Shadow token values in the Penpot API (docs: doc.plugins.penpot.dev):
//   TokenShadow.value        → string | TokenShadowValueString[]
//   TokenShadow.resolvedValue→ TokenShadowValue[]
//
// TokenShadowValueString: { color, inset, offsetX, offsetY, spread, blur } (strings)
// TokenShadowValue:       { color, inset, offsetX, offsetY, spread, blur }
//                           (inset: boolean; offsets/blur/spread: numbers)
//
// Both are plain JS — no CLJS deserialisation needed.
// We probe multiple key-name variants to handle:
//   • TokenShadowValueString/Value: offsetX, offsetY  (camelCase)
//   • Our internal storage format:  x, y, type        (legacy, pre-API)
//   • CLJS kebab-case residuals:    offset-x, offset-y
const SHADOW_KEY_VARIANTS: ReadonlyArray<readonly [string, string]> = [
  ["type",      "type"],
  ["x",         "x"],
  ["offsetX",   "x"],
  ["offset-x",  "x"],
  ["y",         "y"],
  ["offsetY",   "y"],
  ["offset-y",  "y"],
  ["blur",      "blur"],
  ["spread",    "spread"],
  ["color",     "color"],
] as const;

// One shadow layer (a plain object or a CLJS proxy) → plain UI-form object.
function serializeShadowLayer(src: object): Record<string, unknown> {
  const obj = src as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [srcKey, outKey] of SHADOW_KEY_VARIANTS) {
    if (outKey in out) continue;
    try {
      const val = obj[srcKey];
      if (val === undefined || val === null) continue;
      if (outKey === "color") {
        const color = extractCompositeScalar(val);
        if (color !== undefined) out[outKey] = String(color);
        continue;
      }
      if (typeof val === "object") {
        const scalar = extractCompositeScalar(val);
        if (scalar !== undefined) out[outKey] = scalar;
        continue;
      }
      out[outKey] = val;
    } catch { /* skip */ }
  }

  // TokenShadowValue (resolvedValue) uses inset: boolean.
  // TokenShadowValueString (value) uses inset: string ("true"/"false").
  // Convert to the canonical type key the UI normalizer expects.
  if (!("type" in out)) {
    try {
      const inset = obj["inset"];
      if (inset === true || inset === "true") {
        out.type = "inner-shadow";
      } else if (inset !== undefined && inset !== null) {
        out.type = "drop-shadow";
      }
    } catch { /* skip */ }
  }

  return out;
}

// Shadow values are arrays of layers. The UI form is a single JSON object
// for one layer (the common case) and a JSON array for several.
function shadowLayersToString(layers: Record<string, unknown>[]): string {
  const nonEmpty = layers.filter((l) => Object.keys(l).length > 0);
  if (nonEmpty.length === 0) return "";
  return JSON.stringify(nonEmpty.length === 1 ? nonEmpty[0] : nonEmpty);
}

function serializeShadowValue(rawValue: unknown): string {
  if (rawValue == null)             return "";
  if (typeof rawValue === "string") return rawValue;

  if (Array.isArray(rawValue)) {
    if (rawValue.length === 0) return "";
    if (typeof rawValue[0] === "string") return rawValue[0]; // alias string stored in array
    const layers = rawValue
      .filter((l): l is object => typeof l === "object" && l !== null)
      .map(serializeShadowLayer);
    return shadowLayersToString(layers);
  }

  if (typeof rawValue === "object") {
    const str = shadowLayersToString([serializeShadowLayer(rawValue)]);
    if (str) return str;
  }

  try { return JSON.stringify(rawValue) ?? ""; } catch { return ""; }
}

// ── fontFamilies serializer ────────────────────────────────────────────────
//
// fontFamilies tokens store their value as a CLJS PersistentVector — the same
// trie structure used for typography's fontFamily field.  The full shape is:
//
//   outer PersistentVector { $cnt$:1, $tail$: [inner_vec] }
//   inner PersistentVector { $cnt$:2, $tail$: ["DM", "Sans"] }
//
// The outer vector holds one or more font families; each inner vector holds
// the words of one family name.  We traverse $tail$ recursively, join the
// leaf strings of each inner vector with spaces ("DM"+"Sans" → "DM Sans"),
// and join multiple families with ", ".
//
// Also handles clean JS forms the API may return:
//   • plain string "Inter"          → returned as-is (alias refs included)
//   • flat string[] ["DM Sans"]     → joined with ", "
//   • nested string[][] [["DM","Sans"]] → inner words joined with " "

// Collect all leaf strings from a CLJS PersistentVector by following $tail$
// recursively. Leaf strings are joined with spaces to reconstruct a multi-word
// font family name: {$tail$:["DM","Sans"]} → "DM Sans".
 
function cljsExtractWords(val: unknown, depth = 0): string {
  if (depth > 8 || val === null || val === undefined) return "";
  if (typeof val === "string") return val.trim();
  if (Array.isArray(val)) {
    return (val as unknown[])
      .map((item) => cljsExtractWords(item, depth + 1))
      .filter(Boolean)
      .join(" ");
  }
  if (typeof val === "object") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tail = (val as any)["$tail$"];
    if (tail !== undefined) return cljsExtractWords(tail, depth + 1);
  }
  return "";
}

function serializeFontFamilyValue(raw: unknown): string {
  if (raw == null) return "";
  // Plain string: alias "{font.primary}" or direct name "Inter" — return as-is.
  if (typeof raw === "string") return raw;

  if (Array.isArray(raw)) {
    const families: string[] = [];
    for (const item of raw as unknown[]) {
      if (typeof item === "string" && item) {
        families.push(item);
      } else if (Array.isArray(item)) {
        // Plain JS word-vector from new API: ["DM", "Sans"] → "DM Sans"
        const words = (item as unknown[]).filter(
          (w): w is string => typeof w === "string" && Boolean(w)
        );
        if (words.length > 0) families.push(words.join(" "));
      } else if (item !== null && typeof item === "object") {
        // CLJS inner PersistentVector — collect leaf words, join with space
        const name = cljsExtractWords(item);
        if (name) families.push(name);
      }
    }
    if (families.length > 0) return families.join(", ");
  }

  // CLJS outer PersistentVector: follow $tail$ to the actual element list,
  // then re-enter serializeFontFamilyValue with that list.
  if (typeof raw === "object" && raw !== null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tail = (raw as any)["$tail$"];
    if (tail !== undefined) return serializeFontFamilyValue(tail);
  }

  return valueToString(raw);
}

// ── typography resolvedValue serializer ────────────────────────────────────
// resolvedValue for typography tokens is documented as TokenTypographyValue[]
// (plain JS array), but current Penpot builds deliver it as a CLJS
// PersistentVector — the same trie structure seen for shadow tokens:
//
//   { $cnt$: 1, $tail$: [<inner CLJS proxy>], ... }
//
// The inner element at $tail$[0] holds the resolved typography data.  Its
// properties (fontSizes, fontWeights, lineHeight…) are accessible via the CLJS
// proxy getter but NOT JS-enumerable, so JSON.stringify returns "{}".
//
// TokenTypographyValue fields (resolved):
//   fontFamilies:  string[]   ← always null/missing in practice (Penpot bug)
//   fontSizes:     number     ← resolved alias or direct number
//   fontWeights:   string     ← plural; different from stored fontWeight
//   lineHeight:    number
//   letterSpacing: number
//   textCase:      string
//   textDecoration:string
//
// Strategy (mirrors serializeShadowResolvedValue):
//   1. Plain JS array  → JSON.stringify(first) directly (future-proof).
//   2. CLJS PV object  → traverse $tail$ → key-probe inner with serializeTypographyValue.
//   3. Fallback        → key-probe the raw value itself.
function serializeTypographyResolvedValue(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw;

  // 1. Plain JS array: TokenTypographyValue[] in newer Penpot builds.
  if (Array.isArray(raw) && raw.length > 0) {
    const first = raw[0];
    if (typeof first === "string") return first;
    if (typeof first === "object" && first !== null) {
      // Reuse the typography serializer so fields with nested/non-enumerable
      // structures (notably fontFamilies / fontSizes) are normalised exactly
      // like token.value before they reach the UI.
      const str = serializeTypographyValue(first);
      if (str && str !== "{}") return str;
    }
  }

  // 2. CLJS PersistentVector: try $tail$[0] first.
  //    The inner element is a CLJS proxy — not JS-enumerable, but its fields
  //    may be readable via direct key access.  If $tail$[0] yields nothing
  //    useful ("{}"), fall through to step 3.
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tail = (raw as any)["$tail$"];
    if (Array.isArray(tail) && tail.length > 0) {
      const inner = tail[0];
      if (inner !== null && typeof inner === "object") {
        const rv = serializeTypographyValue(inner);
        if (rv && rv !== "{}") return rv;
        // inner proxy was empty — fall through to step 3
      }
    }
  }

  // 3. Key-probe the outer CLJS PV directly.
  //    Penpot's typography resolvedValue proxy forwards field access
  //    (fontSizes, fontWeights…) to the resolved inner map, so probing the
  //    outer PV object itself yields the resolved values.
  return serializeTypographyValue(raw);
}

// ── shadow resolvedValue serializer ────────────────────────────────────────
// resolvedValue for shadow tokens is documented as TokenShadowValue[] (plain JS
// array), but current Penpot builds still deliver it as a CLJS PersistentVector —
// the same trie structure used for typography:
//
//   { $cnt$: 1, $tail$: [<inner CLJS proxy>], ... }
//
// The inner element in $tail$[0] is the actual shadow data object.  Its properties
// (inset, offsetX, offsetY, blur, spread, color) ARE accessible via direct key
// access through the CLJS proxy getter, but are NOT JS-enumerable, so
// JSON.stringify returns "{}".
//
// Strategy:
//   1. Plain JS array  → JSON.stringify(first) directly (future-proof).
//   2. CLJS PV object  → traverse $tail$ to get inner element, then key-probe it
//                        with serializeShadowValue (same technique as typography).
//   3. Fallback        → key-probe the raw value itself.
function serializeShadowResolvedValue(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw;

  // 1. Plain JS array: TokenShadowValue[] in newer Penpot builds.
  if (Array.isArray(raw) && raw.length > 0) {
    const str = serializeShadowValue(raw);
    if (str && str !== "{}") return str;
  }

  // 2. CLJS PersistentVector: its layers live in $tail$ as proxies whose
  //    fields are readable by key but not enumerable.
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tail = (raw as any)["$tail$"];
    if (Array.isArray(tail) && tail.length > 0) {
      const str = serializeShadowValue(tail);
      if (str && str !== "{}") return str;
    }
  }

  // 3. Key-probe the outer CLJS PV directly.
  return serializeShadowValue(raw);
}

// fontFamilies tokens take a list of families. The UI edits them as one
// "DM Sans, Inter" string, so split on commas like Penpot's own import does
// (wrapping the whole string would create a single family "DM Sans, Inter").
// Alias references ("{token.path}") are kept as strings.
function fontFamilyValueForApi(value: string): string | string[] {
  const s = (value ?? "").trim();
  if (/^\{[^{}]+\}$/.test(s)) return s;
  const families = s.split(",").map((f) => f.trim()).filter(Boolean);
  return families.length > 0 ? families : [""];
}

// Shadow tokens must be written as TokenShadowValueString[] (an array).
// The UI sends one layer as { type, x, y, blur, spread, color } or several
// as an array of those; each becomes { inset, offsetX, offsetY, … }.
// Alias strings pass through unchanged.
function shadowLayerForApi(obj: Record<string, unknown>): Record<string, unknown> {
  return {
    inset:   obj.type === "inner-shadow" || obj.inset === true || obj.inset === "true",
    offsetX: obj.x      ?? obj.offsetX ?? "0",
    offsetY: obj.y      ?? obj.offsetY ?? "0",
    blur:    obj.blur   ?? "0",
    spread:  obj.spread ?? "0",
    color:   obj.color  ?? "rgba(0,0,0,0.25)",
  };
}

function shadowValueForApi(val: unknown): unknown {
  if (typeof val === "string") return val;   // alias reference → pass through
  if (Array.isArray(val)) {
    return val.map((l) =>
      typeof l === "object" && l !== null ? shadowLayerForApi(l as Record<string, unknown>) : l,
    );
  }
  if (typeof val !== "object" || val === null) return val;
  return [shadowLayerForApi(val as Record<string, unknown>)];
}

// Within a typography token value, the `fontFamilies` field follows the same
// Penpot Malli schema as a standalone fontFamilies token:
//   • string  → alias reference (e.g. "{font.primary}")
//   • string[] → literal font names (e.g. ["DM Sans"])
//
// The UI serialises fontFamilies as a plain string ("DM Sans, Inter"), so it
// goes through the same conversion as a standalone fontFamilies token.
function normalizeTypographyFontFamilies(val: unknown): unknown {
  if (typeof val !== "object" || val === null) return val;
  const obj = val as Record<string, unknown>;
  const ff = obj.fontFamilies;
  if (typeof ff === "string" && ff.trim()) {
    return { ...obj, fontFamilies: fontFamilyValueForApi(ff) };
  }
  return obj;
}

// Composite token types (typography, shadow) must be passed to addToken as
// plain objects, not JSON strings.  If Penpot receives a string that starts
// with "{" it treats the whole thing as an alias reference (like
// "{color.primary}") and reports :missing-reference.
// Pure alias strings are not valid JSON so JSON.parse throws → returned as-is.
function tryParseObject(value: string): string | object {
  const s = (value ?? "").trim();
  if (s.startsWith("{") && s.endsWith("}")) {
    try {
      const parsed: unknown = JSON.parse(s);
      if (typeof parsed === "object" && parsed !== null) return parsed as object;
    } catch {
      // Not valid JSON — alias reference like "{color.primary}", leave as string
    }
  }
  return value ?? "";
}

// Multi-layer shadows arrive from the UI as a JSON array string.
function parseShadowLayers(raw: string): unknown[] | null {
  const s = (raw ?? "").trim();
  if (!s.startsWith("[") || !s.endsWith("]")) return null;
  try {
    const parsed: unknown = JSON.parse(s);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Convert the UI's string form of a value into what the API expects:
//   • fontFamilies — [:vector :text]: wrap plain names in an array.
//   • typography   — JSON object; fontFamilies field wrapped in an array.
//   • shadow       — { type, x, y, … } → [{ inset, offsetX, offsetY, … }].
//   • others       — JSON strings parsed to objects, plain strings as-is.
function valueForApi(type: string, raw: string): TokenValueString {
  if (type === "fontFamilies") return fontFamilyValueForApi(raw);
  const parsed = tryParseObject(raw);
  if (type === "typography") return normalizeTypographyFontFamilies(parsed) as TokenValueString;
  if (type === "shadow") return shadowValueForApi(parseShadowLayers(raw) ?? parsed) as TokenValueString;
  return parsed as TokenValueString;
}

// Deep-detached copy of a live token value, safe to pass to addToken.
function cloneTokenValue(value: unknown): TokenValueString {
  return (typeof value === "object" && value !== null
    ? JSON.parse(JSON.stringify(value))
    : value) as TokenValueString;
}

function serializeToken(token: Token): SnapshotToken {
  // resolvedValue is computed by Penpot's tokenscript engine at read time.
  // On a freshly created token the engine may not have run yet, causing the
  // proxy getter to throw internally.  We treat any error as "not resolved".
  let resolvedValue: string | undefined;
  try {
    if (token.resolvedValue != null) {
      let rv: string;
      if (token.type === "typography") {
        // resolvedValue is now TokenTypographyValue[] (plain JS array of objects)
        // in current Penpot builds.  serializeTypographyResolvedValue handles
        // both the new array format and the old CLJS proxy fallback.
        rv = serializeTypographyResolvedValue(token.resolvedValue);
      } else if (token.type === "shadow") {
        // resolvedValue is now TokenShadowValue[] (plain JS array of objects)
        // in current Penpot builds.  serializeShadowResolvedValue handles both
        // the new array format and the old key-probing fallback.
        rv = serializeShadowResolvedValue(token.resolvedValue);
      } else if (token.type === "fontFamilies") {
        // Do NOT use resolvedValueString — it contains the raw CLJS pr-str
        // representation (EDN format, e.g. [["DM" "Sans"]] with spaces, not
        // commas), which is not human-readable.  Always use serializeFontFamilyValue
        // which handles plain strings, flat string[], and nested word-vectors.
        rv = serializeFontFamilyValue(token.resolvedValue);
      } else {
        rv = valueToString(token.resolvedValue);
      }
      // Treat "{}" as unresolved: an empty JSON object is what JSON.stringify
      // produces for an opaque CLJS proxy, not a real resolved value.
      resolvedValue = (rv && rv !== "{}") ? rv : undefined;
    }
  } catch {
    resolvedValue = undefined;
  }

  // Use type-specific serializers so the UI always receives a displayable string.
  //   • typography  — proxy-safe key-probing (CLJS proxy compat) + new object compat
  //   • shadow      — proxy-safe key-probing
  //   • fontFamilies— joins string[] arrays; returns alias strings unchanged
  //   • everything else — generic valueToString
  const value =
    token.type === "typography"
      ? serializeTypographyValue(token.value)
      : token.type === "shadow"
        ? serializeShadowValue(token.value)
        : token.type === "fontFamilies"
          ? serializeFontFamilyValue(token.value)
          : valueToString(token.value);

  return {
    id: token.id,
    name: token.name ?? "",
    type: token.type ?? "",
    value,
    description: token.description ?? "",
    penpotResolved: resolvedValue,
  };
}

function serializeSet(set: TokenSet): SnapshotSet {
  let tokens: SnapshotToken[] = [];
  try {
    tokens = set.tokens.map(serializeToken);
  } catch (err) {
    console.error("[Token Manager plugin] Could not read set", set.name, err);
  }
  return { id: set.id, name: set.name, active: set.active, tokens };
}

function serializeTheme(theme: TokenTheme): SnapshotTheme {
  let setIds: string[] = [];
  try {
    setIds = theme.activeSets.map((s) => s.id);
  } catch { /* keep empty */ }
  return {
    id: theme.id,
    group: theme.group ?? "",
    name: theme.name,
    active: theme.active,
    setIds,
  };
}

function buildSnapshot(): CatalogSnapshot {
  const cat = catalog();
  return {
    sets: cat.sets.map(serializeSet),
    themes: cat.themes.map(serializeTheme),
  };
}

// ════════════════════════════════════════════════════════════════════════
//  SNAPSHOT PUBLISHING & CHANGE DETECTION
//  The token API has no change events, so external edits (Penpot's own
//  tokens panel, undo, other collaborators) are detected by comparing the
//  serialised snapshot after `contentsave` and on a slow periodic check.
// ════════════════════════════════════════════════════════════════════════

const POLL_INTERVAL_MS = 2000;
let lastSnapshotJson = "";
let publishScheduled = false;

function send(message: PluginMessage): void {
  penpot.ui.sendMessage(message);
}

/** Send the snapshot if it changed (or unconditionally with `force`). */
function publishSnapshot(force = false): void {
  if (!tokensApiAvailable()) return;
  try {
    const snapshot = buildSnapshot();
    const json = JSON.stringify(snapshot);
    if (!force && json === lastSnapshotJson) return;
    lastSnapshotJson = json;
    send({ type: "snapshot", snapshot });
  } catch (err) {
    console.error("[Token Manager plugin] Snapshot failed", err);
  }
}

// Penpot's token engine settles after a mutation returns; reading the new
// proxies in the same tick can throw. Coalesce publishes into the next tick.
function schedulePublish(): void {
  if (publishScheduled) return;
  publishScheduled = true;
  setTimeout(() => {
    publishScheduled = false;
    publishSnapshot();
  }, 0);
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// ════════════════════════════════════════════════════════════════════════
//  OPERATIONS  (UI → plugin)
// ════════════════════════════════════════════════════════════════════════

function requireSet(cat: TokenCatalog, setId: string): TokenSet {
  const set = cat.getSetById(setId);
  if (!set) throw new Error(`Set not found: ${setId}`);
  return set;
}

function requireToken(set: TokenSet, tokenId: string): Token {
  const token = set.getTokenById(tokenId);
  if (!token) throw new Error(`Token not found in "${set.name}": ${tokenId}`);
  return token;
}

function requireTheme(cat: TokenCatalog, themeId: string): TokenTheme {
  const theme = cat.getThemeById(themeId);
  if (!theme) throw new Error(`Theme not found: ${themeId}`);
  return theme;
}

// `addToken` doesn't take a description; set it once the engine settled.
async function addTokenWithDescription(
  set: TokenSet,
  args: { type: TokenType; name: string; value: TokenValueString },
  description: string,
): Promise<void> {
  const token = set.addToken(args);
  if (!description) return;
  await tick();
  token.description = description;
}

// ── Shapes & applied tokens ───────────────────────────────────────────────

function shapeTokens(shape: Shape): Record<string, string> {
  try {
    return { ...(shape.tokens as Record<string, string>) };
  } catch {
    return {};
  }
}

function shapesById(ids: string[]): Shape[] {
  const page = penpot.currentPage;
  if (!page) return [];
  return ids.map((id) => page.getShapeById(id)).filter((s): s is Shape => s !== null);
}

// Penpot applies tokens by name and resolves them with the active sets, so
// the token used to remove an application should be the one that wins
// there; fall back to any set that defines the name.
function findTokenByName(cat: TokenCatalog, name: string): Token | undefined {
  let winner: Token | undefined;
  let any: Token | undefined;
  for (const set of cat.sets) {
    const token = set.tokens.find((t) => t.name === name);
    if (!token) continue;
    any ??= token;
    if (set.active) winner = token;
  }
  return winner ?? any;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Apply one property at a time: Penpot picks the shape updater from the
// first property, so mixing groups (padding + gap) in one call misapplies.
// Applying is a toggle, so properties every shape already has are skipped.
function applyToken(token: Token, shapes: Shape[], properties: string[]): string {
  if (shapes.length === 0) throw new Error("Select one or more shapes in Penpot first");
  let applied = 0;
  for (const prop of properties) {
    if (shapes.every((s) => shapeTokens(s)[prop] === token.name)) continue;
    token.applyToShapes(shapes, [prop as TokenProperty]);
    applied++;
  }
  if (applied === 0) return `${token.name} was already applied`;
  return `Applied ${token.name} to ${plural(shapes.length, "shape")}`;
}

async function importSet(cat: TokenCatalog, name: string, tokens: ImportToken[], mode: "skip" | "overwrite"): Promise<string> {
  let set = cat.sets.find((s) => s.name === name);
  if (!set) {
    set = cat.addSet({ name });
    await tick();
  }
  let created = 0, updated = 0, skipped = 0;
  const failures: string[] = [];
  for (const t of tokens) {
    try {
      const existing = set.tokens.find((x) => x.name === t.name);
      if (existing && mode === "skip") { skipped++; continue; }
      if (existing && existing.type === t.type) {
        setTokenValue(existing, valueForApi(t.type, t.value));
        existing.description = t.description;
        updated++;
        continue;
      }
      if (existing) existing.remove(); // type changed: replace
      await addTokenWithDescription(set, {
        type: t.type as TokenType,
        name: t.name,
        value: valueForApi(t.type, t.value),
      }, t.description);
      if (existing) updated++; else created++;
    } catch (err) {
      failures.push(`${t.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (failures.length > 0 && created + updated + skipped === 0) {
    throw new Error(`"${name}": no tokens imported (${failures[0]})`);
  }
  const parts = [`${plural(created, "token")} created`];
  if (updated) parts.push(`${updated} updated`);
  if (skipped) parts.push(`${skipped} kept`);
  if (failures.length) parts.push(`${failures.length} failed (${failures[0]})`);
  return `"${name}": ${parts.join(", ")}`;
}

async function runOp(cat: TokenCatalog, op: Op): Promise<string | void> {
  switch (op.op) {
    case "create-set":
      cat.addSet({ name: op.name });
      return;

    case "rename-set":
      requireSet(cat, op.setId).name = op.newName;
      return;

    case "duplicate-set":
      requireSet(cat, op.setId).duplicate();
      return;

    case "delete-set":
      requireSet(cat, op.setId).remove();
      return;

    case "create-token":
      await addTokenWithDescription(requireSet(cat, op.setId), {
        type: op.tokenType as TokenType,
        name: op.name,
        value: valueForApi(op.tokenType, op.value),
      }, op.description);
      return;

    case "update-token": {
      const token = requireToken(requireSet(cat, op.setId), op.tokenId);
      // The name setter re-validates the whole token against Penpot's
      // schema (fontFamilies tokens fail it), so only assign on change.
      if (op.name !== token.name) token.name = op.name;
      setTokenValue(token, valueForApi(token.type, op.value));
      token.description = op.description ?? "";
      return;
    }

    case "duplicate-token": {
      const set = requireSet(cat, op.setId);
      const original = requireToken(set, op.tokenId);
      // Unique name against the live token list, never the UI's copy.
      const existingNames = new Set(set.tokens.map((t) => t.name));
      let copyName = `${original.name}-copy`;
      for (let n = 2; existingNames.has(copyName); n++) {
        copyName = `${original.name}-copy-${n}`;
      }
      await addTokenWithDescription(set, {
        type: original.type,
        name: copyName,
        value: cloneTokenValue(original.value),
      }, original.description ?? "");
      return;
    }

    case "delete-token":
      requireToken(requireSet(cat, op.setId), op.tokenId).remove();
      return;

    case "move-token": {
      const fromSet = requireSet(cat, op.fromSetId);
      const toSet = requireSet(cat, op.toSetId);
      const token = requireToken(fromSet, op.tokenId);
      const targetName = op.newName ?? token.name;
      if (toSet.tokens.some((t) => t.name === targetName)) {
        throw new Error(`"${toSet.name}" already has a token named "${targetName}"`);
      }
      // Pass the live value (object for shadow/typography) rather than a
      // stringified copy: Penpot reads a "{…}" string as an alias reference.
      await addTokenWithDescription(toSet, {
        type: token.type,
        name: targetName,
        value: cloneTokenValue(token.value),
      }, token.description ?? "");
      if (!op.copy) token.remove();
      return;
    }

    // Note: toggling a set directly makes Penpot disable all themes
    // (the file switches to a "custom" combination of sets).
    case "set-set-active":
      requireSet(cat, op.setId).active = op.active;
      return;

    case "create-theme": {
      const theme = cat.addTheme({ group: op.group, name: op.name });
      for (const setId of op.setIds ?? []) theme.addSet(setId);
      for (const setName of op.setNames ?? []) {
        const set = cat.sets.find((s) => s.name === setName);
        if (set) theme.addSet(set);
      }
      return;
    }

    case "update-theme": {
      const theme = requireTheme(cat, op.themeId);
      if (theme.group !== op.group) theme.group = op.group;
      if (theme.name !== op.name) theme.name = op.name;
      return;
    }

    case "duplicate-theme":
      requireTheme(cat, op.themeId).duplicate();
      return;

    case "delete-theme":
      requireTheme(cat, op.themeId).remove();
      return;

    // Penpot keeps at most one active theme per group.
    case "set-theme-active":
      requireTheme(cat, op.themeId).active = op.active;
      return;

    case "set-theme-sets": {
      const theme = requireTheme(cat, op.themeId);
      const wanted = new Set(op.setIds);
      const current = new Set(theme.activeSets.map((s) => s.id));
      for (const id of current) if (!wanted.has(id)) theme.removeSet(id);
      for (const id of wanted) if (!current.has(id)) theme.addSet(id);
      return;
    }

    case "apply-token": {
      const token = requireToken(requireSet(cat, op.setId), op.tokenId);
      return applyToken(token, penpot.selection, op.properties);
    }

    case "unapply-token": {
      const token = findTokenByName(cat, op.tokenName);
      if (!token) {
        throw new Error(`No token named "${op.tokenName}" exists, and Penpot can only remove an application through its token`);
      }
      const shapes = shapesById(op.shapeIds);
      for (const prop of op.properties) {
        // Toggling off only happens when every shape has it applied.
        const having = shapes.filter((s) => shapeTokens(s)[prop] === op.tokenName);
        if (having.length > 0) token.applyToShapes(having, [prop as TokenProperty]);
      }
      return;
    }

    case "select-shapes": {
      if (op.pageId && penpot.currentPage?.id !== op.pageId) {
        await penpot.openPage(op.pageId);
        await tick();
      }
      const shapes = shapesById(op.shapeIds);
      if (shapes.length === 0) throw new Error("Those shapes are no longer in the file");
      penpot.selection = shapes;
      return;
    }

    case "select-token-usages": {
      const shapes = (penpot.currentPage?.findShapes() ?? [])
        .filter((s) => Object.values(shapeTokens(s)).includes(op.tokenName));
      penpot.selection = shapes;
      return shapes.length === 0
        ? `No shapes on this page use ${op.tokenName}`
        : `Selected ${plural(shapes.length, "shape")} using ${op.tokenName}`;
    }

    case "import-set":
      return importSet(cat, op.name, op.tokens, op.mode);
  }
}

async function runOps(reqId: number, ops: Op[]): Promise<void> {
  const cat = catalog();
  const results: OpResult[] = [];
  for (const op of ops) {
    try {
      const message = await runOp(cat, op);
      results.push(message ? { ok: true, message } : { ok: true });
    } catch (err) {
      console.error("[Token Manager plugin]", op.op, err);
      results.push({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    // Let the token engine settle between operations of a batch.
    await tick();
  }
  send({ type: "ops-result", reqId, results });
  schedulePublish();
  // Applying tokens doesn't fire selectionchange; refresh the panel.
  setTimeout(() => publishSelection(), 50);
}

// ════════════════════════════════════════════════════════════════════════
//  SELECTION
// ════════════════════════════════════════════════════════════════════════

const SELECTION_DETAIL_MAX = 50;
let lastSelectionJson = "";

function buildSelection(): SelectionInfo {
  const selection = penpot.selection ?? [];
  return {
    total: selection.length,
    shapes: selection.slice(0, SELECTION_DETAIL_MAX).map((shape) => ({
      id: shape.id,
      name: shape.name,
      type: shape.type,
      tokens: shapeTokens(shape),
    })),
  };
}

function publishSelection(force = false): void {
  try {
    const selection = buildSelection();
    const json = JSON.stringify(selection);
    if (!force && json === lastSelectionJson) return;
    lastSelectionJson = json;
    send({ type: "selection", selection });
  } catch (err) {
    console.error("[Token Manager plugin] Selection failed", err);
  }
}

// ════════════════════════════════════════════════════════════════════════
//  VALIDATION
// ════════════════════════════════════════════════════════════════════════

function buildValidationReport(): ValidationReport {
  const page = penpot.currentPage;
  const file = penpot.currentFile;
  const validateAvailable = typeof file?.validate === "function";
  let fileIssues: ValidationReport["fileIssues"] = [];
  if (file && validateAvailable) {
    try {
      fileIssues = file.validate().map((e) => ({
        code: e.code, hint: e.hint, shapeId: e.shapeId, pageId: e.pageId,
      }));
    } catch (err) {
      fileIssues = [{ code: "validation-error", hint: String(err), shapeId: null, pageId: null }];
    }
  }

  const usage = new Map<string, Set<string>>();
  for (const shape of page?.findShapes() ?? []) {
    for (const name of Object.values(shapeTokens(shape))) {
      if (!usage.has(name)) usage.set(name, new Set());
      usage.get(name)!.add(shape.id);
    }
  }

  return {
    validateAvailable,
    fileIssues,
    pageId: page?.id ?? "",
    pageName: page?.name ?? "",
    applied: [...usage].map(([name, ids]) => ({ name, shapeIds: [...ids] })),
  };
}

function scanDocumentFonts(): string[] {
  const seen = new Set<string>();
  try {
    for (const shape of penpot.currentPage?.findShapes({ type: "text" }) ?? []) {
      if (!penpot.utils.types.isText(shape)) continue;
      if (shape.fontFamily !== "mixed") {
        if (shape.fontFamily) seen.add(shape.fontFamily);
        continue;
      }
      // Mixed fonts: sample per character (capped to keep it cheap).
      const len = Math.min(shape.characters.length, 2000);
      for (let i = 0; i < len; i++) {
        const family = shape.getRange(i, i + 1).fontFamily;
        if (family && family !== "mixed") seen.add(family);
      }
    }
  } catch {
    // Scanning is best-effort; return whatever was collected
  }
  return Array.from(seen).sort();
}

// ════════════════════════════════════════════════════════════════════════
//  MESSAGE HANDLER
// ════════════════════════════════════════════════════════════════════════

penpot.ui.onMessage<UiMessage>((msg) => {
  // Older Penpot runtimes (before plugin API 1.5) have no token catalog.
  if (!tokensApiAvailable()) {
    send({ type: "unsupported", penpotVersion: penpot.version ?? "" });
    return;
  }

  switch (msg?.type) {
    case "init":
      // The URL carries the theme too, but confirm it in case it was lost.
      send({ source: "penpot", type: "themechange", theme: penpot.theme });
      publishSnapshot(true);
      publishSelection(true);
      break;

    case "validate": {
      let report: ValidationReport;
      try {
        report = buildValidationReport();
      } catch (err) {
        send({ type: "error", message: `Validation failed: ${String(err)}` });
        report = { validateAvailable: false, fileIssues: [], pageId: "", pageName: "", applied: [] };
      }
      send({ type: "validation", reqId: msg.reqId, report });
      break;
    }

    case "ops":
      void runOps(msg.reqId, msg.ops);
      break;

    case "scan-fonts":
      send({ type: "fonts-loaded", fonts: scanDocumentFonts() });
      break;

    default:
      console.warn("[Token Manager plugin] Unknown message:", msg);
  }
});

// ════════════════════════════════════════════════════════════════════════
//  PENPOT EVENTS
// ════════════════════════════════════════════════════════════════════════

// Keep the UI in sync with the Penpot theme
penpot.on("themechange", (theme) => {
  send({ source: "penpot", type: "themechange", theme });
});

penpot.on("contentsave", () => publishSnapshot());
penpot.on("selectionchange", () => publishSelection());
// Also catches token (un)applications made from Penpot's own panel.
setInterval(() => {
  publishSnapshot();
  publishSelection();
}, POLL_INTERVAL_MS);
