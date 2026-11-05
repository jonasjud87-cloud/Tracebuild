/**
 * Setzt den Fassungsvergleich eines Auszugs in der Datenbank um, atomar über die RPC
 * `oereb_apply_version_actions`: Sie bricht ab, wenn ein beteiligtes Dokument gerade importiert wird
 * oder sich sein Stand geändert hat, und der nächste Abgleich entscheidet neu. Läuft auch aus GET-Routen.
 * Eine zurückgenommene Norm bleibt für den Nachvollzug bestehen und gilt nicht mehr, von Hand
 * zugewiesene Zeilen bleiben. Eine inzwischen manuell gepflegte Norm wird nie angefasst.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSchema } from "../supabase/schema-errors";
import { groupByIdentity, measureDocument, planVersionGroups, type VersionAction, type VersionDocument } from "./document-versions";
import { OLDER_VERSION_REASON, REVIEW_STATUS, assessContent, contentStatus, stableJson, type ImportFilterRules } from "./import-filter";
import type { TextSketch } from "./text-measure";
import { linkSimilarUploads, repointAuthoritativeUploads } from "./upload-supersede";

interface SyncDocument extends VersionDocument {
  filter_snapshot?: unknown;
  scope?: string | null;
  lock_until?: string | null;
}

export interface VersionSyncContext {
  admin: SupabaseClient;
  own: SyncDocument[];
  all: SyncDocument[];
  rules: ImportFilterRules;
  canton: string;
  municipality: string;
  bfs: number | null;
  nowMs: number;
}

interface RpcAction {
  doc_id: string;
  expect_status: string;
  expect_reason: string | null;
  winner_id?: string;
  expect_winner_status?: string;
  norm?: "withdraw" | "reinstate";
  patch: Record<string, unknown>;
}

interface RpcResult {
  applied: boolean;
  doc_ids?: string[];
  changed_norm_ids?: string[];
}

async function applyActions(ctx: VersionSyncContext, actions: RpcAction[]): Promise<RpcResult> {
  if (!actions.length || ctx.bfs === null) return { applied: false };
  const { data, error } = await ctx.admin.rpc("oereb_apply_version_actions", {
    p_canton: ctx.canton,
    p_bfs: ctx.bfs,
    p_actions: actions,
  });
  if (error) {
    if (!isMissingSchema(error.message)) console.error("Fassungsvergleich nicht angewendet:", error.message);
    return { applied: false };
  }
  const result = data as RpcResult;
  if (!result?.applied) return { applied: false };
  const byId = new Map(ctx.all.map((d) => [d.id, d]));
  const done = new Set(result.doc_ids ?? []);
  for (const action of actions) {
    if (done.has(action.doc_id)) Object.assign(byId.get(action.doc_id) ?? {}, action.patch);
  }
  return result;
}

const expected = (d: SyncDocument) => ({ doc_id: d.id, expect_status: d.status, expect_reason: d.reject_reason });

const isLocked = (d: SyncDocument, nowMs: number) => !!d.lock_until && Date.parse(d.lock_until) > nowMs;

/**
 * Reparatur nach Absturz oder einem Lauf, der über seine Sperre hinaus schrieb: Dokumentstatus und
 * Geltung der Norm müssen zusammenpassen. Sonst fehlt der Gemeinde ein Reglement ohne jede Warnung, oder
 * eine abgelehnte Fassung gilt weiter. Gemeindeweit, nicht nur für diesen Auszug.
 */
async function repairInconsistentNorms(ctx: VersionSyncContext, changed: Set<string>): Promise<void> {
  const docs = ctx.all.filter((d) => !!d.norm_id && !isLocked(d, ctx.nowMs));
  if (!docs.length) return;
  const { data, error } = await ctx.admin
    .from("norms")
    .select("id, auto_scope, source_kind")
    .in("id", docs.map((d) => d.norm_id as string));
  if (error) {
    if (!isMissingSchema(error.message)) console.error("Geltung der Normen nicht prüfbar:", error.message);
    return;
  }
  const norms = new Map(((data ?? []) as { id: string; auto_scope: string | null; source_kind: string | null }[]).map((n) => [n.id, n]));
  for (const doc of docs) {
    const norm = norms.get(doc.norm_id as string);
    if (!norm || norm.source_kind !== "oereb_auto") continue;
    const superseded = norm.auto_scope === "superseded";
    const withdrawn = doc.status !== "imported" && (doc.reject_reason === OLDER_VERSION_REASON || (!!doc.content_reason && doc.reject_reason === doc.content_reason));
    if (doc.status === "imported" && superseded) {
      console.warn(`ÖREB-Dokument ${doc.id} ist importiert, seine Norm galt nicht mehr: repariert`);
      const result = await applyActions(ctx, [{ ...expected(doc), norm: "reinstate", patch: {} }]);
      (result.changed_norm_ids ?? []).forEach((id) => changed.add(id));
    } else if (withdrawn && !superseded) {
      console.warn(`ÖREB-Dokument ${doc.id} ist abgelehnt, seine Norm galt noch: repariert`);
      await applyActions(ctx, [{ ...expected(doc), norm: "withdraw", patch: {} }]);
    }
  }
}

