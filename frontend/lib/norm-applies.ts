import { titleKey } from "./oereb/title-key";

/**
 * Welche Normen für ein Projekt gelten. Rein, damit es ohne Datenbank testbar ist. Die Zone ist
 * bewusst kein Teil davon: Sie wird beim Lesen ausgewertet (normMatchesZone).
 */

export interface ApplicableNorm {
  id: string;
  title?: string | null;
  layer: number;
  jurisdiction_type: string;
  jurisdiction_name: string | null;
  source_kind?: string | null;
  auto_scope?: string | null;
  jurisdiction_canton?: string | null;
  jurisdiction_bfs?: number | null;
}

export interface ProjectPlace {
  canton: string;
  municipality: string;
  bfs?: number | null;
}

/** auto_scope einer abgelösten Fassung: bleibt zum Nachvollzug bestehen, gilt aber nirgends mehr. */
export const SUPERSEDED_SCOPE = "superseded";

export function isAutoNorm(n: ApplicableNorm): boolean {
  return n.source_kind === "oereb_auto";
}

/**
 *   Bund      — gilt für jedes Projekt
 *   Kanton    — über den Kanton des Projekts
 *   Gemeinde  — über die BFS-Nummer, wenn beide sie kennen; sonst Name und Kanton
 *   Org       — Spezialnormen der eigenen Org
 * Automatisch importierte Vorschriften mit `auto_scope='parcel'` gelten nie über die
 * Jurisdiktion, nur für Grundstücke mit dem Dokument im Auszug. Abgelöste Fassungen gelten gar nicht.
 */
export function applies(n: ApplicableNorm, place: ProjectPlace): boolean {
  if (isAutoNorm(n) && (n.auto_scope === "parcel" || n.auto_scope === SUPERSEDED_SCOPE)) return false;
  if (n.layer === 1) return true;
  if (n.jurisdiction_type === "cantonal" && n.jurisdiction_name === place.canton) return true;
  if (n.jurisdiction_type === "municipal") {
    if (n.jurisdiction_bfs != null && place.bfs != null) return n.jurisdiction_bfs === place.bfs;
    if (n.jurisdiction_name !== place.municipality) return false;
    return !n.jurisdiction_canton || n.jurisdiction_canton === place.canton;
  }
  if (n.jurisdiction_type === "org") return true;
  return false;
}

/**
 * Importierte Normen weglassen, wenn dieselbe Vorschrift schon manuell gepflegt ist (eigene Org
 * oder global), sonst würde sie doppelt geprüft und doppelt bezahlt.
 * Grenze: Abweichende Titel werden so nicht erkannt.
 */
export function withoutShadowedAutoNorms<T extends ApplicableNorm>(norms: T[]): T[] {
  const manual = new Set<string>();
  for (const n of norms) {
    if (isAutoNorm(n) || !n.jurisdiction_name || !n.title) continue;
    manual.add(`${n.jurisdiction_name}|${titleKey(n.title, n.jurisdiction_name)}`);
  }
  return norms.filter(
    (n) =>
      !isAutoNorm(n) ||
      !n.jurisdiction_name ||
      !n.title ||
      !manual.has(`${n.jurisdiction_name}|${titleKey(n.title, n.jurisdiction_name)}`)
  );
}

/**
 * Kandidaten für das Themen-Mapping. Das Mapping vergleicht nur `category`: Ohne diese Grenze
 * bekäme jedes Projekt mit Nutzungsplanung die Baureglemente aller Gemeinden, manuelle wie
 * importierte. Importierte parcel-Normen laufen separat über das Dokument im Auszug.
 */
export function normsForThemeMapping<T extends ApplicableNorm>(norms: T[], place: ProjectPlace): T[] {
  return norms.filter((n) => (n.jurisdiction_type !== "municipal" && !isAutoNorm(n)) || applies(n, place));
}
