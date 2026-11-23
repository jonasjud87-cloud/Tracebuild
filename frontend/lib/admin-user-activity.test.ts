import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLastActivity, withTimeout, TimeoutError, type ActivitySource } from "./admin-user-activity";

const OPTS = { timeoutMs: 200, pageSize: 2, maxPages: 3 };

function never<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

test("RPC liefert je Akteur den jüngsten Zeitpunkt", async () => {
  let scans = 0;
  const src: ActivitySource = {
    rpc: async () => ({
      data: [
        { actor_id: "a", last_at: "2026-11-01T00:00:00Z" },
        { actor_id: null, last_at: "2026-11-02T00:00:00Z" },
        { actor_id: "b", last_at: null },
      ],
      error: null,
    }),
    scanPage: async () => { scans++; return { data: [], error: null }; },
  };
  const r = await loadLastActivity(src, OPTS);
  assert.equal(r.source, "rpc");
  assert.deepEqual(Array.from(r.latest), [["a", "2026-11-01T00:00:00Z"]]);
  assert.equal(scans, 0);
});

test("ohne RPC: Rückfall auf Seitenlesen, erster Treffer je Akteur gilt, Seitenlimit greift", async () => {
  const pages = [
    [{ actor_id: "a", created_at: "2026-11-05T00:00:00Z" }, { actor_id: "b", created_at: "2026-11-04T00:00:00Z" }],
    [{ actor_id: "a", created_at: "2026-11-03T00:00:00Z" }, { actor_id: "c", created_at: "2026-11-02T00:00:00Z" }],
    [{ actor_id: "d", created_at: "2026-11-01T00:00:00Z" }, { actor_id: null, created_at: "2026-10-01T00:00:00Z" }],
    [{ actor_id: "e", created_at: "2026-09-01T00:00:00Z" }],
  ];
  const ranges: [number, number][] = [];
  const src: ActivitySource = {
    rpc: async () => ({ data: null, error: { code: "PGRST202" } }),
    scanPage: async (from, to) => {
      ranges.push([from, to]);
      return { data: pages[from / 2] ?? [], error: null };
    },
  };
  const r = await loadLastActivity(src, OPTS);
  assert.equal(r.source, "scan");
  assert.equal(r.latest.get("a"), "2026-11-05T00:00:00Z");
  assert.equal(r.latest.get("d"), "2026-11-01T00:00:00Z");
  assert.equal(r.latest.has("e"), false, "vierte Seite wird nicht mehr gelesen");
  assert.deepEqual(ranges, [[0, 1], [2, 3], [4, 5]]);
});

test("Fehler beim Seitenlesen beendet ohne Ausnahme mit bisherigen Treffern", async () => {
  let call = 0;
  const src: ActivitySource = {
    rpc: async () => ({ data: null, error: { code: "42883" } }),
    scanPage: async () => {
      call++;
      if (call === 1) return { data: [{ actor_id: "a", created_at: "2026-11-05T00:00:00Z" }, { actor_id: "b", created_at: "2026-11-04T00:00:00Z" }], error: null };
      return { data: null, error: { code: "57014" } };
    },
  };
  const r = await loadLastActivity(src, OPTS);
  assert.equal(r.latest.size, 2);
});

test("hängende RPC blockiert nicht: nach Zeitbudget leere Map", async () => {
  const src: ActivitySource = {
    rpc: () => never(),
    scanPage: () => never(),
  };
  const t0 = Date.now();
  const r = await loadLastActivity(src, { ...OPTS, timeoutMs: 50 });
  assert.equal(r.source, "none");
  assert.equal(r.latest.size, 0);
  assert.ok(Date.now() - t0 < 1000);
});

test("Ausnahme in der Quelle ergibt leere Map statt Fehler", async () => {
  const src: ActivitySource = {
    rpc: async () => { throw new Error("netz"); },
    scanPage: async () => ({ data: [], error: null }),
  };
  const r = await loadLastActivity(src, OPTS);
  assert.equal(r.source, "none");
  assert.equal(r.latest.size, 0);
});

test("withTimeout: Ergebnis innerhalb des Budgets, sonst TimeoutError", async () => {
  assert.equal(await withTimeout(Promise.resolve(7), 50), 7);
  await assert.rejects(withTimeout(never(), 20), TimeoutError);
  await assert.rejects(withTimeout(Promise.reject(new Error("x")), 50), /x/);
});
