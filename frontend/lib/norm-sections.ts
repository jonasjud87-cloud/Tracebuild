/**
 * Welche Artikel einer Norm gelten für die Zone der Parzelle? Rein, ohne Netz und ohne Modell, läuft im
 * Browser. Grundsatz: im Zweifel zeigen. Eingeklappt wird nur ein Artikel, dessen Titel ausdrücklich nur
 * andere Zonen nennt und der weder die eigene Zone noch ihre Familie noch «alle/andere Zonen» erwähnt. Die Analyse bekommt
 * weiterhin den vollen Text; das hier betrifft nur die Anzeige.
 */
import type { ArticleBlock, BodyBlock, NormBlock, ParsedNorm } from "./norm-structure";
import {
  ALL_ZONES_RE,
  LANGFORM,
  isOverlayOrGeneric,
  mentionFamilies,
  zoneCodeHint,
  zoneFamilies,
  zoneHitsWith,
  zoneRegexes,
  zoneVariants,
} from "./zone-mention";

export type SectionInactive =
  | "no-zone"
  | "zone-unsure"
  | "not-loaded"
  | "unstructured"
  | "zone-tagged"
  | "layer"
  | "zone-not-named"
  | "nothing-hidden";

export interface SectionContext {
  zone: string | null;
  zoneConfidence: string | null;
  /** Herkunft der Zone. «oereb» ohne Konfidenz gilt als unsicher; ohne Angabe wie manuell. */
  zoneSource?: string | null;
  layer: number;
  /** `norms.zone`: Zonenbindung der ganzen Norm (CSV). */
  normZone: string | null;
  fullTextLoaded: boolean;
  /** Ebenen, auf denen gefiltert wird. Ohne Angabe SECTION_LAYERS. */
  layers?: ReadonlySet<number>;
}

export type BlockVerdict = { show: true; ownZone: boolean } | { show: false; zones: string[] };

export interface SectionSelection {
  active: boolean;
  inactive: SectionInactive | null;
  /** Indexgleich zu parsed.blocks. */
  verdicts: BlockVerdict[];
  shownArticles: number;
  hiddenArticles: number;
}

export interface HiddenRun {
  /** Erster und letzter ausgeblendeter Block (inklusive). */
  from: number;
  to: number;
  labels: string[];
  zones: string[];
}

/**
 * v1 nur Gemeinde (Baureglement, Zonenreglement, kommunale ÖREB-Dokumente). Kantonale Erlasse nennen Zonen
 * meist in allgemeinen Artikeln; ein Einbezug (Ebene 3) geht über `SectionContext.layers`.
 */
export const SECTION_LAYERS: ReadonlySet<number> = new Set([4]);

const MIN_ARTICLES = 3;
const SHOW: BlockVerdict = { show: true, ownZone: false };
const ZONE_WORD = /zone/i;
/** Titel nur aus Kürzeln und Trennern: «W3», «W3 / W4», «W3, W4 und W5». */
const ONLY_CODES_RE = /^(?:[\s,;/+&–-]|und|oder|bis|sowie)*$/i;
/** Endung einer Langform ist ein Kürzel, kein Wort: «Kernzone K», «Wohnzone 3», nicht «Wohnzone für». */
const CODE_SUFFIX_RE = new RegExp("[\\s-]+(?:\\d{1,2}|\\p{Lu}[\\p{Lu}\\d]{0,2}\\p{Ll}?)(?:\\s?-\\s?\\p{L})?$", "u");

const SPLIT_WORD_RE = new RegExp("(\\p{L}+-\\s*(?:und|oder|bzw\\.)\\s+)$", "u");

function inactive(parsed: ParsedNorm, reason: SectionInactive): SectionSelection {
  return {
    active: false,
    inactive: reason,
    verdicts: parsed.blocks.map(() => SHOW),
    shownArticles: parsed.articleCount,
    hiddenArticles: 0,
  };
}

