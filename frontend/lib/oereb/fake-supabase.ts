/**
 * Kleine Supabase-Attrappe für Tests, im Speicher. Jede Abfrage läuft in einem Zug wie ein einzelnes
 * Statement. Ersetzt keine echte Datenbank: Das Sperrverhalten von Postgres prüft sie nicht.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

const DEFAULTS: Record<string, () => Row> = {
  oereb_documents: () => ({
    status: "pending", attempts: 0, lock_until: null, norm_id: null, etag: null, last_modified: null,
    pdf_sha256: null, text_sha256: null, reject_reason: null, reject_detail: null, last_update_status: null,
    last_update_detail: null, last_checked_at: null, next_check_at: new Date(Date.now() - 1000).toISOString(),
    official_number: null, article_run: null, article_first: null, article_hits: null, stand_date: null,
    text_sketch: null, content_reason: null, version_winner_id: null, version_note: null,
  }),
};

function parseOr(expr: string): Filter {
  const terms = expr.split(",").map((t) => {
    const [col, op, ...rest] = t.split(".");
    const value = rest.join(".");
    if (op === "is" && value === "null") return (r: Row) => r[col] === null || r[col] === undefined;
    if (op === "lt") return (r: Row) => r[col] !== null && String(r[col]) < value;
    if (op === "eq") return (r: Row) => String(r[col]) === value;
    throw new Error(`or-Ausdruck nicht unterstützt: ${t}`);
  });
  return (r) => terms.some((f) => f(r));
}

class Query implements PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> {
  private filters: Filter[] = [];
  private op: "select" | "update" | "insert" | "upsert" | "delete" = "select";
  private payload: Row | Row[] | null = null;
  private opts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  private mode: "many" | "single" | "maybe" = "many";
  private max: number | null = null;
  private db: FakeSupabase;
  private table: string;

  constructor(db: FakeSupabase, table: string) {
    this.db = db;
    this.table = table;
  }

  select(_cols?: string) { return this; }
  eq(col: string, v: unknown) { this.filters.push((r) => r[col] === v); return this; }
  is(col: string, v: unknown) { this.filters.push((r) => (r[col] ?? null) === v); return this; }
  not(col: string, op: string, v: unknown) {
    if (op !== "is") throw new Error(`not-Operator nicht unterstützt: ${op}`);
    this.filters.push((r) => (r[col] ?? null) !== v);
    return this;
  }
  in(col: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[col])); return this; }
  lte(col: string, v: string) { this.filters.push((r) => String(r[col]) <= v); return this; }
  or(expr: string) { this.filters.push(parseOr(expr)); return this; }
  limit(n: number) { this.max = n; return this; }
  single() { this.mode = "single"; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }
  update(p: Row) { this.op = "update"; this.payload = p; return this; }
  insert(p: Row | Row[]) { this.op = "insert"; this.payload = p; return this; }
  upsert(p: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.op = "upsert"; this.payload = p; this.opts = opts; return this;
  }
  delete() { this.op = "delete"; return this; }

  private run(): { data: unknown; error: { message: string; code?: string } | null } {
    if (this.db.missing.has(this.table)) {
      return { data: null, error: { message: `Could not find the table 'public.${this.table}' in the schema cache` } };
    }
    const rows = this.db.rows(this.table);
    let out: Row[] = [];

    if (this.op === "insert" || this.op === "upsert") {
      for (const p of Array.isArray(this.payload) ? this.payload : [this.payload as Row]) {
        const keys = (this.opts.onConflict ?? "").split(",").filter(Boolean);
        const clash = keys.length ? rows.find((r) => keys.every((k) => r[k] === p[k])) : undefined;
        if (clash) {
          if (!this.opts.ignoreDuplicates) Object.assign(clash, p);
          continue;
        }
        if (this.table === "norms" && rows.some((r) => r.title === p.title && r.jurisdiction_name === p.jurisdiction_name && (r.org_id ?? null) === (p.org_id ?? null))) {
          return { data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } };
        }
        const row = { ...(DEFAULTS[this.table]?.() ?? {}), id: this.db.nextId(this.table), ...p };
        rows.push(row);
        out.push(row);
      }
    } else {
      out = rows.filter((r) => this.filters.every((f) => f(r)));
      if (this.op === "update") out.forEach((r) => Object.assign(r, this.payload));
      if (this.op === "delete") this.db.setRows(this.table, rows.filter((r) => !out.includes(r)));
    }
    if (this.max !== null) out = out.slice(0, this.max);

    const copies = out.map((r) => structuredClone(r));
    if (this.mode === "many") return { data: copies, error: null };
    if (copies.length > 1) return { data: null, error: { message: "mehrere Zeilen" } };
    if (copies.length === 0 && this.mode === "single") return { data: null, error: { message: "keine Zeile" } };
    return { data: copies[0] ?? null, error: null };
  }

  then<A, B>(
    ok?: ((v: { data: unknown; error: { message: string; code?: string } | null }) => A | PromiseLike<A>) | null,
    fail?: ((e: unknown) => B | PromiseLike<B>) | null
  ): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.run()).then(ok, fail);
  }
}

export class FakeSupabase {
  missing = new Set<string>();
  private tables = new Map<string, Row[]>();
  private counter = 0;

  rows(table: string): Row[] {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table) as Row[];
  }
  setRows(table: string, rows: Row[]) {
    this.tables.set(table, rows);
  }
  nextId(table: string): string {
    return `${table}-${++this.counter}`;
  }
  from(table: string) {
    return new Query(this, table);
  }
  asClient(): SupabaseClient {
    return this as unknown as SupabaseClient;
  }
}
