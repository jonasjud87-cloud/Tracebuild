"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Eyebrow } from "./primitives";
import ShowcasePlanCheck from "./ShowcasePlanCheck";
import ShowcaseNormDb from "./ShowcaseNormDb";
import { findNorm } from "@/lib/landing/norms-sample";
import { EASE_OUT, inView } from "@/lib/landing/motion";

type Tab = "plan" | "normen";

const TABS: { id: Tab; label: string }[] = [
  { id: "plan", label: "Planprüfung" },
  { id: "normen", label: "Normen-Datenbank" },
];

const COPY: Record<Tab, { h: React.ReactNode; p: string }> = {
  plan: {
    h: (
      <>
        Sehen Sie jeden Konflikt,
        <br />
        bevor die Behörde ihn sieht.
      </>
    ),
    p: "PDF hochladen - die KI prüft gegen SIA-Normen und kantonales Recht und erstellt einen Bericht: jeder Befund mit Massangabe, Norm-Verweis und Kommentar. Ändern und freigeben bleibt bei Ihnen.",
  },
  normen: {
    h: (
      <>
        Alle Normen. Eine Quelle.
        <br />
        Zum Nachschlagen.
      </>
    ),
    p: "Übersichtlich, durchsuchbar, verlinkt. Sie sehen schnell, was gilt und seit wann - von SIA über VSS bis zur kantonalen Bauordnung.",
  },
};

export default function Showcase() {
  const [tab, setTab] = useState<Tab>("plan");
  const [normQuery, setNormQuery] = useState("");
  const [focusNormId, setFocusNormId] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => {
      if (window.location.hash === "#normen-datenbank") setTab("normen");
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const openNorm = useCallback((id: string) => {
    setFocusNormId(id);
    setNormQuery(findNorm(id)?.code ?? "");
    setTab("normen");
  }, []);

  const useInCheck = useCallback(() => {
    setFocusNormId(null);
    setTab("plan");
  }, []);

  return (
    <section
      id="produkt"
      style={{ position: "relative", padding: "var(--tb-section-y) var(--tb-gutter)" }}
    >
      <span id="normen-datenbank" style={{ position: "absolute", top: -90 }} />

      <div style={{ maxWidth: "var(--tb-max-wide)", margin: "0 auto" }}>
        <Eyebrow>Produkt</Eyebrow>

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 24, margin: "18px 0 28px" }}>
          <div style={{ maxWidth: 640 }}>
            <motion.h2
              key={tab}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: EASE_OUT }}
              style={{ fontSize: "clamp(26px,3.4vw,44px)", margin: 0 }}
            >
              {COPY[tab].h}
            </motion.h2>
            <motion.p
              key={`${tab}-p`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4, ease: EASE_OUT, delay: 0.05 }}
              style={{
                margin: "14px 0 0",
                fontSize: 15,
                lineHeight: 1.6,
                color: "var(--tb-text-secondary)",
                textWrap: "pretty" as React.CSSProperties["textWrap"],
              }}
            >
              {COPY[tab].p}
            </motion.p>
          </div>

          {/* segmented control */}
          <div style={{ display: "inline-flex", gap: 4, padding: 4, borderRadius: "var(--tb-r-btn)", background: "var(--tb-glass)", border: "1px solid var(--tb-border)" }}>
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setTab(t.id);
                  if (t.id === "normen") setFocusNormId(null);
                }}
                style={{
                  position: "relative",
                  fontSize: 12.5,
                  fontWeight: 500,
                  color: tab === t.id ? "var(--tb-text)" : "var(--tb-text-tertiary)",
                  background: "none",
                  border: "none",
                  borderRadius: "var(--tb-r-chip)",
                  padding: "8px 16px",
                  cursor: "pointer",
                }}
              >
                {tab === t.id && (
                  <motion.span
                    layoutId="tb-sc-tab"
                    transition={{ duration: 0.32, ease: EASE_OUT }}
                    style={{ position: "absolute", inset: 0, borderRadius: "var(--tb-r-chip)", background: "var(--tb-glass-hover)", border: "1px solid var(--tb-border)" }}
                  />
                )}
                <span style={{ position: "relative" }}>{t.label}</span>
                {tab === t.id && (
                  <motion.span
                    layoutId="tb-sc-tab-underline"
                    transition={{ duration: 0.32, ease: EASE_OUT }}
                    style={{ position: "absolute", left: 12, right: 12, bottom: 2, height: 2, borderRadius: 2, background: "var(--tb-accent-gradient)" }}
                  />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* device frame */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={inView}
          transition={{ duration: 0.72, ease: EASE_OUT }}
          style={{
            borderRadius: "var(--tb-r-container)",
            border: "1px solid var(--tb-border-strong)",
            background: "var(--tb-glass)",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
            boxShadow: "var(--tb-lift)",
            overflow: "hidden",
          }}
        >
          <motion.div
            key={tab}
            initial={{ opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.28, ease: EASE_OUT }}
            style={{ minHeight: 440 }}
          >
            {tab === "plan" ? (
              <ShowcasePlanCheck onOpenNorm={openNorm} />
            ) : (
              <ShowcaseNormDb query={normQuery} focusNormId={focusNormId} onUseInCheck={useInCheck} />
            )}
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
