/** Eingefrorene Prüfaufträge, Dateiblöcke und Vorprüfungs-Angaben. Rein. */
import type { AnalysisPreflight, PreflightDocuments, PreflightOereb } from "./contract";
import type { NormInput, NormPart, PlanFile } from "../analysis-engine";
import type { PlanMimeType } from "../plan-files";

/** Norm ohne Volltext: Der Text des Teils steht in `text`, ein Reglement-Update ändert nichts mehr. */
export type StageNorm = Omit<NormInput, "text">;

export interface StageUnit {
  norm: StageNorm;
  part: number;
  parts: number;
  text: string;
  range: string | null;
  index: number;
  total: number;
  label: string;
}

export function stageNorm(n: NormInput): StageNorm {
  return {
    id: n.id,
    title: n.title,
    category: n.category,
    layer: n.layer ?? null,
    jurisdiction_type: n.jurisdiction_type ?? null,
    source_kind: n.source_kind ?? null,
    auto_scope: n.auto_scope ?? null,
  };
}

export function buildStageUnits(planned: NormPart[], labelOf: (p: NormPart) => string): StageUnit[] {
  return planned.map((p, index) => ({
    norm: stageNorm(p.norm),
    part: p.part,
    parts: p.parts,
    text: p.text,
    range: p.range,
    index,
    total: planned.length,
    label: labelOf(p),
  }));
}

/** Nur eigene oder plattformweite Normen. Eine verknüpfte fremde Privatnorm liest die Service-Role sonst mit. */
export function normVisibleToOrg(norm: { org_id?: string | null }, orgId: string): boolean {
  return (norm.org_id ?? null) === null || norm.org_id === orgId;
}

/** Abgelöste Fassung: Sie bleibt von Hand zugewiesen sichtbar, wird aber nicht mehr geprüft. */
export function normIsCurrent(norm: { auto_scope?: string | null }): boolean {
  return norm.auto_scope !== "superseded";
}

/**
 * Ohne Zuweisung und ohne Normen sähe ein technischer Fehler aus wie «keine Normen hinterlegt»: lieber
 * abbrechen als eine bezahlte Prüfung nur auf Fachwissen. Mit bestehenden Normen läuft sie auf dem letzten Stand.
 */
export function assertNormsUsable(source: "project_norms" | "fallback", assignError: unknown, loadError: unknown): void {
  if (source === "fallback" && (assignError || loadError)) {
    throw new Error("Die Normen des Projekts konnten nicht geladen werden. Bitte später erneut versuchen.");
  }
}

/** Zurück in die Form der Engine. Der Grenzmarker ist der eingefrorene des Laufs, nie ein neuer. */
export function toNormPart(unit: StageUnit, boundary: string): NormPart {
  return {
    norm: { ...unit.norm, text: "" },
    part: unit.part,
    parts: unit.parts,
    text: unit.text,
    range: unit.range,
    boundary,
  };
}

export function toPlanFile(f: { name: string; type: PlanMimeType }, url: string): PlanFile {
  return {
    name: f.name,
    block: f.type === "application/pdf"
      ? { type: "document", source: { type: "url", url } }
      : { type: "image", source: { type: "url", url } },
  };
}

const OEREB: readonly PreflightOereb[] = ["ok", "stale", "failed", "timeout", "skipped"];
const DOCUMENTS: readonly PreflightDocuments[] = [
  "not_needed", "done", "aborted", "error", "unavailable", "busy", "stalled", "timeout", "skipped",
];

/** Nur bekannte Werte und ein gültiges Datum, nie freier Text aus dem Browser. */
export function parsePreflight(raw: unknown): AnalysisPreflight | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { oereb?: unknown; documents?: unknown; stale_fetched_at?: unknown };
  const oereb = OEREB.find((v) => v === r.oereb);
  const documents = DOCUMENTS.find((v) => v === r.documents);
  if (!oereb || !documents) return null;
  const at = typeof r.stale_fetched_at === "string" ? Date.parse(r.stale_fetched_at) : NaN;
  return { oereb, documents, stale_fetched_at: Number.isFinite(at) ? new Date(at).toISOString() : null };
}
