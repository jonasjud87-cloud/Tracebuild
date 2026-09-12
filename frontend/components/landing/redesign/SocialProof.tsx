"use client";

import { motion, useReducedMotion } from "framer-motion";
import { EASE_OUT, inView } from "@/lib/landing/motion";

export default function SocialProof() {
  const reduce = useReducedMotion();

  return (
    <section
      style={{ position: "relative", padding: "clamp(48px,9vh,96px) var(--tb-gutter)" }}
    >
      <motion.div
        initial={{ opacity: 0, y: reduce ? 0 : 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={inView}
        transition={{ duration: 0.6, ease: EASE_OUT }}
        style={{
          maxWidth: "var(--tb-max)",
          margin: "0 auto",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 13.5,
            letterSpacing: "0.02em",
            color: "var(--tb-text-tertiary)",
          }}
        >
          In Pilotprojekten mit Architekturbüros aus der Ostschweiz
        </p>
        <p style={{ margin: 0, fontSize: 12, color: "var(--tb-text-muted)" }}>
          Referenzen auf Anfrage
        </p>
      </motion.div>
    </section>
  );
}
