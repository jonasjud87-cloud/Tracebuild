import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingSchema } from "@/lib/supabase/schema-errors";
import type { ParcelCandidate } from "@/lib/geoadmin/contract";
import type { ExtractStatus, OerebExtract, OerebTheme, ZoneResult } from "./types";
import { OerebError } from "./errors";
import { getAdapter } from "./registry";

export interface FetchExtractResult {
  status: ExtractStatus;
  statusDetail: string | null;
  egrid: string | null;
  themeCount: number;
  affectsCount: number;
  noDataCount: number;
  zone: ZoneResult | null;
  /** Bei 'ambiguous': die Grundstücke zur Auswahl. */
  candidates?: ParcelCandidate[];
}

export interface FetchExtractOptions {
  /** Bekannte EGRID: die Parzellensuche entfällt. */
  egrid?: string | null;
  /** LV95-Koordinate: GetEGRID des Kantons statt Parzellensuche. */
  en?: [number, number] | null;
  bfs?: number | null;
  /** Gesamtbudget des Abrufs. */
  signal?: AbortSignal;
}

const THEME_INSERT_CHUNK = 100;

function summarize(status: ExtractStatus, detail: string | null, egrid: string | null): FetchExtractResult {
  return { status, statusDetail: detail, egrid, themeCount: 0, affectsCount: 0, noDataCount: 0, zone: null };
}

/**
 * Schreibt den Ergebnis-Datensatz (ein Auszug pro Projekt) und räumt die alten Themen
 * des Projekts weg. Gibt die id des Auszugs zurück.
 */
async function upsertExtractRow(
  projectId: string,
  row: {
    canton: string;
    egrid: string | null;
    identdn: string | null;
    parcel_number: string | null;
    status: ExtractStatus;
    status_detail: string | null;
    raw: unknown;
  },
  lastError: string | null
): Promise<string> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const base = { project_id: projectId, ...row, fetched_at: now };
  let { data, error } = await admin
    .from("oereb_extracts")
    .upsert(
      { ...base, last_attempt_at: now, last_error: lastError, ...(row.status === "ok" ? { server_fetched_at: now } : {}) },
      { onConflict: "project_id" }
    )
    .select("id")
    .single();
  // Geoportal-Migration noch nicht eingespielt → ohne die neuen Spalten.
  if (error && isMissingSchema(error.message)) {
    ({ data, error } = await admin.from("oereb_extracts").upsert(base, { onConflict: "project_id" }).select("id").single());
  }
  if (error || !data) throw new Error(`ÖREB-Auszug konnte nicht gespeichert werden: ${error?.message ?? "keine id"}`);

  const { error: delErr } = await admin.from("oereb_themes").delete().eq("extract_id", data.id);
  if (delErr) throw new Error(`Alte ÖREB-Themen konnten nicht entfernt werden: ${delErr.message}`);
  return data.id as string;
}

function themeRows(themes: OerebTheme[]) {
  return themes.map((t) => ({
    theme_code: t.themeCode,
    theme_name: t.themeName,
    sub_theme: t.subTheme,
    concern: t.concern,
    legal_status: t.legalStatus,
    area_pct: t.areaPct,
    area_m2: t.areaM2,
    type_code: t.typeCode,
    legend_text: t.legendText,
    law_links: t.lawLinks,
    authority: t.authority,
    raw: t.raw ?? null,
  }));
}

async function insertThemes(extractId: string, themes: OerebTheme[]): Promise<void> {
  const admin = createAdminClient();
  const rows = themeRows(themes).map((r) => ({ extract_id: extractId, ...r }));
  for (let i = 0; i < rows.length; i += THEME_INSERT_CHUNK) {
    const { error } = await admin.from("oereb_themes").insert(rows.slice(i, i + THEME_INSERT_CHUNK));
    if (error) throw new Error(`ÖREB-Themen konnten nicht gespeichert werden: ${error.message}`);
  }
}

/**
 * Ersetzt Auszug und Themen atomar über die RPC. Fehlt die Funktion (Migration nicht
 * eingespielt), bleibt es beim bisherigen Weg in zwei Schritten.
 */
