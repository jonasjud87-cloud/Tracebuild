/**
 * Gliedert einen extrahierten Normtext (pdf-parse, OCR, manuell erfasst) in Artikel, Absätze,
 * Listen und Tabellen. Rein und ohne Netz, läuft im Browser. Ein Vorlauf sammelt mögliche
 * Artikelköpfe, danach ein Durchgang zeilenweise; alle Muster sind verankert und prüfen höchstens
 * die ersten 200 Zeichen einer Zeile.
 *
 * Artikelköpfe werden nur angenommen, wenn die Nummer zur Folge passt (monoton, kleiner Sprung)
 * oder die nächsten Köpfe eine neue Folge bestätigen. Im Zweifel: kein Kopf.
 *
 * Invariante: Ausser Seitenmarken, Punktführern und Trennstrichen geht kein Zeichen verloren.
 */

import { collapseSpacedLetters } from "./oereb/text-measure";

export type BodyBlock =
  | { kind: "paragraph"; number: string | null; marginal: string | null; text: string }
  | { kind: "list"; items: { marker: string; text: string }[] }
  | { kind: "table"; rows: string[][] }
  /**
   * `header`: laufende Kopf- oder Fusszeile an einer Seitengrenze. `footnote`: Fussnoten am
   * Seitenende (Fedlex). `note`: Hinweisspalte mit Verweisen («BauG / Art. 57 …»).
   */
  | { kind: "lines"; lines: string[]; variant?: "header" | "footnote" | "note" }
  | { kind: "page"; number: number; total: number | null };

export type ArticleBlock = {
  kind: "article";
  label: string;
  rawLabel: string;
  title: string | null;
  page: number | null;
  body: BodyBlock[];
};

export type NormBlock =
  | BodyBlock
  | { kind: "heading"; text: string; page: number | null }
  | { kind: "toc"; entries: { label: string; page: string | null }[] }
  | ArticleBlock;

export interface ParsedNorm {
  blocks: NormBlock[];
  articleCount: number;
  pageCount: number;
  /** Mindestens ein Artikel/Paragraf oder zwei nummerierte Absätze in Folge. */
  structured: boolean;
}

type ParagraphBlock = Extract<BodyBlock, { kind: "paragraph" }>;
type ListBlock = Extract<BodyBlock, { kind: "list" }>;
type LinesVariant = "header" | "footnote" | "note";
type TocBlock = Extract<NormBlock, { kind: "toc" }>;
type ListStyle = "paren" | "dot" | "roman" | "bullet";

const HEAD_WINDOW = 200;
const TOC_WINDOW = 400;
const TAB = "\t";
/** Grösster Sprung der Artikelnummer ohne Bestätigung durch die Folgeköpfe. */
const ARTICLE_WINDOW = 15;

