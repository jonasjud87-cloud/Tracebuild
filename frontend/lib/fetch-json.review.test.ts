/** Ergänzende Prüfungen fetchJson: Status 401, leere/fehlerhafte Erfolgsantworten, hängender Body. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchJson } from "./fetch-json";

function respond(status: number, body: string): typeof fetch {
  return (async () => new Response(body, { status, headers: { "Content-Type": "application/json" } })) as typeof fetch;
}

test("401 bleibt als Status erkennbar (Seite leitet auf Login)", async () => {
  const r = await fetchJson("/x", { fetchFn: respond(401, JSON.stringify({ data: null, error: "Nicht eingeloggt" })) });
  assert.deepEqual(r, { ok: false, error: "Nicht eingeloggt", status: 401 });
});

test("200 mit data null ist kein Erfolg", async () => {
  const r = await fetchJson("/x", { fetchFn: respond(200, JSON.stringify({ data: null, error: null })), fallbackError: "F." });
  assert.deepEqual(r, { ok: false, error: "F.", status: 200 });
});

test("200 ohne data-Feld ist kein Erfolg", async () => {
  const r = await fetchJson("/x", { fetchFn: respond(200, JSON.stringify({ foo: 1 })), fallbackError: "F." });
  assert.equal(r.ok, false);
});

test("200 mit Fehlerfeld gilt als Fehler, Meldung der API gewinnt", async () => {
  const r = await fetchJson("/x", { fetchFn: respond(200, JSON.stringify({ data: [1], error: "Teilfehler" })) });
  assert.deepEqual(r, { ok: false, error: "Teilfehler", status: 200 });
});

test("leere Liste ist Erfolg", async () => {
  const r = await fetchJson<number[]>("/x", { fetchFn: respond(200, JSON.stringify({ data: [], error: null })) });
  assert.deepEqual(r, { ok: true, data: [], status: 200 });
});

test("ohne Rückfalltext: Standardmeldung", async () => {
  const r = await fetchJson("/x", { fetchFn: respond(502, "") });
  assert.deepEqual(r, { ok: false, error: "Daten konnten nicht geladen werden.", status: 502 });
});

test("Kopfzeilen kommen, Body hängt: Zeitlimit greift auch beim Lesen", async () => {
  const fetchFn = ((_url: string, init?: RequestInit) => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{\"data\":"));
        init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
      },
    });
    return Promise.resolve(new Response(stream, { status: 200 }));
  }) as typeof fetch;
  const t0 = Date.now();
  const r = await fetchJson("/x", { fetchFn, timeoutMs: 30, fallbackError: "F." });
  assert.equal(r.ok, false);
  assert.ok(Date.now() - t0 < 1000);
});

test("übergibt init und setzt eigenes Abbruchsignal", async () => {
  let seen: RequestInit | undefined;
  const fetchFn = (async (_u: string, init?: RequestInit) => {
    seen = init;
    return new Response(JSON.stringify({ data: 1, error: null }), { status: 200 });
  }) as typeof fetch;
  await fetchJson("/x", { fetchFn, init: { method: "POST" } });
  assert.equal(seen?.method, "POST");
  assert.ok(seen?.signal instanceof AbortSignal);
});
