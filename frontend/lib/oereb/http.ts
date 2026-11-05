/**
 * HTTP-Zugriff auf die kantonalen ÖREB-Dienste: Timeout, Budget, Retry, Redirects und die
 * Abbildung auf typisierte Fehler. Ein Auth-Header geht nur an den Host der Anfrage-URL und
 * erscheint nie in Meldungen oder Logs.
 */
import {
  OerebAccessRestrictedError,
  OerebBaseGoneError,
  OerebParseError,
  OerebUnreachableError,
} from "./errors";

export const OEREB_TIMEOUT_MS = 20_000;
const RETRY_DELAYS_MS = [500, 1500];
const EMPTY_RETRY_DELAY_MS = 500;
const MAX_RETRY_AFTER_S = 10;
const MAX_REDIRECTS = 5;
const RETRY_STATUS = new Set([429, 500, 502, 503]);
const RESET_CODES = new Set(["ECONNRESET", "EPIPE", "UND_ERR_SOCKET"]);
const WAF_PAGE = /request rejected|web application firewall|support id|access denied|forbidden by policy/i;

export interface OerebRequestOptions {
  /** Bezeichnung für Fehlermeldungen. */
  what: string;
  canton: string;
  /** Äusseres Gesamtbudget. */
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Anzahl Wiederholungen, Standard 2. */
  retries?: number;
  accept?: string;
  authHeader?: { name: string; value: string };
}

export type OerebHttpResult =
  | { kind: "ok"; text: string; contentType: string }
  | { kind: "empty" }
  | { kind: "format_rejected"; status: number };

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function errorCode(e: unknown): string | null {
  const cause = (e as { cause?: { code?: unknown } } | null)?.cause;
  const code = cause?.code ?? (e as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
}

function looksLikeHtml(text: string, contentType: string): boolean {
  return contentType.toLowerCase().includes("text/html") || /^\s*<(!doctype\s+html|html[\s>])/i.test(text);
}

function excerpt(body: string): string {
  return body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
}

function retryAfterSeconds(res: Response): number | null {
  const header = res.headers.get("retry-after");
  if (!header) return null;
  const value = Number(header);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** Ein Request samt Redirects (303, 307 u. a.). Auth nur, solange der Host gleich bleibt. */
async function fetchFollowing(url: string, opts: OerebRequestOptions, signal: AbortSignal): Promise<Response> {
  let current = url;
  const originHost = new URL(url).host;
  for (let hop = 0; ; hop++) {
    const headers: Record<string, string> = { Accept: opts.accept ?? "application/json" };
    if (opts.authHeader && new URL(current).host === originHost) headers[opts.authHeader.name] = opts.authHeader.value;
    const res = await fetch(current, { headers, signal, cache: "no-store", redirect: "manual" });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) return res;
    if (hop >= MAX_REDIRECTS) throw new OerebUnreachableError(`${opts.what}: zu viele Weiterleitungen`);
    await res.body?.cancel().catch(() => undefined);
    current = new URL(location, current).toString();
  }
}

/** Nach ausgeschöpften Versuchen: BS bekommt eine eigene, verständliche Meldung. */
function exhausted(opts: OerebRequestOptions, message: string, cause?: unknown): OerebUnreachableError {
  if (opts.canton === "BS") {
    return new OerebUnreachableError("ÖREB-Dienst Basel-Stadt antwortet zurzeit instabil", cause);
  }
  return new OerebUnreachableError(message, cause);
}

/**
 * Holt eine URL. 200 → Text, 204 (nach einer Wiederholung) → "empty", 406/415 → "format_rejected"
 * (der Aufrufer wechselt auf XML). Alles andere wirft einen typisierten OerebError.
 */
export async function oerebRequest(url: string, opts: OerebRequestOptions): Promise<OerebHttpResult> {
  const timeoutMs = opts.timeoutMs ?? OEREB_TIMEOUT_MS;
  const maxRetries = opts.retries ?? RETRY_DELAYS_MS.length;
  const budgetExceeded = () => new OerebUnreachableError(`${opts.what}: Zeitbudget überschritten`);
  let attempt = 0;
  let emptySeen = false;

  const pause = async (ms: number) => {
    try {
      await sleep(ms, opts.signal);
    } catch {
      throw budgetExceeded();
    }
  };

  for (;;) {
    let res: Response;
    try {
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout;
      res = await fetchFollowing(url, opts, signal);
    } catch (e) {
      if (e instanceof OerebUnreachableError) throw e;
      if (opts.signal?.aborted) throw budgetExceeded();
      if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
        throw new OerebUnreachableError(`${opts.what} nicht erreichbar: Timeout nach ${timeoutMs / 1000} s`, e);
      }
      const code = errorCode(e);
      if (code && RESET_CODES.has(code)) {
        if (attempt < maxRetries) {
          await pause(RETRY_DELAYS_MS[attempt] ?? 1500);
          attempt++;
          continue;
        }
        throw exhausted(opts, `${opts.what} nicht erreichbar: Verbindung abgebrochen (${code})`, e);
      }
      throw new OerebBaseGoneError(`${opts.what} nicht erreichbar: ${code ?? String(e)}`, e);
    }

    if (res.status === 204) {
      await res.body?.cancel().catch(() => undefined);
      if (emptySeen) return { kind: "empty" };
      emptySeen = true;
      await pause(EMPTY_RETRY_DELAY_MS);
      continue;
    }

    if (res.ok) {
      const contentType = res.headers.get("content-type") ?? "";
      const text = await res.text();
      if (looksLikeHtml(text, contentType)) {
        throw new OerebParseError(`${opts.what} liefert eine HTML-Seite statt Daten: ${excerpt(text)}`);
      }
      return { kind: "ok", text, contentType };
    }

    if (res.status === 406 || res.status === 415) {
      await res.body?.cancel().catch(() => undefined);
      return { kind: "format_rejected", status: res.status };
    }

    if (RETRY_STATUS.has(res.status) && attempt < maxRetries) {
      const delay = RETRY_DELAYS_MS[attempt] ?? 1500;
      const retryAfter = res.status === 429 ? retryAfterSeconds(res) : null;
      if (retryAfter === null || retryAfter <= MAX_RETRY_AFTER_S) {
        await res.body?.cancel().catch(() => undefined);
        await pause(retryAfter === null ? delay : Math.max(delay, retryAfter * 1000));
        attempt++;
        continue;
      }
    }

    const contentType = res.headers.get("content-type") ?? "";
    const body = await res.text().catch(() => "");
    if (res.status === 403) {
      if (opts.authHeader) throw new OerebUnreachableError(`${opts.what}: Zugang mit hinterlegten Zugangsdaten abgelehnt`);
      throw new OerebAccessRestrictedError(`ÖREB-Daten von ${opts.canton} nur für registrierte Nutzer, siehe PDF-Auszug`);
    }
    if (res.status === 404) throw new OerebBaseGoneError(`${opts.what} antwortet mit HTTP 404`);
    if (looksLikeHtml(body, contentType) && WAF_PAGE.test(body)) {
      throw new OerebParseError(`${opts.what} liefert eine Sperrseite statt Daten (HTTP ${res.status})`);
    }
    const detail = excerpt(body);
    throw exhausted(opts, `${opts.what} antwortet mit HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
  }
}
