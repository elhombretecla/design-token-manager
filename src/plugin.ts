// ════════════════════════════════════════════════════════════════════════
//  DESIGN TOKEN MANAGER — plugin.ts
//  Runs inside Penpot (sandboxed), communicates with the UI via postMessage.
//  Accesses design tokens through penpot.library.local.tokens (TokenCatalog).
// ════════════════════════════════════════════════════════════════════════

import type {
  Shape,
  Token,
  TokenCatalog,
  TokenProperty,
  TokenSet,
  TokenTheme,
  TokenType,
  TokenValueString,
} from "@penpot/plugin-types";
import type {
  CatalogSnapshot,
  ImportToken,
  Op,
  OpResult,
  PluginMessage,
  SelectionInfo,
  SnapshotSet,
  SnapshotTheme,
  SnapshotToken,
  UiMessage,
  ValidationReport,
} from "./shared/protocol";
import { cloneTokenValue, serializeToken, valueForApi } from "./shared/tokenValues";

// ── Open the plugin UI ────────────────────────────────────────────────
penpot.ui.open("Design Token Manager", `?theme=${penpot.theme}`, {
  width: 960,
  height: 600,
});

// ── Accessor helper ───────────────────────────────────────────────────
// The token API (TokenCatalog) is typed from @penpot/plugin-types 1.5.0.
// Older Penpot runtimes don't expose it, so callers must check
// `tokensApiAvailable()` before touching the catalog.
function catalog(): TokenCatalog {
  return penpot.library.local.tokens;
}

function tokensApiAvailable(): boolean {
  try {
    return Boolean(penpot.library?.local?.tokens);
  } catch {
    return false;
  }
}

// Token value setters differ per concrete token type, so assigning through
// the `Token` union needs a single, documented widening.
function setTokenValue(token: Token, value: TokenValueString): void {
  (token as { value: TokenValueString }).value = value;
}

function serializeSet(set: TokenSet): SnapshotSet {
  let tokens: SnapshotToken[] = [];
  try {
    tokens = set.tokens.map(serializeToken);
  } catch (err) {
    console.error("[Token Manager plugin] Could not read set", set.name, err);
  }
  return { id: set.id, name: set.name, active: set.active, tokens };
}

function serializeTheme(theme: TokenTheme): SnapshotTheme {
  let setIds: string[] = [];
  try {
    setIds = theme.activeSets.map((s) => s.id);
  } catch { /* keep empty */ }
  return {
    id: theme.id,
    group: theme.group ?? "",
    name: theme.name,
    active: theme.active,
    setIds,
  };
}

function buildSnapshot(): CatalogSnapshot {
  const cat = catalog();
  return {
    sets: cat.sets.map(serializeSet),
    themes: cat.themes.map(serializeTheme),
  };
}

// ════════════════════════════════════════════════════════════════════════
//  SNAPSHOT PUBLISHING & CHANGE DETECTION
//  The token API has no change events, so external edits (Penpot's own
//  tokens panel, undo, other collaborators) are detected by comparing the
//  serialised snapshot after `contentsave` and on a slow periodic check.
// ════════════════════════════════════════════════════════════════════════

const POLL_INTERVAL_MS = 2000;
let lastSnapshotJson = "";
let publishScheduled = false;

function send(message: PluginMessage): void {
  penpot.ui.sendMessage(message);
}

/** Send the snapshot if it changed (or unconditionally with `force`). */
function publishSnapshot(force = false): void {
  if (!tokensApiAvailable()) return;
  try {
    const snapshot = buildSnapshot();
    const json = JSON.stringify(snapshot);
    if (!force && json === lastSnapshotJson) return;
    lastSnapshotJson = json;
    send({ type: "snapshot", snapshot });
  } catch (err) {
    console.error("[Token Manager plugin] Snapshot failed", err);
  }
}

