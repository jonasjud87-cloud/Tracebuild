import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DELTA_CHECK_KIND,
  DELTA_NEW_KIND,
  chunkBaseline,
  serializeBaseline,
  serializeNewCheck,
  toBaseline,
  type BaselineItem,
  type DeltaNormText,
} from "@/lib/analysis-delta";
import type { StageNorm, StageUnit } from "./plan";

export interface DeltaPlan {
  baselineId: string;
  versionNo: number | null;
  items: BaselineItem[];
}

interface ItemRowLike {
  norm_id: string | null;
  norm_title: string | null;
  category: string | null;
  status: string;
  note: string | null;
  suggestion: string | null;
  confidence: string | null;
  page_reference: number | null;
  source_file: string | null;
}

export function baselineFromRows(rows: ItemRowLike[]): BaselineItem[] {
  return toBaseline(
    rows
      .filter((r) => (r.note ?? "").trim().length > 0)
      .map((r) => ({
        norm_id: r.norm_id,
        norm_title: r.norm_title ?? "Prüfpunkt",
        category: r.category ?? "andere",
        status: (r.status === "ok" || r.status === "fail" ? r.status : "warn") as BaselineItem["status"],
        finding: r.note ?? "",
        suggestion: r.suggestion,
        confidence: (r.confidence === "high" || r.confidence === "low" ? r.confidence : "medium") as BaselineItem["confidence"],
        page_reference: r.page_reference,
        source_file: r.source_file,
      })),
  );
}

export interface DeltaLoad {
  requested: boolean;
  plan: DeltaPlan | null;
  fallback: string | null;
}

const NOT_REQUESTED: DeltaLoad = { requested: false, plan: null, fallback: null };

function fallback(reason: string): DeltaLoad {
  return { requested: true, plan: null, fallback: reason };
}

export async function loadDeltaPlan(admin: SupabaseClient, analysisId: string): Promise<DeltaLoad> {
  const { data: current, error } = await admin.from("analyses").select("analysis_mode, based_on_analysis_id").eq("id", analysisId).maybeSingle();
  if (error || !current) return NOT_REQUESTED;
  const row = current as { analysis_mode?: string | null; based_on_analysis_id?: string | null };
  if (row.analysis_mode !== "delta") return NOT_REQUESTED;
  if (!row.based_on_analysis_id) return fallback("Es gibt keine fertige Vorversion dieser Prüfung.");

  const { data: base, error: baseError } = await admin.from("analyses").select("id, version_no, status").eq("id", row.based_on_analysis_id).maybeSingle();
  if (baseError) return fallback("Die Vorversion konnte nicht gelesen werden.");
  const baseRow = base as { id: string; version_no: number | null; status: string } | null;
  if (!baseRow) return fallback("Die Vorversion existiert nicht mehr.");
  if (baseRow.status !== "done") return fallback("Die Vorversion ist nicht erfolgreich abgeschlossen.");

  const { data: items, error: itemsError } = await admin
    .from("analysis_items")
    .select("norm_id, norm_title, category, status, note, suggestion, confidence, page_reference, source_file")
    .eq("analysis_id", baseRow.id)
    .order("norm_title", { ascending: true });
  if (itemsError) return fallback("Die Befunde der Vorversion konnten nicht gelesen werden.");
  const baseline = baselineFromRows((items ?? []) as ItemRowLike[]);
  if (!baseline.length) return fallback("Die Vorversion hat keine Befunde.");
  return { requested: true, plan: { baselineId: baseRow.id, versionNo: baseRow.version_no, items: baseline }, fallback: null };
}

function deltaNorm(kind: string, title: string): StageNorm {
  return {
    id: "",
    title,
    category: null,
    layer: null,
    jurisdiction_type: "delta",
    source_kind: kind,
    auto_scope: null,
    priority: null,
    digest: null,
  };
}

export const DELTA_NEW_UNIT_CHARS = 140_000;

export function packNorms(norms: DeltaNormText[], limit: number = DELTA_NEW_UNIT_CHARS): DeltaNormText[][] {
  const groups: DeltaNormText[][] = [];
  let current: DeltaNormText[] = [];
  let size = 0;
  norms.forEach((n) => {
    if (current.length && size + n.text.length > limit) {
      groups.push(current);
      current = [];
      size = 0;
    }
    current.push(n);
    size += n.text.length;
  });
  if (current.length) groups.push(current);
  return groups.length ? groups : [[]];
}

export function buildDeltaUnits(plan: DeltaPlan, norms: DeltaNormText[]): StageUnit[] {
  const chunks = chunkBaseline(plan.items);
  const groups = packNorms(norms);
  const total = chunks.length + groups.length;
  const version = plan.versionNo ? ` Version ${plan.versionNo}` : "";
  const units: StageUnit[] = chunks.map((chunk, i) => {
    const label = chunks.length > 1 ? `Nachkontrolle der Vorversion (Teil ${i + 1}/${chunks.length})` : "Nachkontrolle der Vorversion";
    return {
      norm: deltaNorm(DELTA_CHECK_KIND, `Nachkontrolle${version}`),
      part: i + 1,
      parts: chunks.length,
      text: serializeBaseline(chunk, plan.versionNo),
      range: null,
      index: i,
      total,
      label,
    };
  });
  groups.forEach((group, i) => {
    units.push({
      norm: deltaNorm(DELTA_NEW_KIND, "Prüfung auf Neues"),
      part: i + 1,
      parts: groups.length,
      text: serializeNewCheck(plan.items, group, plan.versionNo),
      range: null,
      index: chunks.length + i,
      total,
      label: groups.length > 1 ? `Prüfung auf Neues (Teil ${i + 1}/${groups.length})` : "Prüfung auf Neues",
    });
  });
  return units;
}