/** Inhalt eines Body-Blocks für die Suche nach der eigenen Zone. Fussnoten, Kopfzeilen, Hinweise nicht. */
function bodyText(b: BodyBlock): string {
  switch (b.kind) {
    case "paragraph":
      return `${b.marginal ?? ""}\n${b.text}`;
    case "list":
      return b.items.map((it) => it.text).join("\n");
    case "table":
      return b.rows.map((r) => r.join(" ")).join("\n");
    case "lines":
      return b.variant === undefined ? b.lines.join("\n") : "";
    case "page":
      return "";
  }
}

function blockText(b: NormBlock): string {
  switch (b.kind) {
    case "article":
      return [b.label, b.title ?? "", ...b.body.map(bodyText)].join("\n");
    case "heading":
      return b.text;
    case "toc":
      return "";
    default:
      return bodyText(b);
  }
}

/** Seitenmarken, Kopfzeilen, Fussnoten und Hinweise: folgen dem Nachbarn, nie eigener Inhalt. */
function isSide(b: NormBlock): boolean {
  return b.kind === "page" || (b.kind === "lines" && b.variant !== undefined);
}

interface Span {
  at: number;
  end: number;
}

/** Kürzel der Projektzone, zerlegt: «W2b» → W, 2, b. */
interface OwnCode {
  prefix: string;
  num: number;
  sub: string | null;
  /** Grosszügig: «W2», «W 2», «W-2», «w2», «W2¹», «W2a/b», «W2a, b». Gruppe 1: Buchstaben dahinter. */
  re: RegExp;
}

/**
 * Erkennung der eigenen Zone nur für die Anzeige. Grosszügiger als zoneRegexes (gemeinsam mit dem
 * Kenndatenblatt, dort bewusst streng), weil hier eine Nennung zu viel nur heisst: Artikel bleibt sichtbar.
 */
export interface Matcher {
  /** Gemeinsame strenge Muster (Langform «Wohnzone 2 Geschosse», Kürzel ohne Ziffer wie «K»). */
  strict: RegExp[];
  codes: OwnCode[];
  /** Kurzform «Zone 2» zur Projektzone «Wohnzone 2» bzw. «W2». */
  zoneShort: RegExp[];
  /** Eigene Nummer römisch (1–10): «W II», «Wohnzone II», «Zone II» bei W2. */
  roman: RegExp[];
  /** «Zone 2», «Zone II» ohne Familienwort: zählt je Artikel, nicht als Beleg («Grundwasserschutz Zone II»). */
  weak: ReadonlySet<RegExp>;
  families: ReadonlySet<string> | null;
}

const OWN_CODE_SHAPE = new RegExp("^(\\p{L}{1,3})\\s?-?\\s?(\\d{1,2})(\\p{Ll})?$", "u");
const SUPERSCRIPT = "[\\u00B9\\u00B2\\u00B3\\u2070-\\u2079]*";
/** Bereich mit gleichem Präfix: «W1–W3», «W1 - W3», «W1 bis W3», «WG2–WG4». Gruppen: Präfix, von, Präfix, bis. */
const RANGE_RE = new RegExp(
  "(?<![\\p{L}\\p{N}])(\\p{L}{1,3})\\s?(\\d{1,2})\\p{Ll}?\\s*(?:–|—|-|bis)\\s*(?:(\\p{L}{1,3})\\s?)?(\\d{1,2})\\p{Ll}?(?![\\p{L}\\p{N}])",
  "gu",
);
/** Kurzaufzählung ohne wiederholtes Präfix: «W1/2», «W 1/2», «W1 und 2», «W1, 2», «W1+2». Gruppen: Präfix, erste Zahl, Rest. */
const SHORT_LIST_RE = new RegExp(
  "(?<![\\p{L}\\p{N}])(\\p{L}{1,3})\\s?(\\d{1,2})\\p{Ll}?((?:\\s*(?:/|,|\\+|und)\\s*\\d{1,2}\\p{Ll}?(?![\\p{L}\\p{N}]))+)",
  "gu",
);
/** Langform mit Kürzel ohne Nummer: «Wohnzone W», «Wohn- und Gewerbezone WG». Gruppe 1: Kürzel. */
const STEM_RE = new RegExp("(?<![\\p{L}\\p{N}])\\p{L}*[Zz]onen?[\\s-]+(\\p{Lu}{1,3})(?![\\p{L}\\p{N}])", "gu");

