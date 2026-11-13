import { normTextHash } from "@/lib/norm-hash";

export const DIGEST_VERSION = 1;
export const DIGEST_MIN_SOURCE_CHARS = 15_000;
export const DIGEST_MIN_RATIO = 0.02;
export const DIGEST_MAX_RATIO = 0.6;
export const DIGEST_MIN_REFS = 3;
export const DIGEST_MIN_REF_COVERAGE = 0.6;
export const DIGEST_MIN_VERBATIM = 0.85;
export const DIGEST_NONE_MARKER = "KEINE";
export const SHINGLE_WORDS = 6;

export interface DigestCandidate {
  layer?: number | null;
  org_id?: string | null;
  jurisdiction_type?: string | null;
  country?: string | null;
  auto_scope?: string | null;
  archived_at?: string | null;
  approval_status?: string | null;
  text?: string | null;
}

export function digestEligible(n: DigestCandidate): boolean {
  if (n.org_id) return false;
  if (n.jurisdiction_type !== "national") return false;
  if (n.country !== "CH") return false;
  if (n.auto_scope === "superseded" || n.archived_at || n.approval_status === "draft") return false;
  return (n.text ?? "").length >= DIGEST_MIN_SOURCE_CHARS;
}

const REF_RE = /\bArt(?:ikel|\.)\s*(\d+(?:bis|ter|quater|quinquies|sexies|septies|octies|novies|decies|[a-z])?)(?![a-zäöü0-9])/gi;

export function articleRefs(text: string): Set<string> {
  const out = new Set<string>();
  Array.from(text.matchAll(REF_RE)).forEach((m) => out.add(m[1].toLowerCase()));
  return out;
}

function words(text: string): string[] {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^a-z0-9äöüéèêëàâîïôùûçì]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function shingles(list: string[], size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + size <= list.length; i++) out.push(list.slice(i, i + size).join(" "));
  return out;
}

const HEADER_RE = /^\W*Art(?:ikel|\.)\s*\d+(?:bis|ter|quater|quinquies|sexies|septies|octies|novies|decies|[a-z])?(?![a-zäöü0-9])\s*(?:\([^)]*\))?\s*:?/i;

function digestUnits(digest: string): string[] {
  return digest
    .split(/\n+(?=\W*Art(?:ikel|\.)\s*\d)/)
    .map((unit) => unit.replace(HEADER_RE, ""));
}

export function verbatimRatio(source: string, digest: string): number {
  const known = new Set(shingles(words(source), SHINGLE_WORDS));
  let total = 0;
  let hit = 0;
  digestUnits(digest).forEach((unit) => {
    shingles(words(unit), SHINGLE_WORDS).forEach((s) => {
      total += 1;
      if (known.has(s)) hit += 1;
    });
  });
  return total ? hit / total : 0;
}

export interface DigestCheck {
  ok: boolean;
  reason: string | null;
  refs: number;
  coverage: number;
  verbatim: number;
  omitted: string[];
  unknown: string[];
}

function fail(reason: string, extra: Partial<DigestCheck> = {}): DigestCheck {
  return { ok: false, reason, refs: 0, coverage: 0, verbatim: 0, omitted: [], unknown: [], ...extra };
}

export function verifyDigest(source: string, digest: string): DigestCheck {
  const text = digest.trim();
  const ratio = source.length ? text.length / source.length : 0;
  if (!text) return fail("Der Auszug ist leer.");
  if (ratio < DIGEST_MIN_RATIO) return fail("Der Auszug ist unplausibel kurz.");
  if (ratio > DIGEST_MAX_RATIO) return fail("Der Auszug kürzt kaum.");

  const wanted = articleRefs(text);
  if (wanted.size < DIGEST_MIN_REFS) return fail("Zu wenige Artikel im Auszug.", { refs: wanted.size });

  const known = articleRefs(source);
  const unknown = Array.from(wanted).filter((ref) => !known.has(ref));
  const coverage = (wanted.size - unknown.length) / wanted.size;
  const verbatim = verbatimRatio(source, text);
  const detail = { refs: wanted.size, coverage, verbatim, unknown };

  if (verbatim < DIGEST_MIN_VERBATIM) return fail("Der Auszug weicht zu stark vom Wortlaut des Gesetzes ab.", detail);
  if (coverage < DIGEST_MIN_REF_COVERAGE) return fail("Der Auszug nennt zu viele Artikel, die im Gesetz nicht vorkommen.", detail);

  const omitted = Array.from(known).filter((ref) => !wanted.has(ref));
  return { ok: true, reason: null, refs: wanted.size, coverage, verbatim, omitted, unknown };
}

export function digestNote(check: DigestCheck, sourceRefs: number): string {
  if (!check.ok) {
    const parts = [check.reason ?? "Prüfung fehlgeschlagen"];
    if (check.verbatim) parts.push(`Wortlaut ${Math.round(check.verbatim * 100)} %`);
    if (check.unknown.length) parts.push(`unbekannte Artikel: ${check.unknown.slice(0, 12).join(", ")}${check.unknown.length > 12 ? " …" : ""}`);
    return parts.join(", ");
  }
  return `${check.refs} von ${sourceRefs} Artikeln übernommen, ${Math.round(check.verbatim * 100)} % Wortlaut`;
}

export const DIGEST_NOTICE =
  "PRÜFAUSZUG: Aus dem Volltext der Norm automatisch erstellt. Er enthält nur die Bestimmungen, die sich an einem Plan oder Baugesuch prüfen lassen, im Wortlaut des Gesetzes. " +
  "Prüfe nur gegen diese Bestimmungen. Weitere Bestimmungen der Norm sind für diesen Prüfauftrag nicht Gegenstand.\n\n";

export function digestPromptText(digest: string): string {
  return DIGEST_NOTICE + digest.trim();
}

export interface StoredDigest {
  sha: string;
  digest: string;
}

export interface DigestableNorm {
  id: string;
  text: string;
  digest?: boolean | null;
}

export function applyDigests<T extends DigestableNorm>(norms: T[], digests: Map<string, StoredDigest>): T[] {
  return norms.map((n) => {
    const found = n.id ? digests.get(n.id) : undefined;
    if (!found || !found.digest.trim()) return n;
    if (normTextHash(n.text) !== found.sha) return n;
    return { ...n, text: digestPromptText(found.digest), digest: true };
  });
}

export function digestsEnabled(): boolean {
  return process.env.NORM_DIGEST_DISABLED !== "1";
}
