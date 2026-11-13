import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSchema } from "@/lib/supabase/schema-errors";

export type PlatformCostSource = "digest" | "oereb_ocr";

export interface PlatformCostEntry {
  source: PlatformCostSource;
  costUsd: number;
  at: string;
}

export interface PlatformCostRow {
  month: string;
  source: PlatformCostSource;
  usd: number;
  count: number;
}

export function aggregatePlatformCosts(entries: PlatformCostEntry[]): PlatformCostRow[] {
  const map = new Map<string, PlatformCostRow>();
  entries.forEach((e) => {
    if (!(e.costUsd > 0) || !Number.isFinite(e.costUsd)) return;
    const month = (e.at ?? "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    const key = `${month}|${e.source}`;
    const row = map.get(key) ?? { month, source: e.source, usd: 0, count: 0 };
    row.usd += e.costUsd;
    row.count += 1;
    map.set(key, row);
  });
  return Array.from(map.values())
    .map((r) => ({ ...r, usd: Math.round(r.usd * 10000) / 10000 }))
    .sort((a, b) => b.month.localeCompare(a.month) || a.source.localeCompare(b.source));
}

const LIMIT = 5000;

export async function loadPlatformCosts(admin: SupabaseClient): Promise<PlatformCostRow[]> {
  const entries: PlatformCostEntry[] = [];

  const digests = await admin.from("norm_digests").select("created_at, cost_usd").gt("cost_usd", 0).limit(LIMIT);
  if (digests.error) {
    if (!isMissingSchema(digests.error.message)) throw new Error(digests.error.message);
  } else {
    (digests.data ?? []).forEach((r) => {
      const row = r as { created_at: string; cost_usd: number | string | null };
      entries.push({ source: "digest", costUsd: Number(row.cost_usd), at: row.created_at });
    });
  }

  const ocr = await admin.from("oereb_documents").select("last_checked_at, ocr_cost_usd").gt("ocr_cost_usd", 0).limit(LIMIT);
  if (ocr.error) {
    if (!isMissingSchema(ocr.error.message)) throw new Error(ocr.error.message);
  } else {
    (ocr.data ?? []).forEach((r) => {
      const row = r as { last_checked_at: string | null; ocr_cost_usd: number | string | null };
      if (row.last_checked_at) entries.push({ source: "oereb_ocr", costUsd: Number(row.ocr_cost_usd), at: row.last_checked_at });
    });
  }

  return aggregatePlatformCosts(entries);
}
