import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { startStage } from "@/lib/analysis-stages/runtime";

export const maxDuration = 300;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[0-9a-f]{64}$/i;

const reject = () => NextResponse.json({ ack: false }, { status: 409 });

/**
 * Anstoss der nächsten Etappe durch die Datenbank. Keine Sitzung: Das Einmal-Token wird als Hash mit
 * dem Job verglichen und beim Claim entwertet. Es erscheint nie in einem Log.
 * Bewusst ohne Unterscheidung der Ablehnungsgründe nach aussen.
 */
export async function POST(request: Request) {
  const startedAtMs = Date.now();
  const token = request.headers.get("x-analysis-dispatch-token") ?? "";
  const body = (await request.json().catch(() => null)) as { analysis_id?: unknown } | null;
  const analysisId = typeof body?.analysis_id === "string" ? body.analysis_id : "";
  if (!TOKEN_RE.test(token) || !UUID_RE.test(analysisId)) return reject();

  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
  try {
    const started = await startStage(createAdminClient(), analysisId, tokenHash, "dispatch", startedAtMs);
    return started ? NextResponse.json({ ack: true }, { status: 202 }) : reject();
  } catch (e) {
    console.error(`Claim von Analyse ${analysisId} fehlgeschlagen:`, e instanceof Error ? e.message : "unbekannt");
    // Vorübergehend, kein abgelehnter Anstoss: In net._http_response klar unterscheidbar.
    return NextResponse.json({ ack: false }, { status: 503 });
  }
}
