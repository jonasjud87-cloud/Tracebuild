"use client";

import { motion, useReducedMotion, type Variants } from "framer-motion";
import { Eyebrow } from "./primitives";
import { EASE_OUT, staggerParent, cardReveal, inView } from "@/lib/landing/motion";

/* ── palette-only micro-visuals ─────────────────────────────────────────── */

function Secure({ reduce }: { reduce: boolean }) {
  return (
    <svg viewBox="0 0 120 80" width="120" height="80" aria-hidden>
      <rect
        x="42"
        y="34"
        width="36"
        height="30"
        rx="4"
        fill="var(--tb-accent)"
        fillOpacity="0.06"
        stroke="var(--tb-accent)"
        strokeWidth="1.6"
        strokeOpacity="0.6"
      />
      <path
        d="M49,34 V26 a11,11 0 0 1 22,0 V34"
        fill="none"
        stroke="var(--tb-accent)"
        strokeWidth="1.6"
        strokeOpacity="0.6"
        strokeLinecap="round"
      />
      <line
        x1="60"
        y1="48"
        x2="60"
        y2="56"
        stroke="var(--tb-accent)"
        strokeWidth="1.6"
        strokeOpacity="0.6"
        strokeLinecap="round"
      />
      <circle cx="60" cy="46" r="3.2" fill="var(--tb-accent-cyan)">
        {!reduce && (
          <animate attributeName="opacity" values="0.4;1;0.4" dur="4s" repeatCount="indefinite" />
        )}
      </circle>
    </svg>
  );
}

function DocStack() {
  return (
    <svg viewBox="0 0 120 80" width="120" height="80" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <rect
          key={i}
          x={26 + i * 6}
          y={14 + i * 6}
          width="60"
          height="46"
          rx="3"
          fill="var(--tb-glass)"
          stroke="rgba(255,255,255,0.16)"
          strokeWidth="1"
        />
      ))}
      <line x1="44" y1="14" x2="44" y2="78" stroke="var(--tb-accent)" strokeWidth="1.5" strokeOpacity="0.7" />
    </svg>
  );
}

function Timeline({ reduce }: { reduce: boolean }) {
  return (
    <svg viewBox="0 0 120 80" width="120" height="80" aria-hidden>
      <line x1="60" y1="8" x2="60" y2="72" stroke="var(--tb-accent)" strokeWidth="1" strokeOpacity="0.4" />
      {[14, 30, 46].map((y) => (
        <circle key={y} cx="60" cy={y} r="2.5" fill="var(--tb-accent)" fillOpacity="0.55" />
      ))}
      <circle cx="60" cy="62" r="4" fill="var(--tb-info)">
        {!reduce && (
          <>
            <animate attributeName="r" values="4;6;4" dur="3s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="1;0.5;1" dur="3s" repeatCount="indefinite" />
          </>
        )}
      </circle>
    </svg>
  );
}

const fadeOnly: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.4, ease: EASE_OUT } },
};

