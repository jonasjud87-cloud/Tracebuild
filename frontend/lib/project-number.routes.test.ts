/**
 * Routen-Tests Projektnummer: POST /api/v1/projects und PATCH /api/v1/projects/[id]
 * mit einer Fake-Datenbank. Auth, Admin-Client, ÖREB, Audit und Normzuweisung werden
 * per Resolve-Hook durch Stubs ersetzt; der Produktivcode bleibt unverändert.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";

// registerHooks gibt es ab Node 22.15/23.5; die installierten @types/node kennen es noch nicht.
interface ResolveResult { url: string; shortCircuit?: boolean }
type NextResolve = (specifier: string, context: unknown) => ResolveResult;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: unknown, nextResolve: NextResolve): ResolveResult }): void;
};

import { PROJECT_NUMBER_CHECK, PROJECT_NUMBER_UNIQUE_INDEX } from "./project-number";

type Row = Record<string, unknown>;
interface Op {
  table: string;
  kind: "select" | "insert" | "update" | "delete";
  payload: Row | null;
  filters: [string, unknown][];
}
interface DbError { code: string; message: string; details?: string | null }
interface User { id: string; org_id: string; role: string; email: string }

const ORG_A = "org-a";
const ORG_B = "org-b";
const ALL_COLUMNS = [
  "id", "org_id", "name", "domain", "location", "status", "created_at",
  "parcel_number", "bauzone", "zone_source", "zone_confidence",
  "egrid", "lv95_e", "lv95_n", "bfs_number", "project_number",
];

class FakeDb {
  columns = new Set(ALL_COLUMNS);
  rows: Row[] = [];
  ops: Op[] = [];
  seq = 0;
  /** Optional: erzwungener Fehler für die nächste Schreiboperation auf projects. */
  forcedErrors: DbError[] = [];
  /** PostgREST-Reihenfolge ist nicht garantiert: wahlweise letzte statt erste unbekannte Spalte melden. */
  reportLastUnknown = false;

  run(op: Op): { data: unknown; error: DbError | null } {
    this.ops.push(op);
    if (op.table !== "projects") return { data: null, error: null };
    const match = (r: Row) => op.filters.every(([c, v]) => r[c] === v);

    if (op.kind === "select") {
      const found = this.rows.filter(match);
      if (found.length !== 1) return { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } };
      return { data: this.project(found[0]), error: null };
    }
    if (op.kind === "delete") return { data: null, error: null };

    const forced = this.forcedErrors.shift();
    if (forced) return { data: null, error: forced };

    // PostgREST nennt die erste unbekannte Spalte des Payloads.
    const keys = Object.keys(op.payload ?? {});
    if (this.reportLastUnknown) keys.reverse();
    for (const key of keys) {
      if (!this.columns.has(key)) {
        return { data: null, error: { code: "PGRST204", message: `Could not find the '${key}' column of 'projects' in the schema cache` } };
      }
    }

    if (op.kind === "insert") {
      const row: Row = { id: `p${++this.seq}`, created_at: "2026-11-09T00:00:00Z", ...op.payload };
      const dup = this.uniqueViolation(row);
      if (dup) return { data: null, error: dup };
      this.rows.push(row);
      return { data: this.project(row), error: null };
    }

    const targets = this.rows.filter(match);
    if (targets.length !== 1) return { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } };
    const next = { ...targets[0], ...op.payload };
    const dup = this.uniqueViolation(next);
    if (dup) return { data: null, error: dup };
    Object.assign(targets[0], op.payload);
    return { data: this.project(targets[0]), error: null };
  }

  /** Wie select("*"): nur vorhandene Spalten. */
  project(row: Row): Row {
    return Object.fromEntries(Object.entries(row).filter(([k]) => this.columns.has(k)));
  }

  uniqueViolation(row: Row): DbError | null {
    if (!this.columns.has("project_number") || typeof row.project_number !== "string") return null;
    const clash = this.rows.find(
      (r) =>
        r.id !== row.id &&
        r.org_id === row.org_id &&
        typeof r.project_number === "string" &&
        r.project_number.toLowerCase() === (row.project_number as string).toLowerCase(),
    );
    if (!clash) return null;
    return {
      code: "23505",
      message: `duplicate key value violates unique constraint "${PROJECT_NUMBER_UNIQUE_INDEX}"`,
      details: `Key (org_id, lower(project_number))=(${row.org_id}, ${(row.project_number as string).toLowerCase()}) already exists.`,
    };
  }

  writes(kind: "insert" | "update") {
    return this.ops.filter((o) => o.table === "projects" && o.kind === kind);
  }
}

