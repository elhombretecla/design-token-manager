/**
 * ui/components/pickers/ColorPicker.tsx
 *
 * Color value input: a swatch that opens an HSV picker (saturation/value
 * area, hue and alpha sliders, HEX / RGB / HSL fields), the text input, and
 * optionally the alias-insert button. The picker writes hex when opaque and
 * rgba() otherwise.
 */

import { useRef, useState } from "preact/hooks";
import { hexToRgb, hslToRgb, hsvToRgb, parseCssColor, rgbToHex, rgbToHsl, rgbToHsv } from "../../../utils/color";
import { useAnchoredPosition, useEscape, useOutsideClick } from "../../overlays";
import { AliasTrigger } from "./AliasPicker";

interface Hsva {
  h: number; // 0-360
  s: number; // 0-100
  v: number; // 0-100
  a: number; // 0-100
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function fromCss(value: string): Hsva {
  const parsed = parseCssColor(value);
  if (!parsed) return { h: 0, s: 0, v: 0, a: 100 };
  const [h, s, v] = rgbToHsv(parsed[0], parsed[1], parsed[2]);
  return { h, s, v, a: Math.round(parsed[3] * 100) };
}

function toCss({ h, s, v, a }: Hsva): string {
  const [r, g, b] = hsvToRgb(h, s, v);
  return a < 100 ? `rgba(${r}, ${g}, ${b}, ${(a / 100).toFixed(2)})` : rgbToHex(r, g, b);
}

export function ColorInput(props: {
  id: string;
  value: string;
  onInput(v: string): void;
  placeholder?: string;
  /** Show the alias-insert button for tokens of this type. */
  aliasType?: string;
}) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const swatchRef = useRef<HTMLButtonElement>(null);

