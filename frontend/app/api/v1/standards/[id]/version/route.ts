import { getAuthUser, ok, unauthorized, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/auditLog";
import { loadCompanyNorm } from "@/lib/company-norm-store";
import { readNormUpload, storeNormPdf } from "@/lib/norm-upload-file";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    return await createVersion(request, params.id);
  } catch (e) {
    console.error("Neue Version fehlgeschlagen:", e);
    return err(e instanceof Error ? `${e.name}: ${e.message}` : "Unbekannter Serverfehler", 500);
  }
}

async function createVersion(request: Request, id: string) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) return err("Keine Datei hochgeladen");

  const admin = createAdminClient();
  const { norm, error } = await loadCompanyNorm(admin, user.org_id, id);
  if (error) return err(error, 500);
  if (!norm) return err("Unternehmensnorm nicht gefunden", 404);
  if (norm.archived_at) return err("Auf eine frühere Version lässt sich keine neue Version aufsetzen", 409);
  if (norm.approval_status !== "approved") return err("Nur eine freigegebene Norm bekommt eine neue Version. Ersetzen Sie sonst den Entwurf.", 409);

  const { data: open } = await admin
    .from("norms")
    .select("id")
    .eq("supersedes_norm_id", norm.id)
    .eq("approval_status", "draft")
    .limit(1);
  if (open?.length) return err("Es liegt bereits ein Entwurf einer neuen Version vor. Geben Sie ihn frei oder löschen Sie ihn.", 409);

  const read = await readNormUpload(file);
  if (!read.ok) return err(read.message, read.status);

  const pdfUrl = read.isPdf ? await storeNormPdf(admin, user.org_id, file, read.bytes) : null;
  const nextVersion = norm.version_no + 1;

  const { data, error: insertError } = await admin
    .from("norms")
    .insert({
      title: norm.title,
      domain: norm.domain,
      layer: 5,
      jurisdiction_type: "org",
      jurisdiction_name: null,
      org_id: user.org_id,
      category: norm.category,
      zone: norm.zone,
      text: read.text,
      source_url: file.name,
      pdf_url: pdfUrl,
      priority: norm.priority,
      scope_mode: norm.scope_mode,
      scope_cantons: norm.scope_cantons,
      scope_project_ids: norm.scope_project_ids,
      approval_status: "draft",
      version_no: nextVersion,
      supersedes_norm_id: norm.id,
    })
    .select("id")
    .single();
  if (insertError || !data) {
    if (insertError?.code === "23505") return err("Es liegt bereits ein Entwurf einer neuen Version vor.", 409);
    return err(insertError?.message ?? "Neue Version konnte nicht gespeichert werden", 500);
  }

  await logAudit(admin, {
    orgId: user.org_id,
    actorId: user.id,
    actorEmail: user.email,
    action: "norm_company_version",
    targetId: data.id,
    meta: { title: norm.title, version: nextVersion, supersedes: norm.id },
  });

  return ok({ id: data.id, version_no: nextVersion, approval_status: "draft" }, 201);
}
