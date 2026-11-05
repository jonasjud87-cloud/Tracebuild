/**
 * Ermittelt die Bauzone aus einem Auszug mit einer Standardregel und Überschreibungen pro
 * Kanton. Rein. Die TypeCode-Schemata der Kantone sind nicht einheitlich, ein Filter allein
 * über den Code ist nicht generisch möglich: Deshalb pro Kanton Thema, Ebene und Legende.
 *
 * Konfidenz:
 *   exact   Kürzel erkannt
 *   coarse  Legende enthält einen Zonenbegriff und ist nicht sekundär
 *   low     nur sekundäre Einträge, kein Zonenbegriff oder zwei Legenden je ≥ 40 % ohne
 *           Kantonsregel; `zone` enthält den besten Kandidaten, das manuelle Feld bleibt
 *   none    keine Kandidaten
 */
import { sgExactZoneCode } from "./adapters/sg";
import type { OerebExtract, OerebTheme, ZoneResult } from "./types";

export interface ZoneRule {
  themeCodes: RegExp;
  /** Themen-SubCode oder Ebene muss passen. */
  subTheme?: RegExp;
  typeCodeInclude?: RegExp;
  typeCodeExclude?: RegExp;
  legendExclude: RegExp;
  /** Nur wenn sonst nichts bleibt, dann 'low'. */
  legendSecondary: RegExp;
  parseCode: (legend: string, typeCode: string | null) => string | null;
  cleanLegend?: (legend: string) => string;
  /** TypeCode ist selbst das Kürzel (AI). */
  typeCodeIsShort?: boolean;
}

const EXCLUDE_TERMS = [
  "hinweis", "indication", "indicazione", "perimeter", "périmètre", "perimetro", "comparto",
  "baulinie", "alignement", "linea di arretramento", "ortsbild", "denkmal", "archäolog",
  "archéolog", "archeolog", "gefahr", "danger", "pericolo", "erschliessung", "revision",
  "plan nr", "bebauungsplan", "sondernutzung", "sonderbau", "lärm", "waldabstand", "pittoresc",
];

function excludeRegex(terms: string[]): RegExp {
  return new RegExp(terms.join("|"), "i");
}

export const DEFAULT_LEGEND_EXCLUDE = excludeRegex(EXCLUDE_TERMS);
export const DEFAULT_LEGEND_SECONDARY =
  /verkehrsfläche|verkehrszone|zone de transport|zone de desserte|\bwald\b|übriges gemeindegebiet/i;

// Über die deutschen Begriffe hinaus «vieille ville», «village» und «nucleo»: In VS, FR, TI
// tragen Grundnutzungen solche Namen ohne das Wort Zone (Sion: «Vieille ville (1)»).
const ZONE_TERM = /zone|zona|quartier|kern|wohn|gewerbe|industrie|dorf|altstadt|landwirtschaft|vieille ville|village|nucleo/i;

/**
 * Kürzel aus der Legende, der Reihe nach: [ASA]; (KA), nur Buchstaben, «Vieille ville (1)» ist
 * kein Code; «, W3A» nach Komma; « - CCc» nach Bindestrich; sonst die SG-Konvention am Ende.
 */
export function parseZoneCode(legend: string): string | null {
  const square = /\[([^\]\s]{1,12})\]/.exec(legend);
  if (square) return square[1];
  // Ein Kürzel hat keine drei Kleinbuchstaben in Folge: «W3A», «CCc», «K14a», aber nicht «Hanglage».
  const code = (m: RegExpExecArray | null) => (m && !/[a-zäöü]{3}/.test(m[1]) ? m[1] : null);
  const round = code(/\(([A-Za-zÄÖÜäöü]{1,8})\)\s*$/.exec(legend));
  if (round) return round;
  const comma = code(/,\s*([A-ZÄÖÜ][A-Za-z0-9.]{0,7})\s*$/.exec(legend));
  if (comma) return comma;
  const dash = code(/\s-\s([A-ZÄÖÜ][A-Za-z0-9.]{0,7})\s*$/.exec(legend));
  if (dash) return dash;
  return sgExactZoneCode(legend);
}

export const DEFAULT_ZONE_RULE: ZoneRule = {
  themeCodes: /^ch\.Nutzungsplanung$/,
  legendExclude: DEFAULT_LEGEND_EXCLUDE,
  legendSecondary: DEFAULT_LEGEND_SECONDARY,
  parseCode: (legend) => parseZoneCode(legend),
};

const GRUNDNUTZUNG = /Grundnutzung/i;

