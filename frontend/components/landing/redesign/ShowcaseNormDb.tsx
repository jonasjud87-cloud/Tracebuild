"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  SAMPLE_NORMS,
  CANTONS,
  WORKS,
  THEMES,
  findNorm,
  type NormWork,
} from "@/lib/landing/norms-sample";
import { EASE_OUT } from "@/lib/landing/motion";

const TICKER = [
  "SIA 380/1 · vor 3 Tagen",
  "Art. 24 BZO Zürich · vor 1 Woche",
  "VSS 40 281 · vor 2 Wochen",
  "SIA 232/1 · vor 3 Wochen",
];

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 11,
        padding: "4px 10px",
        borderRadius: "var(--tb-r-pill)",
        border: "1px solid",
        borderColor: active ? "var(--tb-border-strong)" : "var(--tb-border)",
        background: active ? "var(--tb-glass-hover)" : "transparent",
        color: active ? "var(--tb-text)" : "var(--tb-text-tertiary)",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

export default function ShowcaseNormDb({
  query,
  focusNormId,
  onUseInCheck,
}: {
  query: string;
  focusNormId: string | null;
  onUseInCheck: () => void;
}) {
  const [q, setQ] = useState(query);
  const [cantons, setCantons] = useState<Set<string>>(new Set());
  const [works, setWorks] = useState<Set<NormWork>>(new Set());
  const [themes, setThemes] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(focusNormId);
  const [tick, setTick] = useState(0);

  useEffect(() => setQ(query), [query]);
  useEffect(() => setSelected(focusNormId), [focusNormId]);

  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => (n + 1) % TICKER.length), 4000);
    return () => window.clearInterval(t);
  }, []);

  function toggle<T>(set: Set<T>, v: T, upd: (s: Set<T>) => void) {
    const next = new Set(set);
    next.has(v) ? next.delete(v) : next.add(v);
    upd(next);
  }

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return SAMPLE_NORMS.filter((n) => {
      if (cantons.size && !(n.canton && cantons.has(n.canton))) return false;
      if (works.size && !works.has(n.work)) return false;
      if (themes.size && !themes.has(n.theme)) return false;
      if (!needle) return true;
      return (
        n.code.toLowerCase().includes(needle) ||
        n.title.toLowerCase().includes(needle) ||
        n.theme.toLowerCase().includes(needle) ||
        n.body.toLowerCase().includes(needle)
      );
    });
  }, [q, cantons, works, themes]);

  const norm = selected ? findNorm(selected) : null;

  return (
    <div className="tb-sc-grid" style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 1, background: "var(--tb-hairline)" }}>
      {/* ── facet rail ───────────────────────────────────────── */}
      <div className="tb-sc-facets" style={{ background: "var(--tb-canvas-solid)", padding: "14px 14px", display: "flex", flexDirection: "column", gap: 16, overflowY: "auto" }}>
        <FacetGroup label="Kanton">
          {CANTONS.map((c) => (
            <Chip key={c} active={cantons.has(c)} onClick={() => toggle(cantons, c, setCantons)}>
              {c}
            </Chip>
          ))}
        </FacetGroup>
        <FacetGroup label="Normenwerk">
          {WORKS.map((w) => (
            <Chip key={w} active={works.has(w)} onClick={() => toggle(works, w, setWorks)}>
              {w}
            </Chip>
          ))}
        </FacetGroup>
        <FacetGroup label="Thema">
          {THEMES.map((t) => (
            <Chip key={t} active={themes.has(t)} onClick={() => toggle(themes, t, setThemes)}>
              {t}
            </Chip>
          ))}
        </FacetGroup>
      </div>

      {/* ── main ─────────────────────────────────────────────── */}
      <div style={{ background: "var(--tb-canvas-solid)", display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--tb-hairline)", display: "flex", gap: 12, alignItems: "center" }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Norm, Artikel oder Stichwort suchen - z. B. Grenzabstand"
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 12.5,
              color: "var(--tb-text)",
              background: "var(--tb-glass)",
              border: "1px solid var(--tb-border)",
              borderRadius: "var(--tb-r-chip)",
              padding: "8px 12px",
              outline: "none",
              fontFamily: "inherit",
            }}
          />
          <span className="tb-sc-ticker" style={{ fontSize: 10.5, color: "var(--tb-text-muted)", whiteSpace: "nowrap" }}>
            Zuletzt aktualisiert:{" "}
            <span style={{ color: "var(--tb-info)" }}>{TICKER[tick]}</span>
          </span>
        </div>

        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          {/* list */}
          <div style={{ position: "absolute", inset: 0, overflowY: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            {results.length === 0 && (
              <p style={{ fontSize: 12, color: "var(--tb-text-muted)", padding: 12 }}>Keine Norm gefunden.</p>
            )}
            {results.map((n, i) => (
              <motion.button
                key={n.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, ease: EASE_OUT, delay: Math.min(i, 8) * 0.04 }}
                onClick={() => setSelected(n.id)}
                style={{
                  textAlign: "left",
                  background: "var(--tb-glass)",
                  border: "1px solid var(--tb-hairline)",
                  borderRadius: "var(--tb-r-chip)",
                  padding: "10px 12px",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: 5,
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 600,
                      fontVariantNumeric: "tabular-nums",
                      color: "var(--tb-accent)",
                      border: "1px solid var(--tb-border)",
                      borderRadius: 6,
                      padding: "1px 6px",
                    }}
                  >
                    {n.code}
                  </span>
                  <span style={{ fontSize: 12.5, color: "var(--tb-text)" }}>{n.title}</span>
                </span>
                <span style={{ display: "flex", gap: 8, fontSize: 10, color: "var(--tb-text-muted)" }}>
                  <span>{n.canton ?? "CH"}</span>
                  <span>·</span>
                  <span>{n.theme}</span>
                  <span>·</span>
                  <span style={{ color: "var(--tb-info)" }}>aktualisiert {n.updated}</span>
                </span>
              </motion.button>
            ))}
          </div>

          {/* reading pane */}
          <AnimatePresence>
            {norm && (
              <motion.div
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                exit={{ x: "100%" }}
                transition={{ duration: 0.32, ease: EASE_OUT }}
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "var(--tb-float)",
                  borderLeft: "1px solid var(--tb-border)",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--tb-hairline)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 10.5, color: "var(--tb-text-muted)", fontVariantNumeric: "tabular-nums" }}>{norm.breadcrumb}</span>
                  <button
                    onClick={() => setSelected(null)}
                    style={{ fontSize: 11, color: "var(--tb-text-tertiary)", background: "none", border: "none", cursor: "pointer" }}
                  >
                    ← Zurück
                  </button>
                </div>
                <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--tb-accent)", border: "1px solid var(--tb-border)", borderRadius: 6, padding: "2px 7px", fontVariantNumeric: "tabular-nums" }}>
                      {norm.code}
                    </span>
                    <span style={{ fontSize: 10, color: "var(--tb-info)" }}>aktualisiert {norm.updated}</span>
                  </div>
                  <h4 style={{ margin: 0, fontSize: 15, color: "var(--tb-text)", fontFamily: "var(--font-display, sans-serif)" }}>{norm.title}</h4>
                  <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.7, color: "var(--tb-text-bright)" }}>
                    {renderWithClause(norm.body, norm.clause)}
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {norm.related.map((rid) => {
                      const r = findNorm(rid);
                      if (!r) return null;
                      return (
                        <button
                          key={rid}
                          onClick={() => setSelected(rid)}
                          style={{ fontSize: 10.5, color: "var(--tb-text-tertiary)", background: "var(--tb-glass)", border: "1px solid var(--tb-border)", borderRadius: "var(--tb-r-pill)", padding: "3px 9px", cursor: "pointer" }}
                        >
                          {r.code}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    onClick={onUseInCheck}
                    style={{
                      alignSelf: "flex-start",
                      marginTop: 4,
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: "var(--tb-on-accent)",
                      background: "var(--tb-accent-gradient)",
                      border: "none",
                      borderRadius: "var(--tb-r-chip)",
                      padding: "8px 14px",
                      cursor: "pointer",
                    }}
                  >
                    Diese Norm in einer Prüfung verwenden →
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <style>{`
        @media (max-width: 760px) {
          .tb-sc-grid { grid-template-columns: 1fr !important; }
          .tb-sc-facets { flex-direction: row !important; flex-wrap: wrap; }
          .tb-sc-ticker { display: none !important; }
        }
      `}</style>
    </div>
  );
}

function FacetGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--tb-text-muted)", marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{children}</div>
    </div>
  );
}

function renderWithClause(body: string, clause: string) {
  const idx = body.indexOf(clause);
  if (idx === -1) return body;
  return (
    <>
      {body.slice(0, idx)}
      <mark
        style={{
          background: "transparent",
          color: "var(--tb-text)",
          borderBottom: "2px solid var(--tb-accent)",
          padding: "0 1px",
        }}
      >
        {clause}
      </mark>
      {body.slice(idx + clause.length)}
    </>
  );
}
