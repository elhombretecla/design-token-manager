import { describe, expect, it } from "vitest";
import { isAlias, parseMixedValue, referencesName, replaceReference } from "./alias";

describe("isAlias", () => {
  it("detects a bare reference", () => {
    expect(isAlias("{color.primary}")).toBe(true);
    expect(isAlias("  {color.primary}  ")).toBe(true);
  });

  it("rejects plain and mixed values", () => {
    expect(isAlias("#fff")).toBe(false);
    expect(isAlias("{a} + {b}")).toBe(false);
  });

  it("rejects JSON object strings", () => {
    expect(isAlias('{"x":1}')).toBe(false);
  });
});

describe("parseMixedValue", () => {
  it("splits text and alias segments in order", () => {
    expect(parseMixedValue("calc({spacing.sm} + 4px)")).toEqual([
      { kind: "text", content: "calc(" },
      { kind: "alias", name: "spacing.sm" },
      { kind: "text", content: " + 4px)" },
    ]);
  });

  it("handles adjacent references", () => {
    expect(parseMixedValue("{a}{b}")).toEqual([
      { kind: "alias", name: "a" },
      { kind: "alias", name: "b" },
    ]);
  });
});

describe("references", () => {
  it("matches exact names only", () => {
    expect(referencesName("{color.blue}", "color.blue")).toBe(true);
    expect(referencesName("{ color.blue }", "color.blue")).toBe(true);
    expect(referencesName("{color.blue.dark}", "color.blue")).toBe(false);
    expect(referencesName("{colorXblue}", "color.blue")).toBe(false);
  });

  it("replaces every occurrence, including inside composite JSON", () => {
    expect(replaceReference("{a} + {a} * {ab}", "a", "b")).toBe("{b} + {b} * {ab}");
    expect(replaceReference('{"color":"{c.x}","y":"{s}"}', "c.x", "c.y")).toBe('{"color":"{c.y}","y":"{s}"}');
  });
});
