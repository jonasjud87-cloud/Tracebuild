/**
 * Hinweis «Neuere amtliche Fassung verwendet», abgeleitet aus den Spalten der Org-Norm. Die amtliche
 * Norm ist öffentlich; über fremde Uploads steht hier nichts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NormSupersession, NormVersionHint } from "./geoadmin/contract";
import { isMissingSchema } from "./supabase/schema-errors";

export interface SupersessionRow {
  id: string;
  org_id?: string | null;
  superseded_by_norm_id?: string | null;
  superseded_similarity?: number | null;
  superseded_at?: string | null;
  org_authoritative?: boolean | null;
}

export interface OfficialNormRow {
  id: string;
  title: string;
  source_url: string | null;
  source_checked_at: string | null;
  source_kind?: string | null;
  auto_scope?: string | null;
}

const OFFICIAL_COLUMNS = "id, title, source_url, source_checked_at, source_kind, auto_scope";

/** Rein. Zeigt der Verweis auf eine zurückgenommene Norm, gilt der Upload und es gibt keinen Hinweis. */
export function supersessionOf(row: SupersessionRow, official: OfficialNormRow | null | undefined): NormSupersession {
  const active = !!official && official.source_kind === "oereb_auto" && official.auto_scope === "municipal";
  const authoritative = row.org_authoritative === true;
  const hint: NormVersionHint = authoritative ? "org_authoritative" : active ? "official_used" : null;
  return {
    version_hint: hint,
    org_authoritative: authoritative,
    superseded_similarity: active ? row.superseded_similarity ?? null : null,
    superseded_at: active ? row.superseded_at ?? null : null,
    official: active && official
      ? { id: official.id, title: official.title, source_url: official.source_url, source_checked_at: official.source_checked_at }
      : null,
  };
}

export async function loadOfficialNorms(admin: SupabaseClient, ids: string[]): Promise<Map<string, OfficialNormRow>> {
  if (!ids.length) return new Map();
  const { data, error } = await admin.from("norms").select(OFFICIAL_COLUMNS).is("org_id", null).in("id", ids);
  if (error) {
    if (!isMissingSchema(error.message)) console.error("Amtliche Normen nicht lesbar:", error.message);
    return new Map();
  }
  return new Map(((data ?? []) as unknown as OfficialNormRow[]).map((n) => [n.id, n]));
}

/** Ergänzt nur eigene Uploads. Plattformweite Normen bleiben, wie sie sind. */
export async function withSupersession<T extends SupersessionRow>(admin: SupabaseClient, rows: T[]): Promise<unknown[]> {
  const ids = Array.from(new Set(rows.map((r) => r.superseded_by_norm_id).filter((id): id is string => !!id)));
  const officials = await loadOfficialNorms(admin, ids);
  return rows.map((row) => {
    if (!row.org_id) return row;
    return { ...row, ...supersessionOf(row, row.superseded_by_norm_id ? officials.get(row.superseded_by_norm_id) : null) };
  });
}
