interface LevelNorm {
  layer?: number | null;
  jurisdiction_type?: string | null;
  priority?: string | null;
}

export function isCompanyNorm(norm: LevelNorm): boolean {
  return norm.jurisdiction_type === "org";
}

export function normLevelLabel(norm: LevelNorm): string {
  if (isCompanyNorm(norm)) {
    if (norm.priority === "binding") return "Unternehmensnorm (intern verbindlich)";
    return norm.priority === "advisory" ? "Unternehmensnorm (interne Empfehlung)" : "Unternehmensnorm";
  }
  return norm.layer === 4 ? "Gemeinde" : norm.layer === 3 ? "Kanton" : norm.layer === 1 ? "Bund" : "Spezialnorm";
}

export function companyNormInstruction(norm: LevelNorm): string {
  if (!isCompanyNorm(norm)) return "";
  const base =
    "Dies ist eine interne Vorgabe des Unternehmens, kein Gesetz. Gesetzliche Normen (Bund, Kanton, Gemeinde) gehen immer vor: " +
    "Eine Unternehmensnorm darf sie verschärfen, aber nie lockern. Prüfe ausschliesslich gegen den Text dieser Norm.\n";
  if (norm.priority === "binding") {
    return base + "Die Vorgabe ist intern verbindlich: Eine nachweisbare Abweichung des Plans meldest du als Mangel (fail), eine unklare Lage als Warnung (warn).\n";
  }
  if (norm.priority === "advisory") {
    return base + "Die Vorgabe ist nur eine Empfehlung: Melde Abweichungen höchstens als Warnung (warn), nie als Mangel (fail).\n";
  }
  return base;
}

export function clampCompanyStatus<S extends string>(norm: LevelNorm, status: S): S | "warn" {
  return isCompanyNorm(norm) && norm.priority === "advisory" && status === "fail" ? "warn" : status;
}
