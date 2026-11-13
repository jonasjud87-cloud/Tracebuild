export type Category = "grenzabstand" | "gebaeudehöhe" | "erschliessung" | "brandschutz" | "parkierung" | "andere";
export type Confidence = "high" | "medium" | "low";

export interface AnalysisItem {
  id: string;
  norm_id: string | null;
  norm_title: string | null;
  category: Category | null;
  status: "ok" | "fail" | "warn";
  note: string;           // stores the 'finding' text from Claude
  suggestion: string | null;
  confidence: Confidence | null;
  page_reference: number | null;
  /** Datei im Plansatz, auf die sich page_reference bezieht. */
  source_file?: string | null;
  /** Nur bei Änderungsprüfungen: Entwicklung gegenüber der Vorversion. */
  change_status?: string | null;
}

export const CATEGORY_LABELS: Record<Category, string> = {
  grenzabstand:  "Grenzabstand",
  gebaeudehöhe:  "Gebäudehöhe",
  erschliessung: "Erschliessung",
  brandschutz:   "Brandschutz",
  parkierung:    "Parkierung",
  andere:        "Andere",
};

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  high:   "Hoch",
  medium: "Mittel",
  low:    "Gering",
};

export const CONFIDENCE_STYLE: Record<Confidence, string> = {
  high:   "bg-stone-100 text-stone-600",
  medium: "bg-amber-50 text-amber-600",
  low:    "bg-red-50 text-red-500",
};
