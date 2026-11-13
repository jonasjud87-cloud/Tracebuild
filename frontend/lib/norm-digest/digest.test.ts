import assert from "node:assert/strict";
import test from "node:test";
import { buildNormBlock } from "../analysis-engine";
import { stageNorm, toNormPart, buildStageUnits } from "../analysis-stages/plan";
import { normTextHash } from "../norm-hash";
import { generateDigest, type Completion } from "./generate";
import { applyDigests, digestEligible, verifyDigest, verbatimRatio, articleRefs, DIGEST_NOTICE } from "./rules";
import { ensureDigest, loadActiveDigests } from "./store";

const USAGE = { input_tokens: 10, cache_write_tokens: 0, cache_read_tokens: 0, output_tokens: 10 };

function block(n: number): string {
  const words = Array.from({ length: 60 }, (_, i) => `wort${n}x${i}`).join(" ");
  return `Art. ${n}\nBestimmung ${n} betrifft Bauten und Anlagen. ${words}.`;
}

function lawText(articles: number): string {
  return Array.from({ length: articles }, (_, i) => block(i + 1)).join("\n");
}

const SOURCE = lawText(120);

function verbatimDigest(numbers: number[]): string {
  return numbers.map((n) => block(n)).join("\n\n");
}

const GOOD = verbatimDigest([1, 7, 12, 20, 33, 41, 58, 77, 90, 101]);

test("digestEligible: nur plattformweite, aktuelle Schweizer Bundesnormen mit genügend Text", () => {
  const base = { jurisdiction_type: "national", country: "CH", org_id: null, text: SOURCE.repeat(3) };
  assert.equal(digestEligible(base), true);
  assert.equal(digestEligible({ ...base, text: "kurz" }), false);
  assert.equal(digestEligible({ ...base, jurisdiction_type: "cantonal" }), false);
  assert.equal(digestEligible({ ...base, org_id: "o1" }), false);
  assert.equal(digestEligible({ ...base, country: "LI" }), false);
  assert.equal(digestEligible({ ...base, country: null }), false);
  assert.equal(digestEligible({ ...base, auto_scope: "superseded" }), false);
  assert.equal(digestEligible({ ...base, archived_at: "2026-01-01" }), false);
});

test("articleRefs unterscheidet 12, 12a und 12bis", () => {
  const refs = articleRefs("Art. 12 und Art. 12a sowie Art. 12bis, Artikel 7ter, Art. 12bar");
  assert.ok(refs.has("12") && refs.has("12a") && refs.has("12bis") && refs.has("7ter"));
  assert.equal(refs.size, 4);
});

test("verifyDigest: wörtlicher Auszug mit echten Artikeln besteht und nennt Ausgelassenes", () => {
  const check = verifyDigest(SOURCE, GOOD);
  assert.equal(check.ok, true);
  assert.ok(check.verbatim > 0.99);
  assert.ok(check.omitted.length > 100);
});

test("verifyDigest: erfundene Artikel, leerer oder kaum gekürzter Auszug fallen durch", () => {
  const invented = [901, 902, 903, 904].map((n) => block(n)).join("\n");
  assert.equal(verifyDigest(SOURCE, invented).ok, false);
  assert.equal(verifyDigest(SOURCE, "").ok, false);
  assert.equal(verifyDigest(SOURCE, SOURCE).ok, false);
  assert.equal(verifyDigest(SOURCE, "Art. 1 Art. 2").ok, false);
});

test("verifyDigest: umformulierter Text mit echten Artikelnummern besteht nicht", () => {
  const paraphrase = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    .map((n) => `Art. ${n}: ${Array.from({ length: 80 }, (_, i) => `frei${n}y${i}`).join(" ")}`)
    .join("\n\n");
  const check = verifyDigest(SOURCE, paraphrase);
  assert.equal(check.ok, false);
  assert.match(check.reason ?? "", /Wortlaut/);
  assert.ok(verbatimRatio(SOURCE, paraphrase) < 0.2);
});

test("applyDigests ersetzt den Text nur bei passender Fassung", () => {
  const norm: { id: string; text: string; title: string; digest?: boolean | null } = { id: "n1", text: SOURCE, title: "Gesetz" };
  const digests = new Map([["n1", { sha: normTextHash(SOURCE), digest: "Art. 1: Auszug" }]]);
  const [applied] = applyDigests([norm], digests);
  assert.equal(applied.digest, true);
  assert.ok(applied.text.startsWith(DIGEST_NOTICE));

  const stale = new Map([["n1", { sha: "alt", digest: "Art. 1: Auszug" }]]);
  assert.equal(applyDigests([norm], stale)[0].text, SOURCE);
  assert.equal(applyDigests([norm], new Map())[0].text, SOURCE);
});

test("Normblock nennt den Prüfauszug", () => {
  const norm = { id: "n1", title: "Gesetz", category: "andere", text: "Art. 1", layer: 1, jurisdiction_type: "national", digest: true };
  const text = buildNormBlock({ norm, part: 1, parts: 1, text: "Art. 1: Auszug", range: "" } as never, 0, 1);
  assert.match(text, /Prüfauszug/);
});

test("stageNorm behält Verbindlichkeit und Auszug-Marke bis in den Prüfauftrag", () => {
  const norm = { id: "c1", title: "Richtlinie", category: null, text: "t", layer: 5, jurisdiction_type: "org", priority: "advisory", digest: null };
  assert.equal(stageNorm(norm).priority, "advisory");
  const [unit] = buildStageUnits([{ norm, part: 1, parts: 1, text: "t", range: null } as never], (p) => p.norm.title);
  const part = toNormPart(unit, "b");
  assert.equal(part.norm.priority, "advisory");
  assert.match(buildNormBlock(part, 0, 1), /interne Empfehlung/);
});

