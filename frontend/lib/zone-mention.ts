/**
 * Zonennennungen in Normtexten erkennen: eigene Zone, fremde Zonen, Zonenfamilien. Rein und ohne
 * Imports aus lib/oereb, damit es auch im Browser läuft (Kenndatenblatt auf dem Server, Normen-Tab
 * im Browser). Unicode-Klassen nur über `new RegExp`, vgl. lib/norm-structure.ts.
 */

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const LANGFORM: [RegExp, string, string][] = [
  [/wohn[\s-]*(?:und[\s-]*)?gewerbe[\s-]*zone\s+(\d+)/i, "WG", "wohn[\\s-]*(?:und[\\s-]*)?gewerbe[\\s-]*zone"],
  [/dorf(?:kern)?[\s-]*zone\s+(\d+)/i, "D", "dorf(?:kern)?[\\s-]*zone"],
  [/kern[\s-]*zone\s+(\d+)/i, "K", "kern[\\s-]*zone"],
  [/wohn[\s-]*zone\s+(\d+)/i, "W", "wohn[\\s-]*zone"],
];

/**
 * Was alles dieselbe Zone meint: der Eintrag, sein Kürzel und die Langform zum Kürzel. `extra`: weitere
 * Schreibweisen, die der Aufrufer kennt (auf dem Server das Kürzel aus der ÖREB-Legende).
 */
export function zoneVariants(zone: string, extra: readonly (string | null | undefined)[] = []): string[] {
  const out = new Set<string>();
  const add = (v: string | null | undefined) => {
    if (v?.trim()) out.add(v.trim());
  };
  add(zone);
  for (const e of extra) add(e);
  for (const [re, prefix] of LANGFORM) {
    const m = re.exec(zone);
    if (m) add(`${prefix}${m[1]}`);
  }
  return Array.from(out);
}

/** Tokengrenzen: W2 trifft weder W21 noch W2a noch W2-B oder «W2 - B». */
export function zoneRegexes(zone: string, extra: readonly (string | null | undefined)[] = []): RegExp[] {
  const res: RegExp[] = [];
  for (const v of zoneVariants(zone, extra)) {
    const pattern = escapeRe(v).replace(/\s+/g, "\\s*").replace(/\\?-/g, "\\s?-\\s?").replace(new RegExp("(\\p{L})(\\d)", "gu"), "$1\\s?$2");
    // Kurze Kürzel ohne Ziffer («I», «GI») nur in Grossschrift: «i» ist kein Zonenname.
    const flags = v.length <= 3 && !/\d/.test(v) ? "gu" : "giu";
    res.push(new RegExp(`(?<![\\p{L}\\p{N}-])${pattern}(?![\\p{L}\\p{N}])(?!\\s?-\\s?[\\p{L}\\p{N}])`, flags));
    const code = /^([A-Za-z]{1,2})(\d+)$/.exec(v);
    const lang = code && LANGFORM.find(([, prefix]) => prefix === code[1].toUpperCase());
    // «Wohnzone 2 Geschosse» ist W2, «Wohnzone b 2 Geschosse» nicht.
    if (code && lang) res.push(new RegExp(`${lang[2]}\\s+${code[2]}(?:[\\s-]*(?:voll)?gesch\\p{L}*)?(?![\\p{L}\\p{N}])`, "giu"));
  }
  return res;
}

/** Zonenkürzel mit Ziffer in jeder Schreibweise. Kürzel ohne Ziffer sind vom Wortschatz nicht zu trennen. */
export const CODE_SOURCE = "(?<![\\p{L}\\p{N}])\\p{L}{1,3}\\d{1,2}\\p{L}?(?![\\p{L}\\p{N}])(?:\\s?-\\s?\\p{L}(?![\\p{L}\\p{N}]))?";
/** Flächen und Volumen wie «m2» sind keine Zonen. */
export const KEIN_CODE = /^(?:m|cm|mm|dm|km|ha|co|h)\d$/i;
/** Langform: «Kernzone», «Wohnzone 3», «Zone 3», «Wohnzone W2 - B». «Zone» allein oder «Bauzone» nennt keine bestimmte Zone. */
export const LANGFORM_SOURCE =
  "(?<![\\p{L}\\p{N}])(?:(?!bauzone)\\p{L}+zonen?(?![\\p{L}\\p{N}])(?:[\\s-]+(?:\\d{1,2}|\\p{L}{1,3}\\d{0,2}\\p{L}?)(?![\\p{L}\\p{N}]))?|zone\\s+\\d{1,2}(?![\\p{L}\\p{N}]))(?:\\s?-\\s?\\p{L}(?![\\p{L}\\p{N}]))?";

const CODE_RE = new RegExp(CODE_SOURCE, "gu");
const LANGFORM_RE = new RegExp(LANGFORM_SOURCE, "giu");

export interface ZoneHit {
  at: number;
  end: number;
}

export interface ZoneHits {
  eigene: ZoneHit[];
  /** Kürzel und Langformen, die nicht die eigene Zone sind. `art` sagt, welches Muster traf. */
  fremde: (ZoneHit & { art: "code" | "langform" })[];
}

/** Eigene und fremde Zonennennungen einer Zeile, mit bereits gebauten Mustern der eigenen Zone. */
export function zoneHitsWith(line: string, own: readonly RegExp[]): ZoneHits {
  const eigene: ZoneHit[] = [];
  for (const re of own) {
    for (const m of Array.from(line.matchAll(re))) eigene.push({ at: m.index!, end: m.index! + m[0].length });
  }
  const codes = Array.from(line.matchAll(CODE_RE))
    .filter((m) => !KEIN_CODE.test(m[0]))
    .map((m) => ({ at: m.index!, end: m.index! + m[0].length, art: "code" as const }));
  const langformen = Array.from(line.matchAll(LANGFORM_RE)).map((m) => ({
    at: m.index!,
    end: m.index! + m[0].length,
    art: "langform" as const,
  }));
  const fremde = [...codes, ...langformen].filter((c) => !eigene.some((e) => c.at < e.end && e.at < c.end));
  return { eigene, fremde };
}

