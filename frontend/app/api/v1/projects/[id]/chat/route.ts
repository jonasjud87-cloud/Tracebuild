import { getAuthUser, ok, unauthorized, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { anthropic } from "@/lib/anthropic";
import { logAudit } from "@/lib/auditLog";

export const maxDuration = 120;

const MODEL = "claude-haiku-4-5-20251001";
const PRICE_IN  = 0.80 / 1_000_000;
const PRICE_OUT = 4.00 / 1_000_000;

interface ProjectRow {
  name: string;
  domain: string;
  location: { canton?: string; municipality?: string } | null;
  bauzone: string | null;
}

interface NormRow {
  norms: { id: string; title: string; category: string; text: string } | null;
}

interface AnalysisItemRow {
  status: string;
  note: string;
  norm_title: string | null;
}

function buildSystemPrompt(
  project: ProjectRow,
  normRows: NormRow[],
  lastItems: AnalysisItemRow[],
): string {
  const gemeinde = project.location?.municipality ?? "unbekannt";
  const kanton   = project.location?.canton       ?? "unbekannt";
  const bauzone  = project.bauzone                ?? "nicht ermittelt";

  const norms = normRows.map(r => r.norms).filter(Boolean) as NonNullable<NormRow["norms"]>[];
  const normenListe = norms.length > 0
    ? norms.map(n => `- [${n.category}] ${n.title}: ${n.text.slice(0, 200)}${n.text.length > 200 ? "…" : ""}`).join("\n")
    : "Noch keine Normen zugewiesen.";

  const failWarn = lastItems.filter(i => i.status === "fail" || i.status === "warn");
  const analyseSummary = failWarn.length > 0
    ? failWarn.map(i => `- [${i.status.toUpperCase()}] ${i.norm_title ?? "Norm"}: ${i.note}`).join("\n")
    : "Keine offenen Prüfpunkte aus der letzten Analyse.";

  return `Du bist ein Baurechtsassistent für das Projekt "${project.name}" in ${gemeinde}, Kanton ${kanton}, Bauzone ${bauzone}.

Projektkontext:

Zugewiesene Normen:
${normenListe}

Letzte Analyse:
${analyseSummary}

Du kannst:
- Fragen zum Projekt und den festgestellten Prüfpunkten beantworten
- Allgemeine Fragen zu Schweizer Baurecht, SIA-Normen und kantonalen Baugesetzen beantworten
- Verbesserungsvorschläge bei Norm-Verstössen erläutern

Du kannst nicht:
- Rechtsverbindliche Aussagen machen (weise darauf hin)
- Auf Dokumente ausserhalb des Projekts zugreifen

Antworte auf Deutsch. Strukturiere längere Antworten mit Überschriften und Listen. Sei präzise und praxisorientiert.`;
}

// ── GET — load history ────────────────────────────────────────────────────────

export async function GET(req: Request, { params }: { params: { id: string } }) {
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

  const url      = new URL(req.url);
  const threadId = url.searchParams.get("thread");

  let query: any = admin
    .from("chat_messages")
    .select("id, role, content, created_at, thread_id")
    .eq("project_id", params.id)
    .order("created_at", { ascending: true })
    .limit(100);

  if (threadId === "legacy") {
    query = query.is("thread_id", null);
  } else if (threadId) {
    query = query.eq("thread_id", threadId);
  }

  const { data, error } = await query;
  if (error) return err(error.message, 500);
  return ok(data);
}

// Anthropic requires strict user/assistant alternation starting with "user".
// Merge any consecutive same-role rows (can happen if a prior reply failed to
// save) so a previously-broken thread heals itself instead of 400-ing forever.
function sanitizeAlternating(
  rows: { role: string; content: string }[]
): { role: "user" | "assistant"; content: string }[] {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const row of rows) {
    const role = row.role as "user" | "assistant";
    const last = out[out.length - 1];
    if (last && last.role === role) {
      last.content += "\n\n" + row.content;
    } else {
      out.push({ role, content: row.content });
    }
  }
  while (out.length > 0 && out[0].role !== "user") out.shift();
  return out;
}

