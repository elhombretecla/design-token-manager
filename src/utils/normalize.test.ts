import { describe, expect, it } from "vitest";
import { normalizeShadowValueToPreview } from "./shadowNormalize";
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
