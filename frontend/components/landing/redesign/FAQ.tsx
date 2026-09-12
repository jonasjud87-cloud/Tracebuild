"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Eyebrow } from "./primitives";
import { EASE_OUT, inView } from "@/lib/landing/motion";

type Item = { q: string; a: string };

const ITEMS: Item[] = [
  {
    q: "Was passiert mit unseren Daten?",
    a: "Coming soon",
  },
  {
    q: "Ändert TraceBuild etwas an der Zeichnung?",
    a: "Nein. TraceBuild prüft und stellt Befunde dar. Änderungen und die Freigabe bleiben bei Ihrem Team.",
  },
  {
    q: "Welche Normen und Kantone sind abgedeckt?",
    a: "SIA-Normen, VSS sowie kantonale Bauordnungen. Die Normen-Datenbank wird laufend erweitert - fragen Sie uns nach einem bestimmten Kanton.",
  },
  {
    q: "Wie genau ist die Prüfung?",
    a: "Die KI markiert mögliche Abweichungen mit Norm-Verweis und Massangabe. Die abschliessende Beurteilung treffen Sie - TraceBuild liefert die Grundlage, nicht das Urteil.",
  },
  {
    q: "Was kostet TraceBuild?",
    a: "Gestaffelt nach Bürogrösse und Prüfvolumen. Details im Gespräch - schreiben Sie uns.",
  },
];

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden
      style={{
        flexShrink: 0,
        transform: open ? "rotate(180deg)" : "rotate(0deg)",
        transition: "transform var(--tb-dur-base) var(--tb-ease-out)",
      }}
    >
      <path
        d="M4 6 L8 10 L12 6"
        fill="none"
        stroke="var(--tb-accent)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Row({ item, index }: { item: Item; index: number }) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const panelId = `tb-faq-panel-${index}`;
  const btnId = `tb-faq-btn-${index}`;

  return (
    <div
      style={{
        borderRadius: "var(--tb-r-container)",
        border: "1px solid var(--tb-border)",
        background: "var(--tb-glass)",
        overflow: "hidden",
      }}
    >
      <button
        id={btnId}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          padding: "clamp(18px,2.4vw,24px) clamp(20px,2.6vw,28px)",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          font: "inherit",
          color: "var(--tb-text-bright)",
        }}
      >
        <span style={{ fontSize: "clamp(15px,1.5vw,17px)", fontWeight: 600, letterSpacing: "-0.01em" }}>
          {item.q}
        </span>
        <Chevron open={open} />
      </button>

      {reduce ? (
        <div
          id={panelId}
          role="region"
          aria-labelledby={btnId}
          hidden={!open}
          style={{ padding: "0 clamp(20px,2.6vw,28px) clamp(18px,2.4vw,24px)" }}
        >
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: "var(--tb-text-secondary)" }}>
            {item.a}
          </p>
        </div>
      ) : (
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              id={panelId}
              role="region"
              aria-labelledby={btnId}
              key="content"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.32, ease: EASE_OUT }}
              style={{ overflow: "hidden" }}
            >
              <p
                style={{
                  margin: 0,
                  padding: "0 clamp(20px,2.6vw,28px) clamp(18px,2.4vw,24px)",
                  fontSize: 14,
                  lineHeight: 1.65,
                  color: "var(--tb-text-secondary)",
                }}
              >
                {item.a}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}

export default function FAQ() {
  return (
    <section
      id="faq"
      style={{ position: "relative", padding: "var(--tb-section-y) var(--tb-gutter)" }}
    >
      <div style={{ maxWidth: "var(--tb-max)", margin: "0 auto" }}>
        <Eyebrow>Häufige Fragen</Eyebrow>
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={inView}
          transition={{ duration: 0.6, ease: EASE_OUT }}
          style={{ fontSize: "clamp(26px,3.4vw,44px)", margin: "18px 0 48px" }}
        >
          Bevor Sie fragen.
        </motion.h2>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 760 }}>
          {ITEMS.map((item, i) => (
            <Row key={item.q} item={item} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}
