"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import IntroText from "./IntroText";
import { useLenis } from "./SmoothScrollProvider";
import styles from "./intro.module.css";

const slideEase: [number, number, number, number] = [0.7, 0, 0.2, 1];
const useIsoEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const PHASE_B_MS = 1900;
const PHASE_C_MS = 2500;
const PHASE_D_MS = 8800;
const REDUCED_HOLD_MS = 1500;

export default function IntroOverlay() {
  const [prefersReduced, setPrefersReduced] = useState(false);
  const { lenis } = useLenis();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const finished = useRef(false);
  const [inDom, setInDom] = useState(true);
  const [leaving, setLeaving] = useState(false);
  const [logoOut, setLogoOut] = useState(false);
  const [showText, setShowText] = useState(false);

  useIsoEffect(() => {
    rootRef.current?.classList.add(styles.js);
    if (window.location.hash) {
      finished.current = true;
      setInDom(false);
      return;
    }
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setPrefersReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!inDom) return;
    const host = rootRef.current?.parentElement;
    if (!host) return;
    const locked: Element[] = [];
    Array.from(host.children).forEach((el) => {
      if (el === rootRef.current || el.hasAttribute("inert")) return;
      el.setAttribute("inert", "");
      locked.push(el);
    });
    return () => locked.forEach((el) => el.removeAttribute("inert"));
  }, [inDom]);

  useEffect(() => {
    if (!inDom) return;
    const html = document.documentElement;
    const prevHtml = html.style.overflow;
    const prevBody = document.body.style.overflow;
    html.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    const block = (e: Event) => e.preventDefault();
    window.addEventListener("wheel", block, { passive: false });
    window.addEventListener("touchmove", block, { passive: false });
    return () => {
      html.style.overflow = prevHtml;
      document.body.style.overflow = prevBody;
      window.removeEventListener("wheel", block);
      window.removeEventListener("touchmove", block);
    };
  }, [inDom]);

  useEffect(() => {
    if (!inDom || !lenis) return;
    lenis.stop();
    return () => lenis.start();
  }, [inDom, lenis]);

  useEffect(() => {
    if (leaving) return;
    if (prefersReduced) {
      const t = window.setTimeout(() => setLeaving(true), REDUCED_HOLD_MS);
      return () => window.clearTimeout(t);
    }
    const tB = window.setTimeout(() => setLogoOut(true), PHASE_B_MS);
    const tC = window.setTimeout(() => setShowText(true), PHASE_C_MS);
    const tD = window.setTimeout(() => setLeaving(true), PHASE_D_MS);
    return () => {
      window.clearTimeout(tB);
      window.clearTimeout(tC);
      window.clearTimeout(tD);
    };
  }, [leaving, prefersReduced]);

  useEffect(() => {
    const cap = (prefersReduced ? REDUCED_HOLD_MS + 500 : PHASE_D_MS) + 2500;
    const t = window.setTimeout(() => {
      finished.current = true;
      setInDom(false);
    }, cap);
    return () => window.clearTimeout(t);
  }, [prefersReduced]);

  if (!inDom) return null;

  const settle = () => {
    if (!leaving || finished.current) return;
    finished.current = true;
    setInDom(false);
  };

  return (
    <motion.div
      ref={rootRef}
      className={styles.root}
      role="presentation"
      aria-hidden="true"
      initial={false}
      animate={
        prefersReduced
          ? { opacity: leaving ? 0 : 1 }
          : { y: leaving ? "-100%" : "0%" }
      }
      transition={
        prefersReduced
          ? { duration: 0.3, ease: "linear" }
          : { duration: 0.7, ease: slideEase }
      }
      onAnimationComplete={settle}
    >
      <div className={styles.glows} aria-hidden="true">
        <span className={`${styles.glow} ${styles.glowA}`} />
        <span className={`${styles.glow} ${styles.glowB}`} />
        <span className={`${styles.glow} ${styles.glowC}`} />
        <span className={styles.sweep} />
      </div>

      {!prefersReduced && showText && <IntroText />}

      <div className={`${styles.stack}${logoOut ? ` ${styles.stackOut}` : ""}`}>
        <Image
          src="/landing/logo-tb.svg"
          alt="TraceBuild"
          width={553}
          height={790}
          priority
          unoptimized
          className={styles.logo}
        />
        <p className={styles.word}>
          Trace<b>Build</b>
        </p>
      </div>
    </motion.div>
  );
}
