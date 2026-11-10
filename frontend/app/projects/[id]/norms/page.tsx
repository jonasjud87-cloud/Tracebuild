"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { normMatchesZone } from "@/lib/zone-match";
import { isOerebSupportedCanton } from "@/lib/oereb/cantons";
import { isFederalTheme } from "@/lib/oereb/mapping";
import type { ExtractStatus } from "@/lib/geoadmin/contract";
import OerebStatusNotice from "@/components/OerebStatusNotice";
import OerebDocumentsPanel from "@/components/OerebDocumentsPanel";
import ZoneEditor from "@/components/ZoneEditor";
import NormText from "@/components/norm-text/NormText";
import { safeHref } from "@/lib/norm-structure";
import { useOerebSync } from "@/components/useOerebDocumentSync";
import { useOrgRole } from "@/components/useOrgRole";
import { oerebReloadNote, zoneNeedsAttention } from "@/components/geoportal-logic";
import type { KenndatenBlatt } from "@/lib/kenndaten";
import p from "@/app/projects/project.module.css";
import ProjectBanner from "@/components/project/ProjectBanner";
import n from "./norms.module.css";
import { Ico, ICON } from "./ProjIcon";

interface Project {
  id: string;
  name: string;
  location: { canton: string; municipality: string; country: string };
  parcel_number: string | null;
  bauzone: string | null;
  zone_source?: "oereb" | "manual" | null;
  zone_confidence?: "exact" | "coarse" | "low" | null;
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
  // Erst nach der Geoportal-Migration vorhanden.
  source_kind?: string | null;
  text_truncated?: boolean;
  source_checked_at?: string | null;
  pdf_url?: string | null;
  auto_scope?: string | null;
}

interface ProjectNorm {
  id: string;
  norm_id: string;
  added_by: string;
  added_at: string;
  trigger?: string | null;
  norms: Norm | null;
}

// ── ÖREB (Vertrag GET/POST /projects/{id}/oereb) ─────────────────────────────

type Concern = "affects" | "not_affects" | "no_data";
type LegalStatus = "inForce" | "changeWithPreEffect" | "changeWithoutPreEffect" | "unknown";

interface OerebThemeRow {
  themeCode: string;
  themeName: string;
  subTheme: string | null;
  concern: Concern;
  legalStatus: LegalStatus;
  areaPct: number | null;
  areaM2: number | null;
  legendText: string | null;
  lawLinks: { title: string; url: string | null }[];
  authority: { name: string | null; url: string | null } | null;
}

/** Themenzeile, wie die Route sie liefert: entweder camelCase (Vertrag) oder snake_case (oereb_themes 1:1). */
type OerebThemeWire = Partial<OerebThemeRow> & {
  theme_code?: string; theme_name?: string; sub_theme?: string | null; legal_status?: string | null;
  area_pct?: number | string | null; area_m2?: number | string | null; legend_text?: string | null;
  law_links?: unknown; authority?: unknown;
};

