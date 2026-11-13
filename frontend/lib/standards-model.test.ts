import assert from "node:assert/strict";
import test from "node:test";
import { buildEntries, entryTab, matchesQuery, splitByTab, type Standard } from "./standards-model";

function std(over: Partial<Standard>): Standard {
  return {
    id: "s1",
    title: "Titel",
    domain: "bau",
    layer: 1,
    jurisdiction_type: "national",
    jurisdiction_name: null,
    category: "andere",
    source_url: "datei.pdf",
    org_id: null,
    ...over,
  };
}

test("entryTab: plattformweit ist gesetzliche Grundlage, Ebene org ist Unternehmensnorm, sonst eigene Fassung", () => {
  const [legal, company, own] = buildEntries([
    std({ id: "a", org_id: null }),
    std({ id: "b", org_id: "o1", jurisdiction_type: "org", layer: 5, source_url: "b.pdf" }),
    std({ id: "c", org_id: "o1", jurisdiction_type: "municipal", jurisdiction_name: "Mels", layer: 4, source_url: "c.pdf" }),
  ]);
  assert.equal(entryTab(legal), "legal");
  assert.equal(entryTab(company), "company");
  assert.equal(entryTab(own), "own");
});

test("buildEntries: mehrere Teile derselben Datei werden zusammengefasst", () => {
  const entries = buildEntries([
    std({ id: "a", org_id: "o1", jurisdiction_type: "org", source_url: "richtlinie.pdf" }),
    std({ id: "b", org_id: "o1", jurisdiction_type: "org", source_url: "richtlinie.pdf", pdf_url: "https://x/y.pdf" }),
  ]);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].ids, ["a", "b"]);
  assert.equal(entries[0].pdf_url, "https://x/y.pdf");
});

test("buildEntries: Anzeigename für Bund und Unternehmen", () => {
  const [bund, firma] = buildEntries([
    std({ id: "a" }),
    std({ id: "b", org_id: "o1", jurisdiction_type: "org", source_url: "b.pdf" }),
  ]);
  assert.equal(bund.jurisdiction_name, "Bund");
  assert.equal(firma.jurisdiction_name, "Unternehmen");
});

test("splitByTab verteilt die Einträge auf die drei Reiter", () => {
  const split = splitByTab(
    buildEntries([
      std({ id: "a" }),
      std({ id: "b", org_id: "o1", jurisdiction_type: "org", source_url: "b.pdf" }),
      std({ id: "c", org_id: "o1", jurisdiction_type: "cantonal", jurisdiction_name: "SG", source_url: "c.pdf" }),
    ]),
  );
  assert.equal(split.legal.length, 1);
  assert.equal(split.company.length, 1);
  assert.equal(split.own.length, 1);
});

test("matchesQuery: sucht in Titel, Quelle, Kategorie und Ort", () => {
  const [entry] = buildEntries([std({ id: "a", title: "Brandschutzrichtlinie", category: "brandschutz", jurisdiction_name: "SG", jurisdiction_type: "cantonal" })]);
  assert.equal(matchesQuery(entry, ""), true);
  assert.equal(matchesQuery(entry, "brand"), true);
  assert.equal(matchesQuery(entry, "sg"), true);
  assert.equal(matchesQuery(entry, "lärm"), false);
});
