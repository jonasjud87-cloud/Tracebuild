// Letzte Korrekturrunde: fremde Pfade und Normen, abgelöste Fassungen, Rang im Plan, Abstürze mit Teilen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { aiReadNormLines, buildReportCsv, buildReportHtml } from "../analysis-report";
import { planAutoParts, planStagedParts } from "../analysis-plan";
import { ownedStoragePaths } from "../plan-files";
import { MAX_CRASH_STAGES, MAX_CRASH_STAGES_HARD } from "./budget";
import { normIsCurrent, normVisibleToOrg } from "./plan";
import { REASON_CRASHES } from "./run-stage";
import { harness } from "./test-fakes";

const stagesOf = (h: ReturnType<typeof harness>) => h.store.result?.failed_norms as { error: string }[];

test("Löschen: Nur Storage-Pfade des eigenen Projekts", () => {
  const out = ownedStoragePaths("p1", [
    "p1/plan.pdf",
    "p1/1730_Grundriss 100%.pdf",
    "p2/fremd.pdf",
    "p1/../p2/fremd.pdf",
    "p1/%2e%2e/p2/fremd.pdf",
    "p1\\..\\p2\\fremd.pdf",
    "p10/fremd.pdf",
    "p1/",
    "",
  ]);
  assert.deepEqual(out, ["p1/plan.pdf", "p1/1730_Grundriss 100%.pdf"]);
});

test("Migration: Kritische Tabellen für Clients nur lesbar, Sperrwartezeit begrenzt", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/20261108000001_analysis_stages.sql", import.meta.url), "utf8");
  assert.match(sql, /SET lock_timeout = '3s'/);
  for (const [policy, table] of [
    ["analyses_via_document", "analyses"],
    ["documents_via_project", "documents"],
    ["document_files_via_project", "document_files"],
    ["analysis_items_via_analysis", "analysis_items"],
    ["project_norms_access", "project_norms"],
  ]) {
    assert.match(sql, new RegExp(`CREATE POLICY "${policy}" ON public\\.${table}\\s+FOR SELECT USING`), policy);
    assert.match(sql, new RegExp(`REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public\\.${table} FROM anon, authenticated`), table);
  }
});

test("Normen: Fremde Privatnorm fällt weg, eigene und plattformweite bleiben", () => {
  assert.equal(normVisibleToOrg({ org_id: "fremd" }, "o1"), false);
  assert.equal(normVisibleToOrg({ org_id: "o1" }, "o1"), true);
  assert.equal(normVisibleToOrg({ org_id: null }, "o1"), true);
  assert.equal(normVisibleToOrg({}, "o1"), true);
});

test("Normen: Abgelöste Fassung wird nicht mehr geprüft, auch von Hand zugewiesen", () => {
  assert.equal(normIsCurrent({ auto_scope: "superseded" }), false);
  assert.equal(normIsCurrent({ auto_scope: "municipal" }), true);
  assert.equal(normIsCurrent({ auto_scope: null }), true);
  assert.equal(normIsCurrent({}), true);
});

const auto = (title: string, auto_scope: string | null = "municipal") => ({ norm: { title, source_kind: "oereb_auto", auto_scope } });

test("Plan: Bei knapper Grenze verdrängt keine Änderung den Haupterlass, Parzelle zuletzt", () => {
  const units = [
    auto("Teilrevision Baureglement Mels"),
    auto("Quartierplan Dorf", "parcel"),
    auto("Baureglement Mels"),
  ];
  assert.deepEqual(planStagedParts(units, 1).units.map((u) => u.norm.title), ["Baureglement Mels"]);
  assert.deepEqual(
    planStagedParts(units).units.map((u) => u.norm.title),
    ["Baureglement Mels", "Teilrevision Baureglement Mels", "Quartierplan Dorf"],
  );
  assert.deepEqual(planAutoParts(units, 225_000, 8).units[0].norm.title, "Baureglement Mels");
});

test("Plan: Teile derselben Norm bleiben zusammen und in Reihenfolge", () => {
  const units = [auto("Baureglement Mels"), auto("Baureglement Mels"), auto("Baureglement Mels")]
    .map((u, i) => ({ ...u, part: i + 1 }));
  assert.deepEqual(planStagedParts(units).units.map((u) => u.part), [1, 2, 3]);
});

