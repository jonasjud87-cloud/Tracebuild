import { waitUntil } from "@vercel/functions";
import { NextResponse } from "next/server";
import { parseSpikeRequest, spikeAuthorized, spikeHopUrl } from "@/lib/analysis-stages/spike";

export const maxDuration = 300;

/**
 * Temporärer Spike, standardmässig aus (404 ohne ANALYSIS_SPIKE_SECRET). Antwortet sofort mit 202, arbeitet
 * in waitUntil und schreibt das Ergebnis ins Vercel-Log. Misst nur den Selbstaufruf, nicht pg_net.
 * Nach dem Spike entfernen: Route, Secret, lib/analysis-stages/spike.ts, Skript, Middleware-Ausnahme.
 */
export async function POST(request: Request) {
  const provided = request.headers.get("x-analysis-spike-secret");
  if (!spikeAuthorized(provided)) return new NextResponse(null, { status: 404 });

  const { workMs, hops } = parseSpikeRequest(await request.json().catch(() => null));
  const startedAt = Date.now();
  const id = crypto.randomUUID();
  const log = (event: string, extra: Record<string, unknown> = {}) =>
    console.log(JSON.stringify({ event: `analysis-spike.${event}`, id, hops, elapsed_ms: Date.now() - startedAt, ...extra }));

  log("start", { work_ms: workMs });
  waitUntil((async () => {
    await new Promise((resolve) => setTimeout(resolve, workMs));
    log("done");
    if (hops > 0) {
      try {
        const res = await fetch(spikeHopUrl(), {
          method: "POST",
          redirect: "manual",
          headers: { "content-type": "application/json", "x-analysis-spike-secret": provided ?? "" },
          body: JSON.stringify({ work_ms: workMs, hops: hops - 1 }),
        });
        log("hop", { status: res.status });
      } catch (e) {
        log("hop", { status: null, error: e instanceof Error ? e.message : "unbekannt" });
      }
    }
  })());

  return NextResponse.json({ accepted: true, id }, { status: 202 });
}
