/** Fehlerresultate höchstens so lange cachen. */
export const ERROR_TTL_MS = 30_000;
/** `?fresh=1` umgeht den Cache höchstens alle 30 s je Schlüssel. */
export const FRESH_MIN_INTERVAL_MS = 30_000;

export interface CacheHit<T> {
  value: T;
  cached: boolean;
}

export interface GetOpts<T> {
  fresh?: boolean;
  isError?: (value: T) => boolean;
}

export interface TtlCache {
  get<T>(key: string, ttlMs: number, loader: () => Promise<T>, opts?: GetOpts<T>): Promise<CacheHit<T>>;
  clear(): void;
}

interface Entry {
  value: unknown;
  expires: number;
}

/** In-Memory-Cache je Server-Instanz mit Dedupe gleichzeitiger Abrufe. Wirft der Loader, wird nichts gespeichert. */
export function createTtlCache(now: () => number = Date.now): TtlCache {
  const entries = new Map<string, Entry>();
  const inflight = new Map<string, Promise<unknown>>();
  const lastFresh = new Map<string, number>();

  return {
    async get<T>(key: string, ttlMs: number, loader: () => Promise<T>, opts: GetOpts<T> = {}): Promise<CacheHit<T>> {
      const t = now();
      let bypass = false;
      if (opts.fresh) {
        const last = lastFresh.get(key);
        if (last === undefined || t - last >= FRESH_MIN_INTERVAL_MS) {
          bypass = true;
          lastFresh.set(key, t);
        }
      }

      const hit = entries.get(key);
      if (!bypass && hit && hit.expires > t) return { value: hit.value as T, cached: true };

      const running = inflight.get(key);
      if (running) return { value: (await running) as T, cached: false };

      const p = (async () => {
        try {
          const value = await loader();
          const ttl = opts.isError?.(value) ? Math.min(ttlMs, ERROR_TTL_MS) : ttlMs;
          entries.set(key, { value, expires: now() + ttl });
          return value;
        } finally {
          inflight.delete(key);
        }
      })();
      inflight.set(key, p);
      return { value: await p, cached: false };
    },
    clear() {
      entries.clear();
      inflight.clear();
      lastFresh.clear();
    },
  };
}
