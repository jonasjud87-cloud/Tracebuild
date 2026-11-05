/**
 * Inhaltlicher Schlüssel eines Dokumenttitels: Titel klein, ohne Akzente, Gemeindename, Daten,
 * «Stand …», Versionskürzel, Dateiendung und Satzzeichen. Rein. Grenze: Abweichende Titel
 * («Baureglement» und «Reglement über das Bauen») werden damit nicht als gleich erkannt.
 */

const MONTHS =
  "januar|februar|maerz|marz|april|mai|juni|juli|august|september|oktober|november|dezember|" +
  "janvier|fevrier|mars|avril|juin|juillet|aout|septembre|octobre|novembre|decembre|" +
  "gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|dicembre";

function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’`´]/g, "'");
}

function clean(s: string): string {
  return s.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export function titleKey(title: string, municipality?: string | null): string {
  const base = fold(title)
    .replace(/\.(pdf|docx?|odt)\s*$/, "")
    .replace(/_/g, " ")
    .replace(new RegExp(`\\b\\d{1,2}\\.?\\s*(?:${MONTHS})\\s*\\d{2,4}\\b`, "g"), " ")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b\d{1,2}\s*[./]\s*\d{1,2}\s*[./]\s*\d{2,4}\b/g, " ")
    .replace(/\bstand\b(\s+vom)?/g, " ")
    .replace(/\bv\d+\b/g, " ")
    .replace(/\b(19|20)\d{2}\b/g, " ");

  const name = clean(fold(municipality ?? "").replace(/\(.*?\)/g, " "));
  const full = clean(base);
  if (!name) return full;
  const stripped = clean(` ${full} `.split(` ${name} `).join(" "));
  // AR führt das Baureglement unter dem Titel «Herisau»: Der Schlüssel darf nicht leer werden,
  // sonst wären alle solchen Dokumente einer Gemeinde «gleich».
  return stripped || full;
}