const escapeChar =(c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

/** Buchstaben eines Musters gross und klein, Escapes («\s») unverändert: Ersatz für das Flag i. */
const ESCAPE_OR_LETTER_RE = new RegExp("\\\\.|\\p{L}", "gu");
const anyCase = (source: string) =>
  source.replace(ESCAPE_OR_LETTER_RE, (t) => (t.length > 1 ? t : `[${t.toLowerCase()}${t.toUpperCase()}]`));

/**
 * Römische Schreibweisen der eigenen Nummer. Ziffern nur in Grossschrift (ohne Flag i, sonst träfe «II» in
 * «III»), beim Kürzel mit Trenner («W II», «W-II»). Unterzone wie bei den Kürzeln: Projekt W2 trifft «IIa»,
 * Projekt W2b nur «II» und «IIb».
 */
function romanRegexes(codes: readonly OwnCode[]): { roman: RegExp[]; weak: RegExp[] } {
  const roman: RegExp[] = [];
  const weak: RegExp[] = [];
  const seen = new Set<string>();
  for (const c of codes) {
    const r = ROMAN[c.num];
    const key = `${c.prefix}${c.num}${c.sub ?? ""}`;
    if (!r || seen.has(key)) continue;
    seen.add(key);
    const sub = c.sub === null ? "\\p{Ll}?" : `(?:${escapeChar(c.sub)})?`;
    const end = `${r}${sub}(?![\\p{L}\\p{N}])`;
    roman.push(new RegExp(`(?<![\\p{L}\\p{N}-])${anyCase(c.prefix)}(?:\\s|\\s?-\\s?)${end}`, "gu"));
    const zoneOnly = new RegExp(`(?<![\\p{L}\\p{N}])Zonen?\\s+${end}`, "gu");
    roman.push(zoneOnly);
    weak.push(zoneOnly);
    // Langform wie bei arabischen Nummern nur zum eigenen Präfix: «Wohnzone II» bei W2, nicht «Kernzone II».
    const lang = LANGFORM.find(([, prefix]) => prefix === c.prefix);
    if (lang) roman.push(new RegExp(`${anyCase(lang[2])}[nN]?[\\s-]+${end}`, "gu"));
  }
  return { roman, weak };
}

const LIST_SEP = "(?:–|—|-|bis|/|,|\\+|und|oder)";
const NOT_ROMAN = "(?![IVX]{1,4}(?![\\p{L}\\p{N}]))";
const LIST_NUM = "(?:\\d{1,2}|[IVX]{1,4})";
/**
 * Bereich oder Aufzählung in Langform, arabisch oder römisch: «Wohnzonen 1–3», «Wohnzonen I bis III»,
 * «Zonen I und II», «Wohnzonen W I – W III». Gruppen: Stamm, Kürzel (optional), erste Nummer, Rest.
 */
const LANG_LIST_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(\\p{L}*[Zz]onen?)\\s+(?:${NOT_ROMAN}(\\p{Lu}\\p{L}{0,2})(?:\\s|\\s?-\\s?)?)?(${LIST_NUM})\\p{Ll}?` +
    `((?:\\s*${LIST_SEP}\\s*(?:\\2(?:\\s|\\s?-\\s?)?)?${LIST_NUM}\\p{Ll}?(?![\\p{L}\\p{N}]))+)`,
  "gu",
);
/** Römischer Bereich mit Kürzel: «W I – W III», «W I/II». Gruppen: Kürzel, erste Nummer, Rest. */
const ROMAN_CODE_LIST_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])${NOT_ROMAN}(\\p{Lu}\\p{L}{0,2})(?:\\s|\\s?-\\s?)([IVX]{1,4})\\p{Ll}?` +
    `((?:\\s*${LIST_SEP}\\s*(?:\\1(?:\\s|\\s?-\\s?)?)?[IVX]{1,4}\\p{Ll}?(?![\\p{L}\\p{N}]))+)`,
  "gu",
);
const ROMAN_TOKEN_RE = new RegExp("(?<![\\p{L}\\p{N}])[IVX]{1,4}(?=\\p{Ll}?(?![\\p{L}\\p{N}]))", "gu");
const ARABIC_TOKEN_RE = /(?<!\d)\d{1,2}(?!\d)/g;
const RANGE_SEP_RE = /^\s*(?:–|—|-|bis)/;

