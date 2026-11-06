import { test } from "node:test";
import assert from "node:assert/strict";

import type { KenndatenAuswertung } from "./kenndaten";
import { KenndatenBesetzt, holeAuswertung, istTreffer, type KenndatenCacheZeile, type KenndatenSpeicher } from "./kenndaten-lauf";
import { ladeGemeindePdfs, uploadPfad, type PdfDeps } from "./kenndaten-quelle";
import { DEFAULT_IMPORT_FILTER } from "./oereb/import-filter";

const auswertung = (over: Partial<KenndatenAuswertung> = {}): KenndatenAuswertung => ({ werte: {}, widerspruechlich: [], unbelegt: [], verworfen: 0, hinweise: [], vorbehalt: false, ...over });

/** Eine Zeile wie in project_kenndaten, mit atomarer Sperre. */
interface FakeSpeicher {
  zeile: KenndatenCacheZeile | null;
  lockedBy: string | null;
  kosten: number[];
  sperrVersuche: number;
  speicher: KenndatenSpeicher;
}

function fakeSpeicher(start: KenndatenCacheZeile | null = null): FakeSpeicher {
  const s: FakeSpeicher = {
    zeile: start,
    lockedBy: null,
    kosten: [],
    sperrVersuche: 0,
    speicher: {
      lesen: async () => s.zeile,
      sperren: async (token: string) => {
        s.sperrVersuche += 1;
        if (s.lockedBy) return false;
        s.lockedBy = token;
        return true;
      },
      abschliessen: async (token: string, e: { hash: string; auswertung: KenndatenAuswertung; model: string } | null) => {
        if (s.lockedBy === token) s.lockedBy = null;
        if (e) s.zeile = { norms_hash: e.hash, items: e.auswertung, model: e.model, created_at: new Date().toISOString() };
      },
      kostenBuchen: async (c: number) => {
        s.kosten.push(c);
      },
    },
  };
  return s;
}

const basis = { hash: "h", warteMs: 1_000, pollMs: 1, schlafen: async () => undefined };

test("Treffer: kein Modellaufruf, keine Sperre, keine Kosten", async () => {
  const s = fakeSpeicher({ norms_hash: "h", items: auswertung({ verworfen: 7 }), model: "m", created_at: new Date().toISOString() });
  const r = await holeAuswertung({ ...basis, speicher: s.speicher, token: "a", rechnen: async () => assert.fail("nicht rechnen") });
  assert.equal(r.cached, true);
  assert.equal(r.auswertung.verworfen, 7);
  assert.equal(s.sperrVersuche, 0);
  assert.deepEqual(s.kosten, []);
});

test("Neuer Hash: rechnet, schreibt, bucht Kosten und gibt die Sperre frei", async () => {
  const s = fakeSpeicher({ norms_hash: "alt", items: auswertung(), model: "m", created_at: null });
  const r = await holeAuswertung({
    ...basis, speicher: s.speicher, token: "a",
    rechnen: async (melde) => {
      melde(0.1, "m");
      return { auswertung: auswertung(), model: "m" };
    },
  });
  assert.equal(r.cached, false);
  assert.equal(s.zeile?.norms_hash, "h");
  assert.deepEqual(s.kosten, [0.1]);
  assert.equal(s.lockedBy, null);
});

test("Fehler nach bezahltem Aufruf: Kosten gebucht, alter Cache unberührt, Sperre frei", async () => {
  const alt = { norms_hash: "alt", items: auswertung(), model: "m", created_at: null };
  const s = fakeSpeicher(alt);
  await assert.rejects(
    holeAuswertung({
      ...basis, speicher: s.speicher, token: "a",
      rechnen: async (melde) => {
        melde(0.12, "m");
        throw new Error("unlesbar");
      },
    }),
    /unlesbar/,
  );
  assert.deepEqual(s.kosten, [0.12]);
  assert.equal(s.zeile, alt);
  assert.equal(s.lockedBy, null);
});

