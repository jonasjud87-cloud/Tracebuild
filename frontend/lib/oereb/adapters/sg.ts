/**
 * ÖREB-Adapter Kanton St.Gallen.
 *
 * Webservice (pyramid_oereb, extract-2.0) — verifiziert am 12.09.2026:
 *   https://oereb.geo.sg.ch/ktsg/wsgi/oereb
 *   {base}/versions/json, {base}/capabilities/json, {base}/getegrid/json/?EN=…,
 *   {base}/getegrid/json/?IDENTDN=…&NUMBER=…, {base}/extract/json/?EGRID=…
 * Die URL kommt aus OEREB_BASE_URL_SG; ist sie leer, endet jeder Abruf mit 'unreachable'.
 *
 * Besonderheiten SG:
 *  - Kein Treffer → HTTP 204 (kein leeres JSON).
 *  - IdentDN = "SG0200" + BFS-Nummer + Grundbuchkreis-Suffix ("00", bei fusionierten
 *    Gemeinden Buchstaben, z.B. "SG020033400R" für Rapperswil). Der Suffix ist nicht
 *    ableitbar → IDENTDN wird nur mit "00" versucht, sonst Parzellensuche geo.admin.ch.
 *  - Lawstatus-Codes englisch ("inForce"), LegendText als Text-Array.
 *  - Nutzungsplanungs-TypeCodes sind 7-stellig numerisch ("1104101") oder PBG-Codes mit
 *    Kürzel ("11011W9.5"). Die ersten zwei Stellen entsprechen der Hauptnutzung nach
 *    ARE-Minimalmodell Nutzungsplanung (11 Wohnzonen … 19 weitere Bauzonen, 21 Landwirt-
 *    schaft). Der Legendentext enthält das kommunale Kürzel am Ende ("BauG Wohnzone W2").
 */
import type { OerebExtract, OerebTheme, ZoneResult } from "../types";
import { GenericOerebAdapter, pickZoneRestriction, type GetEgridInput } from "./generic";

export const SG_OEREB_BASE_URL_ENV = "OEREB_BASE_URL_SG";

/**
 * Code → Grobklasse. Quelle für die 2-stelligen Hauptnutzungscodes: ARE, Minimales
 * Geodatenmodell Nutzungsplanung (CH_Code der Grundnutzung). Die 4-stelligen Verfeine-
 * rungen stammen aus den Legenden (Map.OtherLegend) echter SG-Auszüge (Mels, 12.09.2026).
 * Längster passender Präfix gewinnt.
 */
export const SG_ZONE_CLASSES: Record<string, string> = {
  // Bauzonen (ARE 11–19)
  "11": "Wohnzone",
  "12": "Arbeitszone",
  "1202": "Gewerbe-Industriezone",
  "1203": "Industriezone",
  "13": "Mischzone",
  "1301": "Wohn-Gewerbezone",
  "1302": "Wohn-Gewerbezone",
  "1304": "Wohn-Gewerbezone",
  "14": "Zentrumszone",
  "1401": "Kernzone",
  "1402": "Dorfkernzone",
  "15": "Zone für öffentliche Nutzungen",
  "1501": "Zone für öffentliche Bauten und Anlagen",
  "1502": "Freihaltezone Sport und Freizeit",
  "1504": "Zone für öffentliche Bauten und Anlagen",
  "16": "Eingeschränkte Bauzone",
  "1601": "Freihaltezone Ortsplanung",
  "1608": "Grünzone Freihaltung",
  "17": "Tourismus- und Freizeitzone",
  "18": "Verkehrszone innerhalb Bauzone",
  "19": "Weitere Bauzone",
  // Nichtbauzonen
  "21": "Landwirtschaftszone",
  "31": "Schutzzone ausserhalb Bauzone",
  "3102": "Freihaltezone Natur- und Heimatschutz",
  "3108": "Grünzone Freihaltung",
  "3109": "Grünzone Naturschutz",
  "32": "Gewässer",
  "42": "Verkehrsfläche ausserhalb Bauzone",
  "43": "Übriges Gemeindegebiet",
  "44": "Wald",
  // Überlagerungen / Hinweise (keine Grundnutzung)
  "53": "Naturgefahren (Hinweis)",
  "59": "Sonderzone",
  "5902": "Skiabfahrts- und Skiübungsgelände",
  "62": "Sondernutzungsplanpflicht",
  "69": "Überlagernde Festlegung",
};

