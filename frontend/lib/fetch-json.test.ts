import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchJson } from "./fetch-json";

function respond(status: number, body: string): typeof fetch {
  return (async () => new Response(body, { status, headers: { "Content-Type": "application/json" } })) as typeof fetch;
}

test("Erfolg liefert data und Status", async () => {
  const r = await fetchJson<number[]>("/x", { fetchFn: respond(200, JSON.stringify({ data: [1, 2], error: null })) });
  assert.deepEqual(r, { ok: true, data: [1, 2], status: 200 });
});

test("HTTP-Fehler übernimmt die Fehlermeldung der API", async () => {
  const r = await fetchJson("/x", { fetchFn: respond(500, JSON.stringify({ data: null, error: "Kaputt" })) });
  assert.deepEqual(r, { ok: false, error: "Kaputt", status: 500 });
});

test("kein JSON (z. B. 504-Seite des Hosters) ergibt Rückfalltext", async () => {
  const r = await fetchJson("/x", { fetchFn: respond(504, "<html>Gateway Timeout</html>"), fallbackError: "Nicht geladen." });
  assert.deepEqual(r, { ok: false, error: "Nicht geladen.", status: 504 });
});

test("403 bleibt als Status erkennbar", async () => {
  const r = await fetchJson("/x", { fetchFn: respond(403, JSON.stringify({ data: null, error: "Zugriff verweigert" })) });
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
});

test("Netzwerkfehler wirft nicht", async () => {
  const fetchFn = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;
  const r = await fetchJson("/x", { fetchFn, fallbackError: "Nicht geladen." });
  assert.deepEqual(r, { ok: false, error: "Nicht geladen. Netzwerkfehler.", status: null });
});

test("hängende Antwort wird nach Zeitlimit abgebrochen", async () => {
  const fetchFn = ((_url: string, init?: RequestInit) =>
    new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })) as typeof fetch;
  const t0 = Date.now();
  const r = await fetchJson("/x", { fetchFn, timeoutMs: 30, fallbackError: "Nicht geladen." });
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.error, /Zeitüberschreitung/);
  assert.ok(Date.now() - t0 < 1000);
});
