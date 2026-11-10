import type { FetchImpl } from "./types";

export const DEFAULT_TIMEOUT_MS = 8000;

/** Fehler mit bereinigter, deutscher Meldung. Enthält nie Header, Token oder Rohtext der Gegenstelle. */
export class MonitorError extends Error {
  status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "MonitorError";
    this.status = status;
  }
}

export function httpErrorMessage(status: number): string {
  if (status === 401) return "HTTP 401: Token ungültig oder abgelaufen";
  if (status === 403) return "HTTP 403: Keine Berechtigung für diese Abfrage";
  if (status === 404) return "HTTP 404: Nicht gefunden (ID oder Projekt prüfen)";
  if (status === 429) return "HTTP 429: Anfragelimit erreicht";
  if (status >= 500) return `HTTP ${status}: Dienst gestört`;
  return `HTTP ${status}: Anfrage abgelehnt`;
}

/** Meldung für die Karte. Unbekannte Fehler werden nicht durchgereicht. */
export function safeMessage(e: unknown): string {
  if (e instanceof MonitorError) return e.message;
  return "Unerwarteter Fehler beim Abruf";
}

export interface FetchOpts {
  fetchImpl: FetchImpl;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface FetchedText {
  status: number;
  headers: Headers;
  text: string;
}

async function request(url: string, opts: FetchOpts): Promise<FetchedText> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let res: Response;
  try {
    res = await opts.fetchImpl(url, {
      method: "GET",
      headers: opts.headers,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new MonitorError(`Zeitüberschreitung nach ${Math.round(timeoutMs / 1000)} s`);
    }
    throw new MonitorError("Dienst nicht erreichbar");
  }
  if (!res.ok) throw new MonitorError(httpErrorMessage(res.status), res.status);
  let text: string;
  try {
    text = await res.text();
  } catch {
    throw new MonitorError("Antwort konnte nicht gelesen werden");
  }
  return { status: res.status, headers: res.headers, text };
}

export async function fetchText(url: string, opts: FetchOpts): Promise<FetchedText> {
  return request(url, opts);
}

export interface FetchedJson {
  status: number;
  headers: Headers;
  body: unknown;
}

export async function fetchJson(url: string, opts: FetchOpts): Promise<FetchedJson> {
  const r = await request(url, { ...opts, headers: { Accept: "application/json", ...opts.headers } });
  try {
    return { status: r.status, headers: r.headers, body: JSON.parse(r.text) as unknown };
  } catch {
    throw new MonitorError("Ungültige Antwort (kein JSON)");
  }
}