test("Zwei Tabs: Der zweite wartet und nimmt das Ergebnis des ersten, bezahlt wird einmal", async () => {
  const s = fakeSpeicher();
  let aufrufe = 0;
  let fertig: () => void = () => undefined;
  const erster = holeAuswertung({
    ...basis, speicher: s.speicher, token: "a",
    rechnen: async (melde) => {
      aufrufe += 1;
      await new Promise<void>((r) => { fertig = r; });
      melde(0.1, "m");
      return { auswertung: auswertung({ verworfen: 1 }), model: "m" };
    },
  });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(s.lockedBy, "a");

  let polls = 0;
  const zweiter = holeAuswertung({
    ...basis, speicher: s.speicher, token: "b",
    schlafen: async () => {
      polls += 1;
      if (polls === 2) fertig();
      await new Promise((r) => setTimeout(r, 0));
    },
    rechnen: async () => assert.fail("der zweite bezahlt nicht"),
  });

  const [a, b] = await Promise.all([erster, zweiter]);
  assert.equal(a.cached, false);
  assert.equal(b.cached, true);
  assert.equal(b.auswertung.verworfen, 1);
  assert.equal(aufrufe, 1);
  assert.deepEqual(s.kosten, [0.1]);
});

test("Scheitert der erste, rechnet der wartende zweite", async () => {
  const s = fakeSpeicher();
  s.lockedBy = "fremd";
  let polls = 0;
  const r = await holeAuswertung({
    ...basis, speicher: s.speicher, token: "b",
    schlafen: async () => {
      polls += 1;
      if (polls === 2) s.lockedBy = null;
    },
    rechnen: async () => ({ auswertung: auswertung(), model: "m" }),
  });
  assert.equal(r.cached, false);
});

test("Wird das Warten zu lang, kommt eine verständliche Meldung", async () => {
  const s = fakeSpeicher();
  s.lockedBy = "fremd";
  let t = 0;
  await assert.rejects(
    holeAuswertung({
      ...basis, speicher: s.speicher, token: "b", jetzt: () => (t += 600),
      rechnen: async () => assert.fail("nicht rechnen"),
    }),
    KenndatenBesetzt,
  );
});

test("Ist ein anderer zwischen Lesen und Sperren fertig geworden, wird nicht mehr gerechnet", async () => {
  const s = fakeSpeicher();
  let lesen = 0;
  s.speicher.lesen = async () => {
    lesen += 1;
    return lesen === 1 ? null : { norms_hash: "h", items: auswertung(), model: "m", created_at: null };
  };
  const r = await holeAuswertung({ ...basis, speicher: s.speicher, token: "a", rechnen: async () => assert.fail("nicht rechnen") });
  assert.equal(r.cached, true);
  assert.equal(s.lockedBy, null);
});

test("Vorbehalt: Ein vorübergehend fehlendes Original wird nach einem Tag neu versucht", () => {
  const zeile = (created_at: string) => ({ norms_hash: "h", items: auswertung({ vorbehalt: true }), model: "m", created_at });
  const jetzt = Date.parse("2026-11-05T12:00:00Z");
  assert.ok(istTreffer(zeile("2026-11-05T00:00:00Z"), "h", jetzt));
  assert.equal(istTreffer(zeile("2026-11-03T00:00:00Z"), "h", jetzt), false);
});

// ── Original-PDF ─────────────────────────────────────────────────────────────

const deps = (over: Partial<PdfDeps> = {}): PdfDeps => ({
  rules: DEFAULT_IMPORT_FILTER,
  canton: "SG",
  deadlineAt: Date.now() + 20_000,
  ladeUpload: async () => null,
  fetchDoc: async () => ({ kind: "ok", bytes: Buffer.from("%PDF-"), etag: null, lastModified: null }),
  parse: async () => ({ text: "W2 2 0.45", pages: 1, scan: false }),
  ...over,
});
const quelle = (id: string, pdf_url: string | null = "https://oereblex.sg.ch/api/attachments/1") => ({ id, title: `Norm ${id}`, pdf_url, source_url: null });