/** Nummern einer Liste; bei «–» und «bis» mit allen dazwischen. Unbekannte römische Zahl: übersprungen. */
function listNumbers(list: string, roman: boolean): number[] {
  const out: number[] = [];
  let prev: number | null = null;
  let prevEnd = 0;
  for (const t of Array.from(list.matchAll(roman ? ROMAN_TOKEN_RE : ARABIC_TOKEN_RE))) {
    const n = roman ? ROMAN.indexOf(t[0]) : Number(t[0]);
    if (n <= 0) continue;
    if (prev !== null && n > prev && RANGE_SEP_RE.test(list.slice(prevEnd, t.index))) {
      for (let k = prev + 1; k < n; k++) out.push(k);
    }
    out.push(n);
    prev = n;
    prevEnd = t.index! + t[0].length;
  }
  return out;
}

/**
 * Aufzählung mit wiederholtem Kürzel ohne Bereich («W3 und W4», «W I und W III»): wie bei arabischen Kürzeln
 * kein Bereich, die Kürzel werden einzeln gewertet. `tail`: Rest nach der ersten Nummer.
 */
function isPrefixedEnumeration(tail: string, prefix: string | undefined): boolean {
  if (!prefix || RANGE_SEP_RE.test(tail)) return false;
  return new RegExp(`${LIST_SEP}\\s*${escapeChar(prefix)}`, "u").test(tail);
}

/** Gehört ein Stamm wie «Wohnzonen» zum Präfix des eigenen Kürzels? «Zone(n)» allein passt zu jedem. */
function stemFits(stem: string, prefix: string): boolean {
  if (/^zonen?$/i.test(stem)) return true;
  const lang = LANGFORM.find(([, p]) => p === prefix);
  return !!lang && new RegExp(`^${lang[2]}n?$`, "iu").test(stem);
}

export function buildMatcher(zone: string): Matcher {
  const variants = zoneVariants(zone, [zoneCodeHint(zone)]);
  const codes: OwnCode[] = [];
  for (const v of variants) {
    const m = OWN_CODE_SHAPE.exec(v);
    if (!m) continue;
    const prefix = m[1].toUpperCase();
    const num = Number(m[2]);
    const sub = m[3] ?? null;
    if (codes.some((c) => c.prefix === prefix && c.num === num && c.sub === sub)) continue;
    const pfx = Array.from(m[1])
      .map((c) => `[${escapeChar(c.toLowerCase())}${escapeChar(c.toUpperCase())}]`)
      .join("");
    const re = new RegExp(
      `(?<![\\p{L}\\p{N}-])${pfx}\\s?-?\\s?${num}(?!\\d)${SUPERSCRIPT}((?:\\p{Ll}(?:\\s?[/,]\\s?\\p{Ll})*)?)(?![\\p{L}\\p{N}])`,
      "gu",
    );
    codes.push({ prefix, num, sub, re });
  }
  const nums = Array.from(new Set(codes.map((c) => c.num)));
  const zoneShort = nums.map((n) => new RegExp(`(?<![\\p{L}\\p{N}])[Zz]one\\s+${n}(?![\\p{L}\\p{N}])`, "gu"));
  const { roman, weak } = romanRegexes(codes);
  return {
    strict: zoneRegexes(zone, [zoneCodeHint(zone)]),
    codes,
    zoneShort,
    roman,
    weak: new Set([...zoneShort, ...weak]),
    families: zoneFamilies(zone),
  };
}

