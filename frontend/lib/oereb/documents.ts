/**
 * Dokumente aus dem ÖREB-Auszug eines Projekts: Kandidaten bestimmen und in `oereb_documents`
 * (global, je Gemeinde) festhalten. Der Titel- und Host-Filter läuft schon hier, damit nur
 * Dokumente als offen zählen, die wirklich einen Download brauchen. Fehlt die Tabelle
 * (Migration nicht eingespielt), heisst es `available: false`, nie Fehler.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSchema } from "../supabase/schema-errors";
import { getKey, localizedText } from "./adapters/generic";
import { findSuperseded } from "./document-decisions";
import { VERSION_COLUMNS, normalizeOfficialNumber } from "./document-versions";
import type { TextSketch } from "./text-measure";
import { repointAuthoritativeUploads } from "./upload-supersede";
import { reconcileVersions } from "./version-sync";
import {
  DEFAULT_IMPORT_FILTER,
  FAIL_CLOSED_FILTER,
  OLDER_VERSION_REASON,
  PRE_DOWNLOAD_REASONS,
  REVIEW_STATUS,
  contentRulesChanged,
  decidePreDownload,
  documentPriority,
  resolveFilterRules,
  scopeOf,
  stableJson,
  type ImportFilterRules,
} from "./import-filter";
import { isOerebSupportedCanton } from "./cantons";
import { PRESET_LANGUAGES } from "./service-quirks";
import { titleKey } from "./title-key";
import { SUPERSEDED_SCOPE } from "../norm-applies";

export interface OerebDocumentRow {
  id: string;
  canton: string;
  bfs_number: number;
  municipality: string;
  url: string;
  url_normalized: string;
  title: string;
  title_key: string;
  doc_type: string | null;
  theme_codes: string[];
  authority: string | null;
  status: string;
  reject_reason: string | null;
  reject_detail: string | null;
  filter_snapshot: unknown;
  scope: string | null;
  norm_id: string | null;
  bytes: number | null;
  chars: number | null;
  pdf_sha256: string | null;
  text_sha256: string | null;
  etag: string | null;
  last_modified: string | null;
  attempts: number;
  last_update_status: string | null;
  last_update_detail: string | null;
  last_seen_at?: string | null;
  last_checked_at: string | null;
  next_check_at: string;
  lock_until: string | null;
  // Ab Migration 20261107000001; davor fehlen die Felder.
  official_number?: string | null;
  article_run?: number | null;
  article_first?: number | null;
  article_hits?: number | null;
  stand_date?: string | null;
  text_sketch?: TextSketch | null;
  content_reason?: string | null;
  version_winner_id?: string | null;
  version_note?: string | null;
}

export interface DocumentCandidate {
  url: string;
  url_normalized: string;
  title: string;
  doc_type: string | null;
  authority: string | null;
  theme_codes: string[];
  official_number: string | null;
  /** Rohwert der amtlichen Nummer: Auch ohne Ziffern («Baureglement») sagt er etwas über die Geltung. */
  official_number_raw: string | null;
}

export interface ProjectDocumentState {
  available: boolean;
  canton: string;
  bfs: number | null;
  municipality: string;
  rules: ImportFilterRules;
  /** Alle Dokumente der Gemeinde. */
  all: OerebDocumentRow[];
  /** Davon im aktuellen Auszug dieses Projekts. */
  own: OerebDocumentRow[];
  currentUrls: Set<string>;
  pending: number;
  /** Normen, deren Zuweisung nach dem Fassungsvergleich neu zu berechnen ist. */
  changedNormIds?: string[];
}

// ── Rein: URL, Kandidaten, Fälligkeit ────────────────────────────────────────

