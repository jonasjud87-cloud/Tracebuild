import { getAuthUser, ok, unauthorized, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { normAppliesToZone } from "@/lib/zone-match";
import { logAudit } from "@/lib/auditLog";
import { assignNorms } from "@/lib/norm-assignment";
import { normTextHash } from "@/lib/norm-hash";
import { refreshProjectOereb } from "@/lib/oereb/refresh";
import { refreshGeodata } from "@/lib/geoadmin/refresh";
import type { GeodataFacts } from "@/lib/geoadmin/geodata";
import type { AnalysisSnapshots, GeodataResponse } from "@/lib/geoadmin/contract";
import { isMissingSchema } from "@/lib/supabase/schema-errors";
import {
  runNormAnalysis,
  type AnalysisRunResult,
  type CheckItem,
  type NormInput,
  type OerebFacts,
  type PlanFile,
} from "@/lib/analysis-engine";
import {
  MAX_PLAN_FILES,
  MAX_PLAN_FILE_BYTES,
  planMimeType,
  type PlanMimeType,
  type UploadedPlanFile,
} from "@/lib/plan-files";

export const maxDuration = 300;

/** Zeitdeckel für die Modell-Phase, gemessen ab Beginn der Route (Vercel killt bei 300 s). */
const ROUTE_MODEL_BUDGET_MS = 265_000;

/** Aktualisierung vor der Analyse: Sie darf die Analyse nie aufhalten oder scheitern lassen. */
const REFRESH_MIN_AGE_MS = 5 * 60_000;
const OEREB_BUDGET_MS = 25_000;
const GEODATA_BUDGET_MS = 6_000;

// ── Norm-Auswahl ──────────────────────────────────────────────────────────────

interface ProjectNormRow {
  norms: {
    id: string;
    title: string;
    category: string | null;
    text: string | null;
    layer: number;
    zone: string | null;
    jurisdiction_type?: string | null;
    source_kind?: string | null;
    auto_scope?: string | null;
    source_checked_at?: string | null;
  } | null;
}

/** Ohne hinterlegte Normen wird trotzdem geprüft — dann eben gegen das Fachwissen. */
const FALLBACK_NORM: NormInput = {
  id: "",
  title: "Allgemeine Schweizer Bauvorschriften",
  category: null,
  text:
    "Für dieses Projekt sind keine Normen hinterlegt. Prüfe den Plan anhand deines Fachwissens " +
    "über Schweizer Bauvorschriften: Grenz- und Strassenabstände, Gebäude- und Firsthöhe, " +
    "Geschosszahl, Erschliessung und Zufahrt, Parkierung, Brandschutz, Terrainveränderungen und " +
    "Mindestanforderungen an Aufenthaltsräume. Alles, was ohne hinterlegte Norm nicht " +
    "abschliessend beurteilbar ist, markierst du als warn.",
};

function selectNorms(
  pnRows: ProjectNormRow[],
  projectZone: string | null,
  zoneConfidence: string | null,
): { norms: NormInput[]; source: "project_norms" | "fallback" } {
  const applicable = pnRows
    .map((r) => r.norms)
    .filter((n): n is NonNullable<ProjectNormRow["norms"]> => !!n)
    .filter((n) => normAppliesToZone(n.zone, projectZone, zoneConfidence))
    .filter((n) => (n.text ?? "").trim().length > 0)
    .map<NormInput>((n) => ({
      id: n.id, title: n.title, category: n.category, text: n.text ?? "",
      layer: n.layer, jurisdiction_type: n.jurisdiction_type ?? null,
      source_kind: n.source_kind ?? null, auto_scope: n.auto_scope ?? null,
    }));

  return applicable.length > 0
    ? { norms: applicable, source: "project_norms" }
    : { norms: [FALLBACK_NORM], source: "fallback" };
}

// ── ÖREB-Fakten ──────────────────────────────────────────────────────────────

/**
 * Was der Kataster über die Parzelle sagt — damit der Prüfer weiss, was amtlich gilt
 * (Zone, Lärm-ES) und was nachweislich nicht betroffen ist (Gewässer, Wald). Wirft nie;
 * ohne Auszug oder ohne Migration gibt es einfach keinen ÖREB-Block. Der alte Auszug bleibt nur
 * Rückfall: `stale` meldet, dass die letzte Aktualisierung fehlgeschlagen ist.
 */
async function loadOerebFacts(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
): Promise<{ facts: OerebFacts | null; snapshot: AnalysisSnapshots["oereb_snapshot"] }> {
  const none: AnalysisSnapshots["oereb_snapshot"] = { fetched_at: null, stale: false, stale_reason: null, status: null, egrid: null };
  try {
    const { data: extract, error } = await admin
      .from("oereb_extracts")
      .select("*")
      .eq("project_id", projectId)
      .maybeSingle();
    if (error || !extract) return { facts: null, snapshot: none };

    const stale = extract.status === "ok" && !!extract.last_error;
    const staleReason: string | null = stale ? extract.last_error : null;
    const snapshot: AnalysisSnapshots["oereb_snapshot"] = {
      fetched_at: extract.status === "ok" ? (extract.fetched_at ?? null) : null,
      stale,
      stale_reason: staleReason,
      status: extract.status ?? null,
      egrid: extract.egrid ?? null,
    };
    if (extract.status !== "ok") return { facts: null, snapshot };

    const { data: themes, error: thErr } = await admin
      .from("oereb_themes")
      .select("theme_code, theme_name, concern, legend_text, type_code, area_m2, area_pct")
      .eq("extract_id", extract.id);
    if (thErr || !themes) return { facts: null, snapshot };

    // Grundbuchfläche aus dem (geslimmten) Auszug — Basis für Ausnützungs-/Parkplatzrechnung.
    const raw = extract.raw as { RealEstate?: { LandRegistryArea?: unknown } } | null;
    const areaRaw = Number(raw?.RealEstate?.LandRegistryArea);
    const parcelAreaM2 = Number.isFinite(areaRaw) && areaRaw > 0 ? Math.round(areaRaw) : null;

    const num = (v: unknown): number | null => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
    const affects = themes
      .filter((t) => t.concern === "affects")
      .map((t) => ({
        code: t.theme_code, name: t.theme_name, legend: t.legend_text ?? null, typeCode: t.type_code ?? null,
        areaM2: num(t.area_m2), areaPct: num(t.area_pct),
      }));
    const uniq = (xs: string[]) => Array.from(new Set(xs));
    return {
      facts: {
        affects,
        noData: uniq(themes.filter((t) => t.concern === "no_data").map((t) => t.theme_name)),
        notAffected: uniq(themes.filter((t) => t.concern === "not_affects").map((t) => t.theme_name)),
        parcelAreaM2,
        fetchedAt: extract.fetched_at ?? null,
        stale,
        staleReason,
      },
      snapshot,
    };
  } catch {
    return { facts: null, snapshot: none };
  }
}

/** Nur was der Prüfer brauchen kann. Ohne Standort oder Daten gibt es keinen Geodaten-Block. */
function geodataFacts(geo: GeodataResponse): GeodataFacts | null {
  if (geo.status !== "ok" && geo.status !== "partial") return null;
  return {
    status: geo.status,
    fetchedAt: geo.fetched_at,
    data: geo.data,
    failedSources: geo.errors.map((e) => e.source),
  };
}

// ── Plansatz ─────────────────────────────────────────────────────────────────

function publicFileUrl(storagePath: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/documents/${storagePath}`;
}

/** Gültigkeit der signierten URLs, über die Claude die Dateien holt. */
const MODEL_FILE_URL_TTL_S = 60 * 60;

/**
 * Prüft die vom Client gemeldeten Dateien gegen Storage: gehören zum Projekt, existieren,
 * Typ und echte Grösse stimmen. Die Angaben des Clients allein reichen nicht.
 */
async function validatePlanFiles(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  raw: unknown,
): Promise<{ files: UploadedPlanFile[] } | { error: string }> {
  const list = Array.isArray(raw) ? raw : [];
  if (list.length === 0) return { error: "Keine Datei hochgeladen" };
  if (list.length > MAX_PLAN_FILES) return { error: `Höchstens ${MAX_PLAN_FILES} Dateien pro Prüfung` };

  const files: UploadedPlanFile[] = [];
  for (const f of list as Partial<UploadedPlanFile>[]) {
    const path = typeof f?.path === "string" ? f.path : "";
    const name = typeof f?.name === "string" && f.name.trim() ? f.name.trim().slice(0, 255) : "";
    if (!path.startsWith(`${projectId}/`) || path.includes("..") || !name) return { error: "Ungültige Datei" };
    const type = planMimeType(name, typeof f.type === "string" ? f.type : null);
    if (!type) return { error: `${name}: Nur PDF- oder Bilddateien werden unterstützt.` };

    const { data: info, error } = await admin.storage.from("documents").info(path);
    if (error || !info) return { error: `${name}: Datei wurde nicht vollständig hochgeladen.` };
    const size = Number(info.size ?? f.size ?? 0);
    if (size > MAX_PLAN_FILE_BYTES) return { error: `${name}: Die Datei ist grösser als ${MAX_PLAN_FILE_BYTES / 1024 / 1024} MB.` };
    files.push({ path, name, type, size });
  }
  return { files };
}

function toPlanFile(f: { name: string; type: PlanMimeType }, url: string): PlanFile {
  return {
    name: f.name,
    block: f.type === "application/pdf"
      ? { type: "document", source: { type: "url", url } }
      : { type: "image", source: { type: "url", url } },
  };
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
  return ok((data ?? []).map(withFiles));
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
    { files?: unknown; doc_type?: unknown; run_id?: unknown } | null;
  if (!body) return err("Ungültige Anfrage");
  const docType = (typeof body.doc_type === "string" && body.doc_type.trim()) || "Plansatz";
  // Vom Client vergebene Lauf-ID: darüber kann er den Lauf per POST …/analyses/cancel abbrechen.
  const runId = (typeof body.run_id === "string" ? body.run_id.trim() : "") || null;

  const checked = await validatePlanFiles(admin, params.id, body.files);
  if ("error" in checked) {
    // Hochgeladene, aber nie geprüfte Dateien nicht im Speicher liegen lassen.
    const stray = (Array.isArray(body.files) ? body.files : [])
      .map((f: { path?: unknown }) => (typeof f?.path === "string" ? f.path : ""))
      .filter((p: string) => p.startsWith(`${params.id}/`) && !p.includes(".."));
    if (stray.length) await admin.storage.from("documents").remove(stray);
    return err(checked.error);
  }
  const planFiles = checked.files;

  // Die Analyse-Zeile muss so früh wie möglich existieren, damit ein Abbruch
  // (POST …/cancel sucht sie über run_id) sie findet.
  const { data: doc, error: docError } = await admin
    .from("documents")
    .insert({ project_id: params.id, file_url: publicFileUrl(planFiles[0].path), doc_type: docType })
    .select()
    .single();
  if (docError) return err(docError.message, 500);

  const { error: filesError } = await admin.from("document_files").insert(
    planFiles.map((f, i) => ({
      document_id: doc.id, storage_path: f.path, file_name: f.name, mime_type: f.type, size_bytes: f.size, position: i,
    })),
  );
  if (filesError) {
    await admin.from("documents").delete().eq("id", doc.id);
    return err(filesError.message, 500);
  }

  const { data: analysis, error: analysisError } = await admin
    .from("analyses")
    .insert({ document_id: doc.id, status: "running", result_json: runId ? { run_id: runId } : null })
    .select()
    .single();
  if (analysisError) return err(analysisError.message, 500);

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
    await assignNorms(
      params.id,
      project.org_id,
      project.location?.canton ?? "",
      project.location?.municipality ?? "",
      project.domain ?? "bau",
    ).catch((e) => console.error(`Normzuweisung vor Analyse von Projekt ${params.id} fehlgeschlagen:`, e));
    // Die Zone kann sich durch den Abruf geändert haben.
    const { data: reread } = await admin.from("projects").select("*").eq("id", params.id).maybeSingle();
    const fresh = reread ?? project;

    // 1. Normen laden
    const normColumns = "id, title, category, text, layer, zone, jurisdiction_type";
    const queryNorms = (columns: string) =>
      admin.from("project_norms").select(`norms(${columns})`).eq("project_id", params.id);
    let { data: pnRows, error: pnError } = await queryNorms(`${normColumns}, source_kind, auto_scope, source_checked_at`);
    // Ohne Geoportal-Migration fehlen die neuen Spalten.
    if (pnError && isMissingSchema(pnError.message)) ({ data: pnRows, error: pnError } = await queryNorms(normColumns));

    // Nicht stillschweigend auf die Ersatznorm zurückfallen, wenn die Abfrage
    // selbst kaputt ist — sonst sieht ein DB-Fehler aus wie "keine Normen".
    if (pnError) {
      console.error(`Projekt ${params.id}: project_norms konnte nicht gelesen werden:`, pnError);
    }

    const { norms, source: normsSource } = selectNorms(
      (pnRows ?? []) as unknown as ProjectNormRow[],
      fresh.bauzone ?? null,
      fresh.zone_confidence ?? null,
    );
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
    const normMeta = new Map(
      ((pnRows ?? []) as unknown as ProjectNormRow[]).flatMap((r) => (r.norms ? [[r.norms.id, r.norms] as const] : [])),
    );
    const snapshots: AnalysisSnapshots = {
      oereb_snapshot: oerebSnapshot,
      geodata_snapshot: { fetched_at: geo.fetched_at, status: geo.status, sources: geo.sources },
      norm_versions: norms
        .filter((n) => n.id)
        .map((n) => ({
          norm_id: n.id,
          title: n.title,
          text_sha256: normTextHash(n.text),
          source_kind: normMeta.get(n.id)?.source_kind ?? null,
          source_checked_at: normMeta.get(n.id)?.source_checked_at ?? null,
        })),
    };

    // 6. Analyse abschliessen. Kosten werden immer geschrieben. Der Status-Guard
    //    verhindert, dass ein Abbruch, der während des Speicherns eintraf, von "done"
    //    überschrieben wird — dann räumen wir die Prüfpunkte wieder weg.
    const status = savedCount > 0 ? "done" : "error";
    const { data: finalAnalysis, error: updateError } = await admin
      .from("analyses")
      .update({
        status,
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
        },
      })
      .eq("id", analysis.id)
      .eq("status", "running")
      .select(`*, ${ANALYSIS_DOC_SELECT}`)
      .maybeSingle();

    if (updateError) return err(updateError.message, 500);
    if (!finalAnalysis) {
      await admin.from("analysis_items").delete().eq("analysis_id", analysis.id);
      return await finishCancelled();
    }

    if (savedCount === 0) {
      const reason = run.failed_norms[0]?.error ?? insertErrors[0] ?? "Keine Prüfpunkte erzeugt";
      return err(`Analyse ohne Ergebnis: ${reason}`, 502);
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
    await admin
      .from("analyses")
      .update({
        status: cancel.signal.aborted ? "cancelled" : "error",
        // Auch wenn es schiefging: was das Modell gekostet hat, wird verbucht.
        cost_usd: run?.cost_usd ?? 0,
        result_json: {
          run_id: runId,
          error: message,
          model: run?.model ?? null,
          usage: run?.usage ?? null,
          calls: run?.calls ?? [],
          failed_norms: run?.failed_norms ?? [],
        },
      })
      .eq("id", analysis.id)
      // Ein bereits gesetztes 'cancelled' (Cancel-Route war schneller als der Poll)
      // bleibt bestehen — nur ein laufender Datensatz wird zum Fehler.
      .in("status", cancel.signal.aborted ? ["running", "cancelled"] : ["running"]);

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