class Query implements PromiseLike<{ data: unknown; error: DbError | null }> {
  private op: Op;
  private db: FakeDb;
  constructor(db: FakeDb, table: string) {
    this.db = db;
    this.op = { table, kind: "select", payload: null, filters: [] };
  }
  select() { return this; }
  insert(row: Row) { this.op.kind = "insert"; this.op.payload = { ...row }; return this; }
  update(row: Row) { this.op.kind = "update"; this.op.payload = { ...row }; return this; }
  delete() { this.op.kind = "delete"; return this; }
  eq(column: string, value: unknown) { this.op.filters.push([column, value]); return this; }
  order() { return this; }
  single() { return this; }
  then<A = { data: unknown; error: DbError | null }, B = never>(
    onFulfilled?: ((v: { data: unknown; error: DbError | null }) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.db.run(this.op)).then(onFulfilled, onRejected);
  }
}

interface FakeState {
  db: FakeDb;
  user: User | null;
  calls: { refresh: number; audit: Row[]; assignNorms: number; invalidate: number; reapply: number };
}

const state: FakeState = {
  db: new FakeDb(),
  user: null,
  calls: { refresh: 0, audit: [], assignNorms: 0, invalidate: 0, reapply: 0 },
};
(globalThis as unknown as { __pnFake: FakeState & { client: () => unknown } }).__pnFake = Object.assign(state, {
  client: () => ({ from: (table: string) => new Query(state.db, table) }),
});

