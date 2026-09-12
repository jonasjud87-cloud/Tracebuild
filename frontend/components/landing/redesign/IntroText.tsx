"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";

/**
 * Intro overlay · Phase C. ~2600 particles scatter in from anywhere across the
 * viewport and lerp onto the glyphs of the phrase "Vision. Technologie. Wirkung."
 * (sampled from an
 * offscreen canvas), then hold with a faint per-particle shimmer. Canvas 2D,
 * full-viewport, DPR-clamped, 30 fps, pauses off-screen / hidden, RAF cancelled
 * on unmount. Palette only: the SA/SB/SC stops are the brand cyan / sky / blue,
 * sampled by target X so it reads left-to-right like the wordmark.
 */

const TEXT = "Vision. Technologie. Wirkung.";
const SA = [79, 209, 255]; // #4fd1ff
const SB = [56, 189, 248]; // #38bdf8
const SC = [40, 98, 215]; // #2862d7
const ASSEMBLE_MS = 1900;
const DESIRED = 2600;

const lp = (a: number, b: number, t: number) => a + (b - a) * t;
const rnd = (s: number) => {
  const x = Math.sin(s) * 43758.5453;
  return x - Math.floor(x);
};

function colorFor(nx: number) {
  const ct = Math.max(0, Math.min(1, nx));
  const from = ct < 0.5 ? SA : SB;
  const to = ct < 0.5 ? SB : SC;
  const lct = ct < 0.5 ? ct / 0.5 : (ct - 0.5) / 0.5;
  return [
    Math.min(255, Math.round(lp(from[0], to[0], lct)) + 25),
    Math.min(255, Math.round(lp(from[1], to[1], lct)) + 25),
    Math.min(255, Math.round(lp(from[2], to[2], lct)) + 25),
  ];
}

function sampleText(cw: number, ch: number, fam: string, step: number) {
  const oc = document.createElement("canvas");
  oc.width = cw;
  oc.height = ch;
  const octx = oc.getContext("2d");
  if (!octx) return [] as { x: number; y: number }[];

  // Stack the phrase over multiple lines on narrower canvases so it stays big
  // and legible; keep it on one line when there's room.
  const words = TEXT.split(" ");
  const probe = 100;
  octx.font = `700 ${probe}px ${fam}`;
  const oneLineW = octx.measureText(TEXT).width || 1;
  const widestWordW = Math.max(...words.map((w) => octx.measureText(w).width || 1));
  const lines = cw / (oneLineW / probe) < cw * 0.9 && cw > 720 ? [TEXT] : words;
  const perLineTarget = lines.length === 1 ? oneLineW : widestWordW;

  const targetW = cw * (lines.length === 1 ? 0.82 : 0.7);
  let fontPx = Math.floor((probe * targetW) / perLineTarget);
  fontPx = Math.max(11, Math.min(Math.floor((ch * 0.82) / lines.length), fontPx));
  octx.font = `700 ${fontPx}px ${fam}`;
  octx.textAlign = "center";
  octx.textBaseline = "middle";
  octx.fillStyle = "#fff";
  const lineH = fontPx * 1.14;
  const top = ch / 2 - ((lines.length - 1) * lineH) / 2;
  lines.forEach((ln, i) => octx.fillText(ln, cw / 2, top + i * lineH));

  let data: Uint8ClampedArray;
  try {
    data = octx.getImageData(0, 0, cw, ch).data;
  } catch {
    return [] as { x: number; y: number }[];
  }

  const hits: { x: number; y: number }[] = [];
  for (let y = 0; y < ch; y += step) {
    for (let x = 0; x < cw; x += step) {
      if (data[(y * cw + x) * 4 + 3] > 128) hits.push({ x, y });
    }
  }
  if (hits.length === 0) return hits;

  const desired = Math.min(hits.length, DESIRED);
  const stride = hits.length / desired;
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < desired; i += 1) {
    const hpt = hits[Math.floor(i * stride)];
    out.push({
      x: hpt.x + (rnd(i * 3.3) - 0.5) * step,
      y: hpt.y + (rnd(i * 8.1) - 0.5) * step,
    });
  }
  return out;
}

