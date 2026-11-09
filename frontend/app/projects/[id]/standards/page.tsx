"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import p from "@/app/projects/project.module.css";
import ProjectBanner from "@/components/project/ProjectBanner";
import n from "../norms/norms.module.css";
import { Ico, ICON } from "../norms/ProjIcon";

interface Project {
  id: string;
  name: string;
  location: { canton: string; municipality: string };
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
  /** Die Liste liefert nur den Anfang langer Texte. */
  text_truncated?: boolean;
  source_url: string | null;
  source_doc: string | null;
  org_id: string | null;
}

interface ProjectNorm {
  id: string;
  project_id: string;
  norm_id: string;
  added_by: string;
  added_at: string;
  norms: Norm | null;
}

const LAYER_LABELS: Record<number, string> = {
  1: "International / National",
  2: "National",
  3: "Kantonal",
  4: "Kommunal",
  5: "Organisation",
};

const LAYER_COLORS: Record<number, { chip: string; dot: string }> = {
  1: { chip: p.chipNavy, dot: "#ffffff" },
  2: { chip: p.chipInfo, dot: "var(--info)" },
  3: { chip: p.chipSand, dot: "var(--bronze)" },
  4: { chip: p.chipOk, dot: "var(--ok)" },
  5: { chip: p.chip, dot: "var(--muted)" },
};

