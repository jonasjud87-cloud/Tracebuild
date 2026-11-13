import { NextRequest } from "next/server";
import { getAuthUser, ok, err, unauthorized, forbidden } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/auditLog";
import { isMissingSchema } from "@/lib/supabase/schema-errors";
import { UUID_RE } from "@/lib/norm-watch/deps";
import { isValidSr } from "@/lib/norm-watch/fedlex";
import { isValidSgs } from "@/lib/norm-watch/sg";
import { loadNormWatchOverview } from "@/lib/norm-watch/overview";

export const dynamic = "force-dynamic";

const MAX_SOURCES = 50;

export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();

  try {
    return ok(await loadNormWatchOverview(createAdminClient()));
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    if (isMissingSchema(message)) return err("Der Normabgleich ist noch nicht eingerichtet (Migration 20261113000001 fehlt).", 503);
    console.error("norm-watch", message);
    return err("Normabgleich konnte nicht geladen werden.", 500);
  }
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return err("Ungültiger JSON-Body.", 400);
    body = parsed as Record<string, unknown>;
  } catch {
    return err("Ungültiger JSON-Body.", 400);
  }

  const label = typeof body.label === "string" ? body.label.trim() : "";
  const provider = body.provider;
  const identifier = typeof body.identifier === "string" ? body.identifier.trim() : "";
  const normId = typeof body.normId === "string" && body.normId ? body.normId : null;
  const category = typeof body.category === "string" && body.category.trim() ? body.category.trim().slice(0, 60) : "andere";

  if (label.length < 1 || label.length > 200) return err("Bezeichnung fehlt oder ist zu lang.");
  if (provider !== "fedlex" && provider !== "sg") return err("Quelle muss «fedlex» oder «sg» sein.");
  if (provider === "fedlex" ? !isValidSr(identifier) : !isValidSgs(identifier)) {
    return err(provider === "fedlex" ? "Ungültige SR-Nummer (z. B. 814.01)." : "Ungültige sGS-Nummer (z. B. 731.1).");
  }
  if (normId && !UUID_RE.test(normId)) return err("Ungültige Norm-ID.");

  const admin = createAdminClient();
  const { count } = await admin.from("norm_sources").select("id", { count: "exact", head: true });
  if ((count ?? 0) >= MAX_SOURCES) return err(`Es werden höchstens ${MAX_SOURCES} Quellen beobachtet.`, 400);
  if (normId) {
    const { data: norm } = await admin.from("norms").select("id").eq("id", normId).is("org_id", null).maybeSingle();
    if (!norm) return err("Die gewählte Norm ist keine plattformweite Norm.", 404);
  }

  const { data, error } = await admin
    .from("norm_sources")
    .insert({
      label,
      provider,
      identifier,
      norm_id: normId,
      jurisdiction_type: provider === "fedlex" ? "national" : "cantonal",
      jurisdiction_name: provider === "sg" ? "SG" : null,
      category,
    })
    .select("id")
    .single();
  if (error || !data) {
    if (error?.code === "23505") return err("Diese Quelle wird bereits beobachtet.", 409);
    console.error("norm-watch create", error?.code);
    return err("Quelle konnte nicht gespeichert werden.", 500);
  }

  await logAudit(admin, {
    orgId: null,
    actorId: user.id,
    actorEmail: user.email,
    action: "norm_source_create",
    targetId: (data as { id: string }).id,
    meta: { label, provider, identifier },
  });
  return ok({ id: (data as { id: string }).id }, 201);
}
