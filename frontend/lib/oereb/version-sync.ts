/**
 * Setzt den Fassungsvergleich eines Auszugs in der Datenbank um. Eine zurückgenommene Norm bleibt
 * für den Nachvollzug bestehen und gilt nicht mehr, von Hand zugewiesene Zeilen bleiben wie bei
 * `retireSuperseded`. Eine inzwischen manuell gepflegte Norm wird nie angefasst.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPERSEDED_SCOPE } from "../norm-applies";
import { measureDocument, planVersionActions, type VersionDocument } from "./document-versions";
import { OLDER_VERSION_REASON, assessContent, stableJson, type ImportFilterRules } from "./import-filter";
import { linkSimilarUploads } from "./upload-supersede";

interface SyncDocument extends VersionDocument {
  filter_snapshot?: unknown;
  scope?: string | null;
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

async function patchDoc(ctx: VersionSyncContext, doc: SyncDocument, patch: Record<string, unknown>): Promise<boolean> {
  const { error } = await ctx.admin.from("oereb_documents").update(patch).eq("id", doc.id);
  if (error) {
    console.error(`ÖREB-Dokument ${doc.id} nicht aktualisiert:`, error.message);
    return false;
  }
  Object.assign(doc, patch);
  return true;
}

/** Nimmt die Norm aus der Geltung. false: Sie gehört nicht mehr dem Import oder der Schritt schlug fehl. */
export async function withdrawNorm(ctx: Pick<VersionSyncContext, "admin">, normId: string): Promise<boolean> {
  const { data, error } = await ctx.admin
    .from("norms")
    .update({ auto_scope: SUPERSEDED_SCOPE })
    .eq("id", normId)
    .eq("source_kind", "oereb_auto")
    .select("id");
  if (error) {
    console.error(`Norm ${normId} nicht zurückgenommen:`, error.message);
    return false;
  }
  if (!data?.length) return false;
  const { error: linkError } = await ctx.admin
    .from("project_norms")
    .delete()
    .eq("norm_id", normId)
    .in("added_by", ["system", "oereb"]);
  if (linkError) console.error(`Zuweisungen der Norm ${normId} nicht entfernt:`, linkError.message);
  return true;
}

export async function reinstateNorm(ctx: Pick<VersionSyncContext, "admin">, doc: { norm_id: string | null; scope?: string | null }): Promise<boolean> {
  const { error } = await ctx.admin
    .from("norms")
    .update({ auto_scope: doc.scope ?? "parcel" })
    .eq("id", doc.norm_id as string)
    .eq("source_kind", "oereb_auto")
    .eq("auto_scope", SUPERSEDED_SCOPE);
  if (error) {
    console.error(`Norm ${doc.norm_id} nicht reaktiviert:`, error.message);
    return false;
  }
  return true;
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
    const withdrawnForContent = doc.status === "rejected" && !!doc.norm_id && !!doc.reject_reason && doc.reject_reason === doc.content_reason;
    if (!doc.norm_id || (doc.status !== "imported" && !withdrawnForContent)) continue;
    if (typeof doc.article_run === "number" && stableJson(doc.filter_snapshot) === rulesJson) continue;

    const { data, error } = await ctx.admin
      .from("norms")
      .select("id, text, source_kind")
      .eq("id", doc.norm_id)
      .maybeSingle();
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
      if (!(await withdrawNorm(ctx, doc.norm_id))) continue;
      await patchDoc(ctx, doc, { ...common, status: "rejected", reject_reason: rejection.reason, reject_detail: rejection.detail });
    } else if (!rejection && withdrawnForContent) {
      if (!(await reinstateNorm(ctx, doc))) continue;
      await patchDoc(ctx, doc, { ...common, status: "imported", reject_reason: null, reject_detail: null });
      changed.add(doc.norm_id);
    } else {
      await patchDoc(ctx, doc, common);
    }
  }
}

/** Gibt die Normen zurück, deren Zuweisung neu berechnet werden muss. Fehler einzelner Schritte blockieren nichts. */
export async function reconcileVersions(ctx: VersionSyncContext): Promise<string[]> {
  const changed = new Set<string>();
  await reassessFromNorms(ctx, changed);

  const byId = new Map(ctx.all.map((d) => [d.id, d]));
  const recheckAt = new Date(ctx.nowMs + ctx.rules.older_version_recheck_hours * 3_600_000).toISOString();
  const nowIso = new Date(ctx.nowMs).toISOString();
  const winners = new Set<string>();

  for (const step of planVersionActions(ctx.own, ctx.all, ctx.rules, ctx.nowMs)) {
    const doc = byId.get(step.docId);
    if (!doc) continue;

    if (step.action === "note") {
      await patchDoc(ctx, doc, { version_note: step.note });
    } else if (step.action === "retire") {
      if (doc.norm_id && !(await withdrawNorm(ctx, doc.norm_id))) continue;
      const done = await patchDoc(ctx, doc, {
        status: "rejected",
        reject_reason: OLDER_VERSION_REASON,
        reject_detail: step.detail,
        version_winner_id: step.winnerId,
        last_checked_at: nowIso,
        next_check_at: recheckAt,
      });
      if (done) winners.add(step.winnerId);
    } else if (step.action === "relabel") {
      await patchDoc(ctx, doc, {
        status: "rejected",
        reject_reason: OLDER_VERSION_REASON,
        reject_detail: step.detail,
        version_winner_id: step.winnerId,
        last_checked_at: nowIso,
        next_check_at: recheckAt,
      });
    } else if (doc.content_reason) {
      // Der Gewinner ist weg, das Dokument bleibt wegen seines eigenen Inhalts abgelehnt.
      await patchDoc(ctx, doc, {
        status: "rejected",
        reject_reason: doc.content_reason,
        reject_detail: "Nach Wegfall der neueren Fassung erneut beurteilt",
        version_winner_id: null,
        filter_snapshot: ctx.rules,
      });
    } else if (doc.norm_id) {
      if (!(await reinstateNorm(ctx, doc))) continue;
      // Die Norm kann einen alten Text tragen: Nächster Lauf lädt neu und aktualisiert.
      const done = await patchDoc(ctx, doc, {
        status: "imported",
        reject_reason: null,
        reject_detail: null,
        version_winner_id: null,
        pdf_sha256: null,
        etag: null,
        last_modified: null,
        next_check_at: nowIso,
      });
      if (done) changed.add(doc.norm_id);
    } else {
      await patchDoc(ctx, doc, {
        status: "pending",
        reject_reason: null,
        reject_detail: null,
        version_winner_id: null,
        pdf_sha256: null,
        etag: null,
        last_modified: null,
        next_check_at: nowIso,
      });
    }
  }

  // Uploads, die auf einen zurückgenommenen Verlierer zeigten, gehören nun zum Gewinner.
  for (const id of Array.from(winners)) {
    const winner = byId.get(id);
    if (!winner?.norm_id || winner.scope !== "municipal") continue;
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
