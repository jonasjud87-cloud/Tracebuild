/**
 * Letzte Aktivität je Nutzer aus dem Audit-Log, für die Nutzerübersicht.
 *
 * Die Aktivität ist eine Zusatzangabe: Sie darf die Liste nie blockieren. Darum hartes Zeitbudget,
 * und bei Fehler oder Zeitüberschreitung eine leere Map statt eines Fehlers.
 *
 * Bevorzugt die RPC `admin_last_activity` (eine Zeile je Akteur, Migration 20261119000001).
 * Fehlt sie, wird das Log seitenweise gelesen, aber nur wenige Seiten.
 */

export interface DbError {
  code?: string;
  message?: string;
}

export interface QueryResult<T> {
  data: T[] | null;
  error: DbError | null;
}

export interface ActivitySource {
  /** RPC: je Akteur der jüngste Zeitpunkt. */
  rpc: (signal: AbortSignal) => PromiseLike<QueryResult<{ actor_id: string | null; last_at: string | null }>>;
  /** Rückfall: Audit-Zeilen absteigend nach Zeit, Bereich inklusive `to`. */
  scanPage: (from: number, to: number, signal: AbortSignal) => PromiseLike<QueryResult<{ actor_id: string | null; created_at: string }>>;
}

export interface ActivityOptions {
  timeoutMs: number;
  pageSize: number;
  maxPages: number;
}

export const DEFAULT_ACTIVITY_OPTIONS: ActivityOptions = { timeoutMs: 4000, pageSize: 1000, maxPages: 3 };

export type ActivitySourceKind = "rpc" | "scan" | "none";

export interface ActivityResult {
  latest: Map<string, string>;
  source: ActivitySourceKind;
  /** Fehlercode der RPC, falls sie fehlschlug (nur Code, für Logs). */
  rpcErrorCode?: string;
}

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Zeitüberschreitung nach ${ms} ms`);
    this.name = "TimeoutError";
  }
}

/** Wartet höchstens `ms`. Bricht die Arbeit selbst nicht ab, gibt aber den Aufrufer frei. */
export function withTimeout<T>(work: PromiseLike<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
  });
  return Promise.race([Promise.resolve(work), limit]).finally(() => clearTimeout(timer));
}

async function viaRpc(
  src: ActivitySource,
  signal: AbortSignal,
): Promise<{ latest: Map<string, string> } | { errorCode: string }> {
  const { data, error } = await src.rpc(signal);
  if (error) return { errorCode: error.code ?? "unbekannt" };
  const latest = new Map<string, string>();
  for (const r of data ?? []) {
    if (r.actor_id && r.last_at) latest.set(r.actor_id, r.last_at);
  }
  return { latest };
}

async function viaScan(src: ActivitySource, opts: ActivityOptions, signal: AbortSignal): Promise<Map<string, string>> {
  const latest = new Map<string, string>();
  for (let page = 0; page < opts.maxPages; page++) {
    const from = page * opts.pageSize;
    let pageResult: QueryResult<{ actor_id: string | null; created_at: string }>;
    try {
      pageResult = await src.scanPage(from, from + opts.pageSize - 1, signal);
    } catch {
      break; // wie bei error: bisherige Treffer behalten
    }
    const { data, error } = pageResult;
    if (error) break;
    const batch = data ?? [];
    for (const r of batch) {
      if (r.actor_id && !latest.has(r.actor_id)) latest.set(r.actor_id, r.created_at);
    }
    if (batch.length < opts.pageSize) break;
  }
  return latest;
}

export async function loadLastActivity(
  src: ActivitySource,
  opts: ActivityOptions = DEFAULT_ACTIVITY_OPTIONS,
): Promise<ActivityResult> {
  // Bricht laufende Abfragen nach dem Budget auch tatsächlich ab.
  const controller = new AbortController();
  let rpcErrorCode: string | undefined;
  const work = (async (): Promise<ActivityResult> => {
    const fromRpc = await viaRpc(src, controller.signal);
    if ("latest" in fromRpc) return { latest: fromRpc.latest, source: "rpc" };
    rpcErrorCode = fromRpc.errorCode;
    return { latest: await viaScan(src, opts, controller.signal), source: "scan", rpcErrorCode };
  })();
  try {
    return await withTimeout(work, opts.timeoutMs);
  } catch {
    controller.abort();
    // Verspätete Ablehnung nicht unbehandelt lassen.
    work.catch(() => undefined);
    return { latest: new Map(), source: "none", rpcErrorCode };
  }
}
