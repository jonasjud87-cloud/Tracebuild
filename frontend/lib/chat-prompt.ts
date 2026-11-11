/** Länderabhängige Teile des Chat-Prompts. Rein, damit ohne Modell testbar. */
import { cantonLabel, countryForCanton } from "./oereb/cantons";

/** «Kanton ZH», «Fürstentum Liechtenstein» oder «Kanton unbekannt». */
export function chatPlace(canton: string | null | undefined): string {
  return cantonLabel(canton) || "Kanton unbekannt";
}

/** Was der Assistent allgemein beantworten darf: Für FL nie Schweizer oder kantonales Recht. */
export function chatLawScope(canton: string | null | undefined): string {
  return countryForCanton(canton) === "LI"
    ? "Allgemeine Fragen zum Baurecht Liechtensteins (Baugesetz, Bauverordnung, Bauordnungen der Gemeinden) und zu SIA-Normen beantworten"
    : "Allgemeine Fragen zu Schweizer Baurecht, SIA-Normen und kantonalen Baugesetzen beantworten";
}
