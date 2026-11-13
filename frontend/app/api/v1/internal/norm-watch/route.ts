import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { logAudit } from "@/lib/auditLog";
import { createWatchDeps } from "@/lib/norm-watch/deps";
import { runWatch } from "@/lib/norm-watch/run";
import { ensureAllDigests } from "@/lib/norm-digest/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  if (secret.length < 32) return false;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ ok: false }, { status: 401 });
  const startedAt = Date.now();
  try {
    const deps = createWatchDeps();
    const summary = await runWatch(deps);
    await logAudit(deps.admin, {
      orgId: null,
      actorId: "00000000-0000-0000-0000-000000000000",
      actorEmail: "cron@tracebuild",
      action: "norm_watch_check",
      meta: {
        checked: summary.checked,
        skipped: summary.skipped,
        drafts: summary.draftsCreated,
        adopted: summary.adopted,
        errors: summary.errors,
        manual: false,
        sources: summary.outcomes.map((o) => `${o.label}: ${o.result}`),
      },
    });
    let digests = { created: 0, failed: 0, skipped: 0, costUsd: 0 };
    try {
      digests = await ensureAllDigests(deps.admin, { deadlineAt: Math.min(startedAt + 280_000, Date.now() + 200_000) });
    } catch (e) {
      console.error("Prüfauszüge im Cron:", e instanceof Error ? e.message : "unbekannt");
    }
    return NextResponse.json({
      ok: true,
      digests,
      checked: summary.checked,
      draftsCreated: summary.draftsCreated,
      skipped: summary.skipped,
      adopted: summary.adopted,
      errors: summary.errors,
    });
  } catch (e) {
    console.error("norm-watch cron", e instanceof Error ? e.message : "unbekannt");
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
