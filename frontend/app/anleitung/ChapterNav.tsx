"use client";

import { useEffect, useRef, useState } from "react";
import { CHAPTERS } from "./chapters";
import s from "./anleitung.module.css";

const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Sticky chapter bar + scrollspy for the handbook. Appears once the table of
 * contents (#inhalt) has scrolled out of view, highlights the chapter in view,
 * names the current section and shows reading progress. In-page anchor links
 * scroll smoothly (unless reduced motion is requested) and update the hash, so
 * every chapter and section is linkable — without JS the anchors still work.
 */
export default function ChapterNav() {
  const [visible, setVisible] = useState(false);
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  // Show the bar once the table of contents is out of view.
  useEffect(() => {
    const toc = document.getElementById("inhalt");
    if (!toc) return;
    const io = new IntersectionObserver(([e]) => setVisible(!e.isIntersecting && e.boundingClientRect.top < 0));
    io.observe(toc);
    return () => io.disconnect();
  }, []);

  // Scrollspy: the last chapter/section heading above a line just below the bar.
  useEffect(() => {
    const chapters = CHAPTERS.map((c) => document.getElementById(c.id)).filter(Boolean) as HTMLElement[];
    const sections = CHAPTERS.flatMap((c) => c.sections.map((x) => document.getElementById(x.id))).filter(
      Boolean,
    ) as HTMLElement[];

    let frame = 0;
    const update = () => {
      frame = 0;
      const line = 120;
      const lastAbove = (els: HTMLElement[]) => {
        let hit: HTMLElement | null = null;
        for (const el of els) if (el.getBoundingClientRect().top <= line) hit = el;
        return hit?.id ?? null;
      };
      const ch = lastAbove(chapters);
      const sec = lastAbove(sections);
      setChapterId(ch);
      // Only keep a section that belongs to the current chapter.
      const owner = CHAPTERS.find((c) => c.id === ch);
      setSectionId(owner?.sections.some((x) => x.id === sec) ? sec : null);

      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (progressRef.current) {
        progressRef.current.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`;
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  // Smooth in-page navigation for every "#…" link on the page.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href^="#"]');
      if (!a) return;
      const id = decodeURIComponent(a.getAttribute("href")!.slice(1));
      const target = id ? document.getElementById(id) : null;
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
      history.replaceState(null, "", `#${id}`);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  const current = CHAPTERS.find((c) => c.id === chapterId);
  const section = current?.sections.find((x) => x.id === sectionId);

  return (
    <nav className={`${s.bar} ${visible ? s.barVisible : ""}`} aria-label="Kapitel" aria-hidden={!visible}>
      <div className={`${s.wrap} ${s.barInner}`}>
        <a className={s.barTop} href="#inhalt" tabIndex={visible ? 0 : -1}>
          <span aria-hidden="true">↑</span> Inhalt
        </a>
        <ul className={s.barChapters}>
          {CHAPTERS.map((c) => (
            <li key={c.id}>
              <a href={`#${c.id}`} aria-current={c.id === chapterId} tabIndex={visible ? 0 : -1}>
                <span className={s.barNum}>{c.num}</span>
                {c.short}
              </a>
            </li>
          ))}
        </ul>
        {current && section && (
          <span className={s.barCurrent}>
            {current.num}.{current.sections.indexOf(section) + 1} {section.title}
          </span>
        )}
      </div>
      <div ref={progressRef} className={s.progress} aria-hidden="true" />
    </nav>
  );
}
