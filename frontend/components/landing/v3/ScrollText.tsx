"use client";

import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from "framer-motion";
import styles from "./ScrollText.module.css";

const WORDS = ["Vision.", "Technologie.", "Fortschritt."];
const TOTAL = WORDS.join("").length;
const SPAN = 0.3;

function Char({ ch, index, progress, accent }: { ch: string; index: number; progress: MotionValue<number>; accent: boolean }) {
  const start = (index / TOTAL) * (1 - SPAN);
  const end = start + SPAN;
  const opacity = useTransform(progress, [start, end], [0.08, 1]);
  const y = useTransform(progress, [start, end], ["0.45em", "0em"]);
  const blur = useTransform(progress, [start, end], [10, 0]);
  const filter = useTransform(blur, (b) => `blur(${b}px)`);
  return (
    <motion.span className={`${styles.char}${accent ? ` ${styles.accent}` : ""}`} style={{ opacity, y, filter }}>
      {ch}
    </motion.span>
  );
}

export default function ScrollText() {
  const ref = useRef<HTMLHeadingElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 92%", "start 45%"] });

  let index = 0;
  return (
    <section className={styles.band} aria-label="Vision. Technologie. Fortschritt.">
      <h2 ref={ref} className={styles.text}>
        {WORDS.map((word, wi) => (
          <span key={word} className={styles.word} aria-hidden="true">
            {Array.from(word).map((ch) => {
              const i = index++;
              return reduced ? (
                <span key={i} className={`${styles.char}${wi === 1 ? ` ${styles.accent}` : ""}`}>
                  {ch}
                </span>
              ) : (
                <Char key={i} ch={ch} index={i} progress={scrollYProgress} accent={wi === 1} />
              );
            })}
          </span>
        ))}
      </h2>
    </section>
  );
}
