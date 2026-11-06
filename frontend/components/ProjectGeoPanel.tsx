"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ExtractStatus, GeodataResponse, OerebExtractExtras, OerebRefreshExtras } from "@/lib/geoadmin/contract";
import { formatDate, oerebReloadNote, zoneNeedsAttention, zoneOriginLabel, type OerebReloadResponse, type ZoneRef } from "./geoportal-logic";
import OerebStatusNotice from "./OerebStatusNotice";
import ZoneEditor from "./ZoneEditor";
import { useOerebSync } from "./useOerebDocumentSync";
import { useOrgRole } from "./useOrgRole";
import p from "@/app/projects/project.module.css";
import g from "./project-geo.module.css";

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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={g.dlRow}>
      <dt className={g.dt}>{label}</dt>
      <dd className={g.dd}>{children}</dd>
    </div>
  );
}

function InfoLine({ warn = false, children }: { warn?: boolean; children: React.ReactNode }) {
  return (
    <p className={`${g.infoLine} ${warn ? g.infoLineWarn : ""}`}>
      <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5M12 8h.01" />
      </svg>
      <span>{children}</span>
    </p>
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

export default function ProjectGeoPanel({ projectId, defaultOpen = false, showZoneEditor = true, onChanged }: {
  projectId: string;
  defaultOpen?: boolean;
  showZoneEditor?: boolean;
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
    const [pr, o, ge] = await Promise.allSettled([
      api.get<ProjectRow>(`/projects/${projectId}`),
      api.get<OerebView>(`/projects/${projectId}/oereb`),
      api.get<GeodataResponse>(`/projects/${projectId}/geodata`),
    ]);
    if (pr.status === "fulfilled") setProject(pr.value);
    if (o.status === "fulfilled") { setOereb(o.value); setOerebError(null); }
    else setOerebError(o.reason instanceof Error ? o.reason.message : "Unbekannter Fehler");
    if (ge.status === "fulfilled") { setGeo(ge.value); setGeoError(null); }
    else setGeoError(ge.reason instanceof Error ? ge.reason.message : "Unbekannter Fehler");
    setLoading(false);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function handleReload() {
    setReloading(true);
    setReloadNote(null);
    const [o, ge] = await Promise.allSettled([
      api.post<OerebView & OerebRefreshExtras & OerebReloadResponse>(`/projects/${projectId}/oereb`, { force: true }),
      api.post<GeodataResponse>(`/projects/${projectId}/geodata`, { force: true }),
    ]);
    const reason = (r: PromiseRejectedResult) => (r.reason instanceof Error && r.reason.message) || "Bitte in einer halben Minute erneut versuchen.";
    const notes: string[] = [];
    if (o.status === "rejected") notes.push(`ÖREB-Auszug nicht neu geladen: ${reason(o)}`);
    if (ge.status === "rejected") notes.push(`Zusatzdaten nicht neu geladen: ${reason(ge)}`);
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
    setProject((prev) => (prev ? { ...prev, bauzone: zone, zone_source: "manual", zone_confidence: null } : prev));
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
  const zoneWarn = lowZone || zone?.zone_confidence === "coarse";

  return (
    <section aria-label="Grundstück" className={`${p.glass} ${g.geoCard} ${attention ? g.geoCardAttention : ""}`}>
      <div className={g.geoPlan} aria-hidden="true" />
      <div className={g.geoLayout}>
        <span className={`${p.iconTile} ${g.geoTile}`} aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" focusable="false">
            <path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8z" />
            <path d="m3.5 12 8.5 4.5 8.5-4.5" />
            <path d="m3.5 16 8.5 4.5 8.5-4.5" />
          </svg>
        </span>
        <div className={g.geoMain}>
          <div className={g.geoTop}>
            <div className={g.geoTitleRow}>
              <h2 className={g.geoTitle}>Grundstück</h2>
              {project?.parcel_number && (
                <span className={p.chip}>Parzelle {project.parcel_number}</span>
              )}
              {egrid && (
                <span className={`${p.chip} ${g.mono}`} title="Eidgenössischer Grundstücksidentifikator">{egrid}</span>
              )}
              {zone?.bauzone && (
                <span className={zoneWarn ? p.chipWarn : p.chip}>
                  Zone {zone.bauzone}{origin ? ` · ${origin}` : ""}
                </span>
              )}
            </div>
            <button type="button" onClick={handleReload} disabled={reloading || loading} className={`${p.btnGhost} ${p.btnSm}`}>
              <svg aria-hidden="true" focusable="false" className={reloading ? "animate-spin" : ""} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {reloading ? "Wird geladen…" : "Neu laden"}
            </button>
          </div>

          <p role="status" aria-live="polite" className={`${g.note} ${reloadNote ? g.noteGap : ""}`}>{reloadNote}</p>

          {loading ? (
            <p className={`${g.note} ${g.noteGap}`}>Wird geladen…</p>
          ) : (
            <>
              <div>
                {oerebError ? (
                  <InfoLine>Der Stand des ÖREB-Auszugs konnte nicht geladen werden. Bitte «Neu laden» versuchen.</InfoLine>
                ) : !status ? (
                  <InfoLine>
                    {project?.parcel_number || egrid
                      ? "Noch kein ÖREB-Auszug. «Neu laden» ruft ihn ab."
                      : "Ohne Parzelle gibt es keinen ÖREB-Auszug. Die Parzelle lässt sich in den Einstellungen wählen."}
                  </InfoLine>
                ) : status !== "ok" ? (
                  <div className={g.block}>
                    <OerebStatusNotice status={status} canton={canton} detail={extract?.status_detail} pdfUrl={pdfUrl} attemptAt={extract?.last_attempt_at ?? extract?.fetched_at} projectId={projectId} isAdmin={isAdmin} hideChoose={!showZoneEditor} />
                  </div>
                ) : (
                  <InfoLine warn={!!staleError}>
                    {staleError
                      ? `Die letzte Aktualisierung ist fehlgeschlagen. Es gilt der ÖREB-Auszug vom ${extractDate ?? "unbekannten Datum"}. Bitte später neu laden.`
                      : `ÖREB-Auszug vom ${extractDate ?? "unbekannten Datum"}.`}
                  </InfoLine>
                )}
              </div>

              {attention && (
                <div className={g.attention}>
                  <p className={g.attentionTitle}>
                    {lowZone ? `Bauzone unsicher, bitte prüfen: ${zone?.bauzone} ist nur ein Vorschlag` : "Bauzone nicht bekannt"}
                  </p>
                  <p className={g.attentionText}>
                    {lowZone
                      ? "Der Auszug lässt keinen sicheren Schluss zu. Die Zone gilt nicht als gesichert, bis sie bestätigt oder korrigiert ist; sie bestimmt, welche Normen geladen werden."
                      : "TraceBuild konnte keine sichere Zone ermitteln. Bitte von Hand eintragen; die Zone bestimmt, welche Normen geladen werden."}
                  </p>
                  {!showZoneEditor ? null : isAdmin ? (
                    <ZoneEditor projectId={projectId} initial={zone?.bauzone ?? ""} onSaved={handleZoneSaved} accent="rgba(251,191,36,0.3)" proposal={lowZone} />
                  ) : (
                    <p className={g.note}>{lowZone ? "Bestätigen oder korrigieren kann die Zone ein Organisations-Admin, hier oder in den Einstellungen." : "Die Zone kann ein Organisations-Admin hier oder in den Einstellungen eintragen."}</p>
                  )}
                </div>
              )}

              <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className={g.expander}>
                <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? "rotate(90deg)" : "none" }}>
                  <path d="M9 5l7 7-7 7" />
                </svg>
                Zusatzdaten und Links
              </button>

              {open && (
                <div className={g.details}>
                  {geoError && !geo ? (
                    <p className={g.note}>Die Zusatzdaten sind zurzeit nicht verfügbar. Bitte später neu laden.</p>
                  ) : geo?.status === "no_location" ? (
                    <p className={g.note}>Ohne Standort gibt es keine Zusatzdaten. Bitte die Parzelle in den Einstellungen über die Suche wählen.</p>
                  ) : geo?.status === "unavailable" && !geo.fetched_at ? (
                    <p className={g.note}>Die Bundesdienste antworten zurzeit nicht. Bitte später neu laden.</p>
                  ) : geo ? (
                    <dl className={g.dl}>
                      <Row label="Höhe">{geo.data.height_m !== null ? `${Math.round(geo.data.height_m).toLocaleString("de-CH")} m ü. M.` : "nicht ermittelt"}</Row>
                      <Row label="ÖV-Güteklasse">{geo.data.oev_class ?? "keine Güteklasse am Referenzpunkt"}</Row>
                      <Row label="ISOS">
                        {geo.data.isos.length === 0 ? "kein ISOS-Perimeter am Referenzpunkt" : geo.data.isos.map((i) => (
                          <span key={i.number} className={g.block1}>
                            {i.url ? <a href={i.url} target="_blank" rel="noreferrer" className={g.link}>{i.name} ↗</a> : i.name}
                            {i.category ? ` (${i.category})` : ""}
                          </span>
                        ))}
                      </Row>
                      <Row label="Gebäude (GWR)">
                        {geo.data.buildings.length === 0 ? "kein Gebäude im GWR erfasst" : geo.data.buildings.map((b) => (
                          <span key={b.egid} className={g.block1}>{buildingLine(b)}</span>
                        ))}
                      </Row>
                    </dl>
                  ) : null}

                  {geo && geo.errors.length > 0 && (
                    <p className={g.smallWarn}>
                      Unvollständig: {geo.errors.map((e) => `${e.source}: ${e.message}`).join(" · ")}. Bei diesen Daten gilt der letzte Stand, falls vorhanden.
                    </p>
                  )}

                  <div className={g.links}>
                    {geo?.links.geoportal && <a href={geo.links.geoportal} target="_blank" rel="noreferrer" className={g.link}>Geoportal des Bundes ↗</a>}
                    {geo?.links.canton_portal && <a href={geo.links.canton_portal} target="_blank" rel="noreferrer" className={g.link}>Kantonales Portal ↗</a>}
                    {pdfUrl && <a href={pdfUrl} target="_blank" rel="noreferrer" className={g.link}>Amtlicher ÖREB-Auszug (PDF) ↗</a>}
                    {!hasLinks && <span className={g.note}>Links erscheinen, sobald das Grundstück bekannt ist.</span>}
                  </div>

                  <p className={g.small}>
                    {geo?.fetched_at ? `Stand ${formatDate(geo.fetched_at)}. ` : ""}
                    {geo?.sources.length ? `Quellen: ${geo.sources.join(", ")}. ` : ""}
                    Ohne Rechtswirkung, der ÖREB-Auszug geht vor.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
