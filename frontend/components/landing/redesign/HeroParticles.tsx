"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";

/**
 * Hero backdrop: a slowly rotating 3D ring of ~800 glowing particles.
 * Ported from the pre-redesign landing page. Palette only (the SA→SB→SC stops
 * are the brand cyan / sky / blue). Canvas 2D, DPR-clamped, 30 fps, pauses
 * off-screen. Under prefers-reduced-motion it paints one static frame.
 */

const N = 800;
const SA = [79, 209, 255]; // #4fd1ff
const SB = [56, 189, 248]; // #38bdf8
const SC = [40, 98, 215]; // #2862d7

const pr = (s: number) => {
  const x = Math.sin(s) * 43758.5453;
  return x - Math.floor(x);
};
const lp = (a: number, b: number, t: number) => a + (b - a) * t;

function buildRing() {
  const pts: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < N; i++) {
    const a = pr(i * 5.3) * Math.PI * 2;
    const r = 0.66 + pr(i * 7.1) * 0.36;
    pts.push({
      x: Math.cos(a) * r * 0.82,
      y: Math.sin(a) * r * 0.88 * 0.82,
      z: (pr(i * 2.2) - 0.5) * 0.12 * 0.82,
    });
  }
  return pts;
}

export default function HeroParticles({
  scrollRef,
  opacity = 1,
}: {
  scrollRef?: React.MutableRefObject<number>;
  opacity?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const prefersReduced = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const ring = buildRing();
    const isMobile = window.matchMedia("(max-width: 768px)").matches;
    const maxDpr = isMobile ? 0.75 : 1.5;
    let w = 0;
    let h = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
      w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      canvas.width = w;
      canvas.height = h;
    };
    resize();
    window.addEventListener("resize", resize);

    const render = (time: number) => {
      const scroll = scrollRef?.current ?? 0;
      // no rotation of the ring as a whole — fixed orientation, particles only wobble
      const rotY = 0.2;
      const tiltX = 0.3;
      const cosR = Math.cos(rotY);
      const sinR = Math.sin(rotY);
      const cosT = Math.cos(tiltX);
      const sinT = Math.sin(tiltX);
      const cx = w / 2;
      const cy = h / 2;
      const sc = Math.min(w, h) * 0.62 * (1 + scroll * 0.28);
      const fade = 1 - scroll * 0.7;

      ctx.clearRect(0, 0, w, h);
      if (fade <= 0.02) return;

      const wob = 0.011;
      for (let i = 0; i < N; i++) {
        const p = ring[i];
        const dx = p.x + Math.sin(time * 0.5 + i * 0.7) * wob;
        const dy = p.y + Math.cos(time * 0.42 + i * 1.3) * wob;
        const dz = p.z + Math.sin(time * 0.6 + i) * wob * 0.6;
        const rx = dx * cosR + dz * sinR;
        let rz = -dx * sinR + dz * cosR;
        const ry = dy * cosT - rz * sinT;
        rz = dy * sinT + rz * cosT;
        const psp = Math.min(5, Math.max(0.2, 2.6 / Math.max(0.4, 2.6 + rz)));
        const sx = cx + rx * sc * psp;
        const sy = cy + ry * sc * psp;
        const sz = Math.max(0.5, Math.min(4.5, 1.25 * psp));
        if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue;
        const tw = 0.7 + 0.3 * Math.sin(time * 2.4 + i * 0.37);
        const op = Math.max(0.3, Math.min(1, (0.6 + (psp - 0.75) * 1.6) * tw)) * fade;
        const ct = Math.max(0, Math.min(1, (p.y + 1) / 2));
        const from = ct < 0.5 ? SA : SB;
        const to = ct < 0.5 ? SB : SC;
        const lct = ct < 0.5 ? ct / 0.5 : (ct - 0.5) / 0.5;
        const r = Math.round(lp(from[0], to[0], lct));
        const g = Math.round(lp(from[1], to[1], lct));
        const b = Math.round(lp(from[2], to[2], lct));
        ctx.fillStyle = `rgba(${Math.min(255, r + 40)},${Math.min(255, g + 40)},${Math.min(255, b + 40)},${op.toFixed(2)})`;
        ctx.fillRect(sx - sz * 0.9, sy - sz * 0.9, sz * 1.8, sz * 1.8);
      }
    };

    if (prefersReduced) {
      render(0);
      return () => window.removeEventListener("resize", resize);
    }

    let raf = 0;
    let visible = true;
    let last = performance.now();
    let acc = 0;
    const FRAME_MS = 1000 / 30;
    const start = performance.now();

    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), { threshold: 0 });
    io.observe(canvas);

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || document.hidden) {
        last = now;
        return;
      }
      acc += now - last;
      last = now;
      if (acc < FRAME_MS) return;
      acc = 0;
      render((now - start) / 1000);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [prefersReduced, scrollRef]);

  return (
    <div aria-hidden style={{ position: "absolute", inset: 0, overflow: "hidden", opacity }}>
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background:
            "radial-gradient(52% 40% at 50% 50%, rgba(7,11,20,0.55) 0%, rgba(7,11,20,0.15) 50%, transparent 78%)",
        }}
      />
    </div>
  );
}