const SUFFIX = "bis|ter|quater|quinquies|sexies|septies|octies";
const PAGE_MARK = /^--\s*(\d{1,5})\s+of\s+(\d{1,5})\s*--$/;
const TOC_LINE = /^(.*?)\s*(?:\.\s?){4,}\s*(\d{1,3})$/;
/** «Art. 12», «§ 3», «Art. 15a49» (Fussnote angeklebt), «Art. 2217», «Art. 24quinquies». */
const ARTICLE_HEAD = new RegExp(
  `^(Art(?:ikel|icle|icolo)?\\s*\\.?|§§?|Paragra(?:ph|f))\\s*(\\d{1,6})((?:[a-z](?:${SUFFIX})?|${SUFFIX})(?![a-z]))?(\\d{1,3})?(?!\\d)([^]*)$`,
  "i",
);
/** Sargans: Randtitel vor der Nummer am Zeilenende, «Geltungsbereich Art. 1». */
const ARTICLE_TAIL = new RegExp(`^(\\S.{0,59}?)\\s+Art\\.\\s*(\\d{1,3})((?:[a-z](?:${SUFFIX})?|${SUFFIX})(?![a-z]))?$`);
const SPACED_FOOTNOTE = /^\s+(\d{1,3})(?!\d)/;
const SPACED_SUFFIX = new RegExp(`^\\s(${SUFFIX})\\s*$`);
const HEADING_ROMAN = new RegExp("^[IVXLC]+\\.\\s*\\p{L}{2}", "u");
const HEADING_LETTER = new RegExp("^[A-I]\\.\\s*\\p{L}{4}", "u");
const HEADING_NUMBERED = new RegExp("^\\d{1,2}\\.(?:\\d{1,2}\\.?)*\\s+\\p{Lu}", "u");
const HEADING_KEYWORD = new RegExp(
  "^(?:\\d{1,2}\\.\\s*)?(?:Kapitel|Abschnitt|Teil|Titel|Chapitre|Titre|Capitolo)(?:\\s+[\\dIVX]+)?\\s*(?:$|[:.–-]|\\s+\\p{Lu})",
  "u",
);
/** Mels: «Allgemeines\tA.» (Buchstabe hinter dem Titel). */
const HEADING_TRAILING = /^(\S[^\t]{2,60})\t\s*([A-I]|[IVX]{1,4})\.$/;
// Unicode-Klassen über new RegExp: tsconfig hat kein ES-Ziel für das u-Flag in Literalen.
const NUM_PARA = new RegExp('^(\\d{1,2})\\s*(?=[\\p{Lu}«"„…])', "u");
const LIST_PAREN = new RegExp(`^([a-z](?:${SUFFIX})?)\\)\\s+`);
const LIST_DOT = new RegExp(`^([a-z](?:${SUFFIX})?)\\.(\\d{1,3})?\\s+`);
const LIST_ROMAN = /^([ivx]{1,5})\)\s+/;
const LIST_BULLET = /^([–•-])\s+/;
const MARKER_START = /^[a-z]\)\s/;
const PAGE_OF = /^\d{1,4}\s*\/\s*\d{1,4}$/;
const SR_NUMBER = /^\d{3}(?:\.\d{1,4}){0,4}$/;
const PAGE_NUMBER_ONLY = /^\d{1,4}$/;
const PAGE_LABEL = /Seite\s*-?\s*\d{1,4}\s*-?$/;
const FOOTNOTE_START = new RegExp(
  "^(?:\\d{1,3}\\s+(?:\\[?AS\\s+\\d|SR\\s+\\d|BBl\\s+\\d|Fassung gemäss|Eingefügt durch|Aufgehoben durch|Berichtigt|Ursprünglich|Bezeichnung gemäss|Ausdruck gemäss|Die Änderung bisherigen Rechts|Der genannten Bestimmung|Heute:|Fassung des|Zweiter Satz|Die Berichtigung|sGS\\s+\\d)|AS \\d{4} \\d+$)",
);
/** Fussnote mit Fundstelle: auch dann Fussnote, wenn die Nummer zur Absatzfolge passt. */
const FOOTNOTE_SOURCE = /^\d{1,3}\s+(?:\[?AS\s+\d|SR\s+\d|BBl\s+\d|sGS\s+\d)/;
const SPACED_START = new RegExp("^\\p{L} \\p{L} ", "u");
const STARTS_UPPER = new RegExp('^[\\p{Lu}«"„]', "u");
const STARTS_LOWER = new RegExp("^\\p{Ll}", "u");
const LETTER = new RegExp("\\p{L}", "u");
const ENDS_PUNCT = /[.,;:!?]$/;
const ENDS_TERMINAL = /[.:;!?»"“)\]…]$/;
const ENDS_ITEM = /[.:;]$/;
const SOFT_HYPHEN_END = new RegExp("\\p{L}-$", "u");
const TITLE_END_BAD = /[.:;]$/;
const LINES_END_BAD = /[.,\-–]$/;
const SENTENCE_START = new Set([
  "Der", "Die", "Das", "Dem", "Den", "Des", "Ein", "Eine", "Einer", "Es", "Sie", "Er", "Wer", "Wird", "Werden", "Ist", "Sind", "Diese", "Dieser", "Dieses",
]);
const NOTE_ENTRY =new RegExp("^Art\\.\\s*\\d+\\S*\\s+\\p{Lu}", "u");
const CHANGE_TABLE =/^\*?\s*Änderungstabelle/;
const NO_TOC_TITLE =/^(?:[Aa]ufgehoben|\d{1,3})$/;

/** Verweisworte direkt nach «Art. n»: Dann ist es ein Querverweis, kein Kopf. */
const REFERENCE_AFTER = [
  "Abs", "Absatz", "Absätze", "al.", "cpv", "lit.", "Bst.", "Ziff.", "ff.", "f.", "BauG", "BauV", "PBG", "PBV", "LSV", "RPG",
  "RPV", "VRP", "GSchG", "GSchV", "USG", "NHG", "NHV", "WaG", "ZGB", "OR", "SIA", "BV", "VRG", "LATeC", "LAT", "OAT", "LC",
  "CC", "LPT", "OPT", "IVHB", "BZR", "BZO", "StrG", "BauR", "EGZ",
];
/** Erlasskürzel allein auf einer Zeile leiten die Hinweisspalte ein (Mels: «BauG», «Art. 57 …»). */
const LAW_ABBREVIATIONS = new Set([
  "BauG", "BauV", "BauR", "PBG", "PBV", "RPG", "RPV", "StrG", "USG", "LSV", "ZGB", "EGZ", "GSchG", "GSchV", "NHG", "NHV",
  "WaG", "VKOG", "GG", "SN", "VSS", "IVHB", "VRP", "EG ZGB", "EGzZGB",
]);
/** Letztes Wort des laufenden Texts, nach dem «Art. n» ein Verweis ist. */
const REFERENCE_BEFORE = new Set([
  "nach", "gemäss", "gem.", "von", "vgl.", "siehe", "laut", "i.v.m.", "und", "oder", "sowie", "bis", "im", "in", "des",
  "der", "dem", "den", "mit", "auf", "selon", "à", "al", "ai", "sensi",
]);
const HYPHEN_KEEP = new Set(["und", "oder", "bis", "sowie", "bzw.", "resp."]);

function startsWithWord(rest: string, word: string): boolean {
  if (!rest.startsWith(word)) return false;
  const next = rest.charAt(word.length);
  return next === "" || !LETTER.test(next);
}

function isReferenceRest(rest: string): boolean {
  if (/^[,;)\]/–-]/.test(rest)) return true;
  return REFERENCE_AFTER.some((w) => startsWithWord(rest, w));
}

function lastWord(text: string): string {
  const tail = text.slice(-40).trim();
  const i = tail.lastIndexOf(" ");
  return (i < 0 ? tail : tail.slice(i + 1)).toLowerCase();
}

/** Zeilen verbinden; Silbentrennung «Grenz-» + «abstand» ohne Bindestrich, «Nord-» + «und» mit. */
function joinText(prev: string, next: string): string {
  if (prev === "") return next;
  if (SOFT_HYPHEN_END.test(prev.slice(-2)) && STARTS_LOWER.test(next)) {
    const space = next.indexOf(" ");
    const word = space < 0 ? next : next.slice(0, space);
    if (!HYPHEN_KEEP.has(word)) return prev.slice(0, -1) + next;
  }
  return `${prev} ${next}`;
}

/** Nur das Ende prüfen: Muster mit $ auf langen Strings wären quadratisch. */
function endsTerminal(s: string): boolean {
  // Angeklebte Fussnotenziffer nach dem Satzende zählt mit («abzustimmen.15», «1 …23»).
  return ENDS_TERMINAL.test(s.slice(-4).replace(/(\D)\d{1,3}$/, "$1"));
}

function noTabs(s: string): string {
  return s.replace(/\t+/g, " ");
}

function nextLetter(c: string): string {
  return String.fromCharCode(c.charCodeAt(0) + 1);
}

