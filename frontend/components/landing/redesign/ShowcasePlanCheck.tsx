"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

type Severity = "verstoss" | "hinweis" | "referenz";

type Finding = {
  id: string;
  severity: Severity;
  title: string;
  measured: string;
  required: string;
  note: string;
  normId: string;
  normLabel: string;
};

const FINDINGS: Finding[] = [
  {
    id: "f1",
    severity: "verstoss",
    title: "Grenzabstand West unterschritten",
    measured: "2.80 m",
    required: "≥ 3.50 m",
    note: "Kleiner Grenzabstand zur Parzelle 1487.",
    normId: "pbg-zh-260",
    normLabel: "§ 260 PBG ZH",
  },
  {
    id: "f2",
    severity: "verstoss",
    title: "Gebäudehöhe über Zonenmass",
    measured: "12.30 m",
    required: "≤ 11.50 m",
    note: "Wohnzone W3, gemessen ab gewachsenem Terrain.",
    normId: "bzo-zh-24",
    normLabel: "Art. 24 BZO Zürich",
  },
  {
    id: "f3",
    severity: "verstoss",
    title: "Waldabstand unterschritten",
    measured: "24 m",
    required: "≥ 30 m",
    note: "Nordöstliche Gebäudeecke zum Waldrand.",
    normId: "waldg-abstand",
    normLabel: "Art. 13 KWaG BE",
  },
  {
    id: "f4",
    severity: "hinweis",
    title: "Türbreite Bad grenzwertig",
    measured: "0.75 m",
    required: "≥ 0.80 m",
    note: "Hindernisfreie Erschliessung, lichte Durchgangsbreite.",
    normId: "sia-500",
    normLabel: "SIA 500",
  },
  {
    id: "f5",
    severity: "hinweis",
    title: "Fensteranteil Südfassade",
    measured: "48 %",
    required: "Nachweis Qh",
    note: "Hoher Glasanteil, Heizwärmebedarf prüfen.",
    normId: "sia-380-1",
    normLabel: "SIA 380/1",
  },
  {
    id: "f6",
    severity: "referenz",
    title: "Parkfeld-Nachweis offen",
    measured: "3 Felder",
    required: "1 je Wohnung",
    note: "4 Wohnungen geplant, ein Parkfeld fehlt im Plan.",
    normId: "vss-40-281",
    normLabel: "VSS 40 281",
  },
];

const SEV: Record<Severity, { label: string; color: string }> = {
  verstoss: { label: "Verstoss", color: "var(--tb-danger-bright)" },
  hinweis: { label: "Hinweis", color: "var(--tb-warn-bright)" },
  referenz: { label: "Referenz", color: "var(--tb-info)" },
};

type Filter = "alle" | "verstoss" | "hinweis";