async function replaceExtract(
  projectId: string,
  row: { canton: string; egrid: string; identdn: string | null; parcel_number: string | null; raw: unknown },
  themes: OerebTheme[]
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("replace_oereb_extract", {
    p_project_id: projectId,
    p_extract: row,
    p_themes: themeRows(themes),
  });
  if (!error) return;
  if (error.code !== "PGRST202" && !isMissingSchema(error.message)) {
    throw new Error(`ÖREB-Auszug konnte nicht gespeichert werden: ${error.message}`);
  }
  const extractId = await upsertExtractRow(projectId, { ...row, status: "ok", status_detail: null }, null);
  await insertThemes(extractId, themes);
}

/**
 * Überträgt die ÖREB-Zone ins Projekt — ausser der Nutzer hat die Bauzone von Hand
 * gesetzt (zone_source = 'manual'); dann gilt seine Angabe (Entscheidung 1).
 * Auch 'low' wird mit dem Kandidaten geschrieben: Die UI zeigt «unsicher, bitte prüfen».
 * Ohne ermittelbare Zone bleibt das Projekt unverändert.
 */
async function applyZone(projectId: string, zone: ZoneResult): Promise<void> {
  if (!zone.zone || zone.confidence === "none") return;
  const admin = createAdminClient();
  const { data: project, error } = await admin
    .from("projects")
    .select("zone_source")
    .eq("id", projectId)
    .single();
  if (error) throw new Error(`Projekt konnte nicht gelesen werden: ${error.message}`);
  if (project?.zone_source === "manual") return;

  const { error: updErr } = await admin
    .from("projects")
    .update({ bauzone: zone.zone, zone_source: "oereb", zone_confidence: zone.confidence })
    .eq("id", projectId);
  if (updErr) throw new Error(`Bauzone konnte nicht gespeichert werden: ${updErr.message}`);
}

/** Ergänzt EGRID, BFS und (falls leer) Koordinaten im Projekt. Fehlende Spalten sind kein Fehler. */
async function enrichProject(
  projectId: string,
  egrid: string,
  bfs: number | null | undefined,
  position: { e: number | null; n: number | null } | null
): Promise<void> {
  const admin = createAdminClient();
  const updates: Record<string, unknown> = { egrid };
  if (bfs !== null && bfs !== undefined) updates.bfs_number = bfs;
  const { error } = await admin.from("projects").update(updates).eq("id", projectId);
  if (error) {
    if (!isMissingSchema(error.message)) console.error(`EGRID für Projekt ${projectId} nicht gespeichert:`, error.message);
    return;
  }
  if (position?.e === null || position?.e === undefined || position.n === null) return;
  const { error: posErr } = await admin
    .from("projects")
    .update({ lv95_e: position.e, lv95_n: position.n })
    .eq("id", projectId)
    .is("lv95_e", null);
  if (posErr && !isMissingSchema(posErr.message)) {
    console.error(`Koordinaten für Projekt ${projectId} nicht gespeichert:`, posErr.message);
  }
}

/** Letzten Versuch am gültigen Auszug festhalten. Fehlende Spalten sind kein Fehler. */
async function noteAttempt(projectId: string, lastError: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("oereb_extracts")
    .update({ last_attempt_at: new Date().toISOString(), last_error: lastError })
    .eq("project_id", projectId);
  if (error && !isMissingSchema(error.message)) {
    console.error(`ÖREB-Versuch für Projekt ${projectId} nicht festgehalten:`, error.message);
  }
}

/**
 * Hält einen Fehlschlag fest — aber nie auf Kosten eines gültigen Auszugs: Liegt für
 * das Projekt bereits ein 'ok'-Auszug, bleibt er samt Themen stehen (ein temporärer
 * Ausfall des Dienstes darf keine Daten löschen). Der Fehler wird dann nur im
 * Rückgabewert und in last_error gemeldet. Soll ein alter Auszug bewusst weg (Parzelle
 * gewechselt), vorher invalidateExtract() aufrufen.
 */
async function persistFailure(
  projectId: string,
  canton: string,
  parcelNumber: string | null,
  egrid: string | null,
  status: ExtractStatus,
  detail: string
): Promise<FetchExtractResult> {
  try {
    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("oereb_extracts")
      .select("status")
      .eq("project_id", projectId)
      .maybeSingle();
    if (existing?.status === "ok") {
      console.warn(`ÖREB-Abruf für Projekt ${projectId} fehlgeschlagen (${status}: ${detail}); gültiger Auszug bleibt erhalten`);
      await noteAttempt(projectId, detail);
      return summarize(status, detail, egrid);
    }

    await upsertExtractRow(projectId, {
      canton,
      egrid,
      identdn: null,
      parcel_number: parcelNumber,
      status,
      status_detail: detail,
      raw: null,
    }, detail);
  } catch (e) {
    console.error(`ÖREB-Fehlerstatus für Projekt ${projectId} konnte nicht gespeichert werden:`, e);
  }
  return summarize(status, detail, egrid);
}

