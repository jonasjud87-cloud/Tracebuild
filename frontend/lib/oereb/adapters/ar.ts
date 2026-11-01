/**
 * ÖREB-Adapter Kanton Appenzell Ausserrhoden.
 *
 * Webservice (pyramid_oereb, extract-2.0) — verifiziert am 27.10.2026, Basis-URL laut
 * swisstopo-Verzeichnis (Layer ch.swisstopo-vd.stand-oerebkataster, Attribut oereb_webservice):
 *   https://oereb.ar.ch/ktar/wsgi/oereb
 *   {base}/versions/json, {base}/getegrid/json/?EN=…, {base}/getegrid/json/?IDENTDN=…&NUMBER=…,
 *   {base}/extract/json/?EGRID=…
 * Die URL kommt aus OEREB_BASE_URL_AR; ist sie leer, endet jeder Abruf mit 'unreachable'.
 *
 * Besonderheiten AR (gleiche Plattform wie SG):
 *  - Kein Treffer → HTTP 204 (kein leeres JSON).
 *  - IdentDN = "AR0200" + BFS-Nummer + "00", z.B. "AR0200300100" für Herisau — in allen
 *    18 stichprobenhaft abgefragten Gemeinden ohne Ausnahme.
 *  - Nutzungsplanungs-TypeCodes sind 4-stellig numerisch ("1310"); die ersten zwei Stellen
 *    entsprechen der Hauptnutzung nach ARE-Minimalmodell. Der Legendentext endet mit dem
 *    kommunalen Kürzel ("Wohn- und Gewerbezone WG2"), ohne SG-Präfix "BauG".
 *  - Wald (44) ist Grundnutzung, nicht Überlagerung: die Flächenanteile von 44xx ergänzen
 *    sich mit den übrigen Zonen auf 100 %. Überlagernd sind nur 5x und 6x (Summe > 100 %).
 */
import type { OerebExtract, OerebTheme, ZoneResult } from "../types";
import { GenericOerebAdapter, pickZoneRestriction, type GetEgridInput } from "./generic";
import { sgExactZoneCode } from "./sg";

export const AR_OEREB_BASE_URL_ENV = "OEREB_BASE_URL_AR";

/**
 * Code → Grobklasse. 2-stellige Hauptnutzung nach ARE (wie SG), 4-stellige Verfeinerungen
 * aus den Legenden echter AR-Auszüge (Stichprobe über alle 20 Gemeinden, 27.10.2026).
 * Längster passender Präfix gewinnt.
 */
export const AR_ZONE_CLASSES: Record<string, string> = {
  // Bauzonen (ARE 11–19)
  "11": "Wohnzone",
  "12": "Arbeitszone",
  "1210": "Gewerbezone",
  "1220": "Gewerbezone",
  "1230": "Gewerbezone",
  "1250": "Industriezone",
  "1260": "Industriezone",
  "1270": "Industriezone",
  "13": "Wohn- und Gewerbezone",
  "14": "Kernzone",
  "15": "Zone für öffentliche Bauten und Anlagen",
  "16": "Grünzone im Baugebiet",
  "1650": "Grünzone nach altem Baugesetz",
  "17": "Tourismus- und Freizeitzone",
  "1710": "Kurzone",
  "1720": "Intensiverholungszone",
  "18": "Verkehrsfläche innerhalb Bauzone",
  "19": "Weitere Bauzone",
  // Nichtbauzonen
  "21": "Landwirtschaftszone",
  "31": "Schutzzone ausserhalb Bauzone",
  "32": "Gewässer",
  "4110": "Weilerzone",
  "42": "Verkehrsfläche ausserhalb Bauzone",
  "43": "Übriges Gemeindegebiet",
  "44": "Wald",
  "4920": "Deponiezone",
  // Überlagerungen (keine Grundnutzung)
  "5910": "Zone für Wintersport",
  "5920": "Grünzone im Nichtbaugebiet",
  "62": "Sondernutzungsplanpflicht",
  "69": "Überlagernde Festlegung",
};

/** Klassen, die keine Grundnutzung beschreiben und die Zone nicht bestimmen dürfen. */
const AR_OVERLAY_PREFIXES = ["5", "6"];

export function arZoneClass(typeCode: string | null): string | null {
  if (!typeCode) return null;
  const digits = /^\d+/.exec(typeCode.trim())?.[0] ?? "";
  for (let len = Math.min(4, digits.length); len >= 2; len--) {
    const label = AR_ZONE_CLASSES[digits.slice(0, len)];
    if (label) return label;
  }
  return null;
}

export function arIsOverlay(t: OerebTheme): boolean {
  const code = t.typeCode?.trim() ?? "";
  return AR_OVERLAY_PREFIXES.some((p) => code.startsWith(p));
}

// Varianten mit Kleinbuchstabe nach der Geschosszahl ("W2b" Teufen, "W3a" Grub).
const AR_VARIANT_CODE = /^[A-ZÖÄÜ]{1,4}\d{1,2}[a-z]$/;

/**
 * AR-Legenden folgen derselben Kürzel-Konvention wie SG ("Kernzone K3", "Gewerbezone GE I"),
 * zusätzlich mit Varianten-Suffix ("Wohnzone W2b" → "W2b").
 */
export function arExactZoneCode(legendText: string | null): string | null {
  const last = legendText?.trim().split(/\s+/).pop() ?? "";
  if (AR_VARIANT_CODE.test(last)) return last;
  return sgExactZoneCode(legendText);
}

export class ArOerebAdapter extends GenericOerebAdapter {
  constructor(baseUrl: string | null | undefined = process.env[AR_OEREB_BASE_URL_ENV]) {
    super("AR", baseUrl);
  }

  protected identDnCandidates(input: GetEgridInput): string[] {
    if (input.bfsNumber === undefined) return [];
    return [`AR0200${String(input.bfsNumber).padStart(4, "0")}00`];
  }

  /**
   * Zone = Nutzungsplanungs-Eintrag mit dem grössten Flächenanteil (ohne Überlagerungen).
   *   kommunales Kürzel im Legendentext erkennbar → 'exact'
   *   sonst Grobklasse aus der Code-Tabelle        → 'coarse'
   *   sonst                                        → 'none'
   */
  extractZone(extract: OerebExtract): ZoneResult {
    const source = `oereb:${this.canton}`;
    const best = pickZoneRestriction(extract, arIsOverlay);
    if (!best) return { zone: null, confidence: "none", source };

    const exact = arExactZoneCode(best.legendText);
    if (exact) return { zone: exact, confidence: "exact", source };

    const coarse = arZoneClass(best.typeCode) ?? best.legendText ?? null;
    if (coarse) return { zone: coarse, confidence: "coarse", source };

    return { zone: null, confidence: "none", source };
  }
}