/**
 * Importierte Dokumente ohne Messwerte oder unter alten Regeln anhand des Normtexts prüfen, ohne neuen
 * Download. So fällt auch ein Brief, der den früheren Inhaltstest bestanden hat. Zurückgenommene
 * Dokumente werden gleich behandelt, damit eine Regelkorrektur sie wieder freigibt.
 */
async function reassessFromNorms(ctx: VersionSyncContext, changed: Set<string>): Promise<void> {
  const rulesJson = stableJson(ctx.rules);
  for (const doc of ctx.own) {
    if (doc.manual_decision) continue;
    const withdrawnForContent =
      (doc.status === "rejected" || doc.status === REVIEW_STATUS) && !!doc.norm_id && !!doc.reject_reason && doc.reject_reason === doc.content_reason;
    if (!doc.norm_id || (doc.status !== "imported" && !withdrawnForContent)) continue;
    if (isLocked(doc, ctx.nowMs)) continue;
    if (typeof doc.article_run === "number" && stableJson(doc.filter_snapshot) === rulesJson) continue;

    const { data, error } = await ctx.admin.from("norms").select("id, text, source_kind").eq("id", doc.norm_id).maybeSingle();
    if (error) {
      console.error(`Norm ${doc.norm_id} nicht lesbar:`, error.message);
      continue;
    }
    const norm = data as { text: string | null; source_kind: string | null } | null;
    if (!norm || norm.source_kind !== "oereb_auto") continue;

    const measures = measureDocument(doc.title, norm.text ?? "", ctx.rules);
    const { rejection } = assessContent(norm.text ?? "", ctx.rules, doc.title);
    const common = { ...measures, filter_snapshot: ctx.rules };
    if (rejection && doc.status === "imported") {
      const status = contentStatus(rejection.reason, doc.title, ctx.rules, doc.official_number, doc.scope);
      await applyActions(ctx, [{ ...expected(doc), norm: "withdraw", patch: { ...common, status, reject_reason: rejection.reason, reject_detail: rejection.detail } }]);
    } else if (!rejection && withdrawnForContent) {
      const result = await applyActions(ctx, [{ ...expected(doc), norm: "reinstate", patch: { ...common, status: "imported", reject_reason: null, reject_detail: null } }]);
      (result.changed_norm_ids ?? []).forEach((id) => changed.add(id));
    } else {
      await applyActions(ctx, [{ ...expected(doc), patch: common }]);
    }
  }
}

function toRpcAction(step: VersionAction, ctx: VersionSyncContext, byId: Map<string, SyncDocument>): RpcAction | null {
  const doc = byId.get(step.docId);
  if (!doc) return null;
  const nowIso = new Date(ctx.nowMs).toISOString();
  const base = expected(doc);
  if (step.action === "note") return { ...base, patch: { version_note: step.note } };
  if (step.action === "retire" || step.action === "relabel") {
    const winner = byId.get(step.winnerId);
    if (!winner) return null;
    return {
      ...base,
      winner_id: winner.id,
      // Vorprüfung vor allen Änderungen: Auch ein Gewinner, den diese Gruppe erst freigibt, zählt mit seinem jetzigen Stand.
      expect_winner_status: winner.status,
      norm: step.action === "retire" ? "withdraw" : undefined,
      patch: {
        status: "rejected",
        reject_reason: OLDER_VERSION_REASON,
        reject_detail: step.detail,
        version_winner_id: step.winnerId,
        last_checked_at: nowIso,
        next_check_at: new Date(ctx.nowMs + ctx.rules.older_version_recheck_hours * 3_600_000).toISOString(),
      },
    };
  }
  if (doc.content_reason) {
    // Der Gewinner ist weg, das Dokument bleibt wegen seines eigenen Inhalts abgelehnt oder in Prüfung.
    return {
      ...base,
      patch: {
        status: contentStatus(doc.content_reason, doc.title, ctx.rules, doc.official_number, doc.scope),
        reject_reason: doc.content_reason,
        reject_detail: "Nach Wegfall der neueren Fassung erneut beurteilt",
        version_winner_id: null,
        filter_snapshot: ctx.rules,
      },
    };
  }
  // Die Norm kann einen alten Text tragen: Der nächste Lauf lädt neu und aktualisiert.
  const reload = { reject_reason: null, reject_detail: null, version_winner_id: null, pdf_sha256: null, etag: null, last_modified: null, next_check_at: nowIso };
  return doc.norm_id
    ? { ...base, norm: "reinstate", patch: { ...reload, status: "imported" } }
    : { ...base, patch: { ...reload, status: "pending" } };
}