const OVERRIDES: Readonly<Record<string, Partial<ZoneRule>>> = {
  AG: { typeCodeExclude: /^(6|8)/ },
  AI: { subTheme: /NutzungsplanungKommunal/, typeCodeIsShort: true },
  // Bern: …GrundnutzungNutzungszonen, La Neuveville: …Grundnutzung, Legende mit Unterstrichen.
  BE: {
    subTheme: /Grundnutzung(Nutzungszonen)?$/,
    cleanLegend: (legend) => legend.replace(/_/g, " ").trim(),
  },
  BL: { typeCodeInclude: /^1/ },
  BS: {
    subTheme: /ch\.BS\.Zonenplan/,
    legendExclude: excludeRegex(EXCLUDE_TERMS.filter((t) => t !== "ortsbild")),
  },
  FR: { subTheme: /ch\.FR\.Affectationsprimaires/ },
  GE: {
    subTheme: /ch\.GE\.Zonedaffectationprimaire/,
    parseCode: (legend) => /^zone\s+\d+\w?\b/i.exec(legend.trim())?.[0] ?? parseZoneCode(legend),
  },
  GR: { themeCodes: /^(ch\.GR\.NutzungsplanungZpGgp|ch\.Nutzungsplanung)$/, typeCodeInclude: /-f1\d{4}-/ },
  JU: { typeCodeInclude: /affectations_primaires/ },
  LU: { typeCodeExclude: /^(7|9)/ },
  NE: { subTheme: /ch\.NE\.Affectationsprimaires/ },
  NW: { subTheme: GRUNDNUTZUNG },
  OW: { subTheme: GRUNDNUTZUNG },
  SH: { typeCodeExclude: /^sh\.\w+\.[56]/ },
  SO: { typeCodeInclude: /^[1-4]/ },
  TG: { subTheme: /ch\.TG\.NutzungsplanungGrundnutzung/ },
  UR: { subTheme: GRUNDNUTZUNG },
  VD: {
    subTheme: /ch\.VD\.Affectationsprimaires/,
    cleanLegend: (legend) => legend.replace(/\s*\b15\s*LAT\b\s*/i, " ").replace(/\s+/g, " ").trim(),
  },
  ZG: { typeCodeExclude: /^6/ },
  ZH: { subTheme: /ch\.ZH\.NutzungsplanungGrundnutzung/ },
};

export function zoneRuleFor(canton: string): ZoneRule {
  return { ...DEFAULT_ZONE_RULE, ...OVERRIDES[canton.trim().toUpperCase()] };
}

function isCandidate(t: OerebTheme, rule: ZoneRule): boolean {
  if (t.concern !== "affects" || !rule.themeCodes.test(t.themeCode)) return false;
  if (!t.legendText && !t.typeCode) return false;
  if (rule.subTheme && !rule.subTheme.test(t.subTheme ?? "")) return false;
  const code = t.typeCode ?? "";
  if (rule.typeCodeInclude && !rule.typeCodeInclude.test(code)) return false;
  if (rule.typeCodeExclude && rule.typeCodeExclude.test(code)) return false;
  return true;
}

interface LegendGroup {
  legend: string;
  typeCode: string | null;
  /** Summe der Flächenanteile; ohne Angabe −1. */
  area: number;
}

/** Gleiche Legende, Flächen summiert (UR: «Kernzone 1» in drei Zeilen). Grösster Anteil zuerst. */
function groupByLegend(themes: OerebTheme[], rule: ZoneRule): LegendGroup[] {
  const groups = new Map<string, LegendGroup>();
  for (const t of themes) {
    const raw = t.legendText ?? t.typeCode ?? "";
    const legend = rule.cleanLegend ? rule.cleanLegend(raw) : raw.trim();
    const group = groups.get(legend) ?? { legend, typeCode: t.typeCode, area: -1 };
    if (t.areaPct !== null) group.area = (group.area < 0 ? 0 : group.area) + t.areaPct;
    groups.set(legend, group);
  }
  return Array.from(groups.values()).sort((a, b) => b.area - a.area);
}

/** Planänderungen bestimmen die Zone nur, wenn nichts Rechtskräftiges vorliegt. */
function preferInForce(themes: OerebTheme[]): OerebTheme[] {
  const inForce = themes.filter((t) => t.legalStatus !== "changeWithPreEffect" && t.legalStatus !== "changeWithoutPreEffect");
  return inForce.length ? inForce : themes;
}

export function applyZoneRule(extract: OerebExtract, rule: ZoneRule, source: string): ZoneResult {
  const candidates = preferInForce(extract.themes.filter((t) => isCandidate(t, rule)));
  const none: ZoneResult = { zone: null, confidence: "none", source };
  if (!candidates.length) return none;

  const legendOf = (t: OerebTheme) => t.legendText ?? t.typeCode ?? "";
  const kept = candidates.filter((t) => !rule.legendExclude.test(legendOf(t)));
  const primary = kept.filter((t) => !rule.legendSecondary.test(legendOf(t)));

  if (!primary.length) {
    const best = groupByLegend(kept, rule)[0];
    return best ? { zone: best.legend, confidence: "low", source } : none;
  }

  const groups = groupByLegend(primary, rule);
  const best = groups[0];
  const code = rule.typeCodeIsShort ? best.typeCode : rule.parseCode(best.legend, best.typeCode);

  // Ohne filternde Kantonsregel entscheidet der Flächenanteil allein: bei zwei grossen
  // Legenden ist das zu unsicher, auch wenn eine davon ein Kürzel trägt.
  const hasFilter = !!(rule.subTheme || rule.typeCodeInclude || rule.typeCodeExclude);
  if (!hasFilter && groups.length > 1 && best.area >= 40 && groups[1].area >= 40) {
    return { zone: code ?? best.legend, confidence: "low", source };
  }

  if (code) return { zone: code, confidence: "exact", source };
  if (ZONE_TERM.test(best.legend)) return { zone: best.legend, confidence: "coarse", source };
  return { zone: best.legend, confidence: "low", source };
}
