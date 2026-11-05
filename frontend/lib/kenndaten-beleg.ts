/**
 * Prüfung der Modellangaben fürs Kenndatenblatt: Steht die Stelle wörtlich im Normtext, steht die Zahl
 * darin, und gehört sie zur Zone des Projekts? Rein. Was hier durchfällt, erscheint nicht auf dem Blatt.
 */
import { parseZoneCode } from "@/lib/oereb/zone-rules";
import { KENNDATEN_FELDER, type KenndatenAuswertung, type KenndatenFeld, type KenndatenWert, type KenndatenWerte } from "@/lib/kenndaten";

export type ModellEinheit = "m" | "cm" | "mm" | "";

/** Eine Angabe des Modells, noch ungeprüft. `normIndex` ist 1-basiert. */
export interface KenndatenKandidat {
  feld: KenndatenFeld;
  zahl: number | null;
  einheit: ModellEinheit;
  text: string | null;
  zusatz: string | null;
  bezeichnung: string | null;
  normIndex: number;
  artikel: string | null;
  zitat: string;
  zoneImText: string;
  giltFuerAlleZonen: boolean;
}

/** Eine dem Modell vorgelegte Norm. `text` ist genau das, was das Modell gesehen hat. */
export interface BelegNorm {
  title: string;
  layer: number;
  text: string;
}

// ── Zahlen ───────────────────────────────────────────────────────────────────

/** Keine Ziffern in Zonennamen (W2) und keine Fussnotenzeichen (4)). 13.50 enthält nicht 3.50. */
const NUMBER_SOURCE = "(?<![\\p{L}\\d.,'’])(?:\\d{1,3}(?:['’]\\d{3})+(?:[.,]\\d+)?|\\d+(?:[.,]\\d+)?)(?!\\d*\\))";
const numberRe = () => new RegExp(NUMBER_SOURCE, "gu");

