import { describe, expect, it } from "vitest";
import type { CatalogSnapshot } from "./protocol";
import { exportMultiSet, exportSingleSet, parseTokenFile, setNameFromFileName } from "./dtcg";

const snapshot: CatalogSnapshot = {
  sets: [
    {
      id: "s1", name: "core", active: true,
      tokens: [
        { id: "a", name: "color.primary", type: "color", value: "#0055ff", description: "Brand" },
        { id: "b", name: "space.md", type: "spacing", value: "{space.base} * 2", description: "" },
        { id: "c", name: "font.body", type: "fontFamilies", value: "DM Sans, Inter", description: "" },
        {
          id: "d", name: "typo.body", type: "typography", description: "",
          value: JSON.stringify({ fontFamilies: "{font.body}", fontSizes: "16", fontWeight: "400", lineHeight: "1.5" }),
        },
        {
          id: "e", name: "shadow.md", type: "shadow", description: "",
          value: JSON.stringify([
            { type: "drop-shadow", x: "0", y: "2", blur: "4", spread: "0", color: "#0003" },
            { type: "inner-shadow", x: "0", y: "1", blur: "0", spread: "0", color: "#fff" },
          ]),
        },
      ],
    },
    { id: "s2", name: "theme/dark", active: false, tokens: [{ id: "f", name: "color.bg", type: "color", value: "#000", description: "" }] },
  ],
  themes: [{ id: "t1", group: "mode", name: "dark", active: true, setIds: ["s1", "s2"] }],
};

describe("export", () => {
  it("writes Penpot's DTCG form", () => {
    const { data } = exportSingleSet(snapshot.sets[0]);
    expect(data).toMatchObject({
      color: { primary: { $value: "#0055ff", $type: "color", $description: "Brand" } },
      font: { body: { $value: ["DM Sans", "Inter"], $type: "fontFamilies" } },
      typo: { body: { $value: { fontFamilies: "{font.body}", fontSizes: "16", fontWeights: "400", lineHeights: "1.5" } } },
      shadow: {
        md: {
          $value: [
            { offsetX: "0", offsetY: "2", blur: "4", spread: "0", color: "#0003", inset: false },
            { offsetX: "0", offsetY: "1", blur: "0", spread: "0", color: "#fff", inset: true },
          ],
        },
      },
    });
  });

  it("writes sets, themes and metadata for multi-set files", () => {
    const { data } = exportMultiSet(snapshot);
    expect(Object.keys(data)).toEqual(["core", "theme/dark", "$themes", "$metadata"]);
    expect(data.$themes).toEqual([{ name: "dark", group: "mode", selectedTokenSets: { core: "enabled", "theme/dark": "enabled" } }]);
    expect(data.$metadata).toEqual({ tokenSetOrder: ["core", "theme/dark"], activeThemes: ["mode/dark"], activeSets: ["core"] });
  });

  it("reports names that clash with a group", () => {
    const set = { id: "x", name: "x", active: true, tokens: [
      { id: "1", name: "color", type: "color", value: "#000", description: "" },
      { id: "2", name: "color.red", type: "color", value: "#f00", description: "" },
    ] };
    const { warnings } = exportSingleSet(set);
    expect(warnings).toHaveLength(1);
  });
});

describe("import", () => {
  it("round-trips an export", () => {
    const { data } = exportMultiSet(snapshot);
    const result = parseTokenFile(JSON.parse(JSON.stringify(data)), "ignored");
    expect(result.multiSet).toBe(true);
    expect(result.sets.map((s) => s.name)).toEqual(["core", "theme/dark"]);
    expect(result.themes).toEqual([{ group: "mode", name: "dark", setNames: ["core", "theme/dark"] }]);
    const byName = new Map(result.sets[0].tokens.map((t) => [t.name, t]));
    for (const original of snapshot.sets[0].tokens) {
      const imported = byName.get(original.name)!;
      expect(imported.type).toBe(original.type);
      if (original.type === "typography" || original.type === "shadow") {
        expect(JSON.parse(imported.value)).toEqual(JSON.parse(original.value));
      } else {
        expect(imported.value).toBe(original.value);
      }
    }
    expect(byName.get("color.primary")!.description).toBe("Brand");
  });

  it("reads a single-set file named after the file, with inherited $type", () => {
    const result = parseTokenFile(
      { spacing: { $type: "spacing", sm: { $value: "4px" }, md: { $value: "8px" } } },
      setNameFromFileName("Brand / Spacing.json"),
    );
    expect(result.multiSet).toBe(false);
    expect(result.ambiguous).toBe(true);
    expect(result.sets).toEqual([{
      name: "Brand/Spacing",
      tokens: [
        { name: "spacing.sm", type: "spacing", value: "4px", description: "" },
        { name: "spacing.md", type: "spacing", value: "8px", description: "" },
      ],
    }]);
  });

  it("reads legacy Tokens Studio files and type aliases", () => {
    const result = parseTokenFile({
      core: {
        shadow: { value: { x: "0", y: "4", blur: "8", spread: "0", color: "#000", type: "innerShadow" }, type: "boxShadow" },
        weight: { value: 700, type: "fontWeight" },
        text: { value: { fontFamily: "Inter", fontSize: "14", lineHeight: "20" }, type: "typography" },
        dur: { value: "200ms", type: "duration" },
      },
    }, "x", true);
    const tokens = result.sets[0].tokens;
    expect(tokens.map((t) => [t.name, t.type])).toEqual([["shadow", "shadow"], ["weight", "fontWeights"], ["text", "typography"]]);
    expect(JSON.parse(tokens[0].value)).toEqual({ type: "inner-shadow", x: "0", y: "4", blur: "8", spread: "0", color: "#000" });
    expect(tokens[1].value).toBe("700");
    expect(JSON.parse(tokens[2].value)).toEqual({ fontFamilies: "Inter", fontSizes: "14", lineHeight: "20" });
    expect(result.warnings).toEqual(['Skipped 1 token of unsupported type "duration"']);
  });

  it("reads DTCG structured color and dimension values", () => {
    const result = parseTokenFile({
      c: { $type: "color", $value: { colorSpace: "srgb", components: [1, 0, 0], hex: "#ff0000" } },
      d: { $type: "dimension", $value: { value: 16, unit: "px" } },
    }, "x");
    expect(result.sets[0].tokens.map((t) => t.value)).toEqual(["#ff0000", "16px"]);
  });

  it("rejects non-objects", () => {
    expect(() => parseTokenFile([], "x")).toThrow();
  });
});