/**
 * Entfernt den Auszug eines Projekts (Themen hängen per CASCADE daran). Nötig, wenn
 * Parzelle oder Standort wechseln — der alte Auszug gehört dann zu einem anderen
 * Grundstück und darf nicht als 'ok' stehen bleiben. Eine daraus abgeleitete Zone ebenso wenig,
 * auch wenn der neue Abruf nichts liefert; eine manuelle Zone bleibt. Wirft nie.
 */
export async function invalidateExtract(projectId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("oereb_extracts").delete().eq("project_id", projectId);
  // Tabelle fehlt (Migration nicht eingespielt) → nichts zu invalidieren.
  if (error && !/oereb_extracts/.test(error.message)) {
    console.error(`ÖREB-Auszug für Projekt ${projectId} konnte nicht entfernt werden:`, error.message);
  }
  const { error: zoneError } = await admin
    .from("projects")
    .update({ bauzone: null, zone_source: null, zone_confidence: null })
    .eq("id", projectId)
    .eq("zone_source", "oereb");
  if (zoneError && !zoneError.message.includes("zone_source")) {
    console.error(`Bauzone für Projekt ${projectId} nicht zurückgesetzt:`, zoneError.message);
  }
}

/**
 * Bestand: Ein Auszug ohne bekannte EGRID stammt aus der alten Parzellensuche und kann das
 * falsche Grundstück sein (SH, VS). Ist die Parzelle mehrdeutig, darf er nicht stehen bleiben,
 * und eine daraus abgeleitete Zone ebenso wenig. Wirft nie.
 */
async function discardUnverifiedExtract(projectId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const [{ data: project }, { data: existing }] = await Promise.all([
      admin.from("projects").select("*").eq("id", projectId).maybeSingle(),
      admin.from("oereb_extracts").select("status").eq("project_id", projectId).maybeSingle(),
    ]);
    if (existing?.status !== "ok" || project?.egrid) return;

    await invalidateExtract(projectId);
  } catch (e) {
    console.error(`Alter ÖREB-Auszug für Projekt ${projectId} konnte nicht geprüft werden:`, e);
  }
}

/**
 * Leitet die Bauzone aus dem bereits gespeicherten Auszug erneut ab und schreibt sie
 * ins Projekt (respektiert 'manual'). Für den Fall, dass der Nutzer die Zone leert:
 * Der Auszug ist noch gültig, ein neuer Abruf wäre unnötig. Gibt die Zone zurück,
 * null wenn kein 'ok'-Auszug vorliegt. Wirft nie.
 */
export async function reapplyZoneFromStoredExtract(projectId: string): Promise<ZoneResult | null> {
  try {
    const admin = createAdminClient();
    const { data: extract, error } = await admin
      .from("oereb_extracts")
      .select("id, canton, egrid, identdn, parcel_number, status")
      .eq("project_id", projectId)
      .maybeSingle();
    if (error || !extract || extract.status !== "ok") return null;

    const adapter = getAdapter(extract.canton);
    if (!adapter) return null;

    const { data: rows, error: thErr } = await admin
      .from("oereb_themes")
      .select("theme_code, theme_name, sub_theme, concern, legal_status, area_pct, area_m2, type_code, legend_text, law_links, authority")
      .eq("extract_id", extract.id);
    if (thErr) return null;

    const themes: OerebTheme[] = (rows ?? []).map((r) => ({
      themeCode: r.theme_code,
      themeName: r.theme_name,
      subTheme: r.sub_theme,
      concern: r.concern,
      legalStatus: r.legal_status,
      areaPct: r.area_pct,
      areaM2: r.area_m2,
      typeCode: r.type_code,
      legendText: r.legend_text,
      lawLinks: r.law_links ?? [],
      authority: r.authority,
      raw: null,
    }));
    const zone = adapter.extractZone({
      canton: extract.canton,
      egrid: extract.egrid,
      identDn: extract.identdn,
      parcelNumber: extract.parcel_number,
      municipality: null,
      themes,
      raw: null,
    });
    await applyZone(projectId, zone);
    return zone;
  } catch (e) {
    console.error(`Bauzone für Projekt ${projectId} konnte nicht aus dem Auszug abgeleitet werden:`, e);
    return null;
  }
}