function spansOf(re: RegExp, text: string): RegExpMatchArray[] {
  return Array.from(text.matchAll(re));
}

/**
 * Stellen, an denen die eigene Zone genannt ist. Unterzonen: Projekt W2b trifft «W2», «W2b», «W2a/b».
 * `beleg`: ohne «Zone 2» bzw. «Zone II» allein, das nennt auch Schutzzonen.
 */
function ownSpans(text: string, m: Matcher, beleg = false): Span[] {
  const out: Span[] = [];
  const push = (x: RegExpMatchArray) => out.push({ at: x.index!, end: x.index! + x[0].length });
  for (const re of [...m.strict, ...m.zoneShort, ...m.roman]) {
    if (beleg && m.weak.has(re)) continue;
    spansOf(re, text).forEach(push);
  }
  for (const c of m.codes) {
    for (const x of spansOf(c.re, text)) {
      const letters = new Set(x[1].replace(/[^a-zäöü]/g, ""));
      // Stammzone ohne Buchstaben gilt für jede Unterzone, Unterzonen gelten für die Stammzone (im Zweifel
      // zeigen); bei eigener Unterzone mit Buchstaben nur, wenn die eigene dabei ist.
      if (c.sub === null || letters.size === 0 || letters.has(c.sub)) push(x);
    }
  }
  // Langform mit reinem Präfix des eigenen Kürzels: «Wohnzone W» bei W2.
  for (const x of spansOf(STEM_RE, text)) {
    if (m.codes.some((c) => c.prefix === x[1])) push(x);
  }
  return out;
}

/** Erkannte Bereiche; `own`, wenn die eigene Nummer mit gleichem Präfix darin liegt. */
function rangeSpans(text: string, m: Matcher): (Span & { own: boolean })[] {
  const out: (Span & { own: boolean })[] = [];
  for (const x of spansOf(RANGE_RE, text)) {
    const prefix = x[1].toUpperCase();
    if (x[3] && x[3].toUpperCase() !== prefix) continue;
    const from = Number(x[2]);
    const to = Number(x[4]);
    if (from >= to) continue;
    const own = m.codes.some((c) => c.prefix === prefix && c.num >= from && c.num <= to);
    out.push({ at: x.index!, end: x.index! + x[0].length, own });
  }
  for (const x of spansOf(SHORT_LIST_RE, text)) {
    const prefix = x[1].toUpperCase();
    const nums = [x[2], ...Array.from(x[3].matchAll(/\d{1,2}/g), (n) => n[0])].map(Number);
    const own = m.codes.some((c) => c.prefix === prefix && nums.includes(c.num));
    out.push({ at: x.index!, end: x.index! + x[0].length, own });
  }
  // Langform: «Wohnzonen 1–3», «Wohnzonen I bis III», «Zonen I und II».
  for (const x of spansOf(LANG_LIST_RE, text)) {
    const stem = x[1];
    const prefix = x[2]?.toUpperCase() ?? null;
    const nums = listNumbers(x[0].slice(stem.length), !/\d/.test(x[3]));
    const own = m.codes.some((c) => (prefix ? c.prefix === prefix : stemFits(stem, c.prefix)) && nums.includes(c.num));
    // Spanne ab der ersten Nummer: Das Familienwort im Stamm («Wohnzonen W3–W4, Kernzone») zählt weiter.
    const list = x[0].slice(stem.length);
    const at = x.index! + stem.length + (list.length - list.trimStart().length);
    if (own || !isPrefixedEnumeration(x[4], x[2])) out.push({ at, end: x.index! + x[0].length, own });
  }
  // Kürzel römisch: «W I – W III», «W I/II».
  for (const x of spansOf(ROMAN_CODE_LIST_RE, text)) {
    const prefix = x[1].toUpperCase();
    const nums = listNumbers(x[0].slice(x[1].length), true);
    const own = m.codes.some((c) => c.prefix === prefix && nums.includes(c.num));
    if (own || !isPrefixedEnumeration(x[3], x[1])) out.push({ at: x.index!, end: x.index! + x[0].length, own });
  }
  return out;
}

