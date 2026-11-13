import assert from "node:assert/strict";
import test from "node:test";
import { STALE_DAYS, buildOverview, deriveStatus, isStale, nextTitle } from "./status";
import type { NormSourceRow } from "./types";

const NOW = new Date("2026-11-13T05:00:00Z");

function source(over: Partial<NormSourceRow> = {}): NormSourceRow {
  return {
    id: "s1",
    label: "Umweltschutzgesetz (USG), SR 814.01",
    provider: "fedlex",
    identifier: "814.01",
    norm_id: "n1",
    jurisdiction_type: "national",
    jurisdiction_name: null,
    category: "andere",
    enabled: true,
    applied_version: "2026-04-01",
    applied_label: "Stand 1. April 2026",
    remote_version: "2026-04-01",
    remote_label: "Stand 1. April 2026",
    ignored_version: null,
    status: "current",
    last_checked_at: "2026-11-10T05:00:00Z",
    last_error: null,
    created_at: "2026-11-01T00:00:00Z",
    ...over,
  };
}

test("deriveStatus: Reihenfolge der Zustände", () => {
  assert.equal(deriveStatus(source(), false), "current");
  assert.equal(deriveStatus(source({ enabled: false }), true), "disabled");
  assert.equal(deriveStatus(source({ status: "error" }), false), "error");
  assert.equal(deriveStatus(source({ status: "error" }), true), "update_available");
  assert.equal(deriveStatus(source(), true), "update_available");
  assert.equal(deriveStatus(source({ norm_id: null }), false), "missing");
  assert.equal(deriveStatus(source({ status: "unchecked", last_checked_at: null }), false), "unchecked");
});

test("isStale: überfällig nach mehr als zehn Tagen oder ohne jede Prüfung", () => {
  assert.equal(isStale([source()], NOW), false);
  assert.equal(isStale([source({ last_checked_at: "2026-10-20T05:00:00Z" })], NOW), true);
  assert.equal(isStale([source({ last_checked_at: null })], NOW), true);
  assert.equal(isStale([source({ enabled: false, last_checked_at: null })], NOW), false);
  assert.equal(isStale([source(), source({ id: "s2", last_checked_at: "2026-10-01T05:00:00Z" })], NOW), true);
  assert.equal(isStale([], NOW), false);
  assert.equal(STALE_DAYS, 10);
});

test("buildOverview: zählt, sortiert nach Dringlichkeit und nimmt die neueste Prüfung", () => {
  const sources = [
    source({ id: "a", label: "A aktuell" }),
    source({ id: "b", label: "B Entwurf", last_checked_at: "2026-11-12T05:00:00Z" }),
    source({ id: "c", label: "C Fehler", status: "error", last_error: "Fedlex antwortet mit 503" }),
    source({ id: "d", label: "D fehlt", norm_id: null }),
  ];
  const overview = buildOverview(sources, new Map([["b", "draft-1"]]), new Map([["n1", "USG Titel"]]), NOW);
  assert.deepEqual(overview.sources.map((s) => s.id), ["b", "c", "d", "a"]);
  assert.equal(overview.sources[0].draftId, "draft-1");
  assert.equal(overview.sources[0].normTitle, "USG Titel");
  assert.equal(overview.summary.total, 4);
  assert.equal(overview.summary.updateAvailable, 1);
  assert.equal(overview.summary.error, 1);
  assert.equal(overview.summary.missing, 1);
  assert.equal(overview.summary.current, 1);
  assert.equal(overview.summary.lastCheckedAt, "2026-11-12T05:00:00Z");
  assert.equal(overview.summary.stale, false);
});

test("nextTitle: ersetzt das Stand-Label nur bei Titeln nach dem Schema der Bezeichnung", () => {
  const label = "Umweltschutzgesetz (USG), SR 814.01";
  assert.equal(nextTitle(`${label}, Stand 1. April 2026`, label, "Stand 1. August 2026"), `${label}, Stand 1. August 2026`);
  assert.equal(nextTitle("SG_PlanungsundBaugesetz.pdf", "Planungs- und Baugesetz (PBG), sGS 731.1", "Stand 1. Juni 2026"), "SG_PlanungsundBaugesetz.pdf");
  assert.equal(nextTitle(`${label}, Stand 1. April 2026`, label, "Stand unbekannt"), `${label}, Stand 1. April 2026`);
});
