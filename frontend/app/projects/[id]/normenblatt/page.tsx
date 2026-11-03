"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { api } from "@/lib/api";
import { normMatchesZone } from "@/lib/zone-match";
import { CATEGORY_LABELS, type Category } from "@/lib/domains/bau";
import { buildNormenblattPdf, downloadNormenblattCsv, type NormenblattRow, type KennwertRow } from "@/lib/normenblatt-report";

const CARD = {
  background: "rgba(23,37,64,0.55)",
  border: "1px solid rgba(133,166,233,0.18)",
  borderRadius: 14,
};

interface Project {
  id: string;
  name: string;
  location: { canton: string; municipality: string; country?: string };
  parcel_number: string | null;
  bauzone: string | null;
}

interface Norm {
  id: string;
  title: string;
  domain: string;
  layer: number;
  jurisdiction_type: string;
  jurisdiction_name: string | null;
  category: string;
  text: string;
  source_url: string | null;
  source_doc: string | null;
  org_id: string | null;
  zone: string | null;
}

interface ProjectNorm {
  id: string;
  norm_id: string;
  added_by: string;
  added_at: string;
  trigger?: string | null;
  norms: Norm | null;
}

interface OerebThemeWire {
  themeCode?: string; theme_code?: string;
  themeName?: string; theme_name?: string;
}

interface OerebResponse {
  themes: OerebThemeWire[];
}

interface KennwertItem {
  norm_id: string;
  norm_title: string;
  category: Category;
  sentence: string;
}

interface KennwerteResponse {
  items: KennwertItem[];
  model: string | null;
  cost_usd: number | null;
  cached: boolean;
}

// Gruppierung Bund/Kanton/Gemeinde/Spezialnormen — gespiegelt aus app/projects/[id]/norms/page.tsx,
// damit das Normenblatt dieselbe Einteilung wie der Normen-Tab zeigt.
const GROUPS = [
  { label: "Bund", layers: [1, 2] },
  { label: "Kanton", layers: [3] },
  { label: "Gemeinde", layers: [4] },
  { label: "Spezialnormen", layers: [5] },
];

function getGroup(layer: number) {
  return GROUPS.find((g) => g.layers.includes(layer)) ?? GROUPS[GROUPS.length - 1];
}

function triggerCode(pn: ProjectNorm): string | null {
  const t = pn.trigger ?? null;
  return t && t.startsWith("oereb:") ? t.slice("oereb:".length) : null;
}

