import { describe, expect, it } from "vitest";
import { SUPPORTED_TYPES } from "./dtcg";
import { propertiesForType, propertyLabel } from "./tokenProperties";

describe("propertiesForType", () => {
  it("covers every token type, with defaults among its properties", () => {
    for (const type of SUPPORTED_TYPES) {
      const { groups, defaults } = propertiesForType(type);
      const keys = groups.flatMap((g) => g.props.map((p) => p.key));
      expect(keys.length, type).toBeGreaterThan(0);
      for (const d of defaults) expect(keys, type).toContain(d);
    }
  });

  it("matches Penpot's defaults", () => {
    expect(propertiesForType("color").defaults).toEqual(["fill"]);
    expect(propertiesForType("spacing").defaults).toEqual(["rowGap", "columnGap"]);
    expect(propertiesForType("dimension").defaults).toEqual(["width", "height"]);
  });
});

describe("propertyLabel", () => {
  it("labels known and unknown shape.tokens keys", () => {
    expect(propertyLabel("paddingTop")).toBe("Padding top");
    expect(propertyLabel("fill")).toBe("Fill");
    expect(propertyLabel("strokeWidthTop")).toBe("Stroke Width Top");
  });
});