/** Schema, Host klein, Fragment weg. Die Query bleibt: oerebdocs.zh.ch/getDoc?docid= braucht sie. */
export function normalizeDocumentUrl(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

interface ThemeLink {
  title?: string | null;
  url?: string | null;
  kind?: string | null;
  authority?: string | null;
  officialNumber?: string | null;
}
export interface ThemeRow {
  theme_code: string;
  concern?: string | null;
  law_links?: ThemeLink[] | null;
  raw?: unknown;
}

/** Alte Themen ohne `kind`: aus dem Rohauszug der Restriktion ableiten. */
function kindFromRaw(raw: unknown, url: string, lang: string): { kind: string | null; authority: string | null; officialNumber: string | null } {
  const list = getKey(raw, "LegalProvisions");
  for (const lp of Array.isArray(list) ? list : list ? [list] : []) {
    if (normalizeDocumentUrl(localizedText(getKey(lp, "TextAtWeb"), lang)) !== url) continue;
    const code = getKey(getKey(lp, "Type"), "Code");
    return {
      kind: typeof code === "string" ? code : null,
      authority: localizedText(getKey(getKey(lp, "ResponsibleOffice"), "Name"), lang),
      officialNumber: localizedText(getKey(lp, "OfficialNumber"), lang),
    };
  }
  return { kind: null, authority: null, officialNumber: null };
}

/** Eine Zeile je URL. Steht ein Dokument zugleich als Law und als Rechtsvorschrift, gilt Letzteres. */
export function collectCandidates(themes: ThemeRow[], lang = "de"): DocumentCandidate[] {
  const byUrl = new Map<string, DocumentCandidate>();
  for (const theme of themes) {
    if (theme.concern && theme.concern !== "affects") continue;
    for (const link of theme.law_links ?? []) {
      const normalized = normalizeDocumentUrl(link.url);
      if (!normalized) continue;
      let kind = link.kind ?? null;
      let authority = link.authority ?? null;
      let officialNumber = link.officialNumber ?? null;
      // Auszüge von vor der Durchreichung tragen die Nummer nur im Rohauszug.
      if (!kind || !officialNumber) {
        const derived = kindFromRaw(theme.raw, normalized, lang);
        kind = kind ?? derived.kind;
        authority = authority ?? derived.authority;
        officialNumber = officialNumber ?? derived.officialNumber;
      }
      const number = normalizeOfficialNumber(officialNumber);
      const existing = byUrl.get(normalized);
      if (existing) {
        if (!existing.theme_codes.includes(theme.theme_code)) existing.theme_codes.push(theme.theme_code);
        if (kind === "LegalProvision") existing.doc_type = kind;
        if (!existing.authority) existing.authority = authority;
        if (!existing.official_number) existing.official_number = number;
        if (!existing.official_number_raw) existing.official_number_raw = officialNumber;
        continue;
      }
      byUrl.set(normalized, {
        url: (link.url ?? "").trim(),
        url_normalized: normalized,
        title: (link.title ?? "").trim() || normalized,
        doc_type: kind,
        authority,
        theme_codes: [theme.theme_code],
        official_number: number,
        official_number_raw: officialNumber,
      });
    }
  }
  return Array.from(byUrl.values());
}

/**
 * Fällig oder gerade in Arbeit. next_check_at wird schon beim Sperren vorgeschoben: Ein Dokument,
 * das die Funktion zum Absturz bringt, zählt also bis zum Backoff nicht mehr als offen.
 */
export function isDocumentDue(
  doc: { status: string; next_check_at: string; lock_until?: string | null; reject_reason?: string | null },
  nowMs: number
): boolean {
  // Eine abgelehnte ältere Fassung kann sich ändern und wird deshalb selten nachgeprüft.
  const olderVersion = doc.status === "rejected" && doc.reject_reason === OLDER_VERSION_REASON;
  if (doc.status !== "pending" && doc.status !== "imported" && doc.status !== "failed" && !olderVersion) return false;
  if (doc.lock_until && Date.parse(doc.lock_until) > nowMs) return true;
  return Date.parse(doc.next_check_at) <= nowMs;
}

/** Bund und Kanton sind nicht gemeint: Der Deckel gilt nur Änderungserlassen auf Gemeindeebene. */
export function isCapped(
  doc: { title: string; scope?: string | null },
  all: { status: string; scope: string | null }[],
  rules: ImportFilterRules
): boolean {
  if (scopeOf(doc.title, rules) !== "municipal" || documentPriority(doc.title, rules) === 0) return false;
  return all.filter((d) => d.status === "imported" && d.scope === "municipal").length >= rules.max_accepted_per_municipality;
}

/**
 * Gemeinde und Kanton aus dem amtlichen Auszug. Nie aus dem Projekt: Der Nutzer kann dort Kanton
 * und Gemeinde frei wählen, global geschriebene Normen dürfen davon nicht abhängen.
 */
export function officialIdentity(
  extract: { canton?: unknown; raw?: unknown } | null | undefined
): { canton: string; bfs: number; municipality: string } | null {
  const canton = String(extract?.canton ?? "").trim().toUpperCase();
  if (!isOerebSupportedCanton(canton)) return null;
  const realEstate = getKey(extract?.raw, "RealEstate");
  const bfs = Number(getKey(realEstate, "MunicipalityCode"));
  const municipality = localizedText(getKey(realEstate, "MunicipalityName", "Municipality"), PRESET_LANGUAGES[canton] ?? "de");
  if (!Number.isInteger(bfs) || bfs <= 0 || !municipality) return null;
  return { canton, bfs, municipality };
}

/** Erst Haupterlasse, dann Änderungen, dann neutrale Titel; Neues vor Nachprüfungen. */
export function orderDueDocuments<T extends { title: string; status: string }>(docs: T[], rules: ImportFilterRules): T[] {
  const rank = (d: T) => documentPriority(d.title, rules) + (d.status === "pending" ? 0 : 10);
  return docs.slice().sort((a, b) => rank(a) - rank(b));
}

// ── Filterregeln aus der Datenbank (5 Minuten im Speicher) ───────────────────

const FILTER_CACHE_MS = 5 * 60_000;
const filterCache = new Map<string, { rules: ImportFilterRules; at: number }>();

export function resetImportFilterCache(): void {
  filterCache.clear();
}

/**
 * Der Stopp versagt nie offen: Ist die Tabelle nicht lesbar, wird nichts Neues importiert. Das Ergebnis
 * wird dann nicht gemerkt, damit die Störung nicht 5 Minuten nachwirkt.
 */
export async function loadImportFilter(admin: SupabaseClient, canton: string): Promise<ImportFilterRules> {
  const code = canton.toUpperCase();
  const cached = filterCache.get(code);
  if (cached && Date.now() - cached.at < FILTER_CACHE_MS) return cached.rules;
  const { data, error } = await admin
    .from("oereb_import_filters")
    .select("scope, rules, active")
    .in("scope", ["default", code]);
  if (error) {
    if (!isMissingSchema(error.message)) console.error("Importfilter nicht lesbar, es wird nichts Neues importiert:", error.message);
    return FAIL_CLOSED_FILTER;
  }
  const rules = resolveFilterRules(data ?? [], code);
  filterCache.set(code, { rules, at: Date.now() });
  return rules;
}

// ── Stand des Projekts ───────────────────────────────────────────────────────

const DOCUMENT_COLUMNS =
  "id, canton, bfs_number, municipality, url, url_normalized, title, title_key, doc_type, theme_codes, authority, status, " +
  "reject_reason, reject_detail, filter_snapshot, scope, norm_id, bytes, chars, pdf_sha256, text_sha256, etag, last_modified, " +
  "attempts, last_update_status, last_update_detail, last_seen_at, last_checked_at, next_check_at, lock_until";
const VERSION_DOCUMENT_COLUMNS =
  "official_number, article_run, article_first, article_hits, stand_date, content_reason, version_winner_id, version_note";

async function loadMunicipalityDocuments(
  admin: SupabaseClient,
  canton: string,
  bfs: number
): Promise<{ rows: OerebDocumentRow[]; missing: boolean }> {
  // Ohne Textskizze: Die wird nur für einen anstehenden Vergleich nachgeladen.
  const query = (columns: string) => admin.from("oereb_documents").select(columns).eq("canton", canton).eq("bfs_number", bfs);
  let { data, error } = await query(`${DOCUMENT_COLUMNS}, ${VERSION_DOCUMENT_COLUMNS}`);
  // Vor Migration 20261107000001 fehlen die Messspalten.
  if (error && isMissingSchema(error.message)) ({ data, error } = await query(DOCUMENT_COLUMNS));
  if (error) {
    if (isMissingSchema(error.message)) return { rows: [], missing: true };
    throw new Error(`ÖREB-Dokumente konnten nicht gelesen werden: ${error.message}`);
  }
  return { rows: (data ?? []) as unknown as OerebDocumentRow[], missing: false };
}

function unavailable(canton: string, municipality: string, rules: ImportFilterRules): ProjectDocumentState {
  return { available: false, canton, bfs: null, municipality, rules, all: [], own: [], currentUrls: new Set(), pending: 0 };
}

/**
 * Alte Fassung ausser Kraft setzen: Die Norm bleibt für den Nachvollzug bestehen (vergangene Analysen,
 * norm_versions), gilt aber nicht mehr. Von Hand zugewiesene Zeilen bleiben. Eine inzwischen manuell
 * gepflegte Norm wird nie angefasst.
 */
async function retireSuperseded(
  admin: SupabaseClient,
  all: OerebDocumentRow[],
  currentUrls: Set<string>,
  rules: ImportFilterRules,
  nowMs: number
): Promise<void> {
  for (const { oldDocId, oldNormId, newDocId } of findSuperseded(all, currentUrls, nowMs, rules.supersede_after_days)) {
    const { data, error } = await admin
      .from("norms")
      .update({ auto_scope: SUPERSEDED_SCOPE })
      .eq("id", oldNormId)
      .eq("source_kind", "oereb_auto")
      .select("id");
    if (error) {
      console.error(`Norm ${oldNormId} nicht abgelöst:`, error.message);
      continue;
    }
    if (!data?.length) continue;
    const newNormId = all.find((d) => d.id === newDocId)?.norm_id;
    if (newNormId) await repointAuthoritativeUploads(admin, oldNormId, newNormId);
    const { error: linkError } = await admin
      .from("project_norms")
      .delete()
      .eq("norm_id", oldNormId)
      .in("added_by", ["system", "oereb"]);
    if (linkError) console.error(`Zuweisungen der Norm ${oldNormId} nicht entfernt:`, linkError.message);
    const patch = {
      status: "rejected",
      reject_reason: "superseded",
      reject_detail: `Abgelöst durch ${newDocId}`,
      last_checked_at: new Date(nowMs).toISOString(),
    };
    const { error: docError } = await admin.from("oereb_documents").update(patch).eq("id", oldDocId);
    if (docError) console.error(`ÖREB-Dokument ${oldDocId} nicht abgelöst:`, docError.message);
    else Object.assign(all.find((d) => d.id === oldDocId) ?? {}, patch);
  }
}

/**
 * Hält die Dokumente aus dem aktuellen Auszug des Projekts fest und gibt den Stand zurück.
 * Abgelehnte Dokumente werden neu beurteilt, sobald sich die Filterregeln geändert haben: Sonst
 * bliebe eine nachgetragene Datenzeile (etwa ein Host) für bekannte Dokumente wirkungslos.
 */
export async function syncProjectDocuments(admin: SupabaseClient, projectId: string): Promise<ProjectDocumentState> {
  // server_fetched_at setzt nur der Server (Migration: kein Client-Schreibrecht). Ein Auszug ohne
  // diesen Stempel stammt aus der Zeit, als Clients schreiben durften, und speist keinen Import.
  const { data: extract, error: extractError } = await admin
    .from("oereb_extracts")
    .select("id, status, canton, raw, server_fetched_at")
    .eq("project_id", projectId)
    .maybeSingle();
  if (extractError) {
    if (isMissingSchema(extractError.message)) return unavailable("", "", DEFAULT_IMPORT_FILTER);
    throw new Error(`ÖREB-Auszug konnte nicht gelesen werden: ${extractError.message}`);
  }

  const official = extract && extract.status === "ok" && extract.server_fetched_at ? officialIdentity(extract) : null;
  if (!official) {
    if (extract?.status === "ok") console.warn(`Projekt ${projectId}: Auszug ohne Herkunftsnachweis oder Gemeinde, ÖREB-Dokumente werden übersprungen`);
    const { error } = await admin.from("oereb_documents").select("id").limit(1);
    if (error && isMissingSchema(error.message)) return unavailable("", "", DEFAULT_IMPORT_FILTER);
    return { available: true, canton: "", bfs: null, municipality: "", rules: DEFAULT_IMPORT_FILTER, all: [], own: [], currentUrls: new Set(), pending: 0 };
  }

  const { canton, bfs, municipality } = official;
  // Gesehen heisst: Ein Abruf beim Kanton hat das Dokument geliefert. Blosses Öffnen eines Projekts
  // zählt nicht, sonst bliebe eine aufgehobene Fassung über alte Auszüge ewig «aktuell».
  const fetchedAt = String(extract?.server_fetched_at);
  const rules = await loadImportFilter(admin, canton);
  const lang = PRESET_LANGUAGES[canton] ?? "de";
  const base = { available: true, canton, bfs, municipality, rules };

  const { data: themeRows, error: themeError } = await admin
    .from("oereb_themes")
    .select("theme_code, concern, law_links, raw")
    .eq("extract_id", extract?.id)
    .eq("concern", "affects");
  if (themeError) throw new Error(`ÖREB-Themen konnten nicht gelesen werden: ${themeError.message}`);
  const candidates = collectCandidates((themeRows ?? []) as ThemeRow[], lang);

  const first = await loadMunicipalityDocuments(admin, canton, bfs);
  if (first.missing) return unavailable(canton, municipality, rules);

  const currentUrls = new Set(candidates.map((c) => c.url_normalized));
  const known = new Set(first.rows.map((r) => r.url_normalized));
  const nowIso = new Date().toISOString();

  const fresh = candidates.filter((c) => !known.has(c.url_normalized));
  if (fresh.length) {
    const rows = fresh.map((c) => {
        const rejection = decidePreDownload(
          { title: c.title, doc_type: c.doc_type, authority: c.authority, url: c.url_normalized },
          rules,
          canton
        );
        return {
          canton,
          bfs_number: bfs,
          municipality,
          url: c.url,
          url_normalized: c.url_normalized,
          title: c.title,
          title_key: titleKey(c.title, municipality),
          doc_type: c.doc_type,
          theme_codes: c.theme_codes,
          authority: c.authority,
          status: rejection ? "rejected" : "pending",
          reject_reason: rejection?.reason ?? null,
          reject_detail: rejection?.detail ?? null,
          filter_snapshot: rules,
          scope: scopeOf(c.title, rules, c.official_number_raw),
          next_check_at: nowIso,
          last_seen_at: fetchedAt,
          official_number: c.official_number,
        };
    });
    const conflict = { onConflict: "canton,bfs_number,url_normalized", ignoreDuplicates: true };
    let { error } = await admin.from("oereb_documents").upsert(rows, conflict);
    // Vor Migration 20261107000001 fehlt die Spalte: Der Import darf daran nicht hängen bleiben.
    if (error && isMissingSchema(error.message)) {
      ({ error } = await admin.from("oereb_documents").upsert(rows.map(({ official_number: _unused, ...row }) => row), conflict));
    }
    if (error) throw new Error(`ÖREB-Dokumente konnten nicht gespeichert werden: ${error.message}`);
  }

  const { rows: all, missing } = fresh.length ? await loadMunicipalityDocuments(admin, canton, bfs) : first;
  if (missing) return unavailable(canton, municipality, rules);

  const own = all.filter((r) => currentUrls.has(r.url_normalized));
  const unseen = own.filter((r) => !r.last_seen_at || Date.parse(r.last_seen_at) < Date.parse(fetchedAt));
  if (unseen.length) {
    const { error } = await admin
      .from("oereb_documents")
      .update({ last_seen_at: fetchedAt })
      .in("id", unseen.map((r) => r.id));
    if (error) console.error("last_seen_at nicht aktualisiert:", error.message);
    else unseen.forEach((r) => { r.last_seen_at = fetchedAt; });
  }

  const rulesJson = stableJson(rules);
  // Filter nicht lesbar: Bestehendes bleibt, wie es ist. Nur Neues wird nicht importiert.
  const failClosed = rules === FAIL_CLOSED_FILTER;
  const candidateByUrl = new Map(candidates.map((c) => [c.url_normalized, c]));
  for (const row of own) {
    const patch: Partial<OerebDocumentRow> = {};

    const codes = candidateByUrl.get(row.url_normalized)?.theme_codes ?? [];
    const merged = Array.from(new Set([...(row.theme_codes ?? []), ...codes]));
    if (merged.length !== (row.theme_codes ?? []).length) patch.theme_codes = merged;

    const candidate = candidateByUrl.get(row.url_normalized);
    const officialNumber = candidate?.official_number ?? null;
    const hasVersionColumns = VERSION_COLUMNS[0] in row;
    if (hasVersionColumns && officialNumber && row.official_number !== officialNumber) patch.official_number = officialNumber;

    // Nur Titel- und Host-Gründe: Inhaltlich abgelehnte PDFs werden nicht wegen einer Regeländerung
    // neu geladen. Der Deckel ist nie endgültig: Sobald er nicht mehr greift, wird neu beurteilt.
    const reconsider =
      !failClosed &&
      (row.status === "pending" || (row.status === "rejected" && PRE_DOWNLOAD_REASONS.has(row.reject_reason ?? ""))) &&
      stableJson(row.filter_snapshot) !== rulesJson;
    // Ein Abruf nach der Ablösung liefert die URL noch: Sie war doch nicht weg (Ortsteil ohne Projekte).
    const revive =
      row.status === "rejected" && row.reject_reason === "superseded" && !!row.norm_id &&
      Date.parse(fetchedAt) > Date.parse(row.last_checked_at ?? "1970-01-01");
    if (revive) {
      const { error } = await admin
        .from("norms")
        .update({ auto_scope: "municipal" })
        .eq("id", row.norm_id as string)
        .eq("source_kind", "oereb_auto")
        .eq("auto_scope", SUPERSEDED_SCOPE);
      if (error) console.error(`Norm ${row.norm_id} nicht reaktiviert:`, error.message);
      else {
        patch.status = "imported";
        patch.reject_reason = null;
        patch.reject_detail = null;
        patch.next_check_at = nowIso;
      }
    } else if (row.status === "rejected" && row.reject_reason === "cap_reached" && !isCapped(row, all, rules)) {
      patch.status = "pending";
      patch.reject_reason = null;
      patch.reject_detail = null;
      patch.filter_snapshot = rules;
      patch.next_check_at = nowIso;
    } else if (reconsider) {
      const rejection = decidePreDownload(
        { title: row.title, doc_type: row.doc_type, authority: row.authority, url: row.url_normalized },
        rules,
        canton
      );
      patch.status = rejection ? "rejected" : "pending";
      patch.reject_reason = rejection?.reason ?? null;
      patch.reject_detail = rejection?.detail ?? null;
      patch.filter_snapshot = rules;
      patch.scope = scopeOf(row.title, rules, candidate?.official_number_raw);
      if (!rejection) patch.next_check_at = nowIso;
    } else if (
      // Inhaltsgrund unter geänderten Regeln: fällig setzen, geladen wird einzeln beim nächsten Import-
      // Schritt. Nicht im Stopp und nicht bei Fehlern des Filters: Dann käme nichts dabei heraus.
      !failClosed &&
      rules.doc_types.length > 0 &&
      (row.status === "rejected" || row.status === REVIEW_STATUS) &&
      !row.norm_id &&
      contentRulesChanged(row.reject_reason, row.filter_snapshot, rules)
    ) {
      patch.status = "pending";
      patch.reject_reason = null;
      patch.reject_detail = null;
      patch.filter_snapshot = rules;
      patch.attempts = 0;
      patch.scope = scopeOf(row.title, rules, candidate?.official_number_raw);
      patch.next_check_at = nowIso;
    }

    if (Object.keys(patch).length === 0) continue;
    const { error } = await admin.from("oereb_documents").update(patch).eq("id", row.id);
    if (error) console.error(`ÖREB-Dokument ${row.id} nicht aktualisiert:`, error.message);
    else Object.assign(row, patch);
  }

  const now = Date.now();
  await retireSuperseded(admin, all, currentUrls, rules, now);
  // Vor der Migration fehlen die Messwerte: Dann gibt es nichts zu vergleichen.
  const changedNormIds = !failClosed && own.some((d) => VERSION_COLUMNS[0] in d)
    ? await reconcileVersions({ admin, own, all, rules, canton, municipality, bfs, nowMs: now })
    : [];
  return { ...base, all, own, currentUrls, changedNormIds, pending: own.filter((d) => isDocumentDue(d, now)).length };
}
