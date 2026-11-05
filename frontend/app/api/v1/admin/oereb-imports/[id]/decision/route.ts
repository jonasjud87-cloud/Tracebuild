import { getAuthUser, ok, unauthorized, forbidden, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/auditLog";
import { isUuid } from "@/lib/announcements";
import { MANUAL_DECISIONS, setDocumentDecision, type ManualDecision } from "@/lib/oereb/manual-decision";
import type { DecisionResponse } from "@/components/admin/oereb/types";

export const dynamic = "force-dynamic";

const FAILURES = {
  not_found: { status: 404, text: "Dieses Dokument gibt es nicht mehr." },
  locked: { status: 409, text: "Das Dokument wird gerade verarbeitet. Bitte gleich nochmals versuchen." },
  migration_missing: { status: 503, text: "Entscheide sind noch nicht verfügbar: Die Datenbank-Migration fehlt." },
} as const;

/** POST {decision}: force_import, exclude oder recheck. Die Logik liegt in lib/oereb/manual-decision.ts. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();
  if (!isUuid(params.id)) return err("Ungültige ID.", 400);

  const body = await request.json().catch(() => null);
  const decision = body?.decision as ManualDecision;
  if (!MANUAL_DECISIONS.includes(decision)) return err("Unbekannter Entscheid.", 400);

  const admin = createAdminClient();
  try {
    const result = await setDocumentDecision(admin, params.id, decision);
    if (!result.ok) {
      const failure = FAILURES[result.error];
      console.error(`ÖREB-Entscheid ${decision} zu ${params.id}: ${result.error}`, result.detail);
      return err(failure.text, failure.status);
    }
    await logAudit(admin, {
      orgId: null,
      actorId: user.id,
      actorEmail: user.email,
      action: "oereb_document_decision",
      targetId: params.id,
      meta: { decision, status: result.status },
    });
    return ok<DecisionResponse>({ id: params.id, decision, status: result.status, norm_id: result.normId });
  } catch (e) {
    console.error(`ÖREB-Entscheid ${decision} zu ${params.id} fehlgeschlagen:`, e);
    return err("Der Entscheid konnte nicht gespeichert werden.", 500);
  }
}
