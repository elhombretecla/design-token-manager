// ════════════════════════════════════════════════════════════════════════
//  DESIGN TOKEN MANAGER — plugin.ts
//  Runs inside Penpot (sandboxed), communicates with the UI via postMessage.
//  Accesses design tokens through penpot.library.local.tokens (TokenCatalog).
// ════════════════════════════════════════════════════════════════════════

// ── Open the plugin UI ────────────────────────────────────────────────
penpot.ui.open("Design Token Manager", `?theme=${penpot.theme}`, {
  width: 960,
  height: 600,
});

// ════════════════════════════════════════════════════════════════════════
//  LOCAL TYPE DECLARATIONS
//  The token API lives in the Penpot app but is not yet shipped in the
//  @penpot/plugin-types npm package.  We declare a minimal interface here
//  so TypeScript is satisfied.  All accesses go through the `catalog()`
//  helper which casts via `any`.
// ════════════════════════════════════════════════════════════════════════

interface IToken {
  readonly id: string;
  name: string;
  readonly type: string;
  value: string;        // Can be a string, a plain object, or a string[]
  description: string;
  // resolvedValue: plain string, string[] (fontFamilies), object, or object[]
  // (TokenTypographyValue[] / TokenShadowValue) depending on token type and
  // Penpot version.  Always access through the serializer helpers below.
  readonly resolvedValue?: string | string[] | object | object[];
  // Introduced in newer Penpot builds: the resolved value already coerced to a
  // single string, ready to display.  Undefined when no active set resolves it.
  readonly resolvedValueString?: string;
  remove(): void;
  // `update` may not exist in all Penpot versions; always check before calling
  update?(args: { name?: string; value?: string; description?: string }): void;
}

interface ITokenSet {
  readonly id: string;
  name: string;
  readonly active: boolean;
  readonly tokens: IToken[];
  readonly tokensByType: [string, IToken[]][];
  toggleActive(): void;
  getTokenById(id: string): IToken | undefined;
  addToken(args: { type: string; name: string; value: string | object; description?: string }): IToken;
  duplicate(): ITokenSet;
  remove(): void;
}

interface ITokenTheme {
  readonly id: string;
  readonly externalId: string | undefined;
  group: string;
  name: string;
  active: boolean;
  readonly activeSets: ITokenSet[];
  toggleActive(): void;
  addSet(set: ITokenSet): void;
  removeSet(set: ITokenSet): void;
  duplicate(): ITokenTheme;
  remove(): void;
}

interface ITokenCatalog {
  readonly sets: ITokenSet[];
  readonly themes: ITokenTheme[];
  addSet(args: { name: string }): ITokenSet;
  addTheme(args: { group: string; name: string }): ITokenTheme;
  getSetById(id: string): ITokenSet | undefined;
  getThemeById(id: string): ITokenTheme | undefined;
}