/** Klassen, die keine Grundnutzung beschreiben und die Zone nicht bestimmen dürfen. */
const SG_OVERLAY_PREFIXES = ["44", "5", "6"];

export function sgZoneClass(typeCode: string | null): string | null {
  if (!typeCode) return null;
  const digits = /^\d+/.exec(typeCode.trim())?.[0] ?? "";
  for (let len = Math.min(4, digits.length); len >= 2; len--) {
    const label = SG_ZONE_CLASSES[digits.slice(0, len)];
    if (label) return label;
  }
  return null;
}

export function sgIsOverlay(t: OerebTheme): boolean {
  const code = t.typeCode?.trim() ?? "";
  return SG_OVERLAY_PREFIXES.some((p) => code.startsWith(p));
}

// Ein Token ist ein Zonenkürzel, wenn es kurz ist, mit Grossbuchstabe beginnt und nicht
// wie ein normales Wort aussieht ("Wald", "Weg", "Zone" → nein; "W2", "WG3", "DK2",
// "ÖBA", "FiB", "K", "12.5" → ja).
const CODE_TOKEN = /^[A-ZÖÄÜ][A-Za-zÖÄÜöäü]{0,4}\d{0,2}(?:[.,]\d)?$/;
const NUMBER_TOKEN = /^\d{1,2}(?:[.,]\d)?$/;
const WORD_LIKE = /^[A-ZÖÄÜ][a-zöäü]{2,}$/;

/**
 * Kommunales Zonenkürzel aus dem Legendentext, z.B.
 *   "BauG Wohnzone W2"            → "W2"
 *   "Wohnzone 9 5 W9.5"           → "W9.5"
 *   "Kernzone K 12.5"             → "K12.5"
 *   "BauG Gewerbe-Industriezone GI A" → "GI A"
 *   "BauG Landwirtschaftszone"    → null
 */
export function sgExactZoneCode(legendText: string | null): string | null {
  if (!legendText) return null;
  const tokens = legendText.trim().split(/\s+/);
  const run: string[] = [];
  for (let i = tokens.length - 1; i >= 0; i--) {
    const tok = tokens[i];
    const isCode = (CODE_TOKEN.test(tok) && !WORD_LIKE.test(tok)) || NUMBER_TOKEN.test(tok);
    if (!isCode) break;
    run.unshift(tok);
  }
  while (run.length && NUMBER_TOKEN.test(run[0])) run.shift();
  if (!run.length || !run.some((t) => /[A-Za-zÖÄÜöäü]/.test(t))) return null;
  // Endet die Legende auf ein vollständiges Kürzel mit Ziffer ("W9.5", "A13.0", "WG3"),
  // ist das der Code — davor stehende Bruchstücke ("A13 0") sind die Langform.
  const last = run[run.length - 1];
  if (/\d/.test(last) && !NUMBER_TOKEN.test(last)) return last.replace(",", ".");
  // "K 12.5" → "K12.5", aber "GI A" bleibt "GI A"
  let out = run[0];
  for (let i = 1; i < run.length; i++) {
    out += NUMBER_TOKEN.test(run[i]) ? run[i] : ` ${run[i]}`;
  }
  return out.replace(",", ".");
}

export class SgOerebAdapter extends GenericOerebAdapter {
  constructor(baseUrl: string | null | undefined = process.env[SG_OEREB_BASE_URL_ENV]) {
    super("SG", baseUrl);
  }

  protected identDnCandidates(input: GetEgridInput): string[] {
    if (input.bfsNumber === undefined) return [];
    return [`SG0200${String(input.bfsNumber).padStart(4, "0")}00`];
  }

  /**
   * Zone = Nutzungsplanungs-Eintrag mit dem grössten Flächenanteil (ohne Überlagerungen).
   *   kommunales Kürzel im Legendentext erkennbar → 'exact'
   *   sonst Grobklasse aus der Code-Tabelle        → 'coarse'
   *   sonst                                        → 'none'
   */
  extractZone(extract: OerebExtract): ZoneResult {
    const source = `oereb:${this.canton}`;
    const best = pickZoneRestriction(extract, sgIsOverlay);
    if (!best) return { zone: null, confidence: "none", source };

    const exact = sgExactZoneCode(best.legendText);
    if (exact) return { zone: exact, confidence: "exact", source };

    const coarse = sgZoneClass(best.typeCode) ?? best.legendText?.replace(/^BauG\s+/i, "") ?? null;
    if (coarse) return { zone: coarse, confidence: "coarse", source };

    return { zone: null, confidence: "none", source };
  }
}