function separatorsOf(t: string): { kind: "tab" | "pipe"; cells: string[] } | null {
  if (t.length > 4000) return null;
  const tabCells = t.split("\t");
  if (tabCells.length >= 3) return { kind: "tab", cells: tabCells.map((c) => c.trim()) };
  const stripped = t.replace(/^\|\s*/, "").replace(/\s*\|$/, "");
  const pipeCells = stripped.split(" | ");
  if (pipeCells.length >= 3) return { kind: "pipe", cells: pipeCells.map((c) => c.trim()) };
  return null;
}

function tocMatch(t: string): RegExpExecArray | null {
  if (t.length > TOC_WINDOW || !/\d$/.test(t) || t.indexOf("....") < 0 && t.indexOf(". . . .") < 0) return null;
  return TOC_LINE.exec(t);
}

/**
 * Beginn der Hinweisspalte: Erlasskürzel allein, gefolgt von «Art. n …» («BauG\nArt. 4 Aufgabe»),
 * oder Kürzel und Artikel auf einer Zeile («BauG Art. 57 Gebäudeabstand»). Ein Kürzel als
 * Fortsetzung eines Satzes («… Vollzug von Art. 104ff\nStrG») zählt nicht.
 */
function isNoteStart(lines: string[], i: number): boolean {
  const t = lines[i].trim();
  let entry: string;
  if (LAW_ABBREVIATIONS.has(t)) {
    entry = (lines[i + 1] ?? "").trim();
  } else {
    if (t.indexOf(TAB) >= 0) return false;
    const m = /^(\S{2,6})\s+(Art\..*)$/.exec(t);
    if (!m || !LAW_ABBREVIATIONS.has(m[1])) return false;
    entry = m[2];
  }
  // Eintrag «Art. 57 Gebäudeabstand», kein Satz («Art. 24 und weiteren Erlassen»).
  if (!NOTE_ENTRY.test(entry)) return false;
  // Vorzeile schliesst ab: Satzende, Abkürzungstabelle («=», Tabulator) oder kurze Planbeschriftung.
  let k = i - 1;
  while (k >= 0 && lines[k].trim() === "") k--;
  if (k < 0) return true;
  const prev = lines[k].trim();
  if (/[.:;!?)]$/.test(prev) || prev.indexOf("=") >= 0 || prev.indexOf(TAB) >= 0) return true;
  return prev.length <= 25 && !STARTS_LOWER.test(prev) && !REFERENCE_BEFORE.has(lastWord(prev));
}

/** Ein nummerierter Absatz mit Text beendet die Hinweisspalte. */
function endsNote(t: string): boolean {
  return t.length > 30 && NUM_PARA.test(t.slice(0, HEAD_WINDOW));
}

// ── Artikelköpfe ─────────────────────────────────────────────────────────────

interface HeadCandidate {
  line: number;
  /** «Art.» oder «§». */
  prefix: string;
  /** Ziffern direkt hinter dem Präfix, inklusive angeklebter Fussnote («2217»). */
  digits: string;
  suffix: string;
  rawLabel: string;
  title: string | null;
  /** Rest der Zeile ohne Titel (erster Absatz), sonst leer. */
  rest: string;
}

/** Kopf ohne Kontext erkennen: Muster, Verweiswort, Kleinbuchstabe. */
function headCandidate(t: string, line: number): HeadCandidate | null {
  const head = t.slice(0, HEAD_WINDOW);
  const source = SPACED_START.test(head) ? collapseSpacedLetters(head) : head;
  const m = ARTICLE_HEAD.exec(source);
  if (m) {
    let suffix = m[3] ?? "";
    let glued = m[4] ?? "";
    let labelEnd = source.length - m[5].length;
    if (suffix !== "" && suffix.charAt(0) !== suffix.charAt(0).toLowerCase()) {
      // «Art. 5A» oder «Art. 3Distanze»: Grossbuchstabe gehört zum Rest.
      labelEnd -= suffix.length + glued.length;
      suffix = "";
      glued = "";
    }
    let raw = source.slice(0, labelEnd);
    let rest = source.slice(labelEnd) + t.slice(HEAD_WINDOW);
    // Zusatz mit Leerzeichen am Zeilenende: «Art. 10 bis» (nicht «Art. 21 bis 32 des …»).
    const spacedSuffix = suffix === "" && glued === "" ? SPACED_SUFFIX.exec(rest) : null;
    if (spacedSuffix) {
      suffix = spacedSuffix[1];
      raw += rest;
      rest = "";
    }
    // Fussnote mit Leerzeichen: «Art. 16abis 58», «Art. 165 27» (aufgehoben).
    const spaced = SPACED_FOOTNOTE.exec(rest);
    if (spaced && (suffix !== "" || rest.trim() === spaced[1])) {
      raw += spaced[0];
      rest = rest.slice(spaced[0].length);
    }
    // Einzelner Buchstabe nach der Fussnote («Art. 12b30g»).
    if (/^[a-z]$/.test(rest.trim()) && (glued !== "" || spaced)) {
      raw += rest;
      rest = "";
    }
    const trimmed = rest.trim();
    if (isReferenceRest(trimmed)) return null;
    if (STARTS_LOWER.test(trimmed) && !MARKER_START.test(trimmed)) return null;
    // Ohne Zusatz zählen angeklebte Ziffern zur Nummer; die Folge entscheidet über die Aufteilung.
    const digits = m[2] + (suffix === "" ? glued : "");
    return { line, prefix: m[1], digits, suffix: suffix.toLowerCase(), rawLabel: raw.trim(), title: null, rest: trimmed };
  }
  if (t.length > 80) return null;
  const e = ARTICLE_TAIL.exec(t);
  if (!e) return null;
  const title = e[1].trim();
  if (!STARTS_UPPER.test(title) || title.endsWith(".") || REFERENCE_BEFORE.has(lastWord(title))) return null;
  return { line, prefix: "Art.", digits: e[2], suffix: e[3] ?? "", rawLabel: t.slice(e[1].length).trim(), title, rest: "" };
}

/** Mögliche Nummern, längste zuerst: «2217» → 2217, 221, 22, 2 (Rest ist Fussnote, max. 3 Ziffern). */
function numberSplits(digits: string): number[] {
  const out: number[] = [];
  for (let k = digits.length; k >= 1; k--) {
    if (digits.length - k > 3) break;
    const n = Number(digits.slice(0, k));
    if (n > 0 && n < 10000) out.push(n);
  }
  return out;
}

