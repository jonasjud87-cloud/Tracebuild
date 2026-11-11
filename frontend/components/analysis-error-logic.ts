/**
 * Fehlgeschlagene Analyse für Nutzer: technische Gründe auf feste Texte abbilden. Rein, ohne `@/`-Importe.
 * Der gespeicherte Grund wird nie durchgereicht, er kann Interna enthalten (Modellantworten, Pfade, Codes).
 */

export const UNKNOWN_FAILURE = "Unbekannter Fehler.";

/** retry: false, wenn ein neuer Versuch nur erneut kostet oder sicher wieder scheitert. */
const RULES: { test: RegExp; text: string; retry?: false }[] = [
  {
    test: /Zeitüberschreitung|Zeitbudget|timed? ?out|timeout/i,
    text: "Zeitüberschreitung: Die Analyse hat zu lange gedauert und wurde beendet.",
  },
  {
    test: /Kostengrenze|spend.?limit|credit|billing|Anthropic-Konto|specified API usage/i,
    text: "Die Kostengrenze für Analysen ist erreicht.",
    retry: false,
  },
  {
    test: /überlastet|overload|rate.?limit|\b429\b|\b529\b/i,
    text: "Der KI-Dienst ist zurzeit überlastet. Bitte versuchen Sie es in einigen Minuten erneut.",
  },
  {
    test: /fetch failed|network|ECONN|socket|connection|terminated/i,
    text: "Die Verbindung zum KI-Dienst wurde unterbrochen.",
  },
  {
    test: /Normen des Projekts konnten nicht geladen/i,
    text: "Die Normen des Projekts konnten nicht geladen werden.",
  },
  {
    test: /Dateien konnten nicht freigegeben|nicht vollständig hochgeladen|Datei|download|retriev|could not (access|load)|unable to (access|load)/i,
    text: "Die Pläne konnten nicht gelesen werden. Prüfen Sie die Dateien oder laden Sie sie neu hoch.",
  },
  {
    test: /abgelehnt|refus/i,
    text: "Der KI-Dienst hat die Prüfung dieser Pläne abgelehnt.",
    retry: false,
  },
  {
    test: /Rückrollung|neueren Programmversion/i,
    text: "Die Analyse wurde wegen einer Systemaktualisierung beendet.",
  },
  {
    test: /brach wiederholt ab|kam nicht weiter|nicht vorbereitet/i,
    text: "Die Analyse ist wiederholt abgebrochen.",
  },
  {
    test: /Keine Prüfpunkte|Leere Antwort|ohne Ergebnis/i,
    text: "Die Analyse hat keine Prüfpunkte ergeben.",
  },
];

export interface AnalysisFailure {
  text: string;
  /** false: Kein «Erneut versuchen» anbieten (Kostengrenze, Konto gesperrt, Prüfung abgelehnt). */
  retryable: boolean;
}

/** Nutzertext und Wiederholbarkeit zum gespeicherten Grund. `timedOut` stammt aus result_json.timed_out. */
export function analysisFailure(raw: unknown, timedOut = false): AnalysisFailure {
  if (timedOut) return { text: RULES[0].text, retryable: true };
  const reason = typeof raw === "string" ? raw.trim() : "";
  const rule = reason ? RULES.find((r) => r.test.test(reason)) : undefined;
  return { text: rule?.text ?? UNKNOWN_FAILURE, retryable: rule?.retry !== false };
}

/** Nur der Nutzertext. */
export function analysisFailureText(raw: string | null | undefined, timedOut = false): string {
  return analysisFailure(raw, timedOut).text;
}

/** Hinweis statt Knopf, wenn ein neuer Versuch nichts bringt. */
export const NOT_RETRYABLE_HINT = "Ein neuer Versuch ist hier nicht sinnvoll. Bitte wenden Sie sich an den Support.";

/** Kurze Referenz für den Support: die ersten acht Zeichen der Analyse-ID. */
export function failureReference(analysisId: string): string {
  return analysisId.replace(/[^0-9a-f]/gi, "").slice(0, 8).toUpperCase();
}
