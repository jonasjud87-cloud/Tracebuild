"use client";

import { useEffect, useRef } from "react";
import { Plus_Jakarta_Sans } from "next/font/google";

const font = Plus_Jakarta_Sans({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-jakarta",
});

const REVEAL_SELECTOR =
  'section[data-screen-label]:not([data-screen-label^="01"]) > *, footer > * > *';

export default function LandingShell({ children }: { children: React.ReactNode }) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cleanups: Array<() => void> = [];

    let io: IntersectionObserver | null = null;
    if (!reduced && "IntersectionObserver" in window) {
      io = new IntersectionObserver(
        (entries) =>
          entries.forEach((e) => e.target.classList.toggle("in", e.isIntersecting)),
        { threshold: 0.12 }
      );
      cleanups.push(() => io?.disconnect());
    }

    const reveal = (el: HTMLElement, index: number, step: number) => {
      el.setAttribute("data-reveal", "");
      el.style.setProperty("--d", `${(index % 3) * step}s`);
      if (io) io.observe(el);
      else el.classList.add("in");
    };

    root.querySelectorAll<HTMLElement>(REVEAL_SELECTOR).forEach((el, i) => {
      if (el.tagName === "IMG" || el.children.length || el.textContent?.trim()) {
        reveal(el, i, 0.08);
      }
    });

    const header = root.querySelector<HTMLElement>("header");
    if (header && "ResizeObserver" in window) {
      const html = document.documentElement;
      const syncHeaderHeight = () => {
        const h = Math.round(header.getBoundingClientRect().height);
        html.style.setProperty("--tbl-header-h", `${h > 96 ? h : 72}px`);
      };
      const ro = new ResizeObserver(syncHeaderHeight);
      ro.observe(header);
      syncHeaderHeight();
      cleanups.push(() => {
        ro.disconnect();
        html.style.removeProperty("--tbl-header-h");
      });
    }
    const bar = root.querySelector<HTMLElement>("#tb-progress");
    const parallax = reduced
      ? []
      : Array.from(root.querySelectorAll<HTMLElement>("[data-par]"));

    let raf = 0;
    const update = () => {
      raf = 0;
      const y = window.scrollY;
      header?.classList.toggle("scrolled", y > 40);
      if (bar) {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        bar.style.width = `${max > 0 ? Math.min(100, (y / max) * 100) : 0}%`;
      }
      if (y < window.innerHeight * 1.2) {
        parallax.forEach((el) => {
          const factor = parseFloat(el.dataset.par ?? "0") || 0;
          el.style.transform = `translateY(${y * factor}px)`;
        });
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    update();
    cleanups.push(() => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
      parallax.forEach((el) => {
        el.style.transform = "";
      });
    });

    if (window.matchMedia("(pointer: fine)").matches) {
      const dot = document.createElement("div");
      dot.setAttribute("data-tb-cursor", "");
      dot.setAttribute("aria-hidden", "true");
      dot.style.cssText =
        "position:fixed;left:0;top:0;pointer-events:none;z-index:9999;mix-blend-mode:difference;" +
        "width:10px;height:10px;margin:-5px 0 0 -5px;background:#F0C99A;" +
        "box-shadow:0 0 0 1px rgba(7,20,43,.6);border-radius:50%;opacity:0;" +
        "transition:width .2s,height .2s,margin .2s,opacity .2s";
      document.body.appendChild(dot);

      let big = false;
      let shown = false;
      const onMove = (e: MouseEvent) => {
        dot.style.transform = `translate(${e.clientX}px,${e.clientY}px)`;
        if (!shown) {
          shown = true;
          dot.style.opacity = "1";
          root.classList.add("tbl--cursor");
          document.documentElement.classList.add("tbl-cursor");
        }
        const target = e.target as Element | null;
        const hot = !!(target && target.closest && target.closest("a,button"));
        if (hot !== big) {
          big = hot;
          const z = hot ? 18 : 10;
          dot.style.width = dot.style.height = `${z}px`;
          dot.style.margin = `-${z / 2}px 0 0 -${z / 2}px`;
        }
      };
      const onLeave = () => {
        dot.style.opacity = "0";
      };
      const onEnter = () => {
        if (shown) dot.style.opacity = "1";
      };
      window.addEventListener("mousemove", onMove);
      document.documentElement.addEventListener("mouseleave", onLeave);
      document.documentElement.addEventListener("mouseenter", onEnter);
      cleanups.push(() => {
        window.removeEventListener("mousemove", onMove);
        document.documentElement.removeEventListener("mouseleave", onLeave);
        document.documentElement.removeEventListener("mouseenter", onEnter);
        root.classList.remove("tbl--cursor");
        document.documentElement.classList.remove("tbl-cursor");
        dot.remove();
      });
    }

    return () => cleanups.forEach((fn) => fn());
  }, []);

  return (
    <div ref={rootRef} className={`tbl ${font.variable} ${font.className}`}>
      {children}
    </div>
  );
}
