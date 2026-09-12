"use client";

import { useRef } from "react";
import {
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
} from "framer-motion";
import HeroParticles from "./HeroParticles";
import { GradientButton, GhostButton, WordReveal } from "./primitives";
import { EASE_OUT } from "@/lib/landing/motion";

export default function Hero() {
  const prefersReduced = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const scrollRef = useRef(0);

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });
  useMotionValueEvent(scrollYProgress, "change", (v) => {
    scrollRef.current = v;
  });

  const fieldOpacity = useTransform(scrollYProgress, [0, 0.9], [1, 0.15]);

  return (
    <section
      ref={sectionRef}
      id="top"
      style={{
        position: "relative",
        minHeight: "100svh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "clamp(120px, 20vh, 200px) var(--tb-gutter) 80px",
        overflow: "hidden",
        background: "var(--tb-canvas)",
      }}
    >
      <motion.div style={{ position: "absolute", inset: 0, opacity: prefersReduced ? 1 : fieldOpacity }}>
        <HeroParticles scrollRef={scrollRef} />
      </motion.div>

      <div
        style={{
          position: "relative",
          zIndex: 2,
          width: "100%",
          maxWidth: 1000,
          textAlign: "center",
        }}
      >
        <h1
          style={{
            fontSize: "clamp(38px, 6.2vw, 96px)",
            lineHeight: 1.04,
            letterSpacing: "-0.03em",
            margin: 0,
            textWrap: "balance" as React.CSSProperties["textWrap"],
          }}
        >
          <WordReveal text="Zeichnungen prüfen," accentWord="prüfen" delay={0.15} />
          <br />
          <WordReveal text="Normen einhalten." delay={0.15 + 0.04 * 2} />
        </h1>

        <motion.p
          initial={{ opacity: 0, filter: prefersReduced ? "blur(0px)" : "blur(8px)", y: 20 }}
          animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
          transition={{ duration: 0.5, ease: EASE_OUT, delay: 0.55 }}
          style={{
            fontSize: "clamp(16px, 1.4vw, 20px)",
            lineHeight: 1.6,
            color: "var(--tb-text-secondary)",
            maxWidth: "var(--tb-max-prose)",
            margin: "26px auto 0",
          }}
        >
          TraceBuild liest Ihre Zeichnungen, gleicht sie mit geltenden Normen und
          Vorschriften ab und zeigt jede Abweichung - klar dargestellt und
          nachvollziehbar belegt.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE_OUT, delay: 0.68 }}
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: 12,
            marginTop: 34,
          }}
        >
          <GradientButton href="#kontakt">Loslegen →</GradientButton>
          <GhostButton href="#produkt">Produktvorschau</GhostButton>
        </motion.div>
      </div>
    </section>
  );
}