export default function TrustBlocks() {
  const reduce = useReducedMotion() ?? false;
  const cardV = reduce ? fadeOnly : cardReveal;

  const BLOCKS = [
    {
      visual: <Secure reduce={reduce} />,
      h: "Ihre Daten sind sicher.",
      p: "Jede Übertragung ist verschlüsselt, und auch gespeicherte Daten liegen verschlüsselt vor. Die Verarbeitung ist am Schweizer Datenschutzgesetz orientiert. Zugriff erhalten nur berechtigte Personen - geregelt über rollenbasierte Rechte.",
      proof: "Verschlüsselt · Zugriffskontrolliert",
    },
    {
      visual: <DocStack />,
      h: "TraceBuild prüft. Sie entscheiden.",
      p: "Die KI liefert eine übersichtliche Auswertung - sortiert, verortet, einfach zu interpretieren. Die Zeichnung ändern und die Freigabe erteilen bleibt bei Ihrem Team. Menschenverstand ist hier nicht ersetzbar.",
      proof: "Kein Eingriff in den Plan · Freigabe durch Ihr Team",
    },
    {
      visual: <Timeline reduce={reduce} />,
      h: "Ändert sich was, sagen wir Bescheid.",
      p: "Wir behalten Normen und Vorschriften im Blick, damit Sie es nicht müssen. Wird für Ihr Projekt etwas relevant, hören Sie von uns - bevor es zum Problem wird.",
      proof: "Wir schauen hin · Sie bekommen Bescheid",
    },
  ];

  return (
    <section
      id="vertrauen"
      style={{ position: "relative", padding: "var(--tb-section-y) var(--tb-gutter)" }}
    >
      <div style={{ maxWidth: "var(--tb-max)", margin: "0 auto" }}>
        <Eyebrow>Qualität</Eyebrow>
        <motion.h2
          className="tb-trust-heading"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={inView}
          transition={{ duration: 0.6, ease: EASE_OUT }}
          style={{ fontSize: "clamp(26px,3.4vw,44px)", margin: "18px 0 48px", maxWidth: 620 }}
        >
          Unser Anspruch an jede Prüfung.
        </motion.h2>

        <div className="tb-trust-rail">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={inView}
            variants={staggerParent(0.09)}
            className="tb-trust-track"
          >
            {BLOCKS.map((b) => (
              <motion.article
                key={b.proof}
                variants={cardV}
                className="tb-trust-card"
                style={{
                  borderRadius: "var(--tb-r-container)",
                  border: "1px solid var(--tb-border)",
                  background: "var(--tb-glass)",
                  padding: "clamp(24px,3vw,44px)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 18,
                  transition:
                    "border-color var(--tb-dur-base) var(--tb-ease-out), box-shadow var(--tb-dur-base) var(--tb-ease-out), background var(--tb-dur-base) var(--tb-ease-out)",
                }}
              >
                <div style={{ height: 80 }}>{b.visual}</div>
                <h3 style={{ fontSize: "clamp(19px,1.8vw,24px)", lineHeight: 1.2, letterSpacing: "-0.02em", margin: 0 }}>
                  {b.h}
                </h3>
                <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.65, color: "var(--tb-text-secondary)" }}>
                  {b.p}
                </p>
                <p style={{ margin: "auto 0 0", paddingTop: 14, borderTop: "1px solid var(--tb-hairline)", fontSize: 12, letterSpacing: "0.01em", color: "var(--tb-text-tertiary)" }}>
                  {b.proof}
                </p>
              </motion.article>
            ))}
          </motion.div>
        </div>
      </div>

      <style>{`
        .tb-trust-heading { text-wrap: balance; }

        /* Grid is the SSR + first-client default (safer, no horizontal scroll). */
        .tb-trust-rail {
          overflow: visible;
        }
        .tb-trust-track {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: clamp(16px, 3vw, 32px);
          padding: 4px;
        }
        .tb-trust-card { text-wrap: balance; }

        /* Below 768px: horizontal scroll rail so 3 cards don't cram. */
        @media (max-width: 767px) {
          .tb-trust-rail {
            overflow-x: auto;
            overscroll-behavior-x: contain;
            -webkit-overflow-scrolling: touch;
            scroll-snap-type: x proximity;
            scroll-padding-inline: var(--tb-gutter);
            margin-inline: calc(-1 * var(--tb-gutter));
            padding-inline: var(--tb-gutter);
            padding-block: 6px 20px;
            scrollbar-width: thin;
            scrollbar-color: #38bdf8 rgba(255,255,255,0.05);
            -webkit-mask-image: linear-gradient(to right, transparent 0, #000 var(--tb-gutter), #000 calc(100% - var(--tb-gutter)), transparent 100%);
            mask-image: linear-gradient(to right, transparent 0, #000 var(--tb-gutter), #000 calc(100% - var(--tb-gutter)), transparent 100%);
          }
          .tb-trust-track {
            display: flex;
            gap: clamp(16px, 3vw, 32px);
            width: max-content;
          }
          .tb-trust-card {
            flex: 0 0 clamp(280px, 78vw, 400px);
            scroll-snap-align: start;
          }
        }

        .tb-trust-rail::-webkit-scrollbar { height: 6px; }
        .tb-trust-rail::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
        .tb-trust-rail::-webkit-scrollbar-track { background: rgba(255,255,255,0.05); border-radius: 999px; }
        .tb-trust-rail::-webkit-scrollbar-thumb { background: linear-gradient(90deg,#4fd1ff,#2862d7); border-radius: 999px; }
        .tb-trust-rail::-webkit-scrollbar-thumb:hover { background: linear-gradient(90deg,#4fd1ff,#38bdf8); }
        .tb-trust-card:hover {
          border-color: var(--tb-border-strong);
          background: var(--tb-glass-hover);
          box-shadow: var(--tb-lift);
        }
      `}</style>
    </section>
  );
}
