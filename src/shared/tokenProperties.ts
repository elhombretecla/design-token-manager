/**
 * shared/tokenProperties.ts
 *
 * Which shape properties each token type can be applied to, mirroring
 * Penpot's own token panel (frontend `token-properties`): the `defaults`
 * are what Penpot applies when you click a token pill, the groups list
 * every property the type accepts.
 *
 * Property names are the plugin API's camelCase `TokenProperty` names;
 * they are also the keys of `shape.tokens`.
 */

export interface PropertyGroup {
  label: string;
  props: { key: string; label: string }[];
}

const SIZE: PropertyGroup = {
  label: "Size",
  props: [{ key: "width", label: "Width" }, { key: "height", label: "Height" }],
};
const MIN_MAX: PropertyGroup = {
  label: "Min / max (layout item)",
  props: [
    { key: "layoutItemMinW", label: "Min width" },
    { key: "layoutItemMaxW", label: "Max width" },
    { key: "layoutItemMinH", label: "Min height" },
    { key: "layoutItemMaxH", label: "Max height" },
  ],
};
const GAP: PropertyGroup = {
  label: "Gap",
  props: [{ key: "rowGap", label: "Row gap" }, { key: "columnGap", label: "Column gap" }],
};
const PADDING: PropertyGroup = {
  label: "Padding",
  props: [
    { key: "paddingTop", label: "Top" },
    { key: "paddingRight", label: "Right" },
    { key: "paddingBottom", label: "Bottom" },
    { key: "paddingLeft", label: "Left" },
  ],
};
const MARGIN: PropertyGroup = {
  label: "Margin",
  props: [
    { key: "marginTop", label: "Top" },
    { key: "marginRight", label: "Right" },
    { key: "marginBottom", label: "Bottom" },
    { key: "marginLeft", label: "Left" },
  ],
};
const RADIUS: PropertyGroup = {
  label: "Border radius",
  props: [
    { key: "borderRadiusTopLeft", label: "Top left" },
    { key: "borderRadiusTopRight", label: "Top right" },
    { key: "borderRadiusBottomRight", label: "Bottom right" },
    { key: "borderRadiusBottomLeft", label: "Bottom left" },
  ],
};
const POSITION: PropertyGroup = {
  label: "Position",
  props: [{ key: "x", label: "X" }, { key: "y", label: "Y" }],
};
const STROKE_WIDTH: PropertyGroup = {
  label: "Stroke",
  props: [{ key: "strokeWidth", label: "Stroke width" }],
};

const single = (key: string, label: string): PropertyGroup => ({ label, props: [{ key, label }] });

interface TypeProperties {
  groups: PropertyGroup[];
  defaults: string[];
}

const TYPE_PROPERTIES: Record<string, TypeProperties> = {
  borderRadius: { groups: [RADIUS], defaults: RADIUS.props.map((p) => p.key) },
  shadow: { groups: [single("shadow", "Shadow")], defaults: ["shadow"] },
  color: {
    groups: [{ label: "Color", props: [{ key: "fill", label: "Fill" }, { key: "strokeColor", label: "Stroke" }] }],
    defaults: ["fill"],
  },
  dimension: {
    groups: [SIZE, POSITION, STROKE_WIDTH, RADIUS, GAP, PADDING, MARGIN, MIN_MAX],
    defaults: ["width", "height"],
  },
  sizing: { groups: [SIZE, MIN_MAX], defaults: ["width", "height"] },
  spacing: { groups: [GAP, PADDING, MARGIN], defaults: ["rowGap", "columnGap"] },
  borderWidth: { groups: [STROKE_WIDTH], defaults: ["strokeWidth"] },
  fontFamilies: { groups: [single("fontFamilies", "Font family")], defaults: ["fontFamilies"] },
  fontSizes: { groups: [single("fontSize", "Font size")], defaults: ["fontSize"] },
  fontWeights: { groups: [single("fontWeight", "Font weight")], defaults: ["fontWeight"] },
  letterSpacing: { groups: [single("letterSpacing", "Letter spacing")], defaults: ["letterSpacing"] },
  textCase: { groups: [single("textCase", "Text case")], defaults: ["textCase"] },
  textDecoration: { groups: [single("textDecoration", "Text decoration")], defaults: ["textDecoration"] },
  typography: { groups: [single("typography", "Typography")], defaults: ["typography"] },
  opacity: { groups: [single("opacity", "Opacity")], defaults: ["opacity"] },
  number: {
    groups: [{ label: "Number", props: [{ key: "rotation", label: "Rotation" }, { key: "lineHeight", label: "Line height" }] }],
    defaults: ["rotation"],
  },
  rotation: { groups: [single("rotation", "Rotation")], defaults: ["rotation"] },
};

export function propertiesForType(type: string): TypeProperties {
  return TYPE_PROPERTIES[type] ?? { groups: [], defaults: [] };
}

// Four-sided groups label their members by side only ("Top"); outside the
// group, the long form ("Padding top") is needed.
const SIDED = new Set([PADDING, MARGIN, RADIUS]);
const LABELS = new Map<string, string>();
for (const { groups } of Object.values(TYPE_PROPERTIES)) {
  for (const g of groups) {
    for (const p of g.props) {
      if (!LABELS.has(p.key)) LABELS.set(p.key, SIDED.has(g) ? `${g.label} ${p.label.toLowerCase()}` : p.label);
    }
  }
}

/** Human label for a `shape.tokens` key; unknown keys are de-camelised. */
export function propertyLabel(key: string): string {
  return LABELS.get(key) ?? key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}
