import { test } from "node:test";
import assert from "node:assert/strict";

import { buildReportCsv, buildReportHtml, EMPTY_PARTS_TEXT } from "../analysis-report";
import { harness } from "./test-fakes";

const hollow = { items: [], tokens: { output_tokens: 9 } };
const emptyParts = (h: ReturnType<typeof harness>) => h.store.result?.empty_parts as string[];

test("Leere Antwort ohne Denken: einmal wiederholen, das zweite Ergebnis zählt", async () => {
  const h = harness({ parts: 2, script: (req, nth) => (req.unit.index === 0 && nth === 1 ? hollow : {}) });
  await h.run();
  assert.equal(h.calls.filter((c) => c.unit.index === 0).length, 2);
  assert.deepEqual(emptyParts(h), []);
  assert.equal(h.store.status, "done");
});

test("Bleibt die Antwort leer: nur eine Wiederholung, der Teil steht in empty_parts", async () => {
  const h = harness({ parts: 2, script: (req) => (req.unit.index === 0 ? hollow : {}) });
  await h.run();
  assert.equal(h.calls.filter((c) => c.unit.index === 0).length, 2);
  assert.equal(emptyParts(h).length, 1);
  assert.equal(h.store.status, "done");
});

test("Leer nach echtem Denken ist glaubhaft: keine Wiederholung, aber ausgewiesen", async () => {
  const h = harness({ parts: 2, script: (req) => (req.unit.index === 0 ? { items: [], tokens: { output_tokens: 500 } } : {}) });
  await h.run();
  assert.equal(h.calls.filter((c) => c.unit.index === 0).length, 1);
  assert.equal(emptyParts(h).length, 1);
});

test("Bericht nennt Teile ohne Prüfpunkte in PDF und CSV", () => {
  const meta = { projectName: "P", canton: "SG", municipality: "Mels", parcel: null, bauzone: null, planType: "Baugesuch", version: 1, createdAt: "2026-11-05T00:00:00Z", emptyParts: ["Reglement (Teil 3/3)"] };
  for (const out of [buildReportHtml(meta, []), buildReportCsv(meta, [])]) {
    assert.ok(out.includes(EMPTY_PARTS_TEXT));
    assert.ok(out.includes("Reglement (Teil 3/3)"));
  }
});
