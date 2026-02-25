/**
 * utils/color.ts
 *
 * Pure colour-space conversion utilities used by the custom colour picker.
 * All functions are side-effect-free and have no DOM dependencies.
 */

// ── HSV ↔ RGB ──────────────────────────────────────────────────────────────

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const sv = s / 100, vv = v / 100;
  const c = vv * sv, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = vv - c;
  let r = 0, g = 0, b = 0;
  if      (h <  60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }
  return [Math.round((r+m)*255), Math.round((g+m)*255), Math.round((b+m)*255)];
}

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rr = r/255, gg = g/255, bb = b/255;
  const max = Math.max(rr,gg,bb), min = Math.min(rr,gg,bb), d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d/max*100, v = max*100;
  if (d !== 0) {
    if (max === rr)      h = 60*(((gg-bb)/d)%6);
    else if (max === gg) h = 60*((bb-rr)/d+2);
    else                 h = 60*((rr-gg)/d+4);
    if (h < 0) h += 360;
  }
  return [h, s, v];
}

// ── Hex ↔ RGB ──────────────────────────────────────────────────────────────

export function hexToRgb(hex: string): [number, number, number] | null {
  const h = hex.replace(/^#/, "");
  if (h.length === 3) return [parseInt(h[0]+h[0],16), parseInt(h[1]+h[1],16), parseInt(h[2]+h[2],16)];
  if (h.length >= 6)  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  return null;
}

export function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r,g,b].map(n => Math.round(n).toString(16).padStart(2,"0")).join("");
}

// ── RGB ↔ HSL ──────────────────────────────────────────────────────────────

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rr=r/255, gg=g/255, bb=b/255;
  const max=Math.max(rr,gg,bb), min=Math.min(rr,gg,bb), l=(max+min)/2, d=max-min;
  let h=0, s=0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2*l-1));
    if (max===rr)      h = 60*(((gg-bb)/d)%6);
    else if (max===gg) h = 60*((bb-rr)/d+2);
    else               h = 60*((rr-gg)/d+4);
    if (h < 0) h += 360;
  }
  return [Math.round(h), Math.round(s*100), Math.round(l*100)];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const ss=s/100, ll=l/100, c=(1-Math.abs(2*ll-1))*ss;
  const x=c*(1-Math.abs(((h/60)%2)-1)), m=ll-c/2;
  let r=0, g=0, b=0;
  if      (h <  60) { r=c; g=x; b=0; }
  else if (h < 120) { r=x; g=c; b=0; }
  else if (h < 180) { r=0; g=c; b=x; }
  else if (h < 240) { r=0; g=x; b=c; }
  else if (h < 300) { r=x; g=0; b=c; }
  else              { r=c; g=0; b=x; }
  return [Math.round((r+m)*255), Math.round((g+m)*255), Math.round((b+m)*255)];
}

// ── CSS colour string parser ───────────────────────────────────────────────

/**
 * Parse a CSS colour string into [r, g, b, a] (r/g/b: 0-255, a: 0-1).
 * Supports: `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(…)`, `rgba(…)`.
 * Returns null for unrecognised formats.
 */
export function parseCssColor(v: string): [number, number, number, number] | null {
  const hexM = v.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hexM) {
    const h = hexM[1], rgb = hexToRgb("#"+h);
    if (!rgb) return null;
    return [...rgb, h.length === 8 ? parseInt(h.slice(6),16)/255 : 1];
  }
  const rgbM = v.trim().match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/i);
  if (rgbM) return [parseInt(rgbM[1]), parseInt(rgbM[2]), parseInt(rgbM[3]),
                    rgbM[4] !== undefined ? parseFloat(rgbM[4]) : 1];
  return null;
}
