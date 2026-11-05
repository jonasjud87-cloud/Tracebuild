/**
 * Importfilter für ÖREB-Dokumente: rein und deterministisch, keine KI, keine Kosten.
 * Die Regeln stehen als Daten in `oereb_import_filters` über dem Standard hier im Code.
 * Jeder Ablehnungsgrund wird in `oereb_documents` gespeichert.
 */
import { isOerebSupportedCanton } from "./cantons";
import { articleSequence, countParagraphGroups, type ArticleSequence } from "./text-measure";

export interface ImportFilterRules {
  doc_types: string[];
  title_positive: string[];
  title_negative: string[];
  title_reject_exact: string[];
  /** Nicht rechtskräftig (Auflage, Vorprüfung): schlägt auch einen positiven Titel. */
  title_not_in_force: string[];
  /** Nur Reihenfolge: Änderungserlasse kommen nach dem Haupterlass dran (Deckel pro Gemeinde). */
  title_amendment: string[];
  /** Sondernutzung und Schutz: gelten nur für das Grundstück, auch mit positivem Titel, und schlagen `title_negative`. */
  title_special_plan: string[];
  /** Titel nennt eine Vorschrift: nie am Plan- oder Entscheidwort im Titel verwerfen, der Inhaltstest entscheidet. */
  title_regulation: string[];
  /** Dokumenttyp Hint wird nur mit diesen Titeln geprüft. */
  hint_allow: string[];
  /** Weitere Dokumenttypen, die nur mit positivem Titel zählen (VS führt Gemeinde-Reglemente als Law). */
  doc_types_positive_title: string[];
  /** Stehen diese Begriffe am Textanfang, ist das PDF ein Beschluss und kein Erlass (AG: RRB unter Plantitel). */
  content_reject_head: string[];
  /** Briefmerkmale (Anrede, «Geschäft Nr.», «A-Post»). Stehen genug davon am Textanfang, ist das PDF ein Schreiben. */
  letter_head_terms: string[];
  /** Stand-Begriffe vor einem Datum: «Nachgeführt bis 31.12.2022». */
  version_date_markers: string[];
  /** Eigenständige Beilagen: treten nicht als Fassung gegen den Haupterlass an. */
  title_annex: string[];
  authority_reject: string[];
  allowed_hosts: string[];
  /** Nur diese Hosts dürfen über http laden. Sonst nur https. */
  http_allowed_hosts: string[];
  min_text_chars: number;
  /** Mindestlänge der fortlaufenden Folge Art. n, n+1, n+2 … */
  min_article_run: number;
  /** Tiefere Grenze für Änderungserlasse (`title_amendment`): Sie ändern oft nur wenige Artikel. */
  min_article_run_amendment: number;
  /** Titel ohne Hinweis auf ein Reglement (auch «Nutzungsplanung»): Unter dieser Folge ist es kein Erlass. */
  min_article_run_neutral: number;
  /** Querverweise zählen nicht: Art. n, danach einer dieser Begriffe (BauG, PBV, Abs. …). */
  article_reference_after: string[];
  /** Querverweise zählen nicht: einer dieser Begriffe, danach Art. n (nach, gemäss, BauG …). */
  article_reference_before: string[];
  /** Sachtitel ohne Artikelnummern (AI, TG): So viele Abschnitte mit Absatz «1», «2» … bei Erlassformel genügen. */
  min_paragraph_groups: number;
  /** Erlassformel: Belegt, dass die Absätze zu einem Erlass gehören. */
  enactment_terms: string[];
  /** Muss die Artikelnummer als erste Gruppe erfassen. */
  article_pattern: string;
  letter_head_chars: number;
  letter_head_min_hits: number;
  /** Ab dieser Folge bleibt ein Dokument trotz Briefkopf erhalten: Begleitbrief mit angehängtem Erlass. */
  letter_override_article_run: number;
  /** Fassungen mit mindestens diesem Anteil der längsten Folge gelten als gleich lang; dann entscheidet der Stand. */
  version_run_tie_ratio: number;
  /** Mindestanteil gemeinsamen Texts, damit ein vollständiges Dokument als ältere Fassung abgelehnt wird. */
  version_min_overlap: number;
  /** Abgelehnte ältere Fassungen werden seltener nachgeprüft (grosse Scans). */
  older_version_recheck_hours: number;
  /** Ab diesem Anteil gemeinsamen Texts löst die amtliche Fassung einen Upload ab. */
  upload_similarity_min: number;
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
    "baureglement", "bauordnung", "bau- und zonen", "bau- und nutzungsordnung", "bauzonenreglement", "=zonenreglement",
    // «=» verlangt den Wortanfang: «Teilzonenreglement» ist kein Zonenreglement. «+» verlangt alle Teile.
    "baugesetz der", "nutzungsreglement", "règlement sur les constructions",
    "règlement communal+constructions", "règlement communal+police", "règlement communal+zones",
    "règlement de construction", "rccz", "regolamento edilizio", "norme di attuazione",
    "=bzo", "zonenordnung", "zonenvorschriften", "nutzungsordnung", "lescha da construcziun", "legge edilizia",
    "règlement communal d'urbanisme", "règlement du plan général d'affectation", "plan général d'affectation+règlement",
    "règlement des constructions", "règlement d'aménagement", "regolamento comunale", "=napr",
  ],
  title_negative: [
    "=zonenplan", "plan d'affectation des zones", "paz", "piano delle zone", "erschliessungsplan",
    "genehmigung", "approbation", "décision", "entscheid", "rrb", "bericht", "rapport", "karte", "carte",
    "kataster", "schutzinventar", "dsi-", "informations complémentaires",
    // Reine Pläne aus den Live-Listen (VD, VS, OW): sparen je einen Download.
    "=plan des", "änderungsplan", "gefahrenplan",
  ],
  title_special_plan: [
    "gestaltungsplan", "quartierplan", "überbauungsplan", "überbauungsordnung", "bebauungsplan", "sonderbauvorschrift",
    "besondere vorschriften", "schutzverordnung", "schutzreglement", "schutzplan", "gewässerraum", "baulinien",
    "plan de quartier", "plan partiel d'affectation", "plan d'aménagement de détail", "plan localisé de quartier",
    "plan d'utilisation du sol", "espace réservé aux eaux", "piano particolareggiato", "piano di quartiere",
  ],
  title_regulation: ["reglement", "reglent", "verordnung", "vorschrift", "ordonnance", "regolamento", "prescription"],
  hint_allow: ["altes baugesetz", "hinweis rechtsdokumente snp"],
  doc_types_positive_title: ["Law"],
  title_reject_exact: [],
  title_not_in_force: ["öffentliche auflage", "öffentlicher auflage", "vorprüfung", "mise à l'enquête", "enquête publique"],
  title_amendment: ["änderung", "teilrevision", "teiländerung", "nachtrag", "modification", "modifica"],
  content_reject_head: [
    "protokoll des regierungsrat", "regierungsrat protokoll", "regierungsratsbeschluss", "auszug aus dem protokoll",
    "décision du conseil d'etat", "extrait du procès-verbal",
  ],
  letter_head_terms: [
    "sehr geehrte", "geschäft nr", "a-post", "einschreiben", "unser zeichen", "ihr schreiben",
    "madame, monsieur", "mesdames", "monsieur le", "madame la", "affaire n", "courrier a", "recommandé", "nos réf",
    "gentili signore", "egregi signori", "egregio signor", "gentile signor", "pratica n", "raccomandata", "posta a,",
  ],
  version_date_markers: [
    "nachgeführt bis", "nachgeführt am", "nachgeführt", "stand", "stand vom", "fassung vom", "gültig ab", "in kraft seit",
    "état au", "état le", "version du", "mise à jour", "stato al", "aggiornato al", "versione del",
  ],
  title_annex: ["anhang", "anhänge", "beilage", "annexe", "allegato"],
  authority_reject: ["bundeskanzlei", "chancellerie fédérale", "cancelleria federale", "bundesamt"],
  allowed_hosts: ["*.{kt}.ch", "gis-daten.ch", "*.gis-daten.ch", "lisag.ch", "*.lisag.ch", "ge.ch", "*.ge.ch", "jura.ch", "*.jura.ch"],
  // Live belegt: VD leitet über http um, LU führt Dokumente unter http.
  http_allowed_hosts: ["www.rdppf.vd.ch", "www.geo.lu.ch"],
  min_text_chars: 3000,
  min_article_run: 5,
  min_article_run_amendment: 2,
  min_article_run_neutral: 10,
  article_reference_after: [
    "Abs", "Absatz", "al.", "cpv", "lit.", "Bst.", "ff.", "BauG", "BauV", "PBG", "PBV", "LSV", "RPG", "RPV", "VRP", "GSchG", "GSchV",
    "USG", "NHG", "NHV", "WaG", "ZGB", "SIA", "BV", "VRG", "LATeC", "LAT", "OAT", "LC", "CC", "LPT", "OPT",
  ],
  article_reference_before: [
    "nach", "gemäss", "gem.", "von", "vgl.", "siehe", "laut", "i.V.m.", "m.", "selon", "conformément à", "ai sensi",
    "BauG", "BauV", "PBG", "PBV", "LSV", "RPG", "RPV", "VRP", "GSchG", "GSchV", "USG", "NHG", "WaG", "ZGB", "LATeC", "LAT",
  ],
  min_paragraph_groups: 8,
  enactment_terms: ["erlässt", "gestützt auf", "beschliesst", "inkrafttreten", "arrête", "entrée en vigueur", "visto", "decreta", "entrata in vigore"],
  // § und Paragraf für Kantone, deren Erlasse in Paragrafen gegliedert sind (AG, BL, BS).
  article_pattern: "(?:\\bArt(?:ikel|icle|icolo)?\\s*\\.?|\\bParagra(?:ph|f)\\s*|§§?)\\s*(\\d{1,3})(?!\\d)",
  letter_head_chars: 1500,
  letter_head_min_hits: 2,
  letter_override_article_run: 10,
  version_run_tie_ratio: 0.9,
  // Vorlagen derselben Region teilen bis 0.31: Nur fast gleicher Text gilt als Fassung.
  version_min_overlap: 0.7,
  older_version_recheck_hours: 168,
  upload_similarity_min: 0.8,
  max_pdf_bytes: 41_943_040,
  max_accepted_per_municipality: 8,
  recheck_hours: 24,
  shrink_min_ratio: 0.5,
  supersede_after_days: 30,
};

