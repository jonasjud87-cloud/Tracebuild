"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ExtractStatus, GeodataResponse, OerebExtractExtras, OerebRefreshExtras } from "@/lib/geoadmin/contract";
import { formatDate, oerebReloadNote, zoneNeedsAttention, zoneOriginLabel, type OerebReloadResponse, type ZoneRef } from "./geoportal-logic";
import OerebStatusNotice from "./OerebStatusNotice";
import ZoneEditor from "./ZoneEditor";
import { useOerebSync } from "./useOerebDocumentSync";
import { useOrgRole } from "./useOrgRole";

interface ProjectRow extends ZoneRef {
  location: { canton?: string; municipality?: string } | null;
  parcel_number: string | null;
  egrid?: string | null;
}

interface OerebView {
  extract: ({ status: ExtractStatus | null; status_detail: string | null; egrid: string | null; fetched_at: string | null } & Partial<OerebExtractExtras>) | null;
  zone: ZoneRef | null;
  oereb_pdf_url?: string | null;
}

const LINK: React.CSSProperties = { fontSize: 12, color: "#85A6E9", textDecoration: "none" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
      <dt style={{ flex: "0 0 150px", fontSize: 12, color: "#7B8299" }}>{label}</dt>
      <dd style={{ flex: "1 1 180px", minWidth: 0, margin: 0, fontSize: 13, color: "#ABAEBB", lineHeight: 1.45, overflowWrap: "anywhere" }}>{children}</dd>
    </div>
  );
}

function buildingLine(b: GeodataResponse["data"]["buildings"][number]): string {
  return [
    `EGID ${b.egid}`,
    b.year ? `Baujahr ${b.year}` : b.period ? `Bauperiode ${b.period}` : null,
    b.floors !== null ? `${b.floors} Geschosse` : null,
    b.dwellings !== null ? `${b.dwellings} Wohnungen` : null,
    b.area_m2 !== null ? `${Math.round(b.area_m2).toLocaleString("de-CH")} m²` : null,
  ].filter(Boolean).join(" · ");
}

/**
 * Grundstück im Projekt: Bauzone, ÖREB-Status, Zusatzdaten, Links, Quellen und «Neu laden».
 * Die Geodaten haben keine Rechtswirkung; massgebend bleibt der ÖREB-Auszug.
 */