// ── POST — stream response ────────────────────────────────────────────────────

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const admin = createAdminClient();

  const { data: project, error: projectError } = await admin
    .from("projects")
    .select("*")
    .eq("id", params.id)
    .eq("org_id", user.org_id)
    .single();
  if (projectError || !project) return err(`Projekt nicht gefunden (${projectError?.message ?? "no data"})`, 404);

  const body = await request.json() as { content?: string; thread_id?: string };
  const content = body.content?.trim();
  // The "legacy" id is a client-side sentinel for the pre-threading bucket (thread_id IS NULL)
  // — it isn't a real uuid, so it must never be written to or queried against the thread_id column.
  const rawThreadId = body.thread_id ?? null;
  const threadId = rawThreadId === "legacy" ? null : rawThreadId;
  if (!content) return err("Nachricht fehlt");

  // Save user message
  const { data: insertedMsg, error: insertError } = await admin
    .from("chat_messages")
    .insert({
      project_id: params.id,
      role: "user",
      content,
      thread_id: threadId,
    })
    .select("id")
    .single();
  if (insertError || !insertedMsg) return err(`Nachricht konnte nicht gespeichert werden (${insertError?.message ?? "unbekannt"})`, 500);

  await logAudit(admin, {
    orgId: user.org_id,
    actorId: user.id,
    actorEmail: user.email,
    action: "chat_message",
    targetId: params.id,
    meta: { threadId },
  });

  // Load history for this thread (last 20 messages)
  let histQuery: any = admin
    .from("chat_messages")
    .select("role, content")
    .eq("project_id", params.id)
    .order("created_at", { ascending: true })
    .limit(20);

  if (threadId === null) {
    histQuery = histQuery.is("thread_id", null);
  } else {
    histQuery = histQuery.eq("thread_id", threadId);
  }
  const { data: historyRows } = await histQuery;

  // Load project norms
  const { data: normRows } = await admin
    .from("project_norms")
    .select("norms(id, title, category, text)")
    .eq("project_id", params.id);

  // Load last analysis items
  const { data: docRows } = await admin
    .from("documents")
    .select("id")
    .eq("project_id", params.id);

  const docIds = (docRows ?? []).map((d: { id: string }) => d.id);
  let lastItems: AnalysisItemRow[] = [];
  if (docIds.length > 0) {
    const { data: analyses } = await admin
      .from("analyses")
      .select("id")
      .in("document_id", docIds)
      .eq("status", "done")
      .order("created_at", { ascending: false })
      .limit(1);

    const latestAnalysis = analyses?.[0] ?? null;
    if (latestAnalysis) {
      const { data: items } = await admin
        .from("analysis_items")
        .select("status, note, norm_title")
        .eq("analysis_id", latestAnalysis.id)
        .in("status", ["fail", "warn"]);
      lastItems = (items ?? []) as AnalysisItemRow[];
    }
  }

  const systemPrompt = buildSystemPrompt(
    project as unknown as ProjectRow,
    (normRows ?? []) as unknown as NormRow[],
    lastItems,
  );

  const messages = sanitizeAlternating(historyRows ?? []);
  if (messages.length === 0) {
    await admin.from("chat_messages").delete().eq("id", insertedMsg.id);
    return err("Nachrichtenverlauf konnte nicht geladen werden. Bitte erneut versuchen.", 500);
  }

  const encoder = new TextEncoder();
  let fullResponse = "";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const claudeStream = anthropic.messages.stream({
          model: MODEL,
          max_tokens: 2048,
          system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
          messages,
        });

        for await (const event of claudeStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            const token = event.delta.text;
            fullResponse += token;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(token)}\n\n`));
          }
        }

        const final  = await claudeStream.finalMessage();
        const costUsd = final.usage.input_tokens * PRICE_IN + final.usage.output_tokens * PRICE_OUT;

        await admin.from("chat_messages").insert({
          project_id: params.id,
          role: "assistant",
          content: fullResponse,
          cost_usd: costUsd,
          thread_id: threadId,
        });

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (e) {
        // Roll back the user message so the thread doesn't end up with two
        // consecutive "user" rows, which would break every future request
        // (Anthropic requires strict role alternation).
        await admin.from("chat_messages").delete().eq("id", insertedMsg.id);
        controller.enqueue(
          encoder.encode(`data: [ERROR] ${e instanceof Error ? e.message : "Fehler"}\n\n`)
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
