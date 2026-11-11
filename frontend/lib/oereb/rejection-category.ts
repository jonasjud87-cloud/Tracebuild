/**
 * Einteilung nicht importierter ÖREB-Dokumente: bewusst ausgelassen oder zu prüfen.
 * Rein und client-sicher. Gründe als Literale, damit der Client import-filter.ts nicht lädt;
 * sie entsprechen PreDownloadReason, ContentReason, den Abrufgründen und OLDER_VERSION_REASON/MANUAL_EXCLUDE_REASON.
 */

/** `skipped`: bewusst ausgelassen, neutral. `check`: zu prüfen, Warnfarbe. */
export type DocumentGroup = "imported" | "skipped" | "check" | "open";

export type DocumentCategory =
  | "imported"
  | "open"
  | "superior_law"
  | "canton_stopped"
  | "plan"
  | "decision_report"
  | "older_version"
  | "manual_duplicate"
  | "manual_exclude"
  | "removed"
  | "filter_rule"
  | "check";

export interface CategoryInfo {
  group: DocumentGroup;
  label: string;
  /** Kurze Erklärung für die Anzeige. */
  hint: string;
}

export const CATEGORY_INFO: Record<DocumentCategory, CategoryInfo> = {
  imported: { group: "imported", label: "Importiert", hint: "Gilt in den Analysen." },
  open: { group: "open", label: "Offen", hint: "Noch nicht geprüft." },
  superior_law: { group: "skipped", label: "Übergeordnetes Recht", hint: "Gesetz oder Bundesrecht, wird einmalig als globale Norm gepflegt." },
  canton_stopped: { group: "skipped", label: "Kanton nicht freigegeben", hint: "Die Filterregeln des Kantons lassen keine Dokumentart zu." },
  plan: { group: "skipped", label: "Plan, kein Normtext", hint: "Zonenplan, Karte oder Kataster ohne Vorschriften." },
  decision_report: { group: "skipped", label: "Entscheid oder Bericht", hint: "Genehmigung, Entscheid oder Bericht statt Erlass." },
  older_version: { group: "skipped", label: "Ältere Fassung", hint: "Eine neuere Fassung ist übernommen." },
  manual_duplicate: { group: "skipped", label: "Doppel einer manuellen Norm", hint: "Die von Hand gepflegte Norm bleibt massgebend." },
  manual_exclude: { group: "skipped", label: "Manuell ausgeschlossen", hint: "Von einem Admin ausgeschlossen." },
  removed: { group: "skipped", label: "Entfernt", hint: "Norm gelöscht oder nicht mehr im Auszug." },
  filter_rule: { group: "skipped", label: "Übrige Filterregeln", hint: "Andere Dokumentart, ausgeschlossener Titel, nicht rechtskräftig oder gleicher Text." },
  check: { group: "check", label: "Zu prüfen", hint: "Ablehnung oder Fehler, die ein Mensch ansehen sollte." },
};

/** Reihenfolge für Zählungen und Gruppen. */
export const CATEGORY_ORDER: readonly DocumentCategory[] = [
  "check", "open", "imported",
  "superior_law", "canton_stopped", "plan", "decision_report", "older_version", "manual_duplicate", "manual_exclude", "removed", "filter_rule",
];

export interface CategorizableDocument {
  status: string;
  reject_reason: string | null;
  doc_type: string | null;
  reject_detail?: string | null;
  manual_decision?: string | null;
}

/** Freigabe des Kantons: `null`, wenn unbekannt (projektbezogene Anzeige). */
export interface CategoryContext {
  cantonReleased: boolean | null;
}

// Begriffe aus title_negative, die auf Pläne zeigen (Zonenplan, Karte, Kataster …).
const PLAN_TERM = /plan|piano|karte|carte|kataster|^=?paz$/;
const DECISION_TERM = /genehmigung|approbation|decision|décision|entscheid|rrb|bericht|rapport/;

/** Begriff aus «Titel enthält «…»». Ohne Angabe leer. */
function negativeTerm(detail: string | null | undefined): string {
  const m = /«([^»]*)»/.exec(detail ?? "");
  return (m?.[1] ?? "").toLowerCase();
}

function docTypeCategory(docType: string | null, ctx: CategoryContext): DocumentCategory {
  // Gesetze fehlen auch im freigegebenen Kanton: übergeordnetes Recht, kein Fehler.
  if (docType === "Law") return "superior_law";
  if (ctx.cantonReleased === false) return "canton_stopped";
  // Reglemente (LegalProvision) importiert jeder freigegebene Kanton. Ohne Angabe zur Freigabe
  // ist die Ablehnung darum der Stopp; im freigegebenen Kanton ist sie unerwartet.
  if (docType === "LegalProvision") return ctx.cantonReleased === null ? "canton_stopped" : "check";
  // Hinweise (Hint) sind bewusst ausgefiltert; jede andere Art ist unerwartet.
  if (docType === "Hint") return "filter_rule";
  return "check";
}

/** Kategorie eines Dokuments. Unbekannte Status und Gründe gelten als zu prüfen. */
export function categorizeDocument(doc: CategorizableDocument, ctx: CategoryContext = { cantonReleased: null }): DocumentCategory {
  switch (doc.status) {
    case "imported": return "imported";
    case "pending": return "open";
    case "duplicate_manual": return "manual_duplicate";
    case "removed": return "removed";
    case "rejected": break;
    default: return "check"; // failed, review, Unbekanntes
  }
  if (doc.manual_decision === "exclude") return "manual_exclude";
  switch (doc.reject_reason) {
    case "manual_exclude": return "manual_exclude";
    case "doc_type": return docTypeCategory(doc.doc_type, ctx);
    case "authority": return "superior_law";
    case "title_negative": {
      const term = negativeTerm(doc.reject_detail);
      if (PLAN_TERM.test(term)) return "plan";
      if (DECISION_TERM.test(term)) return "decision_report";
      return "filter_rule";
    }
    case "older_version":
    case "superseded":
      return "older_version";
    case "title_exact":
    case "not_in_force":
    case "duplicate_content":
      return "filter_rule";
    default:
      // scan_or_short, no_articles, too_large, not_pdf, host_not_allowed, private_address, pdf_unreadable,
      // decision_document, cap_reached, kept_old, too_long, foreign_place und alles Unbekannte.
      return "check";
  }
}

export function categoryGroup(category: DocumentCategory): DocumentGroup {
  return CATEGORY_INFO[category].group;
}

export interface CategoryCount {
  category: DocumentCategory;
  label: string;
  group: DocumentGroup;
  count: number;
}

/** Zählung je Kategorie in fester Reihenfolge, nur vorkommende. */
export function countCategories(docs: readonly CategorizableDocument[], ctx: CategoryContext = { cantonReleased: null }): CategoryCount[] {
  const counts = new Map<DocumentCategory, number>();
  for (const doc of docs) {
    const c = categorizeDocument(doc, ctx);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return CATEGORY_ORDER.filter((c) => counts.has(c)).map((c) => ({
    category: c, label: CATEGORY_INFO[c].label, group: CATEGORY_INFO[c].group, count: counts.get(c) ?? 0,
  }));
}
