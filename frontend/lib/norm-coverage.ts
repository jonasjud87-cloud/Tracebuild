export interface CoverageNorm {
  jurisdiction_type?: string | null;
  jurisdiction_name?: string | null;
  auto_scope?: string | null;
  approval_status?: string | null;
  archived_at?: string | null;
}

export interface CoverageProject {
  canton?: string | null;
  municipality?: string | null;
}

export interface CoverageGap {
  key: "no-canton" | "canton-missing" | "municipality-missing";
  text: string;
}

const CITY_CANTONS = new Set(["BS", "GE"]);

function isActive(n: CoverageNorm): boolean {
  return n.auto_scope !== "superseded" && n.approval_status !== "draft" && !n.archived_at;
}

function has(norms: CoverageNorm[], type: string): boolean {
  return norms.some((n) => isActive(n) && n.jurisdiction_type === type);
}

export function coverageGaps(project: CoverageProject, norms: CoverageNorm[]): CoverageGap[] {
  const canton = (project.canton ?? "").trim().toUpperCase();
  const municipality = (project.municipality ?? "").trim();
  const liechtenstein = canton === "FL";
  const gaps: CoverageGap[] = [];

  if (!canton) {
    gaps.push({
      key: "no-canton",
      text: "Beim Projekt ist kein Kanton eingetragen. Kantonale Normen werden darum nicht geprüft.",
    });
  } else if (liechtenstein) {
    if (!has(norms, "national") && !has(norms, "cantonal")) {
      gaps.push({
        key: "canton-missing",
        text: "Für Liechtenstein ist keine Norm hinterlegt. Die Prüfung läuft nur gegen das, was für die Gemeinde vorliegt.",
      });
    }
  } else if (!has(norms, "cantonal")) {
    gaps.push({
      key: "canton-missing",
      text: `Für den Kanton ${canton} ist keine kantonale Norm hinterlegt. Die Prüfung läuft nur gegen Bundesrecht und gegen das, was für die Gemeinde vorliegt.`,
    });
  }

  if (canton && municipality && !CITY_CANTONS.has(canton) && !has(norms, "municipal")) {
    const document = liechtenstein ? "Bauordnung" : "Baureglement";
    gaps.push({
      key: "municipality-missing",
      text: `Für die Gemeinde ${municipality} liegt keine ${document} vor. Gemeindliche Vorschriften werden nicht geprüft.`,
    });
  }
  return gaps;
}
