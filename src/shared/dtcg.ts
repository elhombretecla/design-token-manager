/**
 * shared/dtcg.ts
 *
 * Import / export of token files in the format Penpot itself reads and
 * writes (common/types/tokens_lib.cljc):
 *
 *   • Single set — a plain DTCG tree: groups are nested objects, a node with
 *     `$value` is a token, `$type` may be inherited from an enclosing group.
 *   • Multi set (Tokens Studio style) — top-level keys are set names, plus
 *     optional `$themes` and `$metadata` (tokenSetOrder, activeThemes,
 *     activeSets). Penpot treats a file as multi-set only when it has
 *     `$themes` or `$metadata`; `forceMultiSet` lets the user override that.
 *   • Legacy (pre-DTCG Tokens Studio) — `value` / `type` instead of `$value`
 *     / `$type`.
 *
 * Values are converted to and from this plugin's edit form (the strings the
 * UI shows and sends back): composites as JSON, font families as
 * "A, B", shadows as { type, x, y, blur, spread, color }.
 */

import type { CatalogSnapshot, SnapshotSet, SnapshotToken } from "./protocol";

/** The 17 token types the plugin API can create. */
export const SUPPORTED_TYPES = new Set([
  "borderRadius", "shadow", "color", "dimension", "fontFamilies", "fontSizes",
  "fontWeights", "letterSpacing", "number", "opacity", "rotation", "sizing",
  "spacing", "borderWidth", "textCase", "textDecoration", "typography",
]);

/** Alternative type names Penpot accepts on import (Tokens Studio / DTCG). */
const TYPE_ALIASES: Record<string, string> = {
  fontFamily: "fontFamilies",
  fontSize: "fontSizes",
  fontWeight: "fontWeights",
  boxShadow: "shadow",
};

// Typography field names: edit form ↔ file. On import every spelling
// Penpot understands is accepted.
const TYPO_EXPORT_KEYS: Record<string, string> = {
  fontFamilies: "fontFamilies",
  fontSizes: "fontSizes",
  fontWeight: "fontWeights",
  lineHeight: "lineHeights",
  letterSpacing: "letterSpacing",
  textCase: "textCase",
  textDecoration: "textDecoration",
};
const TYPO_IMPORT_KEYS: Record<string, string> = {
  fontFamilies: "fontFamilies", fontFamily: "fontFamilies",
  fontSizes: "fontSizes", fontSize: "fontSizes",
  fontWeights: "fontWeight", fontWeight: "fontWeight",
  lineHeights: "lineHeight", lineHeight: "lineHeight",
  letterSpacing: "letterSpacing",
  textCase: "textCase",
  textDecoration: "textDecoration",
};

