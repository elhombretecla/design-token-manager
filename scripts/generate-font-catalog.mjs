#!/usr/bin/env node
/**
 * generate-font-catalog.mjs
 *
 * Reads gfonts.json (Penpot's full webfont catalog, ~1.8 MB) from the repo
 * root and emits a slim TypeScript module at src/assets/fontCatalog.generated.ts
 * containing only { family, variants, category } per font — the ~3% of the
 * data actually needed by the font picker.
 *
 * Usage:
 *   node scripts/generate-font-catalog.mjs
 *
 * Run automatically via the "predev" and "prebuild" npm hooks so the catalog
 * is always up-to-date before TypeScript sees it.
 *
 * No dependencies beyond Node.js built-ins.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// ── Read source catalog ───────────────────────────────────────────────────

const gfontsPath = join(root, "gfonts.json");
let raw;
try {
  raw = readFileSync(gfontsPath, "utf-8");
} catch {
  console.error(
    `[generate-font-catalog] ERROR: gfonts.json not found at ${gfontsPath}`,
  );
  process.exit(1);
}

const gfonts = JSON.parse(raw);

if (!Array.isArray(gfonts?.items)) {
  console.error("[generate-font-catalog] ERROR: gfonts.json has no items array");
  process.exit(1);
}

// ── Extract slim representation ───────────────────────────────────────────
// Drop: files (URL map), menu URL, subsets, version, lastModified, kind.
// Keep: family, variants, category — everything the font picker needs.

const items = gfonts.items.map((f) => ({
  family: String(f.family ?? ""),
  variants: Array.isArray(f.variants) ? f.variants.map(String) : ["regular"],
  category: String(f.category ?? ""),
}));

// Enforce alphabetical order (Google already sorts, but be explicit)
items.sort((a, b) => a.family.localeCompare(b.family));

// ── Emit TypeScript module ────────────────────────────────────────────────

const outDir = join(root, "src", "assets");
mkdirSync(outDir, { recursive: true });

const outPath = join(outDir, "fontCatalog.generated.ts");

// Serialize the array as compact JSON (each item on one line for readability
// in diffs while keeping file size manageable).
const rows = items.map((item) => JSON.stringify(item)).join(",\n  ");

const ts = `\
// AUTO-GENERATED — do not edit manually.
// Run \`node scripts/generate-font-catalog.mjs\` (or \`npm run generate-fonts\`) to regenerate.
// Source: gfonts.json (${items.length} fonts, ${new Date().toISOString().slice(0, 10)})

export interface FontCatalogItem {
  family: string;
  variants: string[];
  category: string;
}

/** Full Penpot webfont catalog, alphabetically sorted. */
export const FONT_CATALOG: FontCatalogItem[] = [
  ${rows}
];
`;

writeFileSync(outPath, ts, "utf-8");

console.log(
  `[generate-font-catalog] wrote ${items.length} fonts` +
  ` → src/assets/fontCatalog.generated.ts`,
);
