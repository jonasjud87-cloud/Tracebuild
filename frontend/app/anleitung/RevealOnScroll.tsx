"use client";

import { useEffect } from "react";

export default function RevealOnScroll({ selector, step = 50 }: { selector: string; step?: number }) {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;

    const els = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(
      (el) => el.getBoundingClientRect().top > window.innerHeight * 0.92,
    );
    if (!els.length) return;

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          const el = e.target as HTMLElement;
          el.style.opacity = "";
          el.style.transform = "";
          const done = () => {
            el.style.transition = "";
            el.style.transitionDelay = "";
            el.style.willChange = "";
          };
          el.addEventListener("transitionend", done, { once: true });
          window.setTimeout(done, 1200);
          io.unobserve(el);
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -6% 0px" },
    );

    els.forEach((el, i) => {
      el.style.opacity = "0";
      el.style.transform = "translateY(18px)";
      el.style.transition = "opacity 0.6s ease, transform 0.6s ease";
      el.style.transitionDelay = `${(i % 4) * step}ms`;
      el.style.willChange = "opacity, transform";
      io.observe(el);
    });

    return () => {
      io.disconnect();
      els.forEach((el) => {
        el.style.opacity = "";
        el.style.transform = "";
        el.style.transition = "";
        el.style.transitionDelay = "";
        el.style.willChange = "";
      });
    };
  }, [selector, step]);

  return null;
}
