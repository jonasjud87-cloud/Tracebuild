/**
 * Vorbereitung der Analyse: Normauswahl, ÖREB-Fakten, Plansatz, Einfrieren. Nur diese Phase ruft die
 * Aktualisierungen und das Modell-Umfeld ab, danach kommt alles aus dem Snapshot.
 * Die Hilfen stammen aus der Analyse-Route und dienen auch dem alten Pfad.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { normAppliesToZone } from "@/lib/zone-match";
import { assignNorms } from "@/lib/norm-assignment";
import { normTextHash } from "@/lib/norm-hash";
import { refreshProjectOereb } from "@/lib/oereb/refresh";
import { refreshGeodata } from "@/lib/geoadmin/refresh";
import type { GeodataFacts } from "@/lib/geoadmin/geodata";
import type { AnalysisSnapshots, GeodataResponse } from "@/lib/geoadmin/contract";
import { isMissingSchema } from "@/lib/supabase/schema-errors";
import {
  buildReferenceBlock,
  buildSystemPrompt,
  isReferenceNorm,
  partLabel,
  sortNormsForRun,
  toNormParts,
  type NormInput,
  type OerebFacts,
} from "@/lib/analysis-engine";
import { newDataBoundary } from "@/lib/analysis-reference";
import { planStagedParts } from "@/lib/analysis-plan";
import {
  MAX_PLAN_FILES,
  MAX_PLAN_FILE_BYTES,
  planMimeType,
  type UploadedPlanFile,
} from "@/lib/plan-files";
import { MODEL_FILE_URL_TTL_S, maxStagedAutoParts } from "./budget";
import { buildStageUnits, stageNorm } from "./plan";
import type { JobFile, PrepareResult, RunSnapshot, StageJob } from "./ports";

type Admin = SupabaseClient;

/** Aktualisierung vor der Analyse: Sie darf die Analyse nie aufhalten oder scheitern lassen. */
export const REFRESH_MIN_AGE_MS = 5 * 60_000;
export const OEREB_BUDGET_MS = 25_000;
export const GEODATA_BUDGET_MS = 6_000;

// ── Norm-Auswahl ──────────────────────────────────────────────────────────────

