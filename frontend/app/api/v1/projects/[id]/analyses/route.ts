import { getAuthUser, ok, unauthorized, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { normMatchesZone } from "@/lib/zone-match";
import { logAudit } from "@/lib/auditLog";
import {
  runNormAnalysis,
  type AnalysisRunResult,
  type CheckItem,
  type FileBlock,
  type NormInput,
  type OerebFacts,
} from "@/lib/analysis-engine";

export const maxDuration = 300;

/** Zeitdeckel für die Modell-Phase, gemessen ab Beginn der Route (Vercel killt bei 300 s). */
const ROUTE_MODEL_BUDGET_MS = 265_000;

// ── Norm-Auswahl ──────────────────────────────────────────────────────────────

interface ProjectNormRow {
  norms: {
    id: string;
    title: string;
    category: string | null;
    text: string | null;
    layer: number;
    zone: string | null;
    jurisdiction_type?: string | null;
  } | null;
}

/** Ohne hinterlegte Normen wird trotzdem geprüft — dann eben gegen das Fachwissen. */
const FALLBACK_NORM: NormInput = {
  id: "",
  title: "Allgemeine Schweizer Bauvorschriften",
  category: null,
  text:
    "Für dieses Projekt sind keine Normen hinterlegt. Prüfe den Plan anhand deines Fachwissens " +
    "über Schweizer Bauvorschriften: Grenz- und Strassenabstände, Gebäude- und Firsthöhe, " +
    "Geschosszahl, Erschliessung und Zufahrt, Parkierung, Brandschutz, Terrainveränderungen und " +
    "Mindestanforderungen an Aufenthaltsräume. Alles, was ohne hinterlegte Norm nicht " +
    "abschliessend beurteilbar ist, markierst du als warn.",
};

function selectNorms(
  pnRows: ProjectNormRow[],
  projectZone: string | null,
): { norms: NormInput[]; source: "project_norms" | "fallback" } {
  const applicable = pnRows
    .map((r) => r.norms)
    .filter((n): n is NonNullable<ProjectNormRow["norms"]> => !!n)
    .filter((n) => normMatchesZone(n.zone, projectZone))
    .filter((n) => (n.text ?? "").trim().length > 0)
    .map<NormInput>((n) => ({
      id: n.id, title: n.title, category: n.category, text: n.text ?? "",
      layer: n.layer, jurisdiction_type: n.jurisdiction_type ?? null,
    }));

  return applicable.length > 0
    ? { norms: applicable, source: "project_norms" }
    : { norms: [FALLBACK_NORM], source: "fallback" };
}

// ── ÖREB-Fakten ──────────────────────────────────────────────────────────────

/**
 * Was der Kataster über die Parzelle sagt — damit der Prüfer weiss, was amtlich gilt
 * (Zone, Lärm-ES) und was nachweislich nicht betroffen ist (Gewässer, Wald). Wirft nie;
 * ohne Auszug oder ohne Migration gibt es einfach keinen ÖREB-Block.
 */
async function loadOerebFacts(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
): Promise<OerebFacts | null> {
  try {
    const { data: extract, error } = await admin
      .from("oereb_extracts")
      .select("id, status")
      .eq("project_id", projectId)
      .maybeSingle();
    if (error || !extract || extract.status !== "ok") return null;

    const { data: themes, error: thErr } = await admin
      .from("oereb_themes")
      .select("theme_code, theme_name, concern, legend_text, type_code")
      .eq("extract_id", extract.id);
    if (thErr || !themes) return null;

    const affects = themes
      .filter((t) => t.concern === "affects")
      .map((t) => ({ code: t.theme_code, name: t.theme_name, legend: t.legend_text ?? null, typeCode: t.type_code ?? null }));
    const uniq = (xs: string[]) => Array.from(new Set(xs));
    return {
      affects,
      noData: uniq(themes.filter((t) => t.concern === "no_data").map((t) => t.theme_name)),
      notAffected: uniq(themes.filter((t) => t.concern === "not_affects").map((t) => t.theme_name)),
    };
  } catch {
    return null;
  }
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const admin = createAdminClient();

  const { data: project } = await admin
    .from("projects")
    .select("id")
    .eq("id", params.id)
    .eq("org_id", user.org_id)
    .single();
  if (!project) return err("Projekt nicht gefunden", 404);

  // 2-step query: get doc IDs first, then analyses
  const { data: docs } = await admin
    .from("documents")
    .select("id")
    .eq("project_id", params.id);

  const docIds = (docs ?? []).map((d: { id: string }) => d.id);
  if (docIds.length === 0) return ok([]);

  const { data, error } = await admin
    .from("analyses")
    .select("*, documents(doc_type, file_url), analysis_items(*)")
    .in("document_id", docIds)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false });

  if (error) return err(error.message, 500);
  return ok(data);
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const routeStart = Date.now();

  const user = await getAuthUser();
  if (!user) return unauthorized();

  const admin = createAdminClient();

  const { data: project } = await admin
    .from("projects")
    .select("*")
    .eq("id", params.id)
    .eq("org_id", user.org_id)
    .single();
  if (!project) return err("Projekt nicht gefunden", 404);

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) return err("Keine Datei hochgeladen");
  const docType = (formData.get("doc_type") as string | null) || "Grundriss";
  // Vom Client vergebene Lauf-ID: darüber kann er den Lauf per POST …/analyses/cancel abbrechen.
  const runId = ((formData.get("run_id") as string | null) ?? "").trim() || null;

  const fileBytes = Buffer.from(await file.arrayBuffer());
  const base64Data = fileBytes.toString("base64");
  const isPdf = file.type === "application/pdf" || file.name.endsWith(".pdf");

  // Erst die Datensätze, dann der Upload: Die Analyse-Zeile muss so früh wie möglich
  // existieren, damit ein Abbruch (POST …/cancel sucht sie über run_id) sie findet.
  // documents.file_url ist NOT NULL → vorerst "", nach dem Upload nachgetragen.
  const { data: doc, error: docError } = await admin
    .from("documents")
    .insert({ project_id: params.id, file_url: "", doc_type: docType })
    .select()
    .single();
  if (docError) return err(docError.message, 500);

  const { data: analysis, error: analysisError } = await admin
    .from("analyses")
    .insert({ document_id: doc.id, status: "running", result_json: runId ? { run_id: runId } : null })
    .select()
    .single();
  if (analysisError) return err(analysisError.message, 500);

  // Kosten müssen auch im Fehlerfall in die DB — deshalb ausserhalb des try.
  let run: AnalysisRunResult | null = null;

  // Abbruch durch den Nutzer: die Cancel-Route setzt status = 'cancelled'; wir schauen
  // regelmässig nach und reissen dann die laufenden Modell-Calls ab. Ein DB-Fehler beim
  // Nachschauen ist KEIN Abbruch — sonst würde ein Netzwackler einen bezahlten Lauf verwerfen.
  const cancel = new AbortController();
  const checkCancelled = async () => {
    const { data, error } = await admin.from("analyses").select("status").eq("id", analysis.id).maybeSingle();
    if (error) { console.warn(`Cancel-Poll für ${analysis.id} fehlgeschlagen:`, error.message); return; }
    if (!data || data.status === "cancelled") cancel.abort();
  };
  const cancelPoll = setInterval(checkCancelled, 2_500);

  /** Abgebrochen: Kosten festhalten, keine Prüfpunkte speichern. */
  const finishCancelled = async () => {
    await admin
      .from("analyses")
      .update({
        status: "cancelled",
        cost_usd: run?.cost_usd ?? 0,
        result_json: { run_id: runId, cancelled: true, model: run?.model ?? null, usage: run?.usage ?? null, calls: run?.calls ?? [] },
      })
      .eq("id", analysis.id);
    return err("Analyse abgebrochen", 409);
  };

  try {
    // Upload nach Supabase Storage; Vorschau-URL ins Dokument nachtragen.
    const storagePath = `${params.id}/${crypto.randomUUID()}_${file.name}`;
    const { data: uploadData, error: uploadError } = await admin.storage
      .from("documents")
      .upload(storagePath, fileBytes, { contentType: file.type || "application/pdf" });
    if (uploadError) {
      console.error(`Storage upload failed for ${storagePath}:`, uploadError);
    } else if (uploadData) {
      const fileUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/documents/${storagePath}`;
      await admin.from("documents").update({ file_url: fileUrl }).eq("id", doc.id);
    }

    // Abbruch, der schon während des Uploads kam, nicht erst nach 2.5 s bemerken.
    await checkCancelled();
    if (cancel.signal.aborted) return await finishCancelled();

    // 1. Normen laden
    const { data: pnRows, error: pnError } = await admin
      .from("project_norms")
      .select("norms(id, title, category, text, layer, zone, jurisdiction_type)")
      .eq("project_id", params.id);

    // Nicht stillschweigend auf die Ersatznorm zurückfallen, wenn die Abfrage
    // selbst kaputt ist — sonst sieht ein DB-Fehler aus wie "keine Normen".
    if (pnError) {
      console.error(`Projekt ${params.id}: project_norms konnte nicht gelesen werden:`, pnError);
    }

    const { norms, source: normsSource } = selectNorms(
      (pnRows ?? []) as unknown as ProjectNormRow[],
      project.bauzone ?? null,
    );
    if (normsSource === "fallback") {
      console.warn(`Projekt ${params.id}: keine Normen in project_norms — Analyse läuft auf Fachwissen.`);
    }
    const assignedIds = new Set(norms.map((n) => n.id).filter(Boolean));

    // 2. Datei-Block
    const fileBlock: FileBlock = isPdf
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Data } }
      : {
          type: "image",
          source: {
            type: "base64",
            media_type: (file.type || "image/jpeg") as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
            data: base64Data,
          },
        };

    // 3. Ein Call pro Norm, parallel, mit Cache-Grenze hinter PDF + Referenzrahmen.
    const oereb = await loadOerebFacts(admin, params.id);
    const budgetMs = Math.max(45_000, ROUTE_MODEL_BUDGET_MS - (Date.now() - routeStart));
    run = await runNormAnalysis(
      norms,
      fileBlock,
      {
        municipality: project.location?.municipality ?? "",
        canton: project.location?.canton ?? "",
        bauzone: project.bauzone ?? "",
        parcel: project.parcel_number ?? null,
        zoneSource: project.zone_source ?? null,
        oereb,
      },
      budgetMs,
      cancel.signal,
    );

    if (cancel.signal.aborted) return await finishCancelled();

    // 4. norm_id gegen die tatsächlich zugewiesenen Normen validieren.
    //    (Die Engine setzt sie serverseitig — das hier ist der Gurt zum Hosenträger,
    //    damit eine unbekannte UUID nie den FK auf norms(id) verletzt.)
    const rows = run.items.map((item: CheckItem) => ({
      analysis_id: analysis.id,
      norm_id: item.norm_id && assignedIds.has(item.norm_id) ? item.norm_id : null,
      norm_title: item.norm_title,
      category: item.category,
      status: item.status,
      note: item.finding, // 'note' column stores the finding text
      suggestion: item.suggestion,
      confidence: item.confidence,
      page_reference: item.page_reference,
    }));

    // 5. Speichern — Fehler werden ausgewertet, und ein kaputter Datensatz
    //    reisst nicht den ganzen Batch mit.
    const insertErrors: string[] = [];
    let savedCount = 0;

    if (rows.length > 0) {
      const { error: bulkError } = await admin.from("analysis_items").insert(rows);
      if (!bulkError) {
        savedCount = rows.length;
      } else {
        console.error("analysis_items bulk insert failed, falling back to row-by-row:", bulkError);
        for (const row of rows) {
          const { error: rowError } = await admin.from("analysis_items").insert(row);
          if (rowError) insertErrors.push(`${row.norm_title}: ${rowError.message}`);
          else savedCount++;
        }
      }
    }

    // 6. Analyse abschliessen. Kosten werden immer geschrieben. Der Status-Guard
    //    verhindert, dass ein Abbruch, der während des Speicherns eintraf, von "done"
    //    überschrieben wird — dann räumen wir die Prüfpunkte wieder weg.
    const status = savedCount > 0 ? "done" : "error";
    const { data: finalAnalysis, error: updateError } = await admin
      .from("analyses")
      .update({
        status,
        cost_usd: run.cost_usd,
        result_json: {
          run_id: runId,
          model: run.model,
          norms_source: normsSource,
          norms_error: pnError?.message ?? null,
          norm_count: norms.length,
          reference_norms: norms.filter((n) => n.layer === 4).map((n) => n.title),
          oereb_context: !!oereb,
          item_count: run.items.length,
          raw_item_count: run.consolidation?.raw_count ?? run.items.length,
          consolidation: run.consolidation,
          saved_count: savedCount,
          duration_ms: run.duration_ms,
          usage: run.usage,
          calls: run.calls,
          failed_norms: run.failed_norms,
          insert_errors: insertErrors,
        },
      })
      .eq("id", analysis.id)
      .eq("status", "running")
      .select("*, documents(doc_type, file_url)")
      .maybeSingle();

    if (updateError) return err(updateError.message, 500);
    if (!finalAnalysis) {
      await admin.from("analysis_items").delete().eq("analysis_id", analysis.id);
      return await finishCancelled();
    }

    if (savedCount === 0) {
      const reason = run.failed_norms[0]?.error ?? insertErrors[0] ?? "Keine Prüfpunkte erzeugt";
      return err(`Analyse ohne Ergebnis: ${reason}`, 502);
    }

    // 7. Zurückgelesenes Ergebnis an den Client — nicht die In-Memory-Items.
    //    Die haben weder DB-`id` noch die Spalte `note`, die das UI liest.
    const { data: savedItems } = await admin
      .from("analysis_items")
      .select("*")
      .eq("analysis_id", analysis.id);

    const normOrder = new Map(norms.map((n, i) => [n.id, i]));
    const severity: Record<string, number> = { fail: 0, warn: 1, ok: 2 };
    const items = (savedItems ?? []).slice().sort((a, b) => {
      const byNorm = (normOrder.get(a.norm_id ?? "") ?? 999) - (normOrder.get(b.norm_id ?? "") ?? 999);
      if (byNorm !== 0) return byNorm;
      return (severity[a.status] ?? 9) - (severity[b.status] ?? 9);
    });

    await logAudit(admin, {
      orgId: user.org_id,
      actorId: user.id,
      actorEmail: user.email,
      action: "analysis_run",
      targetId: analysis.id,
      meta: { projectId: params.id, status: finalAnalysis.status, itemCount: items.length },
    });

    return ok({ ...finalAnalysis, items, failed_norms: run.failed_norms }, 201);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Analyse fehlgeschlagen";
    await admin
      .from("analyses")
      .update({
        status: cancel.signal.aborted ? "cancelled" : "error",
        // Auch wenn es schiefging: was das Modell gekostet hat, wird verbucht.
        cost_usd: run?.cost_usd ?? 0,
        result_json: {
          run_id: runId,
          error: message,
          model: run?.model ?? null,
          usage: run?.usage ?? null,
          calls: run?.calls ?? [],
          failed_norms: run?.failed_norms ?? [],
        },
      })
      .eq("id", analysis.id)
      .in("status", ["running", "cancelled"]);

    await logAudit(admin, {
      orgId: user.org_id,
      actorId: user.id,
      actorEmail: user.email,
      action: "analysis_run",
      targetId: analysis.id,
      meta: { projectId: params.id, status: "error", error: message },
    });

    return err(message, 500);
  } finally {
    clearInterval(cancelPoll);
  }
}