const ARRAY_KEYS = [
  "doc_types", "title_positive", "title_negative", "title_reject_exact", "title_not_in_force", "title_amendment",
  "content_reject_head", "letter_head_terms", "version_date_markers", "title_annex", "title_special_plan", "title_regulation", "hint_allow",
  "doc_types_positive_title", "article_reference_after", "article_reference_before", "enactment_terms", "authority_reject", "allowed_hosts", "http_allowed_hosts",
] as const;
const NUMBER_KEYS = [
  "min_text_chars", "min_article_run", "min_article_run_amendment", "min_article_run_neutral", "min_paragraph_groups", "max_pdf_bytes", "max_accepted_per_municipality", "recheck_hours", "shrink_min_ratio", "supersede_after_days",
  "letter_head_chars", "letter_head_min_hits", "letter_override_article_run", "version_run_tie_ratio", "version_min_overlap", "older_version_recheck_hours", "upload_similarity_min",
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
  if (typeof o.article_pattern === "string" && capturesNumber(o.article_pattern)) out.article_pattern = o.article_pattern;
  return out;
}

/**
 * Zuerst `default`, dann der Kanton darüber. Eine inaktive Zeile darf nichts freigeben: Ihr Überschreiben
 * könnte gerade der Stopp sein. Deshalb stoppt sie ihren Geltungsbereich. Zum Entfernen die Zeile löschen.
 */