interface OerebResponse {
  extract: { status: ExtractStatus | null; status_detail: string | null; egrid: string | null; fetched_at: string | null; last_attempt_at?: string | null; last_error?: string | null } | null;
  themes: OerebThemeWire[];
  gaps: { themeCode: string; themeName: string }[];
  zone: { bauzone: string | null; zone_source: "oereb" | "manual" | null; zone_confidence: "exact" | "coarse" | "low" | null } | null;
  oereb_pdf_url?: string | null;
  documents_pending?: number;
  used_stale?: boolean;
  stale_fetched_at?: string | null;
  /** POST: Zuweisungszähler (Vertrag: `assigned`; Route: `oereb_assigned` + `assigned_norms_count`). */
  assigned?: number;
  oereb_assigned?: number;
  assigned_norms_count?: number;
  fetched?: boolean;
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeTheme(w: OerebThemeWire): OerebThemeRow | null {
  const themeCode = w.themeCode ?? w.theme_code ?? "";
  if (!themeCode) return null;
  const concern = (w.concern ?? "no_data") as Concern;
  const ls = (w.legalStatus ?? w.legal_status ?? "unknown") as string;
  const legalStatus: LegalStatus = (["inForce", "changeWithPreEffect", "changeWithoutPreEffect"] as string[]).includes(ls) ? (ls as LegalStatus) : "unknown";
  const rawLinks = w.lawLinks ?? w.law_links;
  const lawLinks = Array.isArray(rawLinks)
    ? (rawLinks as { title?: unknown; url?: unknown }[]).map((l) => ({ title: typeof l?.title === "string" ? l.title : "", url: typeof l?.url === "string" ? l.url : null }))
    : [];
  const rawAuth = w.authority as { name?: unknown; url?: unknown } | null | undefined;
  const authority = rawAuth && typeof rawAuth === "object"
    ? { name: typeof rawAuth.name === "string" ? rawAuth.name : null, url: typeof rawAuth.url === "string" ? rawAuth.url : null }
    : null;
  return {
    themeCode,
    themeName: w.themeName ?? w.theme_name ?? themeCode,
    subTheme: w.subTheme ?? w.sub_theme ?? null,
    concern: (["affects", "not_affects", "no_data"] as string[]).includes(concern) ? concern : "no_data",
    legalStatus,
    areaPct: toNumber(w.areaPct ?? w.area_pct),
    areaM2: toNumber(w.areaM2 ?? w.area_m2),
    legendText: w.legendText ?? w.legend_text ?? null,
    lawLinks,
    authority,
  };
}

interface ThemeGroup {
  themeCode: string;
  themeName: string;
  rows: OerebThemeRow[];
  norms: ProjectNorm[];
}

const GROUPS = [
  { label: "Bund",          layers: [1, 2], dot: "#151414",      chip: p.chipNavy },
  { label: "Kanton",        layers: [3],    dot: "var(--info)",   chip: p.chipInfo },
  { label: "Gemeinde",      layers: [4],    dot: "var(--ok)",     chip: p.chipOk },
  { label: "Spezialnormen", layers: [5],    dot: "var(--bronze)", chip: p.chipSand },
];

const OEREB_STYLE = { dot: "var(--sand-2)", chip: p.chipSand };

const LEGAL_STATUS: Record<LegalStatus, { label: string; chip: string }> = {
  inForce:                { label: "rechtskräftig",             chip: p.chipOk },
  changeWithPreEffect:    { label: "Änderung mit Vorwirkung",   chip: p.chipWarn },
  changeWithoutPreEffect: { label: "Änderung ohne Vorwirkung",  chip: p.chipInfo },
  unknown:                { label: "Status unbekannt",          chip: p.chip },
};

function getGroup(layer: number) {
  return GROUPS.find((g) => g.layers.includes(layer)) ?? GROUPS[GROUPS.length - 1];
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatArea(pct: number | null, m2: number | null): string | null {
  const parts: string[] = [];
  if (pct !== null && Number.isFinite(pct)) parts.push(`${pct < 1 && pct > 0 ? pct.toFixed(1) : Math.round(pct)} %`);
  if (m2 !== null && Number.isFinite(m2)) parts.push(`${Math.round(m2).toLocaleString("de-CH")} m²`);
  return parts.length ? parts.join(" · ") : null;
}

function triggerCode(pn: ProjectNorm): string | null {
  const t = pn.trigger ?? null;
  return t && t.startsWith("oereb:") ? t.slice("oereb:".length) : null;
}

/** Herkunft einer ÖREB-Zuweisung in Worten statt als technischer Auslöser. */
function triggerLabel(trigger: string | null | undefined): string {
  if (trigger?.startsWith("oereb-doc:")) return "Steht im ÖREB-Auszug dieses Grundstücks";
  if (trigger) return `Auslöser: ${trigger}`;
  return "Über den ÖREB-Auszug zugewiesen";
}

function NormCard({ pn, onRemove }: { pn: ProjectNorm; onRemove: (normId: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [fullText, setFullText] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const norm = pn.norms;
  useEffect(() => {
    if (!expanded || !norm?.text_truncated || fullText !== null || loadError) return;
    api
      .get<{ text: string }>(`/standards/${norm.id}`)
      .then((res) => setFullText(res.text))
      .catch(() => setLoadError(true));
  }, [expanded, norm?.id, norm?.text_truncated, fullText, loadError]);
  if (!norm) return null;
  const grp = getGroup(norm.layer);
  const loadingFull = expanded && !!norm.text_truncated && fullText === null && !loadError;
  const pdfHref = safeHref(norm.pdf_url);
  const sourceHref = safeHref(norm.source_url);
  const sourceLink = sourceHref && sourceHref !== pdfHref ? sourceHref : null;
  // Ohne gültige Adresse (bei Uploads ein Dateiname) nur als Text, nicht doppelt zu source_doc.
  const sourceText = !sourceHref && norm.source_url && norm.source_url !== norm.source_doc ? norm.source_url : null;

  return (
    <div className={n.norm}>
      <div className={n.normHead}>
        <span className={n.dot} style={{ background: grp.dot }} aria-hidden="true" />
        <div className={n.normMain}>
          <div className={n.chips}>
            <span className={grp.chip}>{norm.jurisdiction_name ?? grp.label}</span>
            <span className={p.chip}>{norm.category}</span>
            {norm.zone && <span className={p.chipWarn}>Zone {norm.zone}</span>}
            {norm.org_id === null && <span className={p.chipInfo}>Plattformweit</span>}
            {pn.added_by === "oereb" && (
              <span title={triggerLabel(pn.trigger)} className={OEREB_STYLE.chip}>ÖREB</span>
            )}
            {norm.source_kind === "oereb_auto" && (
              <span className={OEREB_STYLE.chip}>
                automatisch aus ÖREB{norm.source_checked_at ? `, Stand ${formatDate(norm.source_checked_at)}` : ""}
              </span>
            )}
            {pn.added_by === "user" && <span className={n.note}>manuell</span>}
          </div>
          <p className={n.normTitle}>{norm.title}</p>
          {expanded && (
            <>
              <NormText
                normId={norm.id}
                text={fullText ?? norm.text}
                wholeDocument={norm.source_kind === "oereb_auto" || !!pdfHref}
                pdfUrl={norm.pdf_url ?? null}
                loadingFull={loadingFull}
                loadError={loadError}
              />
              {(sourceLink || sourceText || norm.source_doc) && (
                <div className={n.normSource}>
                  {sourceLink && (
                    <a href={sourceLink} target="_blank" rel="noopener noreferrer" className={n.link}>
                      Quelle ansehen →
                    </a>
                  )}
                  {sourceText && <span>{sourceText}</span>}
                  {norm.source_doc && <span>{norm.source_doc}</span>}
                </div>
              )}
            </>
          )}
        </div>
        <div className={n.normActions}>
          <button
            type="button"
            onClick={() => {
              // Nach einem Ladefehler beim erneuten Aufklappen einmal neu versuchen.
              if (!expanded && loadError) setLoadError(false);
              setExpanded(!expanded);
            }}
            title={expanded ? "Einklappen" : "Volltext anzeigen"}
            aria-label={expanded ? "Einklappen" : "Volltext anzeigen"}
            aria-expanded={expanded}
            className={n.iconBtn}
          >
            <Ico d={ICON.chevDown} size={16} className={`${n.chev} ${expanded ? n.chevOpen : ""}`} strokeWidth={2.2} />
          </button>
          <button
            type="button"
            onClick={() => onRemove(norm.id)}
            title="Norm entfernen"
            aria-label="Norm entfernen"
            className={`${n.iconBtn} ${n.iconBtnDanger}`}
          >
            <Ico d={ICON.x} size={16} strokeWidth={2.2} />
          </button>
        </div>
      </div>
    </div>
  );
}

function AddCustomNormModal({ projectId, onClose, onAdded }: { projectId: string; onClose: () => void; onAdded: (pn: ProjectNorm) => void }) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [category, setCategory] = useState("");
  const [zone, setZone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const pn = await api.post<ProjectNorm>(`/projects/${projectId}/norms/custom`, { title, text, category, zone });
      onAdded(pn);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={n.overlay}>
      <div className={n.dialog} role="dialog" aria-modal="true" aria-labelledby="add-norm-title">
        <h2 id="add-norm-title" className={n.dialogTitle}>Spezialnorm hinzufügen</h2>
        <p className={n.dialogText}>
          Wird als organisationsspezifische Norm gespeichert und diesem Projekt zugewiesen.
        </p>
        <form onSubmit={handleSubmit}>
          <div className={n.field}>
            <label htmlFor="norm-title" className={p.label}>Titel</label>
            <input id="norm-title" type="text" required autoFocus value={title} onChange={(e) => setTitle(e.target.value)} className={p.input} placeholder="z.B. Interne Brandschutzanforderung" />
          </div>
          <div className={n.field}>
            <label htmlFor="norm-category" className={p.label}>Kategorie</label>
            <input id="norm-category" type="text" required value={category} onChange={(e) => setCategory(e.target.value)} className={p.input} placeholder="z.B. Brandschutz" />
          </div>
          <div className={n.field}>
            <label htmlFor="norm-zone" className={p.label}>Zone (optional)</label>
            <input id="norm-zone" type="text" value={zone} onChange={(e) => setZone(e.target.value)} className={p.input} placeholder="z.B. W2 — leer = gilt für alle Zonen" />
          </div>
          <div className={n.field}>
            <label htmlFor="norm-text" className={p.label}>Inhalt</label>
            <textarea id="norm-text" required rows={5} value={text} onChange={(e) => setText(e.target.value)} className={p.textarea} placeholder="Vollständiger Normtext..." />
          </div>
          {error && <div role="alert" className={n.errorBox}>{error}</div>}
          <div className={n.dialogActions}>
            <button type="button" onClick={onClose} className={p.btnGhost}>Abbrechen</button>
            <button type="submit" disabled={loading} className={p.btnNavy}>
              {loading ? "Wird gespeichert..." : "Speichern"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function LegalStatusBadge({ status }: { status: LegalStatus }) {
  const s = LEGAL_STATUS[status] ?? LEGAL_STATUS.unknown;
  return <span className={s.chip}>{s.label}</span>;
}

function ThemeBlock({ theme, isGap, onRemove }: { theme: ThemeGroup; isGap: boolean; onRemove: (normId: string) => void }) {
  const federal = isFederalTheme(theme.themeCode);
  const showGapCard = isGap;

  return (
    <div className={n.theme}>
      <div className={n.normHead}>
        <span className={n.dot} style={{ background: OEREB_STYLE.dot }} aria-hidden="true" />
        <div className={n.normMain}>
          <div className={n.themeHead}>
            <h3 className={n.themeName}>{theme.themeName}</h3>
            <span className={`${n.themeCode} ${n.mono}`}>{theme.themeCode}</span>
            {!federal && <span className={p.chipInfo}>kantonales Thema</span>}
          </div>

          <div className={n.themeRows}>
            {theme.rows.map((r, i) => {
              const area = formatArea(r.areaPct, r.areaM2);
              const links = (r.lawLinks ?? []).filter((l) => l && (l.title || l.url));
              return (
                <div key={i} className={n.themeRow}>
                  <div className={n.themeLine}>
                    {(r.legendText || r.subTheme) && <span className={n.themeLegend}>{r.legendText ?? r.subTheme}</span>}
                    <LegalStatusBadge status={r.legalStatus} />
                    {area && <span className={n.themeMeta}>{area}</span>}
                  </div>
                  {(links.length > 0 || r.authority?.name) && (
                    <div className={n.themeLinks}>
                      {links.map((l, j) =>
                        l.url ? (
                          <a key={j} href={l.url} target="_blank" rel="noreferrer" className={n.link}>
                            {l.title || "Rechtsvorschrift"} ↗
                          </a>
                        ) : (
                          <span key={j} className={p.muted}>{l.title}</span>
                        )
                      )}
                      {r.authority?.name && (
                        r.authority.url ? (
                          <a href={r.authority.url} target="_blank" rel="noreferrer" className={n.plainLink}>
                            Zuständig: {r.authority.name} ↗
                          </a>
                        ) : (
                          <span className={p.muted}>Zuständig: {r.authority.name}</span>
                        )
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {theme.norms.length > 0 && (
            <div className={n.nestedList}>
              {theme.norms.map((pn) => (
                <NormCard key={pn.id} pn={pn} onRemove={onRemove} />
              ))}
            </div>
          )}

          {showGapCard && (
            <div className={`${n.inlineNotice} ${n.toneWarn}`}>
              <Ico d={ICON.warn} size={18} className={n.noticeIcon} />
              <div>
                <p className={n.noticeTitle}>Keine Norm in der Bibliothek für dieses Thema.</p>
                <p className={n.noticeText}>Norm hochladen oder Mapping im Admin ergänzen.</p>
              </div>
            </div>
          )}
          {!showGapCard && theme.norms.length === 0 && (
            <p className={`${n.note} ${n.noticeText}`}>
              {federal
                ? "Passende Normen hängen bereits über Bund/Kanton/Gemeinde am Projekt (siehe oben) oder sind unter einem anderen Thema aufgeführt."
                : "Keine Norm zugeordnet — kantonale Themen werden nur über ein eigenes Mapping der Organisation verknüpft."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function GroupHead({ color, title, count, extra }: { color: string; title: string; count: number; extra?: React.ReactNode }) {
  return (
    <div className={p.sectionHead}>
      <h2 className={n.sectionHeadTitle}>
        <span className={n.dot} style={{ background: color, marginTop: 0 }} aria-hidden="true" />
        <span className={p.sectionTitle}>{title}</span>
        <span className={p.chip}>{count}</span>
        {extra}
      </h2>
    </div>
  );
}


export default function NormenPage({ params }: { params: { id: string } }) {
  const [project, setProject] = useState<Project | null>(null);
  const [projectNorms, setProjectNorms] = useState<ProjectNorm[]>([]);
  const [oereb, setOereb] = useState<OerebResponse | null>(null);
  const [oerebError, setOerebError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchingOereb, setFetchingOereb] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const [showOtherZones, setShowOtherZones] = useState(false);
  const [showNoData, setShowNoData] = useState(false);
  const [editingZone, setEditingZone] = useState(false);
  const [kenndatenBusy, setKenndatenBusy] = useState(false);
  const [kenndatenError, setKenndatenError] = useState<string | null>(null);
  const { isAdmin } = useOrgRole();
  const sync = useOerebSync();

  const load = useCallback(async () => {
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
    // ÖREB separat: die Route darf fehlen oder scheitern, ohne den Tab zu blockieren.
    try {
      const res = await api.get<OerebResponse>(`/projects/${params.id}/oereb`);
      setOereb(res ?? null);
      setOerebError(null);
    } catch (e: unknown) {
      setOereb(null);
      setOerebError(e instanceof Error ? e.message : "ÖREB-Daten konnten nicht geladen werden");
    }
    setLoading(false);
  }, [params.id]);

  useEffect(() => { load(); }, [load]);

  // Nach jedem Import-Lauf: Neue Reglemente können dem Projekt zugewiesen worden sein.
  const syncVersion = sync.state.version;
  useEffect(() => {
    if (syncVersion > 0) load();
  }, [syncVersion, load]);

  function flash(msg: string) {
    setRefreshMsg(msg);
    setTimeout(() => setRefreshMsg(null), 4000);
  }

  async function handleRemove(normId: string) {
    try {
      await api.delete(`/projects/${params.id}/norms`, { norm_id: normId });
      setProjectNorms((prev) => prev.filter((pn) => pn.norms?.id !== normId));
    } catch { /* ignore */ }
  }

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshMsg(null);
    try {
      const res = await api.post<{ zone: string | null; assigned_norms_count: number; documents_pending?: number }>(
        `/projects/${params.id}/norms/refresh`, {}
      );
      if (res.documents_pending) sync.run(res.documents_pending);
      flash(
        res.assigned_norms_count > 0
          ? `${res.assigned_norms_count} neue Norm${res.assigned_norms_count !== 1 ? "en" : ""} geladen.`
          : "Keine neuen Normen gefunden."
      );
      await load();
    } catch (e: unknown) {
      flash(e instanceof Error && e.message ? `Normen nicht neu geladen: ${e.message}` : "Fehler beim Laden der Normen.");
    } finally {
      setRefreshing(false);
    }
  }

  async function handleFetchOereb() {
    setFetchingOereb(true);
    setRefreshMsg(null);
    try {
      const res = await api.post<OerebResponse>(`/projects/${params.id}/oereb`, {});
      const n = res?.oereb_assigned ?? res?.assigned ?? 0;
      if (res?.documents_pending) sync.run(res.documents_pending);
      const note = res ? oerebReloadNote(res, !!(project?.parcel_number || res.extract?.egrid)) : null;
      if (note) {
        flash(note);
      } else if (res?.extract?.status && res.extract.status !== "ok") {
        flash("ÖREB-Abruf ohne Auszug. Der Grund steht unten.");
      } else {
        flash(n > 0 ? `ÖREB-Auszug geladen · ${n} Norm${n !== 1 ? "en" : ""} zugewiesen.` : "ÖREB-Auszug geladen.");
      }
      await load();
    } catch (e: unknown) {
      flash(e instanceof Error ? e.message : "ÖREB-Abruf fehlgeschlagen.");
    } finally {
      setFetchingOereb(false);
    }
  }

  async function handleKenndatenblatt() {
    setKenndatenBusy(true);
    setKenndatenError(null);
    try {
      const { blatt } = await api.post<{ blatt: KenndatenBlatt }>(`/projects/${params.id}/kenndaten`, {});
      // jsPDF erst laden, wenn jemand das Blatt wirklich will.
      const { downloadKenndatenPdf } = await import("@/lib/kenndaten-report");
      await downloadKenndatenPdf(blatt);
    } catch (e: unknown) {
      setKenndatenError(e instanceof Error ? e.message : "Das Kenndatenblatt konnte nicht erstellt werden.");
    } finally {
      setKenndatenBusy(false);
    }
  }

  function handleCustomAdded(pn: ProjectNorm) {
    setProjectNorms((prev) => [...prev, pn]);
  }

  function handleZoneSaved(zone: string) {
    setProject((p) => (p ? { ...p, bauzone: zone, zone_source: "manual", zone_confidence: null } : p));
    setEditingZone(false);
  }

  // ── Ableitungen ────────────────────────────────────────────────────────────

  const canton = project?.location?.canton ?? "";
  const oerebSupported = isOerebSupportedCanton(canton);
  const extract = oereb?.extract ?? null;
  const extractOk = extract?.status === "ok";
  const themes: OerebThemeRow[] = (oereb?.themes ?? []).map(normalizeTheme).filter((t): t is OerebThemeRow => t !== null);

  // Ein Block pro Themencode (ein Auszug kann mehrere Einschränkungen je Thema enthalten).
  const affectsByCode = new Map<string, ThemeGroup>();
  for (const t of themes) {
    if (t.concern !== "affects") continue;
    const g = affectsByCode.get(t.themeCode) ?? { themeCode: t.themeCode, themeName: t.themeName, rows: [], norms: [] };
    g.rows.push(t);
    affectsByCode.set(t.themeCode, g);
  }
  const shownUnderTheme = new Set<string>();
  for (const pn of projectNorms) {
    if (!pn.norms) continue;
    const code = triggerCode(pn);
    if (!code) continue;
    const g = affectsByCode.get(code);
    if (g) { g.norms.push(pn); shownUnderTheme.add(pn.id); }
  }
  const affectsThemes = Array.from(affectsByCode.values()).sort((a, b) => {
    // Bundesthemen zuerst, dann alphabetisch
    const fa = isFederalTheme(a.themeCode) ? 0 : 1;
    const fb = isFederalTheme(b.themeCode) ? 0 : 1;
    if (fa !== fb) return fa - fb;
    return a.themeName.localeCompare(b.themeName, "de");
  });
  const gapCodes = new Set((oereb?.gaps ?? []).map((g) => g.themeCode));
  const gapCount = affectsThemes.filter((t) => gapCodes.has(t.themeCode)).length;

  const noDataThemes = Array.from(
    new Map(themes.filter((t) => t.concern === "no_data").map((t) => [t.themeCode, t])).values()
  );
  const distinctCodes = new Set(themes.map((t) => t.themeCode));
  const themeCount = distinctCodes.size;
  const affectsCount = affectsByCode.size;
  const noDataCount = noDataThemes.length;

  const validNorms = projectNorms.filter((pn) => pn.norms !== null && !shownUnderTheme.has(pn.id));
  const matchingNorms = validNorms.filter((pn) => normMatchesZone(pn.norms!.zone, project?.bauzone));
  const otherZoneNorms = validNorms.filter((pn) => !normMatchesZone(pn.norms!.zone, project?.bauzone));

  const grouped = GROUPS.map((grp) => ({
    ...grp,
    norms: matchingNorms.filter((pn) => grp.layers.includes(pn.norms!.layer)),
  })).filter((grp) => grp.norms.length > 0);

  const bauzone = project?.bauzone ?? oereb?.zone?.bauzone ?? null;
  const zoneSource = project?.zone_source ?? oereb?.zone?.zone_source ?? null;
  const zoneConfidence = project?.zone_confidence ?? oereb?.zone?.zone_confidence ?? null;
  const bauzoneUnknown = !!project && !bauzone;
  const zoneUnsure = !!project && zoneNeedsAttention({ bauzone, zone_source: zoneSource, zone_confidence: zoneConfidence }) && !!bauzone;
  const zoneOriginLabel =
    zoneSource === "manual" ? "manuell"
    : zoneConfidence === "low" ? "unsicher, bitte prüfen"
    : zoneSource === "oereb" ? (zoneConfidence === "coarse" ? "Grobklasse (ÖREB)" : "aus ÖREB")
    : null;
  const staleError = extractOk ? extract?.last_error ?? null : null;

  const hasAnyContent = grouped.length > 0 || otherZoneNorms.length > 0 || affectsThemes.length > 0;

  const fetchButton = (
    <button
      type="button"
      onClick={handleFetchOereb}
      disabled={fetchingOereb}
      className={`${p.btnNavy} ${p.btnSm}`}
    >
      {fetchingOereb ? "Wird abgerufen…" : "ÖREB abrufen"}
    </button>
  );

  const assignedCount = projectNorms.filter((pn) => pn.norms !== null).length;
  const bannerSubtitle = loading ? undefined : `${assignedCount} ${assignedCount === 1 ? "Norm" : "Normen"} zugewiesen`;

  const bannerActions = (
    <>
      <button type="button" onClick={handleKenndatenblatt} disabled={kenndatenBusy} aria-busy={kenndatenBusy} className={p.btnGhost}>
        <Ico d={kenndatenBusy ? ICON.refresh : ICON.download} size={16} className={kenndatenBusy ? "motion-safe:animate-spin" : undefined} />
        {kenndatenBusy ? "Wird erstellt…" : "Kenndatenblatt erstellen"}
      </button>
      <button type="button" onClick={handleRefresh} disabled={refreshing} className={p.btnGhost}>
        <Ico d={ICON.refresh} size={16} className={refreshing ? "motion-safe:animate-spin" : undefined} />
        Normen neu laden
      </button>
      <button type="button" onClick={() => setShowAddModal(true)} className={p.btnSand}>
        <Ico d={ICON.plus} size={16} strokeWidth={2.2} />
        Spezialnorm hinzufügen
      </button>
    </>
  );

  return (
    <div className={n.page}>
      <ProjectBanner variant="norms" title="Normen" subtitle={bannerSubtitle} actions={bannerActions} />

      <div role="status">
        {refreshMsg && <p className={n.flash}>{refreshMsg}</p>}
      </div>
      {kenndatenError && <p role="alert" className={`${n.flash} ${n.flashErr}`}>{kenndatenError}</p>}

      {loading && !project && (
        <section className={`${p.glass} ${p.card}`} aria-hidden="true">
          <div className={n.cardRow}>
            <span className={`${p.iconTile} ${p.skeleton}`} />
            <div className={n.cardBody}>
              <span className={`${p.skeleton} motion-safe:animate-pulse`} style={{ width: "40%", height: 22, marginBottom: 12 }} />
              <span className={`${p.skeleton} motion-safe:animate-pulse`} style={{ width: "62%" }} />
            </div>
          </div>
        </section>
      )}

      {project && (
        <section className={`${p.glassFlat} ${p.card}`} aria-label="Grundstück">
          <div className={n.cardRow}>
            <span className={p.iconTile}><Ico d={ICON.layers} size={24} strokeWidth={1.7} /></span>
            <div className={n.cardBody}>
              <h2 className={n.cardTitle}>{project.location.municipality}, Kanton {project.location.canton}</h2>
              <div className={n.chips}>
                {project.parcel_number && <span className={p.chip}>Parzelle {project.parcel_number}</span>}
                {extract?.egrid && (
                  <span title="Eidgenössischer Grundstücksidentifikator" className={`${p.chip} ${n.mono}`}>{extract.egrid}</span>
                )}
                {editingZone ? (
                  <ZoneEditor projectId={project.id} initial={bauzone ?? ""} onSaved={handleZoneSaved} onCancel={() => setEditingZone(false)} autoFocus proposal={zoneUnsure} />
                ) : bauzone ? (
                  <>
                    <span className={zoneConfidence === "coarse" || zoneUnsure ? p.chipWarn : p.chipSand}>
                      Zone {bauzone}{zoneOriginLabel ? ` · ${zoneOriginLabel}` : ""}
                    </span>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => setEditingZone(true)}
                        title="Bauzone bearbeiten"
                        aria-label="Bauzone bearbeiten"
                        className={`${n.iconBtn} ${n.iconBtnSm}`}
                      >
                        <Ico d={ICON.pencil} size={15} />
                      </button>
                    )}
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      )}

      {!loading && project && (
        !oerebSupported ? (
          <div className={`${n.notice} ${n.toneInfo}`}>
            <div className={n.noticeBody}>
              <Ico d={ICON.info} size={18} className={n.noticeIcon} />
              <p className={n.noticeText} style={{ margin: 0 }}>Kein gültiger Kanton hinterlegt ({canton || "leer"}), deshalb kein ÖREB-Abruf. Bitte den Kanton in den Einstellungen korrigieren.</p>
            </div>
          </div>
        ) : oerebError && !extract ? (
          <div className={`${n.notice} ${n.toneInfo}`}>
            <div className={n.noticeBody}>
              <Ico d={ICON.info} size={18} className={n.noticeIcon} />
              <p className={n.noticeText} style={{ margin: 0 }}>ÖREB-Daten nicht verfügbar: {oerebError}</p>
            </div>
            {fetchButton}
          </div>
        ) : !extract || !extract.status ? (
          <div className={`${n.notice} ${n.toneWarn}`}>
            <div className={n.noticeBody}>
              <Ico d={ICON.warn} size={20} className={n.noticeIcon} />
              <div>
                <p className={n.noticeTitle}>Noch kein ÖREB-Auszug für diese Parzelle</p>
                <p className={n.noticeText}>
                  Der Auszug liefert Bauzone und parzellenspezifische Einschränkungen aus dem ÖREB-Kataster {canton}.
                </p>
              </div>
            </div>
            {fetchButton}
          </div>
        ) : extract.status !== "ok" ? (
          <OerebStatusNotice
            status={extract.status}
            canton={canton}
            detail={extract.status_detail}
            pdfUrl={oereb?.oereb_pdf_url}
            attemptAt={extract.last_attempt_at ?? extract.fetched_at}
            projectId={params.id}
            isAdmin={isAdmin}
          >
            {fetchButton}
          </OerebStatusNotice>
        ) : (
          <div className={`${n.notice} ${n.toneSand}`}>
            <div className={n.noticeBody}>
              <span className={n.dot} style={{ background: OEREB_STYLE.dot, boxShadow: "0 0 0 2px var(--bronze)" }} aria-hidden="true" />
              <p className={n.noticeText} style={{ margin: 0 }}>
                ÖREB-Auszug vom <strong>{formatDate(extract.fetched_at)}</strong>
                {" · "}{themeCount} Themen
                {" · "}<strong>{affectsCount}</strong> betreffen die Parzelle
                {" · "}{noDataCount} ohne Daten
                {gapCount > 0 && <>{" · "}<strong style={{ color: "var(--warn-text)" }}>{gapCount} ohne Norm</strong></>}
                {staleError && (
                  <span className={n.noticeDetail} style={{ marginTop: 4, color: "var(--warn-text)", fontWeight: 600 }}>
                    Die letzte Aktualisierung ist fehlgeschlagen. Es gilt dieser ältere Stand. Bitte später neu laden.
                  </span>
                )}
              </p>
            </div>
            {oereb?.oereb_pdf_url && (
              <a href={oereb.oereb_pdf_url} target="_blank" rel="noreferrer" className={n.link}>
                Amtlicher PDF-Auszug ↗
              </a>
            )}
          </div>
        )
      )}

      {!loading && (bauzoneUnknown || zoneUnsure) && !editingZone && (
        <div className={`${n.notice} ${n.toneWarn}`}>
          <div className={n.noticeBody}>
            <Ico d={ICON.warn} size={20} className={n.noticeIcon} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className={n.noticeTitle}>
                {zoneUnsure ? `Bauzone unsicher, bitte prüfen: ${bauzone} ist nur ein Vorschlag` : "Bauzone nicht bekannt"}
              </p>
              <p className={n.noticeText}>
                {zoneUnsure
                  ? "Der ÖREB-Auszug lässt keinen sicheren Schluss zu. Die Zone gilt nicht als gesichert, bis sie bestätigt oder korrigiert ist; sie bestimmt, welche zonenspezifischen Normen geladen werden."
                  : extractOk
                    ? "Der ÖREB-Auszug enthält keine eindeutige Bauzone für diese Parzelle. Bitte trage die Zone manuell ein, damit zonenspezifische Normen geladen werden können."
                    : "Die Bauzone wird aus dem ÖREB-Auszug übernommen. Solange keiner vorliegt, kannst du sie manuell eintragen."}
              </p>
              <div style={{ marginTop: 12 }}>
                {isAdmin ? (
                  <ZoneEditor projectId={params.id} initial={bauzone ?? ""} onSaved={handleZoneSaved} accent="rgba(217,154,31,0.55)" proposal={zoneUnsure} />
                ) : (
                  <p className={`${n.noticeText} ${p.muted}`} style={{ margin: 0 }}>Die Zone kann ein Organisations-Admin eintragen.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {!loading && project && <OerebDocumentsPanel />}

      {loading ? (
        <section className={p.glass} aria-hidden="true">
          {[...Array(4)].map((_, i) => (
            <div key={i} className={n.skelRow}>
              <span className={`${p.skeleton} motion-safe:animate-pulse`} style={{ width: "28%" }} />
              <span className={`${p.skeleton} motion-safe:animate-pulse`} style={{ width: "72%" }} />
            </div>
          ))}
        </section>
      ) : !hasAnyContent ? (
        <section className={`${p.glass} ${n.empty}`}>
          <span className={`${p.iconTile} ${n.emptyTile}`}><Ico d={ICON.doc} size={24} strokeWidth={1.6} /></span>
          <p className={n.emptyTitle}>Noch keine Normen zugewiesen</p>
          <p className={n.emptyText}>
            Klicke auf «Normen neu laden» oder füge eine Spezialnorm manuell hinzu.
          </p>
        </section>
      ) : (
        <div className={n.stack}>
          {grouped.length === 0 && affectsThemes.length === 0 && (
            <section className={`${p.glass} ${n.empty}`}>
              <p className={n.emptyText} style={{ margin: 0 }}>
                Keine Normen für die aktuelle Bauzone{bauzone ? ` (${bauzone})` : ""}.
              </p>
            </section>
          )}

          {grouped.filter((g) => g.label !== "Spezialnormen").map((grp) => (
            <section key={grp.label} className={p.glass}>
              <GroupHead color={grp.dot} title={grp.label} count={grp.norms.length} />
              {grp.norms.map((pn) => (
                <NormCard key={pn.id} pn={pn} onRemove={handleRemove} />
              ))}
            </section>
          ))}

          {affectsThemes.length > 0 && (
            <section className={p.glass}>
              <GroupHead
                color={OEREB_STYLE.dot}
                title="Parzellenspezifisch (ÖREB)"
                count={affectsThemes.length}
                extra={gapCount > 0 ? <span className={p.chipWarn}>{gapCount} Lücke{gapCount !== 1 ? "n" : ""}</span> : undefined}
              />
              {affectsThemes.map((t) => (
                <ThemeBlock key={t.themeCode} theme={t} isGap={gapCodes.has(t.themeCode)} onRemove={handleRemove} />
              ))}

              {noDataThemes.length > 0 && (
                <div className={n.footBar}>
                  <h3 className={n.toggleHead}>
                    <button
                      type="button"
                      onClick={() => setShowNoData((v) => !v)}
                      aria-expanded={showNoData}
                      className={n.toggle}
                    >
                      <Ico d={ICON.chevRight} size={14} strokeWidth={2.4} className={`${n.chev} ${showNoData ? n.chevRight : ""}`} />
                      <span className={p.sectionTitle}>Ohne Daten ({noDataThemes.length})</span>
                      <span className={n.toggleHint}>Themen, für die der Kataster keine Daten publiziert</span>
                    </button>
                  </h3>
                  {showNoData && (
                    <ul className={n.noDataList}>
                      {noDataThemes.map((t) => (
                        <li key={t.themeCode}>
                          {t.themeName} <span className={`${n.mono} ${p.muted}`} style={{ fontSize: 13 }}>{t.themeCode}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </section>
          )}

          {grouped.filter((g) => g.label === "Spezialnormen").map((grp) => (
            <section key={grp.label} className={p.glass}>
              <GroupHead color={grp.dot} title={grp.label} count={grp.norms.length} />
              {grp.norms.map((pn) => (
                <NormCard key={pn.id} pn={pn} onRemove={handleRemove} />
              ))}
            </section>
          ))}

          {otherZoneNorms.length > 0 && (
            <section className={p.glass}>
              <h2 className={n.toggleHead}>
                <button
                  type="button"
                  onClick={() => setShowOtherZones((v) => !v)}
                  aria-expanded={showOtherZones}
                  className={`${n.toggle} ${showOtherZones ? n.toggleOpen : ""}`}
                >
                  <Ico d={ICON.chevRight} size={14} strokeWidth={2.4} className={`${n.chev} ${showOtherZones ? n.chevRight : ""}`} />
                  <span className={p.sectionTitle}>Andere Zonen — nicht zutreffend{bauzone ? ` für ${bauzone}` : ""}</span>
                  <span className={p.chip}>{otherZoneNorms.length}</span>
                </button>
              </h2>
              {showOtherZones && (
                <div className={n.dimmed}>
                  {otherZoneNorms.map((pn) => (
                    <NormCard key={pn.id} pn={pn} onRemove={handleRemove} />
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {showAddModal && project && (
        <AddCustomNormModal
          projectId={project.id}
          onClose={() => setShowAddModal(false)}
          onAdded={handleCustomAdded}
        />
      )}
    </div>
  );
}
