/**
 * shared/math.ts
 *
 * Evaluator for math expressions in token values, after alias references
 * have been substituted (e.g. "8px * 2", "roundTo(16 * 1.33, 0)").
 *
 * Mirrors the rules Penpot documents for token math:
 *   • operators + - * / and parentheses
 *   • functions: roundTo(value, decimals) (plus min, max, floor, ceil, abs)
 *   • units must match, or be absent: "4px + 2" is fine, "1rem + 4px" is not
 *
 * Only strings that actually contain an operator or a function call are
 * evaluated; everything else ("16px", "#fff", "rgba(…)", "Inter") is left to
 * the caller untouched.
 */

interface Quantity {
  value: number;
  unit: string; // "" when unitless
}

type Tok =
  | { kind: "num"; q: Quantity }
  | { kind: "op"; op: "+" | "-" | "*" | "/" }
  | { kind: "lparen" }
  | { kind: "rparen" }
  | { kind: "comma" }
  | { kind: "fn"; name: string };

const FUNCTIONS: Record<string, (args: Quantity[]) => Quantity> = {
  roundTo: ([v, d]) => {
    if (!v) throw new Error("roundTo needs a value");
    const decimals = d ? Math.max(0, Math.round(d.value)) : 0;
    const f = 10 ** decimals;
    return { value: Math.round(v.value * f) / f, unit: v.unit };
  },
  min: (args) => reduceSameUnit(args, Math.min),
  max: (args) => reduceSameUnit(args, Math.max),
  floor: ([v]) => unary(v, Math.floor),
  ceil: ([v]) => unary(v, Math.ceil),
  abs: ([v]) => unary(v, Math.abs),
};

function unary(v: Quantity | undefined, fn: (n: number) => number): Quantity {
  if (!v) throw new Error("missing argument");
  return { value: fn(v.value), unit: v.unit };
}

function reduceSameUnit(args: Quantity[], fn: (...n: number[]) => number): Quantity {
  if (args.length === 0) throw new Error("missing argument");
  return { value: fn(...args.map((a) => a.value)), unit: commonUnit(args) };
}

function commonUnit(qs: Quantity[]): string {
  let unit = "";
  for (const q of qs) {
    if (!q.unit) continue;
    if (unit && unit !== q.unit) throw new Error(`Cannot mix units ${unit} and ${q.unit}`);
    unit = q.unit;
  }
  return unit;
}

const NUM_RE = /^(\d+\.?\d*|\.\d+)(px|rem|em|%|deg|ms|s|pt|vh|vw)?/;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*/;

function tokenize(input: string): Tok[] | null {
  const toks: Tok[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) { i++; continue; }
    if ("+-*/".includes(ch)) { toks.push({ kind: "op", op: ch as "+" | "-" | "*" | "/" }); i++; continue; }
    if (ch === "(") { toks.push({ kind: "lparen" }); i++; continue; }
    if (ch === ")") { toks.push({ kind: "rparen" }); i++; continue; }
    if (ch === ",") { toks.push({ kind: "comma" }); i++; continue; }
    const rest = input.slice(i);
    const num = NUM_RE.exec(rest);
    if (num) {
      toks.push({ kind: "num", q: { value: parseFloat(num[1]), unit: num[2] ?? "" } });
      i += num[0].length;
      continue;
    }
    const ident = IDENT_RE.exec(rest);
    if (ident && ident[0] in FUNCTIONS) {
      toks.push({ kind: "fn", name: ident[0] });
      i += ident[0].length;
      continue;
    }
    return null; // anything else (hex colors, words, unknown functions)
  }
  return toks;
}

// Recursive-descent parser: expr := term (('+'|'-') term)*
//                           term := unary (('*'|'/') unary)*
//                           unary := '-' unary | primary
//                           primary := num | fn '(' args ')' | '(' expr ')'
class Parser {
  private pos = 0;
  constructor(private readonly toks: Tok[]) {}

  parse(): Quantity {
    const q = this.expr();
    if (this.pos !== this.toks.length) throw new Error("Unexpected input");
    return q;
  }

  private peek(): Tok | undefined { return this.toks[this.pos]; }
  private next(): Tok | undefined { return this.toks[this.pos++]; }

  private expect(kind: Tok["kind"]): void {
    if (this.next()?.kind !== kind) throw new Error(`Expected ${kind}`);
  }

  private expr(): Quantity {
    let left = this.term();
    for (let t = this.peek(); t?.kind === "op" && (t.op === "+" || t.op === "-"); t = this.peek()) {
      this.pos++;
      const right = this.term();
      const unit = commonUnit([left, right]);
      left = { value: t.op === "+" ? left.value + right.value : left.value - right.value, unit };
    }
    return left;
  }

  private term(): Quantity {
    let left = this.unary();
    for (let t = this.peek(); t?.kind === "op" && (t.op === "*" || t.op === "/"); t = this.peek()) {
      this.pos++;
      const right = this.unary();
      if (t.op === "*") {
        left = { value: left.value * right.value, unit: commonUnit([left, right]) };
      } else {
        if (right.value === 0) throw new Error("Division by zero");
        // Same units cancel out ("16px / 2px" → 8); otherwise keep the unit.
        const unit = left.unit && left.unit === right.unit ? "" : commonUnit([left, right]);
        left = { value: left.value / right.value, unit };
      }
    }
    return left;
  }

  private unary(): Quantity {
    const t = this.peek();
    if (t?.kind === "op" && t.op === "-") {
      this.pos++;
      const q = this.unary();
      return { value: -q.value, unit: q.unit };
    }
    if (t?.kind === "op" && t.op === "+") {
      this.pos++;
      return this.unary();
    }
    return this.primary();
  }

  private primary(): Quantity {
    const t = this.next();
    if (!t) throw new Error("Unexpected end of expression");
    if (t.kind === "num") return t.q;
    if (t.kind === "lparen") {
      const q = this.expr();
      this.expect("rparen");
      return q;
    }
    if (t.kind === "fn") {
      this.expect("lparen");
      const args: Quantity[] = [];
      if (this.peek()?.kind !== "rparen") {
        args.push(this.expr());
        while (this.peek()?.kind === "comma") {
          this.pos++;
          args.push(this.expr());
        }
      }
      this.expect("rparen");
      return FUNCTIONS[t.name](args);
    }
    throw new Error("Unexpected token");
  }
}

export function formatNumber(n: number): string {
  // Avoid float noise such as 0.30000000000000004 → "0.3".
  const rounded = Math.round(n * 1e4) / 1e4;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/** True when the string contains something to compute (operator between operands, or a function). */
export function looksLikeMath(input: string): boolean {
  const toks = tokenize(input);
  if (!toks) return false;
  return toks.some((t, i) => t.kind === "fn" || (t.kind === "op" && i > 0));
}

export type MathResult = { ok: true; value: string } | { ok: false; error: string };

/**
 * Evaluate a math expression. Returns ok:false with a reason when the input is
 * not a valid expression (callers usually fall back to the raw string).
 */
export function evaluateMath(input: string): MathResult {
  const toks = tokenize(input);
  if (!toks || toks.length === 0) return { ok: false, error: "Not a math expression" };
  try {
    const q = new Parser(toks).parse();
    if (!Number.isFinite(q.value)) return { ok: false, error: "Result is not a finite number" };
    return { ok: true, value: formatNumber(q.value) + q.unit };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