export interface ProjectNormRow {
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

export function selectNorms(
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
export async function loadOerebFacts(
  admin: Admin,
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
export function geodataFacts(geo: GeodataResponse): GeodataFacts | null {
  if (geo.status !== "ok" && geo.status !== "partial") return null;
  return {
    status: geo.status,
    fetchedAt: geo.fetched_at,
    data: geo.data,
    failedSources: geo.errors.map((e) => e.source),
  };
}

// ── Plansatz ─────────────────────────────────────────────────────────────────

/**
 * Prüft die vom Client gemeldeten Dateien gegen Storage: gehören zum Projekt, existieren,
 * Typ und echte Grösse stimmen. Die Angaben des Clients allein reichen nicht.
 */
export async function validatePlanFiles(
  admin: Admin,
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

/** Einmal signieren und unverändert wiederverwenden: Neu signieren ändert den Cache-Prefix. */
export async function signPlanFiles(admin: Admin, files: JobFile[]): Promise<{ signed_urls: string[]; urls_expire_at: string }> {
  const { data: signed, error } = await admin.storage
    .from("documents")
    .createSignedUrls(files.map((f) => f.path), MODEL_FILE_URL_TTL_S);
  if (error || !signed || signed.some((u) => !u.signedUrl)) {
    throw new Error(`Dateien konnten nicht freigegeben werden: ${error?.message ?? "Signierung fehlgeschlagen"}`);
  }
  return {
    signed_urls: signed.map((u) => u.signedUrl),
    urls_expire_at: new Date(Date.now() + MODEL_FILE_URL_TTL_S * 1000).toISOString(),
  };
}

// ── Vorbereitung einer Etappen-Analyse ───────────────────────────────────────

export async function prepareRun(admin: Admin, job: StageJob, signal: AbortSignal): Promise<PrepareResult> {
  // Org-Prüfung: Der Job trägt die Org aus der angemeldeten Sitzung des Starts.
  let query = admin.from("projects").select("*").eq("id", job.project_id);
  if (job.org_id) query = query.eq("org_id", job.org_id);
  const { data: project } = await query.maybeSingle();
  if (!project) throw new Error("Projekt nicht gefunden");

  // 0. Aktuellen Stand holen. Beide wirken nur innerhalb ihres Budgets und werfen nie.
  await refreshProjectOereb(admin, project, { budgetMs: OEREB_BUDGET_MS, minAgeMs: REFRESH_MIN_AGE_MS, signal });
  const geo = await refreshGeodata(admin, project, { budgetMs: GEODATA_BUDGET_MS, minAgeMs: REFRESH_MIN_AGE_MS, signal });
  await assignNorms(
    job.project_id,
    project.org_id,
    project.location?.canton ?? "",
    project.location?.municipality ?? "",
    project.domain ?? "bau",
  ).catch((e) => console.error(`Normzuweisung vor Analyse von Projekt ${job.project_id} fehlgeschlagen:`, e));
  // Die Zone kann sich durch den Abruf geändert haben.
  const { data: reread } = await admin.from("projects").select("*").eq("id", job.project_id).maybeSingle();
  const fresh = reread ?? project;

  // 1. Normen laden
  const normColumns = "id, title, category, text, layer, zone, jurisdiction_type";
  const queryNorms = (columns: string) =>
    admin.from("project_norms").select(`norms(${columns})`).eq("project_id", job.project_id);
  let { data: pnRows, error: pnError } = await queryNorms(`${normColumns}, source_kind, auto_scope, source_checked_at`);
  if (pnError && isMissingSchema(pnError.message)) ({ data: pnRows, error: pnError } = await queryNorms(normColumns));
  if (pnError) console.error(`Projekt ${job.project_id}: project_norms konnte nicht gelesen werden:`, pnError);

  const rows = (pnRows ?? []) as unknown as ProjectNormRow[];
  const { norms: selected, source: normsSource } = selectNorms(rows, fresh.bauzone ?? null, fresh.zone_confidence ?? null);
  if (normsSource === "fallback") {
    console.warn(`Projekt ${job.project_id}: keine Normen in project_norms — Analyse läuft auf Fachwissen.`);
  }

  // 2. Einfrieren: Grenzmarker, Prompt und Referenz als fertige Strings.
  const { facts: oereb, snapshot: oerebSnapshot } = await loadOerebFacts(admin, job.project_id);
  const ctx = {
    municipality: fresh.location?.municipality ?? "",
    canton: fresh.location?.canton ?? "",
    bauzone: fresh.bauzone ?? "",
    parcel: fresh.parcel_number ?? null,
    zoneSource: fresh.zone_source ?? null,
    zoneConfidence: fresh.zone_confidence ?? null,
    oereb,
    geodata: geodataFacts(geo),
  };
  const norms = sortNormsForRun(selected);
  const boundary = newDataBoundary();
  const system = buildSystemPrompt(ctx, boundary);
  const reference = buildReferenceBlock(ctx, norms.filter(isReferenceNorm), boundary);
  const { units: planned, summary: autoParts } = planStagedParts(toNormParts(norms), maxStagedAutoParts());
  const units = buildStageUnits(planned, partLabel);

  // Herkunftsstempel: welcher Normstand galt. Normen können später automatisch überschrieben werden.
  const normMeta = new Map(rows.flatMap((r) => (r.norms ? [[r.norms.id, r.norms] as const] : [])));
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

  const snapshot: RunSnapshot = {
    ...snapshots,
    boundary,
    system,
    reference_text: reference.text,
    reference_complete_ids: Array.from(reference.completeIds),
    norms: norms.map(stageNorm),
    assigned_ids: norms.map((n) => n.id).filter(Boolean),
    norm_order: norms.map((n) => n.id),
    norms_source: normsSource,
    norms_error: pnError?.message ?? null,
    reference_norms: norms.filter(isReferenceNorm).map((n) => n.title),
    oereb_context: !!oereb,
    auto_parts: autoParts,
  };

  // 3. Plansatz: Claude holt jede Datei selbst über eine signierte URL.
  const signed = await signPlanFiles(admin, job.files);
  return { snapshot, units, ...signed };
}
