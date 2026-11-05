import type { SupabaseClient } from "@supabase/supabase-js";
import { recordFetchEvent } from "../oereb/fetch-events";
import { isExtractStale } from "../oereb/stale";
import { isMissingSchema } from "../supabase/schema-errors";
import type { GeodataResponse } from "./contract";
import { EMPTY_GEODATA, fetchGeodata, GEODATA_SOURCES, type GeodataContent } from "./geodata";
import { buildLinks } from "./links";

interface GeodataRow {
  egrid: string | null;
  status: string;
  data: GeodataContent;
  links: GeodataResponse["links"];
  errors: GeodataResponse["errors"];
  fetched_at: string | null;
  last_attempt_at: string | null;
}

export interface GeodataProject {
  id: string;
  location?: { canton?: string } | null;
  parcel_number?: string | null;
  egrid?: string | null;
  lv95_e?: number | string | null;
  lv95_n?: number | string | null;
}

export interface GeodataRefreshOptions {
  budgetMs?: number;
  /** Abruf entfällt, falls der letzte Versuch jünger ist. 0 = immer abrufen. */
  minAgeMs?: number;
  /** Abbruch von aussen, zusätzlich zum Budget. */
  signal?: AbortSignal;
}

function numberOrNull(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toResponse(row: GeodataRow): GeodataResponse {
  return {
    status: row.status as GeodataResponse["status"],
    data: { ...EMPTY_GEODATA, ...row.data },
    errors: row.errors ?? [],
    links: row.links ?? { geoportal: null, canton_portal: null, oereb_pdf: null },
    sources: GEODATA_SOURCES,
    fetched_at: row.fetched_at,
  };
}

/** Gespeicherter Stand. Fehlt die Tabelle oder gehört er zu einem anderen Grundstück: null. */
async function loadStored(admin: SupabaseClient, projectId: string, egrid: string | null): Promise<GeodataRow | null> {
  const { data, error } = await admin.from("project_geodata").select("*").eq("project_id", projectId).maybeSingle();
  if (error) {
    if (!isMissingSchema(error.message)) console.error(`Geodaten von Projekt ${projectId} nicht lesbar:`, error.message);
    return null;
  }
  const row = (data as GeodataRow | null) ?? null;
  if (row && egrid && row.egrid && row.egrid !== egrid) return null;
  return row;
}

/** Bestand ohne EGRID: aus dem Auszug, ausser dieser könnte zu einem anderen Grundstück gehören. */
async function egridOfProject(admin: SupabaseClient, project: GeodataProject): Promise<string | null> {
  if (project.egrid) return project.egrid;
  const { data, error } = await admin
    .from("oereb_extracts")
    .select("egrid, canton, parcel_number, status")
    .eq("project_id", project.id)
    .maybeSingle();
  if (error || !data || data.status !== "ok" || !data.egrid) return null;
  return isExtractStale(data, project) ? null : (data.egrid as string);
}

export async function readGeodata(admin: SupabaseClient, project: GeodataProject): Promise<GeodataResponse | null> {
  const stored = await loadStored(admin, project.id, project.egrid ?? null);
  return stored ? toResponse(stored) : null;
}

/**
 * Geodaten aktualisieren. Wirft nie: Fällt ein Dienst aus, bleibt der alte Wert des Teils stehen.
 * Fehlende Tabelle: Ergebnis ohne Cache. Fehlende Koordinate: über die EGRID nachschlagen.
 */
export async function refreshGeodata(
  admin: SupabaseClient,
  project: GeodataProject,
  { budgetMs = 15_000, minAgeMs = 0, signal }: GeodataRefreshOptions = {}
): Promise<GeodataResponse> {
  const canton = project.location?.canton ?? null;
  try {
    const egrid = await egridOfProject(admin, project);
    const stored = await loadStored(admin, project.id, egrid);

    if (stored && minAgeMs > 0) {
      const last = stored.last_attempt_at ?? stored.fetched_at;
      if (last && Date.now() - Date.parse(last) < minAgeMs) return toResponse(stored);
    }

    const startedAt = Date.now();
    const result = await fetchGeodata({
      canton,
      egrid,
      e: numberOrNull(project.lv95_e),
      n: numberOrNull(project.lv95_n),
      signal: signal ? AbortSignal.any([AbortSignal.timeout(budgetMs), signal]) : AbortSignal.timeout(budgetMs),
      previous: stored ? { data: { ...EMPTY_GEODATA, ...stored.data }, links: stored.links } : null,
    });

    if (result.status !== "no_location") {
      await recordFetchEvent(admin, {
        source: "geodata",
        canton,
        project_id: project.id,
        status: result.status,
        detail: result.errors.map((x) => `${x.source}: ${x.message}`).join("; ") || null,
        duration_ms: Date.now() - startedAt,
      });
    }

    const nowIso = new Date().toISOString();
    const row: GeodataRow = {
      egrid,
      status: result.status,
      data: result.data,
      links: result.links,
      errors: result.errors,
      fetched_at: result.anySuccess ? nowIso : (stored?.fetched_at ?? null),
      last_attempt_at: nowIso,
    };

    // Ohne je erhaltene Daten nichts speichern: fetched_at dürfte sonst keinen Stand vortäuschen.
    if (row.fetched_at) {
      const { error } = await admin
        .from("project_geodata")
        .upsert({ project_id: project.id, ...row }, { onConflict: "project_id" });
      if (error && !isMissingSchema(error.message)) console.error(`Geodaten von Projekt ${project.id} nicht gespeichert:`, error.message);
    }

    // Bestand: nachgeschlagene Koordinate festhalten. Spalte fehlt ohne Migration, dann eben nicht.
    if (result.e !== null && result.n !== null && numberOrNull(project.lv95_e) === null) {
      const { error } = await admin.from("projects").update({ lv95_e: result.e, lv95_n: result.n }).eq("id", project.id);
      if (error && !isMissingSchema(error.message)) console.error(`Koordinate von Projekt ${project.id} nicht gespeichert:`, error.message);
    }

    return toResponse(row);
  } catch (e) {
    console.error(`Geodaten von Projekt ${project.id} nicht aktualisiert:`, e);
    return {
      status: "unavailable",
      data: EMPTY_GEODATA,
      errors: [{ source: "swisstopo", message: e instanceof Error ? e.message : String(e) }],
      links: buildLinks({ canton, egrid: project.egrid ?? null, e: null, n: null }),
      sources: GEODATA_SOURCES,
      fetched_at: null,
    };
  }
}

