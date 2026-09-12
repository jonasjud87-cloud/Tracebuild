"use client";

import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform, type Variants } from "framer-motion";
import { Eyebrow } from "./primitives";
import { revealUp, revealTextLine, staggerParent, inView } from "@/lib/landing/motion";

type Beat = {
  eyebrow: string;
  eyebrowColor: string;
  headline: string;
  lines: string[];
  tick: string;
  body: string;
};

const BEATS: Beat[] = [
  {
    eyebrow: "Das Problem",
    eyebrowColor: "var(--tb-lavender)",
    headline: "Ein übersehener Grenzabstand kostet Wochen.",
    lines: [
      "Normen ändern sich. Kantonal. Ständig.",
      "Die Prüfung passiert im Kopf - oder gar nicht.",
      "Fehler fallen erst spät auf.",
    ],
    tick: "var(--tb-lavender)",
    body: "var(--tb-text-bright)",
  },
  {
    eyebrow: "Der Ansatz",
    eyebrowColor: "var(--tb-lavender)",
    headline: "TraceBuild macht die Prüfung sichtbar.",
    lines: [
      "PDF hochladen, die KI prüft gegen jede relevante Norm.",
      "Eine Übersicht: was passt, was kritisch ist, was zu prüfen bleibt.",
      "Die Zeichnung bleibt unangetastet - freigeben tun Sie.",
    ],
    tick: "var(--tb-accent-gradient)",
    body: "var(--tb-text)",
  },
];

const fadeOnly: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
};

const staggerNone: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0 } },
};

function BeatBlock({ beat, itemV, headV, parentV }: {
  beat: Beat;
  itemV: Variants;
  headV: Variants;
  parentV: Variants;
}) {
  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={inView}
      variants={parentV}
    >
      <motion.div variants={itemV}>
        <Eyebrow style={{ color: beat.eyebrowColor }}>{beat.eyebrow}</Eyebrow>
      </motion.div>

      <motion.h2
        variants={headV}
        style={{
          fontSize: "clamp(28px, 4.4vw, 56px)",
          margin: "16px 0 32px",
          maxWidth: 640,
        }}
      >
        {beat.headline}
      </motion.h2>

      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "grid",
          gap: 16,
          maxWidth: 520,
        }}
      >
        {beat.lines.map((line) => (
          <motion.li
            key={line}
            variants={itemV}
            style={{ display: "flex", gap: 16, alignItems: "baseline" }}
          >
            <span
              aria-hidden
              style={{
                flexShrink: 0,
                width: 22,
                height: 2,
                borderRadius: 2,
                background: beat.tick,
                transform: "translateY(-5px)",
              }}
            />
            <span
              style={{
                fontSize: "clamp(15px, 1.4vw, 18px)",
                lineHeight: 1.55,
                color: beat.body,
              }}
            >
              {line}
            </span>
          </motion.li>
        ))}
      </ul>
    </motion.div>
  );
}

export default function ProblemSolution() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement>(null);

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 80%", "end 55%"],
  });
  const drawScaleY = useTransform(scrollYProgress, [0, 1], [0.02, 1]);
  const drawOpacity = useTransform(scrollYProgress, [0, 0.08], [0, 0.5]);

  const parentV = reduce ? staggerNone : staggerParent(0.08);
  const itemV = reduce ? fadeOnly : revealTextLine;
  const headV = reduce ? fadeOnly : revealUp;

  return (
    <section
      ref={ref}
      className="tb-problem-solution"
      style={{ position: "relative", padding: "var(--tb-section-y) var(--tb-gutter)" }}
    >
      <div style={{ maxWidth: "var(--tb-max)", margin: "0 auto", position: "relative" }}>
        <motion.span
          aria-hidden
          className="tb-ps-rule"
          style={{
            position: "absolute",
            left: 0,
            top: 6,
            bottom: 6,
            width: 2,
            borderRadius: 2,
            background: "var(--tb-accent-gradient)",
            transformOrigin: "top center",
            scaleY: reduce ? 1 : drawScaleY,
            opacity: reduce ? 0.5 : drawOpacity,
          }}
        />

        <div
          className="tb-ps-stack"
          style={{
            display: "grid",
            gap: "clamp(80px, 13vh, 160px)",
            paddingLeft: "clamp(24px, 4vw, 56px)",
          }}
        >
          {BEATS.map((beat) => (
            <BeatBlock
              key={beat.eyebrow}
              beat={beat}
              itemV={itemV}
              headV={headV}
              parentV={parentV}
            />
          ))}
        </div>
      </div>

      <style>{`
        @media (max-width: 640px) {
          .tb-ps-stack { gap: clamp(64px, 10vh, 104px) !important; padding-left: 20px !important; }
        }
      `}</style>
    </section>
  );
}
