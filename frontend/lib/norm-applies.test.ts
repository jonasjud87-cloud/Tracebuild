import { createHash } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";

import { applies, normsForThemeMapping, withoutShadowedAutoNorms, type ApplicableNorm } from "./norm-applies";
import { planAutoParts, MAX_AUTO_PARTS } from "./analysis-plan";
import { normAppliesToZone } from "./zone-match";
import { hashNormEntries, normTextHash } from "./norm-hash";

const municipal = (over: Partial<ApplicableNorm> = {}): ApplicableNorm => ({
  id: "n", layer: 4, jurisdiction_type: "municipal", jurisdiction_name: "Teufen", ...over,
});
const here = { canton: "AR", municipality: "Teufen", bfs: 3024 };

test("applies: Bund, Kanton, Org wie bisher", () => {
  assert.equal(applies({ id: "n", layer: 1, jurisdiction_type: "national", jurisdiction_name: null }, here), true);
  assert.equal(applies({ id: "n", layer: 3, jurisdiction_type: "cantonal", jurisdiction_name: "AR" }, here), true);
  assert.equal(applies({ id: "n", layer: 3, jurisdiction_type: "cantonal", jurisdiction_name: "SG" }, here), false);
  assert.equal(applies({ id: "n", layer: 5, jurisdiction_type: "org", jurisdiction_name: null }, here), true);
});

test("applies: Gemeinde über BFS, wenn beide sie kennen", () => {
  assert.equal(applies(municipal({ jurisdiction_bfs: 3024 }), here), true);
  assert.equal(applies(municipal({ jurisdiction_bfs: 4 }), here), false);
  assert.equal(applies(municipal({ jurisdiction_bfs: 3024, jurisdiction_name: "Teufen (AR)" }), here), true);
});

test("applies: ohne BFS Name exakt, Kanton leer oder gleich", () => {
  assert.equal(applies(municipal(), { ...here, bfs: null }), true);
  assert.equal(applies(municipal({ jurisdiction_bfs: 3024 }), { ...here, bfs: null }), true);
  assert.equal(applies(municipal({ jurisdiction_canton: "AR" }), { ...here, bfs: null }), true);
  assert.equal(applies(municipal({ jurisdiction_canton: "ZH" }), { ...here, bfs: null }), false);
  assert.equal(applies(municipal({ jurisdiction_name: "Trogen" }), { ...here, bfs: null }), false);
  assert.equal(applies(municipal(), here), true, "manuelle Norm ohne BFS");
});

test("applies: parcel nie über die Jurisdiktion, municipal schon", () => {
  const auto = { source_kind: "oereb_auto", jurisdiction_bfs: 3024 };
  assert.equal(applies(municipal({ ...auto, auto_scope: "parcel" }), here), false);
  assert.equal(applies(municipal({ ...auto, auto_scope: "municipal" }), here), true);
  assert.equal(applies(municipal({ ...auto, auto_scope: "superseded" }), here), false);
});

test("Themen-Mapping: Normen fremder Gemeinden und fremder Kantone fallen weg, manuelle wie importierte", () => {
  const norms = [
    municipal({ id: "fremd", source_kind: "oereb_auto", auto_scope: "municipal", jurisdiction_name: "Herisau", jurisdiction_bfs: 3001 }),
    municipal({ id: "eigen", source_kind: "oereb_auto", auto_scope: "municipal", jurisdiction_bfs: 3024 }),
    municipal({ id: "objekt", source_kind: "oereb_auto", auto_scope: "parcel", jurisdiction_bfs: 3024 }),
    municipal({ id: "manuell-fremd", jurisdiction_name: "Herisau" }),
    municipal({ id: "manuell-eigen" }),
    { id: "kanton", layer: 3, jurisdiction_type: "cantonal", jurisdiction_name: "AR" },
    { id: "fremder-kanton", layer: 3, jurisdiction_type: "cantonal", jurisdiction_name: "SG" },
    { id: "org", layer: 5, jurisdiction_type: "org", jurisdiction_name: null },
  ];
  assert.deepEqual(normsForThemeMapping(norms, here).map((n) => n.id), ["eigen", "manuell-eigen", "kanton", "org"]);
});

