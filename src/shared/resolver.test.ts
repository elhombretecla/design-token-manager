import { describe, expect, it } from "vitest";
import type { CatalogSnapshot, SnapshotToken } from "./protocol";
import { Resolver, contextSetIds } from "./resolver";

let nextId = 0;
function tok(name: string, value: string, type = "dimension"): SnapshotToken {
  return { id: `t${nextId++}`, name, type, value, description: "" };
}

const snapshot: CatalogSnapshot = {
  sets: [
    {
      id: "core", name: "core", active: true,
      tokens: [
        tok("space.base", "4px"),
        tok("color.blue", "#0055ff", "color"),
        tok("color.red", "#ff0000", "color"),
        tok("font.body", "Inter", "fontFamilies"),
      ],
    },
    {
      id: "light", name: "theme/light", active: true,
      tokens: [tok("color.bg", "{color.blue}", "color")],
    },
    {
      id: "dark", name: "theme/dark", active: false,
      tokens: [tok("color.bg", "{color.red}", "color"), tok("space.lg", "{space.base} * 4")],
    },
    {
      id: "broken", name: "broken", active: false,
      tokens: [
        tok("a", "{b}"),
        tok("b", "{a}"),
        tok("missing", "{does.not.exist} + 2px"),
        tok("mixed", "1rem + {space.base}"),
      ],
    },
    {
      id: "composite", name: "composite", active: false,
      tokens: [
        tok("typo.body", JSON.stringify({ fontFamilies: "{font.body}", fontSizes: "{space.base} * 4", fontWeight: "400" }), "typography"),
        tok("typo.alias", "{typo.body}", "typography"),
        tok("shadow.sm", JSON.stringify({ type: "drop-shadow", x: "0", y: "{space.base}", blur: "8", spread: "0", color: "{color.blue}" }), "shadow"),
      ],
    },
  ],
  themes: [
    { id: "th-dark", group: "mode", name: "dark", active: false, setIds: ["core", "dark"] },
  ],
};

const find = (setId: string, name: string) =>
  snapshot.sets.find((s) => s.id === setId)!.tokens.find((t) => t.name === name)!;

describe("contextSetIds", () => {
  it("active: only active sets, in order", () => {
    expect(contextSetIds(snapshot, { kind: "active" })).toEqual(["core", "light"]);
  });

  it("set-on-top: active sets plus the viewed set last", () => {
    expect(contextSetIds(snapshot, { kind: "set-on-top", setId: "dark" })).toEqual(["core", "light", "dark"]);
    expect(contextSetIds(snapshot, { kind: "set-on-top", setId: "core" })).toEqual(["light", "core"]);
  });

  it("theme: the theme's sets in catalog order", () => {
    expect(contextSetIds(snapshot, { kind: "theme", themeId: "th-dark" })).toEqual(["core", "dark"]);
  });
});

describe("Resolver", () => {
  it("resolves an inactive set's tokens when viewed (the bug Penpot's API can't solve)", () => {
    const r = Resolver.forContext(snapshot, { kind: "set-on-top", setId: "dark" });
    expect(r.resolveToken(find("dark", "color.bg"))).toMatchObject({ status: "ok", value: "#ff0000" });
    expect(r.resolveToken(find("dark", "space.lg"))).toMatchObject({ status: "ok", value: "16px" });
  });

  it("later sets win name clashes", () => {
    const active = Resolver.forContext(snapshot, { kind: "active" });
    expect(active.resolveName("color.bg").value).toBe("#0055ff");
    const dark = Resolver.forContext(snapshot, { kind: "set-on-top", setId: "dark" });
    expect(dark.resolveName("color.bg").value).toBe("#ff0000");
    expect(dark.winner("color.bg")?.id).toBe(find("dark", "color.bg").id);
  });

  it("resolves against a theme", () => {
    const r = Resolver.forContext(snapshot, { kind: "theme", themeId: "th-dark" });
    expect(r.resolveName("color.bg").value).toBe("#ff0000");
    expect(r.has("color.bg")).toBe(true);
    expect(r.has("font.body")).toBe(true);
  });

  it("detects cycles", () => {
    const r = Resolver.forContext(snapshot, { kind: "set-on-top", setId: "broken" });
    expect(r.resolveToken(find("broken", "a")).status).toBe("cycle");
    expect(r.resolveName("b").status).toBe("cycle");
  });

  it("reports missing references", () => {
    const r = Resolver.forContext(snapshot, { kind: "set-on-top", setId: "broken" });
    expect(r.resolveToken(find("broken", "missing"))).toEqual({
      status: "broken", missing: ["does.not.exist"], error: undefined,
    });
  });

  it("flags math with mixed units as invalid", () => {
    const r = Resolver.forContext(snapshot, { kind: "set-on-top", setId: "broken" });
    expect(r.resolveToken(find("broken", "mixed"))).toMatchObject({ status: "invalid", value: "1rem + 4px" });
  });

  it("resolves composite fields and composite aliases", () => {
    const r = Resolver.forContext(snapshot, { kind: "set-on-top", setId: "composite" });
    const body = r.resolveToken(find("composite", "typo.body"));
    expect(body.status).toBe("ok");
    expect(JSON.parse(body.value!)).toEqual({ fontFamilies: "Inter", fontSizes: "16px", fontWeight: "400" });
    expect(r.resolveToken(find("composite", "typo.alias")).value).toBe(body.value);

    const shadow = JSON.parse(r.resolveToken(find("composite", "shadow.sm")).value!);
    expect(shadow).toEqual({ type: "drop-shadow", x: "0", y: "4px", blur: "8", spread: "0", color: "#0055ff" });
  });

  it("resolves a token from a set outside the context against the context", () => {
    const r = Resolver.forContext(snapshot, { kind: "active" });
    // dark/color.bg isn't active, but its own value can still be computed.
    expect(r.resolveToken(find("dark", "color.bg")).value).toBe("#ff0000");
    expect(r.setIds.has("dark")).toBe(false);
  });
});

describe("Resolver — multi-layer shadows", () => {
  it("resolves every layer", () => {
    const layers = [
      { type: "drop-shadow", x: "0", y: "{space.base}", blur: "8", spread: "0", color: "{color.blue}" },
      { type: "inner-shadow", x: "1", y: "1", blur: "{space.base} * 2", spread: "0", color: "#000" },
    ];
    const snap: CatalogSnapshot = {
      sets: [{ ...snapshot.sets[0], tokens: [...snapshot.sets[0].tokens, tok("shadow.md", JSON.stringify(layers), "shadow")] }],
      themes: [],
    };
    const r = Resolver.forContext(snap, { kind: "active" });
    expect(JSON.parse(r.resolveName("shadow.md").value!)).toEqual([
      { type: "drop-shadow", x: "0", y: "4px", blur: "8", spread: "0", color: "#0055ff" },
      { type: "inner-shadow", x: "1", y: "1", blur: "8px", spread: "0", color: "#000" },
    ]);
  });
});
