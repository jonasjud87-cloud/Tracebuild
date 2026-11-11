import { getAuthUser, ok, unauthorized, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/auditLog";
import { assignNorms } from "@/lib/norm-assignment";
import { refreshProjectOereb } from "@/lib/oereb/refresh";
import { refreshGeodata } from "@/lib/geoadmin/refresh";
import type { AnalysisSnapshots } from "@/lib/geoadmin/contract";
import { isMissingSchema } from "@/lib/supabase/schema-errors";
import {
  runNormAnalysis,
  type AnalysisRunResult,
  type CheckItem,
  type PlanFile,
} from "@/lib/analysis-engine";
import { removeUnreferencedPlanFiles, type UploadedPlanFile } from "@/lib/plan-files";
import { parsePreflight, toPlanFile } from "@/lib/analysis-stages/plan";
import { publicResultJson } from "@/lib/analysis-stages/progress";
import {
  GEODATA_BUDGET_MS,
  OEREB_BUDGET_MS,
  REFRESH_MIN_AGE_MS,
  geodataFacts,
  buildNormVersions,
  loadOerebFacts,
  loadProjectNorms,
  selectNorms,
  validatePlanFiles,
} from "@/lib/analysis-stages/prepare";
import { createJob, startStage } from "@/lib/analysis-stages/runtime";
import { failureFields, failureReason, updateClosing } from "@/lib/analysis-failure";
import { closeOrphan, isUuid, planRetry, supabaseRetryDeps } from "@/lib/analysis-retry";
import { supabaseOrphanDeps } from "@/lib/analysis-retry-close";
import { TIMEOUT_ERROR_TEXT } from "@/lib/admin-analyses/constants";

export const maxDuration = 300;

const RETRY_FAILED = "Die Analyse konnte nicht erneut gestartet werden. Bitte laden Sie die Seite neu.";

/** Zeitdeckel für die Modell-Phase, gemessen ab Beginn der Route (Vercel killt bei 300 s). */
const ROUTE_MODEL_BUDGET_MS = 265_000;

// ── Plansatz ─────────────────────────────────────────────────────────────────

/** Gültigkeit der signierten URLs im alten Pfad, über die Claude die Dateien holt. */
const MODEL_FILE_URL_TTL_S = 60 * 60;

function publicFileUrl(storagePath: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/documents/${storagePath}`;
}

interface DocumentFileRow { file_name: string; storage_path: string; mime_type: string; size_bytes: number | null; position: number }

/** Dateiliste für die Vorschau; ältere Analysen ohne document_files fallen auf file_url zurück. */
function withFiles<T extends { documents?: { file_url?: string | null; document_files?: DocumentFileRow[] | null } | null }>(a: T) {
  const rows = (a.documents?.document_files ?? []).slice().sort((x, y) => x.position - y.position);
  const files = rows.length > 0
    ? rows.map((r) => ({ name: r.file_name, url: publicFileUrl(r.storage_path) }))
    : a.documents?.file_url
      ? [{ name: "Plan", url: a.documents.file_url }]
      : [];
  return { ...a, files };
}

const ANALYSIS_DOC_SELECT =
  "documents(doc_type, file_url, document_files(file_name, storage_path, mime_type, size_bytes, position))";

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const admin = createAdminClient();

  const { data: project } = await admin
    .from("projects")
    .select("id")
    .eq("id", params.id)
    .eq("org_id", user.org_id)
    .single();
  if (!project) return err("Projekt nicht gefunden", 404);

  // 2-step query: get doc IDs first, then analyses
  const { data: docs } = await admin
    .from("documents")
    .select("id")
    .eq("project_id", params.id);

  const docIds = (docs ?? []).map((d: { id: string }) => d.id);
  if (docIds.length === 0) return ok([]);

  const { data, error } = await admin
    .from("analyses")
    .select(`*, ${ANALYSIS_DOC_SELECT}, analysis_items(*)`)
    .in("document_id", docIds)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false });

  if (error) return err(error.message, 500);
  return ok((data ?? []).map((a) => withFiles({ ...a, result_json: publicResultJson(a.result_json) })));
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const routeStart = Date.now();

  const user = await getAuthUser();
  if (!user) return unauthorized();

  const admin = createAdminClient();

  const { data: project } = await admin
    .from("projects")
    .select("*")
    .eq("id", params.id)
    .eq("org_id", user.org_id)
    .single();
  if (!project) return err("Projekt nicht gefunden", 404);

  // Die Dateien liegen bereits in Storage (Upload direkt aus dem Browser über
  // …/analyses/uploads); hier kommen nur Pfade an — kein Request-Body-Limit für Pläne.
  const body = await request.json().catch(() => null) as
    { files?: unknown; doc_type?: unknown; run_id?: unknown; preflight?: unknown; retry_of?: unknown } | null;
  if (!body) return err("Ungültige Anfrage");
  // Vom Client vergebene Lauf-ID: darüber kann er den Lauf per POST …/analyses/cancel abbrechen.
  const runId = (typeof body.run_id === "string" ? body.run_id.trim() : "") || null;

  // «Erneut versuchen»: gleicher Plansatz (Dokument und Dateien) wie die fehlgeschlagene Analyse,
  // danach derselbe Start wie bei einer neuen Analyse.
  const retryOf = typeof body.retry_of === "string" ? body.retry_of.trim() : "";
  let doc: { id: string };
  let planFiles: UploadedPlanFile[];
  if (retryOf) {
    if (!isUuid(retryOf)) return err("Analyse nicht gefunden", 404);
    let plan;
    try {
      plan = await planRetry(supabaseRetryDeps(admin), { projectId: params.id, analysisId: retryOf, user }, Date.now());
    } catch (e) {
      console.error(`Wiederholung von Analyse ${retryOf} nicht möglich:`, e instanceof Error ? e.message : e);
      return err(RETRY_FAILED, 500);
    }
    if (!plan.ok) return err(plan.error, plan.status);
    const checked = await validatePlanFiles(admin, params.id, plan.files);
    if ("error" in checked) return err(`${checked.error} Bitte laden Sie die Pläne neu hoch.`, 409);
    if (plan.closeOld) {
      // Verwaister Lauf: erst den Job atomar übernehmen, dann als Zeitüberschreitung schliessen.
      let closed;
      try {
        closed = await closeOrphan(supabaseOrphanDeps(admin, plan.resultJson), retryOf, crypto.randomUUID(), TIMEOUT_ERROR_TEXT, Date.now());
      } catch (e) {
        console.error(`Verwaiste Analyse ${retryOf} nicht geschlossen:`, e instanceof Error ? e.message : e);
        return err(RETRY_FAILED, 500);
      }
      if (!closed.ok) return err(closed.error, closed.status);
      await logAudit(admin, {
        orgId: user.org_id,
        actorId: user.id,
        actorEmail: user.email,
        action: "analysis_run",
        targetId: retryOf,
        meta: { op: "retry_timeout", previousStatus: "running", newStatus: "error", projectId: params.id, retry_of: retryOf },
      });
    }
    doc = { id: plan.documentId };
    planFiles = checked.files;
  } else {
    const docType = (typeof body.doc_type === "string" && body.doc_type.trim()) || "Plansatz";
    const checked = await validatePlanFiles(admin, params.id, body.files);
    if ("error" in checked) {
      // Hochgeladene, aber nie geprüfte Dateien nicht im Speicher liegen lassen.
      const stray = (Array.isArray(body.files) ? body.files : [])
        .map((f: { path?: unknown }) => (typeof f?.path === "string" ? f.path : ""));
      await removeUnreferencedPlanFiles(admin, params.id, stray, publicFileUrl);
      return err(checked.error);
    }
    planFiles = checked.files;

    // Die Analyse-Zeile muss so früh wie möglich existieren, damit ein Abbruch
    // (POST …/cancel sucht sie über run_id) sie findet.
    const { data: newDoc, error: docError } = await admin
      .from("documents")
      .insert({ project_id: params.id, file_url: publicFileUrl(planFiles[0].path), doc_type: docType })
      .select()
      .single();
    if (docError) return err(docError.message, 500);
    doc = newDoc;

    const { error: filesError } = await admin.from("document_files").insert(
      planFiles.map((f, i) => ({
        document_id: newDoc.id, storage_path: f.path, file_name: f.name, mime_type: f.type, size_bytes: f.size, position: i,
      })),
    );
    if (filesError) {
      await admin.from("documents").delete().eq("id", newDoc.id);
      await removeUnreferencedPlanFiles(admin, params.id, planFiles.map((f) => f.path), publicFileUrl);
      return err(filesError.message, 500);
    }
  }

  const { data: analysis, error: analysisError } = await admin
    .from("analyses")
    .insert({ document_id: doc.id, status: "running", result_json: runId ? { run_id: runId } : null })
    .select()
    .single();
  if (analysisError) {
    if (!retryOf) return err(analysisError.message, 500);
    // Wiederholung: Dokument kann inzwischen gelöscht sein (FK). Rohtext nur ins Log.
    console.error(`Wiederholung von Analyse ${retryOf}: Anlegen fehlgeschlagen:`, analysisError.message);
    return err(RETRY_FAILED, 409);
  }

  // Weiche: Mit eingespielter Migration läuft die Analyse in Etappen, sonst wie bisher in dieser Anfrage.
  let mode: "created" | "missing_schema" | "conflict";
  try {
    mode = await createJob(admin, {
      analysisId: analysis.id,
      projectId: params.id,
      orgId: user.org_id,
      actorId: user.id,
      actorEmail: user.email,
      runId,
      files: planFiles,
      preflight: parsePreflight(body.preflight),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Analyse konnte nicht gestartet werden";
    console.error(`Job für Analyse ${analysis.id} konnte nicht angelegt werden:`, message);
    await updateClosing(failureFields(message, Date.now(), { run_id: runId }), (f) =>
      admin.from("analyses").update(f).eq("id", analysis.id).eq("status", "running"));
    return err(message, 500);
  }

  if (mode === "conflict") {
    await admin.from("analyses").delete().eq("id", analysis.id);
    // Bei der Wiederholung gehören Dokument und Dateien weiter zur fehlgeschlagenen Analyse.
    if (!retryOf) {
      await admin.from("documents").delete().eq("id", doc.id);
      await removeUnreferencedPlanFiles(admin, params.id, planFiles.map((f) => f.path), publicFileUrl);
    }
    return err("Für dieses Projekt läuft bereits eine Analyse. Bitte warten Sie, bis sie abgeschlossen ist.", 409);
  }

  if (mode === "created") {
    // Vor dem Start lesen: Die Etappe schreibt ab jetzt selbst in die Zeile.
    const { data: started } = await admin
      .from("analyses")
      .select(`*, ${ANALYSIS_DOC_SELECT}`)
      .eq("id", analysis.id)
      .maybeSingle();
    let startFailed: string | null = null;
    try {
      // Kein Claim ist kein Fehler: Die Statusroute meldet needs_resume, der Browser nimmt wieder auf.
      await startStage(admin, analysis.id, null, "start", routeStart);
    } catch (e) {
      startFailed = e instanceof Error ? e.message : "Claim fehlgeschlagen";
      console.error(`Etappe 1 von Analyse ${analysis.id} nicht gestartet:`, startFailed);
    }
    if (startFailed === null || !isMissingSchema(startFailed)) {
      return ok({ ...withFiles(started ?? analysis), analysis_items: [] }, 202);
    }
    // Tabellen da, Funktionen nicht (Migration nur teilweise eingespielt): alter Pfad.
    await admin.from("analysis_jobs").delete().eq("analysis_id", analysis.id);
  }

  return runInRequest(admin, {
    user,
    project,
    projectId: params.id,
    analysis,
    runId,
    planFiles,
    routeStart,
  });
}

// ── Alter Pfad: Alles in einer Anfrage, bis die Migration eingespielt ist ─────

async function runInRequest(
  admin: ReturnType<typeof createAdminClient>,
  { user, project, projectId, analysis, runId, planFiles, routeStart }: {
    user: { id: string; email: string; org_id: string };
    project: Parameters<typeof refreshProjectOereb>[1] & Parameters<typeof refreshGeodata>[1] & {
      org_id: string;
      location?: { canton?: string; municipality?: string } | null;
      domain?: string | null;
    };
    projectId: string;
    analysis: { id: string };
    runId: string | null;
    planFiles: UploadedPlanFile[];
    routeStart: number;
  },
) {
  const params = { id: projectId };

  // Kosten müssen auch im Fehlerfall in die DB — deshalb ausserhalb des try.
  let run: AnalysisRunResult | null = null;

  // Abbruch durch den Nutzer: die Cancel-Route setzt status = 'cancelled'; wir schauen
  // regelmässig nach und reissen dann die laufenden Modell-Calls ab. Ein DB-Fehler beim
  // Nachschauen ist KEIN Abbruch — sonst würde ein Netzwackler einen bezahlten Lauf verwerfen.
  const cancel = new AbortController();
  const checkCancelled = async () => {
    const { data, error } = await admin.from("analyses").select("status").eq("id", analysis.id).maybeSingle();
    if (error) { console.warn(`Cancel-Poll für ${analysis.id} fehlgeschlagen:`, error.message); return; }
    if (!data || data.status === "cancelled") cancel.abort();
  };
  const cancelPoll = setInterval(checkCancelled, 2_500);

  /** Abgebrochen: Kosten festhalten, keine Prüfpunkte speichern. */
  const finishCancelled = async () => {
    await admin
      .from("analyses")
      .update({
        status: "cancelled",
        cost_usd: run?.cost_usd ?? 0,
        result_json: { run_id: runId, cancelled: true, model: run?.model ?? null, usage: run?.usage ?? null, calls: run?.calls ?? [] },
      })
      .eq("id", analysis.id);
    return err("Analyse abgebrochen", 409);
  };

  try {
    // Abbruch, der schon während des Starts kam, nicht erst nach 2.5 s bemerken.
    await checkCancelled();
    if (cancel.signal.aborted) return await finishCancelled();

    // 0. Aktuellen Stand holen. Beide wirken nur innerhalb ihres Budgets und werfen nie. Der Import
    //    neuer Reglemente läuft nie hier, sondern vorher über …/oereb/documents/sync.
    await refreshProjectOereb(admin, project, { budgetMs: OEREB_BUDGET_MS, minAgeMs: REFRESH_MIN_AGE_MS, signal: cancel.signal });
    if (cancel.signal.aborted) return await finishCancelled();
    const geo = await refreshGeodata(admin, project, { budgetMs: GEODATA_BUDGET_MS, minAgeMs: REFRESH_MIN_AGE_MS, signal: cancel.signal });
    if (cancel.signal.aborted) return await finishCancelled();
    let assignError: unknown = null;
    await assignNorms(
      params.id,
      project.org_id,
      project.location?.canton ?? "",
      project.location?.municipality ?? "",
      project.domain ?? "bau",
    ).catch((e) => {
      assignError = e;
      console.error(`Normzuweisung vor Analyse von Projekt ${params.id} fehlgeschlagen:`, e);
    });
    // Die Zone kann sich durch den Abruf geändert haben.
    const { data: reread } = await admin.from("projects").select("*").eq("id", params.id).maybeSingle();
    const fresh = reread ?? project;

    // 1. Normen laden
    // Ohne Geoportal- oder Import-Migration fehlen einzelne Spalten.
    const { rows: pnRows, error: pnError } = await loadProjectNorms(admin, params.id);

    // Nicht stillschweigend auf die Ersatznorm zurückfallen, wenn die Abfrage
    // selbst kaputt ist — sonst sieht ein DB-Fehler aus wie "keine Normen".
    if (pnError) {
      console.error(`Projekt ${params.id}: project_norms konnte nicht gelesen werden:`, pnError);
    }

    const { norms, source: normsSource } = selectNorms(
      pnRows,
      fresh.bauzone ?? null,
      fresh.zone_confidence ?? null,
      project.org_id,
    );
    // Ohne Zuweisung und ohne Normen sähe ein technischer Fehler aus wie «keine Normen hinterlegt»: lieber
    // abbrechen als eine bezahlte Prüfung nur auf Fachwissen. Mit bestehenden Normen läuft sie auf dem letzten Stand.
    if (normsSource === "fallback" && (assignError || pnError)) {
      throw new Error("Die Normen des Projekts konnten nicht geladen werden. Bitte später erneut versuchen.");
    }
    if (normsSource === "fallback") {
      console.warn(`Projekt ${params.id}: keine Normen in project_norms — Analyse läuft auf Fachwissen.`);
    }
    const assignedIds = new Set(norms.map((n) => n.id).filter(Boolean));

    // 2. Plansatz: Claude holt jede Datei selbst über eine kurzlebige signierte URL.
    //    Base64 im Request ginge bei zehn Plänen über das Request-Limit der API.
    const { data: signed, error: signError } = await admin.storage
      .from("documents")
      .createSignedUrls(planFiles.map((f) => f.path), MODEL_FILE_URL_TTL_S);
    if (signError || !signed || signed.some((u) => !u.signedUrl)) {
      throw new Error(`Dateien konnten nicht freigegeben werden: ${signError?.message ?? "Signierung fehlgeschlagen"}`);
    }
    const files: PlanFile[] = planFiles.map((f, i) => toPlanFile(f, signed[i].signedUrl));

    // 3. Ein Call pro Norm, parallel, mit Cache-Grenze hinter PDF + Referenzrahmen.
    const { facts: oereb, snapshot: oerebSnapshot } = await loadOerebFacts(admin, params.id);
    const budgetMs = Math.max(45_000, ROUTE_MODEL_BUDGET_MS - (Date.now() - routeStart));
    run = await runNormAnalysis(
      norms,
      files,
      {
        municipality: fresh.location?.municipality ?? "",
        canton: fresh.location?.canton ?? "",
        bauzone: fresh.bauzone ?? "",
        parcel: fresh.parcel_number ?? null,
        zoneSource: fresh.zone_source ?? null,
        zoneConfidence: fresh.zone_confidence ?? null,
        oereb,
        geodata: geodataFacts(geo),
      },
      budgetMs,
      cancel.signal,
    );

    if (cancel.signal.aborted) return await finishCancelled();

    // 4. norm_id gegen die tatsächlich zugewiesenen Normen validieren.
    //    (Die Engine setzt sie serverseitig — das hier ist der Gurt zum Hosenträger,
    //    damit eine unbekannte UUID nie den FK auf norms(id) verletzt.)
    const rows = run.items.map((item: CheckItem) => ({
      analysis_id: analysis.id,
      norm_id: item.norm_id && assignedIds.has(item.norm_id) ? item.norm_id : null,
      norm_title: item.norm_title,
      category: item.category,
      status: item.status,
      note: item.finding, // 'note' column stores the finding text
      suggestion: item.suggestion,
      confidence: item.confidence,
      page_reference: item.page_reference,
      source_file: item.source_file,
    }));

    // 5. Speichern — Fehler werden ausgewertet, und ein kaputter Datensatz
    //    reisst nicht den ganzen Batch mit.
    const insertErrors: string[] = [];
    let savedCount = 0;

    if (rows.length > 0) {
      const { error: bulkError } = await admin.from("analysis_items").insert(rows);
      if (!bulkError) {
        savedCount = rows.length;
      } else {
        console.error("analysis_items bulk insert failed, falling back to row-by-row:", bulkError);
        for (const row of rows) {
          const { error: rowError } = await admin.from("analysis_items").insert(row);
          if (rowError) insertErrors.push(`${row.norm_title}: ${rowError.message}`);
          else savedCount++;
        }
      }
    }

    // Nachweis, welcher Normstand galt: Normen können später automatisch überschrieben werden.
    const snapshots: AnalysisSnapshots = {
      oereb_snapshot: oerebSnapshot,
      geodata_snapshot: { fetched_at: geo.fetched_at, status: geo.status, sources: geo.sources },
      norm_versions: buildNormVersions(norms, pnRows),
    };

    // 6. Analyse abschliessen. Kosten werden immer geschrieben. Der Status-Guard
    //    verhindert, dass ein Abbruch, der während des Speicherns eintraf, von "done"
    //    überschrieben wird — dann räumen wir die Prüfpunkte wieder weg.
    const status = savedCount > 0 ? "done" : "error";
    // Ohne Prüfpunkte gehört der Grund in result_json.error, sonst zeigt die Seite keinen.
    const noResultReason = run.failed_norms[0]?.error ?? insertErrors[0] ?? "Keine Prüfpunkte erzeugt";
    const { data: finalAnalysis, error: updateError } = await updateClosing({
        status,
        finished_at: new Date().toISOString(),
        cost_usd: run.cost_usd,
        result_json: {
          run_id: runId,
          model: run.model,
          norms_source: normsSource,
          norms_error: pnError?.message ?? null,
          norm_count: norms.length,
          reference_norms: norms.filter((n) => n.layer === 4 || n.jurisdiction_type === "municipal").map((n) => n.title),
          oereb_context: !!oereb,
          ...snapshots,
          auto_parts: run.auto_parts,
          item_count: run.items.length,
          raw_item_count: run.consolidation?.raw_count ?? run.items.length,
          consolidation: run.consolidation,
          saved_count: savedCount,
          duration_ms: run.duration_ms,
          usage: run.usage,
          calls: run.calls,
          failed_norms: run.failed_norms,
          insert_errors: insertErrors,
          ...(status === "error" ? { error: `Analyse ohne Ergebnis: ${noResultReason}` } : {}),
        },
      }, (f) => admin
        .from("analyses")
        .update(f)
        .eq("id", analysis.id)
        .eq("status", "running")
        .select(`*, ${ANALYSIS_DOC_SELECT}`)
        .maybeSingle());

    if (updateError) return err(updateError.message, 500);
    if (!finalAnalysis) {
      await admin.from("analysis_items").delete().eq("analysis_id", analysis.id);
      return await finishCancelled();
    }

    if (savedCount === 0) {
      return err(`Analyse ohne Ergebnis: ${noResultReason}`, 502);
    }

    // 7. Zurückgelesenes Ergebnis an den Client — nicht die In-Memory-Items.
    //    Die haben weder DB-`id` noch die Spalte `note`, die das UI liest.
    const { data: savedItems } = await admin
      .from("analysis_items")
      .select("*")
      .eq("analysis_id", analysis.id);

    const normOrder = new Map(norms.map((n, i) => [n.id, i]));
    const severity: Record<string, number> = { fail: 0, warn: 1, ok: 2 };
    const items = (savedItems ?? []).slice().sort((a, b) => {
      const byNorm = (normOrder.get(a.norm_id ?? "") ?? 999) - (normOrder.get(b.norm_id ?? "") ?? 999);
      if (byNorm !== 0) return byNorm;
      return (severity[a.status] ?? 9) - (severity[b.status] ?? 9);
    });

    await logAudit(admin, {
      orgId: user.org_id,
      actorId: user.id,
      actorEmail: user.email,
      action: "analysis_run",
      targetId: analysis.id,
      meta: { projectId: params.id, status: finalAnalysis.status, itemCount: items.length },
    });

    return ok({ ...withFiles(finalAnalysis), items, failed_norms: run.failed_norms }, 201);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Analyse fehlgeschlagen";
    // Sonst taucht ein 500 nur in result_json auf, nicht in den Vercel-Logs.
    console.error(`Analyse ${analysis.id} (Projekt ${params.id}) fehlgeschlagen:`, e);
    await updateClosing({
        status: cancel.signal.aborted ? "cancelled" : "error",
        finished_at: new Date().toISOString(),
        // Auch wenn es schiefging: was das Modell gekostet hat, wird verbucht.
        cost_usd: run?.cost_usd ?? 0,
        result_json: {
          run_id: runId,
          error: failureReason(message),
          model: run?.model ?? null,
          usage: run?.usage ?? null,
          calls: run?.calls ?? [],
          failed_norms: run?.failed_norms ?? [],
        },
      }, (f) => admin
        .from("analyses")
        .update(f)
        .eq("id", analysis.id)
        // Ein bereits gesetztes 'cancelled' (Cancel-Route war schneller als der Poll)
        // bleibt bestehen — nur ein laufender Datensatz wird zum Fehler.
        .in("status", cancel.signal.aborted ? ["running", "cancelled"] : ["running"]));

    await logAudit(admin, {
      orgId: user.org_id,
      actorId: user.id,
      actorEmail: user.email,
      action: "analysis_run",
      targetId: analysis.id,
      meta: { projectId: params.id, status: "error", error: message },
    });

    return err(message, 500);
  } finally {
    clearInterval(cancelPoll);
  }
}