const ok = (text: string): Completion => ({ text, usage: USAGE });

test("generateDigest fasst Teile und Kosten zusammen und lässt KEINE-Teile aus", async () => {
  let n = 0;
  const result = await generateDigest({ title: "Gesetz", text: lawText(400) }, async () => {
    n += 1;
    return ok(n === 2 ? "KEINE" : `Art. ${n}: x`);
  });
  assert.ok(n > 2);
  assert.ok(!result.digest.includes("KEINE"));
  assert.equal(result.usage.input_tokens, 10 * n);
  assert.ok(result.costUsd > 0);
});

test("generateDigest bricht bei leerem, abgeschnittenem oder fehlgeschlagenem Teil ab und meldet die Kosten", async () => {
  const text = lawText(400);
  await assert.rejects(generateDigest({ title: "G", text }, async () => ok("")), /blieb leer/);
  await assert.rejects(generateDigest({ title: "G", text }, async () => ({ ...ok("Art. 1: x"), truncated: true })), /abgeschnitten/);
  let calls = 0;
  await assert.rejects(
    generateDigest({ title: "G", text }, async () => {
      calls += 1;
      if (calls === 2) throw new Error("API");
      return ok("Art. 1: x");
    }),
    (e: unknown) => e instanceof Error && /fehlgeschlagen/.test(e.message) && (e as { costUsd?: number }).costUsd! > 0,
  );
});

test("generateDigest hält das Zeitbudget ein", async () => {
  await assert.rejects(generateDigest({ title: "G", text: lawText(400) }, async () => ok("Art. 1: x"), { deadlineAt: Date.now() - 1 }), /Zeitbudget/);
});

interface Row { [key: string]: unknown }

function fakeAdmin(initial: Row[] = []) {
  const rows = [...initial];
  const upserts: Row[] = [];
  const builder = () => {
    const filters: [string, unknown][] = [];
    const api = {
      select: () => api,
      eq: (k: string, v: unknown) => (filters.push([k, v]), api),
      in: () => api,
      order: () => api,
      maybeSingle: async () => ({ data: rows.find((r) => filters.every(([k, v]) => r[k] === v)) ?? null, error: null }),
      upsert: async (row: Row) => (upserts.push(row), { error: null }),
      then: (resolve: (v: unknown) => void) => resolve({ data: rows.filter((r) => r.status === "ok"), error: null }),
    };
    return api;
  };
  return { admin: { from: builder } as never, upserts };
}

const NORM = { id: "n1", title: "Gesetz", text: SOURCE, jurisdiction_type: "national", country: "CH", org_id: null, layer: 1 };
const SHA = normTextHash(SOURCE);

test("ensureDigest speichert einen geprüften Auszug und überspringt vorhandene", async () => {
  const { admin, upserts } = fakeAdmin();
  const outcome = await ensureDigest(admin, NORM, { complete: async () => ok(GOOD) });
  assert.equal(outcome.status, "created");
  assert.equal(upserts[0].status, "ok");
  assert.match(String(upserts[0].note), /Ausgelassen/);

  const existing = fakeAdmin([{ norm_id: "n1", text_sha256: SHA, extractor_version: 1, status: "ok", created_at: new Date().toISOString() }]);
  const again = await ensureDigest(existing.admin, NORM, { complete: async () => { throw new Error("darf nicht aufgerufen werden"); } });
  assert.equal(again.status, "exists");
});

test("ensureDigest speichert einen unbrauchbaren Auszug als fehlgeschlagen", async () => {
  const { admin, upserts } = fakeAdmin();
  const outcome = await ensureDigest(admin, NORM, { complete: async () => ok("Art. 1 erfunden") });
  assert.equal(outcome.status, "failed");
  assert.equal(upserts[0].status, "failed");
  assert.equal(upserts[0].digest, null);
});

test("ein fehlgeschlagener Versuch überschreibt nie einen aktiven Auszug", async () => {
  const { admin, upserts } = fakeAdmin([{ norm_id: "n1", text_sha256: SHA, extractor_version: 1, status: "ok", created_at: new Date().toISOString() }]);
  const outcome = await ensureDigest(admin, NORM, { force: true, complete: async () => ok("Art. 1 erfunden") });
  assert.equal(outcome.status, "failed");
  assert.equal(upserts.length, 0);
});

test("fehlgeschlagene Auszüge werden erst nach sechs Tagen automatisch wiederholt", async () => {
  const day = 86_400_000;
  const now = Date.parse("2026-11-20T00:00:00Z");
  const young = fakeAdmin([{ norm_id: "n1", text_sha256: SHA, extractor_version: 1, status: "failed", created_at: new Date(now - 2 * day).toISOString() }]);
  assert.equal((await ensureDigest(young.admin, NORM, { now: () => now, complete: async () => ok(GOOD) })).status, "exists");
  const old = fakeAdmin([{ norm_id: "n1", text_sha256: SHA, extractor_version: 1, status: "failed", created_at: new Date(now - 8 * day).toISOString() }]);
  assert.equal((await ensureDigest(old.admin, NORM, { now: () => now, complete: async () => ok(GOOD) })).status, "created");
});

test("loadActiveDigests ohne IDs oder bei Notschalter liefert nichts", async () => {
  const { admin } = fakeAdmin([{ norm_id: "n1", text_sha256: SHA, extractor_version: 1, status: "ok", digest: "x" }]);
  assert.equal((await loadActiveDigests(admin, [])).size, 0);
  process.env.NORM_DIGEST_DISABLED = "1";
  try {
    assert.equal((await loadActiveDigests(admin, ["n1"])).size, 0);
  } finally {
    delete process.env.NORM_DIGEST_DISABLED;
  }
});
