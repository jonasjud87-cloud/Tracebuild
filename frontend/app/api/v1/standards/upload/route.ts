import { getAuthUser, ok, unauthorized, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadImportFilter } from "@/lib/oereb/documents";
import { linkUploadToOfficial } from "@/lib/oereb/upload-supersede";
import { assignNormsToOrgProjects } from "@/lib/norm-assignment";
import { logAudit } from "@/lib/auditLog";
import { uploadCountry } from "@/lib/norm-applies";
import { insertNormWithCountry, type NormInsertClient } from "@/lib/norm-country";
import { readNormUpload, storeNormPdf, projectsBelongToOrg } from "@/lib/norm-upload-file";
import { isPriority, parseScope } from "@/lib/company-norms";

const LAYER_BY_JURISDICTION: Record<string, number> = {
  national: 1,
  cantonal: 3,
  municipal: 4,
  org: 5,
};

const NAMELESS_TYPES = new Set(["national", "org"]);

export async function POST(request: Request) {
  try {
    return await handleUpload(request);
  } catch (e) {
    console.error("Norm-Upload fehlgeschlagen:", e);
    return err(e instanceof Error ? `${e.name}: ${e.message}` : "Unbekannter Serverfehler", 500);
  }
}

async function handleUpload(request: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const domain = (formData.get("domain") as string) ?? "bau";
  const jurisdictionType = (formData.get("jurisdiction_type") as string) || "cantonal";
  const jurisdictionName = (formData.get("jurisdiction_name") as string) || null;
  const category = formData.get("category") as string;
  const sourceName = (formData.get("source_name") as string) || null;
  const zone = (formData.get("zone") as string) || null;

  if (!file) return err("Keine Datei hochgeladen");
  if (!category) return err("Kategorie fehlt");
  if (!(jurisdictionType in LAYER_BY_JURISDICTION)) return err("Unbekannte Ebene");
  if (!NAMELESS_TYPES.has(jurisdictionType) && !jurisdictionName) return err("Kanton/Gemeinde fehlt");

  const company = jurisdictionType === "org";
  let companyFields: Record<string, unknown> = {};
  const admin = createAdminClient();
  if (company) {
    const priority = (formData.get("priority") as string) || "advisory";
    if (!isPriority(priority)) return err("Unbekannte Verbindlichkeit");
    const scope = parseScope({
      mode: formData.get("scope_mode"),
      cantons: formData.get("scope_cantons"),
      projectIds: formData.get("scope_project_ids"),
    });
    if ("error" in scope) return err(scope.error);
    if (!(await projectsBelongToOrg(admin, user.org_id, scope.value.projectIds))) return err("Ungültiges Projekt");
    companyFields = {
      priority,
      scope_mode: scope.value.mode,
      scope_cantons: scope.value.cantons,
      scope_project_ids: scope.value.projectIds,
      approval_status: "draft",
      version_no: 1,
    };
  }

  const read = await readNormUpload(file);
  if (!read.ok) return err(read.message, read.status);
  const { text, bytes, isPdf } = read;
  const title = sourceName || file.name;

  const pdfUrl = isPdf ? await storeNormPdf(admin, user.org_id, file, bytes) : null;

  const { data, error } = await insertNormWithCountry(
    admin as unknown as NormInsertClient,
    {
      title,
      domain,
      layer: LAYER_BY_JURISDICTION[jurisdictionType] ?? 3,
      jurisdiction_type: jurisdictionType,
      jurisdiction_name: NAMELESS_TYPES.has(jurisdictionType) ? null : jurisdictionName,
      org_id: user.org_id,
      category: category.trim(),
      text,
      source_url: sourceName || file.name,
      zone: zone?.trim() || null,
      pdf_url: pdfUrl,
      ...companyFields,
    },
    uploadCountry(jurisdictionType, jurisdictionName, formData.get("country") as string | null)
  );

  if (error || !data) {
    const missing = company && /approval_status|scope_mode|priority|version_no/.test(error?.message ?? "");
    return err(missing ? "Unternehmensnormen sind noch nicht eingerichtet (Migration 20261113000003 fehlt)." : error?.message ?? "Norm konnte nicht gespeichert werden", 500);
  }

  await logAudit(admin, {
    orgId: user.org_id,
    actorId: user.id,
    actorEmail: user.email,
    action: "norm_upload",
    targetId: data.id,
    meta: { title, category, jurisdictionName, ...(company ? { company: true, ...companyFields } : {}) },
  });

  if (!company) {
    await linkUploadToOfficial(admin, { id: data.id, text, jurisdiction_type: jurisdictionType, jurisdiction_name: jurisdictionName }, (canton) =>
      loadImportFilter(admin, canton)
    );
  }

  const projects_updated = company ? 0 : await assignNormsToOrgProjects(user.org_id);

  return ok({ count: 1, jurisdiction_name: jurisdictionName, category, id: data.id, projects_updated, approval_status: company ? "draft" : "approved" }, 201);
}