// Penpot's token engine settles after a mutation returns; reading the new
// proxies in the same tick can throw. Coalesce publishes into the next tick.
function schedulePublish(): void {
  if (publishScheduled) return;
  publishScheduled = true;
  setTimeout(() => {
    publishScheduled = false;
    publishSnapshot();
  }, 0);
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// ════════════════════════════════════════════════════════════════════════
//  OPERATIONS  (UI → plugin)
// ════════════════════════════════════════════════════════════════════════

function requireSet(cat: TokenCatalog, setId: string): TokenSet {
  const set = cat.getSetById(setId);
  if (!set) throw new Error(`Set not found: ${setId}`);
  return set;
}

function requireToken(set: TokenSet, tokenId: string): Token {
  const token = set.getTokenById(tokenId);
  if (!token) throw new Error(`Token not found in "${set.name}": ${tokenId}`);
  return token;
}

function requireTheme(cat: TokenCatalog, themeId: string): TokenTheme {
  const theme = cat.getThemeById(themeId);
  if (!theme) throw new Error(`Theme not found: ${themeId}`);
  return theme;
}

// `addToken` doesn't take a description; set it once the engine settled.
async function addTokenWithDescription(
  set: TokenSet,
  args: { type: TokenType; name: string; value: TokenValueString },
  description: string,
): Promise<void> {
  const token = set.addToken(args);
  if (!description) return;
  await tick();
  token.description = description;
}

// ── Shapes & applied tokens ───────────────────────────────────────────────

function shapeTokens(shape: Shape): Record<string, string> {
  try {
    return { ...(shape.tokens as Record<string, string>) };
  } catch {
    return {};
  }
}

function shapesById(ids: string[]): Shape[] {
  const page = penpot.currentPage;
  if (!page) return [];
  return ids.map((id) => page.getShapeById(id)).filter((s): s is Shape => s !== null);
}

// Penpot applies tokens by name and resolves them with the active sets, so
// the token used to remove an application should be the one that wins
// there; fall back to any set that defines the name.
function findTokenByName(cat: TokenCatalog, name: string): Token | undefined {
  let winner: Token | undefined;
  let any: Token | undefined;
  for (const set of cat.sets) {
    const token = set.tokens.find((t) => t.name === name);
    if (!token) continue;
    any ??= token;
    if (set.active) winner = token;
  }
  return winner ?? any;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Apply one property at a time: Penpot picks the shape updater from the
// first property, so mixing groups (padding + gap) in one call misapplies.
// Applying is a toggle, so properties every shape already has are skipped.
function applyToken(token: Token, shapes: Shape[], properties: string[]): string {
  if (shapes.length === 0) throw new Error("Select one or more shapes in Penpot first");
  let applied = 0;
  for (const prop of properties) {
    if (shapes.every((s) => shapeTokens(s)[prop] === token.name)) continue;
    token.applyToShapes(shapes, [prop as TokenProperty]);
    applied++;
  }
  if (applied === 0) return `${token.name} was already applied`;
  return `Applied ${token.name} to ${plural(shapes.length, "shape")}`;
}

async function importSet(cat: TokenCatalog, name: string, tokens: ImportToken[], mode: "skip" | "overwrite"): Promise<string> {
  let set = cat.sets.find((s) => s.name === name);
  if (!set) {
    set = cat.addSet({ name });
    await tick();
  }
  let created = 0, updated = 0, skipped = 0;
  const failures: string[] = [];
  for (const t of tokens) {
    try {
      const existing = set.tokens.find((x) => x.name === t.name);
      if (existing && mode === "skip") { skipped++; continue; }
      if (existing && existing.type === t.type) {
        setTokenValue(existing, valueForApi(t.type, t.value));
        existing.description = t.description;
        updated++;
        continue;
      }
      if (existing) existing.remove(); // type changed: replace
      await addTokenWithDescription(set, {
        type: t.type as TokenType,
        name: t.name,
        value: valueForApi(t.type, t.value),
      }, t.description);
      if (existing) updated++; else created++;
    } catch (err) {
      failures.push(`${t.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (failures.length > 0 && created + updated + skipped === 0) {
    throw new Error(`"${name}": no tokens imported (${failures[0]})`);
  }
  const parts = [`${plural(created, "token")} created`];
  if (updated) parts.push(`${updated} updated`);
  if (skipped) parts.push(`${skipped} kept`);
  if (failures.length) parts.push(`${failures.length} failed (${failures[0]})`);
  return `"${name}": ${parts.join(", ")}`;
}

async function runOp(cat: TokenCatalog, op: Op): Promise<string | void> {
  switch (op.op) {
    case "create-set":
      cat.addSet({ name: op.name });
      return;

    case "rename-set":
      requireSet(cat, op.setId).name = op.newName;
      return;

    case "duplicate-set":
      requireSet(cat, op.setId).duplicate();
      return;

    case "delete-set":
      requireSet(cat, op.setId).remove();
      return;

    case "create-token":
      await addTokenWithDescription(requireSet(cat, op.setId), {
        type: op.tokenType as TokenType,
        name: op.name,
        value: valueForApi(op.tokenType, op.value),
      }, op.description);
      return;

    case "update-token": {
      const token = requireToken(requireSet(cat, op.setId), op.tokenId);
      // The name setter re-validates the whole token against Penpot's
      // schema (fontFamilies tokens fail it), so only assign on change.
      if (op.name !== token.name) token.name = op.name;
      setTokenValue(token, valueForApi(token.type, op.value));
      token.description = op.description ?? "";
      return;
    }

    case "duplicate-token": {
      const set = requireSet(cat, op.setId);
      const original = requireToken(set, op.tokenId);
      // Unique name against the live token list, never the UI's copy.
      const existingNames = new Set(set.tokens.map((t) => t.name));
      let copyName = `${original.name}-copy`;
      for (let n = 2; existingNames.has(copyName); n++) {
        copyName = `${original.name}-copy-${n}`;
      }
      await addTokenWithDescription(set, {
        type: original.type,
        name: copyName,
        value: cloneTokenValue(original.value),
      }, original.description ?? "");
      return;
    }

    case "delete-token":
      requireToken(requireSet(cat, op.setId), op.tokenId).remove();
      return;

    case "move-token": {
      const fromSet = requireSet(cat, op.fromSetId);
      const toSet = requireSet(cat, op.toSetId);
      const token = requireToken(fromSet, op.tokenId);
      const targetName = op.newName ?? token.name;
      if (toSet.tokens.some((t) => t.name === targetName)) {
        throw new Error(`"${toSet.name}" already has a token named "${targetName}"`);
      }
      // Pass the live value (object for shadow/typography) rather than a
      // stringified copy: Penpot reads a "{…}" string as an alias reference.
      await addTokenWithDescription(toSet, {
        type: token.type,
        name: targetName,
        value: cloneTokenValue(token.value),
      }, token.description ?? "");
      if (!op.copy) token.remove();
      return;
    }

    // Note: toggling a set directly makes Penpot disable all themes
    // (the file switches to a "custom" combination of sets).
    case "set-set-active":
      requireSet(cat, op.setId).active = op.active;
      return;

    case "create-theme": {
      const theme = cat.addTheme({ group: op.group, name: op.name });
      for (const setId of op.setIds ?? []) theme.addSet(setId);
      for (const setName of op.setNames ?? []) {
        const set = cat.sets.find((s) => s.name === setName);
        if (set) theme.addSet(set);
      }
      return;
    }

    case "update-theme": {
      const theme = requireTheme(cat, op.themeId);
      if (theme.group !== op.group) theme.group = op.group;
      if (theme.name !== op.name) theme.name = op.name;
      return;
    }

    case "duplicate-theme":
      requireTheme(cat, op.themeId).duplicate();
      return;

    case "delete-theme":
      requireTheme(cat, op.themeId).remove();
      return;

    // Penpot keeps at most one active theme per group.
    case "set-theme-active":
      requireTheme(cat, op.themeId).active = op.active;
      return;

    case "set-theme-sets": {
      const theme = requireTheme(cat, op.themeId);
      const wanted = new Set(op.setIds);
      const current = new Set(theme.activeSets.map((s) => s.id));
      for (const id of current) if (!wanted.has(id)) theme.removeSet(id);
      for (const id of wanted) if (!current.has(id)) theme.addSet(id);
      return;
    }

    case "apply-token": {
      const token = requireToken(requireSet(cat, op.setId), op.tokenId);
      return applyToken(token, penpot.selection, op.properties);
    }

    case "unapply-token": {
      const token = findTokenByName(cat, op.tokenName);
      if (!token) {
        throw new Error(`No token named "${op.tokenName}" exists, and Penpot can only remove an application through its token`);
      }
      const shapes = shapesById(op.shapeIds);
      for (const prop of op.properties) {
        // Toggling off only happens when every shape has it applied.
        const having = shapes.filter((s) => shapeTokens(s)[prop] === op.tokenName);
        if (having.length > 0) token.applyToShapes(having, [prop as TokenProperty]);
      }
      return;
    }

    case "select-shapes": {
      if (op.pageId && penpot.currentPage?.id !== op.pageId) {
        await penpot.openPage(op.pageId);
        await tick();
      }
      const shapes = shapesById(op.shapeIds);
      if (shapes.length === 0) throw new Error("Those shapes are no longer in the file");
      penpot.selection = shapes;
      return;
    }

    case "select-token-usages": {
      const shapes = (penpot.currentPage?.findShapes() ?? [])
        .filter((s) => Object.values(shapeTokens(s)).includes(op.tokenName));
      penpot.selection = shapes;
      return shapes.length === 0
        ? `No shapes on this page use ${op.tokenName}`
        : `Selected ${plural(shapes.length, "shape")} using ${op.tokenName}`;
    }

    case "import-set":
      return importSet(cat, op.name, op.tokens, op.mode);
  }
}

async function runOps(reqId: number, ops: Op[]): Promise<void> {
  const cat = catalog();
  const results: OpResult[] = [];
  for (const op of ops) {
    try {
      const message = await runOp(cat, op);
      results.push(message ? { ok: true, message } : { ok: true });
    } catch (err) {
      console.error("[Token Manager plugin]", op.op, err);
      results.push({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    // Let the token engine settle between operations of a batch.
    await tick();
  }
  send({ type: "ops-result", reqId, results });
  schedulePublish();
  // Applying tokens doesn't fire selectionchange; refresh the panel.
  setTimeout(() => publishSelection(), 50);
}

// ════════════════════════════════════════════════════════════════════════
//  SELECTION
// ════════════════════════════════════════════════════════════════════════

const SELECTION_DETAIL_MAX = 50;
let lastSelectionJson = "";

function buildSelection(): SelectionInfo {
  const selection = penpot.selection ?? [];
  return {
    total: selection.length,
    shapes: selection.slice(0, SELECTION_DETAIL_MAX).map((shape) => ({
      id: shape.id,
      name: shape.name,
      type: shape.type,
      tokens: shapeTokens(shape),
    })),
  };
}

function publishSelection(force = false): void {
  try {
    const selection = buildSelection();
    const json = JSON.stringify(selection);
    if (!force && json === lastSelectionJson) return;
    lastSelectionJson = json;
    send({ type: "selection", selection });
  } catch (err) {
    console.error("[Token Manager plugin] Selection failed", err);
  }
}

// ════════════════════════════════════════════════════════════════════════
//  VALIDATION
// ════════════════════════════════════════════════════════════════════════

function buildValidationReport(): ValidationReport {
  const page = penpot.currentPage;
  const file = penpot.currentFile;
  const validateAvailable = typeof file?.validate === "function";
  let fileIssues: ValidationReport["fileIssues"] = [];
  if (file && validateAvailable) {
    try {
      fileIssues = file.validate().map((e) => ({
        code: e.code, hint: e.hint, shapeId: e.shapeId, pageId: e.pageId,
      }));
    } catch (err) {
      fileIssues = [{ code: "validation-error", hint: String(err), shapeId: null, pageId: null }];
    }
  }

  const usage = new Map<string, Set<string>>();
  for (const shape of page?.findShapes() ?? []) {
    for (const name of Object.values(shapeTokens(shape))) {
      if (!usage.has(name)) usage.set(name, new Set());
      usage.get(name)!.add(shape.id);
    }
  }

  return {
    validateAvailable,
    fileIssues,
    pageId: page?.id ?? "",
    pageName: page?.name ?? "",
    applied: [...usage].map(([name, ids]) => ({ name, shapeIds: [...ids] })),
  };
}

function scanDocumentFonts(): string[] {
  const seen = new Set<string>();
  try {
    for (const shape of penpot.currentPage?.findShapes({ type: "text" }) ?? []) {
      if (!penpot.utils.types.isText(shape)) continue;
      if (shape.fontFamily !== "mixed") {
        if (shape.fontFamily) seen.add(shape.fontFamily);
        continue;
      }
      // Mixed fonts: sample per character (capped to keep it cheap).
      const len = Math.min(shape.characters.length, 2000);
      for (let i = 0; i < len; i++) {
        const family = shape.getRange(i, i + 1).fontFamily;
        if (family && family !== "mixed") seen.add(family);
      }
    }
  } catch {
    // Scanning is best-effort; return whatever was collected
  }
  return Array.from(seen).sort();
}

// ════════════════════════════════════════════════════════════════════════
//  MESSAGE HANDLER
// ════════════════════════════════════════════════════════════════════════

penpot.ui.onMessage<UiMessage>((msg) => {
  // Older Penpot runtimes (before plugin API 1.5) have no token catalog.
  if (!tokensApiAvailable()) {
    send({ type: "unsupported", penpotVersion: penpot.version ?? "" });
    return;
  }

  switch (msg?.type) {
    case "init":
      // The URL carries the theme too, but confirm it in case it was lost.
      send({ source: "penpot", type: "themechange", theme: penpot.theme });
      publishSnapshot(true);
      publishSelection(true);
      break;

    case "validate": {
      let report: ValidationReport;
      try {
        report = buildValidationReport();
      } catch (err) {
        send({ type: "error", message: `Validation failed: ${String(err)}` });
        report = { validateAvailable: false, fileIssues: [], pageId: "", pageName: "", applied: [] };
      }
      send({ type: "validation", reqId: msg.reqId, report });
      break;
    }

    case "ops":
      void runOps(msg.reqId, msg.ops);
      break;

    case "scan-fonts":
      send({ type: "fonts-loaded", fonts: scanDocumentFonts() });
      break;

    default:
      console.warn("[Token Manager plugin] Unknown message:", msg);
  }
});

// ════════════════════════════════════════════════════════════════════════
//  PENPOT EVENTS
// ════════════════════════════════════════════════════════════════════════

// Keep the UI in sync with the Penpot theme
penpot.on("themechange", (theme) => {
  send({ source: "penpot", type: "themechange", theme });
});

penpot.on("contentsave", () => publishSnapshot());
penpot.on("selectionchange", () => publishSelection());
// Also catches token (un)applications made from Penpot's own panel.
setInterval(() => {
  publishSnapshot();
  publishSelection();
}, POLL_INTERVAL_MS);
