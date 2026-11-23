/**
 * Routen-Tests GET /api/v1/admin/all-users mit Attrappen für Auth und Admin-Client.
 * Prüft Rechte (401/403 ohne DB-Zugriff), Zusammenführung der Aktivität, Rückfall ohne
 * Migration und das Zeitverhalten (Aktivität blockiert nicht, Kern-Timeout gibt 504).
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";

interface ResolveResult { url: string; shortCircuit?: boolean }
type NextResolve = (specifier: string, context: unknown) => ResolveResult;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: unknown, nextResolve: NextResolve): ResolveResult }): void;
};

type Row = Record<string, unknown>;
interface DbError { code: string; message: string }
interface Result { data: unknown; error: DbError | null }
interface User { id: string; org_id: string; role: string; email: string }

interface FakeState {
  user: User | null;
  tables: Record<string, Row[]>;
  tableError: Record<string, DbError | undefined>;
  authUsers: Row[];
  authError: boolean;
  rpc: () => Promise<Result>;
  hang: Set<string>;
  calls: { client: number; tables: string[]; rpc: number; ranges: [number, number][] };
}

const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

const state: FakeState = {
  user: null,
  tables: {},
  tableError: {},
  authUsers: [],
  authError: false,
  rpc: async () => ({ data: [], error: null }),
  hang: new Set(),
  calls: { client: 0, tables: [], rpc: 0, ranges: [] },
};

class Query implements PromiseLike<Result> {
  private filters: ((r: Row) => boolean)[] = [];
  private range_: [number, number] | null = null;
  private table: string;
  constructor(table: string) { this.table = table; }
  select() { return this; }
  order() { return this; }
  is(col: string, val: unknown) { this.filters.push(r => (r[col] ?? null) === val); return this; }
  not(col: string, _op: string, val: unknown) { this.filters.push(r => (r[col] ?? null) !== val); return this; }
  range(from: number, to: number) { this.range_ = [from, to]; state.calls.ranges.push([from, to]); return this; }
  abortSignal(_signal: AbortSignal) { return this; }
  private run(): Promise<Result> {
    if (state.hang.has(this.table)) return never();
    const e = state.tableError[this.table];
    if (e) return Promise.resolve({ data: null, error: e });
    let rows = (state.tables[this.table] ?? []).filter(r => this.filters.every(f => f(r)));
    if (this.range_) rows = rows.slice(this.range_[0], this.range_[1] + 1);
    return Promise.resolve({ data: rows, error: null });
  }
  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, ko?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.run().then(ok, ko);
  }
}

(globalThis as unknown as { __auFake: FakeState & { client: () => unknown } }).__auFake = Object.assign(state, {
  client: () => {
    state.calls.client++;
    return {
      from: (t: string) => { state.calls.tables.push(t); return new Query(t); },
      rpc: (name: string) => { state.calls.rpc++; assert.equal(name, "admin_last_activity"); const p = state.rpc(); return Object.assign(p, { abortSignal: (_signal: AbortSignal) => p }); },
      auth: {
        admin: {
          listUsers: async ({ page, perPage }: { page: number; perPage: number }) => {
            if (state.hang.has("auth")) return never();
            if (state.authError) return { data: null, error: { message: "x" } };
            return { data: { users: state.authUsers.slice((page - 1) * perPage, page * perPage) }, error: null };
          },
        },
      },
    };
  },
});

const F = "globalThis.__auFake";
const STUBS: Record<string, string> = {
  "@/lib/auth": `
    const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    export const ADMIN_EMAILS = new Set(["boss@example.ch"]);
    export async function getAuthUser() { return ${F}.user; }
    export function unauthorized() { return json({ data: null, error: "Nicht eingeloggt" }, 401); }
    export function forbidden() { return json({ data: null, error: "Zugriff verweigert" }, 403); }
    export function ok(data, status = 200) { return json({ data, error: null }, status); }
    export function err(message, status = 400) { return json({ data: null, error: message }, status); }
  `,
  "@/lib/supabase/admin": `export function createAdminClient() { return ${F}.client(); }`,
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    const stub = STUBS[specifier];
    if (stub !== undefined) return { url: `data:text/javascript,${encodeURIComponent(stub)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

let GET: () => Promise<Response>;

const SUPER: User = { id: "s1", org_id: "o1", role: "super_admin", email: "boss@example.ch" };

beforeEach(async () => {
  GET ??= (await import("../app/api/v1/admin/all-users/route")).GET;
  state.user = SUPER;
  state.tables = {
    organizations: [
      { id: "o1", name: "Alpha", deleted_at: null },
      { id: "o2", name: "Beta", deleted_at: null },
      { id: "o3", name: "Gelöscht", deleted_at: "2026-01-01T00:00:00Z" },
    ],
    users: [
      { id: "u1", email: "a@x.ch", role: "org_admin", org_id: "o1", created_at: "2026-01-01T00:00:00Z", name: "Anna" },
      { id: "u2", email: "b@x.ch", role: "member", org_id: "o2", created_at: "2026-01-01T00:00:00Z" },
      { id: "u3", email: "c@x.ch", role: "member", org_id: "o3", created_at: "2026-01-01T00:00:00Z" },
    ],
    audit_log: [
      { actor_id: "u2", created_at: "2026-11-10T00:00:00Z" },
      { actor_id: null, created_at: "2026-11-09T00:00:00Z" },
    ],
  };
  state.tableError = {};
  state.authUsers = [
    { id: "u1", last_sign_in_at: "2026-11-01T00:00:00Z", banned_until: null },
    { id: "u2", last_sign_in_at: "2026-10-01T00:00:00Z", banned_until: "2999-01-01T00:00:00Z" },
  ];
  state.authError = false;
  state.rpc = async () => ({ data: [{ actor_id: "u1", last_at: "2026-11-15T00:00:00Z" }], error: null });
  state.hang = new Set();
  state.calls = { client: 0, tables: [], rpc: 0, ranges: [] };
});

async function body(res: Response): Promise<{ data: { orgId: string; orgName: string; users: Row[] }[] | null; error: string | null }> {
  return res.json() as Promise<{ data: { orgId: string; orgName: string; users: Row[] }[] | null; error: string | null }>;
}

test("ohne Login: 401, kein Admin-Client", async () => {
  state.user = null;
  const res = await GET();
  assert.equal(res.status, 401);
  assert.equal(state.calls.client, 0);
});

test("Org-Admin und Mitglied: 403, kein Admin-Client, keine RPC", async () => {
  for (const role of ["org_admin", "project_manager", "member"]) {
    state.user = { ...SUPER, role, email: "boss@example.ch" };
    const res = await GET();
    assert.equal(res.status, 403, role);
    const b = await body(res);
    assert.equal(b.data, null);
  }
  assert.equal(state.calls.client, 0);
  assert.equal(state.calls.rpc, 0);
});

test("Super-Admin: gruppiert, gelöschte Org fehlt, Aktivität aus RPC, Sperre erkannt", async () => {
  const res = await GET();
  assert.equal(res.status, 200);
  const b = await body(res);
  assert.deepEqual(b.data?.map(g => g.orgName), ["Alpha", "Beta"]);
  const u1 = b.data?.[0].users[0];
  assert.equal(u1?.lastActivityAt, "2026-11-15T00:00:00Z", "RPC-Zeitpunkt jünger als Login");
  assert.equal(u1?.status, "active");
  const u2 = b.data?.[1].users[0];
  assert.equal(u2?.blocked, true);
  assert.equal(u2?.status, "blocked");
  assert.equal(u2?.lastActivityAt, "2026-10-01T00:00:00Z", "RPC kennt u2 nicht, Rückfall auf Login");
  assert.ok(!state.calls.tables.includes("audit_log"), "mit RPC kein Seitenlesen");
});

test("ohne Migration (RPC fehlt): Rückfall auf Audit-Seiten, Liste trotzdem 200", async () => {
  state.rpc = async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.admin_last_activity in the schema cache" } });
  const res = await GET();
  assert.equal(res.status, 200);
  const b = await body(res);
  assert.equal(b.data?.[1].users[0].lastActivityAt, "2026-11-10T00:00:00Z");
  assert.deepEqual(state.calls.ranges, [[0, 999]]);
});

test("RPC und Audit-Log fehlerhaft: Liste kommt ohne Aktivität", async () => {
  state.rpc = async () => ({ data: null, error: { code: "42501", message: "permission denied" } });
  state.tableError.audit_log = { code: "57014", message: "timeout" };
  const res = await GET();
  assert.equal(res.status, 200);
  const b = await body(res);
  assert.equal(b.data?.[0].users[0].lastActivityAt, "2026-11-01T00:00:00Z");
});

test("RPC wirft: Liste kommt trotzdem", async () => {
  state.rpc = async () => { throw new Error("netz"); };
  const res = await GET();
  assert.equal(res.status, 200);
});

test("Fehler beim Laden der Nutzer oder Auth-Konten: 500 ohne Datenbankmeldung", async () => {
  state.tableError.users = { code: "XX000", message: "geheime interne Meldung" };
  let res = await GET();
  assert.equal(res.status, 500);
  let b = await body(res);
  assert.equal(b.data, null);
  assert.ok(!String(b.error).includes("geheime"));

  state.tableError = {};
  state.authError = true;
  res = await GET();
  assert.equal(res.status, 500);
  b = await body(res);
  assert.equal(b.data, null);
});

test("hängende RPC: Antwort nach Aktivitätsbudget, ohne Aktivität", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  state.rpc = () => never();
  const pending = GET();
  for (let i = 0; i < 20; i++) await new Promise<void>(r => setImmediate(r));
  t.mock.timers.tick(4000);
  const res = await pending;
  assert.equal(res.status, 200);
  const b = await body(res);
  assert.equal(b.data?.[0].users[0].lastActivityAt, "2026-11-01T00:00:00Z");
});

test("hängende Auth-Abfrage: 504 nach Kern-Timeout statt ewigem Warten", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  state.hang.add("auth");
  const pending = GET();
  for (let i = 0; i < 20; i++) await new Promise<void>(r => setImmediate(r));
  t.mock.timers.tick(20_000);
  const res = await pending;
  assert.equal(res.status, 504);
  const b = await body(res);
  assert.equal(b.data, null);
  assert.match(String(b.error), /rechtzeitig/);
});