function namesOwn(text: string, m: Matcher, beleg = false): boolean {
  return ownSpans(text, m, beleg).length > 0 || rangeSpans(text, m).some((r) => r.own);
}

const overlaps = (a: Span, list: readonly Span[]) => list.some((b) => a.at < b.end && b.at < a.end);
const familyOverlap = (fam: ReadonlySet<string> | null, own: ReadonlySet<string> | null) =>
  !!fam && !!own && Array.from(fam).some((f) => own.has(f));

/** Nennt der Text eine Zone der eigenen Familie ohne Kürzel («in der Wohnzone» bei W2)? */
function namesOwnFamily(text: string, m: Matcher): boolean {
  if (!m.families) return false;
  return zoneHitsWith(text, []).fremde.some((h) => {
    if (h.art !== "langform") return false;
    const mention = text.slice(h.at, h.end).trim();
    return !CODE_SUFFIX_RE.test(mention) && !isOverlayOrGeneric(mention) && familyOverlap(mentionFamilies(mention), m.families);
  });
}

/**
 * Fremde Zonen in einem Titel oder Kapitelkopf. Leer, wenn die eigene Zone (auch im Bereich) vorkommt, ein
 * Sammelbegriff («alle Zonen»), ein Wort der eigenen Familie oder nur Überlagerungen und unbekannte Wörter.
 */
export function foreignZonesIn(text: string, m: Matcher): string[] {
  if (!text.trim() || ALL_ZONES_RE.test(text)) return [];
  if (ownSpans(text, m).length > 0) return [];
  const ranges = rangeSpans(text, m);
  if (ranges.some((r) => r.own)) return [];
  // Ein Bereich ist nie fremd, auch wenn die eigene Zone nicht darin liegt.
  const fremde = zoneHitsWith(text, []).fremde.filter((h) => !overlaps(h, ranges));
  const langformen = fremde.filter((h) => h.art === "langform");
  // Kürzel innerhalb einer Langform («Wohnzone W3») zählen mit der Langform.
  const codes = fremde.filter((h) => h.art === "code" && !overlaps(h, langformen));
  const out: string[] = [];
  const familyOnly: string[] = [];
  const consumed: Span[] = [...ranges];
  for (const h of langformen) {
    // «Wohn- und Gewerbezonen»: Der Wortteil vor «und» gehört zur Nennung.
    const pre = SPLIT_WORD_RE.exec(text.slice(0, h.at))?.[1] ?? "";
    const mention = (pre + text.slice(h.at, h.end)).trim();
    if (isOverlayOrGeneric(mention)) continue;
    if (CODE_SUFFIX_RE.test(mention)) {
      out.push(mention);
      consumed.push({ at: h.at - pre.length, end: h.end });
      continue;
    }
    // Familienwort ohne Nummer: nur fremd, wenn beide Familien bekannt sind und sich nicht überschneiden.
    const fam = mentionFamilies(mention);
    if (fam && m.families && !familyOverlap(fam, m.families)) familyOnly.push(mention);
  }
  // Überlagerung im Titel («Grundwasserschutzzonen S1, S2», «Lärmschutz, Zone ES3»): Kürzel nicht werten.
  if (codes.length > 0 && !isOverlayOrGeneric(text)) {
    let rest = text;
    for (const h of [...codes].sort((a, b) => b.at - a.at)) rest = rest.slice(0, h.at) + rest.slice(h.end);
    // Ein Kürzel allein («Format A4», «Energiestandard E1») nennt keine Zone.
    if (ZONE_WORD.test(text) || ONLY_CODES_RE.test(rest)) {
      for (const h of codes) {
        out.push(text.slice(h.at, h.end).trim());
        consumed.push(h);
      }
    }
  }
  // Sammeltitel: Nennt der Rest ein Wort der eigenen Familie («Kernzone, Wohnzonen»), ist nichts fremd.
  let rest = text;
  for (const h of [...consumed].sort((a, b) => b.at - a.at)) rest = rest.slice(0, Math.max(0, h.at)) + rest.slice(h.end);
  if (familyOverlap(mentionFamilies(rest), m.families)) return [];
  out.push(...familyOnly);
  return Array.from(new Map(out.map((z) => [z.toLowerCase(), z])).values());
}

