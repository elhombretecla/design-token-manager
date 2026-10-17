/**
 * ui/components/cells.tsx
 *
 * Rendering of token values: plain values, alias chips, mixed values
 * ("{a} * 2"), composite previews (typography, shadow) and the resolved
 * value with its problems. Used by the token table, the comparison and the
 * selection panel.
 *
 * Pass `editable` (with the token's set) to make alias chips open the alias
 * editor; without it chips are read-only.
 */

import type { JSX } from "preact";
import type { SerializedToken } from "../../shared/types";
import { isAlias, parseMixedValue } from "../../utils/alias";
import { normalizeShadowLayers, normalizeShadowValueToPreview } from "../../utils/shadowNormalize";
import { normalizeTypographyValueToForm } from "../../utils/typographyNormalize";
import { Icon, TypeIcon } from "../icons";
import { COMPOSITE_PROP_TYPE, TYPOGRAPHY_PROPS } from "../lib/tokenTypes";
import { toggleAliasEditor } from "./pickers/aliasEditorState";

const MIXED_RE = /\{[^{}]+\}/;

export interface Editable {
  setId: string;
  tokenId: string;
}

export function ColorSwatch({ color }: { color: string | undefined }) {
  if (!color) return null;
  return <span class="color-swatch" style={{ background: color }} aria-hidden="true" />;
}

function openEditor(e: Event, editable: Editable, propKey?: string) {
  e.stopPropagation();
  const propType = propKey ? COMPOSITE_PROP_TYPE[propKey] : undefined;
  toggleAliasEditor({
    setId: editable.setId,
    tokenId: editable.tokenId,
    composite: propKey && propType ? { propKey, propType } : undefined,
    anchor: e.currentTarget as HTMLElement,
  });
}

function chipKeyDown(e: KeyboardEvent) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    (e.currentTarget as HTMLElement).click();
  }
}

/** A `{name}` reference. Interactive when `editable` is given. */
export function AliasChip(props: {
  name: string;
  swatch?: string;
  broken?: boolean;
  inline?: boolean;
  editable?: Editable;
  propKey?: string;
}): JSX.Element {
  const { name, swatch, broken, inline, editable, propKey } = props;
  const title = broken ? `Broken reference: {${name}}` : `{${name}}`;
  const cls = `alias-chip${inline ? " alias-chip--inline" : ""}${broken ? " alias-chip--broken" : ""}`;
  if (!editable) {
    return (
      <span class={cls} title={title}>
        <ColorSwatch color={swatch} />
        <span class="alias-chip-name">{name}</span>
      </span>
    );
  }
  return (
    <div
      class={cls}
      title={title}
      role="button"
      tabIndex={0}
      aria-label={`Alias ${name}. Change reference`}
      onClick={(e) => openEditor(e, editable, propKey)}
      onKeyDown={chipKeyDown}
    >
      <ColorSwatch color={swatch} />
      <span class="alias-chip-name">{name}</span>
      <Icon name="aliasGear" />
    </div>
  );
}

/** One field of a composite value: alias chip, mixed value or text. */
function SubValue({ value, editable, propKey }: { value: string; editable?: Editable; propKey?: string }) {
  if (!value) return <span class="cprop-val cprop-val--muted">—</span>;
  if (isAlias(value)) {
    const interactive = editable && propKey && COMPOSITE_PROP_TYPE[propKey] ? editable : undefined;
    return <AliasChip name={value.trim().slice(1, -1)} editable={interactive} propKey={propKey} />;
  }
  if (MIXED_RE.test(value)) {
    return (
      <>
        {parseMixedValue(value).map((seg, i) =>
          seg.kind === "alias"
            ? <AliasChip key={i} name={seg.name} />
            : <span key={i} class="cprop-val">{seg.content}</span>,
        )}
      </>
    );
  }
  return <span class="cprop-val">{value}</span>;
}

const COMPOSITE_MAX_VISIBLE = 4;

export function TypographyPreview({ form, editable }: { form: Record<string, string>; editable?: Editable }) {
  const entries = TYPOGRAPHY_PROPS
    .map((p) => ({ ...p, value: form[p.key] ?? "" }))
    // Skip empty, "none", "normal" to keep the preview compact
    .filter(({ value }) => value !== "" && value !== "none" && value !== "normal");
  if (entries.length === 0) return <span class="composite-empty">—</span>;
  const visible = entries.slice(0, COMPOSITE_MAX_VISIBLE);
  const hidden = entries.slice(COMPOSITE_MAX_VISIBLE);
  return (
    <div class="composite-preview">
      {visible.map(({ key, label, iconKey, value }) => (
        <span key={key} class="cprop" title={`${label}: ${value}`}>
          <TypeIcon type={iconKey} />
          <SubValue value={value} editable={editable} propKey={key} />
        </span>
      ))}
      {hidden.length > 0 && (
        <span class="cprop-more" title={hidden.map((e) => `${e.label}: ${e.value}`).join(", ")}>
          +{hidden.length}
        </span>
      )}
    </div>
  );
}

