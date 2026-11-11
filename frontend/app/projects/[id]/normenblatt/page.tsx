"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { api } from "@/lib/api";
import { normMatchesZone } from "@/lib/zone-match";
import { CATEGORY_LABELS, type Category } from "@/lib/domains/bau";
import ProjectBanner from "@/components/project/ProjectBanner";
import p from "@/app/projects/project.module.css";
import s from "./normenblatt.module.css";
import { buildNormenblattPdf, downloadNormenblattCsv, type NormenblattRow, type KennwertRow } from "@/lib/normenblatt-report";
import { cantonLabel } from "@/lib/oereb/cantons";

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

  const exportDisabled = loading || rows.length === 0;

  return (
    <>
      <ProjectBanner
        variant="normenblatt"
        title="Normenblatt"
        subtitle={project ? `${project.location.municipality}, ${cantonLabel(project.location.canton)}` : undefined}
        actions={
          <>
            <button
              type="button"
              onClick={downloadPdf}
              disabled={exportDisabled || !pdfBlob}
              className={p.btnSand}
            >
              PDF herunterladen
            </button>
            <button
              type="button"
              onClick={() => downloadNormenblattCsv(meta, rows, kennwerteRows)}
              disabled={exportDisabled}
              className={p.btnGhost}
            >
              Als CSV exportieren
            </button>
            <button
              type="button"
              onClick={() => loadKennwerte(true)}
              disabled={regenerating || kennwerteLoading || rows.length === 0}
              className={p.btnGhost}
              title="Kennwerte neu aus den Normtexten extrahieren (löst einen neuen KI-Aufruf aus)"
            >
              {regenerating ? "Wird neu generiert…" : "Kennwerte neu generieren"}
            </button>
          </>
        }
      />

      <section className={s.section} aria-labelledby="nb-werte">
        <h2 id="nb-werte" className={`${p.sectionTitle} ${s.sectionHeading}`}>Geltende Werte</h2>
        {kennwerteLoading ? (
          <div className={s.stack} role="status" aria-label="Kennwerte werden geladen">
            {[...Array(2)].map((_, i) => (
              <div key={i} className={`${p.glassFlat} ${s.skelCard}`}>
                <span className={p.skeleton} style={{ width: "22%" }} />
                <span className={p.skeleton} style={{ width: "80%" }} />
              </div>
            ))}
          </div>
        ) : kennwerteError ? (
          <div className={`${p.glassFlat} ${s.msgCard} ${s.errCard}`} role="alert">
            <p className={s.msgErr}>{kennwerteError}</p>
          </div>
        ) : kennwerteByCategory.size === 0 ? (
          <div className={`${p.glassFlat} ${s.msgCard}`}>
            <p className={s.msgText}>Keine konkreten Kennwerte aus den zugewiesenen Normen extrahiert.</p>
          </div>
        ) : (
          <div className={s.stack}>
            {Array.from(kennwerteByCategory.entries()).map(([category, items]) => (
              <div key={category} className={`${p.glassFlat} ${s.catCard}`}>
                <h3 className={s.catHead}><span className={p.chipSand}>{category}</span></h3>
                <div>
                  {items.map((it, i) => (
                    <div key={i} className={s.kennRow}>
                      <p className={s.kennText}>{it.sentence}</p>
                      {it.referenceUrl ? (
                        <a href={it.referenceUrl} target="_blank" rel="noreferrer" className={s.refLink}>
                          {it.normTitle}
                        </a>
                      ) : (
                        <span className={s.refPlain}>{it.normTitle}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {loading ? (
        <div className={s.stack} role="status" aria-label="Normen werden geladen">
          {[...Array(5)].map((_, i) => (
            <div key={i} className={`${p.glassFlat} ${s.skelCard}`}>
              <span className={p.skeleton} style={{ width: "28%" }} />
              <span className={p.skeleton} style={{ width: "72%" }} />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className={`${p.glassFlat} ${s.empty}`}>
          <span className={p.iconTile}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <rect x="4.5" y="3.5" width="15" height="17" rx="3" /><path d="M8 9h8M8 13h8M8 17h4" />
            </svg>
          </span>
          <p className={s.emptyTitle}>Noch keine Normen zugewiesen</p>
          <p className={s.emptySub}>
            Normen werden im Tab «Normen» geladen oder manuell hinzugefügt.
          </p>
        </div>
      ) : (
        <div className={s.split}>
          <div className={s.previewWrap}>
            <div className={`${p.glassFlat} ${s.preview}`}>
              <div className={s.previewHead}>
                <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false" style={{ flexShrink: 0 }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <h2 className={s.previewTitle}>Normenblatt-Vorschau</h2>
              </div>
              {pdfUrl ? (
                <iframe
                  key={pdfUrl}
                  src={pdfUrl}
                  title="Normenblatt-Vorschau"
                  className={s.frame}
                />
              ) : (
                <div className={s.previewEmpty}>
                  <p role="status">
                    {pdfGenerating ? "PDF wird erstellt…" : "Keine Vorschau verfügbar."}
                  </p>
                </div>
              )}
              {pdfGenerating && pdfUrl && (
                <div className={s.overlay} role="status" aria-label="PDF wird erstellt">
                  <span className={s.spinner} />
                </div>
              )}
            </div>
          </div>

          <div style={{ minWidth: 0 }}>
            <h2 className={`${p.sectionTitle} ${s.tableHead}`}>Quellennormen</h2>
            <div className={`${p.glassFlat} ${p.tableWrap}`}>
              <table className={`${p.table} ${s.srcTable}`}>
                <thead>
                  <tr>
                    {["Bezeichnung", "Quelle", "Referenz", "Relevanz"].map((h) => (
                      <th key={h} scope="col" className={p.th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td className={`${p.td} ${s.titleCell}`}>{r.title}</td>
                      <td className={p.td}>{r.source}</td>
                      <td className={p.td}>
                        {r.referenceUrl ? (
                          <a href={r.referenceUrl} target="_blank" rel="noreferrer" className={s.tdLink}>
                            {r.referenceLabel}
                          </a>
                        ) : (
                          r.referenceLabel
                        )}
                      </td>
                      <td className={p.td}>
                        <span className={`${r.relevance.startsWith("ÖREB") ? p.chipInfo : r.relevance === "Manuell hinzugefügt" ? p.chipSand : p.chip} ${s.relChip}`}>
                          {r.relevance}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