function articleHasTable(a: ArticleBlock): boolean {
  return a.body.some((b) => b.kind === "table");
}

/** Bewertet jeden Block. Ist der Filter nicht aktiv, sind alle Blöcke sichtbar und `inactive` nennt den Grund. */
export function selectSections(parsed: ParsedNorm, ctx: SectionContext): SectionSelection {
  const zone = ctx.zone?.trim() ?? "";
  if (!zone) return inactive(parsed, "no-zone");
  // Nur exakt erkannt oder manuell erfasst (Konfidenz null). Grob, unsicher oder Unbekanntes: kein Filter.
  if (ctx.zoneConfidence != null && ctx.zoneConfidence !== "exact") return inactive(parsed, "zone-unsure");
  // Aus ÖREB ohne Konfidenz (Altbestand, Fehler beim Abgleich): nicht belegt, also unsicher.
  if (ctx.zoneConfidence == null && ctx.zoneSource === "oereb") return inactive(parsed, "zone-unsure");
  if (!(ctx.layers ?? SECTION_LAYERS).has(ctx.layer)) return inactive(parsed, "layer");
  if (ctx.normZone?.trim()) return inactive(parsed, "zone-tagged");
  if (!ctx.fullTextLoaded) return inactive(parsed, "not-loaded");
  if (!parsed.structured || parsed.articleCount < MIN_ARTICLES) return inactive(parsed, "unstructured");

  const m = buildMatcher(zone);
  const blocks = parsed.blocks;
  const texts = blocks.map(blockText);
  // Beleg der Schreibweise: Nennt das Dokument die eigene Zone nirgends, ist keine Benennung zuzuordnen.
  if (!texts.some((t) => t && namesOwn(t, m, true))) return inactive(parsed, "zone-not-named");

  // Nur der Titel des Artikels entscheidet. Kapitelköpfe binden nicht: Der Parser erkennt nicht jeden Kopf,
  // eine Bindung liefe sonst über das Kapitel hinaus.
  const verdicts: BlockVerdict[] = blocks.map(() => SHOW);
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind !== "article") continue;
    const text = texts[i];
    if (namesOwn(text, m)) {
      verdicts[i] = { show: true, ownZone: true };
      continue;
    }
    if (articleHasTable(b) || ALL_ZONES_RE.test(text) || namesOwnFamily(text, m)) continue;
    const zones = foreignZonesIn(b.title ?? "", m);
    if (zones.length > 0) verdicts[i] = { show: false, zones };
  }

  // Kapitelkopf: nur ausblenden, wenn er selbst fremd ist und alle Artikel darunter aus eigenem Grund.
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind !== "heading") continue;
    const zones = foreignZonesIn(b.text, m);
    if (zones.length === 0) continue;
    let articles = 0;
    let allHidden = true;
    for (let j = i + 1; j < blocks.length && blocks[j].kind !== "heading"; j++) {
      const x = blocks[j];
      if (isSide(x)) continue;
      if (x.kind === "article" && !verdicts[j].show) articles++;
      else allHidden = false;
    }
    if (allHidden && articles > 0) verdicts[i] = { show: false, zones };
  }

  // Beiwerk zwischen zwei ausgeblendeten Blöcken gehört zur Folge.
  for (let i = 0; i < blocks.length; i++) {
    if (!isSide(blocks[i])) continue;
    let prev = i - 1;
    while (prev >= 0 && isSide(blocks[prev])) prev--;
    let next = i + 1;
    while (next < blocks.length && isSide(blocks[next])) next++;
    if (prev >= 0 && next < blocks.length && !verdicts[prev].show && !verdicts[next].show) {
      verdicts[i] = { show: false, zones: [] };
    }
  }

  let hiddenArticles = 0;
  for (let i = 0; i < blocks.length; i++) if (blocks[i].kind === "article" && !verdicts[i].show) hiddenArticles++;
  if (hiddenArticles === 0) return inactive(parsed, "nothing-hidden");
  return {
    active: true,
    inactive: null,
    verdicts,
    shownArticles: parsed.articleCount - hiddenArticles,
    hiddenArticles,
  };
}