/** Eigene und fremde Zonennennungen einer Zeile. */
export function zoneHits(line: string, zone: string, extra: readonly (string | null | undefined)[] = []): ZoneHits {
  return zoneHitsWith(line, zoneRegexes(zone, extra));
}

// ── Familien ─────────────────────────────────────────────────────────────────

/** Konservativ: nur Kürzel, deren Familie eindeutig ist. Unbekannt heisst: nie fremd. */
const CODE_FAMILIES: Readonly<Record<string, readonly string[]>> = {
  W: ["wohn"],
  WG: ["wohn", "gewerbe"],
  K: ["kern"],
  KZ: ["kern"],
  D: ["dorf", "kern"],
  DK: ["dorf", "kern"],
  G: ["gewerbe", "industrie"],
  GE: ["gewerbe", "industrie"],
  I: ["industrie", "gewerbe"],
  IN: ["industrie", "gewerbe"],
  GI: ["industrie", "gewerbe"],
  OE: ["öffentlich"],
  ÖBA: ["öffentlich"],
  OEBA: ["öffentlich"],
  L: ["landwirtschaft"],
  LW: ["landwirtschaft"],
};

const FAMILY_WORDS: [RegExp, string][] = [
  [/wohn/i, "wohn"],
  [/gewerbe/i, "gewerbe"],
  [/kern/i, "kern"],
  [/dorf/i, "dorf"],
  [/industrie/i, "industrie"],
  [/öffentlich|oeffentlich/i, "öffentlich"],
  [/landwirtschaft/i, "landwirtschaft"],
];

const ZONE_CODE_SHAPE = new RegExp("^(\\p{L}{1,4})\\s?-?\\s?\\d{0,2}\\p{Ll}?(?:\\s?-\\s?\\p{L})?$", "u");

/** Familie der Projektzone («W2» → wohn). Null, wenn das Kürzel nicht eindeutig zuzuordnen ist. */
export function zoneFamilies(zone: string): ReadonlySet<string> | null {
  const z = zone.trim();
  const m = ZONE_CODE_SHAPE.exec(z);
  if (m) {
    const fam = CODE_FAMILIES[m[1].toUpperCase()];
    return fam ? new Set(fam) : null;
  }
  for (const [re, prefix] of LANGFORM) {
    if (re.test(z)) return new Set(CODE_FAMILIES[prefix]);
  }
  return null;
}

/** Familien eines Zonenworts («Kernzonen» → kern). Null, wenn kein bekanntes Familienwort vorkommt. */
export function mentionFamilies(mention: string): ReadonlySet<string> | null {
  const out = new Set<string>();
  for (const [re, fam] of FAMILY_WORDS) if (re.test(mention)) out.add(fam);
  return out.size > 0 ? out : null;
}

const OVERLAY_RE =
  /schutz|gefahr|gewässer|gewaesser|grundwasser|überlager|ueberlager|lärm|laerm|wald|ortsbild|bauzone|nichtbau|erdbeben|empfindlichkeit|parkier/i;
/** Lärmempfindlichkeitsstufe als Kürzel: «ES II», «ES3». Nur in Grossschrift. */
const ES_RE = new RegExp("(?<![\\p{L}\\p{N}])ES(?:\\s?(?:I{1,3}|IV|\\d))?(?![\\p{L}\\p{N}])", "u");
const GENERIC_RE = /^(?:(?:alle[nrs]?|sämtliche[nr]?|saemtliche[nr]?|übrige[nr]?|uebrige[nr]?|jede[nrs]?|andere[nrs]?)\s+)?zonen?$/i;
/** «alle Zonen», «sämtliche Bauzonen», «übrigen Zonen», «anderen Bauzonen», «in allen Wohnzonen»: Sammelbegriff. */
export const ALL_ZONES_RE = new RegExp(
  "(?<![\\p{L}\\p{N}])(?:alle[nrs]?|sämtliche[nr]?|saemtliche[nr]?|übrige[nr]?|uebrige[nr]?|jede[nrs]?|andere[nrs]?)\\s+(?:\\p{L}*zonen?)(?![\\p{L}\\p{N}])",
  "iu",
);

/** Überlagerungen und Sammelbegriffe sind nie eine fremde Zone. */
export function isOverlayOrGeneric(mention: string): boolean {
  const t = mention.trim();
  return OVERLAY_RE.test(t) || ES_RE.test(t) || GENERIC_RE.test(t) || ALL_ZONES_RE.test(t);
}

/**
 * Kürzel im Projekteintrag, falls dort eine Legende steht («Wohnzone 2 [W2]», «W2 Wohnzone»): eckige
 * Klammer, sonst ein einziges Kürzel mit Ziffer. Ersatz für parseZoneCode im Browser, im Zweifel null.
 */
export function zoneCodeHint(zone: string): string | null {
  const square = /\[([^\]\s]{1,12})\]/.exec(zone);
  if (square) return square[1];
  const codes = Array.from(zone.matchAll(CODE_RE)).filter((m) => !KEIN_CODE.test(m[0]));
  if (codes.length !== 1) return null;
  const code = codes[0][0].trim();
  return code !== zone.trim() ? code : null;
}
