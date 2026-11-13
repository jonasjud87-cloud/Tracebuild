import assert from "node:assert/strict";
import test from "node:test";
import { coverageGaps } from "./norm-coverage";

const bund = { jurisdiction_type: "national" };
const kanton = { jurisdiction_type: "cantonal", jurisdiction_name: "SG" };
const gemeinde = { jurisdiction_type: "municipal", jurisdiction_name: "Quarten" };

test("vollständig: keine Hinweise", () => {
  assert.deepEqual(coverageGaps({ canton: "SG", municipality: "Quarten" }, [bund, kanton, gemeinde]), []);
});

test("ohne kantonale Norm meldet die Warnung den Kanton", () => {
  const gaps = coverageGaps({ canton: "ZH", municipality: "Uster" }, [bund, gemeinde]);
  assert.deepEqual(gaps.map((g) => g.key), ["canton-missing"]);
  assert.match(gaps[0].text, /Kanton ZH/);
});

test("ohne Gemeindenorm gibt es einen eigenen Hinweis", () => {
  const gaps = coverageGaps({ canton: "SG", municipality: "Mels" }, [bund, kanton]);
  assert.deepEqual(gaps.map((g) => g.key), ["municipality-missing"]);
  assert.match(gaps[0].text, /Mels/);
});

test("ohne Kanton im Projekt wird das gesagt und die Gemeinde nicht zusätzlich bemängelt", () => {
  const gaps = coverageGaps({ canton: "", municipality: "Mels" }, [bund]);
  assert.deepEqual(gaps.map((g) => g.key), ["no-canton"]);
});

test("Liechtenstein heisst nicht Kanton FL und sagt nichts von Bundesrecht", () => {
  const gaps = coverageGaps({ canton: "fl", municipality: "Vaduz" }, []);
  assert.match(gaps[0].text, /Liechtenstein/);
  assert.doesNotMatch(gaps[0].text, /Bundesrecht/);
  assert.match(gaps[1].text, /Bauordnung/);
});

test("Stadtkantone brauchen kein Gemeindereglement", () => {
  assert.deepEqual(coverageGaps({ canton: "BS", municipality: "Basel" }, [bund, { jurisdiction_type: "cantonal" }]), []);
});

test("abgelöste, archivierte und Entwurfs-Normen zählen nicht als Abdeckung", () => {
  const inactive = [
    { jurisdiction_type: "cantonal", auto_scope: "superseded" },
    { jurisdiction_type: "cantonal", archived_at: "2026-01-01" },
    { jurisdiction_type: "cantonal", approval_status: "draft" },
  ];
  assert.deepEqual(coverageGaps({ canton: "SG", municipality: "" }, inactive).map((g) => g.key), ["canton-missing"]);
});

test("Kantonskürzel in Kleinschreibung wird erkannt", () => {
  assert.match(coverageGaps({ canton: "zh", municipality: "" }, [])[0].text, /Kanton ZH/);
});