export default function ShowcasePlanCheck({ onOpenNorm }: { onOpenNorm: (id: string) => void }) {
  const [filter, setFilter] = useState<Filter>("alle");
  const [scanKey, setScanKey] = useState(0);
  const [scanning, setScanning] = useState(false);
  const scanTimer = useRef<number>();

  useEffect(() => () => window.clearTimeout(scanTimer.current), []);

  const visible = FINDINGS.filter((f) => {
    if (filter === "alle") return true;
    if (filter === "verstoss") return f.severity === "verstoss";
    return f.severity === "hinweis" || f.severity === "referenz";
  });

  const counts = {
    verstoss: FINDINGS.filter((f) => f.severity === "verstoss").length,
    hinweis: FINDINGS.filter((f) => f.severity !== "verstoss").length,
  };

  function recheck() {
    window.clearTimeout(scanTimer.current);
    setScanning(true);
    setScanKey((k) => k + 1);
    scanTimer.current = window.setTimeout(() => setScanning(false), 1200);
  }

  return (
    <div
      className="tb-sc-grid"
      style={{ display: "grid", gridTemplateColumns: "1.55fr 1fr", gap: 1, background: "var(--tb-hairline)" }}
    >
      {/* ── report (main) ────────────────────────────────────── */}
      <div style={{ background: "var(--tb-canvas-solid)", display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--tb-hairline)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--tb-text)" }}>Prüfbericht</div>
            <div style={{ fontSize: 11, color: "var(--tb-text-tertiary)", marginTop: 3 }}>
              Grundriss_EG.pdf · {counts.verstoss} Verstösse · {counts.hinweis} Hinweise · Stand 01.09.2026
            </div>
          </div>
          <button
            onClick={recheck}
            style={{
              flexShrink: 0,
              fontSize: 11,
              fontWeight: 600,
              color: "var(--tb-on-accent)",
              background: "var(--tb-accent-gradient)",
              border: "none",
              borderRadius: "var(--tb-r-chip)",
              padding: "7px 13px",
              cursor: "pointer",
            }}
          >
            Neu prüfen
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, padding: "10px 18px", borderBottom: "1px solid var(--tb-hairline)" }}>
          {(["alle", "verstoss", "hinweis"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                fontSize: 11,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                padding: "5px 11px",
                borderRadius: "var(--tb-r-pill)",
                border: "1px solid",
                borderColor: filter === f ? "var(--tb-border-strong)" : "var(--tb-border)",
                background: filter === f ? "var(--tb-glass-hover)" : "transparent",
                color: filter === f ? "var(--tb-text)" : "var(--tb-text-tertiary)",
                cursor: "pointer",
              }}
            >
              {f === "alle" ? "Alle" : f === "verstoss" ? "Verstoss" : "Hinweis"}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {visible.map((f) => (
            <div
              key={f.id}
              className="tb-sc-finding"
              style={{
                borderRadius: "var(--tb-r-chip)",
                border: "1px solid var(--tb-hairline)",
                background: "var(--tb-glass)",
                padding: "12px 14px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
                transition: "border-color .16s, background .16s",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 13, color: "var(--tb-text)", fontWeight: 500 }}>{f.title}</span>
                <span
                  style={{
                    flexShrink: 0,
                    fontSize: 9.5,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: SEV[f.severity].color,
                  }}
                >
                  {SEV[f.severity].label}
                </span>
              </div>

              <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5, color: "var(--tb-text-tertiary)" }}>{f.note}</p>

              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 16px", fontSize: 11 }}>
                <span style={{ color: "var(--tb-text-tertiary)" }}>
                  Gemessen <b style={{ color: "var(--tb-text)", fontWeight: 600 }}>{f.measured}</b>
                </span>
                <span style={{ color: "var(--tb-text-tertiary)" }}>
                  Erforderlich <b style={{ color: "var(--tb-text)", fontWeight: 600 }}>{f.required}</b>
                </span>
                <button
                  onClick={() => onOpenNorm(f.normId)}
                  style={{
                    marginLeft: "auto",
                    fontSize: 10.5,
                    fontWeight: 500,
                    color: "var(--tb-accent)",
                    background: "none",
                    border: "1px solid var(--tb-border)",
                    borderRadius: "var(--tb-r-chip)",
                    padding: "4px 9px",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {f.normLabel} · öffnen →
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── plan (reference) ─────────────────────────────────── */}
      <div className="tb-sc-plan-col" style={{ background: "var(--tb-canvas-solid)", display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--tb-hairline)", fontSize: 12, color: "var(--tb-text-tertiary)" }}>
          <span style={{ color: "var(--tb-text-bright)", fontWeight: 500 }}>Grundriss_EG.pdf</span>
        </div>

        <div style={{ position: "relative", flex: 1, padding: 16, overflowX: "auto" }}>
          <div style={{ position: "relative", minWidth: 260, width: "100%", aspectRatio: "400 / 300" }}>
            <svg viewBox="0 0 400 300" style={{ width: "100%", height: "100%", display: "block" }}>
              <rect x="8" y="8" width="384" height="284" fill="none" stroke="var(--tb-hairline)" strokeWidth="1" strokeDasharray="4 4" />
              <line x1="8" y1="270" x2="392" y2="270" stroke="rgba(255,255,255,0.14)" strokeWidth="6" />
              <text x="12" y="264" fill="var(--tb-text-muted)" fontSize="8">Quartierstrasse</text>
              <rect x="46" y="40" width="300" height="190" fill="none" stroke="var(--tb-accent)" strokeOpacity="0.35" strokeWidth="1" strokeDasharray="2 5" />
              <rect x="78" y="66" width="236" height="140" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.28)" strokeWidth="1.4" />
              <line x1="196" y1="66" x2="196" y2="206" stroke="rgba(255,255,255,0.22)" strokeWidth="1" />
              <line x1="78" y1="140" x2="314" y2="140" stroke="rgba(255,255,255,0.22)" strokeWidth="1" />
              <line x1="255" y1="140" x2="255" y2="206" stroke="rgba(255,255,255,0.22)" strokeWidth="1" />
              <text x="96" y="106" fill="var(--tb-text-muted)" fontSize="8">Wohnen</text>
              <text x="214" y="106" fill="var(--tb-text-muted)" fontSize="8">Zimmer</text>
              <text x="96" y="180" fill="var(--tb-text-muted)" fontSize="8">Küche</text>
              <text x="210" y="180" fill="var(--tb-text-muted)" fontSize="8">Bad</text>
              <g transform="translate(366,32)">
                <path d="M0,-10 L4,6 L0,2 L-4,6 Z" fill="var(--tb-text-tertiary)" />
                <text x="-3" y="20" fill="var(--tb-text-muted)" fontSize="8">N</text>
              </g>
            </svg>

            <AnimatePresence>
              {scanning && (
                <motion.div
                  key={scanKey}
                  initial={{ top: "-6%", opacity: 0 }}
                  animate={{ top: "104%", opacity: [0, 1, 1, 0] }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 1, ease: "linear" }}
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    height: 2,
                    background: "linear-gradient(90deg, transparent, var(--tb-info), transparent)",
                    boxShadow: "0 0 18px 2px rgba(143,179,245,0.5)",
                  }}
                />
              )}
            </AnimatePresence>
          </div>
        </div>

        <div style={{ padding: "10px 16px", borderTop: "1px solid var(--tb-hairline)", fontSize: 10.5, color: "var(--tb-text-muted)" }}>
          Markierung der Fundstellen direkt im Plan folgt.
        </div>
      </div>

      <style>{`
        .tb-sc-finding:hover { border-color: var(--tb-border-strong); background: var(--tb-glass-hover); }
        @media (max-width: 820px) {
          .tb-sc-grid { grid-template-columns: 1fr !important; }
          .tb-sc-plan-col { order: 2; }
        }
      `}</style>
    </div>
  );
}