const ALIAS_RE = /^\{[^{}"]+\}$/;
const isAliasString = (v: unknown): v is string => typeof v === "string" && ALIAS_RE.test(v.trim());

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

function isObject(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseJson(value: string): unknown {
  try { return JSON.parse(value); } catch { return undefined; }
}

export function splitFontFamilies(value: string): string[] {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

// ════════════════════════════════════════════════════════════════════════
//  EXPORT
// ════════════════════════════════════════════════════════════════════════

function fontFamiliesForFile(value: string): Json {
  return isAliasString(value) ? value : splitFontFamilies(value);
}

function typographyForFile(value: string): Json {
  const parsed = parseJson(value);
  if (!isObject(parsed)) return value; // alias
  const out: JsonObject = {};
  for (const [key, v] of Object.entries(parsed)) {
    const fileKey = TYPO_EXPORT_KEYS[key];
    if (!fileKey || v == null || v === "") continue;
    out[fileKey] = key === "fontFamilies" && typeof v === "string" ? fontFamiliesForFile(v) : String(v);
  }
  return out;
}

function shadowLayerForFile(layer: JsonObject): JsonObject {
  return {
    offsetX: String(layer.x ?? layer.offsetX ?? "0"),
    offsetY: String(layer.y ?? layer.offsetY ?? "0"),
    blur: String(layer.blur ?? "0"),
    spread: String(layer.spread ?? "0"),
    color: String(layer.color ?? ""),
    inset: layer.type === "inner-shadow" || layer.inset === true || layer.inset === "true",
  };
}

function shadowForFile(value: string): Json {
  const parsed = parseJson(value);
  if (isObject(parsed)) return [shadowLayerForFile(parsed)];
  if (Array.isArray(parsed)) return parsed.filter(isObject).map(shadowLayerForFile);
  return value; // alias
}

export function valueForFile(type: string, value: string): Json {
  switch (type) {
    case "fontFamilies": return fontFamiliesForFile(value);
    case "typography": return typographyForFile(value);
    case "shadow": return shadowForFile(value);
    default: return value;
  }
}

/**
 * Nest tokens by their dot-separated names. Names that collide with a group
 * ("color" and "color.red") can't be represented; they are reported.
 */
function tokensTree(tokens: SnapshotToken[], warnings: string[], setName: string): JsonObject {
  const root: JsonObject = {};
  for (const token of tokens) {
    const path = token.name.split(".");
    let node = root;
    let ok = true;
    for (const part of path.slice(0, -1)) {
      const next = node[part];
      if (next === undefined) {
        node = node[part] = {};
      } else if (isObject(next) && !("$value" in next)) {
        node = next;
      } else {
        ok = false;
        break;
      }
    }
    const leaf = path[path.length - 1];
    if (!ok || node[leaf] !== undefined) {
      warnings.push(`"${setName}": skipped ${token.name} (its name clashes with a group of tokens)`);
      continue;
    }
    const entry: JsonObject = { $value: valueForFile(token.type, token.value), $type: token.type };
    if (token.description) entry.$description = token.description;
    node[leaf] = entry;
  }
  return root;
}

export interface ExportResult {
  data: JsonObject;
  warnings: string[];
}

/** One set as a plain DTCG file (Penpot names the set after the file). */
export function exportSingleSet(set: SnapshotSet): ExportResult {
  const warnings: string[] = [];
  return { data: tokensTree(set.tokens, warnings, set.name), warnings };
}

/** Several sets (all by default) with themes and metadata, as Penpot exports. */
export function exportMultiSet(snapshot: CatalogSnapshot, setIds?: string[]): ExportResult {
  const warnings: string[] = [];
  const wanted = setIds ? new Set(setIds) : null;
  const sets = snapshot.sets.filter((s) => !wanted || wanted.has(s.id));
  const names = new Map(snapshot.sets.map((s) => [s.id, s.name]));

  const data: JsonObject = {};
  for (const set of sets) data[set.name] = tokensTree(set.tokens, warnings, set.name);

  data.$themes = snapshot.themes.map((t) => {
    const theme: JsonObject = {
      name: t.name,
      group: t.group,
      selectedTokenSets: Object.fromEntries(
        t.setIds.filter((id) => names.has(id)).map((id) => [names.get(id)!, "enabled"]),
      ),
    };
    return theme;
  });
  data.$metadata = {
    tokenSetOrder: sets.map((s) => s.name),
    activeThemes: snapshot.themes.filter((t) => t.active).map((t) => (t.group ? `${t.group}/${t.name}` : t.name)),
    activeSets: sets.filter((s) => s.active).map((s) => s.name),
  };
  return { data, warnings };
}

// ════════════════════════════════════════════════════════════════════════
//  IMPORT
// ════════════════════════════════════════════════════════════════════════

export interface ImportedToken {
  name: string;
  type: string;
  /** Edit form, as the plugin's `create-token` expects. */
  value: string;
  description: string;
}

export interface ImportedSet {
  name: string;
  tokens: ImportedToken[];
}

export interface ImportedTheme {
  group: string;
  name: string;
  setNames: string[];
}

export interface ImportResult {
  multiSet: boolean;
  /** True when the file says nothing about sets (no $themes / $metadata). */
  ambiguous: boolean;
  sets: ImportedSet[];
  themes: ImportedTheme[];
  warnings: string[];
}

function scalarToString(v: Json): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (isObject(v)) {
    // DTCG 2025 structured values.
    if (typeof v.hex === "string") return v.hex;                       // color
    if (v.value != null && typeof v.unit === "string") return `${v.value}${v.unit}`; // dimension
  }
  return JSON.stringify(v);
}

function fontFamiliesFromFile(v: Json): string {
  if (Array.isArray(v)) return v.map(scalarToString).filter(Boolean).join(", ");
  return scalarToString(v);
}

function typographyFromFile(v: Json): string {
  if (!isObject(v)) return scalarToString(v);
  const out: Record<string, string> = {};
  for (const [key, field] of Object.entries(v)) {
    const formKey = TYPO_IMPORT_KEYS[key];
    if (!formKey || formKey in out) continue;
    out[formKey] = formKey === "fontFamilies" ? fontFamiliesFromFile(field) : scalarToString(field);
  }
  return JSON.stringify(out);
}

function shadowLayerFromFile(layer: JsonObject): Record<string, string> {
  const inset = layer.inset === true || layer.inset === "true" || layer.type === "innerShadow" || layer.type === "inner-shadow";
  return {
    type: inset ? "inner-shadow" : "drop-shadow",
    x: scalarToString(layer.offsetX ?? layer.x ?? "0"),
    y: scalarToString(layer.offsetY ?? layer.y ?? "0"),
    blur: scalarToString(layer.blur ?? "0"),
    spread: scalarToString(layer.spread ?? "0"),
    color: scalarToString(layer.color ?? ""),
  };
}

function shadowFromFile(v: Json): string {
  if (isObject(v)) return JSON.stringify(shadowLayerFromFile(v));
  if (Array.isArray(v)) {
    const layers = v.filter(isObject).map(shadowLayerFromFile);
    return JSON.stringify(layers.length === 1 ? layers[0] : layers);
  }
  return scalarToString(v);
}

export function valueFromFile(type: string, v: Json): string {
  switch (type) {
    case "fontFamilies": return fontFamiliesFromFile(v);
    case "typography": return typographyFromFile(v);
    case "shadow": return shadowFromFile(v);
    default: return scalarToString(v);
  }
}

interface Keys { value: string; type: string; description: string }
const DTCG_KEYS: Keys = { value: "$value", type: "$type", description: "$description" };
const LEGACY_KEYS: Keys = { value: "value", type: "type", description: "description" };

/** Penpot's format sniffing: the first token-looking node decides. */
function detectKeys(node: Json): Keys {
  const stack: Json[] = [node];
  while (stack.length) {
    const n = stack.pop()!;
    if (!isObject(n)) continue;
    if ("$value" in n) return DTCG_KEYS;
    if ("value" in n && typeof n.type === "string") return LEGACY_KEYS;
    for (const [k, child] of Object.entries(n)) {
      if (k !== "$themes" && k !== "$metadata") stack.push(child);
    }
  }
  return DTCG_KEYS;
}

function flattenTokens(
  node: JsonObject,
  keys: Keys,
  prefix: string,
  inheritedType: string | undefined,
  out: ImportedToken[],
  skipped: Map<string, number>,
): void {
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith("$") || !isObject(child)) continue;
    const name = prefix ? `${prefix}.${key}` : key;
    const ownType = typeof child[keys.type] === "string" ? (child[keys.type] as string) : undefined;

    if (!(keys.value in child)) {
      flattenTokens(child, keys, name, ownType ?? inheritedType, out, skipped);
      continue;
    }
    const rawType = ownType ?? inheritedType ?? "";
    const type = TYPE_ALIASES[rawType] ?? rawType;
    if (!SUPPORTED_TYPES.has(type)) {
      skipped.set(rawType || "(no type)", (skipped.get(rawType || "(no type)") ?? 0) + 1);
      continue;
    }
    const description = child[keys.description];
    out.push({
      name,
      type,
      value: valueFromFile(type, child[keys.value]),
      description: typeof description === "string" ? description : "",
    });
  }
}

function normalizeSetName(name: string): string {
  return name.split("/").map((s) => s.trim()).filter(Boolean).join("/");
}

export function setNameFromFileName(fileName: string): string {
  return normalizeSetName(fileName.replace(/\.json$/i, "")) || "imported";
}

/**
 * Parse a decoded token file. `singleSetName` names the set of a single-set
 * file; `forceMultiSet` reads top-level keys as sets even without metadata.
 */
export function parseTokenFile(
  json: unknown,
  singleSetName: string,
  forceMultiSet = false,
): ImportResult {
  if (!isObject(json)) throw new Error("The file must contain a JSON object.");
  const keys = detectKeys(json);
  const hasMeta = "$themes" in json || "$metadata" in json;
  const multiSet = hasMeta || forceMultiSet;
  const skipped = new Map<string, number>();
  const warnings: string[] = [];
  const sets: ImportedSet[] = [];

  if (!multiSet) {
    const tokens: ImportedToken[] = [];
    flattenTokens(json, keys, "", undefined, tokens, skipped);
    sets.push({ name: normalizeSetName(singleSetName) || "imported", tokens });
  } else {
    const meta = isObject(json.$metadata) ? json.$metadata : {};
    const order = Array.isArray(meta.tokenSetOrder) ? meta.tokenSetOrder.filter((s): s is string => typeof s === "string") : [];
    const setKeys = Object.keys(json).filter((k) => !k.startsWith("$") && isObject(json[k]));
    const ordered = [...new Set([...order.filter((k) => setKeys.includes(k)), ...setKeys])];
    for (const key of ordered) {
      const tokens: ImportedToken[] = [];
      flattenTokens(json[key] as JsonObject, keys, "", undefined, tokens, skipped);
      sets.push({ name: normalizeSetName(key), tokens });
    }
  }

  const setNames = new Set(sets.map((s) => s.name));
  const themes: ImportedTheme[] = [];
  if (multiSet && Array.isArray(json.$themes)) {
    for (const t of json.$themes) {
      if (!isObject(t) || typeof t.name !== "string") continue;
      const selected = isObject(t.selectedTokenSets) ? t.selectedTokenSets : {};
      themes.push({
        group: typeof t.group === "string" ? t.group : "",
        name: t.name,
        setNames: Object.entries(selected)
          .filter(([, status]) => status === "enabled" || status === "source")
          .map(([name]) => normalizeSetName(name))
          .filter((name) => setNames.has(name)),
      });
    }
  }

  for (const [type, count] of skipped) {
    warnings.push(`Skipped ${count} token${count === 1 ? "" : "s"} of unsupported type "${type}"`);
  }
  return { multiSet, ambiguous: !hasMeta, sets, themes, warnings };
}