/** Skizzen nur laden, wo ein Vergleich ansteht: Die Dokumentliste trägt sie sonst nicht. */
/** false: nicht lesbar. Ohne Skizzen sähe der Vergleich keine Gewinner und gäbe ältere Fassungen frei. */
async function loadSketches(ctx: VersionSyncContext): Promise<boolean> {
  const measured = ctx.own.filter((d) => typeof d.article_run === "number" && !d.text_sketch);
  const ids = groupByIdentity(measured.concat(ctx.own.filter((d) => !!d.text_sketch)))
    .filter((group) => group.length > 1)
    .flat()
    .filter((d) => !d.text_sketch)
    .map((d) => d.id);
  if (!ids.length) return true;
  const { data, error } = await ctx.admin.from("oereb_documents").select("id, text_sketch").in("id", ids);
  if (error) {
    if (!isMissingSchema(error.message)) console.error("Textskizzen nicht lesbar, Fassungsvergleich ausgesetzt:", error.message);
    return false;
  }
  const byId = new Map(ctx.own.map((d) => [d.id, d]));
  for (const row of (data ?? []) as { id: string; text_sketch: TextSketch | null }[]) {
    const doc = byId.get(row.id);
    if (doc) doc.text_sketch = row.text_sketch;
  }
  return true;
}

/** Gibt die Normen zurück, deren Zuweisung neu berechnet werden muss. Fehler einzelner Schritte blockieren nichts. */
export async function reconcileVersions(ctx: VersionSyncContext): Promise<string[]> {
  const changed = new Set<string>();
  await repairInconsistentNorms(ctx, changed);
  await reassessFromNorms(ctx, changed);
  if (!(await loadSketches(ctx))) return Array.from(changed);

  const byId = new Map(ctx.all.map((d) => [d.id, d]));
  const nowIso = new Date(ctx.nowMs).toISOString();
  const retired: { loserNormId: string; winnerId: string }[] = [];

  for (const group of planVersionGroups(ctx.own, ctx.all, ctx.rules, ctx.nowMs)) {
    const actions = group.map((step) => toRpcAction(step, ctx, byId)).filter((a): a is RpcAction => !!a);
    const losers = group.flatMap((step) => {
      const loser = step.action === "retire" ? byId.get(step.docId)?.norm_id : null;
      return loser && step.action === "retire" ? [{ docId: step.docId, loserNormId: loser, winnerId: step.winnerId }] : [];
    });
    const result = await applyActions(ctx, actions);
    if (!result.applied) continue;
    (result.changed_norm_ids ?? []).forEach((id) => changed.add(id));
    const done = new Set(result.doc_ids ?? []);
    for (const loser of losers) if (done.has(loser.docId)) retired.push(loser);
  }

  // Uploads, die auf einen zurückgenommenen Verlierer zeigten, gehören nun zum Gewinner.
  for (const { loserNormId, winnerId } of retired) {
    const winner = byId.get(winnerId);
    if (!winner?.norm_id || winner.scope !== "municipal") continue;
    await repointAuthoritativeUploads(ctx.admin, loserNormId, winner.norm_id);
    const { data } = await ctx.admin.from("norms").select("text").eq("id", winner.norm_id).maybeSingle();
    const text = (data as { text: string | null } | null)?.text;
    if (!text) continue;
    const links = await linkSimilarUploads(
      ctx.admin,
      { id: winner.norm_id, text, municipality: ctx.municipality, canton: ctx.canton, bfs: ctx.bfs },
      ctx.rules,
      nowIso
    );
    if (links > 0) changed.add(winner.norm_id);
  }
  return Array.from(changed);
}
