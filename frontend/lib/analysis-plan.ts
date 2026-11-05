/**
 * Plan der Prüfaufträge: Importierte Gemeindenormen dürfen Bund und Kanton nicht die Zeit nehmen.
 * Rein. Importierte Teile kommen deshalb zuletzt und höchstens so viele, wie Plätze frei bleiben.
 */

/** Live gemessen: Die Normphase hat rund 225 s, ein Aufruf dauert rund 72 s. */
const CALL_ESTIMATE_MS = 72_000;
export const MAX_AUTO_PARTS = 8;

interface PlannedPart {
  norm: { title: string; source_kind?: string | null; auto_scope?: string | null };
}

export interface AutoPartsSummary {
  total: number;
  run: number;
  skipped: number;
  /** Normen mit mindestens einem ausgelassenen Teil. */
  skipped_titles: string[];
}

export function planAutoParts<T extends PlannedPart>(
  units: T[],
  phaseMs: number,
  concurrency: number
): { units: T[]; summary: AutoPartsSummary } {
  const isAuto = (u: T) => u.norm.source_kind === "oereb_auto";
  const fixed = units.filter((u) => !isAuto(u));
  // Sortierung stabil: Gemeinde-Reglement vor objektbezogenen Vorschriften.
  const auto = units
    .filter(isAuto)
    .map((u, i) => ({ u, i }))
    .sort((a, b) => Number(a.u.norm.auto_scope === "parcel") - Number(b.u.norm.auto_scope === "parcel") || a.i - b.i)
    .map(({ u }) => u);

  const slots = Math.max(1, Math.floor(phaseMs / CALL_ESTIMATE_MS)) * Math.max(1, concurrency);
  // Mindestens ein Teil: Das Reglement der Gemeinde fehlt sonst ganz, Bund und Kanton laufen vorher.
  const allowed = Math.min(MAX_AUTO_PARTS, Math.max(1, slots - fixed.length), auto.length);
  const run = auto.slice(0, allowed);
  const skipped = auto.slice(allowed);

  return {
    units: [...fixed, ...run],
    summary: {
      total: auto.length,
      run: run.length,
      skipped: skipped.length,
      skipped_titles: Array.from(new Set(skipped.map((u) => u.norm.title))),
    },
  };
}
