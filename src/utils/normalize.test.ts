import { describe, expect, it } from "vitest";
import { normalizeShadowLayers, normalizeShadowValueToPreview, shadowLayersToValue } from "./shadowNormalize";
import { normalizeTypographyValueToForm, sanitizeTypographyValueForApi } from "./typographyNormalize";

describe("normalizeShadowValueToPreview", () => {
  it("reads the plugin's serialised shadow form", () => {
    const form = normalizeShadowValueToPreview(
      JSON.stringify({ type: "inner-shadow", x: "1", y: "2", blur: "3", spread: "4", color: "#000" }),
    );
    expect(form).toMatchObject({ type: "inner-shadow", x: "1", y: "2", blur: "3", spread: "4", color: "#000" });
  });
});

describe("typography normalisation", () => {
  it("maps API keys to form keys", () => {
    const form = normalizeTypographyValueToForm(
      JSON.stringify({ fontFamilies: "Inter", fontSizes: "16", fontWeight: "700", lineHeight: "1.5" }),
    );
    expect(form).toMatchObject({ fontFamily: "Inter", fontSize: "16", fontWeight: "700", lineHeight: "1.5" });
  });

  it("drops empty and unknown keys from the API payload", () => {
    const out = sanitizeTypographyValueForApi({ fontSizes: "16", lineHeight: "", bogus: "x" });
    expect(out).toEqual({ fontSizes: "16" });
  });
});

describe("shadow layers", () => {
  const a = { type: "drop-shadow", x: "0", y: "4", blur: "8", spread: "0", color: "#000" };
  const b = { type: "inner-shadow", x: "1", y: "1", blur: "2", spread: "0", color: "{c}" };

  it("reads one layer (object) or several (array)", () => {
    expect(normalizeShadowLayers(JSON.stringify(a))).toEqual([a]);
    expect(normalizeShadowLayers(JSON.stringify([a, b]))).toEqual([a, b]);
    expect(normalizeShadowLayers("{shadow.sm}")).toEqual([]);
  });

  it("round-trips through the wire form", () => {
    expect(shadowLayersToValue([a])).toBe(JSON.stringify(a));
    expect(normalizeShadowLayers(shadowLayersToValue([a, b]))).toEqual([a, b]);
  });
});