  return (
    <div class="value-input-wrapper">
      <button
        ref={swatchRef}
        type="button"
        class="color-swatch-small color-swatch-btn"
        style={{ background: props.value || "#cccccc" }}
        title="Pick a color"
        aria-label="Pick a color"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      />
      <input
        ref={inputRef}
        type="text"
        id={props.id}
        class="input form-input has-swatch"
        value={props.value}
        placeholder={props.placeholder}
        autocomplete="off"
        onInput={(e) => props.onInput((e.target as HTMLInputElement).value)}
      />
      {props.aliasType && <AliasTrigger tokenType={props.aliasType} onPick={(name) => props.onInput(`{${name}}`)} />}
      {open && inputRef.current && (
        <ColorPopover
          anchor={inputRef.current}
          swatch={swatchRef}
          initial={props.value}
          onChange={props.onInput}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/** Track drag: calls `onMove` with the pointer position inside `target`. */
function startDrag(e: MouseEvent, onMove: (x: number, y: number, w: number, h: number) => void) {
  e.preventDefault();
  const target = e.currentTarget as HTMLElement;
  const fire = (ev: MouseEvent) => {
    const r = target.getBoundingClientRect();
    onMove(ev.clientX - r.left, ev.clientY - r.top, r.width, r.height);
  };
  fire(e);
  const up = () => {
    document.removeEventListener("mousemove", fire);
    document.removeEventListener("mouseup", up);
  };
  document.addEventListener("mousemove", fire);
  document.addEventListener("mouseup", up);
}

type Mode = "hex" | "rgb" | "hsl";
const MODES: Mode[] = ["hex", "rgb", "hsl"];

function ColorPopover(props: {
  anchor: HTMLElement;
  swatch: { current: Element | null };
  initial: string;
  onChange(v: string): void;
  onClose(): void;
}) {
  const [color, setColor] = useState<Hsva>(() => fromCss(props.initial));
  const [mode, setMode] = useState<Mode>("hex");
  const ref = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<Element | null>(props.anchor);

  useAnchoredPosition(props.anchor, ref, { width: 240, gap: 6 });
  useEscape(props.onClose);
  useOutsideClick([ref, anchorRef, props.swatch], props.onClose);

  const update = (next: Hsva) => {
    setColor(next);
    props.onChange(toCss(next));
  };

  const { h, s, v, a } = color;
  const [r, g, b] = hsvToRgb(h, s, v);
  const [hl, sl, ll] = rgbToHsl(r, g, b);

  // Number fields keep what's being typed; they re-sync when not focused.
  const field = (label: string, val: number, max: number, onValue: (n: number) => void) => (
    <input
      class="cp-field"
      type="number"
      min={0}
      max={max}
      aria-label={label}
      value={String(Math.round(val))}
      onInput={(e) => onValue(clamp(parseInt((e.target as HTMLInputElement).value) || 0, 0, max))}
    />
  );
  const setRgb = (nr: number, ng: number, nb: number) => {
    const [nh, ns, nv] = rgbToHsv(nr, ng, nb);
    update({ h: nh, s: ns, v: nv, a });
  };
  const setHsl = (nh: number, ns: number, nl: number) => {
    const [cr, cg, cb] = hslToRgb(nh, ns, nl);
    setRgb(cr, cg, cb);
  };

  return (
    <div ref={ref} class="cp-popover" role="dialog" aria-label="Color picker">
      <div
        class="cp-sv-area"
        style={{
          background: `linear-gradient(to bottom, transparent, #000), linear-gradient(to right, #fff, transparent), hsl(${h}deg, 100%, 50%)`,
        }}
        onMouseDown={(e) => startDrag(e, (x, y, w, hh) =>
          update({ h, a, s: clamp((x / w) * 100, 0, 100), v: clamp(100 - (y / hh) * 100, 0, 100) }))}
      >
        <div
          class="cp-sv-cursor"
          style={{ left: `${s}%`, top: `${100 - v}%`, borderColor: v > 45 ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.8)" }}
        />
      </div>
      <div class="cp-sliders-wrap">
        <div
          class="cp-track cp-hue-track"
          role="slider"
          tabIndex={0}
          aria-label="Hue"
          aria-valuemin={0}
          aria-valuemax={360}
          aria-valuenow={Math.round(h)}
          onMouseDown={(e) => startDrag(e, (x, _y, w) => update({ ...color, h: clamp((x / w) * 360, 0, 360) }))}
          onKeyDown={(e) => {
            const step = e.key === "ArrowRight" ? 5 : e.key === "ArrowLeft" ? -5 : 0;
            if (step) { e.preventDefault(); update({ ...color, h: clamp(h + step, 0, 360) }); }
          }}
        >
          <div class="cp-thumb" style={{ left: `${(h / 360) * 100}%` }} />
        </div>
        <div
          class="cp-track cp-alpha-track"
          role="slider"
          tabIndex={0}
          aria-label="Opacity"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(a)}
          onMouseDown={(e) => startDrag(e, (x, _y, w) => update({ ...color, a: clamp((x / w) * 100, 0, 100) }))}
          onKeyDown={(e) => {
            const step = e.key === "ArrowRight" ? 5 : e.key === "ArrowLeft" ? -5 : 0;
            if (step) { e.preventDefault(); update({ ...color, a: clamp(a + step, 0, 100) }); }
          }}
        >
          <div class="cp-alpha-gradient" style={{ background: `linear-gradient(to right, rgba(${r},${g},${b},0), rgb(${r},${g},${b}))` }} />
          <div class="cp-thumb" style={{ left: `${a}%` }} />
        </div>
      </div>
      <div class="cp-inputs-wrap">
        <button
          class="cp-mode-btn"
          type="button"
          title="Switch color format"
          onClick={() => setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length])}
        >
          {mode.toUpperCase()}
        </button>
        {mode === "hex" && (
          <div class="cp-fields">
            <HexField
              value={rgbToHex(r, g, b)}
              onValue={(hex) => {
                const rgb = hexToRgb(hex);
                if (!rgb) return;
                const [nh, ns, nv] = rgbToHsv(...rgb);
                const digits = hex.replace(/^#/, "");
                const na = digits.length === 8 ? (parseInt(digits.slice(6), 16) / 255) * 100 : a;
                update({ h: nh, s: ns, v: nv, a: na });
              }}
            />
          </div>
        )}
        {mode === "rgb" && (
          <div class="cp-fields">
            {field("Red", r, 255, (n) => setRgb(n, g, b))}
            {field("Green", g, 255, (n) => setRgb(r, n, b))}
            {field("Blue", b, 255, (n) => setRgb(r, g, n))}
          </div>
        )}
        {mode === "hsl" && (
          <div class="cp-fields">
            {field("Hue", hl, 360, (n) => setHsl(n, sl, ll))}
            {field("Saturation", sl, 100, (n) => setHsl(hl, n, ll))}
            {field("Lightness", ll, 100, (n) => setHsl(hl, sl, n))}
          </div>
        )}
        <div class="cp-alpha-wrap">
          {field("Opacity", a, 100, (n) => update({ ...color, a: n }))}
          <span class="cp-alpha-pct">%</span>
        </div>
      </div>
    </div>
  );
}

// The hex field keeps partial input ("#3a") while typing and only follows
// the color when it isn't focused.
function HexField({ value, onValue }: { value: string; onValue(hex: string): void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      class="cp-field"
      maxLength={9}
      spellcheck={false}
      autocomplete="off"
      aria-label="Hex"
      value={draft ?? value}
      onFocus={() => setDraft(value)}
      onBlur={() => setDraft(null)}
      onInput={(e) => {
        const next = (e.target as HTMLInputElement).value;
        setDraft(next);
        onValue(next);
      }}
    />
  );
}
