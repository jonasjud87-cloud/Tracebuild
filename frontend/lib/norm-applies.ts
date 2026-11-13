import { countryForCanton } from "./oereb/cantons";
import { titleKey } from "./oereb/title-key";
import { companyNormApplies } from "./company-norms";

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
  /** Amtliche Norm, die diesen Upload ablöst (Textvergleich). Nur auf Zeilen einer Org gesetzt. */
  superseded_by_norm_id?: string | null;
  /** Die Org hat ihre Fassung als massgebend festgelegt. */
  org_authoritative?: boolean | null;
  /** 'CH' | 'LI'; NULL = gilt in allen Ländern. Fehlt die Spalte (Migration fehlt), wie NULL. */
  country?: string | null;
  approval_status?: string | null;
  archived_at?: string | null;
  scope_mode?: string | null;
  scope_cantons?: string[] | null;
  scope_project_ids?: string[] | null;
  priority?: string | null;
}

export interface ProjectPlace {
  canton: string;
  municipality: string;
  bfs?: number | null;
  projectId?: string | null;
}

/** auto_scope einer abgelösten Fassung: bleibt zum Nachvollzug bestehen, gilt aber nirgends mehr. */
export const SUPERSEDED_SCOPE = "superseded";

export function isAutoNorm(n: ApplicableNorm): boolean {
  return n.source_kind === "oereb_auto";
}

/**
 * Land einer hochgeladenen Norm. Bund: gewähltes Land (Standard CH, "all" = alle Länder → NULL);
 * Kanton: FL → LI, sonst CH.
 * Gemeinde und Org: NULL, sie gelten ohnehin nur über Name/BFS bzw. die eigene Org, und eine
 * FL-Gemeinde ohne Kanton im Upload darf nicht als CH enden.
 */
export function uploadCountry(
  jurisdictionType: string,
  jurisdictionName: string | null,
  requested?: string | null
): "CH" | "LI" | null {
  if (jurisdictionType === "national") {
    const wanted = (requested ?? "").trim().toUpperCase();
    // «Alle Länder» (z. B. SIA, VKF): NULL gilt in CH und LI.
    if (wanted === "ALL") return null;
    return wanted === "LI" ? "LI" : "CH";
  }
  if (jurisdictionType === "cantonal") return countryForCanton(jurisdictionName);
  return null;
}

/** Land der Norm passt zum Projekt: Projekte ohne Kanton gelten als CH, Normen ohne Land überall. */
export function countryMatches(n: ApplicableNorm, place: Pick<ProjectPlace, "canton">): boolean {
  return !n.country || n.country === countryForCanton(place.canton);
}

/**
 *   Bund      — gilt für jedes Projekt
 *   Kanton    — über den Kanton des Projekts
 *   Gemeinde  — über die BFS-Nummer, wenn beide sie kennen; sonst Name und Kanton
 *   Org       — Spezialnormen der eigenen Org
 * Alle Ebenen nur im Land der Norm (`country`, NULL = überall): Schweizer Recht nie für FL.
 * Automatisch importierte Vorschriften mit `auto_scope='parcel'` gelten nie über die
 * Jurisdiktion, nur für Grundstücke mit dem Dokument im Auszug. Abgelöste Fassungen gelten gar nicht.
 */
export function applies(n: ApplicableNorm, place: ProjectPlace): boolean {
  if (isAutoNorm(n) && (n.auto_scope === "parcel" || n.auto_scope === SUPERSEDED_SCOPE)) return false;
  if (!countryMatches(n, place)) return false;
  if (n.layer === 1) return true;
  if (n.jurisdiction_type === "cantonal" && n.jurisdiction_name === place.canton) return true;
  if (n.jurisdiction_type === "municipal") {
    if (n.jurisdiction_bfs != null && place.bfs != null) return n.jurisdiction_bfs === place.bfs;
    if (n.jurisdiction_name !== place.municipality) return false;
    return !n.jurisdiction_canton || n.jurisdiction_canton === place.canton;
  }
  if (n.jurisdiction_type === "org") return companyNormApplies(n, place);
  return false;
}

function isActiveOfficial(n: ApplicableNorm | undefined, place?: ProjectPlace): boolean {
  return !!n && isAutoNorm(n) && n.auto_scope === "municipal" && (!place || applies(n, place));
}

/**
 * Uploads, die eine geltende amtliche Fassung ablöst. Fehlt die amtliche Norm, wurde sie zurückgenommen
 * oder gilt sie am Projektort nicht (gleichnamige Gemeinde in einem anderen Kanton), bleibt der Upload
 * aktiv: Sonst stünde das Projekt ohne Reglement da.
 */
export function replacedUploadIds(norms: ApplicableNorm[], place?: ProjectPlace): Set<string> {
  const byId = new Map(norms.map((n) => [n.id, n]));
  const out = new Set<string>();
  for (const n of norms) {
    if (isAutoNorm(n) || !n.superseded_by_norm_id || n.org_authoritative) continue;
    if (isActiveOfficial(byId.get(n.superseded_by_norm_id), place)) out.add(n.id);
  }
  return out;
}

/**
 * Löst doppelte Vorschriften auf, sonst würden sie doppelt geprüft und doppelt bezahlt:
 * - Upload dem amtlichen Text sehr ähnlich (`superseded_by_norm_id`): Die amtliche Fassung gilt, der
 *   Upload bleibt bestehen, ist aber inaktiv. Ausser die Org hat ihn als massgebend festgelegt; dann
 *   entfällt umgekehrt die amtliche Norm.
 * - Sonst wie bisher: Dieselbe Vorschrift, manuell gepflegt und gleichen Titels, schlägt den Import.
 *   Grenze: Abweichende Titel werden so nicht erkannt.
 */
export function withoutShadowedAutoNorms<T extends ApplicableNorm>(norms: T[], place?: ProjectPlace): T[] {
  const replaced = replacedUploadIds(norms, place);
  const manual = new Set<string>();
  const authoritativeOver = new Set<string>();
  for (const n of norms) {
    if (isAutoNorm(n) || replaced.has(n.id)) continue;
    if (n.org_authoritative && n.superseded_by_norm_id) authoritativeOver.add(n.superseded_by_norm_id);
    if (!n.jurisdiction_name || !n.title) continue;
    manual.add(`${n.jurisdiction_name}|${titleKey(n.title, n.jurisdiction_name)}`);
  }
  return norms.filter((n) => {
    if (replaced.has(n.id) || authoritativeOver.has(n.id)) return false;
    return (
      !isAutoNorm(n) ||
      !n.jurisdiction_name ||
      !n.title ||
      !manual.has(`${n.jurisdiction_name}|${titleKey(n.title, n.jurisdiction_name)}`)
    );
  });
}

/**
 * Kandidaten für das Themen-Mapping. Das Mapping vergleicht nur `category`: Ohne diese Grenze
 * bekäme jedes Projekt mit Nutzungsplanung die Baureglemente aller Gemeinden, manuelle wie
 * importierte. Importierte parcel-Normen laufen separat über das Dokument im Auszug.
 */
export function normsForThemeMapping<T extends ApplicableNorm>(norms: T[], place: ProjectPlace): T[] {
  return norms.filter((n) => countryMatches(n, place) && applies(n, place));
}
