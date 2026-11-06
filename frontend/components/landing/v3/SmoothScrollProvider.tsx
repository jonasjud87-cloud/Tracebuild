"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { MotionConfig, useReducedMotion } from "framer-motion";
import type Lenis from "lenis";

type LenisCtx = { lenis: Lenis | null; reducedMotion: boolean };
const Ctx = createContext<LenisCtx>({ lenis: null, reducedMotion: false });

export function useLenis() {
  return useContext(Ctx);
}

export default function SmoothScrollProvider({ children }: { children: React.ReactNode }) {
  const prefersReduced = useReducedMotion();
  const [lenis, setLenis] = useState<Lenis | null>(null);
  const rafId = useRef<number>();

  useEffect(() => {
    if (prefersReduced) return;

    let instance: Lenis | null = null;
    let cancelled = false;

    // Load Lenis after first paint so it never blocks hydration / LCP.
    const idle =
      "requestIdleCallback" in window
        ? window.requestIdleCallback
        : (cb: () => void) => window.setTimeout(cb, 200);

    idle(() => {
      if (cancelled) return;
      import("lenis").then(({ default: LenisCtor }) => {
        if (cancelled) return;
        instance = new LenisCtor({
          lerp: 0.1,
          wheelMultiplier: 1,
          smoothWheel: true,
        });
        setLenis(instance);

        const loop = (time: number) => {
          instance?.raf(time);
          rafId.current = requestAnimationFrame(loop);
        };
        rafId.current = requestAnimationFrame(loop);
      });
    });

    return () => {
      cancelled = true;
      if (rafId.current) cancelAnimationFrame(rafId.current);
      instance?.destroy();
      setLenis(null);
    };
  }, [prefersReduced]);

  return (
    <Ctx.Provider value={{ lenis, reducedMotion: !!prefersReduced }}>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </Ctx.Provider>
  );
}
