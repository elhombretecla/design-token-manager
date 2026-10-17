// @vitest-environment happy-dom
/**
 * Smoke test of the whole UI: renders the app against a fake catalog and
 * walks through the main screens, catching runtime errors in components
 * (the plugin itself can only be tested inside Penpot).
 */

import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CatalogSnapshot, UiMessage } from "../shared/protocol";
import { App } from "./App";
import { closeModal } from "./overlays";
import { applySnapshot, compare, selectSet, selection } from "./store";

const sent: UiMessage[] = [];

const fixture: CatalogSnapshot = {
  sets: [
    {
      id: "core", name: "core", active: true,
      tokens: [
        { id: "c1", name: "color.blue", type: "color", value: "#0055ff", description: "Brand" },
        { id: "c2", name: "color.bg", type: "color", value: "{color.blue}", description: "" },
        { id: "c3", name: "space.md", type: "spacing", value: "{space.base} * 2", description: "" },
        { id: "c4", name: "font.body", type: "fontFamilies", value: "Inter", description: "" },
        {
          id: "c5", name: "typo.body", type: "typography", description: "",
          value: JSON.stringify({ fontFamilies: "{font.body}", fontSizes: "16", fontWeight: "400" }),
        },
        {
          id: "c6", name: "shadow.md", type: "shadow", description: "",
          value: JSON.stringify([
            { type: "drop-shadow", x: "0", y: "2", blur: "4", spread: "0", color: "#0003" },
            { type: "inner-shadow", x: "0", y: "1", blur: "0", spread: "0", color: "{color.blue}" },
          ]),
        },
        { id: "c7", name: "case", type: "textCase", value: "uppercase", description: "" },
      ],
    },
    {
      id: "dark", name: "theme/dark", active: false,
      tokens: [{ id: "d1", name: "color.bg", type: "color", value: "#000", description: "" }],
    },
  ],
  themes: [{ id: "t1", group: "mode", name: "dark", active: false, setIds: ["core", "dark"] }],
};

const root = () => document.getElementById("app")!;
const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 40)));
const byText = (selector: string, text: string) =>
  [...document.querySelectorAll<HTMLElement>(selector)].find((el) => el.textContent?.trim().includes(text));

async function click(el: Element | null | undefined) {
  expect(el, "element to click").toBeTruthy();
  await act(() => { (el as HTMLElement).click(); });
  await flush();
}

