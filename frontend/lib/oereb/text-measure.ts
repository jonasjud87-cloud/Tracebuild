/**
 * Messgrössen eines Dokumenttexts: fortlaufende Artikel, Stand, Textähnlichkeit. Rein und ohne
 * Netz. Läuft nur auf dem Server: Skizzen werden nie an Clients ausgeliefert.
 */

export interface ArticleSequence {
  /** Länge der längsten Folge n, n+1, n+2 … in Textreihenfolge. */
  run: number;
  /** Erste Nummer dieser Folge. */
  first: number | null;
  /** Alle Treffer, auch Querverweise. */
  hits: number;
}

export function foldText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’`´]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const SPACED_LETTERS = new RegExp("(?<![\\p{L}\\p{N}])\\p{L}(?:[ \\t]\\p{L}(?![\\p{L}\\p{N}])){2,}", "gu");

/** Schlechter OCR-Text sperrt Buchstaben («A r t .42», «B a u r e g l e m e n t»). */
export function collapseSpacedLetters(text: string): string {
  return text.replace(SPACED_LETTERS, (m) => m.replace(/[ 	]/g, ""));
}

/**
 * Die Nummer, und bei einer Überschrift am Zeilenanfang auch ihre Anfangsziffern: Das PDF klebt die
 * hochgestellte Fussnote an («Art. 625» ist Art. 6 mit Fussnote 25, Stadt Zürich). Grössere zuerst,
 * damit die Anfangsziffern derselben Überschrift sich nicht gegenseitig verlängern.
 */
function articleCandidates(digits: string, source: string, index: number): number[] {
  const out = [Number(digits)];
  const lineStart = source.lastIndexOf("\n", index - 1) + 1;
  if (source.slice(lineStart, index).trim() === "") {
    for (let cut = digits.length - 1; cut >= 1; cut--) out.push(Number(digits.slice(0, cut)));
  }
  return out;
}

/**
 * Längste fortlaufende Folge. Die Nummer folgt auf ihren Vorgänger nur, wenn dieser früher im Text
 * stand; Querverweise stören deshalb kaum, und ein Inhaltsverzeichnis zählt wie der Erlass selbst.
 */
export function articleSequence(text: string, pattern: string): ArticleSequence {
  let re: RegExp;
  try {
    re = new RegExp(pattern, "gi");
  } catch {
    return { run: 0, first: null, hits: 0 };
  }
  const lengths = new Map<number, number>();
  let hits = 0;
  let run = 0;
  let first: number | null = null;
  const source = collapseSpacedLetters(text);
  for (const m of Array.from(source.matchAll(re))) {
    if (!/^\d+$/.test(m[1] ?? "")) continue;
    hits++;
    for (const n of articleCandidates(m[1], source, m.index ?? 0)) {
      const length = (lengths.get(n - 1) ?? 0) + 1;
      if (length <= (lengths.get(n) ?? 0)) continue;
      lengths.set(n, length);
      if (length > run) {
        run = length;
        first = n - length + 1;
      }
    }
  }
  return { run, first, hits };
}

const MONTHS: Record<string, number> = {
  januar: 1, februar: 2, marz: 3, maerz: 3, april: 4, mai: 5, juni: 6, juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12,
  janvier: 1, fevrier: 2, mars: 3, avril: 4, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6, luglio: 7, agosto: 8, settembre: 9, ottobre: 10, dicembre: 12,
};
const MONTH_NAMES = Object.keys(MONTHS).join("|");
const DATE_SOURCE = `(?:(\\d{1,2})\\s*[./]\\s*(\\d{1,2})\\s*[./]\\s*(\\d{4})|(\\d{1,2})\\.?(?:er)?\\s*(${MONTH_NAMES})\\s*(\\d{4})|(\\d{4})-(\\d{2})-(\\d{2}))`;

function isoDate(y: number, m: number, d: number): string | null {
  if (y < 1800 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function dateFrom(g: (string | undefined)[]): string | null {
  if (g[0]) return isoDate(Number(g[2]), Number(g[1]), Number(g[0]));
  if (g[3]) return isoDate(Number(g[5]), MONTHS[g[4] ?? ""] ?? 0, Number(g[3]));
  if (g[6]) return isoDate(Number(g[6]), Number(g[7]), Number(g[8]));
  return null;
}

/**
 * Jüngster Stand aus Titel, Textanfang und Textende, nur direkt nach einem Stand-Begriff. Der Text
 * dazwischen zitiert oft Fassungen anderer Erlasse und würde das Ergebnis verfälschen.
 */
export function extractStandDate(title: string, text: string, markers: string[]): string | null {
  const edge = 2500;
  const clean = collapseSpacedLetters(text);
  const sources = [title, clean.slice(0, edge), clean.length > edge ? clean.slice(-edge) : ""].map(foldText);
  let best: string | null = null;
  for (const marker of markers) {
    const term = foldText(marker).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!term) continue;
    const re = new RegExp(`(?<![a-z])${term}(?![a-z])[^0-9a-z]{0,6}(?:(?:vom|du|le|al|am|au|per)\\s+)?${DATE_SOURCE}`, "g");
    for (const source of sources) {
      for (const m of Array.from(source.matchAll(re))) {
        const date = dateFrom(m.slice(1));
        if (date && (!best || date > best)) best = date;
      }
    }
  }
  return best;
}

// ── Ähnlichkeit ──────────────────────────────────────────────────────────────

const SHINGLE_WORDS = 4;
const SKETCH_SIZE = 512;

/** Rein rechnerischer Hash (FNV-1a, 32 Bit): Kollisionen verschieben die Schätzung kaum. */
function hashWords(words: string[], start: number): number {
  let h = 0x811c9dc5;
  for (let w = start; w < start + SHINGLE_WORDS; w++) {
    const word = words[w];
    for (let i = 0; i < word.length; i++) {
      h ^= word.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 32;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function shingleSet(text: string): Set<number> {
  const words = foldText(collapseSpacedLetters(text).replace(/-- \d+ of \d+ --/g, " "))
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  const out = new Set<number>();
  for (let i = 0; i + SHINGLE_WORDS <= words.length; i++) out.add(hashWords(words, i));
  return out;
}

/** Anteil der Shingles von `part`, der auch in `whole` vorkommt. */
export function containment(part: Set<number>, whole: Set<number>): number {
  if (part.size === 0) return 0;
  let shared = 0;
  part.forEach((h) => {
    if (whole.has(h)) shared++;
  });
  return shared / part.size;
}

/**
 * Bottom-k-Skizze: Abgelehnte Dokumente werden nicht gespeichert, ihr Vergleich muss trotzdem
 * später möglich sein. Aus der Skizze lässt sich kein Text zurückgewinnen.
 */
export interface TextSketch {
  n: number;
  h: number[];
}

export function textSketch(text: string): TextSketch {
  const all = Array.from(shingleSet(text)).sort((a, b) => a - b);
  return { n: all.length, h: all.slice(0, SKETCH_SIZE) };
}

/** Schätzt den Anteil von `part` in `whole`. Zwei Bottom-k-Skizzen, Jaccard über deren Vereinigung. */
export function sketchContainment(part: TextSketch | null | undefined, whole: TextSketch | null | undefined): number {
  if (!part?.n || !whole?.n) return 0;
  const a = new Set(part.h);
  const b = new Set(whole.h);
  const union = Array.from(new Set([...part.h, ...whole.h])).sort((x, y) => x - y).slice(0, SKETCH_SIZE);
  if (union.length === 0) return 0;
  const shared = union.filter((h) => a.has(h) && b.has(h)).length;
  const jaccard = shared / union.length;
  return Math.min(1, (jaccard * (part.n + whole.n)) / ((1 + jaccard) * part.n));
}
