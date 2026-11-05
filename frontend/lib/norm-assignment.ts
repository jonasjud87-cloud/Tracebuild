import { createAdminClient } from "@/lib/supabase/admin";
import { matchOerebNorms, oerebTrigger, type OerebGap } from "@/lib/oereb/mapping";
import { isMissingSchema } from "@/lib/supabase/schema-errors";
import { collectCandidates, type ThemeRow } from "@/lib/oereb/documents";
import {
  applies,
  normsForThemeMapping,
  isAutoNorm,
  withoutShadowedAutoNorms,
  type ApplicableNorm,
  type ProjectPlace,
} from "@/lib/norm-applies";

interface NormRow extends ApplicableNorm {
  org_id: string | null;
  category: string | null;
  source_url?: string | null;
}

/** Ergebnis einer Zuweisung — ein Einstiegspunkt (`assignNorms`) für alle Aufrufer. */
export interface AssignmentResult {
  /** Automatisch verknüpfte Normen nach dem Sync (system ∪ oereb, ohne manuelle). */
  total: number;
  /** Normen, die über Bund/Kanton/Gemeinde/Org gelten. */
  systemAssigned: number;
  /** Normen, die (zusätzlich) nur über ein ÖREB-Thema gelten. */
  oerebAssigned: number;
  /** Betroffene ÖREB-Themen ohne passende Norm. */
  gaps: OerebGap[];
  /** Grund, wenn der ÖREB-Durchgang nicht laufen konnte (z.B. Migration fehlt); sonst null. */
  oerebSkipped: string | null;
}

/** Kandidaten: Normen der Org plus plattformweite Normen (org_id IS NULL), je Domäne. */
async function loadCandidateNorms(orgId: string, domain: string): Promise<NormRow[]> {
  const admin = createAdminClient();
  const base = "id, title, layer, jurisdiction_type, jurisdiction_name, org_id, category";
  const query = (select: string) =>
    admin.from("norms").select(select).eq("domain", domain).or(`org_id.eq.${orgId},org_id.is.null`);
  let { data, error } = await query(`${base}, source_kind, auto_scope, jurisdiction_canton, jurisdiction_bfs, source_url`);
  // Ohne Geoportal-Migration fehlen die neuen Spalten.
  if (error && isMissingSchema(error.message)) ({ data, error } = await query(base));
  if (error) throw new Error(`Normen konnten nicht gelesen werden: ${error.message}`);
  return withoutShadowedAutoNorms((data ?? []) as unknown as NormRow[]);
}

/** Ort des Projekts; bfs_number gibt es erst nach der Migration, deshalb select("*"). */
async function loadProjectPlace(projectId: string): Promise<ProjectPlace> {
  const admin = createAdminClient();
  const { data } = await admin.from("projects").select("*").eq("id", projectId).maybeSingle();
  const location = (data?.location ?? {}) as { canton?: string; municipality?: string };
  return {
    canton: location.canton ?? "",
    municipality: location.municipality ?? "",
    bfs: (data?.bfs_number as number | null | undefined) ?? null,
  };
}

/**
 * Objektbezogene importierte Vorschriften, deren Dokument im aktuellen Auszug steht.
 * norm_id → Auslöser 'oereb-doc:<document_id>'. Fällt die URL weg, entfernt syncOerebRows die Zeile.
 */
