import { createHash } from "node:crypto";
import type { DraftDiff } from "./types";

const BLOCK_TAGS =
  "article|chapter|section|title|heading|paragraph|item|blockList|listIntroduction|p|table|tr|td|th|preface|preamble|conclusions|attachment|subsection|level|part";
const BLOCK_RE = new RegExp(`</?(?:${BLOCK_TAGS})\\b[^>]*>`, "gi");
const ENTITY_RE = /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(input: string): string {
  return input.replace(ENTITY_RE, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

function stripBlocks(input: string, tag: string): string {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let out = "";
  let pos = 0;
  while (pos < input.length) {
    const start = input.indexOf(open, pos);
    if (start === -1) {
      out += input.slice(pos);
      break;
    }
    const next = input.charCodeAt(start + open.length);
    const isTag = Number.isNaN(next) || next === 62 || next === 32 || next === 47 || next === 9 || next === 10 || next === 13;
    if (!isTag) {
      out += input.slice(pos, start + open.length);
      pos = start + open.length;
      continue;
    }
    out += input.slice(pos, start);
    const end = input.indexOf(close, start);
    if (end === -1) break;
    pos = end + close.length;
  }
  return out;
}

export function xmlToText(xml: string): string {
  const stripped = stripBlocks(stripBlocks(stripBlocks(xml.replace(/<\?xml[^>]*\?>/g, ""), "meta"), "authorialNote"), "script");
  const body = stripped
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/num>/g, " ")
    .replace(BLOCK_RE, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(body)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export function cleanPlainText(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[\s\u0000-/:-@[-`{-¿ -⁯]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

const VERSION_LINE_RE = /\(stand am [^)]*\)/i;

function isVersionLine(part: string): boolean {
  return wordsOf(part).length < 24 && VERSION_LINE_RE.test(part);
}

export function fingerprint(text: string): string {
  const kept = text
    .split("\n")
    .filter((line) => !isVersionLine(line))
    .join("\n");
  return createHash("sha256").update(wordsOf(kept).join(" ")).digest("hex");
}

function fnv(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

const SHINGLE = 6;

function shingles(words: string[]): Set<number> {
  const out = new Set<number>();
  if (words.length < SHINGLE) {
    if (words.length) out.add(fnv(words.join(" ")));
    return out;
  }
  for (let i = 0; i + SHINGLE <= words.length; i++) out.add(fnv(words.slice(i, i + SHINGLE).join(" ")));
  return out;
}

export function similarity(a: string, b: string): number {
  const sa = shingles(wordsOf(a));
  const sb = shingles(wordsOf(b));
  const larger = Math.max(sa.size, sb.size);
  if (larger === 0) return 1;
  let common = 0;
  const [small, big] = sa.size <= sb.size ? [sa, sb] : [sb, sa];
  small.forEach((h) => {
    if (big.has(h)) common++;
  });
  return common / larger;
}

function sentenceUnits(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split("\n")) {
    if (isVersionLine(line)) continue;
    for (const part of line.split(/(?<=[.;:])\s+/)) {
      const words = wordsOf(part);
      if (words.length < 2) continue;
      const key = words.join(" ");
      if (!out.has(key)) out.set(key, part.trim());
    }
  }
  return out;
}

function lineUnits(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split("\n")) {
    const words = wordsOf(line);
    if (words.length === 0 || isVersionLine(line)) continue;
    const key = words.join(" ");
    if (!out.has(key)) out.set(key, line.trim());
  }
  return out;
}

const SAMPLE_LIMIT = 10;
const SAMPLE_CHARS = 240;

const clip = (s: string) => (s.length > SAMPLE_CHARS ? `${s.slice(0, SAMPLE_CHARS - 1)}…` : s);

function compareUnits(before: Map<string, string>, after: Map<string, string>): DraftDiff {
  const removed: string[] = [];
  const added: string[] = [];
  before.forEach((original, key) => {
    if (!after.has(key)) removed.push(original);
  });
  after.forEach((original, key) => {
    if (!before.has(key)) added.push(original);
  });
  return {
    added: added.length,
    removed: removed.length,
    samplesAdded: added.slice(0, SAMPLE_LIMIT).map(clip),
    samplesRemoved: removed.slice(0, SAMPLE_LIMIT).map(clip),
  };
}

export function hasChanges(diff: DraftDiff): boolean {
  return diff.added > 0 || diff.removed > 0;
}

export function diffTexts(oldText: string, newText: string): DraftDiff {
  const bySentence = compareUnits(sentenceUnits(oldText), sentenceUnits(newText));
  if (hasChanges(bySentence)) return bySentence;
  return compareUnits(lineUnits(oldText), lineUnits(newText));
}

const NOTE_ONLY_STRUCTURE = "Der Text unterscheidet sich nur in Reihenfolge oder Wiederholungen, einzelne Sätze lassen sich nicht benennen.";

export function describeChange(oldText: string, newText: string): { changed: boolean; diff: DraftDiff } {
  const changed = fingerprint(oldText) !== fingerprint(newText);
  const diff = diffTexts(oldText, newText);
  if (changed && !hasChanges(diff)) diff.note = NOTE_ONLY_STRUCTURE;
  return { changed, diff };
}

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

export function formatStandDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return iso;
  return `${Number(m[3])}. ${month} ${m[1]}`;
}
