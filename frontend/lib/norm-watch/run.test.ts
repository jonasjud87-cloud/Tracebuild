import assert from "node:assert/strict";
import test from "node:test";
import type { createAdminClient } from "@/lib/supabase/admin";
import { normTextHash } from "@/lib/norm-hash";
import { approveDraft, rejectDraft } from "./decide";
import { fakeAdmin, type FakeTables } from "./fake-admin";
import type { FetchLike } from "./fedlex";
import { checkSource, runWatch, type WatchDeps } from "./run";
import type { NormSourceRow } from "./types";

type Admin = ReturnType<typeof createAdminClient>;

const FILE = "https://fedlex.data.admin.ch/filestore/fedlex.data.admin.ch/eli/cc/1984/1122_1122_1122/20260801/de/xml/x.xml";
const LABEL = "Umweltschutzgesetz (USG), SR 814.01";
const NOW = new Date("2026-11-13T05:00:00Z");

const OLD_TEXT = ["vom 7. Oktober 1983 (Stand am 1. April 2026)", "Art. 1", "Dieses Gesetz soll Menschen vor schädlichen Einwirkungen schützen."].join("\n");

const xml = (...paragraphs: string[]) =>
  `<akomaNtoso><body><preface><p>vom 7. Oktober 1983 (Stand am 1. August 2026)</p></preface><article><num>Art. 1</num><content>${paragraphs
    .map((p) => `<p>${p}</p>`)
    .join("")}</content></article></body></akomaNtoso>`;

function world(sourceOver: Partial<NormSourceRow> = {}, tables: Partial<FakeTables> = {}) {
  const t: FakeTables = {
    norms: [{ id: "n1", title: `${LABEL}, Stand 1. April 2026`, text: OLD_TEXT, org_id: null }],
    norm_sources: [
      {
        id: "s1",
        label: LABEL,
        provider: "fedlex",
        identifier: "814.01",
        norm_id: "n1",
        jurisdiction_type: "national",
        jurisdiction_name: null,
        category: "andere",
        enabled: true,
        applied_version: "2026-04-01",
        applied_label: "Stand 1. April 2026",
        remote_version: null,
        remote_label: null,
        ignored_version: null,
        status: "current",
        last_checked_at: null,
        last_error: null,
        ...sourceOver,
      },
    ],
    norm_update_drafts: [],
    norm_text_versions: [],
    announcements: [],
    ...tables,
  };
  return t;
}

function deps(tables: FakeTables, body: string, opts: { sparqlStatus?: number } = {}) {
  const calls: string[] = [];
  const fetchFn: FetchLike = async (url) => {
    calls.push(url);
    if (url.includes("sparqlendpoint")) {
      if (opts.sparqlStatus) return new Response("{}", { status: opts.sparqlStatus });
      return new Response(JSON.stringify({ results: { bindings: [{ from: { value: "2026-08-01" }, file: { value: FILE } }] } }));
    }
    return new Response(body);
  };
  const d: WatchDeps = {
    admin: fakeAdmin(tables) as unknown as Admin,
    fetchFn,
    extractPdf: async () => "",
    now: () => NOW,
  };
  return { d, calls };
}

const sourceOf = (t: FakeTables) => t.norm_sources[0] as unknown as NormSourceRow;

test("neue Fassung mit inhaltlicher Änderung legt einen Entwurf an", async () => {
  const t = world();
  const { d } = deps(t, xml("Dieses Gesetz soll Menschen vor schädlichen Einwirkungen schützen.", "Selbst kleine Mengen von Abfällen dürfen nicht ausserhalb der Sammlungen weggeworfen werden."));
  const outcome = await checkSource(d, sourceOf(t));
  assert.equal(outcome.result, "draft_created");
  assert.equal(t.norm_update_drafts.length, 1);
  const draft = t.norm_update_drafts[0];
  assert.equal(draft.remote_version, "2026-08-01");
  assert.equal(draft.status, "draft");
  assert.equal((draft.diff as { added: number }).added, 1);
  assert.equal(t.norm_sources[0].status, "update_available");
  assert.equal(t.norm_sources[0].remote_label, "Stand 1. August 2026");
  assert.equal(t.norms[0].text, OLD_TEXT);
});

