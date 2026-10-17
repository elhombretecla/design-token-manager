import type { Token } from "@penpot/plugin-types";
import { describe, expect, it } from "vitest";
import { exportSingleSet, parseTokenFile, SUPPORTED_TYPES } from "./dtcg";
import type { SnapshotToken } from "./protocol";
import { Resolver } from "./resolver";
import { cloneTokenValue, serializeFontFamilyValue, serializeToken, valueForApi } from "./tokenValues";

/**
 * QA matrix for the 17 token types: what the UI edits, what the plugin
 * sends to Penpot's API, and what comes back from a token holding that
 * value. Penpot stores values the way its API receives them (it runs the
 * same DTCG converters), so `valueForApi` output is what `token.value`
 * returns.
 */
interface Case {
  type: string;
  /** Edit form, as typed in the UI. */
  edit: string;
  /** What the API receives. */
  api: unknown;
  /** Edit form read back (defaults to `edit`). */
  back?: string;
}

const CASES: Case[] = [
  { type: "color", edit: "#0055ff", api: "#0055ff" },
  { type: "borderRadius", edit: "4", api: "4" },
  { type: "dimension", edit: "16px", api: "16px" },
  { type: "fontFamilies", edit: "DM Sans, Inter", api: ["DM Sans", "Inter"] },
  { type: "fontSizes", edit: "16", api: "16" },
  { type: "fontWeights", edit: "700", api: "700" },
  { type: "letterSpacing", edit: "0.5", api: "0.5" },
  { type: "number", edit: "1.5", api: "1.5" },
  { type: "opacity", edit: "0.8", api: "0.8" },
  { type: "rotation", edit: "45", api: "45" },
  { type: "sizing", edit: "{space.base} * 4", api: "{space.base} * 4" },
  { type: "spacing", edit: "8", api: "8" },
  { type: "borderWidth", edit: "1", api: "1" },
  { type: "textCase", edit: "uppercase", api: "uppercase" },
  { type: "textDecoration", edit: "strike-through", api: "strike-through" },
  {
    type: "typography",
    edit: JSON.stringify({ fontFamilies: "Inter, Arial", fontSizes: "16", fontWeight: "400", lineHeight: "1.5" }),
    api: { fontFamilies: ["Inter", "Arial"], fontSizes: "16", fontWeight: "400", lineHeight: "1.5" },
    back: JSON.stringify({ fontFamilies: "Inter, Arial", fontSizes: "16", fontWeight: "400", lineHeight: "1.5" }),
  },
  {
    type: "shadow",
    edit: JSON.stringify([
      { type: "drop-shadow", x: "0", y: "2", blur: "4", spread: "0", color: "#0003" },
      { type: "inner-shadow", x: "1", y: "1", blur: "0", spread: "0", color: "{color.blue}" },
    ]),
    api: [
      { inset: false, offsetX: "0", offsetY: "2", blur: "4", spread: "0", color: "#0003" },
      { inset: true, offsetX: "1", offsetY: "1", blur: "0", spread: "0", color: "{color.blue}" },
    ],
  },
];

function fakeToken(type: string, value: unknown, resolvedValue?: unknown): Token {
  return { id: "t", name: "x", type, value, description: "d", resolvedValue } as unknown as Token;
}

describe("token value matrix", () => {
  it("covers every supported type", () => {
    expect(new Set(CASES.map((c) => c.type))).toEqual(SUPPORTED_TYPES);
  });

  describe.each(CASES)("$type", ({ type, edit, api, back }) => {
    it("converts the edit form for the API", () => {
      expect(valueForApi(type, edit)).toEqual(api);
    });

    it("reads the stored value back as the edit form", () => {
      const read = serializeToken(fakeToken(type, valueForApi(type, edit))).value;
      const expected = back ?? edit;
      if (type === "typography" || type === "shadow") expect(JSON.parse(read)).toEqual(JSON.parse(expected));
      else expect(read).toBe(expected);
    });

    it("keeps an alias as a reference", () => {
      expect(valueForApi(type, "{some.token}")).toBe("{some.token}");
      expect(serializeToken(fakeToken(type, "{some.token}")).value).toBe("{some.token}");
    });

    it("clones values detached from the source (move / duplicate)", () => {
      const value = valueForApi(type, edit);
      const copy = cloneTokenValue(value);
      expect(copy).toEqual(value);
      if (typeof value === "object") expect(copy).not.toBe(value);
    });

    it("survives a DTCG export and import", () => {
      const token: SnapshotToken = { id: "t", name: "a.b", type, value: edit, description: "note" };
      const { data } = exportSingleSet({ id: "s", name: "s", active: true, tokens: [token] });
      const [imported] = parseTokenFile(JSON.parse(JSON.stringify(data)), "s").sets[0].tokens;
      expect(imported).toMatchObject({ name: "a.b", type, description: "note" });
      const expected = back ?? edit;
      if (type === "typography" || type === "shadow") expect(JSON.parse(imported.value)).toEqual(JSON.parse(expected));
      else expect(imported.value).toBe(expected);
    });

    it("resolves (aliases + math) without errors", () => {
      const snapshot = {
        sets: [{
          id: "s", name: "s", active: true, tokens: [
            { id: "base", name: "space.base", type: "spacing", value: "4", description: "" },
            { id: "blue", name: "color.blue", type: "color", value: "#00f", description: "" },
            { id: "t", name: "x", type, value: edit, description: "" },
          ],
        }],
        themes: [],
      };
      const r = Resolver.forContext(snapshot, { kind: "active" }).resolveName("x");
      expect(r.status).toBe("ok");
    });
  });
});

describe("Penpot's internal value shapes", () => {
  it("reads font families from CLJS vectors and word arrays", () => {
    const cljs = { $tail$: [{ $tail$: ["DM", "Sans"] }, { $tail$: ["Inter"] }] };
    expect(serializeFontFamilyValue(cljs)).toBe("DM Sans, Inter");
    expect(serializeFontFamilyValue([["DM", "Sans"]])).toBe("DM Sans");
  });

  it("reads Penpot's resolved values", () => {
    const typo = serializeToken(fakeToken("typography", {}, [{ fontSizes: 16, fontWeights: "700", fontFamilies: ["Inter"] }]));
    expect(JSON.parse(typo.penpotResolved!)).toMatchObject({ fontSizes: 16, fontWeight: "700", fontFamilies: "Inter" });
    const shadow = serializeToken(fakeToken("shadow", [], [{ inset: false, offsetX: 0, offsetY: 4, blur: 8, spread: 0, color: "#000" }]));
    expect(JSON.parse(shadow.penpotResolved!)).toEqual({ type: "drop-shadow", x: 0, y: 4, blur: 8, spread: 0, color: "#000" });
  });

  it("treats an opaque proxy as unresolved", () => {
    expect(serializeToken(fakeToken("color", "#000", {})).penpotResolved).toBeUndefined();
  });
});
