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
  value: string;        // Can be a string or a serialised object
  description: string;
  readonly resolvedValue?: string | object;
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
    resolvedValue = token.resolvedValue != null
      ? (token.type === "typography"
          ? serializeTypographyValue(token.resolvedValue)
          : valueToString(token.resolvedValue))
      : undefined;
  } catch {
    resolvedValue = undefined;
  }

  // Use the proxy-safe serializer for typography so we always emit a real
  // JSON object instead of "{}" when Penpot's ClojureScript proxy doesn't
  // expose enumerable properties.
  const value =
    token.type === "typography"
      ? serializeTypographyValue(token.value)
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
          // tryParseObject converts a JSON string like {"fontFamily":"Inter",...}
          // into a real object.  Penpot must receive an object for composite
          // types; a raw JSON string is misread as an alias reference.
          value: tryParseObject(msg.value as string),
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

        // For composite types (typography, shadow) the value arrives as a JSON
        // string from the UI.  Penpot needs a plain object, not a string that
        // happens to look like JSON.  tryParseObject handles the conversion.
        const parsedValue = tryParseObject(msg.value as string);

        if (typeof token.update === "function") {
          token.update({
            name: msg.name as string,
            value: parsedValue as string,
            description: msg.description as string,
          });
        } else {
          // Fallback: mutate properties directly
          token.name = msg.name as string;
          token.value = parsedValue as string;
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
