import { describe, expect, it } from "vitest";
import { evaluateMath, looksLikeMath } from "./math";

describe("evaluateMath", () => {
  it.each([
    ["8 * 8", "64"],
    ["4px + 2", "6px"],
    ["16px - 4px", "12px"],
    ["(2 + 3) * 4px", "20px"],
    ["16px / 2", "8px"],
    ["16px / 2px", "8"],
    ["-4px + 1px", "-3px"],
    ["0.1 + 0.2", "0.3"],
    ["roundTo(16 * 1.33, 0)", "21"],
    ["roundTo(1.23456, 2)", "1.23"],
    ["max(4px, 8px)", "8px"],
    ["1.5rem * 2", "3rem"],
  ])("%s → %s", (input, expected) => {
    expect(evaluateMath(input)).toEqual({ ok: true, value: expected });
  });

  it.each(["1rem + 4px", "8 / 0", "rgba(0, 0, 0, 0.5)", "#fff", "(1 + 2", "Inter"])(
    "rejects %s",
    (input) => {
      expect(evaluateMath(input).ok).toBe(false);
    },
  );
});

describe("looksLikeMath", () => {
  it("only flags strings with an operator or function", () => {
    expect(looksLikeMath("8 * 2")).toBe(true);
    expect(looksLikeMath("roundTo(3.2, 0)")).toBe(true);
    expect(looksLikeMath("16px")).toBe(false);
    expect(looksLikeMath("-4px")).toBe(false);
    expect(looksLikeMath("#fff")).toBe(false);
    expect(looksLikeMath("rgba(0,0,0,0.25)")).toBe(false);
    expect(looksLikeMath("DM Sans, Inter")).toBe(false);
  });
});
