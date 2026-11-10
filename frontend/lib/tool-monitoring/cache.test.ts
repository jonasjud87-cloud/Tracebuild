import { test } from "node:test";
import assert from "node:assert/strict";
import { createTtlCache, ERROR_TTL_MS, FRESH_MIN_INTERVAL_MS } from "./cache";

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

test("TTL: Treffer innerhalb, neu laden danach", async () => {
  const c = clock();
  const cache = createTtlCache(c.now);
  let calls = 0;
  const load = async () => ++calls;
  assert.deepEqual(await cache.get("k", 1000, load), { value: 1, cached: false });
  assert.deepEqual(await cache.get("k", 1000, load), { value: 1, cached: true });
  c.advance(1001);
  assert.deepEqual(await cache.get("k", 1000, load), { value: 2, cached: false });
});

test("Dedupe: gleichzeitige Abrufe teilen einen Loader", async () => {
  const cache = createTtlCache();
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>(r => (release = r));
  const load = async () => {
    calls++;
    await gate;
    return "x";
  };
  const a = cache.get("k", 1000, load);
  const b = cache.get("k", 1000, load);
  release();
  assert.equal((await a).value, "x");
  assert.equal((await b).value, "x");
  assert.equal(calls, 1);
});

test("fresh: umgeht Cache höchstens alle 30 s", async () => {
  const c = clock();
  const cache = createTtlCache(c.now);
  let calls = 0;
  const load = async () => ++calls;
  await cache.get("k", 600_000, load);
  assert.equal((await cache.get("k", 600_000, load, { fresh: true })).value, 2);
  c.advance(1000);
  assert.deepEqual(await cache.get("k", 600_000, load, { fresh: true }), { value: 2, cached: true });
  c.advance(FRESH_MIN_INTERVAL_MS);
  assert.equal((await cache.get("k", 600_000, load, { fresh: true })).value, 3);
});

test("Fehlerresultate höchstens 30 s", async () => {
  const c = clock();
  const cache = createTtlCache(c.now);
  let calls = 0;
  const load = async () => ({ n: ++calls, bad: true });
  const opts = { isError: (v: { bad: boolean }) => v.bad };
  await cache.get("k", 600_000, load, opts);
  c.advance(ERROR_TTL_MS - 1);
  assert.equal((await cache.get("k", 600_000, load, opts)).cached, true);
  c.advance(2);
  assert.equal((await cache.get("k", 600_000, load, opts)).value.n, 2);
});

test("Wirft der Loader, wird nichts gespeichert", async () => {
  const cache = createTtlCache();
  await assert.rejects(cache.get("k", 1000, async () => { throw new Error("x"); }));
  assert.deepEqual(await cache.get("k", 1000, async () => 5), { value: 5, cached: false });
});
