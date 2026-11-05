"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";

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

const LAYER_COLORS: Record<number, { bg: string; text: string; border: string; dot: string }> = {
  1: { bg: "bg-sky-50",     text: "text-sky-700",    border: "border-sky-100",   dot: "bg-sky-400" },
  2: { bg: "bg-violet-50",  text: "text-violet-700", border: "border-violet-100",dot: "bg-violet-400" },
  3: { bg: "bg-[#f3ece3]",  text: "text-[#8b6344]",  border: "border-[#e8d9c5]", dot: "bg-[#B7926A]" },
  4: { bg: "bg-emerald-50", text: "text-emerald-700",border: "border-emerald-100",dot:"bg-emerald-400" },
  5: { bg: "bg-stone-50",   text: "text-stone-600",  border: "border-stone-200", dot: "bg-stone-400" },
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
    <div className={`bg-white border ${cfg.border} rounded-xl p-4 transition-all`}>
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.bg} ${cfg.text}`}>
              {norm.jurisdiction_name ?? LAYER_LABELS[layer] ?? "—"}
            </span>
            <span className="text-xs bg-stone-100 text-stone-500 px-2 py-0.5 rounded-full">
              {norm.category}
            </span>
            {pn.added_by === "system" && (
              <span className="text-xs text-stone-300">auto</span>
            )}
          </div>
          <p className="text-sm font-medium text-stone-800 leading-snug">{norm.title}</p>
          {expanded && (
            <p className="mt-2 text-sm text-stone-600 leading-relaxed">{fullText ?? norm.text}</p>
          )}
          {norm.source_url && expanded && (
            <a
              href={norm.source_url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block text-xs text-[#B7926A] hover:underline"
            >
              Quelle →
            </a>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="p-1.5 rounded-lg text-stone-300 hover:text-stone-500 hover:bg-stone-50 transition-colors"
            title={expanded ? "Einklappen" : "Ausklappen"}
          >
            <svg className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <button
            onClick={() => onRemove(norm.id)}
            className="p-1.5 rounded-lg text-stone-200 hover:text-red-400 hover:bg-red-50 transition-colors"
            title="Norm entfernen"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
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

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-base font-semibold text-stone-800">Geltende Normen</h2>
          {project && (
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <p className="text-sm text-stone-500">
                {project.location.municipality}, Kanton {project.location.canton}
              </p>
              {project.parcel_number && (
                <span className="text-xs bg-stone-100 text-stone-500 px-2 py-0.5 rounded-full">
                  Parzelle {project.parcel_number}
                </span>
              )}
              {project.bauzone && (
                <span className="text-xs bg-[#f3ece3] text-[#8b6344] px-2 py-0.5 rounded-full font-medium">
                  Zone {project.bauzone}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {layers.length > 1 && (
            <select
              value={filterLayer}
              onChange={(e) => setFilterLayer(e.target.value === "" ? "" : Number(e.target.value))}
              className="border border-stone-200 rounded-lg px-3 py-1.5 text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-[#B7926A]/30 focus:border-[#B7926A] bg-white"
            >
              <option value="">Alle Ebenen</option>
              {layers.map((l) => (
                <option key={l} value={l}>{LAYER_LABELS[l] ?? `Layer ${l}`}</option>
              ))}
            </select>
          )}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-stone-500 border border-stone-200 hover:bg-stone-50 disabled:opacity-40 transition-colors"
          >
            <svg className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Aktualisieren
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-white border border-[#e7e2d9] rounded-xl p-4 animate-pulse">
              <div className="h-3 bg-stone-100 rounded w-1/4 mb-2" />
              <div className="h-3 bg-stone-100 rounded w-3/4" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-[#e7e2d9] rounded-xl p-16 text-center">
          <div className="w-10 h-10 bg-[#f3ece3] rounded-xl flex items-center justify-center mx-auto mb-3">
            <svg className="w-5 h-5 text-[#B7926A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <p className="text-stone-500 text-sm font-medium">Noch keine Normen zugewiesen</p>
          <p className="text-stone-400 text-xs mt-1">
            Normen werden beim Erstellen des Projekts automatisch geladen.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.keys(byLayer)
            .map(Number)
            .sort()
            .map((layer) => {
              const cfg = LAYER_COLORS[layer] ?? LAYER_COLORS[3];
              return (
                <div key={layer}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                    <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
                      {LAYER_LABELS[layer] ?? `Layer ${layer}`}
                    </h3>
                    <span className="text-xs text-stone-300">{byLayer[layer].length}</span>
                  </div>
                  <div className="space-y-2">
                    {byLayer[layer].map((pn) => (
                      <NormCard key={pn.id} pn={pn} onRemove={handleRemove} />
                    ))}
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
