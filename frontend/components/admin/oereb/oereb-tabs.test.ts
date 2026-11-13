import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_OEREB_TAB, oerebHashForTab, oerebTabFromHash } from "./oereb-tabs";
import { summarizeCantons } from "./oereb-summary";
import type { CantonOverview } from "./types";

function canton(over: Partial<CantonOverview>): CantonOverview {
  return {
    canton: "SG",
    release: { released: true, source: "canton" },
    own_rules: "none",
    total: 0,
    imported: 0,
    rejected: 0,
    scans: 0,
    failed: 0,
    pending: 0,
    review: 0,
    ...over,
  };
}

test("Anker öffnen den passenden Reiter, sonst gilt die Übersicht", () => {
  assert.equal(oerebTabFromHash("#zuordnung"), "zuordnung");
  assert.equal(oerebTabFromHash("#Filterregeln"), "regeln");
  assert.equal(oerebTabFromHash("#regeln"), "regeln");
  assert.equal(oerebTabFromHash("#dokumente"), "dokumente");
  assert.equal(oerebTabFromHash(""), DEFAULT_OEREB_TAB);
  assert.equal(oerebTabFromHash("#unbekannt"), DEFAULT_OEREB_TAB);
});

test("Hash und Reiter passen zusammen", () => {
  assert.equal(oerebTabFromHash(oerebHashForTab("regeln")), "regeln");
  assert.equal(oerebHashForTab("zuordnung"), "#zuordnung");
});

test("summarizeCantons zählt aktive Kantone, Dokumente und Prüfbedarf", () => {
  const s = summarizeCantons([
    canton({ canton: "SG", total: 30, imported: 3, review: 1, failed: 0, pending: 2 }),
    canton({ canton: "AR", total: 6, release: { released: false, source: "default" } }),
    canton({ canton: "ZH", release: { released: false, source: "default" }, failed: 2 }),
  ]);
  assert.equal(s.cantonsTotal, 3);
  assert.equal(s.cantonsActive, 1);
  assert.equal(s.documents, 36);
  assert.equal(s.imported, 3);
  assert.equal(s.pending, 2);
  assert.equal(s.attention, 3);
  assert.deepEqual(s.attentionCantons, [{ canton: "SG", count: 1 }, { canton: "ZH", count: 2 }]);
});
