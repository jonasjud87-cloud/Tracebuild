/**
 * Importfilter für ÖREB-Dokumente: rein und deterministisch, keine KI, keine Kosten.
 * Die Regeln stehen als Daten in `oereb_import_filters` über dem Standard hier im Code.
 * Jeder Ablehnungsgrund wird in `oereb_documents` gespeichert.
 */
import { isOerebSupportedCanton } from "./cantons";

export interface ImportFilterRules {
  doc_types: string[];
  title_positive: string[];
  title_negative: string[];
  title_reject_exact: string[];
  /** Nicht rechtskräftig (Auflage, Vorprüfung): schlägt auch einen positiven Titel. */
  title_not_in_force: string[];
  /** Nur Reihenfolge: Änderungserlasse kommen nach dem Haupterlass dran (Deckel pro Gemeinde). */
  title_amendment: string[];
  /** Stehen diese Begriffe am Textanfang, ist das PDF ein Beschluss und kein Erlass (AG: RRB unter Plantitel). */
  content_reject_head: string[];
  authority_reject: string[];
  allowed_hosts: string[];
  /** Nur diese Hosts dürfen über http laden. Sonst nur https. */
  http_allowed_hosts: string[];
  min_text_chars: number;
  min_article_hits: number;
  article_pattern: string;
  max_pdf_bytes: number;
  max_accepted_per_municipality: number;
  recheck_hours: number;
  shrink_min_ratio: number;
  /** Eine neue URL löst eine alte erst ab, wenn diese gemeindeweit so lange in keinem Auszug mehr stand. */
  supersede_after_days: number;
}

export const DEFAULT_IMPORT_FILTER: ImportFilterRules = {
  doc_types: ["LegalProvision"],
  title_positive: [
    "baureglement", "bauordnung", "bau- und zonen", "bau- und nutzungsordnung", "bauzonenreglement", "zonenreglement",
    "baugesetz der", "nutzungsreglement", "règlement communal", "règlement sur les constructions",
    "règlement de construction", "rccz", "regolamento edilizio", "norme di attuazione",
  ],
  title_negative: [
    "zonenplan", "plan d'affectation", "paz", "piano delle zone", "erschliessungsplan",
    "genehmigung", "approbation", "décision", "entscheid", "rrb", "bericht", "rapport", "karte", "carte",
    "kataster", "schutzinventar", "dsi-", "informations complémentaires",
    // Reine Pläne aus den Live-Listen (VD, VS, OW): sparen je einen Download.
    "plan des", "änderungsplan", "gefahrenplan",
  ],
  title_reject_exact: [],
  title_not_in_force: ["öffentliche auflage", "öffentlicher auflage", "vorprüfung", "mise à l'enquête", "enquête publique"],
  title_amendment: ["änderung", "teilrevision", "teiländerung", "nachtrag", "modification", "modifica", "décision"],
  content_reject_head: ["protokoll des regierungsrat", "regierungsratsbeschluss", "décision du conseil d'etat"],
  authority_reject: ["bundeskanzlei", "chancellerie fédérale", "cancelleria federale", "bundesamt"],
  allowed_hosts: ["*.{kt}.ch", "gis-daten.ch", "*.gis-daten.ch", "lisag.ch", "*.lisag.ch", "ge.ch", "*.ge.ch", "jura.ch", "*.jura.ch"],
  // Live belegt: VD leitet über http um, LU führt Dokumente unter http.
  http_allowed_hosts: ["www.rdppf.vd.ch", "www.geo.lu.ch"],
  min_text_chars: 3000,
  min_article_hits: 5,
  // § für Kantone, deren Erlasse in Paragrafen gegliedert sind (AG, BL, BS).
  article_pattern: "\\b(?:Art\\.|Artikel|article|articolo)\\s*\\d|§\\s*\\d",
  max_pdf_bytes: 41_943_040,
  max_accepted_per_municipality: 8,
  recheck_hours: 24,
  shrink_min_ratio: 0.5,
  supersede_after_days: 30,
};

