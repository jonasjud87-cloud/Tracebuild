"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { normMatchesZone } from "@/lib/zone-match";
import { isOerebSupportedCanton } from "@/lib/oereb/cantons";
import { isFederalTheme } from "@/lib/oereb/mapping";

interface Project {
  id: string;
  name: string;
  location: { canton: string; municipality: string; country: string };
  parcel_number: string | null;
  bauzone: string | null;
  zone_source?: "oereb" | "manual" | null;
  zone_confidence?: "exact" | "coarse" | null;
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

// ── ÖREB (Vertrag GET/POST /projects/{id}/oereb) ─────────────────────────────

type ExtractStatus = "ok" | "no_egrid" | "ambiguous" | "unreachable" | "parse_error";
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
  extract: { status: ExtractStatus | null; status_detail: string | null; egrid: string | null; fetched_at: string | null } | null;
  themes: OerebThemeWire[];
  gaps: { themeCode: string; themeName: string }[];
  zone: { bauzone: string | null; zone_source: "oereb" | "manual" | null; zone_confidence: "exact" | "coarse" | null } | null;
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
  { label: "Bund",          layers: [1, 2], dot: "#38BDF8", badgeBg: "rgba(56,189,248,0.12)",  badgeText: "#38BDF8", header: "#38BDF8",  cardBorder: "rgba(56,189,248,0.2)"  },
  { label: "Kanton",        layers: [3],    dot: "#A78BFA", badgeBg: "rgba(167,139,250,0.12)", badgeText: "#A78BFA", header: "#A78BFA",  cardBorder: "rgba(167,139,250,0.2)" },
  { label: "Gemeinde",      layers: [4],    dot: "#34D399", badgeBg: "rgba(52,211,153,0.12)",  badgeText: "#34D399", header: "#34D399",  cardBorder: "rgba(52,211,153,0.2)"  },
  { label: "Spezialnormen", layers: [5],    dot: "#B7926A", badgeBg: "rgba(183,146,106,0.12)", badgeText: "#B7926A", header: "#B7926A",  cardBorder: "rgba(183,146,106,0.2)" },
];

const OEREB_STYLE = { dot: "#FB923C", header: "#FB923C", cardBorder: "rgba(251,146,60,0.22)", badgeBg: "rgba(251,146,60,0.12)", badgeText: "#FB923C" };