function prefixLabel(prefixRaw: string): string {
  return /^(§|paragra)/i.test(prefixRaw) ? "§" : "Art.";
}

/** Seitenmarken, Kopfzeilen, Fussnoten und Hinweise zählen nicht als Inhalt eines Artikels. */
function isSideBlock(b: BodyBlock): boolean {
  return b.kind === "page" || (b.kind === "lines" && b.variant !== undefined);
}

/** Nummer aus einem Label («Art. 24quinquies» → 24). */
function labelNumber(label: string): number {
  const m = /\d+/.exec(label);
  return m ? Number(m[0]) : 0;
}

export function parseNormText(input: string | null | undefined): ParsedNorm {
  const empty: ParsedNorm = { blocks: [], articleCount: 0, pageCount: 0, structured: false };
  if (typeof input !== "string") return empty;
  const text = input.replace(/\r\n?/g, "\n").replace(/[\u0000\u00AD]/g, "");
  if (text.trim() === "") return empty;
  const lines = text.split("\n");

  // Vorlauf: mögliche Köpfe ausserhalb von Inhaltsverzeichnis (Punktführer) und Hinweisspalte.
  // Seitenmarken: nächste Marke ab Zeile i (Fussnoten und Hinweise stehen am Seitenende).
  const nextMark: number[] = new Array(lines.length + 1).fill(-1);
  for (let i = lines.length - 1; i >= 0; i--) nextMark[i] = PAGE_MARK.test(lines[i].trim()) ? i : nextMark[i + 1];
  const hasPages = nextMark[0] >= 0;
  const nearPageEnd = (i: number) => nextMark[i] >= 0 && nextMark[i] - i <= 40;

  const candidates: HeadCandidate[] = [];
  {
    let note = false;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (PAGE_MARK.test(t)) {
        note = false;
        continue;
      }
      // Änderungstabelle am Ende (SG): ab hier keine Köpfe mehr. Am Anfang nur ein Hinweis.
      if (CHANGE_TABLE.test(t) && i > lines.length / 2) break;
      if (hasPages && isNoteStart(lines, i)) note = true;
      if (note && endsNote(t)) note = false;
      if (note || t === "" || tocMatch(t)) continue;
      const c = headCandidate(t, i);
      if (c) candidates.push(c);
    }
  }
  // Wenige Köpfe oder keine Seitenmarken: eher ein Auszug, Nummern dürfen springen.
  const lenient = candidates.length < 5 || !hasPages;

  const blocks: NormBlock[] = [];
  let article: ArticleBlock | null = null;
  let para: ParagraphBlock | null = null;
  let list: ListBlock | null = null;
  let listStyle: ListStyle | null = null;
  let listLast = "";
  let toc: TocBlock | null = null;
  let pendingMarginal: string | null = null;
  let lastPara = 0;
  let lastArticle = 0;
  let lastSuffix = "";
  let articlesSinceStart: ArticleBlock[] = [];
  let lastTail = "";
  let page: number | null = null;
  let markerCount = 0;
  let maxTotal = 0;
  let sawSequence = false;
  let headerUntil = -1;
  let afterPage = false;
  let sideMode: "footnote" | "note" | null = null;
  let cp = 0;

  // Offener Text als Teilstücke: wiederholtes Anhängen und Prüfen des Endes bleibt linear.
  let open: { parts: string[]; tail: string; commit: (s: string) => void } | null = null;
  const flush = () => {
    if (open) open.commit(open.parts.join(""));
    open = null;
  };
  const openText = (initial: string, commit: (s: string) => void) => {
    flush();
    open = { parts: [initial], tail: initial, commit };
    lastTail = initial;
  };
  /** Offener Absatz endet mit Schlusszeichen oder es gibt keinen. */
  const paraClosed = (): boolean => !para || !open || open.tail === "" || endsTerminal(open.tail);

  const emit = (b: BodyBlock) => {
    (article ? article.body : blocks).push(b);
  };
  /** Kopfzeilen, Fussnoten, Hinweise: eigener Block, offener Absatz läuft danach weiter. */
  const emitSide = (t: string, variant: LinesVariant, merge: boolean) => {
    const prev = (article ? article.body : blocks).at(-1);
    if (merge && prev && prev.kind === "lines" && prev.variant === variant) prev.lines.push(noTabs(t));
    else emit({ kind: "lines", lines: [noTabs(t)], variant });
  };
  const closeOpen = () => {
    flush();
    para = null;
    list = null;
    listStyle = null;
    listLast = "";
  };
  const closeArticle = () => {
    closeOpen();
    article = null;
    lastPara = 0;
    lastTail = "";
  };
  const appendText = (t: string) => {
    if (!open) {
      const target: ParagraphBlock = { kind: "paragraph", number: null, marginal: null, text: t };
      list = null;
      listStyle = null;
      listLast = "";
      para = target;
      emit(target);
      openText(t, (s) => (target.text = s));
      return;
    }
    const joined = joinText(open.tail, t);
    open.parts[open.parts.length - 1] = joined.slice(0, joined.length - t.length);
    open.parts.push(t);
    open.tail = t;
    lastTail = t;
  };
  /** Nummer 1 oder genau die nächste; ein offener Satz ohne Schlusszeichen läuft weiter. */
  const canStartPara = (n: number, strong: boolean): boolean => {
    if (n !== 1 && n !== lastPara + 1) return false;
    if (strong) return true;
    if (list) return !open || ENDS_ITEM.test(open.tail.slice(-1));
    return paraClosed();
  };
  const startPara = (num: string, marginal: string | null, body: string) => {
    closeOpen();
    const n = Number(num);
    if (n >= 2) sawSequence = true;
    lastPara = n;
    const target: ParagraphBlock = { kind: "paragraph", number: num, marginal, text: body };
    para = target;
    pendingMarginal = null;
    emit(target);
    openText(body, (s) => (target.text = s));
  };
  const numParaOf = (t: string): { num: string; rest: string } | null => {
    const m = NUM_PARA.exec(t.slice(0, HEAD_WINDOW));
    return m ? { num: m[1], rest: t.slice(m[0].length) } : null;
  };

  /** Folgt `c` direkt auf (n, suffix)? strikt: n+1 oder gleiche Nummer mit Zusatz; lose: bis n+3. */
  const followsWith = (n: number, c: HeadCandidate, strict: boolean): number | null => {
    for (const m of numberSplits(c.digits)) {
      if (m === n + 1 || (m === n && c.suffix !== "")) return m;
      if (!strict && m > n && m <= n + 3) return m;
    }
    return null;
  };
  /**
   * Wählt die Nummer eines Kandidaten oder verwirft ihn (null). Grundsatz: Die ganze Nummer gilt,
   * eine Fussnotenaufteilung («Art. 2217» → 22) nur bei strikter Bestätigung durch den Folgekopf.
   * Regeln in dieser Reihenfolge; die Tests «decideNumber a) …» bis «… g)» belegen je eine.
   */
  const decideNumber = (c: HeadCandidate, next: HeadCandidate[]): number | null => {
    const splits = numberSplits(c.digits);
    const full = splits[0];
    if (full === undefined) return null;
    const newer = (n: number) => n > lastArticle || (n === lastArticle && c.suffix !== "" && c.suffix !== lastSuffix);
    // Auszüge und Texte ohne Seitenmarken: jede höhere Nummer ist plausibel, ohne Sprunggrenze.
    const plausible = (n: number) => newer(n) && (lenient || n <= lastArticle + ARTICLE_WINDOW);
    // a) ganze Nummer passt zur Folge, der nächste Kopf schliesst lose an (bis +3).
    if (plausible(full) && next[0] && followsWith(full, next[0], false) !== null) return full;
    // b) Fussnote angeklebt: kürzere Nummer, nächster Kopf ist strikt n+1 (oder n mit Zusatz).
    // Nie beim ersten Kopf, wenn die ganze Nummer mit dem nächsten Kopf schon aufsteigt.
    const nextFull = next[0] ? Number(next[0].digits) : 0;
    const firstAscending = lastArticle === 0 && nextFull > full;
    for (const n of splits.slice(1)) {
      if (!firstAscending && newer(n) && n <= lastArticle + ARTICLE_WINDOW && next[0] && followsWith(n, next[0], true) !== null) return n;
    }
    // c) unmittelbarer Nachfolger (n+1 oder neuer Zusatz) ohne weitere Prüfung.
    if (full === lastArticle + 1 || (full === lastArticle && newer(full))) return full;
    // d) Auszug oder letzter Kopf: höhere ganze Nummer.
    if ((lenient || !next[0]) && plausible(full)) return full;
    // e) Sprung oder Neubeginn: die nächsten Köpfe (bis zwei) bestätigen strikt, nur ganze Nummern
    // (sonst bilden «Art. 90», «Art. 109», «Art. 110» eine Folge 9, 10, 11).
    if (next[0]) {
      const strictFull = (n: number, x: HeadCandidate): boolean => {
        const m = Number(x.digits);
        return m === n + 1 || (m === n && x.suffix !== "");
      };
      if (strictFull(full, next[0]) && (!next[1] || strictFull(nextFull, next[1]))) return full;
    }
    // f) Neubeginn bei 1 nach Köpfen ohne Inhalt (Inhaltsverzeichnis ohne Punktführer).
    if (splits.includes(1) && articlesSinceStart.length >= 3 && articlesSinceStart.every((a) => a.body.every(isSideBlock))) return 1;
    // g) erster Kopf überhaupt: ganze Nummer.
    if (lastArticle === 0) return full;
    return null;
  };

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    const head = t.slice(0, HEAD_WINDOW);
    while (cp < candidates.length && candidates[cp].line < i) cp++;
    const cand = cp < candidates.length && candidates[cp].line === i ? candidates[cp] : null;

    if (t === "") {
      // pdf-parse setzt Leerzeilen um die Seitenmarke: kein Absatzende.
      const nearPage = PAGE_MARK.test((lines[i + 1] ?? "").trim()) || (i > 0 && PAGE_MARK.test(lines[i - 1].trim()));
      if (!nearPage) {
        closeOpen();
        pendingMarginal = null;
      }
      continue;
    }

    // 1 Seitenmarke. Offene Absätze laufen über die Seitengrenze weiter.
    const pm = PAGE_MARK.exec(t);
    if (pm) {
      const number = Number(pm[1]);
      const total = Number(pm[2]);
      markerCount++;
      maxTotal = Math.max(maxTotal, total);
      emit({ kind: "page", number, total: total || null });
      page = number + 1;
      headerUntil = runningHeaderEnd(lines, i + 1);
      afterPage = true;
      sideMode = null;
      continue;
    }

    // Laufende Kopfzeilen nach einer Seitenmarke und Seitenzahl direkt davor.
    const nextIsMark = PAGE_MARK.test((lines[i + 1] ?? "").trim()) || ((lines[i + 1] ?? "").trim() === "" && PAGE_MARK.test((lines[i + 2] ?? "").trim()));
    if (i <= headerUntil || (PAGE_NUMBER_ONLY.test(t) && nextIsMark)) {
      emitSide(t, "header", afterPage);
      afterPage = i <= headerUntil;
      continue;
    }
    afterPage = false;

    // Fussnoten (Fedlex) und Hinweisspalte (Mels) bis zur nächsten Seitenmarke.
    if (sideMode === "footnote" && cand) sideMode = null;
    if (sideMode === "note" && endsNote(t)) sideMode = null;
    if (!sideMode && !cand && hasPages) {
      // Fussnoten nur am Seitenende; «2 Aufgehoben durch …» als nächster Absatz bleibt Absatz.
      const fn = FOOTNOTE_START.test(head) && nearPageEnd(i);
      const fnNum = fn ? Number(/^\d+/.exec(t)?.[0] ?? "0") : 0;
      if (fn && !(fnNum > 0 && fnNum === lastPara + 1 && para && !FOOTNOTE_SOURCE.test(head))) sideMode = "footnote";
      else if (isNoteStart(lines, i)) sideMode = "note";
    }
    if (sideMode) {
      emitSide(t, sideMode, true);
      continue;
    }

    // 2 Inhaltsverzeichnis mit Punktführern; Folgen bilden einen Block, auch über Seiten.
    const tm = tocMatch(t);
    if (tm) {
      if (!toc) {
        if (article) closeArticle();
        closeOpen();
        toc = { kind: "toc", entries: [] };
        blocks.push(toc);
      }
      toc.entries.push({ label: noTabs(tm[1]).trim(), page: tm[2] });
      continue;
    }
    toc = null;

    // 3 Artikel- oder Paragrafenkopf.
    // Verweiswort am Ende der Vorzeile («gemäss») – nicht nach Satzende («4 m.», «i.V.m.» endet auf Punkt).
    const referenced = !!cand && !lastTail.endsWith(".") && REFERENCE_BEFORE.has(lastWord(lastTail));
    let rejectedCand = !!cand && referenced;
    if (cand && !referenced) {
      const num = decideNumber(cand, candidates.slice(cp + 1, cp + 3));
      if (num !== null) {
        const restart = num < lastArticle || (num === lastArticle && cand.suffix === "");
        closeArticle();
        if (restart) articlesSinceStart = [];
        lastArticle = num;
        lastSuffix = cand.suffix;
        const art: ArticleBlock = {
          kind: "article",
          label: `${prefixLabel(cand.prefix)} ${num}${cand.suffix}`,
          rawLabel: cand.rawLabel,
          title: cand.title,
          page,
          body: [],
        };
        blocks.push(art);
        articlesSinceStart.push(art);
        article = art;
        const rest = cand.rest;
        if (rest !== "") {
          const tab = rest.indexOf(TAB);
          const afterTab = tab >= 0 ? numParaOf(rest.slice(tab + 1).trim()) : null;
          const inRest = numParaOf(rest);
          if (afterTab && afterTab.num === "1") {
            art.title = noTabs(rest.slice(0, tab)).trim() || null;
            startPara(afterTab.num, null, noTabs(afterTab.rest).trim());
          } else if (inRest && inRest.num === "1") {
            startPara(inRest.num, null, noTabs(inRest.rest).trim());
          } else {
            const clean = noTabs(rest).trim();
            if (clean.length <= 80 && !TITLE_END_BAD.test(clean)) art.title = clean;
            else appendText(clean);
          }
        }
        continue;
      }
      rejectedCand = true;
    }
    // Verworfener Kopf ist Text (eigener Absatz nach Satzende), nie Randtitel oder Kapitelkopf.
    if (rejectedCand) {
      if (paraClosed()) closeOpen();
      appendText(noTabs(t));
      continue;
    }

    // 4 Kapitelkopf, nur ausserhalb eines offenen Satzes.
    // Nummerierte Kapitelköpfe («2. Planungsmittel») innerhalb eines Artikels nur, wenn ein Kopf folgt.
    let isHeading = false;
    if (isHeadingLine(t)) {
      const numberedOnly = isNumberedHeading(t) && !HEADING_KEYWORD.test(head) && !HEADING_ROMAN.test(head) && !HEADING_LETTER.test(head);
      const follows = headingFollows(lines, i + 1, candidates, cp);
      isHeading = numberedOnly && article ? follows : paraClosed() || follows;
    }
    if (isHeading) {
      closeArticle();
      blocks.push({ kind: "heading", text: noTabs(t), page });
      continue;
    }

    // 9 Tabelle: mindestens zwei Folgezeilen mit je zwei Trennern und ähnlicher Spaltenzahl.
    const sep = separatorsOf(t);
    if (sep && sep.cells.length <= 12) {
      const rows: string[][] = [sep.cells];
      let j = i + 1;
      while (j < lines.length) {
        const s = separatorsOf(lines[j].trim());
        if (!s || s.kind !== sep.kind || s.cells.length > 12 || Math.abs(s.cells.length - sep.cells.length) > 1) break;
        rows.push(s.cells);
        j++;
      }
      if (rows.length >= 2) {
        const width = Math.max(...rows.map((r) => r.length));
        closeOpen();
        emit({ kind: "table", rows: rows.map((r) => r.concat(Array(width - r.length).fill(""))) });
        lastTail = "";
        i = j - 1;
        continue;
      }
    }

    // 5 Randtitel mit Tabulator: «Randtitel\t1 Text».
    const tabCount = t.split("\t").length - 1;
    if (tabCount === 1) {
      const idx = t.indexOf("\t");
      const left = t.slice(0, idx).trim();
      const right = numParaOf(t.slice(idx + 1).trim());
      if (left.length <= 60 && right && canStartPara(Number(right.num), true)) {
        startPara(right.num, left, noTabs(right.rest).trim());
        continue;
      }
    }

    // 6 Nummerierter Absatz.
    const np = numParaOf(t);
    if (np && canStartPara(Number(np.num), false)) {
      startPara(np.num, pendingMarginal, noTabs(np.rest).trim());
      continue;
    }

    // 7 Randtitel ohne Tabulator, oder Titel direkt nach einem Kopf ohne Titel.
    const fresh: boolean = !!article && article.body.length === 0 && !para && !list;
    // Umbrochener Titel «Gebäudeab-» + «stand».
    if (fresh && article && article.title && SOFT_HYPHEN_END.test(article.title.slice(-2)) && t.length <= 40 && STARTS_LOWER.test(t)) {
      article.title = joinText(article.title, noTabs(t));
      continue;
    }
    if (t.length <= 40 && !ENDS_PUNCT.test(t) && (STARTS_UPPER.test(t) || (fresh && MARKER_START.test(t)))) {
      if (fresh && article && article.title === null && STARTS_UPPER.test(t)) {
        article.title = noTabs(t);
        continue;
      }
      const next = numParaOf((lines[i + 1] ?? "").trim());
      if (next && paraClosed() && (Number(next.num) === 1 || Number(next.num) === lastPara + 1)) {
        closeOpen();
        pendingMarginal = noTabs(t);
        continue;
      }
    }

    // 8 Aufzählung.
    const li = listItemOf(head, list ? listStyle : null, listLast);
    if (li) {
      flush();
      if (!list || listStyle !== li.style || li.restart) {
        para = null;
        list = { kind: "list", items: [] };
        emit(list);
      }
      listStyle = li.style;
      listLast = li.key;
      const item = { marker: li.marker, text: noTabs(t.slice(li.length)).trim() };
      list.items.push(item);
      openText(item.text, (s) => (item.text = s));
      continue;
    }
    if (list && listJump(head, listStyle)) {
      closeOpen();
    }

    // 10 Kurze Zeilen ohne Satzzeichen (Zonenlisten, Kennzahlen).
    if (paraClosed() && !list) {
      let j = i;
      while (j < lines.length && j - i < 400 && isShortLine(lines[j].trim())) j++;
      if (j - i >= 3) {
        closeOpen();
        emit({ kind: "lines", lines: lines.slice(i, j).map((l) => noTabs(l.trim())) });
        lastTail = "";
        i = j - 1;
        continue;
      }
    }

    // 11 Fliesstext.
    appendText(noTabs(t));
  }
  flush();

  const finalBlocks = collapseEmptyArticles(blocks);
  if (markerCount > 0) {
    for (const b of finalBlocks) {
      if ((b.kind === "article" || b.kind === "heading") && b.page === null) b.page = 1;
    }
  }
  const articleCount = finalBlocks.filter((b) => b.kind === "article").length;
  return {
    blocks: finalBlocks,
    articleCount,
    pageCount: maxTotal || markerCount,
    structured: articleCount >= 1 || sawSequence,
  };
}