export default function NormenblattPage({ params }: { params: { id: string } }) {
  const [project, setProject] = useState<Project | null>(null);
  const [projectNorms, setProjectNorms] = useState<ProjectNorm[]>([]);
  const [themeNames, setThemeNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfGenerating, setPdfGenerating] = useState(false);

  const [kennwerte, setKennwerte] = useState<KennwertItem[]>([]);
  const [kennwerteLoading, setKennwerteLoading] = useState(true);
  const [kennwerteError, setKennwerteError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  const loadKennwerte = useCallback(async (force = false) => {
    if (force) setRegenerating(true);
    else setKennwerteLoading(true);
    setKennwerteError(null);
    try {
      const res = force
        ? await api.post<KennwerteResponse>(`/projects/${params.id}/normenblatt/kennwerte`, { force: true })
        : await api.get<KennwerteResponse>(`/projects/${params.id}/normenblatt/kennwerte`);
      setKennwerte(res?.items ?? []);
    } catch (e) {
      setKennwerteError(e instanceof Error ? e.message : "Kennwerte konnten nicht geladen werden.");
    } finally {
      setKennwerteLoading(false);
      setRegenerating(false);
    }
  }, [params.id]);

  useEffect(() => { loadKennwerte(); }, [loadKennwerte]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [proj, norms] = await Promise.all([
        api.get<Project>(`/projects/${params.id}`),
        api.get<ProjectNorm[]>(`/projects/${params.id}/norms`),
      ]);
      setProject(proj);
      setProjectNorms(norms ?? []);
    } catch {
      /* leerer Zustand */
    }
    try {
      const oereb = await api.get<OerebResponse>(`/projects/${params.id}/oereb`);
      const map = new Map<string, string>();
      for (const t of oereb?.themes ?? []) {
        const code = t.themeCode ?? t.theme_code;
        const name = t.themeName ?? t.theme_name;
        if (code && name) map.set(code, name);
      }
      setThemeNames(map);
    } catch {
      /* ÖREB optional für das Normenblatt */
    }
    setLoading(false);
  }, [params.id]);

  useEffect(() => { load(); }, [load]);

  const rows: NormenblattRow[] = useMemo(() => {
    return projectNorms
      .filter((pn) => pn.norms !== null && normMatchesZone(pn.norms!.zone, project?.bauzone))
      .map((pn) => {
        const norm = pn.norms!;
        const group = getGroup(norm.layer).label;
        const source = norm.jurisdiction_name ?? group;
        const referenceUrl = norm.source_url ?? null;
        const referenceLabel = norm.source_url ?? norm.source_doc ?? norm.category;

        const code = triggerCode(pn);
        const relevance = code
          ? `ÖREB: ${themeNames.get(code) ?? code}`
          : pn.added_by === "user"
            ? "Manuell hinzugefügt"
            : "Automatisch zugewiesen (Zone/Domäne)";

        return { group, title: norm.title, source, referenceUrl, referenceLabel, relevance };
      })
      .sort((a, b) => {
        const ia = GROUPS.findIndex((g) => g.label === a.group);
        const ib = GROUPS.findIndex((g) => g.label === b.group);
        return ia !== ib ? ia - ib : a.title.localeCompare(b.title, "de");
      });
  }, [projectNorms, themeNames]);

  const meta = useMemo(() => ({
    projectName: project?.name ?? "",
    canton: project?.location?.canton ?? "",
    municipality: project?.location?.municipality ?? "",
  }), [project]);

  // norm_id → Titel/Link der zonengefilterten Normen, damit jeder Kennwert auf
  // seine Quellnorm zurückverweisen kann.
  const normMetaById = useMemo(() => {
    const map = new Map<string, { title: string; referenceUrl: string | null }>();
    for (const pn of projectNorms) {
      const norm = pn.norms;
      if (!norm || !normMatchesZone(norm.zone, project?.bauzone)) continue;
      map.set(norm.id, { title: norm.title, referenceUrl: norm.source_url ?? null });
    }
    return map;
  }, [projectNorms, project?.bauzone]);

  const kennwerteRows: KennwertRow[] = useMemo(() => {
    return kennwerte
      .map((k) => {
        const metaForNorm = normMetaById.get(k.norm_id);
        return {
          category: CATEGORY_LABELS[k.category] ?? k.category,
          sentence: k.sentence,
          normTitle: metaForNorm?.title ?? k.norm_title,
          referenceUrl: metaForNorm?.referenceUrl ?? null,
        };
      })
      .sort((a, b) => a.category.localeCompare(b.category, "de") || a.normTitle.localeCompare(b.normTitle, "de"));
  }, [kennwerte, normMetaById]);

  const kennwerteByCategory = useMemo(() => {
    const byCat = new Map<string, KennwertRow[]>();
    for (const r of kennwerteRows) {
      if (!byCat.has(r.category)) byCat.set(r.category, []);
      byCat.get(r.category)!.push(r);
    }
    return byCat;
  }, [kennwerteRows]);

  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);

  useEffect(() => {
    if (loading || rows.length === 0) { setPdfBlob(null); return; }
    let cancelled = false;
    setPdfGenerating(true);
    buildNormenblattPdf(meta, rows, kennwerteRows).then((blob) => {
      if (!cancelled) { setPdfBlob(blob); setPdfGenerating(false); }
    }).catch(() => {
      if (!cancelled) setPdfGenerating(false);
    });
    return () => { cancelled = true; };
  }, [meta, rows, kennwerteRows, loading]);

  useEffect(() => {
    if (!pdfBlob) return;
    const url = URL.createObjectURL(pdfBlob);
    setPdfUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pdfBlob]);

  const downloadPdf = useCallback(() => {
    if (!pdfBlob) return;
    const url = URL.createObjectURL(pdfBlob);
    const a = document.createElement("a");
    const safe = (s: string) => s.replace(/[^\w.-]+/g, "_");
    a.href = url;
    a.download = `Normenblatt_${safe(meta.projectName)}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [pdfBlob, meta.projectName]);

  const btn: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 8,
    fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, gap: 16 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#fff", margin: "0 0 4px" }}>Normenblatt</h2>
          {project && (
            <span style={{ fontSize: 13, color: "#ABAEBB" }}>
              {project.location.municipality}, Kanton {project.location.canton}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <button
            onClick={downloadPdf}
            disabled={loading || rows.length === 0 || !pdfBlob}
            style={{ ...btn, background: "#2862D7", color: "#fff", opacity: loading || rows.length === 0 || !pdfBlob ? 0.5 : 1, cursor: loading || rows.length === 0 || !pdfBlob ? "not-allowed" : "pointer" }}
          >
            PDF herunterladen
          </button>
          <button
            onClick={() => downloadNormenblattCsv(meta, rows, kennwerteRows)}
            disabled={loading || rows.length === 0}
            style={{ ...btn, color: "#ABAEBB", border: "1px solid rgba(133,166,233,0.2)", background: "none", opacity: loading || rows.length === 0 ? 0.5 : 1, cursor: loading || rows.length === 0 ? "not-allowed" : "pointer" }}
          >
            Als CSV exportieren
          </button>
          <button
            onClick={() => loadKennwerte(true)}
            disabled={regenerating || kennwerteLoading || rows.length === 0}
            style={{ ...btn, color: "#ABAEBB", border: "1px solid rgba(133,166,233,0.2)", background: "none", opacity: regenerating || kennwerteLoading || rows.length === 0 ? 0.5 : 1, cursor: regenerating || kennwerteLoading || rows.length === 0 ? "not-allowed" : "pointer" }}
            title="Kennwerte neu aus den Normtexten extrahieren (löst einen neuen KI-Aufruf aus)"
          >
            {regenerating ? "Wird neu generiert…" : "Kennwerte neu generieren"}
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: "#fff", margin: "0 0 10px" }}>Geltende Werte</h3>
        {kennwerteLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[...Array(2)].map((_, i) => (
              <div key={i} className="animate-pulse" style={{ background: "rgba(23,37,64,0.55)", border: "1px solid rgba(133,166,233,0.1)", borderRadius: 12, padding: 16 }}>
                <div style={{ height: 10, background: "rgba(133,166,233,0.1)", borderRadius: 4, width: "22%", marginBottom: 8 }} />
                <div style={{ height: 10, background: "rgba(133,166,233,0.07)", borderRadius: 4, width: "80%" }} />
              </div>
            ))}
          </div>
        ) : kennwerteError ? (
          <div style={{ background: "rgba(23,37,64,0.55)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 12, padding: 16 }}>
            <p style={{ fontSize: 13, color: "#f87171", margin: 0 }}>{kennwerteError}</p>
          </div>
        ) : kennwerteByCategory.size === 0 ? (
          <div style={{ background: "rgba(23,37,64,0.55)", border: "1px solid rgba(133,166,233,0.1)", borderRadius: 12, padding: 16 }}>
            <p style={{ fontSize: 13, color: "#7B8299", margin: 0 }}>Keine konkreten Kennwerte aus den zugewiesenen Normen extrahiert.</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {Array.from(kennwerteByCategory.entries()).map(([category, items]) => (
              <div key={category} style={{ ...CARD, padding: 16 }}>
                <h4 style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#7B8299", margin: "0 0 10px" }}>{category}</h4>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {items.map((it, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
                      <p style={{ fontSize: 13, color: "#fff", margin: 0, flex: 1 }}>{it.sentence}</p>
                      {it.referenceUrl ? (
                        <a href={it.referenceUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#85A6E9", textDecoration: "none", whiteSpace: "nowrap" }}>
                          {it.normTitle}
                        </a>
                      ) : (
                        <span style={{ fontSize: 12, color: "#7B8299", whiteSpace: "nowrap" }}>{it.normTitle}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[...Array(5)].map((_, i) => (
            <div key={i} className="animate-pulse" style={{ background: "rgba(23,37,64,0.55)", border: "1px solid rgba(133,166,233,0.1)", borderRadius: 12, padding: 16 }}>
              <div style={{ height: 10, background: "rgba(133,166,233,0.1)", borderRadius: 4, width: "28%", marginBottom: 8 }} />
              <div style={{ height: 10, background: "rgba(133,166,233,0.07)", borderRadius: 4, width: "72%" }} />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div style={{ background: "rgba(23,37,64,0.55)", border: "1px solid rgba(133,166,233,0.1)", borderRadius: 16, padding: "64px 24px", textAlign: "center" }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: "#ABAEBB", margin: 0 }}>Noch keine Normen zugewiesen</p>
          <p style={{ fontSize: 12, color: "#7B8299", margin: "4px 0 0" }}>
            Normen werden im Tab «Normen» geladen oder manuell hinzugefügt.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
          <div style={{ flex: "1 1 480px", minWidth: 320, position: "sticky", top: 20 }}>
            <div style={{ ...CARD, height: 720, overflow: "hidden", display: "flex", flexDirection: "column", position: "relative" }}>
              <div style={{ padding: "10px 16px", borderBottom: "1px solid rgba(133,166,233,0.1)", display: "flex", alignItems: "center", gap: 8 }}>
                <svg style={{ width: 14, height: 14, color: "#7B8299", flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#ABAEBB", flexShrink: 0 }}>Normenblatt-Vorschau</span>
              </div>
              {pdfUrl ? (
                <iframe
                  key={pdfUrl}
                  src={pdfUrl}
                  title="Normenblatt-Vorschau"
                  style={{ flex: 1, width: "100%", border: "none", background: "#0E111B" }}
                />
              ) : (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <p style={{ fontSize: 13, color: "#7B8299", textAlign: "center", padding: "0 24px" }}>
                    {pdfGenerating ? "PDF wird erstellt…" : "Keine Vorschau verfügbar."}
                  </p>
                </div>
              )}
              {pdfGenerating && pdfUrl && (
                <div style={{ position: "absolute", inset: 0, top: 41, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(14,17,27,0.6)" }}>
                  <div style={{ width: 22, height: 22, border: "2px solid #2862D7", borderTopColor: "transparent", borderRadius: "50%", animation: "spin .7s linear infinite" }} />
                </div>
              )}
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          </div>

          <div style={{ flex: "1 1 420px", minWidth: 320 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "#fff", margin: "0 0 10px" }}>Quellennormen</h3>
          <div style={{ background: "rgba(23,37,64,0.55)", border: "1px solid rgba(133,166,233,0.1)", borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                {["Bezeichnung", "Quelle", "Referenz", "Relevanz"].map((h) => (
                  <th key={h} style={{ textAlign: "left", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "#7B8299", borderBottom: "1px solid rgba(133,166,233,0.15)", padding: "10px 14px" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid rgba(133,166,233,0.08)", color: "#fff", fontWeight: 600, verticalAlign: "top" }}>{r.title}</td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid rgba(133,166,233,0.08)", color: "#ABAEBB", verticalAlign: "top" }}>{r.source}</td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid rgba(133,166,233,0.08)", color: "#ABAEBB", verticalAlign: "top" }}>
                    {r.referenceUrl ? (
                      <a href={r.referenceUrl} target="_blank" rel="noreferrer" style={{ color: "#85A6E9", textDecoration: "none" }}>
                        {r.referenceLabel}
                      </a>
                    ) : (
                      r.referenceLabel
                    )}
                  </td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid rgba(133,166,233,0.08)", color: "#ABAEBB", verticalAlign: "top" }}>{r.relevance}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