export default function IntroText() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const prefersReduced = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let cancelled = false;
    let raf = 0;
    let io: IntersectionObserver | null = null;
    let onResize: (() => void) | null = null;

    let dispFam = "";
    try {
      dispFam = getComputedStyle(document.documentElement)
        .getPropertyValue("--font-display")
        .trim();
    } catch {}
    const primaryFam = dispFam || '"Archivo"';
    const fontSpec = `700 80px ${primaryFam}`;

    const run = (fontOk: boolean) => {
      if (cancelled || !canvasRef.current) return;
      const isMobile = window.matchMedia("(max-width: 768px)").matches;
      const maxDpr = isMobile ? 0.75 : 1.5;
      const fam = fontOk
        ? `${primaryFam}, "Archivo", system-ui, sans-serif`
        : "system-ui, sans-serif";

      let w = 0;
      let h = 0;
      let dpr = 1;
      let parts: {
        tx: number;
        ty: number;
        nx: number;
        x: number;
        y: number;
        sp: number;
        ph: number;
      }[] = [];

      const build = () => {
        dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
        w = Math.max(1, Math.round(canvas.clientWidth * dpr));
        h = Math.max(1, Math.round(canvas.clientHeight * dpr));
        canvas.width = w;
        canvas.height = h;
        const step = Math.max(2, Math.round(dpr * 1.4));
        const targets = sampleText(w, h, fam, step);
        const prev = parts;
        parts = targets.map((tg, i) => {
          const old = prev[i];
          return {
            tx: tg.x,
            ty: tg.y,
            nx: tg.x / w,
            x: old ? old.x : (rnd(i * 1.7) * 1.3 - 0.15) * w,
            y: old ? old.y : (rnd(i * 3.9) * 1.3 - 0.15) * h,
            sp: 0.6 + rnd(i * 5.2) * 0.9,
            ph: rnd(i * 9.4) * Math.PI * 2,
          };
        });
      };
      build();

      onResize = () => build();
      window.addEventListener("resize", onResize);

      const draw = (elapsed: number) => {
        const conv = Math.min(1, elapsed / ASSEMBLE_MS);
        const settled = elapsed >= ASSEMBLE_MS;
        const ease = 0.06 + 0.03 * conv;
        const dot = Math.max(0.85, (isMobile ? 0.95 : 1.1) * dpr);
        const t = elapsed / 1000;

        ctx.clearRect(0, 0, w, h);
        for (let i = 0; i < parts.length; i += 1) {
          const p = parts[i];
          p.x += (p.tx - p.x) * ease;
          p.y += (p.ty - p.y) * ease;
          let dx = p.x;
          let dy = p.y;
          if (settled) {
            dx += Math.sin(t * p.sp + p.ph) * 0.9;
            dy += Math.cos(t * p.sp * 0.9 + p.ph) * 0.9;
          }
          if (!Number.isFinite(dx) || !Number.isFinite(dy)) continue;
          const shim = settled
            ? 0.72 + 0.28 * Math.sin(t * (1.6 + p.sp) + p.ph)
            : 0.3 + 0.55 * conv;
          const [r, g, b] = colorFor(p.nx);
          ctx.fillStyle = `rgba(${r},${g},${b},${shim.toFixed(2)})`;
          ctx.fillRect(dx - dot, dy - dot, dot * 2, dot * 2);
        }
      };

      if (prefersReduced) {
        for (const p of parts) {
          p.x = p.tx;
          p.y = p.ty;
        }
        draw(ASSEMBLE_MS + 400);
        return;
      }

      let visible = true;
      let last = performance.now();
      let acc = 0;
      const FRAME_MS = 1000 / 30;
      const start = performance.now();

      io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), { threshold: 0 });
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
        draw(now - start);
      };
      raf = requestAnimationFrame(loop);
    };

    const done = (ok: boolean) => {
      if (cancelled) return;
      run(ok);
    };

    try {
      if (typeof document !== "undefined" && document.fonts && document.fonts.load) {
        Promise.all([document.fonts.load(fontSpec), document.fonts.load('700 80px "Archivo"')])
          .then(() => document.fonts.ready)
          .then(() => {
            let ok = false;
            try {
              ok = document.fonts.check(fontSpec) || document.fonts.check('700 80px "Archivo"');
            } catch {}
            done(ok);
          })
          .catch(() => done(false));
      } else {
        done(false);
      }
    } catch {
      done(false);
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      io?.disconnect();
      if (onResize) window.removeEventListener("resize", onResize);
    };
  }, [prefersReduced]);

  return (
    <div className="tb-intro__text" aria-hidden="true">
      <canvas ref={canvasRef} className="tb-intro__text-canvas" />
    </div>
  );
}