function isHeadingLine(t: string): boolean {
  if (t.length > 80) return false;
  const head = t.slice(0, HEAD_WINDOW);
  if (HEADING_TRAILING.test(t)) return true;
  if (t.endsWith(".")) return false;
  if (HEADING_KEYWORD.test(head) || HEADING_ROMAN.test(head) || HEADING_LETTER.test(head)) return true;
  return isNumberedHeading(t);
}

/** «2. Planungsmittel», «4.1 …»: kurz, ohne Satzzeichen, kein Satzanfang («2. Die Behörde entscheidet»). */
function isNumberedHeading(t: string): boolean {
  if (t.length > 60 || t.endsWith(".") || /[;,]/.test(t)) return false;
  const m = HEADING_NUMBERED.exec(t);
  if (!m) return false;
  const firstWord = t.slice(m[0].length - 1).split(/\s+/)[0];
  return !SENTENCE_START.has(firstWord);
}

/** Folgt direkt ein Artikel- oder Kapitelkopf? Dann ist ein Kapitelkopf auch nach offenem Text plausibel. */
function headingFollows(lines: string[], from: number, candidates: HeadCandidate[], cp: number): boolean {
  let k = from;
  while (k < lines.length && k < from + 3 && lines[k].trim() === "") k++;
  if (k >= lines.length) return false;
  for (let c = cp; c < candidates.length && candidates[c].line <= k; c++) if (candidates[c].line === k) return true;
  return isHeadingLine(lines[k].trim());
}

