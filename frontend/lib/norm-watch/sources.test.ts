import assert from "node:assert/strict";
import test from "node:test";
import { buildCurrentQuery, fedlexCurrent, isValidSr, parseCurrent, type FetchLike } from "./fedlex";
import { isValidSgs, sgCurrent, standFromDates } from "./sg";

const FILE = "https://fedlex.data.admin.ch/filestore/fedlex.data.admin.ch/eli/cc/1984/1122_1122_1122/20260801/de/xml/x.xml";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("SR- und sGS-Nummern werden streng geprüft", () => {
  assert.equal(isValidSr("814.01"), true);
  assert.equal(isValidSr("700"), true);
  assert.equal(isValidSr('814.01" . ?x'), false);
  assert.equal(isValidSr(""), false);
  assert.equal(isValidSgs("731.1"), true);
  assert.equal(isValidSgs("../etc"), false);
});

test("buildCurrentQuery: enthält Nummer und Datum, lehnt Einschleusen ab", () => {
  const q = buildCurrentQuery("814.01", "2026-11-13");
  assert.ok(q.includes('historicalLegalId "814.01"'));
  assert.ok(q.includes('"2026-11-13"^^<http://www.w3.org/2001/XMLSchema#date>'));
  assert.throws(() => buildCurrentQuery('1" } DROP', "2026-11-13"));
  assert.throws(() => buildCurrentQuery("814.01", "morgen"));
});

test("parseCurrent: nimmt nur Dateien aus dem Fedlex-Filestore", () => {
  assert.deepEqual(parseCurrent({ results: { bindings: [{ from: { value: "2026-08-01" }, file: { value: FILE } }] } }), { from: "2026-08-01", file: FILE });
  assert.equal(parseCurrent({ results: { bindings: [{ from: { value: "2026-08-01" }, file: { value: "https://evil.example/x.xml" } }] } }), null);
  assert.equal(parseCurrent({ results: { bindings: [] } }), null);
  assert.equal(parseCurrent(null), null);
});

test("fedlexCurrent: liefert Fassung, Stand-Label und Text", async () => {
  const calls: string[] = [];
  const fetchFn: FetchLike = async (url) => {
    calls.push(url);
    if (url.includes("sparqlendpoint")) return json({ results: { bindings: [{ from: { value: "2026-08-01" }, file: { value: FILE } }] } });
    return new Response("<akomaNtoso><body><article><num>Art. 1</num><content><p>Dieses Gesetz schützt Menschen vor schädlichen Einwirkungen.</p></content></article></body></akomaNtoso>");
  };
  const remote = await fedlexCurrent("814.01", new Date("2026-11-13T05:00:00Z"), fetchFn);
  assert.equal(remote.version, "2026-08-01");
  assert.equal(remote.label, "Stand 1. August 2026");
  assert.equal(calls.length, 1);
  const text = await remote.fetchText();
  assert.ok(text.includes("Dieses Gesetz schützt Menschen"));
  assert.equal(calls.length, 2);
});

test("fedlexCurrent: Fehler bei Antwort ohne Fassung und bei HTTP-Fehler", async () => {
  await assert.rejects(
    fedlexCurrent("814.01", new Date(), async () => json({ results: { bindings: [] } })),
    /Keine gültige Fassung/,
  );
  await assert.rejects(fedlexCurrent("814.01", new Date(), async () => json({}, 503)), /503/);
});

test("standFromDates: liest das Datum aus dem Fassungstext der Gesetzessammlung", () => {
  assert.equal(standFromDates("Aktuelle Fassung in Vollzug seit: 01.06.2026 (Erlassdatum: 28.04.2026)"), "Stand 1. Juni 2026");
  assert.equal(standFromDates(undefined), null);
});

const SG_LAW = {
  text_of_law: {
    title: "Planungs- und Baugesetz",
    abrogated: false,
    version_uid: "171b2fda",
    pdf_link: "https://www.gesetzessammlung.sg.ch/api/de/versions/3910/pdf_file_with_annexes",
    current_version: { version_dates_str: "Aktuelle Fassung in Vollzug seit: 01.06.2026 (Erlassdatum: 28.04.2026)" },
  },
};

test("sgCurrent: Version, Label und PDF-Text", async () => {
  const fetchFn: FetchLike = async (url) => (url.includes("/texts_of_law/") ? json(SG_LAW) : new Response(new Uint8Array([1, 2, 3])));
  const remote = await sgCurrent("731.1", fetchFn, async () => "Art. 1  Zweck\n\nDieses Gesetz regelt die Planung.");
  assert.equal(remote.version, "171b2fda");
  assert.equal(remote.label, "Stand 1. Juni 2026");
  assert.equal(remote.title, "Planungs- und Baugesetz");
  assert.equal(await remote.fetchText(), "Art. 1 Zweck\nDieses Gesetz regelt die Planung.");
});

test("sgCurrent: unbekannte, aufgehobene und fremde PDF-Adressen werden abgelehnt", async () => {
  await assert.rejects(sgCurrent("999.9", async () => json({}, 404), async () => ""), /nicht gefunden/);
  await assert.rejects(
    sgCurrent("731.1", async () => json({ text_of_law: { ...SG_LAW.text_of_law, abrogated: true } }), async () => ""),
    /aufgehoben/,
  );
  await assert.rejects(
    sgCurrent("731.1", async () => json({ text_of_law: { ...SG_LAW.text_of_law, pdf_link: "https://evil.example/x.pdf" } }), async () => ""),
    /nicht vertrauenswürdig/,
  );
  await assert.rejects(sgCurrent("../x", async () => json(SG_LAW), async () => ""), /Ungültige/);
});
