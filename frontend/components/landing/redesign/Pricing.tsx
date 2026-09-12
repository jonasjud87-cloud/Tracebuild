"use client";

import { motion } from "framer-motion";
import { Eyebrow } from "./primitives";
import { EASE_OUT, staggerParent, cardReveal, inView } from "@/lib/landing/motion";

type Tier = {
  name: string;
  for: string;
  price: string;
  features: string[];
  cta: string;
  featured?: boolean;
};

const TIERS: Tier[] = [
  {
    name: "Starter",
    for: "Für einzelne Fachpersonen und kleine Büros.",
    price: "Auf Anfrage",
    features: [
      "Begrenzte Prüfungen pro Monat",
      "Normen-Datenbank (Lesezugriff)",
      "1 Nutzer",
      "E-Mail-Support",
    ],
    cta: "Demo anfragen",
  },
  {
    name: "Team",
    for: "Für Büros mit laufenden Eingaben.",
    price: "Auf Anfrage",
    featured: true,
    features: [
      "Alles aus Starter, plus:",
      "Unbegrenzte Prüfungen",
      "Revisionssichere Exporte",
      "Mehrere Nutzer",
      "Persönliche Ansprechperson",
      "Normen-Änderungs-Alerts",
    ],
    cta: "Demo anfragen",
  },
  {
    name: "Enterprise",
    for: "Für grosse Büros und Generalplaner.",
    price: "Individuell",
    features: [
      "Alles aus Team, plus:",
      "SSO",
      "API-Zugang",
      "Individuelle Normensets",
      "SLA",
      "Onboarding vor Ort",
    ],
    cta: "Kontakt aufnehmen",
  },
];

function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden style={{ flexShrink: 0, marginTop: 3 }}>
      <path d="M2.5 7.5 L6 11 L11.5 3.5" fill="none" stroke="var(--tb-accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Pricing() {
  return (
    <section id="preise" style={{ position: "relative", padding: "var(--tb-section-y) var(--tb-gutter)" }}>
      <div style={{ maxWidth: "var(--tb-max)", margin: "0 auto" }}>
        <div style={{ textAlign: "center" }}>
          <Eyebrow>Preise</Eyebrow>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={inView}
            transition={{ duration: 0.6, ease: EASE_OUT }}
            style={{ fontSize: "clamp(28px,4vw,48px)", margin: "18px 0 14px" }}
          >
            Ein Plan pro Bürogrösse.
          </motion.h2>
          <p style={{ fontSize: 15, color: "var(--tb-text-secondary)", maxWidth: 480, margin: "0 auto 48px", lineHeight: 1.6 }}>
            Transparente Stufen, an Ihr Eingabevolumen angepasst. Details im Gespräch.
          </p>
        </div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={inView}
          variants={staggerParent(0.09)}
          className="tb-price-grid"
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 18, alignItems: "start" }}
        >
          {TIERS.map((t) => (
            <motion.div
              key={t.name}
              variants={cardReveal}
              className={`tb-price-card${t.featured ? " tb-price-featured" : ""}`}
              style={{
                position: "relative",
                borderRadius: "var(--tb-r-container)",
                padding: t.featured ? 2 : 0,
                background: t.featured
                  ? "linear-gradient(120deg,#4fd1ff,#38bdf8,#2862d7,#4fd1ff)"
                  : "transparent",
                backgroundSize: "200% 100%",
              }}
            >
              <div
                style={{
                  height: "100%",
                  borderRadius: t.featured ? 22 : "var(--tb-r-container)",
                  border: t.featured ? "none" : "1px solid var(--tb-border)",
                  background: t.featured ? "rgba(10,20,32,0.92)" : "var(--tb-glass)",
                  padding: t.featured ? "44px 30px" : "34px 28px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--tb-text-bright)" }}>
                    {t.name}
                  </span>
                  {t.featured && (
                    <span style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--tb-lavender)" }}>
                      Empfohlen
                    </span>
                  )}
                </div>
                <p style={{ margin: "2px 0 18px", fontSize: 13, color: "var(--tb-text-tertiary)", lineHeight: 1.5, minHeight: 38 }}>
                  {t.for}
                </p>
                <p style={{ margin: "0 0 24px", fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--tb-text)", fontFamily: "var(--font-display, sans-serif)" }}>
                  {t.price}
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "0 0 28px" }}>
                  {t.features.map((f) => (
                    <span key={f} style={{ display: "flex", gap: 9, fontSize: 13.5, color: "var(--tb-text-bright)", lineHeight: 1.45 }}>
                      <Check />
                      {f}
                    </span>
                  ))}
                </div>
                <a
                  href="#kontakt"
                  className={t.featured ? "tb-btn-grad" : "tb-btn-ghost"}
                  style={{
                    marginTop: "auto",
                    display: "block",
                    textAlign: "center",
                    padding: "12px",
                    borderRadius: "var(--tb-r-btn)",
                    fontSize: 12.5,
                    fontWeight: 600,
                    letterSpacing: "0.03em",
                    textTransform: "uppercase",
                    textDecoration: "none",
                    ...(t.featured
                      ? { background: "var(--tb-accent-gradient)", color: "var(--tb-on-accent)" }
                      : { border: "1px solid var(--tb-border)", color: "var(--tb-text)", background: "var(--tb-glass)" }),
                  }}
                >
                  {t.cta}
                </a>
              </div>
            </motion.div>
          ))}
        </motion.div>

        <p style={{ textAlign: "center", marginTop: 28, fontSize: 12.5, color: "var(--tb-text-tertiary)" }}>
          Keine Einrichtungsgebühr · Schweizer Vertragspartner
        </p>
      </div>

      <style>{`
        .tb-price-featured {
          animation: tbBorderShift 8s linear infinite;
        }
        @keyframes tbBorderShift {
          from { background-position: 0% 50%; }
          to   { background-position: 200% 50%; }
        }
        .tb-price-card { transition: transform var(--tb-dur-base) var(--tb-ease-out); }
        .tb-price-card:hover { transform: translateY(-6px); }
        @media (max-width: 860px) {
          .tb-price-grid { grid-template-columns: 1fr !important; max-width: 420px; margin: 0 auto; }
        }
      `}</style>
    </section>
  );
}
