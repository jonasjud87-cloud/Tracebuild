/** Ergänzende Prüfungen: Randfälle der Aktivität und Migrationstext admin_last_activity. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadLastActivity, type ActivitySource } from "./admin-user-activity";

const OPTS = { timeoutMs: 200, pageSize: 2, maxPages: 3 };
const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

test("RPC ohne Fehler, aber data null: leere Map, kein Seitenlesen", async () => {
  let scans = 0;
  const src: ActivitySource = {
    rpc: async () => ({ data: null, error: null }),
    scanPage: async () => { scans++; return { data: [], error: null }; },
  };
  const r = await loadLastActivity(src, OPTS);
  assert.equal(r.source, "rpc");
  assert.equal(r.latest.size, 0);
  assert.equal(scans, 0);
});

test("Rückfall stoppt bei kurzer Seite", async () => {
  const ranges: number[] = [];
  const src: ActivitySource = {
    rpc: async () => ({ data: null, error: { message: "Could not find the function" } }),
    scanPage: async (from) => {
      ranges.push(from);
      return { data: [{ actor_id: "a", created_at: "2026-11-01T00:00:00Z" }], error: null };
    },
  };
  const r = await loadLastActivity(src, OPTS);
  assert.equal(r.source, "scan");
  assert.deepEqual(ranges, [0]);
});

test("Rückfall hängt: Budget greift auch im Seitenlesen", async () => {
  const src: ActivitySource = {
    rpc: async () => ({ data: null, error: { code: "PGRST202" } }),
    scanPage: () => never(),
  };
  const t0 = Date.now();
  const r = await loadLastActivity(src, { ...OPTS, timeoutMs: 50 });
  assert.equal(r.source, "none");
  assert.ok(Date.now() - t0 < 1000);
});

test("Ausnahme auf zweiter Seite: bisherige Treffer bleiben, Quelle scan mit RPC-Code", async () => {
  let call = 0;
  const src: ActivitySource = {
    rpc: async () => ({ data: null, error: { code: "PGRST202" } }),
    scanPage: async () => {
      call++;
      if (call === 1) return { data: [{ actor_id: "a", created_at: "x" }, { actor_id: "b", created_at: "y" }], error: null };
      throw new Error("netz");
    },
  };
  const r = await loadLastActivity(src, OPTS);
  assert.equal(r.source, "scan");
  assert.equal(r.rpcErrorCode, "PGRST202");
  assert.deepEqual(Array.from(r.latest.keys()), ["a", "b"]);
});

test("Zeitüberschreitung bricht die laufende Abfrage per Signal ab", async () => {
  let seen: AbortSignal | null = null;
  const src: ActivitySource = {
    rpc: signal => { seen = signal; return never(); },
    scanPage: async () => ({ data: [], error: null }),
  };
  const r = await loadLastActivity(src, { ...OPTS, timeoutMs: 20 });
  assert.equal(r.source, "none");
  assert.equal((seen as AbortSignal | null)?.aborted, true);
});

test("Migration: Sortierung und Schema-Neuladen", () => {
  const raw = readFileSync(new URL("../../supabase/migrations/20261119000001_admin_last_activity.sql", import.meta.url), "utf8");
  const sql = raw.replace(/^--.*$/gm, "");
  assert.match(sql, /ORDER BY last_at DESC/);
  assert.match(sql, /NOTIFY pgrst, 'reload schema';/);
  assert.match(raw, /--\s*Rückbau:[\s\S]*--\s*NOTIFY pgrst, 'reload schema';/);
});

test("späte Ablehnung nach Timeout erzeugt keine unbehandelte Ablehnung", async () => {
  const seen: unknown[] = [];
  const onUnhandled = (e: unknown) => seen.push(e);
  process.on("unhandledRejection", onUnhandled);
  try {
    const src: ActivitySource = {
      rpc: () => new Promise((_, reject) => setTimeout(() => reject(new Error("spät")), 60)),
      scanPage: async () => ({ data: [], error: null }),
    };
    const r = await loadLastActivity(src, { ...OPTS, timeoutMs: 10 });
    assert.equal(r.source, "none");
    await new Promise(res => setTimeout(res, 120));
    assert.deepEqual(seen, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("Migration admin_last_activity: nur service_role, INVOKER, fester search_path, additiv", () => {
  const raw = readFileSync(new URL("../../supabase/migrations/20261119000001_admin_last_activity.sql", import.meta.url), "utf8");
  const sql = raw.replace(/^--.*$/gm, "");
  // Rechte: PUBLIC, anon, authenticated entzogen, nur service_role erhält EXECUTE.
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.admin_last_activity\(\) FROM PUBLIC, anon, authenticated;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.admin_last_activity\(\) TO service_role;/);
  assert.ok(!/GRANT[^;]*TO[^;]*\b(anon|authenticated|PUBLIC)\b/i.test(sql), "kein GRANT an Clients");
  assert.ok(sql.indexOf("REVOKE ALL ON FUNCTION") > sql.indexOf("CREATE OR REPLACE FUNCTION public.admin_last_activity"));
  // Ausführung als Aufrufer, nicht als Eigentümer; Suchpfad fest, Tabelle voll qualifiziert.
  assert.match(sql, /SECURITY INVOKER/);
  assert.ok(!/SECURITY DEFINER/i.test(sql));
  assert.match(sql, /SET search_path = pg_catalog, pg_temp/);
  assert.match(sql, /FROM public\.audit_log/);
  // Additiv und mehrfach ausführbar.
  assert.match(sql, /CREATE INDEX IF NOT EXISTS audit_log_actor_created_idx/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.admin_last_activity\(\)/);
  assert.ok(!/\b(DROP|ALTER TABLE|TRUNCATE|DELETE FROM|UPDATE)\b/i.test(sql), "nichts Destruktives ausserhalb der Kommentare");
  assert.ok(!/CREATE EXTENSION/i.test(sql));
  // Rückbau als Kommentar dokumentiert.
  assert.match(raw, /--\s*Rückbau:[\s\S]*DROP FUNCTION IF EXISTS public\.admin_last_activity\(\)/);
  assert.match(raw, /DROP INDEX IF EXISTS public\.audit_log_actor_created_idx/);
});