const dead = (h: ReturnType<typeof harness>, n: number) => {
  h.store.job!.crash_count = n;
  h.store.job!.lease_id = null;
  h.store.job!.lease_until = null;
};

test("Harte Abstürze mit gespeicherten Teilen: Abschluss mit den bezahlten Prüfpunkten, kein Modellaufruf", async () => {
  const h = harness({ parts: 80 });
  assert.equal(await h.stage("start"), "handed_off");
  const saved = h.store.parts.filter((p) => p.status === "done").length;
  assert.ok(saved > 0);
  h.calls.length = 0;
  dead(h, MAX_CRASH_STAGES);
  assert.equal(await h.stage(), "finished");
  assert.equal(h.calls.length, 0);
  assert.equal(h.consolidations, 0);
  assert.equal(h.store.status, "done");
  assert.equal(h.store.items.length, saved);
  assert.ok(stagesOf(h).some((f) => f.error === REASON_CRASHES));
  assert.equal((h.store.result?.consolidation as { applied: boolean }).applied, false);
});

test("Harte Abstürze ohne gespeicherte Teile: Fehler mit Grund", async () => {
  const h = harness({ parts: 2 });
  dead(h, MAX_CRASH_STAGES);
  assert.equal(await h.stage(), "finished");
  assert.equal(h.store.status, "error");
  assert.equal(h.store.result?.error, REASON_CRASHES);
});

test("Stürzt auch der Abschluss immer ab, endet es trotzdem als Fehler", async () => {
  const h = harness({ parts: 1 });
  h.store.existingNormIds = async () => { throw new Error("DB-Fehler"); };
  const results = await h.run();
  assert.equal(results.at(-1), "finished");
  assert.ok(results.length <= MAX_CRASH_STAGES_HARD + 1, results.join());
  assert.equal(h.store.status, "error");
  assert.equal(h.store.result?.error, REASON_CRASHES);
  assert.equal(h.dispatched, 0);
});

test("Fortschritt setzt den Absturz-Zähler zurück", async () => {
  const h = harness({ parts: 80 });
  assert.equal(await h.stage("start"), "handed_off");
  h.store.job!.crash_count = 2;
  const original = h.store.releaseLease.bind(h.store);
  let during = -1;
  h.store.releaseLease = async (...args) => { during = h.store.job?.crash_count ?? -1; return original(...args); };
  // Die Etappe läuft bis zur Übergabe, schon der erste fertige Teil setzt zurück.
  const save = h.store.updateJob.bind(h.store);
  let zeroAfterPart = false;
  h.store.updateJob = async (id, lease, patch) => {
    if (patch.crash_count === 0 && patch.parts_done !== undefined) zeroAfterPart = true;
    return save(id, lease, patch);
  };
  await h.stage();
  assert.equal(zeroAfterPart, true);
  assert.equal(during, 0);
});

test("Bericht: KI-gelesene Normen sind ausgewiesen, sonst keine Zeile", () => {
  const snapshots = {
    norm_versions: [
      { norm_id: "a", title: "Baureglement <Alt>", text_sha256: "x", source_kind: "oereb_auto", source_checked_at: null, text_read_by_ai: true },
      { norm_id: "b", title: "PBG", text_sha256: "y", source_kind: null, source_checked_at: null },
    ],
  };
  assert.equal(aiReadNormLines(snapshots).length, 1);
  assert.deepEqual(aiReadNormLines(null), []);
  const meta = { projectName: "P", canton: "SG", municipality: "M", parcel: null, bauzone: null, planType: "B", version: 1, createdAt: "2026-11-05T10:00:00Z", snapshots };
  assert.match(buildReportHtml(meta, []), /Baureglement &lt;Alt&gt;: Text per KI/);
  assert.match(buildReportCsv(meta, []), /Text per KI aus einem Scan/);
  assert.doesNotMatch(buildReportHtml({ ...meta, snapshots: null }, []), /per KI/);
});
