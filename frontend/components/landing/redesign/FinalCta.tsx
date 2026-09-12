"use client";

import { motion } from "framer-motion";
import HeroParticles from "./HeroParticles";
import { GradientButton, GhostButton } from "./primitives";
import { EASE_OUT, EASE_EXPO, inView } from "@/lib/landing/motion";

export default function FinalCta() {
  return (
    <section
      style={{
        position: "relative",
        minHeight: "80vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "var(--tb-section-y) var(--tb-gutter)",
        overflow: "hidden",
      }}
    >
      {/* No own background — transparent like every other section, so the
          page canvas + ambient light carry straight through. Just the same
          particle ring as the hero. */}
      <div aria-hidden style={{ position: "absolute", inset: 0, zIndex: 0 }}>
        <HeroParticles opacity={0.7} />
      </div>

      <motion.div
        initial="hidden"
        whileInView="visible"
        viewport={inView}
        variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.08 } } }}
        style={{ position: "relative", zIndex: 2, maxWidth: 680 }}
      >
        <motion.h2
          variants={{
            hidden: { opacity: 0, y: 24 },
            visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE_EXPO } },
          }}
          style={{ fontSize: "clamp(32px,5.2vw,64px)", lineHeight: 1.05, letterSpacing: "-0.03em", margin: 0 }}
        >
          Bereit für die erste Prüfung?
        </motion.h2>
        <motion.p
          variants={{
            hidden: { opacity: 0, y: 16 },
            visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE_OUT } },
          }}
          style={{ margin: "22px auto 34px", fontSize: 16, lineHeight: 1.6, color: "var(--tb-text-secondary)", maxWidth: 460 }}
        >
          Zeigen Sie uns ein Projekt - wir zeigen Ihnen, was TraceBuild findet.
        </motion.p>
        <motion.div
          variants={{
            hidden: { opacity: 0, y: 16 },
            visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE_OUT } },
          }}
          style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 12 }}
        >
          <GradientButton href="#kontakt">Loslegen →</GradientButton>
          <GhostButton href="mailto:jonas@tracebuild.ch">Mit uns sprechen</GhostButton>
        </motion.div>
      </motion.div>
    </section>
  );
}
