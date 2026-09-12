import { createAdminClient } from "@/lib/supabase/admin";
import { matchOerebNorms, oerebTrigger, type OerebGap } from "@/lib/oereb/mapping";

interface NormRow {
  id: string;
  layer: number;
  jurisdiction_type: string;
  jurisdiction_name: string | null;
  org_id: string | null;
  category: string | null;
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

/**
 * Which norms apply to a project of this org, in this canton and municipality:
 *   Bund      — every project gets it
 *   Kanton    — matched on the project's canton
 *   Gemeinde  — matched on the project's municipality
 *   Org       — the org's own Spezialnormen
 *
 * Zone is deliberately NOT part of this. A norm's zone tag is evaluated when the
 * norms are read (Normen tab, analysis prompt) via normMatchesZone, so correcting
 * a project's Bauzone takes effect immediately without re-running assignment.
 */
function applies(n: NormRow, canton: string, municipality: string): boolean {
  if (n.layer === 1) return true;
  if (n.jurisdiction_type === "cantonal" && n.jurisdiction_name === canton) return true;
  if (n.jurisdiction_type === "municipal" && n.jurisdiction_name === municipality) return true;
  if (n.jurisdiction_type === "org") return true;
  return false;
}

/** Kandidaten: Normen der Org plus plattformweite Normen (org_id IS NULL), je Domäne. */
async function loadCandidateNorms(orgId: string, domain: string): Promise<NormRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("norms")
    .select("id, layer, jurisdiction_type, jurisdiction_name, org_id, category")
    .eq("domain", domain)
    .or(`org_id.eq.${orgId},org_id.is.null`);
  if (error) throw new Error(`Normen konnten nicht gelesen werden: ${error.message}`);
  return (data ?? []) as NormRow[];
}

/** PostgREST meldet fehlende Tabellen/Spalten so — dann ist die ÖREB-Migration nicht eingespielt. */
function isMissingSchema(message: string | undefined): boolean {
  const m = message ?? "";
  return m.includes("Could not find the table") || m.includes("does not exist") || m.includes("schema cache");
}

export interface OerebAssignmentPlan {
  /** false, wenn der Durchgang nicht möglich ist — `reason` sagt warum. */
  available: boolean;
  reason: string | null;
  /** norm_id → Themencodes, über die die Norm greift. */
  wanted: Map<string, string[]>;
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
  candidateNorms?: NormRow[]
): Promise<OerebAssignmentPlan> {
  const admin = createAdminClient();
  const empty = (available: boolean, reason: string | null): OerebAssignmentPlan =>
    ({ available, reason, wanted: new Map(), gaps: [], affectedThemeCount: 0 });

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
    .select("theme_code, theme_name")
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
  const match = matchOerebNorms(themes ?? [], mappings ?? [], norms);

  return {
    available: true,
    reason: null,
    wanted: match.byNorm,
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

  // ── 1. Durchgang: Bund / Kanton / Gemeinde / Org ──────────────────────────
  const systemShouldHave = new Set(
    norms.filter((n) => applies(n, canton, municipality)).map((n) => n.id)
  );

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
    const plan = await planOerebAssignment(projectId, orgId, domain, norms);
    if (!plan.available) {
      oerebSkipped = plan.reason;
    } else {
      gaps = plan.gaps;
      oerebAssigned = await syncOerebRows(projectId, plan.wanted, systemShouldHave);
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
  systemShouldHave: Set<string>
): Promise<number> {
  const admin = createAdminClient();
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
      trigger: oerebTrigger(codes[0]),
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
      const trigger = oerebTrigger(codes[0]);
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
