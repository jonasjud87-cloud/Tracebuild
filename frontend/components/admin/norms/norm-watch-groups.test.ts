import assert from "node:assert/strict";
import test from "node:test";
import type { SourceView } from "@/lib/norm-watch/types";
import { findUnwatched, groupByJurisdiction, groupCounts, groupLabel, supportedProvider } from "./norm-watch-groups";

function view(over: Partial<SourceView>): SourceView {
  return {
    id: "s",
    label: "Quelle",
    provider: "fedlex",
    identifier: "814.01",
    jurisdictionType: "national",
    jurisdictionName: null,
    enabled: true,
    normId: null,
    normTitle: null,
    status: "current",
    appliedLabel: null,
    remoteLabel: null,
    lastCheckedAt: null,
    lastError: null,
    draftId: null,
    ...over,
  };
}

test("groupLabel: Bund, Kanton mit Namen und unbekannter Code", () => {
  assert.equal(groupLabel("national", null), "Bund");
  assert.equal(groupLabel("cantonal", "SG"), "Kanton St. Gallen (SG)");
  assert.equal(groupLabel("cantonal", "AR"), "Kanton Appenzell Ausserrhoden (AR)");
  assert.equal(groupLabel("cantonal", "XX"), "Kanton XX");
  assert.equal(groupLabel("cantonal", null), "Kanton");
  assert.equal(groupLabel("municipal", "Mels"), "Gemeinde Mels");
  assert.equal(groupLabel("org", null), "Unternehmen");
});

test("groupByJurisdiction: Reihenfolge Bund, Kanton, Gemeinde, Unternehmen", () => {
  const items = [
    { id: "a", jurisdictionType: "org", jurisdictionName: null },
    { id: "b", jurisdictionType: "municipal", jurisdictionName: "Mels" },
    { id: "c", jurisdictionType: "cantonal", jurisdictionName: "SG" },
    { id: "d", jurisdictionType: "national", jurisdictionName: null },
  ];
  assert.deepEqual(groupByJurisdiction(items).map((g) => g.label), ["Bund", "Kanton St. Gallen (SG)", "Gemeinde Mels", "Unternehmen"]);
});

test("groupByJurisdiction: Bund zuerst, dann Kantone alphabetisch, Reihenfolge innerhalb bleibt", () => {
  const items = [
    view({ id: "1", jurisdictionType: "cantonal", jurisdictionName: "SG" }),
    view({ id: "2" }),
    view({ id: "3", jurisdictionType: "cantonal", jurisdictionName: "AR" }),
    view({ id: "4" }),
    view({ id: "5", jurisdictionType: "cantonal", jurisdictionName: "SG" }),
  ];
  const groups = groupByJurisdiction(items);
  assert.deepEqual(groups.map((g) => g.label), ["Bund", "Kanton Appenzell Ausserrhoden (AR)", "Kanton St. Gallen (SG)"]);
  assert.deepEqual(groups[0].items.map((i) => i.id), ["2", "4"]);
  assert.deepEqual(groups[2].items.map((i) => i.id), ["1", "5"]);
});

test("findUnwatched: nur Bund- und Kantonsnormen ohne Quelle, Gemeindenormen nicht", () => {
  const norms = [
    { id: "a", title: "USG", layer: 1 },
    { id: "b", title: "B_Heimatschutz.pdf", layer: 1 },
    { id: "c", title: "Baugesetz AR", layer: 3, jurisdiction_name: "AR" },
    { id: "d", title: "Baureglement Mels", layer: 4, jurisdiction_name: "Mels" },
    { id: "e", title: null, layer: 3, jurisdiction_name: "SG" },
  ];
  const unwatched = findUnwatched(norms, [view({ normId: "a" })]);
  assert.deepEqual(unwatched.map((n) => n.id).sort(), ["b", "c", "e"]);
  const heimat = unwatched.find((n) => n.id === "b");
  assert.equal(heimat?.jurisdictionType, "national");
  const baugesetz = unwatched.find((n) => n.id === "c");
  assert.equal(baugesetz?.jurisdictionName, "AR");
});

test("supportedProvider: nur Bund und St. Gallen haben eine Quelle", () => {
  assert.equal(supportedProvider("national", null), "fedlex");
  assert.equal(supportedProvider("cantonal", "SG"), "sg");
  assert.equal(supportedProvider("cantonal", "AR"), null);
});

test("groupCounts: zählt Entwürfe, Fehler und fehlende Zuordnungen", () => {
  const counts = groupCounts([
    view({ status: "update_available" }),
    view({ status: "error" }),
    view({ status: "missing" }),
    view({ status: "current" }),
  ]);
  assert.deepEqual(counts, { update: 1, error: 1, missing: 1 });
});
