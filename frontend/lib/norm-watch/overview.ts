import type { createAdminClient } from "@/lib/supabase/admin";
import { buildOverview } from "./status";
import type { NormSourceRow, NormWatchOverview } from "./types";

type Admin = ReturnType<typeof createAdminClient>;

export const SOURCE_COLUMNS =
  "id, label, provider, identifier, norm_id, jurisdiction_type, jurisdiction_name, category, enabled, applied_version, applied_label, remote_version, remote_label, ignored_version, status, last_checked_at, last_error, created_at";

export async function loadSources(admin: Admin): Promise<NormSourceRow[]> {
  const { data, error } = await admin.from("norm_sources").select(SOURCE_COLUMNS).order("label");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as NormSourceRow[];
}

export async function loadNormWatchOverview(admin: Admin, now: Date = new Date()): Promise<NormWatchOverview> {
  const sources = await loadSources(admin);

  const { data: drafts, error: draftError } = await admin
    .from("norm_update_drafts")
    .select("id, source_id")
    .eq("status", "draft");
  if (draftError) throw new Error(draftError.message);
  const draftBySource = new Map<string, string>();
  for (const d of drafts ?? []) draftBySource.set(d.source_id as string, d.id as string);

  const normIds = Array.from(new Set(sources.map((s) => s.norm_id).filter((v): v is string => !!v)));
  const titles = new Map<string, string>();
  if (normIds.length > 0) {
    const { data: norms, error: normError } = await admin.from("norms").select("id, title").in("id", normIds);
    if (normError) throw new Error(normError.message);
    for (const n of norms ?? []) titles.set(n.id as string, (n.title as string) ?? "");
  }

  return buildOverview(sources, draftBySource, titles, now);
}