export default function ProjectGeoPanel({ projectId, defaultOpen = false, showZoneEditor = true, onChanged }: {
  projectId: string;
  defaultOpen?: boolean;
  /** In den Einstellungen gibt es dafür das eigene Feld. */
  showZoneEditor?: boolean;
  /** Zone oder Auszug haben sich geändert. */
  onChanged?: () => void;
}) {
  const { isAdmin } = useOrgRole();
  const sync = useOerebSync();
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [oereb, setOereb] = useState<OerebView | null>(null);
  const [oerebError, setOerebError] = useState<string | null>(null);
  const [geo, setGeo] = useState<GeodataResponse | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [reloadNote, setReloadNote] = useState<string | null>(null);
  const [open, setOpen] = useState(defaultOpen);

  const load = useCallback(async () => {
    const [p, o, g] = await Promise.allSettled([
      api.get<ProjectRow>(`/projects/${projectId}`),
      api.get<OerebView>(`/projects/${projectId}/oereb`),
      api.get<GeodataResponse>(`/projects/${projectId}/geodata`),
    ]);
    if (p.status === "fulfilled") setProject(p.value);
    if (o.status === "fulfilled") { setOereb(o.value); setOerebError(null); }
    else setOerebError(o.reason instanceof Error ? o.reason.message : "Unbekannter Fehler");
    if (g.status === "fulfilled") { setGeo(g.value); setGeoError(null); }
    else setGeoError(g.reason instanceof Error ? g.reason.message : "Unbekannter Fehler");
    setLoading(false);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function handleReload() {
    setReloading(true);
    setReloadNote(null);
    const [o, g] = await Promise.allSettled([
      api.post<OerebView & OerebRefreshExtras & OerebReloadResponse>(`/projects/${projectId}/oereb`, { force: true }),
      api.post<GeodataResponse>(`/projects/${projectId}/geodata`, { force: true }),
    ]);
    const reason = (r: PromiseRejectedResult) => (r.reason instanceof Error && r.reason.message) || "Bitte in einer halben Minute erneut versuchen.";
    const notes: string[] = [];
    if (o.status === "rejected") notes.push(`ÖREB-Auszug nicht neu geladen: ${reason(o)}`);
    if (g.status === "rejected") notes.push(`Zusatzdaten nicht neu geladen: ${reason(g)}`);
    await load();
    setReloading(false);
    if (o.status === "fulfilled") {
      const note = oerebReloadNote(o.value, !!(project?.parcel_number || project?.egrid));
      if (note) notes.push(note);
      if (o.value.documents_pending > 0) sync.run(o.value.documents_pending);
    }
    setReloadNote(notes.length ? notes.join(" ") : "Neu geladen.");
    onChanged?.();
  }

  function handleZoneSaved(zone: string) {
    setProject((p) => (p ? { ...p, bauzone: zone, zone_source: "manual", zone_confidence: null } : p));
    onChanged?.();
  }

  const extract = oereb?.extract ?? null;
  const status = extract?.status ?? null;
  const canton = project?.location?.canton ?? null;
  const pdfUrl = geo?.links.oereb_pdf ?? oereb?.oereb_pdf_url ?? null;
  const egrid = project?.egrid ?? extract?.egrid ?? null;
  const zone: ZoneRef | null = project ?? oereb?.zone ?? null;
  const attention = !loading && zoneNeedsAttention(zone);
  const origin = zoneOriginLabel(zone);
  const lowZone = attention && !!zone?.bauzone;
  const extractDate = formatDate(extract?.fetched_at);
  const staleError = status === "ok" ? extract?.last_error ?? null : null;
  const hasLinks = !!(geo?.links.geoportal || geo?.links.canton_portal || pdfUrl);

  return (
    <section aria-label="Grundstück" style={{ marginBottom: 24, background: "rgba(23,37,64,0.55)", border: `1px solid ${attention ? "rgba(251,191,36,0.35)" : "rgba(133,166,233,0.18)"}`, borderRadius: 14, padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: "#fff", margin: 0 }}>Grundstück</h3>
          {project?.parcel_number && (
            <span style={{ fontSize: 11, background: "rgba(133,166,233,0.1)", color: "#ABAEBB", padding: "2px 8px", borderRadius: 100 }}>
              Parzelle {project.parcel_number}
            </span>
          )}
          {egrid && (
            <span title="Eidgenössischer Grundstücksidentifikator" style={{ fontSize: 11, background: "rgba(133,166,233,0.1)", color: "#7B8299", padding: "2px 8px", borderRadius: 100, fontFamily: "monospace" }}>
              {egrid}
            </span>
          )}
          {zone?.bauzone && (
            <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 100, background: lowZone || zone.zone_confidence === "coarse" ? "rgba(251,191,36,0.12)" : "rgba(40,98,215,0.12)", color: lowZone || zone.zone_confidence === "coarse" ? "#FBBF24" : "#85A6E9" }}>
              Zone {zone.bauzone}{origin ? ` · ${origin}` : ""}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handleReload}
          disabled={reloading || loading}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, minHeight: 32, padding: "5px 12px", borderRadius: 8, fontSize: 12, color: "#ABAEBB", border: "1px solid rgba(133,166,233,0.2)", background: "none", cursor: reloading ? "not-allowed" : "pointer", opacity: reloading ? 0.6 : 1, fontFamily: "inherit", whiteSpace: "nowrap" }}
        >
          <svg aria-hidden="true" className={reloading ? "animate-spin" : ""} style={{ width: 13, height: 13 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {reloading ? "Wird geladen…" : "Neu laden"}
        </button>
      </div>

      <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#7B8299", margin: reloadNote ? "6px 0 0" : 0 }}>{reloadNote}</p>

      {loading ? (
        <p style={{ fontSize: 12, color: "#7B8299", margin: "8px 0 0" }}>Wird geladen…</p>
      ) : (
        <>
          {/* ÖREB-Status: nie ein stilles Leerfeld */}
          <div style={{ marginTop: 10 }}>
            {oerebError ? (
              <p style={{ fontSize: 12, color: "#ABAEBB", margin: 0 }}>Der Stand des ÖREB-Auszugs konnte nicht geladen werden. Bitte «Neu laden» versuchen.</p>
            ) : !status ? (
              <p style={{ fontSize: 12, color: "#ABAEBB", margin: 0 }}>
                {project?.parcel_number || egrid
                  ? "Noch kein ÖREB-Auszug. «Neu laden» ruft ihn ab."
                  : "Ohne Parzelle gibt es keinen ÖREB-Auszug. Die Parzelle lässt sich in den Einstellungen wählen."}
              </p>
            ) : status !== "ok" ? (
              <OerebStatusNotice status={status} canton={canton} detail={extract?.status_detail} pdfUrl={pdfUrl} attemptAt={extract?.last_attempt_at ?? extract?.fetched_at} projectId={projectId} isAdmin={isAdmin} hideChoose={!showZoneEditor} />
            ) : (
              <p style={{ fontSize: 12, color: staleError ? "#FBBF24" : "#ABAEBB", margin: 0, lineHeight: 1.45 }}>
                {staleError
                  ? `Die letzte Aktualisierung ist fehlgeschlagen. Es gilt der ÖREB-Auszug vom ${extractDate ?? "unbekannten Datum"}. Bitte später neu laden.`
                  : `ÖREB-Auszug vom ${extractDate ?? "unbekannten Datum"}.`}
              </p>
            )}
          </div>

          {/* Keine sichere Zone */}
          {attention && (
            <div style={{ marginTop: 10, background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.2)", borderRadius: 10, padding: "10px 12px" }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: "#FBBF24", margin: 0 }}>
                {lowZone ? `Bauzone unsicher, bitte prüfen: ${zone?.bauzone} ist nur ein Vorschlag` : "Bauzone nicht bekannt"}
              </p>
              <p style={{ fontSize: 12, color: "#ABAEBB", margin: "2px 0 8px", lineHeight: 1.45 }}>
                {lowZone
                  ? "Der Auszug lässt keinen sicheren Schluss zu. Die Zone gilt nicht als gesichert, bis sie bestätigt oder korrigiert ist; sie bestimmt, welche Normen geladen werden."
                  : "TraceBuild konnte keine sichere Zone ermitteln. Bitte von Hand eintragen; die Zone bestimmt, welche Normen geladen werden."}
              </p>
              {!showZoneEditor ? null : isAdmin ? (
                <ZoneEditor projectId={projectId} initial={zone?.bauzone ?? ""} onSaved={handleZoneSaved} accent="rgba(251,191,36,0.3)" proposal={lowZone} />
              ) : (
                <p style={{ fontSize: 12, color: "#7B8299", margin: 0 }}>{lowZone ? "Bestätigen oder korrigieren kann die Zone ein Organisations-Admin, hier oder in den Einstellungen." : "Die Zone kann ein Organisations-Admin hier oder in den Einstellungen eintragen."}</p>
              )}
            </div>
          )}

          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            style={{ marginTop: 10, display: "inline-flex", alignItems: "center", gap: 6, minHeight: 28, background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 12, color: "#85A6E9" }}
          >
            <svg aria-hidden="true" style={{ width: 11, height: 11, transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            Zusatzdaten und Links
          </button>

          {open && (
            <div style={{ marginTop: 8 }}>
              {geoError && !geo ? (
                <p style={{ fontSize: 12, color: "#ABAEBB", margin: 0 }}>Die Zusatzdaten sind zurzeit nicht verfügbar. Bitte später neu laden.</p>
              ) : geo?.status === "no_location" ? (
                <p style={{ fontSize: 12, color: "#ABAEBB", margin: 0 }}>Ohne Standort gibt es keine Zusatzdaten. Bitte die Parzelle in den Einstellungen über die Suche wählen.</p>
              ) : geo?.status === "unavailable" && !geo.fetched_at ? (
                <p style={{ fontSize: 12, color: "#ABAEBB", margin: 0 }}>Die Bundesdienste antworten zurzeit nicht. Bitte später neu laden.</p>
              ) : geo ? (
                <dl style={{ margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  <Row label="Höhe">{geo.data.height_m !== null ? `${Math.round(geo.data.height_m).toLocaleString("de-CH")} m ü. M.` : "nicht ermittelt"}</Row>
                  <Row label="ÖV-Güteklasse">{geo.data.oev_class ?? "keine Güteklasse am Referenzpunkt"}</Row>
                  <Row label="ISOS">
                    {geo.data.isos.length === 0 ? "kein ISOS-Perimeter am Referenzpunkt" : geo.data.isos.map((i) => (
                      <span key={i.number} style={{ display: "block" }}>
                        {i.url ? <a href={i.url} target="_blank" rel="noreferrer" style={LINK}>{i.name} ↗</a> : i.name}
                        {i.category ? ` (${i.category})` : ""}
                      </span>
                    ))}
                  </Row>
                  <Row label="Gebäude (GWR)">
                    {geo.data.buildings.length === 0 ? "kein Gebäude im GWR erfasst" : geo.data.buildings.map((b) => (
                      <span key={b.egid} style={{ display: "block" }}>{buildingLine(b)}</span>
                    ))}
                  </Row>
                </dl>
              ) : null}

              {geo && geo.errors.length > 0 && (
                <p style={{ fontSize: 11, color: "#FBBF24", margin: "8px 0 0", lineHeight: 1.45, overflowWrap: "anywhere" }}>
                  Unvollständig: {geo.errors.map((e) => `${e.source}: ${e.message}`).join(" · ")}. Bei diesen Daten gilt der letzte Stand, falls vorhanden.
                </p>
              )}

              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10 }}>
                {geo?.links.geoportal && <a href={geo.links.geoportal} target="_blank" rel="noreferrer" style={LINK}>Geoportal des Bundes ↗</a>}
                {geo?.links.canton_portal && <a href={geo.links.canton_portal} target="_blank" rel="noreferrer" style={LINK}>Kantonales Portal ↗</a>}
                {pdfUrl && <a href={pdfUrl} target="_blank" rel="noreferrer" style={LINK}>Amtlicher ÖREB-Auszug (PDF) ↗</a>}
                {!hasLinks && <span style={{ fontSize: 12, color: "#7B8299" }}>Links erscheinen, sobald das Grundstück bekannt ist.</span>}
              </div>

              <p style={{ fontSize: 11, color: "#7B8299", margin: "10px 0 0", lineHeight: 1.45 }}>
                {geo?.fetched_at ? `Stand ${formatDate(geo.fetched_at)}. ` : ""}
                {geo?.sources.length ? `Quellen: ${geo.sources.join(", ")}. ` : ""}
                Ohne Rechtswirkung, der ÖREB-Auszug geht vor.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
