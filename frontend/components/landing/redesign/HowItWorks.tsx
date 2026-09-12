"use client";

import { motion, useReducedMotion, type Variants } from "framer-motion";
import { Eyebrow } from "./primitives";
import { EASE_OUT, staggerParent, cardReveal, inView } from "@/lib/landing/motion";

type Step = {
  n: string;
  h: string;
  p: string;
};

const STEPS: Step[] = [
  {
    n: "01",
    h: "Plan hochladen",
    p: "PDF Ihrer Zeichnung hochladen, fertig.",
  },
  {
    n: "02",
    h: "KI prüft gegen Normen",
    p: "Abgleich mit SIA-Normen und kantonalen Vorschriften, in Minuten.",
  },
  {
    n: "03",
    h: "Übersicht & Freigabe",
    p: "Sie sehen jeden Befund - prüfen, entscheiden, freigeben.",
  },
];

const fadeOnly: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.4, ease: EASE_OUT } },
};

export default function HowItWorks() {
  const reduce = useReducedMotion();
  const cardV = reduce ? fadeOnly : cardReveal;

  return (
    <section
      id="ablauf"
      style={{ position: "relative", padding: "var(--tb-section-y) var(--tb-gutter)" }}
    >
      <div style={{ maxWidth: "var(--tb-max)", margin: "0 auto" }}>
        <Eyebrow>So funktioniert&apos;s</Eyebrow>
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={inView}
          transition={{ duration: 0.6, ease: EASE_OUT }}
          style={{ fontSize: "clamp(26px,3.4vw,44px)", margin: "18px 0 48px", maxWidth: 560 }}
        >
          In drei Schritten zur geprüften Zeichnung.
        </motion.h2>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={inView}
          variants={staggerParent(0.12)}
          className="tb-how-grid"
          style={{
            position: "relative",
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "clamp(16px,3vw,28px)",
          }}
        >
          <span aria-hidden className="tb-how-line" />
          {STEPS.map((s) => (
            <motion.article
              key={s.n}
              variants={cardV}
              className="tb-how-card"
              style={{
                position: "relative",
                borderRadius: "var(--tb-r-container)",
                border: "1px solid var(--tb-border)",
                background: "var(--tb-glass)",
                padding: "clamp(24px,3vw,40px)",
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-display, sans-serif)",
                  fontWeight: 700,
                  fontSize: "clamp(36px,4.4vw,54px)",
                  lineHeight: 1,
                  letterSpacing: "-0.03em",
                  background: "var(--tb-accent-gradient)",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                }}
              >
                {s.n}
              </span>
              <h3
                style={{
                  fontSize: "clamp(18px,1.8vw,22px)",
                  lineHeight: 1.25,
                  letterSpacing: "-0.02em",
                  margin: 0,
                }}
              >
                {s.h}
              </h3>
              <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: "var(--tb-text-secondary)" }}>
                {s.p}
              </p>
            </motion.article>
          ))}
        </motion.div>
      </div>

      <style>{`
        .tb-how-grid { position: relative; }
        .tb-how-line {
          position: absolute;
          top: clamp(44px,5vw,60px);
          left: 16%;
          right: 16%;
          height: 1px;
          background: var(--tb-hairline);
          pointer-events: none;
        }
        .tb-how-card {
          transition: border-color var(--tb-dur-base) var(--tb-ease-out), background var(--tb-dur-base) var(--tb-ease-out), box-shadow var(--tb-dur-base) var(--tb-ease-out);
        }
        .tb-how-card:hover {
          border-color: var(--tb-border-strong);
          background: var(--tb-glass-hover);
          box-shadow: var(--tb-lift);
        }
        @media (max-width: 760px) {
          .tb-how-grid { grid-template-columns: 1fr !important; }
          .tb-how-line { display: none; }
        }
      `}</style>
    </section>
  );
}