test("gleiche Fassung wie angewendet: kein Textabruf", async () => {
  const t = world({ applied_version: "2026-08-01" });
  const { d, calls } = deps(t, "");
  const outcome = await checkSource(d, sourceOf(t));
  assert.equal(outcome.result, "current");
  assert.equal(calls.length, 1);
  assert.equal(t.norm_update_drafts.length, 0);
  assert.equal(t.norm_sources[0].last_checked_at, NOW.toISOString());
});

test("nur die Stand-Zeile ändert sich: wird ohne Entwurf übernommen und der Titel angepasst", async () => {
  const t = world();
  const { d } = deps(t, xml("Dieses Gesetz soll Menschen vor schädlichen Einwirkungen schützen."));
  const outcome = await checkSource(d, sourceOf(t));
  assert.equal(outcome.result, "adopted");
  assert.equal(t.norm_update_drafts.length, 0);
  assert.equal(t.norm_sources[0].applied_version, "2026-08-01");
  assert.equal(t.norms[0].title, `${LABEL}, Stand 1. August 2026`);
  assert.equal(t.norms[0].text, OLD_TEXT);
});

test("abgelehnte Fassung wird nicht erneut vorgeschlagen", async () => {
  const t = world({ ignored_version: "2026-08-01" });
  const { d, calls } = deps(t, "");
  const outcome = await checkSource(d, sourceOf(t));
  assert.equal(outcome.result, "ignored");
  assert.equal(calls.length, 1);
  assert.equal(t.norm_update_drafts.length, 0);
});

test("Quellenfehler setzen den Status auf Fehler und merken die Meldung", async () => {
  const t = world();
  const { d } = deps(t, "", { sparqlStatus: 503 });
  const outcome = await checkSource(d, sourceOf(t));
  assert.equal(outcome.result, "error");
  assert.equal(t.norm_sources[0].status, "error");
  assert.match(String(t.norm_sources[0].last_error), /503/);
  assert.equal(t.norm_sources[0].last_checked_at, NOW.toISOString());
});

test("eine neuere Fassung ersetzt den offenen Entwurf der älteren", async () => {
  const t = world({}, {
    norm_update_drafts: [{ id: "old", source_id: "s1", norm_id: "n1", remote_version: "2026-06-01", remote_label: "Stand 1. Juni 2026", status: "draft" }],
  });
  const { d } = deps(t, xml("Ganz neue Bestimmung über die Behandlung von Abfällen im Bauwesen und Rückbau."));
  const outcome = await checkSource(d, sourceOf(t));
  assert.equal(outcome.result, "draft_created");
  assert.equal(t.norm_update_drafts.filter((r) => r.status === "draft").length, 1);
  assert.equal(t.norm_update_drafts.find((r) => r.id === "old")?.status, "superseded");
});

test("ein offener Entwurf derselben Fassung wird nicht doppelt angelegt", async () => {
  const t = world({}, {
    norm_update_drafts: [{ id: "d1", source_id: "s1", norm_id: "n1", remote_version: "2026-08-01", remote_label: "Stand 1. August 2026", status: "draft" }],
  });
  const { d, calls } = deps(t, "");
  const outcome = await checkSource(d, sourceOf(t));
  assert.equal(outcome.result, "draft_exists");
  assert.equal(calls.length, 1);
  assert.equal(t.norm_update_drafts.length, 1);
});

test("runWatch prüft nur aktive Quellen und fasst zusammen", async () => {
  const t = world();
  t.norm_sources.push({ ...t.norm_sources[0], id: "s2", identifier: "814.41", enabled: false });
  const { d } = deps(t, xml("Neue Regel über den Schutz vor Lärm und Erschütterungen in Wohngebieten."));
  const summary = await runWatch(d);
  assert.equal(summary.checked, 1);
  assert.equal(summary.draftsCreated, 1);
  assert.equal(summary.errors, 0);
});

