export type DeltaChange = "unchanged" | "resolved" | "improved" | "worse" | "updated" | "not_checkable" | "new";

export const DELTA_CHANGE_LABEL: Record<DeltaChange, string> = {
  unchanged: "Unverändert",
  resolved: "Behoben",
  improved: "Verbessert",
  worse: "Verschlechtert",
  updated: "Angepasst",
  not_checkable: "Nicht mehr prüfbar",
  new: "Neu",
};