const F = "globalThis.__pnFake";
const STUBS: Record<string, string> = {
  "@/lib/auth": `
    const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    export async function getAuthUser() { return ${F}.user; }
    export function unauthorized() { return json({ data: null, error: "Nicht eingeloggt" }, 401); }
    export function forbidden() { return json({ data: null, error: "Zugriff verweigert" }, 403); }
    export function ok(data, status = 200) { return json({ data, error: null }, status); }
    export function err(message, status = 400) { return json({ data: null, error: message }, status); }
  `,
  "@/lib/supabase/admin": `export function createAdminClient() { return ${F}.client(); }`,
  "@/lib/norm-assignment": `export async function assignNorms() { ${F}.calls.assignNorms++; return { total: 0, oerebAssigned: 0, gaps: [] }; }`,
  "@/lib/oereb/refresh": `export async function refreshProjectOereb() { ${F}.calls.refresh++; return { result: null, documents_pending: 0 }; }`,
  "@/lib/auditLog": `export async function logAudit(_a, entry) { ${F}.calls.audit.push(entry); }`,
  "@/lib/oereb/fetch": `
    export async function invalidateExtract() { ${F}.calls.invalidate++; }
    export async function reapplyZoneFromStoredExtract() { ${F}.calls.reapply++; }
  `,
  "@/lib/oereb/documents-pending": `export async function countPendingDocuments() { return 0; }`,
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    const stub = STUBS[specifier];
    if (stub !== undefined) {
      return { url: `data:text/javascript,${encodeURIComponent(stub)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

type Handler = (req: Request, ctx?: { params: { id: string } }) => Promise<Response>;
let POST: Handler;
let PATCH: Handler;

const admin = (org = ORG_A): User => ({ id: "u1", org_id: org, role: "org_admin", email: "a@example.ch" });

function seed(row: Row): Row {
  const full: Row = {
    id: `seed${++state.db.seq}`,
    org_id: ORG_A,
    name: "Bestand",
    domain: "bau",
    location: { canton: "ZH", municipality: "Zürich", country: "CH" },
    status: "active",
    parcel_number: null,
    bauzone: null,
    project_number: null,
    ...row,
  };
  state.db.rows.push(full);
  return full;
}

async function call(handler: Handler, body: unknown, id?: string) {
  const req = new Request("http://localhost/api/v1/projects", {
    method: id ? "PATCH" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await handler(req, id ? { params: { id } } : undefined);
  const json = (await res.json()) as { data: Row | { project: Row } | null; error: string | null };
  return { status: res.status, ...json };
}

function sideEffects() {
  const c = state.calls;
  return { refresh: c.refresh, audit: c.audit.length, assignNorms: c.assignNorms, invalidate: c.invalidate };
}

const NONE = { refresh: 0, audit: 0, assignNorms: 0, invalidate: 0 };

beforeEach(async () => {
  state.db = new FakeDb();
  state.user = admin();
  state.calls = { refresh: 0, audit: [], assignNorms: 0, invalidate: 0, reapply: 0 };
  if (!POST) {
    ({ POST } = (await import("../app/api/v1/projects/route")) as unknown as { POST: Handler });
    ({ PATCH } = (await import("../app/api/v1/projects/[id]/route")) as unknown as { PATCH: Handler });
  }
});

// ── POST ────────────────────────────────────────────────────────────────────

test("POST: Nummer wird getrimmt gespeichert und im Audit erfasst", async () => {
  const r = await call(POST, { name: "Neubau", location: { canton: "ZH", municipality: "Zürich" }, project_number: "  2024-017 " });
  assert.equal(r.status, 201, r.error ?? "");
  assert.equal(state.db.rows[0].project_number, "2024-017");
  assert.equal(state.calls.audit[0].meta && (state.calls.audit[0].meta as Row).project_number, "2024-017");
});

test("POST: Leerstring und nur Leerzeichen ergeben kein project_number im Insert", async () => {
  for (const pn of ["", "   ", null]) {
    state.db = new FakeDb();
    const r = await call(POST, { name: "Neubau", location: { canton: "ZH", municipality: "Zürich" }, project_number: pn });
    assert.equal(r.status, 201);
    assert.equal("project_number" in (state.db.writes("insert")[0].payload ?? {}), false, JSON.stringify(pn));
  }
});

test("POST: Konflikt (case-insensitiv) ergibt 409 ohne Projekt, Audit, ÖREB und Normzuweisung", async () => {
  seed({ project_number: "2024-017" });
  const before = state.db.rows.length;
  const r = await call(POST, {
    name: "Neubau", location: { canton: "ZH", municipality: "Zürich" }, project_number: "2024-017",
    parcel_number: "123", egrid: "CH123456789012",
  });
  assert.equal(r.status, 409);
  assert.match(r.error ?? "", /bereits vergeben/);
  assert.equal(state.db.rows.length, before);
  assert.deepEqual(sideEffects(), NONE);
  // Kein Retry durch die Spalten-Fallbacks.
  assert.equal(state.db.writes("insert").length, 1);
});

test("POST: Konflikt mit 'p-1' vs 'P-1' (Grossschreibung) ist ein Konflikt", async () => {
  seed({ project_number: "p-1" });
  const r = await call(POST, { name: "X", location: { canton: "ZH", municipality: "Zürich" }, project_number: "P-1" });
  assert.equal(r.status, 409);
});

test("POST: gleiche Nummer in fremder Org ist erlaubt, Meldung verrät nichts über fremde Orgs", async () => {
  seed({ org_id: ORG_B, project_number: "2024-017", name: "Geheim B" });
  const r = await call(POST, { name: "Neubau", location: { canton: "ZH", municipality: "Zürich" }, project_number: "2024-017" });
  assert.equal(r.status, 201);
  // Und umgekehrt: Konfliktmeldung in Org A nennt keine Projektnamen.
  seed({ project_number: "A-1", name: "Geheimprojekt A" });
  const r2 = await call(POST, { name: "Y", location: { canton: "ZH", municipality: "Zürich" }, project_number: "A-1" });
  assert.equal(r2.status, 409);
  assert.equal((r2.error ?? "").includes("Geheimprojekt"), false);
  assert.equal((r2.error ?? "").includes(ORG_A), false);
});

test("POST: ungültige Nummer ergibt 400 ohne DB-Schreibzugriff", async () => {
  for (const pn of ["a".repeat(41), 42, "A\nB", { x: 1 }]) {
    const r = await call(POST, { name: "X", location: { canton: "ZH", municipality: "Zürich" }, project_number: pn });
    assert.equal(r.status, 400, JSON.stringify(pn));
  }
  assert.equal(state.db.writes("insert").length, 0);
  assert.deepEqual(sideEffects(), NONE);
});

test("POST: ohne Login 401, kein Insert", async () => {
  state.user = null;
  const r = await call(POST, { name: "X", project_number: "1" });
  assert.equal(r.status, 401);
  assert.equal(state.db.ops.length, 0);
});

test("POST: Spalte project_number fehlt → Nummer still verworfen, Projekt angelegt", async () => {
  state.db.columns.delete("project_number");
  const r = await call(POST, { name: "Neubau", location: { canton: "ZH", municipality: "Zürich" }, project_number: "2024-017" });
  assert.equal(r.status, 201, r.error ?? "");
  assert.equal(state.db.rows.length, 1);
  assert.equal("project_number" in state.db.rows[0], false);
  assert.equal((state.calls.audit[0].meta as Row).project_number, null);
});

test("POST: alle drei Migrationen fehlen, in jeder Spaltenreihenfolge → Projekt wird angelegt", async () => {
  const missing = ["project_number", "egrid", "lv95_e", "lv95_n", "bfs_number", "parcel_number", "bauzone"];
  for (const reportLast of [false, true]) {
    state.db = new FakeDb();
    state.db.reportLastUnknown = reportLast;
    state.db.columns = new Set(ALL_COLUMNS.filter((c) => !missing.includes(c)));
    const r = await call(POST, {
      name: "Alt", location: { canton: "ZH", municipality: "Zürich" }, project_number: "N-1",
      parcel_number: "12", bauzone: "W2", egrid: "CH123456789012",
    });
    assert.equal(r.status, 201, `${reportLast}: ${r.error ?? ""}`);
    assert.equal(state.db.rows.length, 1);
    assert.equal(state.db.rows[0].name, "Alt");
  }
});

test("POST: nur Geoportal-Spalten fehlen, Nummer bleibt erhalten", async () => {
  state.db.columns = new Set(ALL_COLUMNS.filter((c) => !["egrid", "lv95_e", "lv95_n", "bfs_number"].includes(c)));
  const r = await call(POST, {
    name: "Neu", location: { canton: "ZH", municipality: "Zürich" }, project_number: "G-1", egrid: "CH123456789012",
  });
  assert.equal(r.status, 201, r.error ?? "");
  assert.equal(state.db.rows[0].project_number, "G-1");
});

test("POST: Konflikt nach Geoportal-Fallback ergibt trotzdem 409", async () => {
  state.db.columns = new Set(ALL_COLUMNS.filter((c) => !["egrid", "lv95_e", "lv95_n", "bfs_number"].includes(c)));
  seed({ project_number: "G-1" });
  const r = await call(POST, {
    name: "Neu", location: { canton: "ZH", municipality: "Zürich" }, project_number: "g-1", egrid: "CH123456789012",
  });
  assert.equal(r.status, 409);
  assert.deepEqual(sideEffects(), NONE);
});

test("POST: Check-Verletzung der DB ergibt 400 statt 500", async () => {
  state.db.forcedErrors.push({ code: "23514", message: `new row for relation "projects" violates check constraint "${PROJECT_NUMBER_CHECK}"` });
  const r = await call(POST, { name: "X", location: { canton: "ZH", municipality: "Zürich" }, project_number: "A\u0085B" });
  assert.equal(r.status, 400);
  assert.deepEqual(sideEffects(), NONE);
});

// ── PATCH ───────────────────────────────────────────────────────────────────

test("PATCH: Nummer setzen, Update mit org_id-Filter", async () => {
  const p = seed({});
  const r = await call(PATCH, { project_number: " 2024-017 " }, p.id as string);
  assert.equal(r.status, 200, r.error ?? "");
  assert.equal(p.project_number, "2024-017");
  const upd = state.db.writes("update")[0];
  assert.deepEqual(upd.filters, [["id", p.id], ["org_id", ORG_A]]);
});

test("PATCH: Nummer leeren setzt NULL", async () => {
  const p = seed({ project_number: "X-1" });
  const r = await call(PATCH, { project_number: "  " }, p.id as string);
  assert.equal(r.status, 200);
  assert.equal(p.project_number, null);
});

test("PATCH: eigene Nummer in anderer Schreibweise ist kein Konflikt", async () => {
  const p = seed({ project_number: "abc" });
  const r = await call(PATCH, { project_number: "ABC" }, p.id as string);
  assert.equal(r.status, 200, r.error ?? "");
  assert.equal(p.project_number, "ABC");
});

test("PATCH: Konflikt ergibt 409, Name/Ort nicht gespeichert, keine Nebenwirkungen", async () => {
  seed({ project_number: "2024-017" });
  const p = seed({ name: "Alt", project_number: "B-2" });
  const r = await call(
    PATCH,
    { name: "Neu", location: { canton: "BE", municipality: "Bern" }, project_number: "2024-017", bauzone: "W3" },
    p.id as string,
  );
  assert.equal(r.status, 409);
  assert.match(r.error ?? "", /«2024-017»/);
  assert.equal(p.name, "Alt");
  assert.equal(p.project_number, "B-2");
  assert.deepEqual((p.location as Row).canton, "ZH");
  assert.deepEqual(sideEffects(), NONE);
  assert.equal(state.calls.reapply, 0);
  assert.equal(state.db.writes("update").length, 1);
});

test("PATCH: Nummern- und ÖREB-Spalten fehlen (Geoportal vorhanden), beide Reihenfolgen → gespeichert", async () => {
  for (const reportLast of [false, true]) {
    state.db = new FakeDb();
    state.db.reportLastUnknown = reportLast;
    for (const c of ["project_number", "zone_source", "zone_confidence"]) state.db.columns.delete(c);
    const p = seed({ name: "Alt" });
    delete p.project_number;
    const r = await call(PATCH, { name: "Neu", bauzone: "W2", project_number: "N-3" }, p.id as string);
    assert.equal(r.status, 200, `${reportLast}: ${r.error ?? ""}`);
    assert.equal(p.name, "Neu");
    assert.equal(p.bauzone, "W2");
  }
});

test("PATCH: Konflikt nach ÖREB-Fallback (zone_source fehlt) ergibt trotzdem 409", async () => {
  state.db.columns.delete("zone_source");
  state.db.columns.delete("zone_confidence");
  seed({ project_number: "Z-1" });
  const p = seed({});
  const r = await call(PATCH, { bauzone: "W2", project_number: "z-1" }, p.id as string);
  assert.equal(r.status, 409);
  assert.deepEqual(sideEffects(), NONE);
});

test("PATCH: fremde Org → 404, kein Update, kein Hinweis auf das Projekt", async () => {
  const foreign = seed({ org_id: ORG_B, project_number: "B-1", name: "Fremd" });
  const r = await call(PATCH, { project_number: "X" }, foreign.id as string);
  assert.equal(r.status, 404);
  assert.equal((r.error ?? "").includes("Fremd"), false);
  assert.equal(state.db.writes("update").length, 0);
  assert.equal(foreign.project_number, "B-1");
});

test("PATCH: Nummer einer fremden Org ist in der eigenen Org frei", async () => {
  seed({ org_id: ORG_B, project_number: "SAME" });
  const p = seed({});
  const r = await call(PATCH, { project_number: "same" }, p.id as string);
  assert.equal(r.status, 200, r.error ?? "");
});

test("PATCH: Nicht-Admin → 403 ohne DB-Zugriff", async () => {
  const p = seed({});
  for (const role of ["member", "project_manager"]) {
    state.user = { ...admin(), role };
    const r = await call(PATCH, { project_number: "X" }, p.id as string);
    assert.equal(r.status, 403);
  }
  assert.equal(state.db.ops.length, 0);
});

test("PATCH: ungültige Nummer → 400, nichts gespeichert", async () => {
  const p = seed({ name: "Alt" });
  const r = await call(PATCH, { name: "Neu", project_number: "x".repeat(41) }, p.id as string);
  assert.equal(r.status, 400);
  assert.equal(p.name, "Alt");
  assert.equal(state.db.writes("update").length, 0);
});

test("PATCH: Name ändern ohne Nummer schickt kein project_number mit (auch ohne Spalte)", async () => {
  state.db.columns.delete("project_number");
  const p = seed({ name: "Alt" });
  delete p.project_number;
  const r = await call(PATCH, { name: "Neu" }, p.id as string);
  assert.equal(r.status, 200, r.error ?? "");
  assert.equal(p.name, "Neu");
  for (const u of state.db.writes("update")) assert.equal("project_number" in (u.payload ?? {}), false);
});

test("PATCH: Spalte fehlt, nur Nummer geschickt → 200 ohne zweites Update", async () => {
  state.db.columns.delete("project_number");
  const p = seed({});
  delete p.project_number;
  const r = await call(PATCH, { project_number: "N-1" }, p.id as string);
  assert.equal(r.status, 200, r.error ?? "");
  assert.equal(state.db.writes("update").length, 1);
  assert.equal("project_number" in p, false);
});

test("PATCH: Spalte fehlt, Name + Nummer → Name gespeichert, Nummer verworfen", async () => {
  state.db.columns.delete("project_number");
  const p = seed({ name: "Alt" });
  delete p.project_number;
  const r = await call(PATCH, { name: "Neu", project_number: "N-1" }, p.id as string);
  assert.equal(r.status, 200, r.error ?? "");
  assert.equal(p.name, "Neu");
  assert.equal("project_number" in p, false);
});

test("PATCH: Geoportal- und Nummern-Spalten fehlen, Ortswechsel → gespeichert (beide Reihenfolgen)", async () => {
  for (const reportLast of [false, true]) {
    state.db = new FakeDb();
    state.db.reportLastUnknown = reportLast;
    // zone_source bleibt vorhanden: fehlen ÖREB- und Geoportal-Spalten zugleich, scheitert schon main
    // (zone_source zuerst gemeldet → Stufe 2 übersprungen), unabhängig von der Projektnummer.
    for (const c of ["project_number", "egrid", "lv95_e", "lv95_n", "bfs_number"]) {
      state.db.columns.delete(c);
    }
    const p = seed({ name: "Alt" });
    delete p.project_number;
    const r = await call(
      PATCH,
      { name: "Neu", location: { canton: "BE", municipality: "Bern" }, project_number: "N-2", egrid: "CH123456789012", bauzone: "W2" },
      p.id as string,
    );
    assert.equal(r.status, 200, `${reportLast}: ${r.error ?? ""}`);
    assert.equal(p.name, "Neu");
    assert.equal((p.location as Row).canton, "BE");
    assert.equal(p.bauzone, "W2");
  }
});
