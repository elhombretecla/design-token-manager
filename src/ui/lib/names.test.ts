import { describe, expect, it } from "vitest";
import type { CatalogSnapshot } from "../../shared/protocol";
import { findReferences, setNameError, tokenNameError, uniqueName } from "./names";

describe("tokenNameError", () => {
  it("accepts dotted names", () => {
    expect(tokenNameError("color.brand-primary_500", [])).toBeNull();
    expect(tokenNameError("espaciado.pequeño", [])).toBeNull();
  });

  it.each([
    ["", "Enter a name"],
    ["color primary", "spaces"],
    ["color.{x}", "{"],
    [".color", "dots"],
    ["color..red", "dots"],
    ["color/red", "letters"],
  ])("rejects %j", (name, fragment) => {
    expect(tokenNameError(name, [])).toContain(fragment);
  });

  it("rejects duplicates", () => {
    expect(tokenNameError("a.b", ["a.b"])).toContain("already exists");
  });
});

describe("setNameError", () => {
  it("validates group segments and duplicates", () => {
    expect(setNameError("theme/dark", [])).toBeNull();
    expect(setNameError("theme//dark", [])).not.toBeNull();
    expect(setNameError("core", ["core"])).not.toBeNull();
  });
});

describe("references", () => {
  const snapshot: CatalogSnapshot = {
    sets: [{
      id: "s", name: "s", active: true, tokens: [
        { id: "1", name: "a", type: "color", value: "#000", description: "" },
        { id: "2", name: "b", type: "color", value: "{a}", description: "" },
        { id: "3", name: "c", type: "spacing", value: "{ab} * 2", description: "" },
      ],
    }],
    themes: [],
  };

  it("finds tokens referencing a name, exactly", () => {
    expect(findReferences(snapshot, ["a"]).map((r) => r.token.id)).toEqual(["2"]);
    expect(findReferences(snapshot, ["a"], new Set(["2"]))).toEqual([]);
  });

  it("makes unique copy names", () => {
    const taken = new Set(["a-copy"]);
    expect(uniqueName("a", taken)).toBe("a-copy-2");
    expect(taken.has("a-copy-2")).toBe(true);
  });
});
