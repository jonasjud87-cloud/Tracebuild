import assert from "node:assert/strict";
import test from "node:test";
import { assertOrigin, readJsonLimited, readLimited } from "./limits";

test("readLimited: lehnt zu grosse Antworten per Content-Length ab", async () => {
  const res = new Response("x", { headers: { "content-length": "999999999" } });
  await assert.rejects(readLimited(res, 1000), /zu gross/);
});

test("readLimited: bricht beim Lesen ab, wenn mehr Daten kommen als erlaubt", async () => {
  const res = new Response("a".repeat(5000));
  await assert.rejects(readLimited(res, 1000), /zu gross/);
});

test("readLimited: liefert kleine Antworten vollständig", async () => {
  const bytes = await readLimited(new Response("hallo welt"), 1000);
  assert.equal(new TextDecoder().decode(bytes), "hallo welt");
});

test("readJsonLimited: meldet ungültiges JSON verständlich", async () => {
  await assert.rejects(readJsonLimited(new Response("<html>Fehler</html>")), /keine gültige JSON/);
  assert.deepEqual(await readJsonLimited(new Response('{"a":1}')), { a: 1 });
});

test("assertOrigin: lehnt fremde Ziel-Adressen nach einer Weiterleitung ab", () => {
  const redirected = { url: "https://evil.example/x" } as unknown as Response;
  assert.throws(() => assertOrigin(redirected, "https://fedlex.data.admin.ch/"), /Weiterleitung/);
  const fine = { url: "https://fedlex.data.admin.ch/filestore/x" } as unknown as Response;
  assert.doesNotThrow(() => assertOrigin(fine, "https://fedlex.data.admin.ch/"));
  assert.doesNotThrow(() => assertOrigin(new Response("x"), "https://fedlex.data.admin.ch/"));
});
