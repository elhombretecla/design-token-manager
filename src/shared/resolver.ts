/**
 * shared/resolver.ts
 *
 * Resolves token values (alias references + math) against a chosen
 * context, independently of which sets happen to be active in Penpot.
 *
 * Penpot's own `resolvedValue` only looks at the active sets, so it can't
 * answer "what does this inactive set resolve to?" or "what would theme X
 * give?". This module reproduces Penpot's rules on top of the snapshot:
 *   • a context is an ordered stack of sets; on a name clash the later set
 *     wins (Penpot's precedence);
 *   • `{name}` references are looked up in that stack, recursively, with
 *     cycle and missing-reference detection;
 *   • after substitution, math expressions are evaluated (see math.ts);
 *   • composite values (typography, shadow) are resolved field by field.
 */

import { evaluateMath, looksLikeMath } from "./math";
import type { CatalogSnapshot, SnapshotToken } from "./protocol";

export type ResolveContext =
  /** Active sets, with the viewed set placed on top (wins every clash). */
  | { kind: "set-on-top"; setId: string }
  /** Exactly what Penpot uses: the active sets. */
  | { kind: "active" }
  /** The sets enabled by one theme. */
  | { kind: "theme"; themeId: string };

export type ResolutionStatus = "ok" | "broken" | "cycle" | "invalid";

export interface Resolution {
  /** Resolved display value; undefined when it can't be computed. */
  value?: string;
  status: ResolutionStatus;
  /** Referenced names that don't exist in the context. */
  missing: string[];
  /** Math / format error, for status "invalid". */
  error?: string;
}

const REF_RE = /\{([^{}"]+)\}/g;
const COMPOSITE_TYPES = new Set(["typography", "shadow"]);

/** Ordered set ids (lowest → highest precedence) for a context. */
export function contextSetIds(snapshot: CatalogSnapshot, ctx: ResolveContext): string[] {
  const order = snapshot.sets.map((s) => s.id);
  switch (ctx.kind) {
    case "active":
      return snapshot.sets.filter((s) => s.active).map((s) => s.id);
    case "set-on-top": {
      const active = snapshot.sets.filter((s) => s.active && s.id !== ctx.setId).map((s) => s.id);
      return order.includes(ctx.setId) ? [...active, ctx.setId] : active;
    }
    case "theme": {
      const theme = snapshot.themes.find((t) => t.id === ctx.themeId);
      if (!theme) return [];
      const members = new Set(theme.setIds);
      return order.filter((id) => members.has(id));
    }
  }
}

export class Resolver {
  private readonly byName = new Map<string, SnapshotToken>();
  private readonly memo = new Map<string, Resolution>();
  readonly setIds: ReadonlySet<string>;

  constructor(snapshot: CatalogSnapshot, orderedSetIds: string[]) {
    this.setIds = new Set(orderedSetIds);
    const setsById = new Map(snapshot.sets.map((s) => [s.id, s]));
    for (const id of orderedSetIds) {
      for (const token of setsById.get(id)?.tokens ?? []) {
        this.byName.set(token.name, token); // later sets overwrite earlier ones
      }
    }
  }

  static forContext(snapshot: CatalogSnapshot, ctx: ResolveContext): Resolver {
    return new Resolver(snapshot, contextSetIds(snapshot, ctx));
  }

  /** The token that wins for `name` in this context. */
  winner(name: string): SnapshotToken | undefined {
    return this.byName.get(name);
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  /** Resolve the winning token for `name`. */
  resolveName(name: string): Resolution {
    return this.resolveNameInner(name, new Set());
  }

  /**
   * Resolve a specific token's own value with references looked up in the
   * context — even if that token is not the winner (e.g. a shadowed token,
   * or one from a set outside the context).
   */
  resolveToken(token: SnapshotToken): Resolution {
    const stack = new Set<string>([token.name]);
    return this.resolveValue(token.type, token.value, stack);
  }

  private resolveNameInner(name: string, stack: Set<string>): Resolution {
    const cached = this.memo.get(name);
    if (cached) return cached;
    const token = this.byName.get(name);
    if (!token) return { status: "broken", missing: [name] };
    if (stack.has(name)) return { status: "cycle", missing: [] };

    stack.add(name);
    const result = this.resolveValue(token.type, token.value, stack);
    stack.delete(name);
    // Cycle results depend on the entry point; only memoise stable ones.
    if (result.status !== "cycle") this.memo.set(name, result);
    return result;
  }

  private resolveValue(type: string, value: string, stack: Set<string>): Resolution {
    if (COMPOSITE_TYPES.has(type)) {
      const fields = parseObject(value);
      if (fields) return this.resolveComposite(fields, stack);
    }
    return this.resolveString(value, stack);
  }

  private resolveComposite(fields: Record<string, unknown>, stack: Set<string>): Resolution {
    const out: Record<string, string> = {};
    const missing: string[] = [];
    let status = "ok" as ResolutionStatus;
    let error: string | undefined;

    for (const [key, raw] of Object.entries(fields)) {
      if (raw == null) continue;
      const str = String(raw);
      // Non-reference meta fields (e.g. shadow "type") pass through.
      if (key === "type") { out[key] = str; continue; }
      const r = this.resolveString(str, stack);
      missing.push(...r.missing);
      if (r.status !== "ok") {
        status = worse(status, r.status);
        error ??= r.error;
      }
      out[key] = r.value ?? str;
    }

    if (status === "broken" || status === "cycle") {
      return { status, missing: unique(missing), error };
    }
    return { value: JSON.stringify(out), status, missing: [], error };
  }

  private resolveString(input: string, stack: Set<string>): Resolution {
    const trimmed = input.trim();
    const refs = [...trimmed.matchAll(REF_RE)];

    // Whole value is one reference: inherit the referenced value as-is
    // (this is how composite aliases such as {typo.body} work).
    if (refs.length === 1 && refs[0][0] === trimmed) {
      return this.resolveNameInner(refs[0][1].trim(), stack);
    }

    const missing: string[] = [];
    let status = "ok" as ResolutionStatus;
    let error: string | undefined;

    const substituted = trimmed.replace(REF_RE, (match, rawName: string) => {
      const r = this.resolveNameInner(rawName.trim(), stack);
      missing.push(...r.missing);
      if (r.status !== "ok") {
        status = worse(status, r.status);
        error ??= r.error;
      }
      return r.value ?? match;
    });

    if (status === "broken" || status === "cycle") {
      return { status, missing: unique(missing), error };
    }

    if (looksLikeMath(substituted)) {
      const m = evaluateMath(substituted);
      if (m.ok) return { value: m.value, status, missing: [], error };
      return { value: substituted, status: "invalid", missing: [], error: m.error };
    }
    return { value: substituted, status, missing: [], error };
  }
}

const SEVERITY: Record<ResolutionStatus, number> = { ok: 0, invalid: 1, broken: 2, cycle: 3 };

function worse(a: ResolutionStatus, b: ResolutionStatus): ResolutionStatus {
  return SEVERITY[b] > SEVERITY[a] ? b : a;
}

function unique(xs: string[]): string[] {
  return [...new Set(xs)];
}

function parseObject(value: string): Record<string, unknown> | null {
  const s = value.trim();
  if (!s.startsWith("{") || !s.endsWith("}")) return null;
  try {
    const parsed: unknown = JSON.parse(s);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null; // a reference like {typo.body}, not JSON
  }
}
