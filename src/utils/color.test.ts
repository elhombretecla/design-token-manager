import { describe, expect, it } from "vitest";
import { hexToRgb, hslToRgb, hsvToRgb, rgbToHex, rgbToHsl, rgbToHsv } from "./color";

describe("color conversions", () => {
  it("round-trips hex ↔ rgb", () => {
    expect(hexToRgb("#ff8000")).toEqual([255, 128, 0]);
    expect(rgbToHex(255, 128, 0).toLowerCase()).toBe("#ff8000");
  });

  it("returns null for invalid hex", () => {
    expect(hexToRgb("nope")).toBeNull();
  });

  it("round-trips rgb ↔ hsv", () => {
    const [h, s, v] = rgbToHsv(51, 102, 204);
    expect(hsvToRgb(h, s, v).map(Math.round)).toEqual([51, 102, 204]);
  });

  it("round-trips rgb ↔ hsl", () => {
    const [h, s, l] = rgbToHsl(51, 102, 204);
    expect(hslToRgb(h, s, l).map(Math.round)).toEqual([51, 102, 204]);
  });
});
