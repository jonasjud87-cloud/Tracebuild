import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_LIBRARY_FILTER,
  cantonsOf,
  digestMatches,
  filterLibrary,
  groupTone,
  levelCounts,
  summarizeDigests,
  type DigestState,
  type LibraryNorm,
} from "./library-filter";

const NORMS: LibraryNorm[] = [
  { id: "usg", title: "Umweltschutzgesetz", category: "andere", jurisdiction_type: "national", jurisdiction_name: null },
  { id: "rpg", title: "B_Raumplanung.pdf", category: "andere", jurisdiction_type: "national", jurisdiction_name: null },
  { id: "pbg", title: "Planungs- und Baugesetz", category: "andere", jurisdiction_type: "cantonal", jurisdiction_name: "SG" },
  { id: "pbz", title: "Baugesetz Zürich", category: "andere", jurisdiction_type: "cantonal", jurisdiction_name: "ZH" },
  { id: "mels", title: "Baureglement Mels", category: "baureglement", jurisdiction_type: "municipal", jurisdiction_name: "Mels" },
];

const STATES = new Map<string, DigestState>([
  ["usg", "ok"],
  ["rpg", "failed"],
  ["pbg", "missing"],
]);
const WATCHED = new Set(["usg", "pbg"]);

function ids(filter: Partial<typeof EMPTY_LIBRARY_FILTER>): string[] {
  return filterLibrary(NORMS, { ...EMPTY_LIBRARY_FILTER, ...filter }, WATCHED, STATES).map((n) => n.id);
}

test("ohne Filter bleibt alles sichtbar", () => {
  assert.deepEqual(ids({}), ["usg", "rpg", "pbg", "pbz", "mels"]);
});

test("Ebene und Kanton trennen Bund und Kantone sauber", () => {
  assert.deepEqual(ids({ level: "national" }), ["usg", "rpg"]);
  assert.deepEqual(ids({ level: "cantonal" }), ["pbg", "pbz"]);
  assert.deepEqual(ids({ level: "cantonal", canton: "SG" }), ["pbg"]);
  assert.deepEqual(ids({ level: "national", canton: "SG" }), ["usg", "rpg"]);
});

test("Filter nach Prüfauszug: aktiv, offen oder keiner nötig", () => {
  assert.deepEqual(ids({ digest: "active" }), ["usg"]);
  assert.deepEqual(ids({ digest: "todo" }), ["rpg", "pbg"]);
  assert.deepEqual(ids({ digest: "none" }), ["pbz", "mels"]);
  assert.equal(digestMatches("todo", "outdated"), true);
});

test("Pflege-Filter und Suche lassen sich kombinieren", () => {
  assert.deepEqual(ids({ care: "watched" }), ["usg", "pbg"]);
  assert.deepEqual(ids({ care: "manual" }), ["rpg", "pbz", "mels"]);
  assert.deepEqual(ids({ needle: "baugesetz", level: "cantonal", canton: "ZH" }), ["pbz"]);
  assert.deepEqual(ids({ needle: "MELS" }), ["mels"]);
});

test("Zähler, Kantonsliste und Auszug-Zusammenfassung", () => {
  assert.deepEqual(levelCounts(NORMS), { all: 5, national: 2, cantonal: 2, municipal: 1 });
  assert.deepEqual(cantonsOf(NORMS), ["SG", "ZH"]);
  assert.deepEqual(summarizeDigests(["ok", "failed", "missing"]), { active: 1, todo: 2, total: 3 });
});

test("Farben: Bund schwarz, Kanton beige, sonst grau", () => {
  assert.match(groupTone("Bund").bar, /151414/);
  assert.match(groupTone("Kanton St. Gallen (SG)").bar, /CBBFAE/);
  assert.match(groupTone("Gemeinde Mels").bar, /rgba/);
});
