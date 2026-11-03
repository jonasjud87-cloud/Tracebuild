"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { api } from "@/lib/api";
import { normMatchesZone } from "@/lib/zone-match";
import { openNormenblattForPrint, downloadNormenblattCsv, type NormenblattRow } from "@/lib/normenblatt-report";

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

  const meta = {
    projectName: project?.name ?? "",
    canton: project?.location?.canton ?? "",
    municipality: project?.location?.municipality ?? "",
  };

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
            onClick={() => openNormenblattForPrint(meta, rows)}
            disabled={loading || rows.length === 0}
            style={{ ...btn, background: "#2862D7", color: "#fff", opacity: loading || rows.length === 0 ? 0.5 : 1, cursor: loading || rows.length === 0 ? "not-allowed" : "pointer" }}
          >
            PDF-Vorschau
          </button>
          <button
            onClick={() => downloadNormenblattCsv(meta, rows)}
            disabled={loading || rows.length === 0}
            style={{ ...btn, color: "#ABAEBB", border: "1px solid rgba(133,166,233,0.2)", background: "none", opacity: loading || rows.length === 0 ? 0.5 : 1, cursor: loading || rows.length === 0 ? "not-allowed" : "pointer" }}
          >
            Als CSV exportieren
          </button>
        </div>
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
      )}
    </div>
  );
}
