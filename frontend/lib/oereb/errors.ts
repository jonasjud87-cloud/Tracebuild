import type { ExtractStatus } from "./types";

/**
 * Typisierte Fehler der ÖREB-Adapter. Jeder Fehler trägt den ExtractStatus, unter dem
 * er in oereb_extracts landet — fetch.ts muss nichts raten. Es gibt bewusst keine
 * stillen Fallbacks: entweder ein Adapter liefert Daten, oder er wirft einen dieser Fehler.
 */
export abstract class OerebError extends Error {
  abstract readonly status: Exclude<ExtractStatus, "ok">;
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = new.target.name;
    this.cause = cause;
  }
}

/** Dienst nicht erreichbar, HTTP-Fehler, Timeout oder fehlende Konfiguration. */
export class OerebUnreachableError extends OerebError {
  readonly status = "unreachable" as const;
}

/**
 * Die Basis-URL antwortet mit 404 oder gar nicht (Verbindungsfehler). Nur in diesem Fall
 * darf eine Basis aus KNOWN_BASES über den swisstopo-Layer ersetzt werden.
 */
export class OerebBaseGoneError extends OerebUnreachableError {}

/** Kein Grundstück zu Gemeinde/Parzellennummer gefunden. */
export class OerebNoEgridError extends OerebError {
  readonly status = "no_egrid" as const;
}

/** Mehrere Grundstücke passen — der Nutzer muss wählen. `candidates` sind EGRIDs. */
export class OerebAmbiguousError extends OerebError {
  readonly status = "ambiguous" as const;
  readonly candidates: string[];
  constructor(message: string, candidates: string[]) {
    super(message);
    this.candidates = candidates;
  }
}

/** Antwort ist kein gültiges/erwartetes GetExtractByIdResponse-Dokument. */
export class OerebParseError extends OerebError {
  readonly status = "parse_error" as const;
}

/** Für den Kanton ist kein ÖREB-Dienst auffindbar. */
export class OerebNoCadastreError extends OerebError {
  readonly status = "no_cadastre" as const;
}

/** Der Dienst verweigert den Zugriff ohne Zugangsdaten (HTTP 403), z. B. NE. */
export class OerebAccessRestrictedError extends OerebError {
  readonly status = "access_restricted" as const;
}