/**
 * Letzte Zeile der Kopfzeilen nach einer Seitenmarke, sonst start - 1. Erkannt werden bis drei
 * Zeilen bis zu einer Seitenzahl («4», «3 / 30», «Seite - 2 -») oder SR-Nummer («700», «731.1»),
 * dazu eine Zeile mit einem Tabulator («Baureglement Gemeinde Mels \tHinweise»).
 */
function runningHeaderEnd(lines: string[], start: number): number {
  let k = start;
  while (k < lines.length && lines[k].trim() === "") k++;
  const first = k;
  let end = start - 1;
  for (let n = 0; n < 3 && k < lines.length; n++, k++) {
    const t = lines[k].trim();
    if (t === "" || t.length > 80 || PAGE_MARK.test(t) || headCandidate(t, k)) break;
    if (PAGE_OF.test(t) || PAGE_NUMBER_ONLY.test(t) || SR_NUMBER.test(t) || PAGE_LABEL.test(t)) end = k;
  }
  if (end < first) {
    const t = (lines[first] ?? "").trim();
    const tab = t.indexOf(TAB);
    if (t.length <= 80 && tab > 0 && t.indexOf(TAB, tab + 1) < 0 && !/^\d/.test(t.slice(tab + 1).trim())) {
      end = first;
      const second = (lines[first + 1] ?? "").trim();
      if (PAGE_NUMBER_ONLY.test(second) || SR_NUMBER.test(second)) end = first + 1;
    }
    return end;
  }
  const after = (lines[end + 1] ?? "").trim();
  if (SR_NUMBER.test(after) || PAGE_NUMBER_ONLY.test(after)) end++;
  return end;
}