export function resolveFilterRules(
  rows: { scope: string; rules: unknown; active?: boolean | null }[],
  canton: string
): ImportFilterRules {
  const code = canton.toUpperCase();
  const def = rows.find((r) => r.scope === "default");
  const own = rows.find((r) => r.scope === code);
  const merged = mergeFilterRules(
    mergeFilterRules(DEFAULT_IMPORT_FILTER, def?.active !== false ? def?.rules : undefined),
    own?.active !== false ? own?.rules : undefined
  );
  return def?.active === false || own?.active === false ? { ...merged, doc_types: [] } : merged;
}

/** Filter nicht lesbar: nichts Neues importieren, und nichts anhand dieser Regeln neu beurteilen. */
export const FAIL_CLOSED_FILTER: ImportFilterRules = { ...DEFAULT_IMPORT_FILTER, doc_types: [] };

/**
 * Welche Regeln den jeweiligen Inhaltsgrund beeinflussen. Nur dann lohnt sich ein neuer Download:
 * Eine Änderung an Hosts oder am Stopp lädt keine Scans erneut.
 */
const CONTENT_RULES: Record<string, (keyof ImportFilterRules)[]> = {
  scan_or_short: ["min_text_chars"],
  decision_document: ["content_reject_head", "letter_head_terms", "letter_head_chars", "letter_head_min_hits", "letter_override_article_run"],
  no_articles: [
    "article_pattern", "min_article_run", "min_article_run_amendment", "min_article_run_neutral", "title_amendment",
    "article_reference_after", "article_reference_before", "min_paragraph_groups", "enactment_terms", "title_positive",
  ],
};