const ARRAY_KEYS = [
  "doc_types", "title_positive", "title_negative", "title_reject_exact", "title_not_in_force", "title_amendment",
  "content_reject_head", "authority_reject", "allowed_hosts", "http_allowed_hosts",
] as const;
const NUMBER_KEYS = [
  "min_text_chars", "min_article_hits", "max_pdf_bytes", "max_accepted_per_municipality", "recheck_hours", "shrink_min_ratio", "supersede_after_days",
] as const;

function stringList(v: unknown): string[] | null {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;
}

/**
 * Legt eine Datenzeile über die Regeln: `x` ersetzt, `x_add` ergänzt Arrays. Fehlerhafte Werte
 * werden ignoriert, weil die Zeilen von Hand per SQL gepflegt werden.
 */
export function mergeFilterRules(base: ImportFilterRules, overlay: unknown): ImportFilterRules {
  if (!overlay || typeof overlay !== "object") return base;
  const o = overlay as Record<string, unknown>;
  const out: ImportFilterRules = { ...base };
  for (const key of ARRAY_KEYS) {
    const replaced = stringList(o[key]);
    if (replaced) out[key] = replaced;
    const added = stringList(o[`${key}_add`]);
    if (added) out[key] = Array.from(new Set([...out[key], ...added]));
  }
  for (const key of NUMBER_KEYS) {
    const v = o[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[key] = v;
  }
  if (typeof o.article_pattern === "string" && compilePattern(o.article_pattern)) out.article_pattern = o.article_pattern;
  return out;
}

/** Zuerst `default`, dann der Kanton darüber. Inaktive Zeilen zählen nicht. */
export function resolveFilterRules(
  rows: { scope: string; rules: unknown; active?: boolean | null }[],
  canton: string
): ImportFilterRules {
  const active = rows.filter((r) => r.active !== false);
  const def = active.find((r) => r.scope === "default");
  const own = active.find((r) => r.scope === canton.toUpperCase());
  return mergeFilterRules(mergeFilterRules(DEFAULT_IMPORT_FILTER, def?.rules), own?.rules);
}

// ── Titel ────────────────────────────────────────────────────────────────────

function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’`´]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Teilstring, ausser bei kurzen Begriffen (bis 4 Zeichen): Die müssen als eigenes Wort stehen,
 * sonst träfe «paz» auch «spazio» und «rrb» beliebige Wörter.
 */
export function matchesTerm(foldedText: string, term: string): boolean {
  const t = fold(term);
  if (!t) return false;
  if (t.length > 4) return foldedText.includes(t);
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tail = /[a-z0-9]$/.test(t) ? "(?![a-z0-9])" : "";
  return new RegExp(`(?<![a-z0-9])${esc}${tail}`).test(foldedText);
}

export function isTitlePositive(title: string, rules: ImportFilterRules): boolean {
  const f = fold(title);
  return rules.title_positive.some((t) => matchesTerm(f, t));
}

/** Kleinere Zahl zuerst: Haupterlass, dann Änderungen des Haupterlasses, dann neutrale Titel. */
export function documentPriority(title: string, rules: ImportFilterRules): number {
  if (!isTitlePositive(title, rules)) return 2;
  const f = fold(title);
  return rules.title_amendment.some((t) => matchesTerm(f, t)) ? 1 : 0;
}

/** `municipal` nur bei positivem Titel. Sonst gilt die Vorschrift nur für Grundstücke mit ihr im Auszug. */
export function scopeOf(title: string, rules: ImportFilterRules): "municipal" | "parcel" {
  return isTitlePositive(title, rules) ? "municipal" : "parcel";
}

// ── Host ─────────────────────────────────────────────────────────────────────

export function isHostAllowed(host: string, rules: ImportFilterRules, canton: string): boolean {
  const h = host.toLowerCase();
  if (!h.endsWith(".ch") && !h.endsWith(".swiss")) return false;
  // Nur echte Kantone: Aus «EVIL» würde sonst *.evil.ch.
  const kt = isOerebSupportedCanton(canton) ? canton.trim().toLowerCase() : null;
  return rules.allowed_hosts.some((pattern) => {
    if (pattern.includes("{kt}") && !kt) return false;
    const p = pattern.toLowerCase().replace("{kt}", kt ?? "");
    return p.startsWith("*.") ? h.endsWith(p.slice(1)) && h.length > p.length - 1 : h === p;
  });
}

export function isHttpAllowed(host: string, rules: ImportFilterRules): boolean {
  return rules.http_allowed_hosts.includes(host.toLowerCase());
}

// ── Entscheid vor dem Download ───────────────────────────────────────────────

export type PreDownloadReason = "doc_type" | "authority" | "title_exact" | "not_in_force" | "title_negative" | "host_not_allowed";

/** Gründe, die eine Regeländerung ohne erneuten Download neu beurteilen kann. */
export const PRE_DOWNLOAD_REASONS: ReadonlySet<string> = new Set<PreDownloadReason>([
  "doc_type", "authority", "title_exact", "not_in_force", "title_negative", "host_not_allowed",
]);
export type ContentReason = "scan_or_short" | "decision_document" | "no_articles" | "too_long";

export interface FilterRejection<R extends string = string> {
  reason: R;
  detail: string;
}

export function decidePreDownload(
  doc: { title: string; doc_type: string | null; authority: string | null; url: string },
  rules: ImportFilterRules,
  canton: string
): FilterRejection<PreDownloadReason> | null {
  if (!doc.doc_type || !rules.doc_types.includes(doc.doc_type)) {
    return { reason: "doc_type", detail: `Dokumentart ${doc.doc_type ?? "unbekannt"} wird nicht importiert` };
  }
  const f = fold(doc.title);
  const authority = fold(doc.authority ?? "");
  const badAuthority = rules.authority_reject.find((t) => authority && matchesTerm(authority, t));
  if (badAuthority) return { reason: "authority", detail: `Behörde enthält «${badAuthority}»` };
  if (rules.title_reject_exact.some((t) => fold(t) === f)) {
    return { reason: "title_exact", detail: `Titel «${doc.title}» ist ausgeschlossen` };
  }
  const notInForce = rules.title_not_in_force.find((t) => matchesTerm(f, t));
  if (notInForce) return { reason: "not_in_force", detail: `Titel enthält «${notInForce}»` };
  if (!isTitlePositive(doc.title, rules)) {
    const negative = rules.title_negative.find((t) => matchesTerm(f, t));
    if (negative) return { reason: "title_negative", detail: `Titel enthält «${negative}»` };
  }
  let host = "";
  let protocol = "";
  try {
    const parsed = new URL(doc.url);
    host = parsed.hostname;
    protocol = parsed.protocol;
  } catch {
    // ungültige URL fällt unten als unerlaubter Host durch
  }
  if (!isHostAllowed(host, rules, canton)) {
    return { reason: "host_not_allowed", detail: `Host ${host || "(ungültig)"} steht nicht auf der Liste` };
  }
  if (protocol !== "https:" && !isHttpAllowed(host, rules)) {
    return { reason: "host_not_allowed", detail: `${host}: nur https erlaubt` };
  }
  return null;
}

// ── Entscheid nach dem Download ──────────────────────────────────────────────

function compilePattern(source: string): RegExp | null {
  try {
    return new RegExp(source, "gi");
  } catch {
    return null;
  }
}

/** Textlänge und Artikel. `too_long` ergänzt der Aufrufer über normTextTooLongMessage. */
export function decideContent(text: string, rules: ImportFilterRules): FilterRejection<ContentReason> | null {
  const trimmed = text.trim();
  if (trimmed.length < rules.min_text_chars) {
    return { reason: "scan_or_short", detail: `${trimmed.length} Zeichen, verlangt sind ${rules.min_text_chars}` };
  }
  const head = fold(trimmed.slice(0, 400));
  const decision = rules.content_reject_head.find((t) => matchesTerm(head, t));
  if (decision) return { reason: "decision_document", detail: `Textanfang enthält «${decision}»` };
  const re = compilePattern(rules.article_pattern) ?? compilePattern(DEFAULT_IMPORT_FILTER.article_pattern);
  const hits = re ? (trimmed.match(re) ?? []).length : 0;
  if (hits < rules.min_article_hits) {
    return { reason: "no_articles", detail: `${hits} Artikel erkannt, verlangt sind ${rules.min_article_hits}` };
  }
  return null;
}

/** Stabile Form für den Vergleich mit `filter_snapshot` (jsonb sortiert die Schlüssel um). */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}
