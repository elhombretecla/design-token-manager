// ════════════════════════════════════════════════════════════════════════
//  DESIGN TOKEN MANAGER — plugin.ts
//  Runs inside Penpot (sandboxed), communicates with the UI via postMessage.
//  Accesses design tokens through penpot.library.local.tokens (TokenCatalog).
// ════════════════════════════════════════════════════════════════════════

import type {
  Token,
  TokenCatalog,
  TokenSet,
  TokenTheme,
  TokenType,
  TokenValueString,
} from "@penpot/plugin-types";

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

// `addToken` doesn't take a description; it has to be set on the new token.
function addTokenWithDescription(
  set: TokenSet,
  args: { type: TokenType; name: string; value: TokenValueString },
  description: string,
): Token {
  const token = set.addToken(args);
  if (description) token.description = description;
  return token;
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

function serializeShadowValue(rawValue: unknown): string {
  if (rawValue == null)             return "";
  if (typeof rawValue === "string") return rawValue;

  // Both value and resolvedValue are plain JS arrays — take the first element.
  let src: unknown = rawValue;
  if (Array.isArray(rawValue)) {
    if (rawValue.length === 0) return "";
    src = rawValue[0];
    if (src === null)              return "";
    if (typeof src === "string")   return src; // alias string stored in array
    if (typeof src !== "object")   return "";
  }

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

  if (Object.keys(out).length > 0) {
    return JSON.stringify(out);
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
    const first = raw[0];
    if (typeof first === "string") return first;
    if (typeof first === "object" && first !== null) {
      // Reuse the shadow serializer to keep `color` extraction/probing
      // consistent with token.value serialisation.
      const str = serializeShadowValue(first);
      if (str && str !== "{}") return str;
    }
  }

  // 2. CLJS PersistentVector: try $tail$[0] first.
  //    The inner element is a CLJS proxy — not enumerable via JSON.stringify,
  //    but its fields (inset, offsetX, color…) may be readable by direct key
  //    access.  If $tail$[0] yields nothing useful ("{}"), fall through to
  //    step 3 so the outer PV can be tried.
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tail = (raw as any)["$tail$"];
    if (Array.isArray(tail) && tail.length > 0) {
      const inner = tail[0];
      if (inner !== null && typeof inner === "object") {
        const rv = serializeShadowValue(inner);
        if (rv && rv !== "{}") return rv;
        // inner proxy was empty — fall through to step 3
      }
    }
  }

  // 3. Key-probe the outer CLJS PV directly.
  return serializeShadowValue(raw);
}

// fontFamilies tokens require the value as a JS array per Penpot's Malli schema:
//   [:or [:vector :app.common.schema/text]  alias-ref-re]
// A plain string like "DM Sans" triggers :malli.core/invalid-type.
// Alias references ("{token.path}") are kept as strings; everything else is
// wrapped in a single-element array so Penpot receives ["DM Sans"].
function fontFamilyValueForApi(value: string): string | string[] {
  const s = (value ?? "").trim();
  // Alias reference: {font.primary} → keep as string, Penpot resolves it
  if (/^\{[^{}]+\}$/.test(s)) return s;
  // Plain name → wrap in array
  return s ? [s] : [""];
}

// Shadow tokens must be written as TokenShadowValueString[] (an array).
// The UI always sends { type, x, y, blur, spread, color } — convert to
// [{ inset, offsetX, offsetY, blur, spread, color }] before writing to Penpot.
// Alias strings and values already in array form pass through unchanged.
function shadowValueForApi(val: unknown): unknown {
  if (typeof val === "string") return val;   // alias reference → pass through
  if (Array.isArray(val))      return val;   // already array format → pass through
  if (typeof val !== "object" || val === null) return val;

  const obj = val as Record<string, unknown>;
  return [{
    inset:   obj.type === "inner-shadow",
    offsetX: obj.x      ?? obj.offsetX ?? "0",
    offsetY: obj.y      ?? obj.offsetY ?? "0",
    blur:    obj.blur   ?? "0",
    spread:  obj.spread ?? "0",
    color:   obj.color  ?? "rgba(0,0,0,0.25)",
  }];
}