function canonicalNumber(raw: string): number {
  return Number(raw.replace(/['’]/g, "").replace(",", "."));
}

/** Alle Zahlen eines Texts als Werte: 3.50, 3,50 und 3.5 sind dieselbe Zahl. */
export function numbersIn(text: string): Set<number> {
  return new Set(Array.from(text.matchAll(numberRe()), (m) => canonicalNumber(m[0])));
}

export function numberInText(value: number, text: string): boolean {
  return numbersIn(text).has(value);
}

const ZAHLWORTE = ["ein", "zwei", "drei", "vier", "fünf", "sechs"];
const ROEMISCH = ["I", "II", "III", "IV", "V", "VI"];

/** Wort und römische Zahl zählen nur neben «gesch»: «ES II» ist eine Lärmstufe, keine Geschosszahl. */
function geschossWortInText(value: number, text: string): boolean {
  const wort = ZAHLWORTE[value - 1];
  if (!wort) return false;
  const roemisch = ROEMISCH[value - 1];
  return (
    new RegExp(`(?<![\\p{L}])${wort}(?:e|es|er)?[\\s-]*(?:voll)?gesch`, "iu").test(text) ||
    new RegExp(`(?<![\\p{L}])${roemisch}[\\s-]*(?:voll)?[Gg]esch`, "u").test(text) ||
    new RegExp(`[Gg]eschoss\\p{L}*[\\s:]*${roemisch}(?![\\p{L}])`, "u").test(text)
  );
}

// ── Normalisierter Text ──────────────────────────────────────────────────────

const JOIN_HYPHEN = new RegExp("(\\p{L})-\\s+(\\p{Ll})", "gu");

/** Tolerant nur bei Leerraum, Tabellenstrichen und Silbentrennung. */
function normalizeLine(s: string): string {
  return s
    .normalize("NFC")
    .replace(/­/g, "")
    .replace(/[|\s]+/g, " ")
    .replace(JOIN_HYPHEN, "$1$2")
    .trim();
}

const ENDS_HYPHEN = new RegExp("\\p{L}-$", "u");
const STARTS_LOWER = new RegExp("^\\p{Ll}", "u");

/** Zeilen ohne Leerzeilen; eine am Zeilenende getrennte Silbe kommt zurück in ihre Zeile. */
function logicalLines(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = normalizeLine(raw);
    if (!line) continue;
    const last = out[out.length - 1];
    if (last !== undefined && ENDS_HYPHEN.test(last) && STARTS_LOWER.test(line)) out[out.length - 1] = last.slice(0, -1) + line;
    else out.push(line);
  }
  return out;
}

/** Wo steht das Zitat? `von` und `bis` nur, wenn es ganz in einer Zeile steht. */
interface Fundstelle {
  zeile: number;
  von: number | null;
  bis: number | null;
}

function findeZitat(zitat: string, lines: string[]): Fundstelle[] {
  const wanted = normalizeLine(zitat).toLowerCase();
  if (!wanted) return [];
  const hits: Fundstelle[] = [];
  lines.forEach((line, zeile) => {
    const lower = line.toLowerCase();
    for (let at = lower.indexOf(wanted); at >= 0; at = lower.indexOf(wanted, at + 1)) {
      hits.push({ zeile, von: at, bis: at + wanted.length });
    }
  });
  if (hits.length > 0) return hits;

  // Fliesstext über mehrere Zeilen.
  const joined = lines.join(" ").toLowerCase();
  let offset = 0;
  const starts = lines.map((l) => {
    const s = offset;
    offset += l.length + 1;
    return s;
  });
  for (let at = joined.indexOf(wanted); at >= 0; at = joined.indexOf(wanted, at + 1)) {
    let zeile = starts.findIndex((s) => s > at) - 1;
    if (zeile < 0) zeile = lines.length - 1;
    hits.push({ zeile, von: null, bis: null });
  }
  return hits;
}

/** Das Zitat steht als zusammenhängende Wortfolge im Normtext. */
export function zitatInText(zitat: string, text: string): boolean {
  return findeZitat(zitat, logicalLines(text)).length > 0;
}

/** «Art. 12» muss es im Normtext geben. Freie Angaben wie «Zonentabelle» bleiben ungeprüft. */
export function artikelInText(artikel: string, text: string): boolean {
  const m = artikel.match(/(art(?:ikel|\.)?|§|anhang|ziff(?:er|\.)?)\s*(\d+[a-z]?)/i);
  if (!m) return true;
  const word = m[1].toLowerCase();
  const family = word.startsWith("art") ? "art(?:ikel|\\.)?" : word === "§" ? "§" : word === "anhang" ? "anhang" : "ziff(?:er|\\.)?";
  return new RegExp(`${family}\\s*${m[2]}(?![\\da-z])`, "i").test(text);
}

// ── Zone ─────────────────────────────────────────────────────────────────────

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const LANGFORM: [RegExp, string, string][] = [
  [/wohn[\s-]*(?:und[\s-]*)?gewerbe[\s-]*zone\s+(\d+)/i, "WG", "wohn[\\s-]*(?:und[\\s-]*)?gewerbe[\\s-]*zone"],
  [/dorf(?:kern)?[\s-]*zone\s+(\d+)/i, "D", "dorf(?:kern)?[\\s-]*zone"],
  [/kern[\s-]*zone\s+(\d+)/i, "K", "kern[\\s-]*zone"],
  [/wohn[\s-]*zone\s+(\d+)/i, "W", "wohn[\\s-]*zone"],
];

/** Was alles dieselbe Zone meint: der Eintrag, sein Kürzel und die Langform zum Kürzel. */
function zoneVariants(zone: string): string[] {
  const out = new Set<string>();
  const add = (v: string | null | undefined) => {
    if (v?.trim()) out.add(v.trim());
  };
  add(zone);
  add(parseZoneCode(zone));
  for (const [re, prefix] of LANGFORM) {
    const m = re.exec(zone);
    if (m) add(`${prefix}${m[1]}`);
  }
  return Array.from(out);
}

/** Tokengrenzen: W2 trifft weder W21 noch W2a noch W2-B oder «W2 - B». */
function zoneRegexes(zone: string): RegExp[] {
  const res: RegExp[] = [];
  for (const v of zoneVariants(zone)) {
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

/** Im Zweifel nein: W2 passt zu «Wohnzone 2 Geschosse» und «W2, W3», aber nicht zu W3, W21, W2-B oder «Wohnzone». */
export function zoneMatches(projectZone: string, zoneImText: string): boolean {
  return zoneRegexes(projectZone).some((re) => {
    re.lastIndex = 0;
    return re.test(zoneImText);
  });
}

/** Zonenkürzel mit Ziffer, auch fremde. Kürzel ohne Ziffer sind vom Wortschatz nicht zu trennen. */
const CODE_SOURCE = "(?<![\\p{L}\\p{N}])[A-ZÄÖÜ]{1,3}\\d{1,2}[A-Za-z]?(?:\\s?-\\s?[A-Z](?![\\p{L}\\p{N}]))?";

interface Treffer {
  at: number;
  end: number;
}

function zonenTreffer(line: string, zone: string): { eigene: Treffer[]; fremde: Treffer[] } {
  const eigene: Treffer[] = [];
  for (const re of zoneRegexes(zone)) {
    for (const m of Array.from(line.matchAll(re))) eigene.push({ at: m.index!, end: m.index! + m[0].length });
  }
  const fremde = Array.from(line.matchAll(new RegExp(CODE_SOURCE, "gu")))
    .map((m) => ({ at: m.index!, end: m.index! + m[0].length }))
    .filter((c) => !eigene.some((e) => c.at < e.end && e.at < c.end));
  return { eigene, fremde };
}

/**
 * Gehört die Zahl im Bereich [von, bis) zur Zone? Zonen stehen vor ihren Werten: «W2 / WG2 2 0.45» ist eine
 * Gruppe, die erste Zahl danach beendet sie. Steht in der Zeile nur die eigene Zone, darf sie auch folgen.
 */
function zahlGehoertZurZone(line: string, zone: string, von: number, bis: number, ziel: number): boolean {
  const { eigene, fremde } = zonenTreffer(line, zone);
  if (eigene.length === 0) return false;
  if (fremde.length === 0) {
    return Array.from(line.matchAll(numberRe())).some((m) => m.index! >= von && m.index! < bis && canonicalNumber(m[0]) === ziel);
  }
  type Ereignis = { at: number; art: "eigen" | "fremd" } | { at: number; art: "zahl"; wert: number };
  const ereignisse: Ereignis[] = [
    ...eigene.map((t): Ereignis => ({ at: t.at, art: "eigen" })),
    ...fremde.map((t): Ereignis => ({ at: t.at, art: "fremd" })),
    ...Array.from(line.matchAll(numberRe())).map((m): Ereignis => ({ at: m.index!, art: "zahl", wert: canonicalNumber(m[0]) })),
  ].sort((a, b) => a.at - b.at);

  let gruppeEigen = false;
  let nachZahl = false;
  for (const e of ereignisse) {
    if (e.art === "zahl") {
      nachZahl = true;
      if (gruppeEigen && e.wert === ziel && e.at >= von && e.at < bis) return true;
      continue;
    }
    if (nachZahl) {
      gruppeEigen = false;
      nachZahl = false;
    }
    gruppeEigen = gruppeEigen || e.art === "eigen";
  }
  return false;
}

const HEADING_RE = /^(?:art(?:ikel|icle|icolo|\.)?|§)\s*\d/i;

/** Die Überschrift, unter der eine Zeile steht: der Artikelkopf und eine kurze Zeile direkt darüber. */
function ueberschriften(lines: string[], zeile: number): string[] {
  const out: string[] = [];
  const davor = lines[zeile - 1];
  if (davor && davor.length <= 60) out.push(davor);
  for (let i = zeile; i >= 0 && i >= zeile - 60; i--) {
    if (HEADING_RE.test(lines[i])) {
      out.push(lines[i]);
      break;
    }
  }
  return out;
}

const AUSNAHME_RE = /\b(?:ausser|ausgenommen|ausnahme|excepté|sauf|eccetto|tranne)\b/i;

/** Nur wörtlich alle Zonen: «alle Wohnzonen» gilt nicht für die Kernzone, «alle ausser W2» nicht für W2. */
const ALLE_ZONEN_RE = /^(?:in\s+|für\s+)?(?:alle[n]?|sämtliche[n]?|jede[r]?)(?:\s+(?:bau)?zonen?)?$|^allgemein$|^toutes les zones$|^tutte le zone$/i;

function giltAllgemein(zoneImText: string): boolean {
  return ALLE_ZONEN_RE.test(zoneImText.trim());
}

/** Eine allgemeine Bestimmung darf nicht in einem Artikel oder einer Zeile einer bestimmten anderen Zone stehen. */
function allgemeinOk(lines: string[], f: Fundstelle, zitat: string, zone: string): boolean {
  if (AUSNAHME_RE.test(zitat)) return false;
  return [lines[f.zeile], ...ueberschriften(lines, f.zeile)].every((t) => {
    const { eigene, fremde } = zonenTreffer(t, zone);
    return eigene.length > 0 || fremde.length === 0;
  });
}

/** Zone im Zitat, in derselben Tabellenzeile oder in der Überschrift, nie nur als Aussage des Modells. */
function zoneGebunden(lines: string[], f: Fundstelle, zitat: string, zone: string, ziel: number | null): boolean {
  const line = lines[f.zeile];
  const norm = normalizeLine(zitat);
  const pruefe = (t: string, von: number, bis: number) => {
    if (ziel != null) return zahlGehoertZurZone(t, zone, von, bis, ziel);
    const { eigene, fremde } = zonenTreffer(t, zone);
    return eigene.length > 0 && fremde.length === 0;
  };
  if (f.von != null && f.bis != null) {
    if (pruefe(line, f.von, f.bis)) return true;
  } else if (pruefe(norm, 0, norm.length)) {
    return true;
  }
  // Nennt die Zeile selbst keine Zone, zählt die Überschrift.
  const hier = f.von != null ? line : norm;
  const { eigene, fremde } = zonenTreffer(hier, zone);
  if (eigene.length > 0 || fremde.length > 0) return false;
  return ueberschriften(lines, f.zeile).some((t) => zonenTreffer(t, zone).eigene.length > 0);
}

// ── Prüfung eines Kandidaten ─────────────────────────────────────────────────

/** `zone`: Das Modell nennt selbst eine andere Zone. `beleg`: nicht belegt oder nicht an die Zone gebunden. */
export type Verwerfung = "zone" | "beleg";

const MAX_ZITAT = 500;

function wordsOf(text: string): string[] {
  return text.toLowerCase().match(new RegExp("[\\p{L}\\p{N}]+", "gu")) ?? [];
}

/** Die Einheit im Zitat muss zur Angabe passen: «250 cm» ist nie 250 m. Ohne Einheit (Tabelle) passt sie. */
function einheitPasst(zitat: string, zahl: number, einheit: string): boolean {
  const unit = new RegExp("^\\s*(cm|mm|m(?![\\p{L}\\d²³])|%|‰)", "u");
  return Array.from(zitat.matchAll(numberRe()))
    .filter((m) => canonicalNumber(m[0]) === zahl)
    .some((m) => {
      const found = unit.exec(zitat.slice(m.index! + m[0].length))?.[1];
      return !found || found === einheit;
    });
}

const IST_MASS = (f: KenndatenFeld) => !["vollgeschosse", "ausnuetzungsziffer", "baumassenziffer", "ueberbauungsziffer", "dachform"].includes(f);

function normalize(k: KenndatenKandidat): { zahl: number | null; text: string | null } | null {
  if (k.feld === "dachform") {
    const text = (k.text ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    return text ? { zahl: null, text } : null;
  }
  // Mehrere Strassenarten stehen im Zusatz, eine einzelne Zahl gäbe es dann nicht.
  if (k.feld === "strassenabstand" && k.zahl == null) return k.zusatz ? { zahl: null, text: null } : null;
  if (k.zahl == null || !Number.isFinite(k.zahl) || k.zahl <= 0) return null;
  if (k.feld === "vollgeschosse") return Number.isInteger(k.zahl) && k.zahl <= 30 && k.einheit === "" ? { zahl: k.zahl, text: null } : null;
  if (!IST_MASS(k.feld)) return k.einheit === "" && k.zahl <= 10 ? { zahl: k.zahl, text: null } : null;
  const metres = k.einheit === "cm" ? k.zahl / 100 : k.einheit === "mm" ? k.zahl / 1000 : k.zahl;
  return metres <= 300 ? { zahl: metres, text: null } : null;
}

export function pruefeKandidat(
  k: KenndatenKandidat,
  norm: BelegNorm | undefined,
  projectZone: string,
): { ok: true; wert: KenndatenWert } | { ok: false; grund: Verwerfung } {
  const beleg = { ok: false as const, grund: "beleg" as const };
  if (!norm) return beleg;

  const zoneText = k.zoneImText.trim();
  const allgemein = k.giltFuerAlleZonen && giltAllgemein(zoneText);
  // Nennt das Modell selbst eine andere Zone, sagt die Angabe nichts über diese Zone.
  if (!allgemein && !k.giltFuerAlleZonen && zoneText && !zoneMatches(projectZone, zoneText)) return { ok: false, grund: "zone" };
  if (k.giltFuerAlleZonen && !allgemein) return beleg;

  const value = normalize(k);
  const zitat = k.zitat.trim();
  if (!value || !zitat || zitat.length > MAX_ZITAT) return beleg;

  const lines = logicalLines(norm.text);
  const stellen = findeZitat(zitat, lines);
  if (stellen.length === 0) return beleg;

  // Geprüft wird die Zahl, wie sie im Text steht (750 cm), nicht die umgerechnete.
  let ziel: number | null = null;
  if (value.zahl != null) {
    const steht = numberInText(k.zahl!, zitat);
    if (steht) {
      const effektiv = k.einheit || (IST_MASS(k.feld) ? "m" : "");
      if (!einheitPasst(zitat, k.zahl!, effektiv)) return beleg;
      ziel = k.zahl!;
    } else if (!(k.feld === "vollgeschosse" && geschossWortInText(k.zahl!, zitat))) {
      return beleg;
    }
  } else if (value.text != null) {
    const known = new Set(wordsOf(zitat));
    const wesentlich = wordsOf(value.text).filter((w) => w.length >= 4);
    if (wesentlich.length === 0 || !wesentlich.every((w) => known.has(w))) return beleg;
  }

  const gebunden = stellen.some((f) => (allgemein ? allgemeinOk(lines, f, zitat, projectZone) : zoneGebunden(lines, f, zitat, projectZone, ziel)));
  if (!gebunden) return beleg;

  // Jede Zahl aus Zusatz und Dachform muss ebenfalls im Normtext stehen.
  const maxZusatz = k.feld === "strassenabstand" ? 200 : 80;
  const zusatz = (k.zusatz ?? "").replace(/^\(|\)$/g, "").replace(/\s+/g, " ").trim().slice(0, maxZusatz) || null;
  const normNumbers = numbersIn(norm.text);
  const zusatzZahlen = Array.from(numbersIn(`${zusatz ?? ""} ${value.text ?? ""}`));
  if (zusatzZahlen.some((n) => !normNumbers.has(n))) return beleg;
  if (value.zahl == null && value.text == null && !zusatzZahlen.some((n) => numberInText(n, zitat))) return beleg;

  const artikel = (k.artikel ?? "").trim();
  const bezeichnung = (k.bezeichnung ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  const bekannt = new Set(wordsOf(norm.text));
  return {
    ok: true,
    wert: {
      ...value,
      zusatz,
      bezeichnung: bezeichnung && wordsOf(bezeichnung).every((w) => bekannt.has(w)) ? bezeichnung : null,
      normTitle: norm.title,
      artikel: artikel && artikelInText(artikel, norm.text) ? artikel.slice(0, 40) : null,
      layer: norm.layer,
    },
  };
}

// ── Vorrang der Ebenen ───────────────────────────────────────────────────────

/** Gemeinde vor projektbezogener Spezialnorm vor Kanton vor Bund. */
export function layerRank(layer: number): number {
  return layer === 4 ? 0 : layer === 5 ? 1 : layer === 3 ? 2 : 3;
}

function sameValue(a: KenndatenWert, b: KenndatenWert): boolean {
  return a.zahl === b.zahl && (a.text ?? "").toLowerCase() === (b.text ?? "").toLowerCase() && (a.zahl != null || a.text != null || a.zusatz === b.zusatz);
}

/**
 * Pro Feld der Wert der höchsten Ebene, die einen hat. Ein Wert einer anderen Zone sagt nichts über
 * diese Zone, die nächste Ebene darf einspringen. Eine unbelegte Angabe heisst dagegen: Die Gemeinde
 * regelt es vermutlich, wir können es nur nicht belegen. Dann bleibt das Feld leer, sonst stünde
 * dort der Kantonswert, den die Gemeinde womöglich verschärft hat.
 */
export function waehleWerte(kandidaten: KenndatenKandidat[], normen: BelegNorm[], projectZone: string): KenndatenAuswertung {
  const werte: KenndatenWerte = {};
  const widerspruechlich: KenndatenFeld[] = [];
  const unbelegt: KenndatenFeld[] = [];
  let verworfen = 0;

  for (const feld of KENNDATEN_FELDER) {
    const ranks = new Map<number, { ok: KenndatenWert[]; unbelegt: boolean }>();
    for (const k of kandidaten.filter((c) => c.feld === feld)) {
      const norm = normen[k.normIndex - 1];
      const result = pruefeKandidat(k, norm, projectZone);
      if (!result.ok) verworfen += 1;
      if (!norm) continue;
      const rank = layerRank(norm.layer);
      const entry = ranks.get(rank) ?? { ok: [], unbelegt: false };
      if (result.ok) entry.ok.push(result.wert);
      else if (result.grund === "beleg") entry.unbelegt = true;
      ranks.set(rank, entry);
    }
    for (const rank of Array.from(ranks.keys()).sort((a, b) => a - b)) {
      const entry = ranks.get(rank)!;
      if (entry.ok.length > 0) {
        if (entry.ok.every((w) => sameValue(w, entry.ok[0]))) werte[feld] = entry.ok[0];
        else widerspruechlich.push(feld);
        break;
      }
      if (entry.unbelegt) {
        unbelegt.push(feld);
        break;
      }
    }
  }
  return { werte, widerspruechlich, unbelegt, verworfen, hinweise: [], vorbehalt: false };
}