export function ShadowPreview(props: { layer: Record<string, string>; layerCount: number; editable?: Editable }) {
  const { layer: v, layerCount, editable } = props;
  if (!v || Object.keys(v).length === 0) return <span class="composite-empty">—</span>;
  const parts: JSX.Element[] = [];
  if (layerCount > 1) {
    parts.push(<span key="n" class="cprop-badge" title={`${layerCount} shadow layers`}>{layerCount} layers</span>);
  }
  if (v.type && v.type !== "drop-shadow") parts.push(<span key="t" class="cprop-badge">{v.type}</span>);
  if (v.color) {
    parts.push(
      <span key="c" class="cprop" title={`Color: ${v.color}`}>
        {MIXED_RE.test(v.color)
          ? <><TypeIcon type="color" /><SubValue value={v.color} editable={editable} propKey="color" /></>
          : <><ColorSwatch color={v.color} /><span class="cprop-val">{v.color}</span></>}
      </span>,
    );
  }
  if (v.x || v.y) {
    parts.push(
      <span key="xy" class="cprop" title={[v.x && `x: ${v.x}`, v.y && `y: ${v.y}`].filter(Boolean).join(", ")}>
        <TypeIcon type="dimension" />
        {v.x && <SubValue value={v.x} editable={editable} propKey="x" />}
        {v.x && v.y && <span class="cprop-sep">,</span>}
        {v.y && <SubValue value={v.y} editable={editable} propKey="y" />}
      </span>,
    );
  }
  if (v.blur) {
    parts.push(
      <span key="b" class="cprop" title={`Blur: ${v.blur}`}>
        <TypeIcon type="opacity" />
        <SubValue value={v.blur} editable={editable} propKey="blur" />
      </span>,
    );
  }
  if (v.spread && v.spread !== "0") {
    parts.push(
      <span key="s" class="cprop" title={`Spread: ${v.spread}`}>
        <TypeIcon type="dimension" />
        <SubValue value={v.spread} editable={editable} propKey="spread" />
      </span>,
    );
  }
  if (parts.length === 0) return <span class="composite-empty">—</span>;
  return <div class="composite-preview">{parts}</div>;
}

/** The raw value as written: alias chips, mixed values, composite previews. */
export function ValueCell({ token, editable }: { token: SerializedToken; editable?: Editable }) {
  if (token.type === "typography") {
    return <TypographyPreview form={normalizeTypographyValueToForm(token.value)} editable={editable} />;
  }
  if (token.type === "shadow") {
    return (
      <ShadowPreview
        layer={normalizeShadowValueToPreview(token.value)}
        layerCount={normalizeShadowLayers(token.value).length}
        editable={editable}
      />
    );
  }
  const missing = new Set(token.missingRefs ?? []);
  if (isAlias(token.value)) {
    const name = token.value.trim().slice(1, -1).trim();
    return (
      <AliasChip
        name={name}
        swatch={token.type === "color" ? token.resolvedValue : undefined}
        broken={missing.has(name)}
        editable={editable}
      />
    );
  }
  if (!MIXED_RE.test(token.value)) {
    return (
      <>
        {token.type === "color" && <ColorSwatch color={token.resolvedValue ?? token.value} />}
        <span class="token-value-text" title={token.value}>{token.value}</span>
      </>
    );
  }
  // Mixed value. "Broken" means missing in the resolution context, not just
  // in this set — references to other sets are normal.
  return (
    <div class="mixed-value-cell">
      {parseMixedValue(token.value).map((seg, i) => {
        if (seg.kind !== "alias") return <span key={i} class="mixed-value-text">{seg.content}</span>;
        const broken = missing.has(seg.name.trim());
        if (broken) {
          return <span key={i} class="mixed-alias-broken" title={`Broken reference: {${seg.name}}`}>{`{${seg.name}}`}</span>;
        }
        return <AliasChip key={i} name={seg.name} inline editable={editable} />;
      })}
    </div>
  );
}

/** Plain (non-alias) fields of a resolved composite, completed from the raw value. */
function resolvedCompositeForm(token: SerializedToken, normalize: (v: string) => Record<string, string>) {
  const form = normalize(token.resolvedValue ?? token.value);
  if (token.resolvedValue) {
    const raw = normalize(token.value);
    for (const [key, v] of Object.entries(raw)) {
      if (!form[key] && v && !isAlias(v)) form[key] = v;
    }
  }
  // The resolved column never shows references.
  for (const key of Object.keys(form)) if (isAlias(form[key])) delete form[key];
  return form;
}

/** The value after resolving references and math, or why it can't be. */
export function ResolvedCell({ token }: { token: SerializedToken }) {
  if (token.resolveStatus === "broken" && token.resolvedValue === undefined) {
    const missing = (token.missingRefs ?? []).map((n) => `{${n}}`).join(", ");
    return <span class="token-resolved-issue" title={`Not found in this context: ${missing}`}>Missing {missing}</span>;
  }
  if (token.resolveStatus === "cycle" && token.resolvedValue === undefined) {
    return <span class="token-resolved-issue" title="These references point back to this token">Circular reference</span>;
  }
  if (token.resolveStatus === "invalid") {
    return (
      <span class="token-resolved-text token-resolved-text--warn" title={token.resolveError ?? "Invalid value"}>
        {token.resolvedValue ?? token.value}
      </span>
    );
  }
  if (token.type === "typography") {
    return <TypographyPreview form={resolvedCompositeForm(token, normalizeTypographyValueToForm)} />;
  }
  if (token.type === "shadow") {
    return (
      <ShadowPreview
        layer={resolvedCompositeForm(token, normalizeShadowValueToPreview)}
        layerCount={normalizeShadowLayers(token.resolvedValue ?? token.value).length}
      />
    );
  }
  const raw = token.resolvedValue ?? token.value;
  return <span class="token-resolved-text" title={raw}>{raw}</span>;
}
