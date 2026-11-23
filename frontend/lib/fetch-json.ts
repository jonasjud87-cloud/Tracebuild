/**
 * JSON-Abruf für Admin-Seiten mit Zeitlimit. Wirft nie: Netzwerkfehler, Zeitüberschreitung,
 * HTTP-Fehler und kaputtes JSON enden als `{ ok: false, error }`, damit kein Ladezustand hängen bleibt.
 */

export type FetchJsonResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; status: number | null };

export interface FetchJsonOptions {
  timeoutMs?: number;
  init?: RequestInit;
  fetchFn?: typeof fetch;
  /** Text, wenn die Antwort keine eigene Fehlermeldung enthält. */
  fallbackError?: string;
}

export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

export async function fetchJson<T>(url: string, opts: FetchJsonOptions = {}): Promise<FetchJsonResult<T>> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const fetchFn = opts.fetchFn ?? fetch;
  const fallback = opts.fallbackError ?? "Daten konnten nicht geladen werden.";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { ...opts.init, signal: controller.signal });
    const json = (await res.json().catch(() => null)) as { data?: T | null; error?: string | null } | null;
    if (!res.ok || !json || json.error || json.data === undefined || json.data === null) {
      return { ok: false, error: json?.error || fallback, status: res.status };
    }
    return { ok: true, data: json.data, status: res.status };
  } catch {
    if (controller.signal.aborted) {
      return { ok: false, error: `${fallback} Zeitüberschreitung, bitte erneut versuchen.`, status: null };
    }
    return { ok: false, error: `${fallback} Netzwerkfehler.`, status: null };
  } finally {
    clearTimeout(timer);
  }
}
