/**
 * Zugriff auf api3.geo.admin.ch (Fair Use): Timeout 8 s, höchstens eine Wiederholung,
 * Token-Bucket mit 20 Requests pro Minute je Lambda. Aufrufer behandeln GeoAdminError als
 * «unavailable».
 */

export const GEO_ADMIN_BASE = "https://api3.geo.admin.ch/rest/services";
const TIMEOUT_MS = 8_000;
const RETRY_DELAY_MS = 500;
const BUCKET_CAPACITY = 20;
const BUCKET_REFILL_PER_MS = BUCKET_CAPACITY / 60_000;
const RETRY_STATUS = new Set([429, 500, 502, 503]);

export class GeoAdminError extends Error {
  readonly rateLimited: boolean;
  constructor(message: string, rateLimited = false) {
    super(message);
    this.name = "GeoAdminError";
    this.rateLimited = rateLimited;
  }
}

let tokens = BUCKET_CAPACITY;
let lastRefill = Date.now();

function takeToken(): boolean {
  const now = Date.now();
  tokens = Math.min(BUCKET_CAPACITY, tokens + (now - lastRefill) * BUCKET_REFILL_PER_MS);
  lastRefill = now;
  if (tokens < 1) return false;
  tokens -= 1;
  return true;
}

/** Nur für Tests: Bucket wieder füllen. */
export function resetGeoAdminBucket(): void {
  tokens = BUCKET_CAPACITY;
  lastRefill = Date.now();
}

async function once(url: string, signal: AbortSignal | undefined, timeoutMs: number): Promise<Response> {
  if (!takeToken()) throw new GeoAdminError("Anfragelimit für geo.admin.ch erreicht", true);
  const timeout = AbortSignal.timeout(timeoutMs);
  return fetch(url, {
    headers: { Accept: "application/json" },
    signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
    cache: "no-store",
  });
}

/** GET {GEO_ADMIN_BASE}/{path}. Wirft GeoAdminError. */
export async function geoAdminGet(
  path: string,
  params: Record<string, string>,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<unknown> {
  const url = `${GEO_ADMIN_BASE}/${path}?${new URLSearchParams(params).toString()}`;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await once(url, opts.signal, opts.timeoutMs ?? TIMEOUT_MS);
    } catch (e) {
      if (e instanceof GeoAdminError) throw e;
      const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      if (!timedOut && attempt === 0) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      throw new GeoAdminError(timedOut ? "geo.admin.ch: Timeout" : `geo.admin.ch nicht erreichbar: ${String(e)}`);
    }
    if (res.ok) {
      try {
        return await res.json();
      } catch {
        throw new GeoAdminError("geo.admin.ch liefert kein gültiges JSON");
      }
    }
    await res.body?.cancel().catch(() => undefined);
    if (RETRY_STATUS.has(res.status) && attempt === 0) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      continue;
    }
    throw new GeoAdminError(`geo.admin.ch antwortet mit HTTP ${res.status}`);
  }
}
