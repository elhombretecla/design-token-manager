/**
 * ui/components/SelectionPanel.tsx
 *
 * Collapsible bottom panel with the shapes selected in Penpot and the
 * tokens applied to them. Penpot applies tokens by name and resolves them
 * with the active sets, so applied tokens are located and resolved there.
 */

import { propertyLabel } from "../../shared/tokenProperties";
import { runOps, showToast } from "../bridge";
import { Icon } from "../icons";
import { plural } from "../lib/names";
import { activeResolver, locateTokenName, revealToken, selection, selectionOpen, toggleSelectionPanel } from "../store";
import { ColorSwatch } from "./cells";

function shortValue(type: string, value: string | undefined): string {
  if (value === undefined) return "";
  if (type === "typography" || type === "shadow") return type;
  return value.length > 28 ? `${value.slice(0, 27)}…` : value;
}

function AppliedToken({ shapeId, prop, name }: { shapeId: string; prop: string; name: string }) {
  const loc = locateTokenName(name);
  const r = loc?.active ? activeResolver().resolveName(name) : undefined;
  let status = "ok";
  let title = `Show ${name}`;
  if (!loc) {
    status = "missing";
    title = `No set defines ${name}`;
  } else if (!loc.active) {
    status = "inactive";
    title = `${name} is only defined in inactive sets ("${loc.set.name}"), so Penpot can't resolve it`;
  } else if (r && r.status !== "ok") {
    status = "broken";
    title = `${name} doesn't resolve with the active sets`;
  }
  const label = propertyLabel(prop);

  return (
    <li class="sel-token">
      <span class="sel-prop body-s">{label}</span>
      <button
        type="button"
        class={`sel-chip sel-chip--${status}`}
        title={title}
        onClick={() => {
          if (loc) revealToken(loc.set.id, loc.token.id);
          else showToast(`No set defines ${name}`, "error");
        }}
      >
        {name}
      </button>
      <span class="sel-value body-s">
        {loc?.token.type === "color" && <ColorSwatch color={r?.value} />}
        {shortValue(loc?.token.type ?? "", r?.value)}
      </span>
      <button
        type="button"
        class="icon-btn sel-remove"
        title="Remove from this shape"
        aria-label={`Remove ${name} from ${label}`}
        onClick={() => void runOps([{ op: "unapply-token", tokenName: name, shapeIds: [shapeId], properties: [prop] }])}
      >
        <Icon name="close10" />
      </button>
    </li>
  );
}

export function SelectionPanel() {
  const { shapes, total } = selection.value;
  const open = selectionOpen.value;
  const applied = shapes.reduce((n, s) => n + Object.keys(s.tokens).length, 0);

  return (
    <section class={`selection-panel${open ? " is-open" : ""}`} aria-label="Selection">
      <button
        type="button"
        class="selection-bar"
        aria-expanded={open}
        aria-controls="selection-body"
        onClick={toggleSelectionPanel}
      >
        <span class="selection-bar-title body-s">Selection</span>
        <span class="selection-bar-summary body-s">
          {total === 0 ? "No shapes selected" : `${plural(total, "shape")} · ${plural(applied, "applied token")}`}
        </span>
        <Icon name="chevUpSmall" />
      </button>
      {open && (
        <div class="selection-body" id="selection-body">
          {total === 0 ? (
            <p class="body-s selection-empty">
              Select shapes in Penpot to see their tokens here. To apply a token, use{" "}
              <strong>Apply to selection…</strong> in its menu.
            </p>
          ) : (
            <>
              {shapes.map((shape) => {
                const entries = Object.entries(shape.tokens);
                return (
                  <div key={shape.id} class="sel-shape">
                    <div class="sel-shape-head body-s">
                      <span class="sel-shape-name">{shape.name}</span>
                      <span class="sel-shape-type">{shape.type}</span>
                    </div>
                    {entries.length === 0 ? (
                      <p class="sel-none body-s">No tokens applied</p>
                    ) : (
                      <ul class="sel-tokens">
                        {entries.map(([prop, name]) => (
                          <AppliedToken key={prop} shapeId={shape.id} prop={prop} name={name} />
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
              {total > shapes.length && (
                <p class="body-s selection-empty">…and {plural(total - shapes.length, "more shape")}</p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