test("PDF: Text ersetzt den gespeicherten, kein Hinweis", async () => {
  const r = await ladeGemeindePdfs([quelle("a")], deps());
  assert.equal(r.texte.get("a"), "W2 2 0.45");
  assert.deepEqual(r.hinweise, []);
  assert.equal(r.vorbehalt, false);
});

test("PDF: ohne URL, abgewiesen, Scan und unlesbar laufen auf dem gespeicherten Text, das Blatt sagt warum", async () => {
  const fall = async (d: Partial<PdfDeps>, n = quelle("a")) => ladeGemeindePdfs([n], deps(d));

  const ohne = await fall({}, quelle("a", null));
  assert.equal(ohne.texte.size, 0);
  assert.match(ohne.hinweise[0], /Kein Original-PDF hinterlegt/);

  const abgewiesen = await fall({ fetchDoc: async () => ({ kind: "rejected", reason: "host_not_allowed", detail: "x" }) });
  assert.match(abgewiesen.hinweise[0], /nicht abrufbar/);
  assert.equal(abgewiesen.vorbehalt, false);

  const gescheitert = await fall({ fetchDoc: async () => ({ kind: "failed", detail: "HTTP 500" }) });
  assert.match(gescheitert.hinweise[0], /zurzeit nicht abrufbar/);
  assert.equal(gescheitert.vorbehalt, true);

  const scan = await fall({ parse: async () => ({ text: "", pages: 3, scan: true }) });
  assert.equal(scan.texte.size, 0);
  assert.match(scan.hinweise[0], /Scan/);

  const kaputt = await fall({ parse: async () => { throw new Error("kaputt"); } });
  assert.match(kaputt.hinweise[0], /nicht lesbar/);
  assert.match(kaputt.hinweise[0], /bleiben sie leer/);
});

test("PDF: Abruf läuft über die Hostliste, eigene Uploads über den Storage", async () => {
  const urls: string[] = [];
  await ladeGemeindePdfs([quelle("a")], deps({ fetchDoc: async (url, o) => {
    urls.push(url);
    assert.equal(o.canton, "SG");
    assert.ok(o.rules.allowed_hosts.length > 0);
    return { kind: "failed", detail: "x" };
  } }));
  assert.deepEqual(urls, ["https://oereblex.sg.ch/api/attachments/1"]);

  const r = await ladeGemeindePdfs([quelle("a")], deps({
    ladeUpload: async () => Buffer.from("%PDF-"),
    fetchDoc: async () => assert.fail("kein Abruf"),
  }));
  assert.ok(r.texte.has("a"));
});

test("PDF: höchstens drei Originale, abgelaufene Zeit wird gemeldet", async () => {
  let parses = 0;
  const viele = await ladeGemeindePdfs(["a", "b", "c", "d"].map((id) => quelle(id)), deps({ parse: async () => { parses += 1; return { text: "x", pages: 1, scan: false }; } }));
  assert.equal(parses, 3);
  assert.match(viele.hinweise[0], /Norm d/);
  const spaet = await ladeGemeindePdfs([quelle("a")], deps({ deadlineAt: Date.now() }));
  assert.equal(spaet.vorbehalt, true);
});

test("uploadPfad: nur eigener Storage unter norms/", () => {
  const base = "https://x.supabase.co";
  assert.equal(uploadPfad(`${base}/storage/v1/object/public/documents/norms/o/a%20b.pdf`, base), "norms/o/a b.pdf");
  assert.equal(uploadPfad(`${base}/storage/v1/object/public/documents/projects/o/a.pdf`, base), null);
  assert.equal(uploadPfad(`${base}/storage/v1/object/public/documents/norms/../x.pdf`, base), null);
  assert.equal(uploadPfad("https://evil.example/storage/v1/object/public/documents/norms/a.pdf", base), null);
  assert.equal(uploadPfad("https://oereblex.sg.ch/api/attachments/1", base), null);
});