test("Änderung nur in einer kurzen Tabellenzeile wird nicht still übernommen", async () => {
  const table = (v: string) =>
    `<akomaNtoso><body><preface><p>vom 7. Oktober 1983 (Stand am 1. August 2026)</p></preface><table><tr><td>ES II</td><td>${v}</td></tr></table></body></akomaNtoso>`;
  const t = world({}, {});
  t.norms[0].text = ["vom 7. Oktober 1983 (Stand am 1. April 2026)", "ES II", "60"].join("\n");
  const { d } = deps(t, table("57"));
  const outcome = await checkSource(d, sourceOf(t));
  assert.equal(outcome.result, "draft_created");
  assert.equal(t.norm_sources[0].applied_version, "2026-04-01");
  assert.equal(t.norm_update_drafts.length, 1);
});

test("offener Entwurf wird aufgeräumt, wenn die Fassung inzwischen angewendet ist", async () => {
  const t = world({ applied_version: "2026-08-01" }, {
    norm_update_drafts: [{ id: "d1", source_id: "s1", norm_id: "n1", remote_version: "2026-08-01", remote_label: "Stand 1. August 2026", status: "draft" }],
  });
  const { d } = deps(t, "");
  const outcome = await checkSource(d, sourceOf(t));
  assert.equal(outcome.result, "current");
  assert.equal(t.norm_update_drafts[0].status, "superseded");
});

test("runWatch beginnt mit der am längsten ungeprüften Quelle und beachtet das Zeitbudget", async () => {
  const t = world({ last_checked_at: "2026-11-12T05:00:00Z", label: "A zuletzt geprüft" });
  t.norm_sources.push({ ...t.norm_sources[0], id: "s2", identifier: "814.41", label: "B nie geprüft", last_checked_at: null });
  let tick = 0;
  const { d } = deps(t, xml("Neue Regel über den Schutz vor Lärm und Erschütterungen in Wohngebieten."));
  d.now = () => new Date(NOW.getTime() + tick++ * 1000);
  const summary = await runWatch(d, { budgetMs: 1500 });
  assert.equal(summary.checked, 1);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.outcomes[0].label, "B nie geprüft");
});

test("zu langer Text wird als Fehler gemeldet und nichts angelegt", async () => {
  const t = world();
  const { d } = deps(t, xml("Satz ".repeat(60_000)));
  const outcome = await checkSource(d, sourceOf(t));
  assert.equal(outcome.result, "error");
  assert.equal(t.norm_update_drafts.length, 0);
  assert.match(String(t.norm_sources[0].last_error), /zu lang/);
});

const ACTOR = { id: "u1", email: "admin@example.com" };

function withDraft() {
  return world({ status: "update_available", remote_version: "2026-08-01", remote_label: "Stand 1. August 2026" }, {
    norm_update_drafts: [
      {
        id: "d1",
        source_id: "s1",
        norm_id: "n1",
        remote_version: "2026-08-01",
        remote_label: "Stand 1. August 2026",
        new_text: "Art. 1\nNeuer Text der Fassung vom August.",
        status: "draft",
      },
    ],
  });
}

test("Freigabe ersetzt den Text, archiviert den alten und legt einen inaktiven Ankündigungsentwurf an", async () => {
  const t = withDraft();
  const result = await approveDraft(fakeAdmin(t) as unknown as Admin, ACTOR, "d1");
  assert.equal(result.ok, true);
  assert.equal(t.norms[0].text, "Art. 1\nNeuer Text der Fassung vom August.");
  assert.equal(t.norms[0].title, `${LABEL}, Stand 1. August 2026`);
  assert.equal(t.norm_text_versions.length, 1);
  assert.equal(t.norm_text_versions[0].text, OLD_TEXT);
  assert.equal(t.norm_text_versions[0].version_label, "Stand 1. April 2026");
  assert.equal(t.norm_sources[0].applied_version, "2026-08-01");
  assert.equal(t.norm_sources[0].status, "current");
  assert.equal(t.norm_update_drafts[0].status, "approved");
  assert.equal(t.norm_update_drafts[0].decided_by_email, ACTOR.email);
  assert.equal(t.announcements.length, 1);
  assert.equal(t.announcements[0].active, false);
  assert.equal(t.announcements[0].org_id, null);
  assert.equal(t.norm_update_drafts[0].announcement_id, t.announcements[0].id);
});