export function contentRulesChanged(reason: string | null | undefined, snapshot: unknown, rules: ImportFilterRules): boolean {
  const keys = CONTENT_RULES[reason ?? ""];
  if (!keys) return false;
  const old = (snapshot && typeof snapshot === "object" ? snapshot : {}) as Record<string, unknown>;
  return keys.some((key) => stableJson(old[key]) !== stableJson(rules[key]));
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
 * sonst träfe «paz» auch «spazio» und «rrb» beliebige Wörter. «=» am Anfang verlangt den Wortanfang,
 * «a+b» verlangt beide Teile.
 */
export function matchesTerm(foldedText: string, term: string): boolean {
  if (term.includes("+")) return term.split("+").every((part) => matchesTerm(foldedText, part));
  const wordStart = term.startsWith("=");
  const t = fold(wordStart ? term.slice(1) : term);
  if (!t) return false;
  if (t.length > 4 && !wordStart) return foldedText.includes(t);
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tail = t.length <= 4 && /[a-z0-9]$/.test(t) ? "(?![a-z0-9])" : "";
  return new RegExp(`(?<![a-z0-9])${esc}${tail}`).test(foldedText);
}

export function isTitlePositive(title: string, rules: ImportFilterRules): boolean {
  const f = fold(title);
  return rules.title_positive.some((t) => matchesTerm(f, t));
}

export function isSpecialPlanTitle(title: string, rules: ImportFilterRules): boolean {
  const f = fold(title);
  return rules.title_special_plan.some((t) => matchesTerm(f, t));
}

/** AR führt «Baureglement» in der amtlichen Nummer, der Titel ist nur der Gemeindename. */
export function isOfficialNumberPositive(officialNumber: string | null | undefined, rules: ImportFilterRules): boolean {
  return !!officialNumber && isTitlePositive(officialNumber, rules);
}

/** Kleinere Zahl zuerst: Haupterlass, dann Änderungen des Haupterlasses, dann neutrale Titel. */
export function documentPriority(title: string, rules: ImportFilterRules): number {
  if (!isTitlePositive(title, rules)) return 2;
  const f = fold(title);
  return rules.title_amendment.some((t) => matchesTerm(f, t)) ? 1 : 0;
}

/** `municipal` bei positivem Titel oder positiver Nummer, nie bei Sondernutzung und Schutz. Sonst gilt die Vorschrift nur für Grundstücke mit ihr im Auszug. */
export function scopeOf(title: string, rules: ImportFilterRules, officialNumber?: string | null): "municipal" | "parcel" {
  if (isSpecialPlanTitle(title, rules)) return "parcel";
  return isTitlePositive(title, rules) || isOfficialNumberPositive(officialNumber, rules) ? "municipal" : "parcel";
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
/** Grund nach dem Vergleich der Fassungen innerhalb eines Auszugs. */
export const OLDER_VERSION_REASON = "older_version";
/** Nicht übernommen, aber auch nicht verworfen: Ein Mensch soll den Erlass ansehen. */
export const REVIEW_STATUS = "review";

export interface FilterRejection<R extends string = string> {
  reason: R;
  detail: string;
}

export function decidePreDownload(
  doc: { title: string; doc_type: string | null; authority: string | null; url: string },
  rules: ImportFilterRules,
  canton: string
): FilterRejection<PreDownloadReason> | null {
  // Der leere Filter ist der Stopp: Dann gilt auch keine Ausnahme.
  const typeAllowed =
    !!doc.doc_type &&
    (rules.doc_types.includes(doc.doc_type) ||
      (rules.doc_types.length > 0 &&
        ((doc.doc_type === "Hint" && rules.hint_allow.some((t) => matchesTerm(fold(doc.title), t))) ||
          (rules.doc_types_positive_title.includes(doc.doc_type) && isTitlePositive(doc.title, rules)))));
  if (!typeAllowed) {
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
  const protectedTitle =
    isTitlePositive(doc.title, rules) || isSpecialPlanTitle(doc.title, rules) || rules.title_regulation.some((t) => matchesTerm(f, t));
  if (!protectedTitle) {
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

/** Das Muster muss kompilieren und die Nummer als erste Gruppe liefern. */
function capturesNumber(source: string): boolean {
  try {
    return (new RegExp(`${source}|`).exec("") as RegExpExecArray).length > 1;
  } catch {
    return false;
  }
}

export function isAmendmentTitle(title: string, rules: ImportFilterRules): boolean {
  const f = fold(title);
  return rules.title_amendment.some((t) => matchesTerm(f, t));
}

export function isAnnexTitle(title: string, rules: ImportFilterRules): boolean {
  const f = fold(title);
  return rules.title_annex.some((t) => matchesTerm(f, t));
}

export interface ContentAssessment {
  rejection: FilterRejection<ContentReason> | null;
  sequence: ArticleSequence;
  /** Besteht, sieht aber nach Begleitbrief aus: im Testlauf als Verdacht zeigen. */
  letterWithArticles: boolean;
}

/** Textlänge, Beschluss, Brief, fortlaufende Artikel. `too_long` ergänzt der Aufrufer über normTextTooLongMessage. */
export function assessContent(text: string, rules: ImportFilterRules, title = ""): ContentAssessment {
  const trimmed = text.trim();
  const sequence = articleSequence(trimmed, rules.article_pattern, {
    after: rules.article_reference_after,
    before: rules.article_reference_before,
  });
  const done = (rejection: FilterRejection<ContentReason> | null, letterWithArticles = false): ContentAssessment => ({ rejection, sequence, letterWithArticles });
  if (trimmed.length < rules.min_text_chars) {
    return done({ reason: "scan_or_short", detail: `${trimmed.length} Zeichen, verlangt sind ${rules.min_text_chars}` });
  }
  const head = fold(trimmed.slice(0, 400));
  const decision = rules.content_reject_head.find((t) => matchesTerm(head, t));
  if (decision) return done({ reason: "decision_document", detail: `Textanfang enthält «${decision}»` });

  const letterHead = fold(trimmed.slice(0, rules.letter_head_chars));
  const letterTerms = rules.letter_head_terms.filter((t) => matchesTerm(letterHead, t));
  const isLetter = letterTerms.length >= Math.max(1, rules.letter_head_min_hits);
  if (isLetter && sequence.run < rules.letter_override_article_run) {
    return done({ reason: "decision_document", detail: `Schreiben statt Erlass, Briefmerkmale: ${letterTerms.map((t) => `«${t}»`).join(", ")}` });
  }

  // Grenze: Änderung tief, Reglementstitel normal, sonst hoch (SH «Nutzungsplanung (2006)» ist ein Beschluss).
  const namedRegulation = isTitlePositive(title, rules) || isSpecialPlanTitle(title, rules);
  const required = isAmendmentTitle(title, rules)
    ? rules.min_article_run_amendment
    : namedRegulation
      ? rules.min_article_run
      : rules.min_article_run_neutral;
  // Sachtitel mit Absätzen «1», «2» und Erlassformel (AI, TG) sind Erlasse ohne Artikelnummern.
  const passes = sequence.run >= required || (namedRegulation && isParagraphEnactment(trimmed, rules));
  if (!passes) {
    return done({
      reason: "no_articles",
      detail: `Längste Artikelfolge ${sequence.run} (${sequence.hits} Treffer), verlangt sind ${required} fortlaufende`,
    });
  }
  return done(null, isLetter);
}

function isParagraphEnactment(text: string, rules: ImportFilterRules): boolean {
  const groups = countParagraphGroups(text);
  if (groups < rules.min_paragraph_groups) return false;
  const folded = fold(text);
  return rules.enactment_terms.some((t) => matchesTerm(folded, t));
}

/**
 * Was ein Inhaltsgrund für den Status bedeutet. Ein Reglement oder eine Sondernutzungsvorschrift ohne
 * erkannte Artikel wird nicht verworfen, sondern geht zur manuellen Prüfung.
 */
export function contentStatus(reason: string | null | undefined, title: string, rules: ImportFilterRules, officialNumber?: string | null): "rejected" | typeof REVIEW_STATUS {
  const named = isTitlePositive(title, rules) || isSpecialPlanTitle(title, rules) || isOfficialNumberPositive(officialNumber, rules);
  return reason === "no_articles" && named ? REVIEW_STATUS : "rejected";
}

export function decideContent(text: string, rules: ImportFilterRules, title = ""): FilterRejection<ContentReason> | null {
  return assessContent(text, rules, title).rejection;
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