test("Org-Norm gleichen Titels verdrängt die importierte Norm", () => {
  const auto = municipal({ id: "auto", title: "Baureglement Teufen 2020", source_kind: "oereb_auto" });
  const manual = municipal({ id: "org", title: "Baureglement (Stand 01.01.2018)" });
  const other = municipal({ id: "anders", title: "Reklamereglement" });
  assert.deepEqual(withoutShadowedAutoNorms([auto, manual, other]).map((n) => n.id), ["org", "anders"]);
  assert.deepEqual(withoutShadowedAutoNorms([auto, other]).map((n) => n.id), ["auto", "anders"]);
  const foreign = municipal({ id: "fremd", title: "Baureglement", jurisdiction_name: "Trogen" });
  assert.deepEqual(withoutShadowedAutoNorms([auto, foreign]).map((n) => n.id), ["auto", "fremd"]);
});

test("Text-Hash ist unabhängig von Umbrüchen, nicht vom Inhalt (norm_versions)", () => {
  assert.equal(normTextHash("Art. 1\n  Text\r\n"), normTextHash("Art. 1 Text"));
  assert.notEqual(normTextHash("Art. 1 Text"), normTextHash("Art. 2 Text"));
});

test("Normenblatt-Hash: manuell bleibt, importiert ändert sich mit dem Text", () => {
  // Bisheriger Schlüssel: sha256 der sortierten IDs. Bestehende Caches bleiben gültig.
  const legacy = createHash("sha256").update("a,b").digest("hex");
  assert.equal(hashNormEntries([{ id: "b" }, { id: "a", text_sha256: null }]), legacy);
  const one = hashNormEntries([{ id: "a" }, { id: "auto", text_sha256: "alt" }]);
  const two = hashNormEntries([{ id: "a" }, { id: "auto", text_sha256: "neu" }]);
  assert.notEqual(one, two);
  assert.equal(one, hashNormEntries([{ id: "auto", text_sha256: "alt" }, { id: "a" }]));
});

// ── Zeitplan der Analyse ─────────────────────────────────────────────────────

const part = (title: string, source_kind: string | null = null, auto_scope: string | null = null) => ({
  norm: { title, source_kind, auto_scope },
});

test("Plan: Bund und Kanton laufen vor allen importierten Teilen", () => {
  const units = [part("Auto", "oereb_auto", "municipal"), part("PBG"), part("Parzelle", "oereb_auto", "parcel"), part("RPG")];
  const { units: out, summary } = planAutoParts(units, 225_000, 8);
  assert.deepEqual(out.map((u) => u.norm.title), ["PBG", "RPG", "Auto", "Parzelle"]);
  assert.deepEqual(summary, { total: 2, run: 2, skipped: 0, skipped_titles: [] });
});

test("Plan: Deckel für importierte Teile, Gemeinde-Reglement vor Objektvorschriften", () => {
  const units = [
    ...Array.from({ length: 10 }, () => part("Quartierplan", "oereb_auto", "parcel")),
    ...Array.from({ length: 4 }, () => part("Baureglement", "oereb_auto", "municipal")),
  ];
  const { units: out, summary } = planAutoParts(units, 225_000, 8);
  assert.equal(out.length, MAX_AUTO_PARTS);
  assert.deepEqual(out.slice(0, 4).map((u) => u.norm.title), Array(4).fill("Baureglement"));
  assert.equal(summary.skipped, 14 - MAX_AUTO_PARTS);
  assert.deepEqual(summary.skipped_titles, ["Quartierplan"]);
});

