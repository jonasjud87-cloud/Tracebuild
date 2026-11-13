import type { SupabaseClient } from "@supabase/supabase-js";
import { assignNorms } from "@/lib/norm-assignment";
import { loadProjectNorms, selectNorms } from "@/lib/analysis-stages/prepare";
import { sortNormsForRun } from "@/lib/analysis-engine";
import { applyDigests } from "@/lib/norm-digest/rules";
import { loadActiveDigests } from "@/lib/norm-digest/store";
import { inputFingerprint, pickReusable } from "@/lib/analysis-fingerprint";
import { findReuseCandidates } from "@/lib/analysis-versions";

interface ProjectRow {
  id: string;
  org_id: string;
  domain?: string | null;
  bauzone?: string | null;
  zone_confidence?: string | null;
  location?: { canton?: string; municipality?: string } | null;
}

export async function currentInputFingerprint(admin: SupabaseClient, project: ProjectRow): Promise<string> {
  const canton = project.location?.canton ?? "";
  const municipality = project.location?.municipality ?? "";
  try {
    await assignNorms(project.id, project.org_id, canton, municipality, project.domain ?? "bau");
  } catch (e) {
    console.error(`Normzuweisung vor Wiederverwendungs-Prüfung (${project.id}):`, e instanceof Error ? e.message : e);
  }
  const { rows } = await loadProjectNorms(admin, project.id);
  const { norms: selected } = selectNorms(rows, project.bauzone ?? null, project.zone_confidence ?? null, project.org_id, canton || null, project.id);
  const fullNorms = sortNormsForRun(selected);
  const applied = applyDigests(fullNorms, await loadActiveDigests(admin, fullNorms.map((n) => n.id)));
  return inputFingerprint(
    fullNorms.map((n) => ({ id: n.id, text: n.text, digest: applied.find((m) => m.id === n.id)?.digest ?? false })),
    { canton, municipality, bauzone: project.bauzone ?? "" },
  );
}

export interface ReuseDecision {
  reusable: { id: string; version_no: number | null; created_at: string } | null;
  planKnown: boolean;
}

export async function decideReuse(admin: SupabaseClient, project: ProjectRow, docType: string, planHash: string): Promise<ReuseDecision> {
  const candidates = await findReuseCandidates(admin, project.id, docType, planHash);
  if (!candidates.length) return { reusable: null, planKnown: false };
  const fingerprint = await currentInputFingerprint(admin, project);
  const pick = pickReusable(candidates, planHash, fingerprint);
  return {
    reusable: pick ? { id: pick.id, version_no: pick.version_no, created_at: pick.created_at } : null,
    planKnown: true,
  };
}