type ContextTuple = [string | null, string | null, string | null, number, string | null, boolean, number[] | null];

/**
 * Schlüssel aus den Werten eines Kontexts. Gleich, solange sich keine Angabe ändert, auch wenn das Objekt nach
 * einem Neuladen neu ist; so bleiben geöffnete Abschnitte offen.
 */
export function sectionContextKey(ctx: SectionContext | null | undefined): string | null {
  if (!ctx) return null;
  const tuple: ContextTuple = [
    ctx.zone,
    ctx.zoneConfidence,
    ctx.zoneSource ?? null,
    ctx.layer,
    ctx.normZone,
    ctx.fullTextLoaded,
    ctx.layers ? Array.from(ctx.layers).sort((a, b) => a - b) : null,
  ];
  return JSON.stringify(tuple);
}

/** Gegenstück zu sectionContextKey. */
export function sectionContextFromKey(key: string | null): SectionContext | null {
  if (key === null) return null;
  const [zone, zoneConfidence, zoneSource, layer, normZone, fullTextLoaded, layers] = JSON.parse(key) as ContextTuple;
  return {
    zone,
    zoneConfidence,
    zoneSource,
    layer,
    normZone,
    fullTextLoaded,
    ...(layers ? { layers: new Set(layers) } : {}),
  };
}

/** Zusammenhängende ausgeblendete Blöcke, je mit Artikel-Labels und den genannten fremden Zonen. */
export function hiddenRuns(sel: SectionSelection, blocks: NormBlock[]): HiddenRun[] {
  if (!sel.active) return [];
  const runs: HiddenRun[] = [];
  let cur: HiddenRun | null = null;
  for (let i = 0; i < blocks.length; i++) {
    const v = sel.verdicts[i];
    if (!v || v.show) {
      cur = null;
      continue;
    }
    if (!cur) {
      cur = { from: i, to: i, labels: [], zones: [] };
      runs.push(cur);
    }
    cur.to = i;
    const b = blocks[i];
    if (b.kind === "article") cur.labels.push(b.label);
    for (const z of v.zones) if (!cur.zones.some((x) => x.toLowerCase() === z.toLowerCase())) cur.zones.push(z);
  }
  return runs;
}

/** «Art. 21», «Art. 21–23», «Art. 21 bis § 3». */
export function runLabel(labels: string[]): string {
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  const first = labels[0];
  const last = labels[labels.length - 1];
  const a = /^(.*?)(\d+\S*)$/.exec(first);
  const b = /^(.*?)(\d+\S*)$/.exec(last);
  if (a && b && a[1] === b[1]) return `${first}–${b[2]}`;
  return `${first} bis ${last}`;
}

/** Text des Platzhalters: «Art. 21–23 gelten für Kernzone K, Gewerbezone G.» */
export function runSummary(run: HiddenRun): string {
  const label = runLabel(run.labels);
  const verb = run.labels.length === 1 ? "gilt" : "gelten";
  const zones = run.zones.join(", ");
  if (!label) return zones ? `Abschnitt für ${zones}.` : "Abschnitt für andere Zonen.";
  return zones ? `${label} ${verb} für ${zones}.` : `${label} ${verb} für andere Zonen.`;
}
