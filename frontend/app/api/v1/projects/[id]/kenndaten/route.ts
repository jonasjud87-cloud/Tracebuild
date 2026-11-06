import { randomUUID } from "node:crypto";
import { getAuthUser, ok, unauthorized, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { normMatchesZone } from "@/lib/zone-match";
import { isMissingSchema } from "@/lib/supabase/schema-errors";
import { loadOerebFacts, loadProjectNorms, selectNorms } from "@/lib/analysis-stages/prepare";
import { loadImportFilter } from "@/lib/oereb/documents";
import { withTimeout } from "@/lib/pdf-text";
import { baueKenndatenBlatt } from "@/lib/kenndaten";
import {
  KenndatenFehler,
  MAX_CALL_TIMEOUT_MS,
  kenndatenCacheKey,
  passageScore,
  runKenndatenExtraction,
  waehleTextstellen,
} from "@/lib/kenndaten-extraction";
import { KenndatenBesetzt, holeAuswertung, type KenndatenCacheZeile, type KenndatenSpeicher } from "@/lib/kenndaten-lauf";
import { ladeGemeindePdfs, uploadPfad, type PdfQuelle } from "@/lib/kenndaten-quelle";

export const maxDuration = 300;

const BUDGET_MS = 295_000;
const PDF_BUDGET_MS = 25_000;
const UPLOAD_TIMEOUT_MS = 12_000;
/** Mindestens so lange wie die Funktion lebt: Danach gilt die Sperre eines abgestürzten Laufs als frei. */
const SPERRE_S = 310;
const WARTE_MS = 180_000;
const MIN_MODELL_MS = 60_000;

type Admin = ReturnType<typeof createAdminClient>;

class MigrationFehlt extends Error {}

function speicherFuer(admin: Admin, projectId: string): KenndatenSpeicher {
  const melde = (message: string) => {
    if (isMissingSchema(message)) throw new MigrationFehlt();
    throw new Error(message);
  };
  return {
    async lesen() {
      const { data, error } = await admin
        .from("project_kenndaten")
        .select("norms_hash, items, model, created_at")
        .eq("project_id", projectId)
        .maybeSingle();
      if (error) melde(error.message);
      return (data as KenndatenCacheZeile | null) ?? null;
    },
    async sperren(token) {
      const { data, error } = await admin.rpc("kenndaten_sperren", { p_project_id: projectId, p_token: token, p_ttl_seconds: SPERRE_S });
      if (error) melde(error.message);
      return data === true;
    },
    async abschliessen(token, ergebnis) {
      const felder = ergebnis
        ? { norms_hash: ergebnis.hash, items: ergebnis.auswertung, model: ergebnis.model, created_at: new Date().toISOString() }
        : {};
      const { error } = await admin
        .from("project_kenndaten")
        .update({ ...felder, lock_token: null, locked_until: null })
        .eq("project_id", projectId)
        .eq("lock_token", token);
      if (error) throw new Error(error.message);
    },
    async kostenBuchen(costUsd, model) {
      const { error } = await admin.from("project_kenndaten_kosten").insert({ project_id: projectId, cost_usd: costUsd, model });
      if (error) throw new Error(error.message);
    },
  };
}

async function ladeNormQuellen(admin: Admin, ids: string[]): Promise<Map<string, Pick<PdfQuelle, "pdf_url" | "source_url">>> {
  const { data, error } = await admin.from("norms").select("id, pdf_url, source_url").in("id", ids);
  if (error) {
    console.error("kenndaten: Quellen der Normen nicht ladbar", error.message);
    return new Map();
  }
  const rows = (data ?? []) as { id: string; pdf_url: string | null; source_url: string | null }[];
  return new Map(rows.map((r) => [r.id, { pdf_url: r.pdf_url, source_url: r.source_url }]));
}

/**
 * Daten des Kenndatenblatts. Nur POST: Ein Aufruf kann ein Modell bezahlen, das darf kein Prefetch auslösen.
 * Das Modell läuft höchstens einmal je Normstand und Zone (Cache in project_kenndaten), Landfläche und
 * ÖREB-Stand werden bei jedem Klick frisch gelesen.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const startedAt = Date.now();
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const admin = createAdminClient();
  const { data: project } = await admin
    .from("projects")
    .select("id, name, location, parcel_number, bauzone, zone_source, zone_confidence")
    .eq("id", params.id)
    .eq("org_id", user.org_id)
    .single();
  if (!project) return err("Projekt nicht gefunden", 404);

  const zone = (project.bauzone ?? "").trim();
  if (!zone) {
    return err("Für dieses Projekt ist keine Zone erfasst. Bitte zuerst den ÖREB-Auszug abrufen oder die Zone eintragen.", 422);
  }
  const location = (project.location ?? {}) as { municipality?: string | null; canton?: string | null };

  try {
    const { rows, error: normError } = await loadProjectNorms(admin, params.id);
    if (normError) {
      console.error("kenndaten: Normen nicht ladbar", normError.message);
      return err("Die Normen des Projekts konnten nicht geladen werden. Bitte später erneut versuchen.", 500);
    }
    // Auch bei unsicherer Zone: Eine Norm, die nur für andere Zonen gilt, darf hier keinen Wert liefern.
    const zoneRows = rows.filter((r) => r.norms && normMatchesZone(r.norms.zone, zone));
    const { norms, source } = selectNorms(zoneRows, zone, project.zone_confidence ?? null, user.org_id);
    if (source !== "project_norms" || waehleTextstellen(norms, zone).length === 0) {
      return err("Diesem Projekt sind für seine Zone keine auswertbaren Normen zugewiesen. Bitte zuerst die Normen laden.", 422);
    }

    const quellen = await ladeNormQuellen(admin, norms.map((n) => n.id));
    const hash = kenndatenCacheKey(
      norms.map((n) => ({ id: n.id, title: n.title, layer: n.layer, text: n.text, quelle: quellen.get(n.id)?.pdf_url ?? quellen.get(n.id)?.source_url })),
      zone,
    );

    const { auswertung, model, cached } = await holeAuswertung({
      speicher: speicherFuer(admin, params.id),
      hash,
      token: randomUUID(),
      warteMs: WARTE_MS,
      rechnen: async (meldeKosten) => {
        // Die relevanteste Gemeindenorm zuerst: Bei knapper Zeit soll sie ihr Original bekommen.
        const gemeinde = norms
          .filter((n) => n.layer === 4)
          .sort((a, b) => passageScore(b.text, zone) - passageScore(a.text, zone))
          .map((n): PdfQuelle => ({ id: n.id, title: n.title, pdf_url: quellen.get(n.id)?.pdf_url ?? null, source_url: quellen.get(n.id)?.source_url ?? null }));
        const rules = await loadImportFilter(admin, location.canton ?? "");
        const pdfDeadline = Date.now() + PDF_BUDGET_MS;
        const pdfs = await ladeGemeindePdfs(gemeinde, {
          rules,
          canton: location.canton ?? "",
          deadlineAt: pdfDeadline,
          ladeUpload: async (url, maxBytes) => {
            const path = uploadPfad(url, process.env.NEXT_PUBLIC_SUPABASE_URL);
            if (!path) return null;
            const limit = Math.max(1_000, Math.min(UPLOAD_TIMEOUT_MS, pdfDeadline - Date.now()));
            const { data, error } = await withTimeout(admin.storage.from("documents").download(path), limit);
            if (error || !data) throw new Error(error?.message ?? "Upload nicht ladbar");
            if (data.size > maxBytes) throw new Error(`Upload grösser als ${maxBytes} Bytes`);
            const bytes = Buffer.from(await data.arrayBuffer());
            if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("Upload ist kein PDF");
            return bytes;
          },
        });

        const left = startedAt + BUDGET_MS - Date.now();
        if (left < MIN_MODELL_MS) throw new KenndatenFehler("Die Zeit für die Auswertung hat nicht gereicht. Bitte erneut versuchen.");

        const texte = norms.map((n) => ({ ...n, text: pdfs.texte.get(n.id) ?? n.text }));
        const lauf = await runKenndatenExtraction(waehleTextstellen(texte, zone), zone, {
          timeoutMs: Math.min(left - 5_000, MAX_CALL_TIMEOUT_MS),
          onKosten: meldeKosten,
        });
        return { auswertung: { ...lauf.auswertung, hinweise: pdfs.hinweise, vorbehalt: pdfs.vorbehalt }, model: lauf.model };
      },
    });

    const { facts, snapshot } = await loadOerebFacts(admin, params.id);
    const blatt = baueKenndatenBlatt({
      projekt: {
        name: project.name,
        municipality: location.municipality ?? null,
        canton: location.canton ?? null,
        parcel: project.parcel_number ?? null,
        bauzone: zone,
        zoneSource: project.zone_source ?? null,
        zoneConfidence: project.zone_confidence ?? null,
      },
      landflaeche: facts?.parcelAreaM2 ?? null,
      oerebFetchedAt: snapshot.fetched_at,
      oerebStale: snapshot.stale,
      auswertung,
      jetzt: new Date(),
    });
    return ok({ blatt, model, cached });
  } catch (e) {
    // Ohne Tabellen gäbe es weder Sperre noch Cache noch Kostenerfassung: lieber kein bezahlter Aufruf.
    if (e instanceof MigrationFehlt) {
      return err("Das Kenndatenblatt ist noch nicht eingerichtet: Die Datenbank-Migration 20261110000001_kenndaten fehlt.", 503);
    }
    if (e instanceof KenndatenBesetzt) return err(e.message, 409);
    if (e instanceof KenndatenFehler) return err(e.message, 502);
    console.error("kenndaten: Auswertung fehlgeschlagen", e);
    return err("Die Normen konnten gerade nicht ausgewertet werden. Bitte später erneut versuchen.", 500);
  }
}
