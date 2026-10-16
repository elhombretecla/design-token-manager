import { describe, expect, it } from "vitest";
import { isAlias, parseMixedValue } from "./alias";

describe("isAlias", () => {
  it("detects a bare reference", () => {
    expect(isAlias("{color.primary}")).toBe(true);
    expect(isAlias("  {color.primary}  ")).toBe(true);
  });

  it("rejects plain and mixed values", () => {
    expect(isAlias("#fff")).toBe(false);
    expect(isAlias("{a} + {b}")).toBe(false);
  });

  // Known limitation, to fix with the resolver in phase 1: a serialised
  // composite value such as {"x":1} matches the alias pattern.
  it.fails("rejects JSON object strings", () => {
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