async function parcelDocumentTriggers(norms: NormRow[], themes: ThemeRow[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const urls = new Set(collectCandidates(themes).map((c) => c.url_normalized));
  const ids = norms
    .filter((n) => isAutoNorm(n) && n.auto_scope === "parcel" && !!n.source_url && urls.has(n.source_url))
    .map((n) => n.id);
  if (!ids.length) return out;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("oereb_documents")
    .select("id, norm_id, url_normalized")
    .in("norm_id", ids)
    .eq("status", "imported");
  if (error) {
    if (!isMissingSchema(error.message)) throw new Error(`ÖREB-Dokumente konnten nicht gelesen werden: ${error.message}`);
    return out;
  }
  for (const row of data ?? []) {
    if (urls.has(row.url_normalized as string)) out.set(row.norm_id as string, `oereb-doc:${row.id}`);
  }
  return out;
}

export interface OerebAssignmentPlan {
  /** false, wenn der Durchgang nicht möglich ist — `reason` sagt warum. */
  available: boolean;
  reason: string | null;
  /** norm_id → Themencodes, über die die Norm greift. */
  wanted: Map<string, string[]>;
  /** norm_id → Auslöser für Normen, die über ein Dokument im Auszug greifen (auto_scope='parcel'). */
  documentTriggers: Map<string, string>;
  gaps: OerebGap[];
  /** Anzahl betroffener Themen (dedupliziert nach Code). */
  affectedThemeCount: number;
}

/**
 * Nur lesend: welche Normen greifen über den ÖREB-Auszug des Projekts, und wo bleiben
 * Lücken. Wird von `assignNorms` (schreibend) und von GET …/oereb (Anzeige) genutzt.
 *
 * Ohne Auszug bzw. mit Auszug im Fehlerstatus gibt es nichts zu mappen: `wanted` ist
 * leer und `available` bleibt true — bestehende 'oereb'-Zeilen werden dann entfernt.
 */
export async function planOerebAssignment(
  projectId: string,
  orgId: string,
  domain: string,
  candidateNorms?: NormRow[],
  knownPlace?: ProjectPlace
): Promise<OerebAssignmentPlan> {
  const admin = createAdminClient();
  const empty = (available: boolean, reason: string | null): OerebAssignmentPlan =>
    ({ available, reason, wanted: new Map(), documentTriggers: new Map(), gaps: [], affectedThemeCount: 0 });

  const { data: extract, error: exErr } = await admin
    .from("oereb_extracts")
    .select("id, status")
    .eq("project_id", projectId)
    .maybeSingle();
  if (exErr) {
    if (isMissingSchema(exErr.message)) {
      return empty(false, "ÖREB-Tabellen fehlen (Migration 20260902000001_oereb.sql nicht eingespielt)");
    }
    throw new Error(`ÖREB-Auszug konnte nicht gelesen werden: ${exErr.message}`);
  }
  if (!extract) return empty(true, "Kein ÖREB-Auszug vorhanden");
  if (extract.status !== "ok") return empty(true, `ÖREB-Auszug im Status '${extract.status}'`);

  const { data: themes, error: thErr } = await admin
    .from("oereb_themes")
    .select("theme_code, theme_name, concern, law_links")
    .eq("extract_id", extract.id)
    .eq("concern", "affects");
  if (thErr) throw new Error(`ÖREB-Themen konnten nicht gelesen werden: ${thErr.message}`);

  const { data: mappings, error: mapErr } = await admin
    .from("oereb_theme_mappings")
    .select("theme_code, category_pattern")
    .eq("active", true)
    .or(`org_id.eq.${orgId},org_id.is.null`);
  if (mapErr) throw new Error(`ÖREB-Mappings konnten nicht gelesen werden: ${mapErr.message}`);

  const norms = candidateNorms ?? (await loadCandidateNorms(orgId, domain));
  const place = knownPlace ?? (await loadProjectPlace(projectId));
  // Das Mapping vergleicht nur die Kategorie: Gemeindenormen anderer Gemeinden gehören nicht hinein.
  const match = matchOerebNorms(themes ?? [], mappings ?? [], normsForThemeMapping(norms, place));

  const documentTriggers = await parcelDocumentTriggers(norms, (themes ?? []) as ThemeRow[]);
  const wanted = new Map(match.byNorm);
  documentTriggers.forEach((_, normId) => {
    if (!wanted.has(normId)) wanted.set(normId, []);
  });

  return {
    available: true,
    reason: null,
    wanted,
    documentTriggers,
    gaps: match.gaps,
    affectedThemeCount: new Set((themes ?? []).map((t) => t.theme_code)).size,
  };
}

/**
 * Brings a project's automatically assigned norms in sync with the catalog:
 *   1. Durchgang 'system' — attaches everything that applies by jurisdiction and
 *      detaches what no longer does (e.g. after the municipality was corrected).
 *   2. Durchgang 'oereb'  — attaches norms mapped from the project's ÖREB themes
 *      (concern = 'affects'), trigger = 'oereb:<theme_code>', and detaches 'oereb'
 *      rows whose theme is no longer affected or whose norm no longer matches.
 *
 * Rows a user attached by hand (added_by = 'user') are never touched. A norm that
 * applies both by jurisdiction and via ÖREB is stored once, as 'system'.
 *
 * Der ÖREB-Durchgang blockiert den Sync nie: kann er nicht laufen (Migration fehlt),
 * steht der Grund in `oerebSkipped`.
 */
export async function assignNorms(
  projectId: string,
  orgId: string,
  canton: string,
  municipality: string,
  domain: string
): Promise<AssignmentResult> {
  const admin = createAdminClient();
  const norms = await loadCandidateNorms(orgId, domain);
  const place: ProjectPlace = { canton, municipality, bfs: (await loadProjectPlace(projectId)).bfs };

  // ── 1. Durchgang: Bund / Kanton / Gemeinde / Org ──────────────────────────
  const systemShouldHave = new Set(norms.filter((n) => applies(n, place)).map((n) => n.id));

  const { data: existing, error: existingErr } = await admin
    .from("project_norms")
    .select("norm_id, added_by")
    .eq("project_id", projectId);
  if (existingErr) throw new Error(`Projekt-Normen konnten nicht gelesen werden: ${existingErr.message}`);

  const alreadyLinked = new Set((existing ?? []).map((r) => r.norm_id as string));

  const toAdd = Array.from(systemShouldHave)
    .filter((id) => !alreadyLinked.has(id))
    .map((id) => ({ project_id: projectId, norm_id: id, added_by: "system" }));

  // Stale automatic links — a norm that no longer applies after the project's
  // canton/municipality changed. Manual additions are left alone on purpose.
  const toRemove = (existing ?? [])
    .filter((r) => r.added_by === "system" && !systemShouldHave.has(r.norm_id as string))
    .map((r) => r.norm_id as string);

  if (toAdd.length) {
    const { error } = await admin
      .from("project_norms")
      .upsert(toAdd, { onConflict: "project_id,norm_id", ignoreDuplicates: true });
    if (error) throw new Error(`Normen konnten nicht zugewiesen werden: ${error.message}`);
  }

  if (toRemove.length) {
    const { error } = await admin
      .from("project_norms")
      .delete()
      .eq("project_id", projectId)
      .eq("added_by", "system")
      .in("norm_id", toRemove);
    if (error) throw new Error(`Veraltete Normen konnten nicht entfernt werden: ${error.message}`);
  }

  // ── 2. Durchgang: ÖREB-Themen → Normen ────────────────────────────────────
  let oerebAssigned = 0;
  let gaps: OerebGap[] = [];
  let oerebSkipped: string | null = null;
  try {
    const plan = await planOerebAssignment(projectId, orgId, domain, norms, place);
    if (!plan.available) {
      oerebSkipped = plan.reason;
    } else {
      gaps = plan.gaps;
      oerebAssigned = await syncOerebRows(projectId, plan.wanted, systemShouldHave, plan.documentTriggers);
    }
  } catch (e) {
    // Der Jurisdiktions-Sync ist durch; ein ÖREB-Problem darf ihn nicht rückgängig machen.
    oerebSkipped = e instanceof Error ? e.message : String(e);
    console.error(`ÖREB-Normzuweisung für Projekt ${projectId} fehlgeschlagen:`, e);
  }

  return {
    total: systemShouldHave.size + oerebAssigned,
    systemAssigned: systemShouldHave.size,
    oerebAssigned,
    gaps,
    oerebSkipped,
  };
}

/**
 * Schreibt die 'oereb'-Zeilen eines Projekts. Gibt die Anzahl Normen zurück, die nur
 * über ÖREB (nicht schon über die Jurisdiktion) am Projekt hängen.
 */
async function syncOerebRows(
  projectId: string,
  wanted: Map<string, string[]>,
  systemShouldHave: Set<string>,
  documentTriggers: Map<string, string>
): Promise<number> {
  const admin = createAdminClient();
  const triggerOf = (normId: string, codes: string[]) => documentTriggers.get(normId) ?? oerebTrigger(codes[0]);
  const { data: rows, error } = await admin
    .from("project_norms")
    .select("norm_id, added_by, trigger")
    .eq("project_id", projectId);
  if (error) throw new Error(`Projekt-Normen konnten nicht gelesen werden: ${error.message}`);

  const byNorm = new Map((rows ?? []).map((r) => [r.norm_id as string, r]));

  // Neu: gewünschte Normen, die noch gar nicht verknüpft sind. Hängt die Norm schon
  // als 'system' oder 'user', bleibt diese Zeile unverändert (ignoreDuplicates).
  const toInsert = Array.from(wanted.entries())
    .filter(([normId]) => !byNorm.has(normId))
    .map(([normId, codes]) => ({
      project_id: projectId,
      norm_id: normId,
      added_by: "oereb",
      trigger: triggerOf(normId, codes),
    }));
  if (toInsert.length) {
    const { error: insErr } = await admin
      .from("project_norms")
      .upsert(toInsert, { onConflict: "project_id,norm_id", ignoreDuplicates: true });
    if (insErr) throw new Error(`ÖREB-Normen konnten nicht zugewiesen werden: ${insErr.message}`);
  }

  // Bestehende 'oereb'-Zeilen abgleichen.
  const toDelete: string[] = [];
  for (const r of rows ?? []) {
    if (r.added_by !== "oereb") continue;
    const normId = r.norm_id as string;
    const codes = wanted.get(normId);
    if (codes) {
      const trigger = triggerOf(normId, codes);
      if (r.trigger !== trigger) {
        const { error: updErr } = await admin
          .from("project_norms")
          .update({ trigger })
          .eq("project_id", projectId)
          .eq("norm_id", normId)
          .eq("added_by", "oereb");
        if (updErr) throw new Error(`ÖREB-Auslöser konnte nicht aktualisiert werden: ${updErr.message}`);
      }
    } else if (systemShouldHave.has(normId)) {
      // Thema weg, aber die Norm gilt weiterhin über die Jurisdiktion → wird 'system'.
      const { error: updErr } = await admin
        .from("project_norms")
        .update({ added_by: "system", trigger: null })
        .eq("project_id", projectId)
        .eq("norm_id", normId)
        .eq("added_by", "oereb");
      if (updErr) throw new Error(`ÖREB-Norm konnte nicht umgehängt werden: ${updErr.message}`);
    } else {
      toDelete.push(normId);
    }
  }
  if (toDelete.length) {
    const { error: delErr } = await admin
      .from("project_norms")
      .delete()
      .eq("project_id", projectId)
      .eq("added_by", "oereb")
      .in("norm_id", toDelete);
    if (delErr) throw new Error(`Veraltete ÖREB-Normen konnten nicht entfernt werden: ${delErr.message}`);
  }

  return Array.from(wanted.keys()).filter((id) => !systemShouldHave.has(id)).length;
}

const MATCHING_PROJECTS_BUDGET_MS = 60_000;

/**
 * Nach einem Import: Projekte aller Orgs derselben Gemeinde (BFS, sonst Name und Kanton) neu
 * zuweisen, nacheinander und höchstens 60 s. Der Rest folgt beim nächsten Refresh des jeweiligen
 * Projekts. Kein Massen-Sync über alle Orgs. Wirft nie.
 */
export async function assignNormToMatchingProjects(normId: string): Promise<number> {
  const start = Date.now();
  const admin = createAdminClient();
  try {
    const { data: norm, error } = await admin
      .from("norms")
      .select("jurisdiction_bfs, jurisdiction_name, jurisdiction_canton")
      .eq("id", normId)
      .maybeSingle();
    if (error || !norm) return 0;

    type Row = { id: string; org_id: string; domain: string | null; location: { canton?: string; municipality?: string } | null };
    const select = "id, org_id, domain, location";
    const byId = new Map<string, Row>();
    const add = (rows: unknown) => (rows as Row[] | null)?.forEach((r) => byId.set(r.id, r));

    if (norm.jurisdiction_bfs != null) {
      const res = await admin.from("projects").select(select).eq("bfs_number", norm.jurisdiction_bfs);
      if (res.error && !isMissingSchema(res.error.message)) throw new Error(res.error.message);
      add(res.data);
    }
    if (norm.jurisdiction_name) {
      let q = admin.from("projects").select(select).eq("location->>municipality", norm.jurisdiction_name);
      if (norm.jurisdiction_canton) q = q.eq("location->>canton", norm.jurisdiction_canton);
      const res = await q;
      if (res.error) throw new Error(res.error.message);
      add(res.data);
    }

    let synced = 0;
    for (const p of Array.from(byId.values())) {
      if (Date.now() - start > MATCHING_PROJECTS_BUDGET_MS) break;
      try {
        await assignNorms(p.id, p.org_id, p.location?.canton ?? "", p.location?.municipality ?? "", p.domain ?? "bau");
        synced++;
      } catch (e) {
        console.error(`Normzuweisung für Projekt ${p.id} fehlgeschlagen:`, e);
      }
    }
    return synced;
  } catch (e) {
    console.error(`Zuweisung der Norm ${normId} fehlgeschlagen:`, e);
    return 0;
  }
}

/**
 * Re-runs assignment (beide Durchgänge) for every project of an org — used after a
 * norm was uploaded, so a freshly added law reaches the projects it applies to
 * instead of only ever landing in projects created afterwards.
 *
 * Returns the number of projects touched. Never throws: a norm upload must not fail
 * because one project could not be synced.
 */
export async function assignNormsToOrgProjects(orgId: string): Promise<number> {
  const admin = createAdminClient();
  const { data: projects, error } = await admin
    .from("projects")
    .select("id, domain, location")
    .eq("org_id", orgId);

  if (error || !projects?.length) return 0;

  let synced = 0;
  for (const p of projects) {
    const loc = (p.location ?? {}) as { canton?: string; municipality?: string };
    try {
      await assignNorms(p.id, orgId, loc.canton ?? "", loc.municipality ?? "", p.domain ?? "bau");
      synced++;
    } catch (e) {
      console.error(`Normzuweisung für Projekt ${p.id} fehlgeschlagen:`, e);
    }
  }
  return synced;
}