async function type(el: Element | null, text: string) {
  expect(el).toBeTruthy();
  await act(() => {
    (el as HTMLInputElement).value = text;
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
}

beforeAll(async () => {
  vi.spyOn(window.parent, "postMessage").mockImplementation((msg: unknown) => { sent.push(msg as UiMessage); });
  document.body.innerHTML = `<div id="app"></div>`;
  await act(() => render(<App />, root()));
  await act(() => applySnapshot(fixture));
  await flush();
});

afterEach(async () => {
  await act(() => closeModal());
});

describe("App", () => {
  it("shows the overview with sets and themes", () => {
    expect(root().textContent).toContain("theme/dark");
    expect(byText(".theme-item", "dark")).toBeTruthy();
    expect(document.querySelectorAll('[role="treeitem"]').length).toBeGreaterThan(0);
  });

  it("opens a set and renders every value kind", async () => {
    await act(() => selectSet("core"));
    await flush();
    const rows = document.querySelectorAll(".token-row");
    expect(rows.length).toBe(7);
    expect(root().textContent).toContain("Missing {space.base}");
    expect(root().textContent).toContain("2 layers");
    expect(document.querySelectorAll(".alias-chip").length).toBeGreaterThan(0);
  });

  it("groups by type and collapses a group", async () => {
    const select = document.querySelector<HTMLSelectElement>('select[aria-label="Group tokens by"]')!;
    await act(() => {
      select.value = "type";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
    const toggle = byText(".token-group-toggle", "Color")!;
    await click(toggle);
    expect(document.querySelectorAll(".token-row").length).toBe(5);
    await click(byText(".token-group-toggle", "Color"));
    expect(document.querySelectorAll(".token-row").length).toBe(7);
  });

  it("edits a simple value inline", async () => {
    const cell = document.querySelector('[data-token-id="c1"] .tcol-value')!;
    await act(() => { cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
    await flush();
    const input = document.querySelector<HTMLInputElement>(".inline-value-input")!;
    expect(input.value).toBe("#0055ff");
    await type(input, "#112233");
    await act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await flush();
    const last = sent[sent.length - 1];
    expect(last?.type).toBe("ops");
    expect(last?.type === "ops" && last.ops[0]).toMatchObject({ op: "update-token", tokenId: "c1", value: "#112233" });
  });

  it("opens the token menu and the editor, validating the name", async () => {
    await click(document.querySelector('[data-token-id="c1"] .token-menu-btn'));
    expect(document.querySelector('[role="menu"]')).toBeTruthy();
    await click(byText('[role="menuitem"]', "Edit"));
    expect(document.querySelector(".modal-title")?.textContent).toContain("Edit color token");
    const name = document.getElementById("token-name-input") as HTMLInputElement;
    await type(name, "color.bg");
    await click(byText("button", "Save"));
    expect(document.querySelector(".form-error")?.textContent).toContain("already exists");
  });

  it("opens the create modal for composite types", async () => {
    await click(byText("button", "+ New token"));
    const typeSelect = document.getElementById("token-type-select") as HTMLSelectElement;
    for (const t of ["shadow", "typography", "fontFamilies", "textDecoration"]) {
      await act(() => {
        typeSelect.value = t;
        typeSelect.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await flush();
    }
    expect(document.getElementById("typo-family")).toBeFalsy();
    expect(document.querySelector(".modal")).toBeTruthy();
  });

  it("opens the alias editor from a chip", async () => {
    await click(document.querySelector('[data-token-id="c2"] .alias-chip'));
    expect(document.querySelector(".alias-editor-popover")).toBeTruthy();
  });

  it("compares with a set and a theme", async () => {
    await act(() => {
      compare.value = { primarySetId: "core", columns: [{ kind: "set", id: "dark" }, { kind: "theme", id: "t1" }] };
    });
    await flush();
    expect(root().textContent).toContain("Theme: mode / dark");
    expect(document.querySelectorAll(".cmp-row").length).toBeGreaterThan(0);
    await act(() => { compare.value = null; });
  });

  it("shows the selection panel and the apply modal", async () => {
    await act(() => {
      selection.value = { total: 1, shapes: [{ id: "s1", name: "Card", type: "rect", tokens: { fill: "color.blue", strokeColor: "missing.token" } }] };
    });
    await flush();
    await click(document.querySelector(".selection-bar"));
    expect(root().textContent).toContain("Card");
    await click(document.querySelector('[data-token-id="c1"] .token-apply-btn'));
    expect(root().textContent).toContain("Applied");
  });

  it("opens the other modals without errors", async () => {
    const { openThemesModal } = await import("./components/modals/ThemesModal");
    const { openImportModal } = await import("./components/modals/ImportModal");
    const { openExportModal } = await import("./components/modals/ExportModal");
    const { openCheckModal } = await import("./components/modals/CheckModal");
    const { openMathInfoModal } = await import("./components/modals/MathInfoModal");
    for (const open of [() => openThemesModal(), openImportModal, () => openExportModal("core"), openCheckModal, openMathInfoModal]) {
      await act(() => open());
      await flush();
      expect(document.querySelector(".modal")).toBeTruthy();
      await act(() => closeModal());
    }
    await act(() => openExportModal(null));
    await flush();
    const preview = document.querySelector<HTMLTextAreaElement>("textarea");
    expect(preview?.value).toContain('"$themes"');
  });

  it("closes only the top layer on Escape", async () => {
    await click(byText("button", "+ New token"));
    await click(document.querySelector(".modal .value-alias-trigger"));
    expect(document.querySelector(".modal-alias-picker")).toBeTruthy();
    await act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await flush();
    expect(document.querySelector(".modal-alias-picker")).toBeFalsy();
    expect(document.querySelector(".modal")).toBeTruthy();
  });
});
