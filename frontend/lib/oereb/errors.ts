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