test("Plan: Zeit für Bund und Kanton ist reserviert, ein importierter Teil bleibt", () => {
  const fixed = Array.from({ length: 20 }, (_, i) => part(`Norm ${i}`));
  const autos = Array.from({ length: 6 }, () => part("Auto", "oereb_auto", "municipal"));
  // 225 s / 72 s = 3 Wellen zu 8 = 24 Plätze, 20 belegt.
  assert.equal(planAutoParts([...fixed, ...autos], 225_000, 8).summary.run, 4);
  assert.equal(planAutoParts([...Array(30).fill(fixed[0]), ...autos], 225_000, 8).summary.run, 1);
  assert.equal(planAutoParts(fixed, 225_000, 8).units.length, 20);
});

test("Zonenfilter: bei low nicht anwenden, sonst wie bisher", () => {
  assert.equal(normAppliesToZone("W2", "K", "low"), true);
  assert.equal(normAppliesToZone("W2", "K", "exact"), false);
  assert.equal(normAppliesToZone("W2", "W2", null), true);
  assert.equal(normAppliesToZone(null, "K", "coarse"), true);
});

// ── Länderspalte (Liechtenstein) ─────────────────────────────────────────────

const vaduz = { canton: "FL", municipality: "Vaduz", bfs: 7001 };
const national = (country?: string | null): ApplicableNorm => ({ id: "b", layer: 1, jurisdiction_type: "national", jurisdiction_name: null, country });

test("Länderspalte: CH-Projekt bekommt CH- und NULL-Normen, nicht LI", () => {
  assert.equal(applies(national("CH"), here), true);
  assert.equal(applies(national(null), here), true);
  assert.equal(applies(national("LI"), here), false);
  assert.equal(applies({ id: "o", layer: 5, jurisdiction_type: "org", jurisdiction_name: null, country: "LI" }, here), false);
});

test("Länderspalte: FL-Projekt bekommt LI- und NULL-Normen, nicht CH (alle Ebenen)", () => {
  assert.equal(applies(national("LI"), vaduz), true);
  assert.equal(applies(national(null), vaduz), true);
  assert.equal(applies(national("CH"), vaduz), false);
  assert.equal(applies({ id: "k", layer: 3, jurisdiction_type: "cantonal", jurisdiction_name: "FL", country: "LI" }, vaduz), true);
  assert.equal(applies(municipal({ jurisdiction_name: "Vaduz", jurisdiction_bfs: 7001, country: "CH" }), vaduz), false);
  assert.equal(applies(municipal({ jurisdiction_name: "Vaduz", jurisdiction_bfs: 7001, country: null }), vaduz), true);
  assert.equal(applies({ id: "o", layer: 5, jurisdiction_type: "org", jurisdiction_name: null, country: "CH" }, vaduz), false);
});

test("Länderspalte: fehlt (Migration nicht eingespielt) → wie bisher; Projekt ohne Kanton gilt als CH", () => {
  assert.equal(applies(national(undefined), vaduz), true);
  assert.equal(applies(national(undefined), here), true);
  const noCanton = { canton: "", municipality: "", bfs: null };
  assert.equal(applies(national("CH"), noCanton), true);
  assert.equal(applies(national("LI"), noCanton), false);
});

test("Länderspalte: Themen-Mapping nur mit Normen des Projektlands", () => {
  const norms: ApplicableNorm[] = [
    { id: "ch", layer: 1, jurisdiction_type: "national", jurisdiction_name: null, country: "CH" },
    { id: "li", layer: 1, jurisdiction_type: "national", jurisdiction_name: null, country: "LI" },
    { id: "all", layer: 1, jurisdiction_type: "international", jurisdiction_name: null, country: null },
  ];
  assert.deepEqual(normsForThemeMapping(norms, vaduz).map((n) => n.id), ["li", "all"]);
  assert.deepEqual(normsForThemeMapping(norms, here).map((n) => n.id), ["ch", "all"]);
});