// ── Accessor helper ───────────────────────────────────────────────────
function catalog(): ITokenCatalog {
  // The token catalog is available as penpot.library.local.tokens
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (penpot.library.local as any).tokens as ITokenCatalog;
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
  ["font-family",    "fontFamilies"],
  ["fontSizes",      "fontSizes"],
  ["fontSize",       "fontSizes"],
  ["font-size",      "fontSizes"],
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

function serializeTypographyValue(rawValue: unknown): string {
  if (rawValue == null)             return "";
  if (typeof rawValue === "string") return rawValue;

  const obj = rawValue as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [srcKey, outKey] of TYPO_KEY_VARIANTS) {
    if (outKey in out) continue; // already captured a value for this output key
    try {
      const val = obj[srcKey];
      if (val !== undefined && val !== null) out[outKey] = val;
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

// Shadow token values are stored in Penpot as ClojureScript maps exposed
// through a JS Proxy, same as typography.  JSON.stringify on a Proxy often
// returns "{}" because the underlying CLJS properties are not JS-enumerable.
// We bypass that by explicitly reading each known property name by string key.
//
// Penpot may expose shadow fields under several key variants:
//   API canonical:  x, y, blur, spread, color, type
//   CLJS kebab:     offset-x, offset-y
//   camelCase:      offsetX, offsetY
//
// We probe all variants and emit under canonical output keys.
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

  // New Penpot API: TokenShadow.value is TokenShadowValueString[] and
  // resolvedValue is TokenShadowValue[].  Both are arrays — take the first
  // element and serialize it as a plain object.
  let src: unknown = rawValue;
  if (Array.isArray(rawValue)) {
    if (rawValue.length === 0) return "";
    src = rawValue[0];
    if (src === null) return "";
    if (typeof src === "string") return src; // alias string stored in array
    if (typeof src !== "object") return "";
  }

  const obj = src as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [srcKey, outKey] of SHADOW_KEY_VARIANTS) {
    if (outKey in out) continue; // already captured a value for this output key
    try {
      const val = obj[srcKey];
      if (val !== undefined && val !== null) out[outKey] = val;
    } catch {
      // Proxy getter threw; skip
    }
  }

  // New API uses `inset: boolean` (TokenShadowValue) or `inset: string`
  // (TokenShadowValueString) instead of `type: "drop-shadow"/"inner-shadow"`.
  // Convert to the canonical `type` key the UI normalizer expects, so
  // normalizeShadowValueToPreview doesn't need changing.
  if (!("type" in out)) {
    try {
      const inset = obj["inset"];
      if (inset === true || inset === "true") {
        out.type = "inner-shadow";
      } else if (inset !== undefined && inset !== null) {
        // false / "false" / any other value → drop-shadow (the default)
        out.type = "drop-shadow";
      }
    } catch { /* proxy threw */ }
  }

  if (Object.keys(out).length > 0) {
    return JSON.stringify(out);
  }

  // Last resort: generic stringify. May produce "{}" for opaque proxies,
  // but the explicit-key path above should always win for real Penpot tokens.
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
// resolvedValue for typography tokens is now TokenTypographyValue[] — an array
// of plain JS objects with clean JS types (numbers, string[]).  We serialise
// the first element as a JSON string so normalizeTypographyValueToForm() in
// the UI can parse it like any other typography value.
//
// Fallback: the old proxy-safe serializeTypographyValue() is still called for
// older Penpot builds that may still return a CLJS proxy object.
function serializeTypographyResolvedValue(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw;

  if (Array.isArray(raw) && raw.length > 0) {
    const first = raw[0];
    if (typeof first === "string") return first;
    if (typeof first === "object" && first !== null) {
      try {
        const str = JSON.stringify(first);
        if (str && str !== "{}") return str;
      } catch { /* fall through to proxy-safe path */ }
    }
  }

  // Fallback: proxy-safe serialiser handles older CLJS proxy objects.
  return serializeTypographyValue(raw);
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

function serializeSet(set: ITokenSet) {
  return {
    id: set.id,
    name: set.name,
    active: set.active,
    tokenCount: set.tokens.length,
  };
}

function serializeToken(token: IToken) {
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
        rv = serializeShadowValue(token.resolvedValue);
      } else if (token.type === "fontFamilies") {
        // Do NOT use resolvedValueString — it contains the raw CLJS pr-str
        // representation (EDN format, e.g. [["DM" "Sans"]] with spaces, not
        // commas), which is not human-readable.  Always use serializeFontFamilyValue
        // which handles plain strings, flat string[], and nested word-vectors.
        rv = serializeFontFamilyValue(token.resolvedValue);
      } else {
        rv = valueToString(token.resolvedValue);
      }
      resolvedValue = rv || undefined;
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

  // ── Debug log A ─────────────────────────────────────────────────────────
  // import.meta.env.DEV is replaced at build time by Vite → true in `npm run
  // dev`, stripped in production.  This avoids the __DTM_DEBUG__ runtime flag
  // which doesn't work because plugin.ts runs in a separate ClojureScript
  // sandbox whose globalThis is NOT the browser window.
  if (import.meta.env.DEV && token.type === "typography") {
    try {
      console.debug(
        "[DTM-A] typography serialised  name='" + token.name + "'"
          + "  typeof value=" + typeof token.value
          + "  serialised=" + value,
        "\n  raw value:", token.value,
      );
    } catch { /* never block serialization */ }
  }
  if (import.meta.env.DEV && token.type === "shadow") {
    try {
      console.debug(
        "[DTM-A] shadow serialised  name='" + token.name + "'"
          + "  typeof value=" + typeof token.value
          + "  serialised=" + value,
        "\n  raw value:", token.value,
      );
    } catch { /* never block serialization */ }
  }
  if (import.meta.env.DEV && token.type === "fontFamilies") {
    try {
      console.debug(
        "[DTM-A] fontFamilies serialised  name='" + token.name + "'"
          + "  typeof value=" + typeof token.value
          + "  serialised=" + value
          + "  resolvedValue(serialised)=" + resolvedValue,
        "\n  raw value:", token.value,
        "\n  raw resolvedValue:", token.resolvedValue,
      );
    } catch { /* never block serialization */ }
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

function serializeTheme(theme: ITokenTheme) {
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
  if (import.meta.env.DEV) {
    try { console.debug("[DTM] onMessage raw:", message); } catch { /* never throw */ }
  }

  const msg = unwrapMessage(message);

  if (import.meta.env.DEV) {
    try { console.debug("[DTM] onMessage unwrapped:", msg); } catch { /* never throw */ }
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
        set.addToken({
          type: msg.tokenType as string,
          name: msg.name as string,
          // fontFamilies schema: [:vector :text] — wrap plain names in an array.
          // Typography: tryParseObject + normalizeTypographyFontFamilies wraps
          //   the fontFamilies field in an array for plain names.
          // Shadow: tryParseObject + shadowValueForApi converts
          //   { type, x, y, blur, spread, color } →
          //   [{ inset, offsetX, offsetY, blur, spread, color }].
          // Others: tryParseObject converts JSON string → plain object.
          value: (msg.tokenType as string) === "fontFamilies"
            ? fontFamilyValueForApi(msg.value as string)
            : (msg.tokenType as string) === "typography"
              ? normalizeTypographyFontFamilies(tryParseObject(msg.value as string)) as string | object
              : (msg.tokenType as string) === "shadow"
                ? shadowValueForApi(tryParseObject(msg.value as string)) as string | object
                : tryParseObject(msg.value as string),
          description: msg.description as string ?? "",
        });
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

        // fontFamilies schema: [:vector :text] — wrap plain names in an array.
        // Typography: tryParseObject + normalizeTypographyFontFamilies wraps
        //   the fontFamilies field in an array for plain names.
        // Shadow: tryParseObject + shadowValueForApi converts
        //   { type, x, y, blur, spread, color } →
        //   [{ inset, offsetX, offsetY, blur, spread, color }].
        // Others: tryParseObject converts JSON string → plain object.
        const parsedValue = token.type === "fontFamilies"
          ? fontFamilyValueForApi(msg.value as string)
          : token.type === "typography"
            ? normalizeTypographyFontFamilies(tryParseObject(msg.value as string))
            : token.type === "shadow"
              ? shadowValueForApi(tryParseObject(msg.value as string))
              : tryParseObject(msg.value as string);

        if (typeof token.update === "function") {
          token.update({
            name: msg.name as string,
            value: parsedValue as string,
            description: msg.description as string,
          });
        } else {
          // Fallback: mutate properties directly.
          //
          // For fontFamilies tokens the proxy's `name` setter re-validates the
          // token against Penpot's internal schema even when the name is
          // unchanged, triggering a :malli.core/invalid-type error.  Skip the
          // assignment when the name hasn't actually changed.
          if ((msg.name as string) !== token.name) {
            token.name = msg.name as string;
          }
          // Pass parsedValue without forcing a string cast: for fontFamilies
          // it may be string[] (array) and the proxy setter accepts both forms.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (token as any).value = parsedValue;
          token.description = msg.description as string;
        }

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

        // Deep-clone the raw value.  For simple string tokens (color, spacing…)
        // this is a no-op.  For composite objects the JSON round-trip produces a
        // fully detached copy, preserving the entire nested structure and any alias
        // references (e.g. "{color.red}") verbatim.
        const rawValue = original.value as unknown;
        const clonedValue: string | object =
          typeof rawValue === "object" && rawValue !== null
            ? (JSON.parse(JSON.stringify(rawValue)) as object)
            : (rawValue as string);

        // Resolve a unique name against the *live* token list — not the UI
        // snapshot — so stale UI state can never cause an API name collision.
        const existingNames = new Set(set.tokens.map((t) => t.name));
        let copyName = `${original.name}-copy`;
        let counter = 2;
        while (existingNames.has(copyName)) {
          copyName = `${original.name}-copy-${counter++}`;
        }

        set.addToken({
          type: original.type,
          name: copyName,
          value: clonedValue,
          description: original.description ?? "",
        });

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

        toSet.addToken({
          type: token.type,
          name: token.name,
          // Pass the live value directly — already the right type (object for
          // shadow/typography, string for everything else).  Stringifying it
          // would make Penpot misread the JSON object as an alias reference.
          value: token.value as string | object,
          description: token.description ?? "",
        });

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
          if (penpot.root) {
            // find() traverses the full shape tree depth-first
            const textNodes = (penpot.root as any).find(
              (node: any) => node.type === "text"
            );
            for (const node of textNodes ?? []) {
              const n = node as any;
              // Single-font text shapes expose fontFamily at the top level
              if (typeof n.fontFamily === "string" && n.fontFamily) {
                seen.add(n.fontFamily);
              }
              // Mixed-font text: walk paragraphs → spans
              for (const para of n.paragraphs ?? n.content?.paragraphs ?? []) {
                const p = para as any;
                if (typeof p.fontFamily === "string" && p.fontFamily) seen.add(p.fontFamily);
                for (const span of p.children ?? p.characters ?? []) {
                  const s = span as any;
                  if (typeof s.fontFamily === "string" && s.fontFamily) seen.add(s.fontFamily);
                }
              }
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

      // ── Debug relay from the plugin UI iframe ─────────────────────────────
      // The plugin UI (main.ts) runs in a separate iframe that shares no
      // window / globalThis with the Penpot app.  It forwards key debug info
      // here via postMessage so it surfaces in the same Penpot DevTools console
      // where log-A above appears.
      case "dtm-debug": {
        if (import.meta.env.DEV) {
          console.debug("[DTM-relay]", msg.label ?? "", msg.payload ?? msg.data);
        }
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