// Within a typography token value, the `fontFamilies` field follows the same
// Penpot Malli schema as a standalone fontFamilies token:
//   • string  → alias reference (e.g. "{font.primary}")
//   • string[] → literal font names (e.g. ["DM Sans"])
//
// The UI serialises fontFamilies as a plain string ("DM Sans"), so we must
// wrap it in an array before writing to Penpot.  Without this, Penpot treats
// "DM Sans" as an unresolvable alias and the font doesn't apply to shapes.
function normalizeTypographyFontFamilies(val: unknown): unknown {
  if (typeof val !== "object" || val === null) return val;
  const obj = val as Record<string, unknown>;
  const ff = obj.fontFamilies;
  // Alias reference → leave as string; Penpot resolves it via the token graph.
  if (typeof ff === "string" && ff.trim() && !/^\{[^{}]+\}$/.test(ff.trim())) {
    return { ...obj, fontFamilies: [ff] };
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

function isAliasRefString(value: string): boolean {
  return /^\{[^{}]+\}$/.test((value ?? "").trim());
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
  if (type === "shadow") return shadowValueForApi(parsed) as TokenValueString;
  return parsed as TokenValueString;
}

// Deep-detached copy of a live token value, safe to pass to addToken.
function cloneTokenValue(value: unknown): TokenValueString {
  return (typeof value === "object" && value !== null
    ? JSON.parse(JSON.stringify(value))
    : value) as TokenValueString;
}

function findTokenByNameGlobal(name: string): Token | undefined {
  const cat = catalog();
  for (const set of cat.sets) {
    const found = set.tokens.find((t) => t.name === name);
    if (found) return found;
  }
  return undefined;
}

function serializeScalarTokenValue(token: Token): string | undefined {
  try {
    if (token.resolvedValue != null) {
      if (token.type === "fontFamilies") {
        const rv = serializeFontFamilyValue(token.resolvedValue);
        if (rv) return rv;
      } else {
        const rv = valueToString(token.resolvedValue);
        if (rv && rv !== "{}") return rv;
      }
    }

    if (token.type === "fontFamilies") {
      const v = serializeFontFamilyValue(token.value);
      return v || undefined;
    }
    const v = valueToString(token.value);
    return (v && v !== "{}") ? v : undefined;
  } catch {
    return undefined;
  }
}

function resolveAliasReferenceToScalar(
  maybeAlias: string,
  seen: Set<string> = new Set(),
): string | undefined {
  const s = (maybeAlias ?? "").trim();
  if (!isAliasRefString(s)) return s || undefined;

  const refName = s.slice(1, -1).trim();
  if (!refName || seen.has(refName)) return undefined;
  seen.add(refName);

  const refToken = findTokenByNameGlobal(refName);
  if (!refToken) return undefined;

  const resolved = serializeScalarTokenValue(refToken);
  if (!resolved) return undefined;
  if (isAliasRefString(resolved)) {
    return resolveAliasReferenceToScalar(resolved, seen);
  }
  return resolved;
}

function parseJsonObjectString(input: string | undefined): Record<string, unknown> {
  if (!input) return {};
  const s = input.trim();
  if (!s.startsWith("{") || !s.endsWith("}")) return {};
  try {
    const parsed: unknown = JSON.parse(s);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch { /* ignore malformed JSON */ }
  return {};
}

function enrichTypographyResolvedValue(
  token: Token,
  resolvedTypography: string | undefined,
  serializedTypographyValue: string,
): string | undefined {
  if (token.type !== "typography") return resolvedTypography;

  const out = parseJsonObjectString(resolvedTypography);
  const valueObj = parseJsonObjectString(serializedTypographyValue);

  const keys = ["fontFamilies", "fontSizes", "fontWeight"] as const;
  for (const key of keys) {
    const current = out[key];
    const fallback = valueObj[key];

    const currentStr =
      typeof current === "string" ? current :
      typeof current === "number" ? String(current) :
      undefined;
    const fallbackStr =
      typeof fallback === "string" ? fallback :
      typeof fallback === "number" ? String(fallback) :
      undefined;

    const candidate = currentStr ?? fallbackStr;
    if (!candidate) continue;
    if (!isAliasRefString(candidate)) {
      if (!(key in out)) out[key] = candidate;
      continue;
    }

    const resolved = resolveAliasReferenceToScalar(candidate);
    if (resolved) out[key] = resolved;
  }

  if (Object.keys(out).length === 0) return resolvedTypography;
  return JSON.stringify(out);
}

function serializeSet(set: TokenSet) {
  return {
    id: set.id,
    name: set.name,
    active: set.active,
    tokenCount: set.tokens.length,
  };
}

function serializeToken(token: Token) {
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

  if (token.type === "typography") {
    resolvedValue = enrichTypographyResolvedValue(token, resolvedValue, value);
  }

  return {
    id: token.id,
    name: token.name ?? "",
    type: token.type ?? "",
    value,
    description: token.description ?? "",
    resolvedValue,
  };
}

function serializeTheme(theme: TokenTheme) {
  return {
    id: theme.id,
    group: theme.group ?? "",
    name: theme.name,
    active: theme.active,
  };
}

// ── Broadcast full sets+themes list ──────────────────────────────────
function broadcastSets(): void {
  const cat = catalog();
  penpot.ui.sendMessage({
    type: "sets-updated",
    sets: cat.sets.map(serializeSet),
    themes: cat.themes.map(serializeTheme),
  });
}

// ── Broadcast tokens for a specific set ──────────────────────────────
function broadcastTokens(setId: string): void {
  const set = catalog().getSetById(setId);
  if (!set) return;
  penpot.ui.sendMessage({
    type: "tokens-updated",
    setId,
    tokens: set.tokens.map(serializeToken),
  });
}

// ════════════════════════════════════════════════════════════════════════
//  MESSAGE HANDLER  (UI → plugin)
// ════════════════════════════════════════════════════════════════════════

// ── Defensive message unwrap ──────────────────────────────────────────
// penpot.ui.onMessage should deliver the payload already unwrapped, but
// different Penpot host versions have been observed to forward:
//   • the raw MessageEvent object     → has a `.data` property
//   • a Figma-compat shim object      → has `.pluginMessage`
//   • a generic wrapper               → has `.message` or `.payload`
// We peel off one wrapping layer so the switch always sees {type, ...}.
function unwrapMessage(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {} as Record<string, unknown>;
  const r = raw as Record<string, unknown>;
  if (r.type)                                                    return r;
  if (r.data        && typeof r.data        === "object") return r.data        as Record<string, unknown>;
  if (r.pluginMessage && typeof r.pluginMessage === "object") return r.pluginMessage as Record<string, unknown>;
  if (r.message     && typeof r.message     === "object") return r.message     as Record<string, unknown>;
  if (r.payload     && typeof r.payload     === "object") return r.payload     as Record<string, unknown>;
  return r; // return as-is; switch will fall through to default
}

penpot.ui.onMessage((message: unknown) => {
  const msg = unwrapMessage(message);

  // Older Penpot runtimes (before plugin API 1.5) have no token catalog.
  if (!tokensApiAvailable()) {
    penpot.ui.sendMessage({ type: "unsupported", penpotVersion: penpot.version ?? "" });
    return;
  }

  try {
    const cat = catalog();

    switch (msg.type) {
      // ── Init ─────────────────────────────────────────────────────────
      case "init": {
        penpot.ui.sendMessage({
          type: "loaded",
          sets: cat.sets.map(serializeSet),
          themes: cat.themes.map(serializeTheme),
        });
        break;
      }

      // ── Fetch tokens for a set ────────────────────────────────────────
      case "get-tokens": {
        const setId = msg.setId as string;
        const set = cat.getSetById(setId);
        if (!set) throw new Error(`Set not found: ${setId}`);
        penpot.ui.sendMessage({
          type: "tokens-loaded",
          setId,
          tokens: set.tokens.map(serializeToken),
        });
        break;
      }

      // ── Create set ────────────────────────────────────────────────────
      case "create-set": {
        cat.addSet({ name: msg.name as string });
        broadcastSets();
        break;
      }

      // ── Rename set ────────────────────────────────────────────────────
      case "rename-set": {
        const set = cat.getSetById(msg.setId as string);
        if (!set) throw new Error(`Set not found: ${msg.setId}`);
        set.name = msg.newName as string;
        broadcastSets();
        break;
      }

      // ── Duplicate set ─────────────────────────────────────────────────
      case "duplicate-set": {
        const set = cat.getSetById(msg.setId as string);
        if (!set) throw new Error(`Set not found: ${msg.setId}`);
        set.duplicate();
        broadcastSets();
        break;
      }

      // ── Delete set ────────────────────────────────────────────────────
      case "delete-set": {
        const set = cat.getSetById(msg.setId as string);
        if (!set) throw new Error(`Set not found: ${msg.setId}`);
        set.remove();
        broadcastSets();
        break;
      }

      // ── Create token ──────────────────────────────────────────────────
      case "create-token": {
        const setId = msg.setId as string;
        const set = cat.getSetById(setId);
        if (!set) throw new Error(`Set not found: ${setId}`);
        addTokenWithDescription(set, {
          type: msg.tokenType as TokenType,
          name: msg.name as string,
          value: valueForApi(msg.tokenType as string, msg.value as string),
        }, (msg.description as string) ?? "");
        // Defer broadcast by one tick — same reason as duplicate-token:
        // accessing the proxy synchronously after addToken crashes the
        // tokenscript resolution engine.
        setTimeout(() => {
          broadcastTokens(setId);
          broadcastSets();
        }, 0);
        break;
      }

      // ── Update token ──────────────────────────────────────────────────
      case "update-token": {
        const setId = msg.setId as string;
        const set = cat.getSetById(setId);
        if (!set) throw new Error(`Set not found: ${setId}`);

        const token = set.tokens.find((t) => t.id === (msg.tokenId as string));
        if (!token) throw new Error(`Token not found: ${msg.tokenId}`);

        // The name setter re-validates the whole token against Penpot's
        // schema (fontFamilies tokens fail it), so only assign on change.
        if ((msg.name as string) !== token.name) {
          token.name = msg.name as string;
        }
        setTokenValue(token, valueForApi(token.type, msg.value as string));
        token.description = (msg.description as string) ?? "";

        broadcastTokens(setId);
        break;
      }

      // ── Duplicate token ───────────────────────────────────────────────
      case "duplicate-token": {
        const setId = msg.setId as string;
        const tokenId = msg.tokenId as string;
        const set = cat.getSetById(setId);
        if (!set) throw new Error(`Set not found: ${setId}`);

        // Fetch the token fresh from the live Penpot API rather than trusting
        // the UI's serialised snapshot.  For composite types (shadow, typography)
        // the live `value` is a plain JS object; the UI snapshot is a pre-stringified
        // copy that can corrupt the token if fed back into addToken directly.
        const original = set.getTokenById(tokenId);
        if (!original) throw new Error(`Token not found: ${tokenId}`);

        // Resolve a unique name against the *live* token list — not the UI
        // snapshot — so stale UI state can never cause an API name collision.
        const existingNames = new Set(set.tokens.map((t) => t.name));
        let copyName = `${original.name}-copy`;
        let counter = 2;
        while (existingNames.has(copyName)) {
          copyName = `${original.name}-copy-${counter++}`;
        }

        addTokenWithDescription(set, {
          type: original.type,
          name: copyName,
          value: cloneTokenValue(original.value),
        }, original.description ?? "");

        // Penpot's tokenscript engine resolves token values asynchronously
        // after addToken returns.  Accessing any proxy property (value,
        // resolvedValue, name…) in the same synchronous tick puts the engine
        // in an inconsistent state and throws "Cannot read properties of null
        // (reading 'value')".  A single-tick defer lets the engine settle so
        // broadcastTokens can safely serialize the complete, updated set.
        setTimeout(() => {
          broadcastTokens(setId);
          broadcastSets();
        }, 0);
        break;
      }

      // ── Delete token ──────────────────────────────────────────────────
      case "delete-token": {
        const setId = msg.setId as string;
        const set = cat.getSetById(setId);
        if (!set) throw new Error(`Set not found: ${setId}`);

        const token = set.tokens.find((t) => t.id === (msg.tokenId as string));
        if (!token) throw new Error(`Token not found: ${msg.tokenId}`);
        token.remove();

        broadcastTokens(setId);
        broadcastSets();
        break;
      }

      // ── Move token (or copy) ──────────────────────────────────────────
      case "move-token": {
        const fromSetId = msg.fromSetId as string;
        const toSetId = msg.toSetId as string;
        const copy = Boolean(msg.copy);

        const fromSet = cat.getSetById(fromSetId);
        const toSet = cat.getSetById(toSetId);
        if (!fromSet) throw new Error(`Source set not found: ${fromSetId}`);
        if (!toSet) throw new Error(`Target set not found: ${toSetId}`);

        const token = fromSet.tokens.find((t) => t.id === (msg.tokenId as string));
        if (!token) throw new Error(`Token not found: ${msg.tokenId}`);

        // Pass the live value (object for shadow/typography) rather than a
        // stringified copy: Penpot reads a "{…}" string as an alias reference.
        addTokenWithDescription(toSet, {
          type: token.type,
          name: token.name,
          value: cloneTokenValue(token.value),
        }, token.description ?? "");

        if (!copy) token.remove();

        // Broadcast both affected sets
        broadcastTokens(fromSetId);
        broadcastSets();
        break;
      }

      // ── Fetch all tokens of a given type across all sets (for alias picker) ──
      case "get-all-tokens-by-type": {
        const tokenType = msg.tokenType as string;
        const result = cat.sets
          .map((set) => ({
            setId: set.id,
            setName: set.name,
            tokens: set.tokens
              .filter((t) => t.type === tokenType)
              .map(serializeToken),
          }))
          .filter((s) => s.tokens.length > 0);
        penpot.ui.sendMessage({
          type: "all-tokens-by-type-loaded",
          tokenType,
          sets: result,
        });
        break;
      }

      // ── Scan document fonts ───────────────────────────────────────────
      case "scan-fonts": {
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
        penpot.ui.sendMessage({
          type: "fonts-loaded",
          fonts: Array.from(seen).sort(),
        });
        break;
      }

      default:
        console.warn("[Token Manager plugin] Unknown message type:", msg.type);
    }
  } catch (err) {
    console.error("[Token Manager plugin]", err);
    penpot.ui.sendMessage({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

// ════════════════════════════════════════════════════════════════════════
//  PENPOT EVENTS
// ════════════════════════════════════════════════════════════════════════

// Keep the UI in sync with the Penpot theme
penpot.on("themechange", (theme) => {
  penpot.ui.sendMessage({ source: "penpot", type: "themechange", theme });
});