test("ein Entwurf lässt sich nur einmal entscheiden", async () => {
  const t = withDraft();
  const admin = fakeAdmin(t) as unknown as Admin;
  assert.equal((await approveDraft(admin, ACTOR, "d1")).ok, true);
  const second = await approveDraft(admin, ACTOR, "d1");
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.status, 409);
  const reject = await rejectDraft(admin, ACTOR, "d1");
  assert.equal(reject.ok, false);
  assert.equal(t.norm_text_versions.length, 1);
});

test("Ablehnen merkt die Fassung und lässt den Text unberührt", async () => {
  const t = withDraft();
  const result = await rejectDraft(fakeAdmin(t) as unknown as Admin, ACTOR, "d1");
  assert.equal(result.ok, true);
  assert.equal(t.norm_update_drafts[0].status, "rejected");
  assert.equal(t.norm_sources[0].ignored_version, "2026-08-01");
  assert.equal(t.norms[0].text, OLD_TEXT);
  assert.equal(t.announcements.length, 0);
});

test("Freigabe setzt auch den Text-Hash, damit Normenblatt-Caches ungültig werden", async () => {
  const t = withDraft();
  t.norms[0].text_sha256 = "alt";
  await approveDraft(fakeAdmin(t) as unknown as Admin, ACTOR, "d1");
  assert.equal(t.norms[0].text_sha256, normTextHash("Art. 1\nNeuer Text der Fassung vom August."));
  assert.notEqual(t.norms[0].text_sha256, "alt");
});

test("Freigabe wird abgewiesen, wenn die Quelle inzwischen einer anderen Norm zugeordnet ist", async () => {
  const t = withDraft();
  t.norms.push({ id: "n2", title: "Andere Norm", text: "Anderer Text", org_id: null });
  t.norm_sources[0].norm_id = "n2";
  const result = await approveDraft(fakeAdmin(t) as unknown as Admin, ACTOR, "d1");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 409);
  assert.equal(t.norm_update_drafts[0].status, "superseded");
  assert.equal(t.norms[1].text, "Anderer Text");
  assert.equal(t.norm_text_versions.length, 0);
});

test("Fehler nach dem Ersetzen gibt den Entwurf nicht zur erneuten Freigabe frei", async () => {
  const t = withDraft();
  const admin = fakeAdmin(t) as unknown as Admin;
  const originalFrom = admin.from.bind(admin);
  let sourceUpdates = 0;
  (admin as unknown as { from: (name: string) => unknown }).from = (name: string) => {
    const query = originalFrom(name as never) as { update: (patch: Record<string, unknown>) => unknown };
    if (name !== "norm_sources") return query;
    const update = query.update.bind(query);
    query.update = (patch: Record<string, unknown>) => {
      if (patch.applied_version) {
        sourceUpdates++;
        const failing = update({ applied_version: undefined }) as { eq: () => unknown };
        failing.eq = () => Promise.resolve({ data: null, error: { message: "Netz weg" } });
        return failing;
      }
      return update(patch);
    };
    return query;
  };
  const result = await approveDraft(admin, ACTOR, "d1");
  assert.equal(result.ok, false);
  assert.equal(sourceUpdates, 2);
  assert.equal(t.norm_update_drafts[0].status, "approved");
  assert.equal(t.norms[0].text, "Art. 1\nNeuer Text der Fassung vom August.");
  assert.equal(t.norm_text_versions.length, 1);
});

test("Freigabe ohne verknüpfte Norm legt eine plattformweite Norm an und verknüpft sie", async () => {
  const t = withDraft();
  t.norm_sources[0].norm_id = null;
  t.norm_update_drafts[0].norm_id = null;
  t.organizations = [];
  const result = await approveDraft(fakeAdmin(t) as unknown as Admin, ACTOR, "d1");
  assert.equal(result.ok, true);
  assert.equal(t.norms.length, 2);
  const created = t.norms[1];
  assert.equal(created.org_id, null);
  assert.equal(created.layer, 1);
  assert.equal(created.jurisdiction_type, "national");
  assert.equal(created.title, `${LABEL}, Stand 1. August 2026`);
  assert.equal(t.norm_sources[0].norm_id, created.id);
});
