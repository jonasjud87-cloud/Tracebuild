import { getAuthUser, ok, unauthorized, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { normMatchesZone } from "@/lib/zone-match";
import { isMissingSchema } from "@/lib/supabase/schema-errors";
import { loadOerebFacts, loadProjectNorms, selectNorms } from "@/lib/analysis-stages/prepare";
import { baueKenndatenBlatt, type KenndatenAuswertung } from "@/lib/kenndaten";
import { KenndatenFehler, kenndatenCacheKey, runKenndatenExtraction, waehleTextstellen } from "@/lib/kenndaten-extraction";

export const maxDuration = 300;

/**
 * Daten des Kenndatenblatts. Nur POST: Ein Aufruf kann ein Modell bezahlen, das darf kein Prefetch auslösen.
 * Das Modell läuft höchstens einmal je Normstand und Zone (Cache in project_kenndaten), Landfläche und
 * ÖREB-Stand werden bei jedem Klick frisch gelesen.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
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

  try {
    const { rows, error: normError } = await loadProjectNorms(admin, params.id);
    if (normError) {
      console.error("kenndaten: Normen nicht ladbar", normError.message);
      return err("Die Normen des Projekts konnten nicht geladen werden. Bitte später erneut versuchen.", 500);
    }
    // Auch bei unsicherer Zone: Eine Norm, die nur für andere Zonen gilt, darf hier keinen Wert liefern.
    const zoneRows = rows.filter((r) => r.norms && normMatchesZone(r.norms.zone, zone));
    const { norms, source } = selectNorms(zoneRows, zone, project.zone_confidence ?? null, user.org_id);
    const ausgewaehlt = source === "project_norms" ? waehleTextstellen(norms, zone) : [];
    if (ausgewaehlt.length === 0) {
      return err("Diesem Projekt sind für seine Zone keine auswertbaren Normen zugewiesen. Bitte zuerst die Normen laden.", 422);
    }

    const cacheKey = kenndatenCacheKey(norms, zone);
    const { data: cached, error: cacheError } = await admin
      .from("project_kenndaten")
      .select("norms_hash, items, model, cost_usd")
      .eq("project_id", params.id)
      .maybeSingle();
    if (cacheError) {
      // Ohne Tabelle gäbe es weder Cache noch Kostenerfassung: lieber kein bezahlter Aufruf.
      if (isMissingSchema(cacheError.message)) {
        return err("Das Kenndatenblatt ist noch nicht eingerichtet: Die Datenbank-Migration 20261110000001_kenndaten fehlt.", 503);
      }
      throw new Error(cacheError.message);
    }

    let auswertung: KenndatenAuswertung;
    let meta: { model: string; cost_usd: number | null; cached: boolean };
    if (cached && cached.norms_hash === cacheKey) {
      auswertung = cached.items as KenndatenAuswertung;
      meta = { model: cached.model, cost_usd: cached.cost_usd, cached: true };
    } else {
      const lauf = await runKenndatenExtraction(ausgewaehlt, zone);
      auswertung = lauf.auswertung;
      meta = { model: lauf.model, cost_usd: lauf.cost_usd, cached: false };
      const { error: upsertError } = await admin.from("project_kenndaten").upsert(
        {
          project_id: params.id,
          norms_hash: cacheKey,
          items: auswertung,
          model: lauf.model,
          cost_usd: lauf.cost_usd,
          created_at: new Date().toISOString(),
        },
        { onConflict: "project_id" },
      );
      // Der Aufruf ist bezahlt, das Blatt soll der Nutzer trotzdem bekommen.
      if (upsertError) console.error("kenndaten: Cache nicht geschrieben", upsertError.message);
    }

    const { facts, snapshot } = await loadOerebFacts(admin, params.id);
    const location = (project.location ?? {}) as { municipality?: string | null; canton?: string | null };
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
    return ok({ blatt, ...meta });
  } catch (e) {
    if (e instanceof KenndatenFehler) return err(e.message, 502);
    console.error("kenndaten: Auswertung fehlgeschlagen", e);
    return err("Die Normen konnten gerade nicht ausgewertet werden. Bitte später erneut versuchen.", 500);
  }
}