const LEGAL_STATUS: Record<LegalStatus, { label: string; bg: string; color: string }> = {
  inForce:                { label: "rechtskräftig",             bg: "rgba(52,211,153,0.12)",  color: "#34D399" },
  changeWithPreEffect:    { label: "Änderung mit Vorwirkung",   bg: "rgba(251,191,36,0.12)",  color: "#FBBF24" },
  changeWithoutPreEffect: { label: "Änderung ohne Vorwirkung",  bg: "rgba(133,166,233,0.1)",  color: "#ABAEBB" },
  unknown:                { label: "Status unbekannt",          bg: "rgba(133,166,233,0.1)",  color: "#7B8299" },
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

// ── Karten ───────────────────────────────────────────────────────────────────

function NormCard({ pn, onRemove }: { pn: ProjectNorm; onRemove: (normId: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const norm = pn.norms;
  if (!norm) return null;
  const grp = getGroup(norm.layer);

  return (
    <div style={{ background: "rgba(23,37,64,0.55)", border: `1px solid ${grp.cardBorder}`, borderRadius: 12, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <span style={{ marginTop: 6, width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: grp.dot }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 100, fontWeight: 500, background: grp.badgeBg, color: grp.badgeText }}>
              {norm.jurisdiction_name ?? grp.label}
            </span>
            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 100, fontWeight: 500, background: "rgba(133,166,233,0.1)", color: "#7B8299" }}>
              {norm.category}
            </span>
            {norm.zone && (
              <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 100, fontWeight: 500, background: "rgba(251,191,36,0.12)", color: "#FBBF24" }}>
                Zone {norm.zone}
              </span>
            )}
            {norm.org_id === null && (
              <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 100, fontWeight: 500, background: "rgba(56,189,248,0.12)", color: "#38BDF8" }}>
                Plattformweit
              </span>
            )}
            {pn.added_by === "oereb" && (
              <span title={pn.trigger ? `Auslöser: ${pn.trigger}` : "Über den ÖREB-Auszug zugewiesen"} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 100, fontWeight: 600, background: OEREB_STYLE.badgeBg, color: OEREB_STYLE.badgeText }}>
                📍 ÖREB
              </span>
            )}
            {pn.added_by === "user" && (
              <span style={{ fontSize: 11, color: "#7B8299", fontStyle: "italic" }}>manuell</span>
            )}
          </div>
          <p style={{ fontSize: 13, fontWeight: 600, color: "#fff", lineHeight: 1.4, margin: 0 }}>{norm.title}</p>
          {expanded && (
            <>
              <p style={{ marginTop: 8, fontSize: 13, color: "#ABAEBB", lineHeight: 1.6, whiteSpace: "pre-line", margin: "8px 0 0" }}>
                {norm.text}
              </p>
              {(norm.source_url || norm.source_doc) && (
                <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 12 }}>
                  {norm.source_url && (
                    <a href={norm.source_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#85A6E9", textDecoration: "none" }}>
                      Quelle ansehen →
                    </a>
                  )}
                  {norm.source_doc && (
                    <span style={{ fontSize: 12, color: "#7B8299" }}>{norm.source_doc}</span>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0, marginLeft: 4 }}>
          <button
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? "Einklappen" : "Volltext anzeigen"}
            style={{ padding: 6, borderRadius: 8, background: "none", border: "none", cursor: "pointer", color: "#7B8299", transition: "color .15s", lineHeight: 0 }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#ABAEBB"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "#7B8299"}
          >
            <svg style={{ width: 14, height: 14, transform: expanded ? "rotate(180deg)" : "none", transition: "transform .2s" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <button
            onClick={() => onRemove(norm.id)}
            title="Norm entfernen"
            style={{ padding: 6, borderRadius: 8, background: "none", border: "none", cursor: "pointer", color: "#7B8299", transition: "color .15s", lineHeight: 0 }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#F87171"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "#7B8299"}
          >
            <svg style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
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

  const inputStyle: React.CSSProperties = {
    width: "100%",
    border: "1px solid rgba(133,166,233,0.2)",
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 13,
    color: "#fff",
    background: "rgba(10,14,23,0.6)",
    outline: "none",
    boxSizing: "border-box",
    fontFamily: "inherit",
    transition: "border-color .15s",
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <div style={{ background: "#0E111B", border: "1px solid rgba(133,166,233,0.18)", borderRadius: 16, boxShadow: "0 24px 48px rgba(0,0,0,0.6)", width: "100%", maxWidth: 480, padding: 24 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: "#fff", margin: "0 0 4px" }}>Spezialnorm hinzufügen</h3>
        <p style={{ fontSize: 12, color: "#7B8299", margin: "0 0 20px" }}>
          Wird als organisationsspezifische Norm gespeichert und diesem Projekt zugewiesen.
        </p>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#85A6E9", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Titel</label>
            <input type="text" required value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} placeholder="z.B. Interne Brandschutzanforderung" />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#85A6E9", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Kategorie</label>
            <input type="text" required value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle} placeholder="z.B. Brandschutz" />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#85A6E9", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Zone (optional)</label>
            <input type="text" value={zone} onChange={(e) => setZone(e.target.value)} style={inputStyle} placeholder="z.B. W2 — leer = gilt für alle Zonen" />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#85A6E9", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Inhalt</label>
            <textarea required rows={5} value={text} onChange={(e) => setText(e.target.value)} style={{ ...inputStyle, resize: "none" }} placeholder="Vollständiger Normtext..." />
          </div>
          {error && (
            <div style={{ marginBottom: 16, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "#F87171" }}>
              {error}
            </div>
          )}
          <div style={{ display: "flex", gap: 12 }}>
            <button type="button" onClick={onClose} style={{ flex: 1, border: "1px solid rgba(133,166,233,0.2)", color: "#7B8299", padding: "9px 0", borderRadius: 8, fontSize: 13, fontWeight: 500, background: "none", cursor: "pointer", fontFamily: "inherit" }}>
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{ flex: 1, background: "#2862D7", color: "#fff", padding: "9px 0", borderRadius: 8, fontSize: 13, fontWeight: 600, border: "none", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1, fontFamily: "inherit", transition: "background .15s" }}
              onMouseEnter={e => { if (!loading) (e.currentTarget as HTMLElement).style.background = "#3470E8"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#2862D7"; }}
            >
              {loading ? "Wird gespeichert..." : "Speichern"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Inline-Editor für die Bauzone. Speichert per PATCH — die Route setzt damit
 * zone_source = 'manual' (Entscheidung 1: manuelle Zone gewinnt).
 */
function ZoneEditor({ projectId, initial, onSaved, onCancel, accent = "rgba(133,166,233,0.3)" }: {
  projectId: string;
  initial: string;
  onSaved: (zone: string) => void;
  onCancel?: () => void;
  accent?: string;
}) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const zone = value.trim();
    if (!zone) return;
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/projects/${projectId}`, { bauzone: zone });
      onSaved(zone);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="text"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Bauzone eingeben (z.B. W2)"
          style={{ flex: 1, minWidth: 140, border: `1px solid ${accent}`, borderRadius: 8, padding: "6px 12px", fontSize: 13, color: "#fff", background: "rgba(10,14,23,0.6)", outline: "none", fontFamily: "inherit" }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape" && onCancel) onCancel();
          }}
        />
        <button
          onClick={handleSave}
          disabled={saving || !value.trim()}
          style={{ padding: "6px 14px", background: "#2862D7", color: "#fff", borderRadius: 8, fontSize: 13, fontWeight: 600, border: "none", cursor: saving || !value.trim() ? "not-allowed" : "pointer", opacity: saving || !value.trim() ? 0.5 : 1, fontFamily: "inherit" }}
        >
          {saving ? "..." : "Speichern"}
        </button>
        {onCancel && (
          <button
            onClick={onCancel}
            disabled={saving}
            style={{ padding: "6px 10px", background: "none", color: "#7B8299", borderRadius: 8, fontSize: 13, border: "1px solid rgba(133,166,233,0.2)", cursor: "pointer", fontFamily: "inherit" }}
          >
            Abbrechen
          </button>
        )}
      </div>
      {error && <span style={{ fontSize: 12, color: "#F87171" }}>{error}</span>}
    </div>
  );
}

function LegalStatusBadge({ status }: { status: LegalStatus }) {
  const s = LEGAL_STATUS[status] ?? LEGAL_STATUS.unknown;
  return (
    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 100, fontWeight: 500, background: s.bg, color: s.color, whiteSpace: "nowrap" }}>
      {s.label}
    </span>
  );
}

/** Ein betroffenes ÖREB-Thema mit seinen Einschränkungen und den zugewiesenen Normen. */
function ThemeBlock({ theme, isGap, onRemove }: { theme: ThemeGroup; isGap: boolean; onRemove: (normId: string) => void }) {
  const federal = isFederalTheme(theme.themeCode);
  // Lücke = vom Server so gemeldet (Mapping vorhanden, aber keine Norm mit passender Kategorie).
  const showGapCard = isGap;

  return (
    <div style={{ background: "rgba(23,37,64,0.35)", border: `1px solid ${OEREB_STYLE.cardBorder}`, borderRadius: 12, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <span style={{ marginTop: 6, width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: OEREB_STYLE.dot }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: "#fff", margin: 0 }}>{theme.themeName}</p>
            <span style={{ fontSize: 11, color: "#7B8299", fontFamily: "monospace" }}>{theme.themeCode}</span>
            {!federal && (
              <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 100, background: "rgba(167,139,250,0.12)", color: "#A78BFA" }}>kantonales Thema</span>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
            {theme.rows.map((r, i) => {
              const area = formatArea(r.areaPct, r.areaM2);
              const links = (r.lawLinks ?? []).filter((l) => l && (l.title || l.url));
              return (
                <div key={i} style={{ borderLeft: "2px solid rgba(251,146,60,0.25)", paddingLeft: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {(r.legendText || r.subTheme) && (
                      <span style={{ fontSize: 13, color: "#ABAEBB" }}>{r.legendText ?? r.subTheme}</span>
                    )}
                    <LegalStatusBadge status={r.legalStatus} />
                    {area && (
                      <span style={{ fontSize: 12, color: "#7B8299", whiteSpace: "nowrap" }}>{area}</span>
                    )}
                  </div>
                  {(links.length > 0 || r.authority?.name) && (
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
                      {links.map((l, j) =>
                        l.url ? (
                          <a key={j} href={l.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#85A6E9", textDecoration: "none" }}>
                            {l.title || "Rechtsvorschrift"} ↗
                          </a>
                        ) : (
                          <span key={j} style={{ fontSize: 12, color: "#7B8299" }}>{l.title}</span>
                        )
                      )}
                      {r.authority?.name && (
                        r.authority.url ? (
                          <a href={r.authority.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#7B8299", textDecoration: "none" }}>
                            Zuständig: {r.authority.name} ↗
                          </a>
                        ) : (
                          <span style={{ fontSize: 12, color: "#7B8299" }}>Zuständig: {r.authority.name}</span>
                        )
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {theme.norms.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
              {theme.norms.map((pn) => (
                <NormCard key={pn.id} pn={pn} onRemove={onRemove} />
              ))}
            </div>
          )}

          {showGapCard && (
            <div style={{ marginTop: 12, background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.25)", borderRadius: 10, padding: "10px 14px", display: "flex", gap: 10, alignItems: "flex-start" }}>
              <svg style={{ width: 14, height: 14, color: "#FBBF24", marginTop: 2, flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: "#FBBF24", margin: 0 }}>Keine Norm in der Bibliothek für dieses Thema.</p>
                <p style={{ fontSize: 12, color: "#ABAEBB", margin: "2px 0 0" }}>Norm hochladen oder Mapping im Admin ergänzen.</p>
              </div>
            </div>
          )}
          {!showGapCard && theme.norms.length === 0 && (
            <p style={{ fontSize: 12, color: "#7B8299", margin: "10px 0 0", fontStyle: "italic" }}>
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

// ── Seite ────────────────────────────────────────────────────────────────────

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
      const res = await api.post<{ zone: string | null; assigned_norms_count: number }>(
        `/projects/${params.id}/norms/refresh`, {}
      );
      flash(
        res.assigned_norms_count > 0
          ? `${res.assigned_norms_count} neue Norm${res.assigned_norms_count !== 1 ? "en" : ""} geladen.`
          : "Keine neuen Normen gefunden."
      );
      await load();
    } catch {
      flash("Fehler beim Laden der Normen.");
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
      if (res?.extract?.status && res.extract.status !== "ok") {
        flash(`ÖREB: ${res.extract.status_detail ?? "Abruf fehlgeschlagen."}`);
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
  const zoneOriginLabel =
    zoneSource === "manual" ? "manuell"
    : zoneSource === "oereb" ? (zoneConfidence === "coarse" ? "Grobklasse (ÖREB)" : "aus ÖREB")
    : null;

  const hasAnyContent = grouped.length > 0 || otherZoneNorms.length > 0 || affectsThemes.length > 0;

  const smallBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" };

  const fetchButton = (
    <button
      onClick={handleFetchOereb}
      disabled={fetchingOereb}
      style={{ ...smallBtn, background: "#2862D7", color: "#fff", opacity: fetchingOereb ? 0.6 : 1, cursor: fetchingOereb ? "not-allowed" : "pointer" }}
      onMouseEnter={e => { if (!fetchingOereb) (e.currentTarget as HTMLElement).style.background = "#3470E8"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#2862D7"; }}
    >
      {fetchingOereb ? "Wird abgerufen…" : "ÖREB abrufen"}
    </button>
  );

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, gap: 16 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#fff", margin: "0 0 4px" }}>Normen</h2>
          {project && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, color: "#ABAEBB" }}>
                {project.location.municipality}, Kanton {project.location.canton}
              </span>
              {project.parcel_number && (
                <span style={{ fontSize: 11, background: "rgba(133,166,233,0.1)", color: "#7B8299", padding: "2px 8px", borderRadius: 100 }}>
                  Parzelle {project.parcel_number}
                </span>
              )}
              {extract?.egrid && (
                <span title="Eidgenössischer Grundstücksidentifikator" style={{ fontSize: 11, background: "rgba(133,166,233,0.1)", color: "#7B8299", padding: "2px 8px", borderRadius: 100, fontFamily: "monospace" }}>
                  {extract.egrid}
                </span>
              )}
              {editingZone ? (
                <ZoneEditor projectId={project.id} initial={bauzone ?? ""} onSaved={handleZoneSaved} onCancel={() => setEditingZone(false)} />
              ) : bauzone ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span style={{ fontSize: 11, background: zoneConfidence === "coarse" ? "rgba(251,191,36,0.12)" : "rgba(40,98,215,0.12)", color: zoneConfidence === "coarse" ? "#FBBF24" : "#85A6E9", padding: "2px 8px", borderRadius: 100, fontWeight: 600 }}>
                    Zone {bauzone}{zoneOriginLabel ? ` · ${zoneOriginLabel}` : ""}
                  </span>
                  <button
                    onClick={() => setEditingZone(true)}
                    title="Bauzone bearbeiten"
                    style={{ padding: 4, borderRadius: 6, background: "none", border: "none", cursor: "pointer", color: "#7B8299", lineHeight: 0 }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#ABAEBB"}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "#7B8299"}
                  >
                    <svg style={{ width: 12, height: 12 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                </span>
              ) : null}
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {refreshMsg && (
            <span style={{ fontSize: 12, color: "#7B8299", maxWidth: 320 }}>{refreshMsg}</span>
          )}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 8, fontSize: 13, color: "#ABAEBB", border: "1px solid rgba(133,166,233,0.2)", background: "none", cursor: refreshing ? "not-allowed" : "pointer", opacity: refreshing ? 0.5 : 1, fontFamily: "inherit", transition: "background .15s", whiteSpace: "nowrap" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(133,166,233,0.08)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "none"; }}
          >
            <svg className={refreshing ? "animate-spin" : ""} style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Normen neu laden
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 8, fontSize: 13, color: "#fff", background: "#2862D7", border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 600, whiteSpace: "nowrap" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#3470E8"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#2862D7"; }}
          >
            <svg style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Spezialnorm hinzufügen
          </button>
        </div>
      </div>

      {/* ÖREB-Status-Banner */}
      {!loading && project && (
        !oerebSupported ? (
          <div style={{ marginBottom: 20, background: "rgba(133,166,233,0.05)", border: "1px solid rgba(133,166,233,0.15)", borderRadius: 12, padding: "10px 16px", display: "flex", alignItems: "center", gap: 10 }}>
            <svg style={{ width: 14, height: 14, color: "#7B8299", flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span style={{ fontSize: 12, color: "#7B8299" }}>ÖREB für Kanton {canton || "?"} noch nicht angebunden.</span>
          </div>
        ) : oerebError && !extract ? (
          <div style={{ marginBottom: 20, background: "rgba(133,166,233,0.05)", border: "1px solid rgba(133,166,233,0.15)", borderRadius: 12, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "#7B8299" }}>ÖREB-Daten nicht verfügbar: {oerebError}</span>
            {fetchButton}
          </div>
        ) : !extract || !extract.status ? (
          <div style={{ marginBottom: 20, background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.2)", borderRadius: 12, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <svg style={{ width: 16, height: 16, color: "#FBBF24", marginTop: 1, flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: "#FBBF24", margin: 0 }}>Noch kein ÖREB-Auszug für diese Parzelle</p>
                <p style={{ fontSize: 12, color: "#ABAEBB", margin: "2px 0 0" }}>
                  Der Auszug liefert Bauzone und parzellenspezifische Einschränkungen aus dem ÖREB-Kataster {canton}.
                </p>
              </div>
            </div>
            {fetchButton}
          </div>
        ) : extract.status !== "ok" ? (
          <div style={{ marginBottom: 20, background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: 12, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <svg style={{ width: 16, height: 16, color: "#F87171", marginTop: 1, flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: "#F87171", margin: 0 }}>
                  ÖREB-Abruf fehlgeschlagen
                  <span style={{ fontWeight: 400, color: "#7B8299", fontFamily: "monospace", fontSize: 11, marginLeft: 8 }}>{extract.status}</span>
                </p>
                <p style={{ fontSize: 12, color: "#ABAEBB", margin: "2px 0 0" }}>
                  {extract.status_detail ?? "Keine Details vorhanden."}{extract.fetched_at ? ` · Versuch vom ${formatDate(extract.fetched_at)}` : ""}
                </p>
              </div>
            </div>
            {fetchButton}
          </div>
        ) : (
          <div style={{ marginBottom: 20, background: "rgba(251,146,60,0.05)", border: `1px solid ${OEREB_STYLE.cardBorder}`, borderRadius: 12, padding: "10px 16px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: OEREB_STYLE.dot, flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: "#ABAEBB" }}>
              ÖREB-Auszug vom <strong style={{ color: "#fff", fontWeight: 600 }}>{formatDate(extract.fetched_at)}</strong>
              {" · "}{themeCount} Themen
              {" · "}<strong style={{ color: OEREB_STYLE.badgeText, fontWeight: 600 }}>{affectsCount}</strong> betreffen die Parzelle
              {" · "}{noDataCount} ohne Daten
              {gapCount > 0 && <>{" · "}<span style={{ color: "#FBBF24" }}>{gapCount} ohne Norm</span></>}
            </span>
          </div>
        )
      )}

      {/* Bauzone fehlt */}
      {!loading && bauzoneUnknown && !editingZone && (
        <div style={{ marginBottom: 20, background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.2)", borderRadius: 12, padding: "12px 16px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <svg style={{ width: 16, height: 16, color: "#FBBF24", marginTop: 2, flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: "#FBBF24", margin: 0 }}>Bauzone nicht bekannt</p>
              <p style={{ fontSize: 12, color: "#ABAEBB", margin: "3px 0 0" }}>
                {oerebSupported
                  ? extractOk
                    ? "Der ÖREB-Auszug enthält keine eindeutige Bauzone für diese Parzelle. Bitte trage die Zone manuell ein, damit zonenspezifische Normen geladen werden können."
                    : "Die Bauzone wird aus dem ÖREB-Auszug übernommen. Solange keiner vorliegt, kannst du sie manuell eintragen."
                  : "Für diesen Kanton ist keine automatische Zonenermittlung angebunden. Bitte trage die Zone manuell ein, damit zonenspezifische Normen geladen werden können."}
              </p>
              <div style={{ marginTop: 12 }}>
                <ZoneEditor projectId={params.id} initial="" onSaved={handleZoneSaved} accent="rgba(251,191,36,0.3)" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[...Array(5)].map((_, i) => (
            <div key={i} className="animate-pulse" style={{ background: "rgba(23,37,64,0.55)", border: "1px solid rgba(133,166,233,0.1)", borderRadius: 12, padding: 16 }}>
              <div style={{ height: 10, background: "rgba(133,166,233,0.1)", borderRadius: 4, width: "28%", marginBottom: 8 }} />
              <div style={{ height: 10, background: "rgba(133,166,233,0.07)", borderRadius: 4, width: "72%" }} />
            </div>
          ))}
        </div>
      ) : !hasAnyContent ? (
        <div style={{ background: "rgba(23,37,64,0.55)", border: "1px solid rgba(133,166,233,0.1)", borderRadius: 16, padding: "64px 24px", textAlign: "center" }}>
          <div style={{ width: 40, height: 40, background: "rgba(40,98,215,0.12)", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
            <svg style={{ width: 20, height: 20, color: "#85A6E9" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <p style={{ fontSize: 14, fontWeight: 600, color: "#ABAEBB", margin: 0 }}>Noch keine Normen zugewiesen</p>
          <p style={{ fontSize: 12, color: "#7B8299", margin: "4px 0 0" }}>
            Klicke auf «Normen neu laden» oder füge eine Spezialnorm manuell hinzu.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
          {grouped.length === 0 && affectsThemes.length === 0 && (
            <div style={{ background: "rgba(23,37,64,0.55)", border: "1px solid rgba(133,166,233,0.1)", borderRadius: 16, padding: "32px 24px", textAlign: "center" }}>
              <p style={{ fontSize: 13, color: "#ABAEBB", margin: 0 }}>
                Keine Normen für die aktuelle Bauzone{bauzone ? ` (${bauzone})` : ""}.
              </p>
            </div>
          )}

          {/* Bund / Kanton / Gemeinde */}
          {grouped.filter((g) => g.label !== "Spezialnormen").map((grp) => (
            <div key={grp.label}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: grp.dot }} />
                <h3 style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: grp.header, margin: 0 }}>
                  {grp.label}
                </h3>
                <span style={{ fontSize: 12, color: "#7B8299" }}>{grp.norms.length}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {grp.norms.map((pn) => (
                  <NormCard key={pn.id} pn={pn} onRemove={handleRemove} />
                ))}
              </div>
            </div>
          ))}

          {/* Parzellenspezifisch (ÖREB) */}
          {affectsThemes.length > 0 && (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: OEREB_STYLE.dot }} />
                <h3 style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: OEREB_STYLE.header, margin: 0 }}>
                  Parzellenspezifisch (ÖREB)
                </h3>
                <span style={{ fontSize: 12, color: "#7B8299" }}>{affectsThemes.length}</span>
                {gapCount > 0 && (
                  <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 100, background: "rgba(251,191,36,0.12)", color: "#FBBF24" }}>
                    {gapCount} Lücke{gapCount !== 1 ? "n" : ""}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {affectsThemes.map((t) => (
                  <ThemeBlock key={t.themeCode} theme={t} isGap={gapCodes.has(t.themeCode)} onRemove={handleRemove} />
                ))}
              </div>

              {noDataThemes.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <button
                    onClick={() => setShowNoData((v) => !v)}
                    style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "inherit" }}
                  >
                    <svg style={{ width: 12, height: 12, color: "#7B8299", transform: showNoData ? "rotate(90deg)" : "none", transition: "transform .15s" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <h4 style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#7B8299", margin: 0 }}>
                      Ohne Daten ({noDataThemes.length})
                    </h4>
                    <span style={{ fontSize: 11, color: "#7B8299" }}>— Themen, für die der Kataster keine Daten publiziert</span>
                  </button>
                  {showNoData && (
                    <ul style={{ margin: 0, padding: "0 0 0 20px", display: "flex", flexDirection: "column", gap: 4 }}>
                      {noDataThemes.map((t) => (
                        <li key={t.themeCode} style={{ fontSize: 12, color: "#7B8299" }}>
                          {t.themeName} <span style={{ fontFamily: "monospace", fontSize: 11, opacity: 0.7 }}>{t.themeCode}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Spezialnormen */}
          {grouped.filter((g) => g.label === "Spezialnormen").map((grp) => (
            <div key={grp.label}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: grp.dot }} />
                <h3 style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: grp.header, margin: 0 }}>
                  {grp.label}
                </h3>
                <span style={{ fontSize: 12, color: "#7B8299" }}>{grp.norms.length}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {grp.norms.map((pn) => (
                  <NormCard key={pn.id} pn={pn} onRemove={handleRemove} />
                ))}
              </div>
            </div>
          ))}

          {otherZoneNorms.length > 0 && (
            <div>
              <button
                onClick={() => setShowOtherZones((v) => !v)}
                style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "inherit" }}
              >
                <svg style={{ width: 12, height: 12, color: "#7B8299", transform: showOtherZones ? "rotate(90deg)" : "none", transition: "transform .15s" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <h3 style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#7B8299", margin: 0 }}>
                  Andere Zonen — nicht zutreffend{bauzone ? ` für ${bauzone}` : ""}
                </h3>
                <span style={{ fontSize: 12, color: "#7B8299" }}>{otherZoneNorms.length}</span>
              </button>
              {showOtherZones && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, opacity: 0.6 }}>
                  {otherZoneNorms.map((pn) => (
                    <NormCard key={pn.id} pn={pn} onRemove={handleRemove} />
                  ))}
                </div>
              )}
            </div>
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

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