function statusOf(e: unknown): { status: ExtractStatus; detail: string } {
  if (e instanceof OerebError) return { status: e.status, detail: e.message };
  return { status: "unreachable", detail: e instanceof Error ? e.message : String(e) };
}

/**
 * Holt den ÖREB-Auszug eines Grundstücks und legt ihn für das Projekt ab:
 *   Adapter → EGRID → Auszug → oereb_extracts + oereb_themes → Zone und EGRID ins Projekt.
 *
 * Mit `egrid` entfällt die Suche, mit `en` fragt der Adapter das GetEGRID des Kantons.
 *
 * Wirft nie nach aussen: jeder Fehlerfall wird als status/status_detail im Auszugs-
 * Datensatz festgehalten und im Ergebnis zurückgegeben.
 */
export async function fetchAndPersistExtract(
  projectId: string,
  canton: string,
  municipality: string,
  parcelNumber: string,
  opts: FetchExtractOptions = {}
): Promise<FetchExtractResult> {
  const cantonCode = (canton ?? "").trim().toUpperCase();
  const parcel = (parcelNumber ?? "").trim() || null;
  const place = (municipality ?? "").trim();
  const { signal, en } = opts;
  const bfs = opts.bfs ?? undefined;

  const adapter = getAdapter(cantonCode);
  if (!adapter) {
    return persistFailure(projectId, cantonCode || "?", parcel, null, "no_cadastre",
      `Für Kanton ${cantonCode || "(leer)"} ist kein ÖREB-Dienst bekannt`);
  }

  // 1. EGRID
  let egrid = opts.egrid?.trim().toUpperCase() || null;
  let position: { e: number | null; n: number | null } | null = null;
  if (!egrid) {
    if (!en && !parcel) {
      return persistFailure(projectId, cantonCode, null, null, "no_egrid", "Keine Parzellennummer hinterlegt");
    }
    if (!en && !place && bfs === undefined) {
      return persistFailure(projectId, cantonCode, parcel, null, "no_egrid", "Keine Gemeinde hinterlegt");
    }
    let resolved;
    try {
      resolved = await adapter.resolveEgrid({
        municipality: place,
        parcelNumber: parcel ?? "",
        bfsNumber: bfs,
        en: en ?? undefined,
        signal,
      });
    } catch (e) {
      const { status, detail } = statusOf(e);
      return persistFailure(projectId, cantonCode, parcel, null, status, detail);
    }
    if (resolved.egrids.length === 0) {
      return persistFailure(projectId, cantonCode, parcel, null, "no_egrid",
        `Kein Grundstück Nr. ${parcel ?? "?"} in ${place || "?"} (${cantonCode}) gefunden`);
    }
    if (resolved.egrids.length > 1) {
      await discardUnverifiedExtract(projectId);
      const result = await persistFailure(projectId, cantonCode, parcel, null, "ambiguous",
        `Mehrere Grundstücke zu Nr. ${parcel ?? "?"} in ${place || "?"}: ${resolved.egrids.join(", ")}`);
      return { ...result, candidates: resolved.candidates };
    }
    egrid = resolved.egrids[0];
    position = resolved.candidates[0] ?? null;
  }

  // 2. Auszug
  let extract: OerebExtract;
  try {
    extract = await adapter.getExtract(egrid, { signal });
  } catch (e) {
    const { status, detail } = statusOf(e);
    return persistFailure(projectId, cantonCode, parcel, egrid, status, detail);
  }

  // 3. Persistieren + Zone
  const zone = adapter.extractZone(extract);
  try {
    await replaceExtract(projectId, {
      canton: extract.canton || cantonCode,
      egrid: extract.egrid,
      identdn: extract.identDn,
      parcel_number: extract.parcelNumber ?? parcel,
      raw: extract.raw ?? null,
    }, extract.themes);
    await applyZone(projectId, zone);
    await enrichProject(projectId, extract.egrid, extract.bfsNumber ?? bfs, position);
  } catch (e) {
    const { status, detail } = statusOf(e);
    return persistFailure(projectId, cantonCode, parcel, egrid, status, detail);
  }

  return {
    status: "ok",
    statusDetail: null,
    egrid: extract.egrid,
    themeCount: extract.themes.length,
    affectsCount: extract.themes.filter((t) => t.concern === "affects").length,
    noDataCount: extract.themes.filter((t) => t.concern === "no_data").length,
    zone,
  };
}
