/**
 * ui/lib/tokenTypes.ts
 *
 * Token type metadata for the UI (labels, placeholders, fixed option lists)
 * and helpers to read / rebuild one field of a composite value (typography,
 * shadow) in the edit form shape.
 */

import { normalizeShadowLayers, normalizeShadowValueToPreview, shadowLayersToValue } from "../../utils/shadowNormalize";
import { normalizeTypographyValueToForm, sanitizeTypographyValueForApi } from "../../utils/typographyNormalize";

export interface TokenTypeDef {
  value: string;
  label: string;
  placeholder: string;
}

export const TOKEN_TYPES: TokenTypeDef[] = [
  { value: "color", label: "Color", placeholder: "Enter a value or alias with {alias}" },
  { value: "borderRadius", label: "Border Radius", placeholder: "e.g. 4px or {alias.radius}" },
  { value: "dimension", label: "Dimension", placeholder: "e.g. 16px or {alias}" },
  { value: "fontFamilies", label: "Font Family", placeholder: "e.g. Inter, sans-serif" },
  { value: "fontSizes", label: "Font Size", placeholder: "e.g. 16px or {alias}" },
  { value: "fontWeights", label: "Font Weight", placeholder: "e.g. 400 or bold" },
  { value: "letterSpacing", label: "Letter Spacing", placeholder: "e.g. 0.05em or {alias}" },
  { value: "number", label: "Number", placeholder: "e.g. 8" },
  { value: "opacity", label: "Opacity", placeholder: "e.g. 0.5 or 50%" },
  { value: "rotation", label: "Rotation", placeholder: "e.g. 45" },
  { value: "shadow", label: "Shadow", placeholder: "" },
  { value: "sizing", label: "Sizing", placeholder: "e.g. 100px or {alias}" },
  { value: "spacing", label: "Spacing", placeholder: "e.g. 8px or {alias}" },
  { value: "borderWidth", label: "Stroke Width", placeholder: "e.g. 1px or {alias}" },
  { value: "textCase", label: "Text Case", placeholder: "uppercase | lowercase | capitalize | none" },
  { value: "textDecoration", label: "Text Decoration", placeholder: "none | underline | strike-through" },
  { value: "typography", label: "Typography", placeholder: "" },
];

export function getTypeDef(value: string): TokenTypeDef {
  return TOKEN_TYPES.find((t) => t.value === value) ?? TOKEN_TYPES[0];
}

export const COMPOSITE_TYPES = new Set(["typography", "shadow"]);

/** Types whose value is picked from a fixed list. */
export const SELECT_OPTIONS: Record<string, string[]> = {
  textCase: ["none", "uppercase", "lowercase", "capitalize"],
  // Penpot's value is "strike-through" (not CSS's "line-through").
  textDecoration: ["none", "underline", "strike-through"],
};

/** Tokens created by earlier versions of the plugin used "line-through". */
export function legacyTextDecoration(value: string): string {
  return value === "line-through" ? "strike-through" : value;
}

export const DEFAULT_SHADOW_LAYER: Readonly<Record<string, string>> = {
  type: "drop-shadow", x: "0", y: "4", blur: "8", spread: "0", color: "rgba(0,0,0,0.25)",
};

export interface CompositePropDef {
  key: string;
  label: string;
  /** Token type whose icon represents this field. */
  iconKey: string;
}

/** Typography fields in the form shape of normalizeTypographyValueToForm. */
export const TYPOGRAPHY_PROPS: CompositePropDef[] = [
  { key: "fontFamily", label: "Family", iconKey: "fontFamilies" },
  { key: "fontSize", label: "Size", iconKey: "fontSizes" },
  { key: "fontWeight", label: "Weight", iconKey: "fontWeights" },
  { key: "lineHeight", label: "Line Height", iconKey: "dimension" },
  { key: "letterSpacing", label: "Spacing", iconKey: "letterSpacing" },
  { key: "textCase", label: "Case", iconKey: "textCase" },
  { key: "textDecoration", label: "Decoration", iconKey: "textDecoration" },
];

/** Token type a composite field may alias (for the alias pickers). */
export const COMPOSITE_PROP_TYPE: Record<string, string> = {
  // Shadow fields
  color: "color",
  x: "dimension",
  y: "dimension",
  blur: "dimension",
  spread: "dimension",
  // Typography fields (form keys)
  fontFamily: "fontFamilies",
  fontSize: "fontSizes",
  fontWeight: "fontWeights",
  // Penpot has no lineHeight token type; line heights reference numbers.
  lineHeight: "number",
  letterSpacing: "letterSpacing",
  textCase: "textCase",
  textDecoration: "textDecoration",
};

/** Typography form shape → the plugin's edit value (API key names). */
export function typographyFormToValue(form: Record<string, string>): string {
  return JSON.stringify(sanitizeTypographyValueForApi({
    fontFamilies: form.fontFamily ?? "",
    fontSizes: form.fontSize ?? "",
    fontWeight: form.fontWeight ?? "",
    lineHeight: form.lineHeight ?? "",
    letterSpacing: form.letterSpacing ?? "",
    textCase: form.textCase ?? "",
    textDecoration: form.textDecoration ?? "",
  }));
}

/** Current value of one composite field (shadows: first layer). */
export function getCompositeSubValue(type: string, value: string, propKey: string): string {
  if (type === "shadow") return normalizeShadowValueToPreview(value)[propKey] ?? "";
  if (type === "typography") return normalizeTypographyValueToForm(value)[propKey] ?? "";
  return "";
}

/** Rebuild a composite value after changing one field (shadows: first layer). */
export function withCompositeSubValue(type: string, value: string, propKey: string, next: string): string {
  if (type === "shadow") {
    const layers = normalizeShadowLayers(value);
    const u = { ...(layers[0] ?? {}), [propKey]: next };
    layers[0] = {
      type: u.type ?? "drop-shadow",
      x: u.x ?? "0",
      y: u.y ?? "0",
      blur: u.blur ?? "0",
      spread: u.spread ?? "0",
      color: u.color ?? "rgba(0,0,0,0.25)",
    };
    return shadowLayersToValue(layers);
  }
  if (type === "typography") {
    return typographyFormToValue({ ...normalizeTypographyValueToForm(value), [propKey]: next });
  }
  return value;
}