function NormCard({ pn, onRemove }: { pn: ProjectNorm; onRemove: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [fullText, setFullText] = useState<string | null>(null);
  const norm = pn.norms;
  // Die Liste liefert nur den Anfang langer Texte.
  useEffect(() => {
    if (!expanded || !norm?.text_truncated || fullText !== null) return;
    api.get<{ text: string }>(`/standards/${norm.id}`).then((res) => setFullText(res.text)).catch(() => {});
  }, [expanded, norm?.id, norm?.text_truncated, fullText]);
  if (!norm) return null;
  const layer = norm.layer ?? 3;
  const cfg = LAYER_COLORS[layer] ?? LAYER_COLORS[3];

  return (
    <div className={n.norm}>
      <div className={n.normHead}>
        <span className={n.dot} style={{ background: cfg.dot }} aria-hidden="true" />
        <div className={n.normMain}>
          <div className={n.chips}>
            <span className={cfg.chip}>{norm.jurisdiction_name ?? LAYER_LABELS[layer] ?? "—"}</span>
            <span className={p.chip}>{norm.category}</span>
            {pn.added_by === "system" && <span className={n.note}>auto</span>}
          </div>
          <p className={n.normTitle}>{norm.title}</p>
          {expanded && <p className={n.normText}>{fullText ?? norm.text}</p>}
          {norm.source_url && expanded && (
            <div className={n.normSource}>
              <a href={norm.source_url} target="_blank" rel="noreferrer" className={n.link}>
                Quelle →
              </a>
            </div>
          )}
        </div>
        <div className={n.normActions}>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className={n.iconBtn}
            title={expanded ? "Einklappen" : "Ausklappen"}
            aria-label={expanded ? "Einklappen" : "Ausklappen"}
            aria-expanded={expanded}
          >
            <Ico d={ICON.chevDown} size={16} strokeWidth={2.2} className={`${n.chev} ${expanded ? n.chevOpen : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => onRemove(norm.id)}
            className={`${n.iconBtn} ${n.iconBtnDanger}`}
            title="Norm entfernen"
            aria-label="Norm entfernen"
          >
            <Ico d={ICON.x} size={16} strokeWidth={2.2} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function NormenPage({ params }: { params: { id: string } }) {
  const [project, setProject] = useState<Project | null>(null);
  const [projectNorms, setProjectNorms] = useState<ProjectNorm[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filterLayer, setFilterLayer] = useState<number | "">("");

  const load = useCallback(async () => {
    const [proj, norms] = await Promise.all([
      api.get<Project>(`/projects/${params.id}`),
      api.get<ProjectNorm[]>(`/projects/${params.id}/norms`),
    ]);
    setProject(proj);
    setProjectNorms(norms ?? []);
    setLoading(false);
  }, [params.id]);

  useEffect(() => { load(); }, [load]);

  async function handleRemove(normId: string) {
    await api.delete(`/projects/${params.id}/norms`, { norm_id: normId });
    setProjectNorms((prev) => prev.filter((pn) => pn.norms?.id !== normId));
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      // Re-trigger automatic norm assignment via project re-creation is not
      // an option, so we just reload from DB after a short wait.
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  const validNorms = projectNorms.filter((pn) => pn.norms !== null);
  const layers = Array.from(new Set(validNorms.map((pn) => pn.norms!.layer))).sort();
  const filtered = filterLayer !== ""
    ? validNorms.filter((pn) => pn.norms?.layer === filterLayer)
    : validNorms;

  // Group by layer
  const byLayer: Record<number, ProjectNorm[]> = {};
  filtered.forEach((pn) => {
    const l = pn.norms!.layer;
    if (!byLayer[l]) byLayer[l] = [];
    byLayer[l].push(pn);
  });

  const bannerActions = (
    <>
      {layers.length > 1 && (
        <select
          value={filterLayer}
          onChange={(e) => setFilterLayer(e.target.value === "" ? "" : Number(e.target.value))}
          aria-label="Nach Ebene filtern"
          className={p.select}
          style={{ width: "auto", minWidth: 190 }}
        >
          <option value="">Alle Ebenen</option>
          {layers.map((l) => (
            <option key={l} value={l}>{LAYER_LABELS[l] ?? `Layer ${l}`}</option>
          ))}
        </select>
      )}
      <button type="button" onClick={handleRefresh} disabled={refreshing} className={p.btnSand}>
        <Ico d={ICON.refresh} size={16} className={refreshing ? "motion-safe:animate-spin" : undefined} />
        Aktualisieren
      </button>
    </>
  );

  const subtitle = loading
    ? undefined
    : [
        project ? `${project.location.municipality}, Kanton ${project.location.canton}` : null,
        `${validNorms.length} ${validNorms.length === 1 ? "Norm" : "Normen"}`,
      ].filter(Boolean).join(" · ");

  return (
    <div className={n.page}>
      <ProjectBanner title="Geltende Normen" subtitle={subtitle} actions={bannerActions} />

      {project && (project.parcel_number || project.bauzone) && (
        <div className={n.chips}>
          {project.parcel_number && <span className={p.chip}>Parzelle {project.parcel_number}</span>}
          {project.bauzone && <span className={p.chipSand}>Zone {project.bauzone}</span>}
        </div>
      )}

      {loading ? (
        <section className={p.glass} aria-hidden="true">
          {[...Array(4)].map((_, i) => (
            <div key={i} className={n.skelRow}>
              <span className={`${p.skeleton} motion-safe:animate-pulse`} style={{ width: "26%" }} />
              <span className={`${p.skeleton} motion-safe:animate-pulse`} style={{ width: "72%" }} />
            </div>
          ))}
        </section>
      ) : filtered.length === 0 ? (
        <section className={`${p.glass} ${n.empty}`}>
          <span className={`${p.iconTile} ${n.emptyTile}`}><Ico d={ICON.doc} size={24} strokeWidth={1.6} /></span>
          <p className={n.emptyTitle}>Noch keine Normen zugewiesen</p>
          <p className={n.emptyText}>
            Normen werden beim Erstellen des Projekts automatisch geladen.
          </p>
        </section>
      ) : (
        <div className={n.stack}>
          {Object.keys(byLayer)
            .map(Number)
            .sort()
            .map((layer) => {
              const cfg = LAYER_COLORS[layer] ?? LAYER_COLORS[3];
              return (
                <section key={layer} className={p.glass}>
                  <div className={p.sectionHead}>
                    <h2 className={n.sectionHeadTitle}>
                      <span className={n.dot} style={{ background: cfg.dot, marginTop: 0 }} aria-hidden="true" />
                      <span className={p.sectionTitle}>{LAYER_LABELS[layer] ?? `Layer ${layer}`}</span>
                      <span className={p.chip}>{byLayer[layer].length}</span>
                    </h2>
                  </div>
                  {byLayer[layer].map((pn) => (
                    <NormCard key={pn.id} pn={pn} onRemove={handleRemove} />
                  ))}
                </section>
              );
            })}
        </div>
      )}
    </div>
  );
}
