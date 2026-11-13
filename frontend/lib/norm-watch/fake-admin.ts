type Row = Record<string, unknown>;

export type FakeTables = Record<string, Row[]>;

interface Result {
  data: unknown;
  error: { message: string; code?: string } | null;
}

class Query implements PromiseLike<Result> {
  private op: "select" | "insert" | "update" | "delete" = "select";
  private filters: Array<(r: Row) => boolean> = [];
  private payload: Row = {};
  private returning = false;
  private one = false;

  private tables: FakeTables;
  private name: string;

  constructor(tables: FakeTables, name: string) {
    this.tables = tables;
    this.name = name;
    if (!tables[name]) tables[name] = [];
  }

  select(_columns?: string) {
    this.returning = true;
    return this;
  }
  insert(row: Row) {
    this.op = "insert";
    this.payload = row;
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.payload = patch;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  is(col: string, val: unknown) {
    this.filters.push((r) => (r[col] ?? null) === val);
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  maybeSingle() {
    this.one = true;
    return this;
  }
  single() {
    this.one = true;
    return this;
  }

  then<T1 = Result, T2 = never>(
    onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.exec()).then(onfulfilled, onrejected);
  }

  private shape(rows: Row[]): Result {
    if (this.one) return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  }

  private exec(): Result {
    const table = this.tables[this.name];
    const matches = table.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === "insert") {
      const row: Row = { id: crypto.randomUUID(), ...this.payload };
      if (this.name === "norm_update_drafts" && (row.status ?? "draft") === "draft") {
        row.status = "draft";
        if (table.some((r) => r.source_id === row.source_id && r.status === "draft")) {
          return { data: null, error: { message: "duplicate key", code: "23505" } };
        }
      }
      table.push(row);
      return this.shape(this.returning ? [row] : []);
    }
    if (this.op === "update") {
      for (const r of matches) Object.assign(r, this.payload);
      return this.shape(this.returning ? matches : []);
    }
    if (this.op === "delete") {
      this.tables[this.name] = table.filter((r) => !matches.includes(r));
      return this.shape(this.returning ? matches : []);
    }
    return this.shape(matches);
  }
}

export function fakeAdmin(tables: FakeTables) {
  return {
    tables,
    from(name: string) {
      return new Query(tables, name);
    },
  };
}
