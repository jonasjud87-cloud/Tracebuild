"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";
import IntroText from "./IntroText";
import { useLenis } from "./SmoothScrollProvider";

const slideEase: [number, number, number, number] = [0.7, 0, 0.2, 1];
const useIsoEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/* Phase timeline (non-reduced):
   A  0 → 1900ms   logo + wordmark fade/scale in, sit
   B  1900 → ~2350 logo + wordmark fade/scale out (0.45s)
   C  2500 → 8800  particles assemble into "Vision. Technology. Impact."
                   (~1.9s) then hold ~4.4s so the words are clearly readable
   D  8800ms       overlay slides up (0.7s), unmounts on animation complete
   Total on screen ≈ 9.5s. The scene cannot be skipped — scrolling is fully
   blocked until it finishes.
   Reduced motion: hold 1500ms, 300ms opacity fade, unmount — no B, no C. */
const PHASE_B_MS = 1900;
const PHASE_C_MS = 2500;
const PHASE_D_MS = 8800;
const REDUCED_HOLD_MS = 1500;

export default function IntroOverlay() {
  const prefersReduced = useReducedMotion();
  const { lenis } = useLenis();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const finished = useRef(false);
  const [inDom, setInDom] = useState(true);
  const [leaving, setLeaving] = useState(false);
  const [logoOut, setLogoOut] = useState(false);
  const [showText, setShowText] = useState(false);

  // Hand-shake so the pure-CSS auto-exit fallback yields to the JS version.
  useIsoEffect(() => {
    rootRef.current?.classList.add("tb-intro--js");
  }, []);

  // Hard scroll lock for the whole scene — released only once it has fully ended.
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

  // Lenis initialises after idle, i.e. mid-scene — stop it, restart when done.
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

  // Failsafe: if onAnimationComplete never fires (render error, superseded
  // animation, mid-leave reduced-motion toggle), the scroll-lock must still
  // release. Hard-remove the overlay a bit after it should have gone.
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
      className="tb-intro"
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
      <div className="tb-intro__glows" aria-hidden="true">
        <span className="tb-intro__glow tb-intro__glow--a" />
        <span className="tb-intro__glow tb-intro__glow--b" />
        <span className="tb-intro__glow tb-intro__glow--c" />
        <span className="tb-intro__sweep" />
      </div>

      {!prefersReduced && showText && <IntroText />}

      <div className={`tb-intro__stack${logoOut ? " tb-intro__stack--out" : ""}`}>
        <Image
          src="/Logo-new.png"
          alt="TraceBuild"
          width={533}
          height={400}
          priority
          className="tb-intro__logo"
        />
        <p className="tb-intro__word">
          Trace<b>Build</b>
        </p>
      </div>
    </motion.div>
  );
}
