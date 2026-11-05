/**
 * Ziel des Anstosses aus der Datenbank. Rein.
 * Nicht getSiteOrigin und nicht der Host-Header: Preview würde sonst Produktion aufrufen, und das
 * Token ginge an einen von aussen beeinflussbaren Host. *.vercel.app ist geschützt, deshalb fest www.
 */
type Env = Record<string, string | undefined>;

export const STAGE_ROUTE = "/api/v1/internal/analysis-stage";

export function dispatchUrl(env: Env = process.env): string | null {
  if (env.VERCEL_ENV !== "production") return null;
  const origin = (env.ANALYSIS_DISPATCH_ORIGIN ?? "https://www.tracebuild.ch").replace(/\/+$/, "");
  return `${origin}${STAGE_ROUTE}`;
}

/**
 * Welcher Auslöser gilt. Standard pg_net. `browser` ist der vorbereitete Zweig, falls der Spike
 * scheitert (508) oder die Erweiterungen abgelehnt werden: keine dispatch_url, der Browser trägt die
 * Kette, und die Oberfläche sagt ehrlich background=false. Vercel Queues ist nicht eingebaut; ein
 * solcher Auslöser würde nur den Dispatcher ersetzen (siehe ports.ts).
 */
export type DispatcherKind = "pgnet" | "browser";

export function dispatcherKind(env: Env = process.env): DispatcherKind {
  return env.ANALYSIS_STAGE_DISPATCHER === "browser" ? "browser" : "pgnet";
}