interface ListItemMatch {
  style: ListStyle;
  marker: string;
  key: string;
  length: number;
  restart: boolean;
}

/** Listenmarker mit Folgeprüfung a, b, bbis, bter, c; Fussnotenziffer bleibt im Marker («a.13»). */
function listItemOf(head: string, style: ListStyle | null, last: string): ListItemMatch | null {
  const letterSeq = (key: string, s: ListStyle): { ok: boolean; restart: boolean } => {
    const letter = key.charAt(0);
    if (style === s && last !== "") {
      if (letter === nextLetter(last.charAt(0)) && key.length === 1) return { ok: true, restart: false };
      if (letter === last.charAt(0) && key.length > 1 && key !== last) return { ok: true, restart: false };
    }
    if (key === "a") return { ok: true, restart: true };
    return { ok: false, restart: false };
  };
  let m = LIST_PAREN.exec(head);
  if (m) {
    const seq = letterSeq(m[1], "paren");
    if (seq.ok) return { style: "paren", marker: `${m[1]})`, key: m[1], length: m[0].length, restart: seq.restart };
  }
  m = LIST_ROMAN.exec(head);
  if (m && (m[1] === "i" || style === "roman")) {
    return { style: "roman", marker: `${m[1]})`, key: m[1], length: m[0].length, restart: style !== "roman" };
  }
  m = LIST_DOT.exec(head);
  if (m) {
    const seq = letterSeq(m[1], "dot");
    if (seq.ok) return { style: "dot", marker: `${m[1]}.${m[2] ?? ""}`, key: m[1], length: m[0].length, restart: seq.restart };
  }
  m = LIST_BULLET.exec(head);
  if (m) return { style: "bullet", marker: m[1], key: "", length: m[0].length, restart: style !== "bullet" };
  return null;
}

