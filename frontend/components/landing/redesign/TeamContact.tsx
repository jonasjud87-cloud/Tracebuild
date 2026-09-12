"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Eyebrow } from "./primitives";
import { EASE_OUT, inView } from "@/lib/landing/motion";

/* abstract topographic contour "portrait" - single accent hairline, no face */
function Contour({ mirror = false }: { mirror?: boolean }) {
  const reduce = useReducedMotion();
  const rings = [
    "M60,18 C90,18 108,40 108,70 C108,104 88,128 60,128 C32,128 12,104 12,70 C12,40 30,18 60,18 Z",
    "M60,30 C82,30 96,48 96,72 C96,98 80,116 60,116 C40,116 24,98 24,72 C24,48 38,30 60,30 Z",
    "M60,44 C74,44 84,56 84,74 C84,92 74,102 60,102 C46,102 36,92 36,74 C36,56 46,44 60,44 Z",
  ];
  return (
    <motion.svg
      viewBox="0 0 120 146"
      width="100%"
      height="100%"
      aria-hidden
      style={{ transform: mirror ? "scaleX(-1)" : undefined, display: "block" }}
      initial="hidden"
      whileInView="visible"
      viewport={inView}
    >
      <motion.path
        d="M60,128 C44,128 34,138 34,146 M60,128 C76,128 86,138 86,146"
        fill="none"
        stroke="var(--tb-accent)"
        strokeOpacity="0.5"
        strokeWidth="1"
        variants={{ hidden: { pathLength: 0 }, visible: { pathLength: 1, transition: { duration: 1, ease: EASE_OUT } } }}
      />
      {rings.map((d, i) => (
        <motion.path
          key={i}
          d={d}
          fill="none"
          stroke="var(--tb-accent)"
          strokeOpacity={0.55 - i * 0.12}
          strokeWidth="1"
          variants={{
            hidden: { pathLength: 0, opacity: 0 },
            visible: {
              pathLength: 1,
              opacity: 1,
              transition: { duration: 1.2, ease: EASE_OUT, delay: i * 0.15 },
            },
          }}
        />
      ))}
      <circle cx="60" cy="74" r="2.5" fill="var(--tb-accent-cyan)">
        {!reduce && (
          <animate attributeName="opacity" values="0.3;1;0.3" dur="3.5s" repeatCount="indefinite" />
        )}
      </circle>
    </motion.svg>
  );
}

const FOUNDERS = [
  {
    initials: "JJ",
    name: "Jonas Jud",
    role: "Mitgründer",
    email: "jonas@tracebuild.ch",
    blurb: "Hat TraceBuild zusammen mit Livio aufgebaut - von der ersten Idee an.",
  },
  {
    initials: "LT",
    name: "Livio Thoma",
    role: "Mitgründer",
    email: "livio@tracebuild.ch",
    blurb: "Hat TraceBuild zusammen mit Jonas aufgebaut - von der ersten Idee an.",
  },
];

export default function TeamContact() {
  return (
    <section id="kontakt" style={{ position: "relative", padding: "var(--tb-section-y) var(--tb-gutter)" }}>
      <div style={{ maxWidth: "var(--tb-max)", margin: "0 auto" }}>
        <Eyebrow>Team</Eyebrow>
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={inView}
          transition={{ duration: 0.6, ease: EASE_OUT }}
          style={{ fontSize: "clamp(26px,3.4vw,44px)", margin: "18px 0 14px", maxWidth: 620 }}
        >
          Über uns.
        </motion.h2>
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={inView}
          transition={{ duration: 0.6, ease: EASE_OUT }}
          style={{ margin: "0 0 48px", fontSize: 15, color: "var(--tb-text-secondary)", maxWidth: 520, lineHeight: 1.6 }}
        >
          TraceBuild ist von uns beiden - von der ersten Idee bis zur fertigen
          Anwendung.
        </motion.p>

        <div style={{ display: "flex", flexDirection: "column", gap: "clamp(40px,7vw,96px)" }}>
          {FOUNDERS.map((f, i) => (
            <motion.div
              key={f.name}
              initial={{ opacity: 0, y: 32 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={inView}
              transition={{ duration: 0.7, ease: EASE_OUT }}
              className="tb-founder"
              style={{
                display: "grid",
                gridTemplateColumns: "220px 1fr",
                gap: "clamp(24px,5vw,56px)",
                alignItems: "center",
                direction: i % 2 === 1 ? "rtl" : "ltr",
              }}
            >
              <div
                style={{
                  direction: "ltr",
                  position: "relative",
                  aspectRatio: "1",
                  borderRadius: "var(--tb-r-container)",
                  border: "1px solid var(--tb-border)",
                  background: "var(--tb-glass)",
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <div style={{ position: "absolute", inset: "12% 20% 0" }}>
                  <Contour mirror={i % 2 === 1} />
                </div>
                <span
                  style={{
                    position: "relative",
                    fontFamily: "var(--font-display, sans-serif)",
                    fontWeight: 700,
                    fontSize: 44,
                    letterSpacing: "-0.03em",
                    background: "var(--tb-accent-gradient)",
                    WebkitBackgroundClip: "text",
                    backgroundClip: "text",
                    color: "transparent",
                  }}
                >
                  {f.initials}
                </span>
              </div>

              <div style={{ direction: "ltr" }}>
                <h3 style={{ fontSize: "clamp(22px,2.4vw,32px)", margin: 0 }}>{f.name}</h3>
                <p style={{ margin: "6px 0 20px", fontSize: 13.5, color: "var(--tb-text-tertiary)" }}>{f.role}</p>
                <p style={{ margin: 0, fontSize: "clamp(15px,1.4vw,18px)", lineHeight: 1.6, color: "var(--tb-text-secondary)", maxWidth: 480 }}>
                  {f.blurb.split(" - ")[0]} -
                  <br />
                  {f.blurb.split(" - ")[1]}
                </p>
                <a
                  href={`mailto:${f.email}`}
                  style={{ display: "inline-block", marginTop: 18, fontSize: 13.5, color: "var(--tb-accent)", textDecoration: "none" }}
                >
                  {f.email}
                </a>
              </div>
            </motion.div>
          ))}
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={inView}
          transition={{ duration: 0.6, ease: EASE_OUT }}
          style={{ marginTop: "clamp(48px,7vw,88px)", fontSize: 15, color: "var(--tb-text-secondary)", lineHeight: 1.7 }}
        >
          Wir sitzen in Mels SG. Schreiben Sie uns direkt:{" "}
          <a href="mailto:jonas@tracebuild.ch" style={{ color: "var(--tb-text)" }}>jonas@tracebuild.ch</a>
          {" · "}
          <a href="mailto:livio@tracebuild.ch" style={{ color: "var(--tb-text)" }}>livio@tracebuild.ch</a>
        </motion.p>
      </div>

      <style>{`
        @media (max-width: 720px) {
          .tb-founder { grid-template-columns: 1fr !important; direction: ltr !important; }
        }
      `}</style>
    </section>
  );
}
