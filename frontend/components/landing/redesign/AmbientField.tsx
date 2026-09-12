"use client";

import { useReducedMotion } from "framer-motion";

type Blob = {
  color: string;
  size: string;
  top: string;
  left: string;
  blur: number;
  opacity: number;
  anim: string;
};

/**
 * Ambient light field for the mid-page sections (ProblemSolution → TeamContact)
 * and behind the Footer. A fixed, non-interactive layer of large, heavily
 * blurred radial "light" blobs in the locked brand palette — cyan, sky, blue,
 * info-blue, lavender — drifting slowly and independently so the backdrop feels
 * like shifting coloured light instead of flat navy.
 *
 * Only transform/opacity animate; blur is static per layer. Under
 * prefers-reduced-motion every drift freezes and a static coloured wash remains.
 */
const BLOBS: Blob[] = [
  { color: "var(--tb-accent-cyan)", size: "52vw", top: "-12%", left: "-10%", blur: 90, opacity: 0.18, anim: "tbAmbientDrift1 21s" },
  { color: "var(--tb-lavender)", size: "48vw", top: "26%", left: "58%", blur: 104, opacity: 0.16, anim: "tbAmbientDrift2 25s" },
  { color: "var(--tb-accent-blue)", size: "56vw", top: "60%", left: "-14%", blur: 112, opacity: 0.2, anim: "tbAmbientDrift3 23s" },
  { color: "var(--tb-info)", size: "40vw", top: "6%", left: "44%", blur: 80, opacity: 0.14, anim: "tbAmbientDrift4 18s" },
  { color: "var(--tb-accent)", size: "46vw", top: "78%", left: "56%", blur: 96, opacity: 0.15, anim: "tbAmbientDrift1 26s reverse" },
];

export default function AmbientField() {
  const reduce = useReducedMotion();

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        overflow: "hidden",
        isolation: "isolate",
        contain: "layout paint style",
      }}
    >
      {BLOBS.map((b, i) => (
        <div
          key={i}
          className="tb-ambient-blob"
          style={{
            width: b.size,
            height: b.size,
            top: b.top,
            left: b.left,
            opacity: b.opacity,
            background: `radial-gradient(circle at 50% 50%, ${b.color} 0%, rgba(255,255,255,0) 72%)`,
            filter: `blur(${b.blur}px)`,
            animation: reduce ? "none" : `${b.anim} var(--tb-ease-inout) infinite`,
            animationDelay: reduce ? undefined : `${-i * 3.5}s`,
            willChange: reduce ? undefined : "transform",
          }}
        />
      ))}

      <div
        className="tb-ambient-sheen"
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: "160vw",
          height: "160vw",
          marginTop: "-80vw",
          marginLeft: "-80vw",
          opacity: 0.06,
          background:
            "conic-gradient(from 0deg at 50% 50%, var(--tb-lavender), rgba(255,255,255,0) 22%, var(--tb-accent-cyan) 48%, rgba(255,255,255,0) 72%, var(--tb-info) 100%)",
          filter: "blur(120px)",
          mixBlendMode: "screen",
          animation: reduce ? "none" : "tbAmbientSheen 120s linear infinite",
          willChange: reduce ? undefined : "transform",
        }}
      />
    </div>
  );
}