/** Marker gleicher Art ausserhalb der Folge (a → c) beendet die Liste. */
function listJump(head: string, style: ListStyle | null): boolean {
  if (style === "paren") return LIST_PAREN.test(head);
  if (style === "dot") return LIST_DOT.test(head);
  return false;
}

function isShortLine(t: string): boolean {
  if (t === "" || t.length > 30 || LINES_END_BAD.test(t)) return false;
  const head = t.slice(0, HEAD_WINDOW);
  return !(
    PAGE_MARK.test(t) ||
    tocMatch(t) ||
    ARTICLE_HEAD.test(head) ||
    HEADING_KEYWORD.test(head) ||
    HEADING_NUMBERED.test(head) ||
    NUM_PARA.test(head) ||
    LIST_PAREN.test(head) ||
    LIST_DOT.test(head) ||
    LIST_BULLET.test(head)
  );
}

/**
 * Köpfe ohne Inhalt (mindestens drei, Kapitelköpfe dazwischen erlaubt) sind ein Inhaltsverzeichnis
 * ohne Punktführer, wenn die Nummerierung danach neu beginnt oder ein Inhaltsverzeichnis vorangeht.
 * Aufgehobene Artikel («Aufgehoben», nur Fussnote) zählen nie dazu.
 */
function collapseEmptyArticles(blocks: NormBlock[]): NormBlock[] {
  const out: NormBlock[] = [];
  let run: NormBlock[] = [];
  const isEntry = (b: NormBlock): boolean =>
    b.kind === "heading" ||
    (b.kind === "article" && b.body.every(isSideBlock) && b.title !== null && !NO_TOC_TITLE.test(b.title));
  // Nächster Artikel ab Index k, einmal von hinten berechnet (linear).
  const nextArticle: (ArticleBlock | null)[] = new Array(blocks.length + 1).fill(null);
  for (let k = blocks.length - 1; k >= 0; k--) {
    const b = blocks[k];
    nextArticle[k] = b.kind === "article" ? b : nextArticle[k + 1];
  }
  const firstArticleAfter = (from: number): ArticleBlock | null => nextArticle[from] ?? null;
  const restartsAfter = (k: number): boolean => {
    const b = blocks[k];
    const next = firstArticleAfter(k + 1);
    return b.kind === "article" && !!next && labelNumber(next.label) < labelNumber(b.label);
  };
  const flush = (nextIndex: number) => {
    if (run.length === 0) return;
    const arts = run.filter((b): b is ArticleBlock => b.kind === "article");
    const prev = out.at(-1);
    const tocContext =
      (prev && prev.kind === "toc") ||
      (prev && prev.kind === "paragraph" && /^Inhalt/i.test(prev.text)) ||
      (prev && prev.kind === "heading" && /^Inhalt/i.test(prev.text));
    const after = firstArticleAfter(nextIndex);
    const restarts = !!after && arts.length > 0 && labelNumber(after.label) <= labelNumber(arts[arts.length - 1].label);
    if (arts.length >= 3 && (restarts || tocContext)) {
      // Kapitelköpfe nach dem letzten Eintrag gehören schon zum Erlass.
      let lastArt = run.length - 1;
      while (lastArt > 0 && run[lastArt].kind !== "article") lastArt--;
      const tail = run.slice(lastArt + 1);
      out.push({
        kind: "toc",
        entries: run.slice(0, lastArt + 1).map((b) =>
          b.kind === "article"
            ? { label: b.title ? `${b.rawLabel} ${b.title}` : b.rawLabel, page: null }
            : { label: b.kind === "heading" ? b.text : "", page: null },
        ),
      });
      for (const a of arts) out.push(...a.body);
      out.push(...tail);
    } else {
      out.push(...run);
    }
    run = [];
  };
  for (let k = 0; k < blocks.length; k++) {
    const b = blocks[k];
    if (isEntry(b)) {
      run.push(b);
    } else if (b.kind === "article" && b.title !== null && run.filter((x) => x.kind === "article").length >= 2 && restartsAfter(k)) {
      // Letzter Eintrag, an dem schon Text des Erlasses hängt (Einleitung, Ingress).
      run.push(b);
      flush(k + 1);
    } else {
      flush(k);
      out.push(b);
    }
  }
  flush(blocks.length);
  return out;
}

/** Nur http/https-Adressen, sonst null (javascript:, data:, Dateinamen). */
export function safeHref(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (trimmed === "") return null;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? trimmed : null;
  } catch {
    return null;
  }
}

/** Gleicher Host, etwa PDF im eigenen Supabase-Storage. */
export function isSameHost(url: string | null | undefined, base: string | null | undefined): boolean {
  const a = safeHref(url);
  const b = safeHref(base);
  if (!a || !b) return false;
  return new URL(a).host === new URL(b).host;
}

/** «1 Artikel», «42 Artikel · 18 Seiten». */
export function normSummary(p: Pick<ParsedNorm, "articleCount" | "pageCount">): string {
  const parts: string[] = [];
  if (p.articleCount > 0) parts.push(`${p.articleCount} Artikel`);
  if (p.pageCount > 0) parts.push(`${p.pageCount} ${p.pageCount === 1 ? "Seite" : "Seiten"}`);
  return parts.join(" · ");
}
