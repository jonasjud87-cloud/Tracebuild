"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { useLenis } from "./SmoothScrollProvider";
import { GradientButton } from "./primitives";
import { EASE_OUT } from "@/lib/landing/motion";

const LINKS = [
  { href: "#produkt", label: "Produktvorschau" },
  { href: "#vertrauen", label: "Qualität" },
  { href: "#preise", label: "Preise" },
  { href: "#kontakt", label: "Team" },
];

export default function Navbar() {
  const { lenis } = useLenis();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [active, setActive] = useState<string>("");

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const ids = LINKS.map((l) => l.href.slice(1));
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setActive(e.target.id);
        });
      },
      { rootMargin: "-45% 0px -50% 0px" }
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onResize = () => window.innerWidth > 860 && setMenuOpen(false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [menuOpen]);

  function go(e: React.MouseEvent, href: string) {
    e.preventDefault();
    setMenuOpen(false);
    const el = document.querySelector(href);
    if (!el) return;
    if (lenis) lenis.scrollTo(el as HTMLElement, { offset: -90 });
    else el.scrollIntoView({ behavior: "smooth", block: "start" });
    history.replaceState(null, "", href);
  }

  return (
    <header
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        height: 80, // reserved — inner bar resizes inside this, no content shift
        pointerEvents: "none",
      }}
    >
      <motion.div
        style={{
          pointerEvents: "auto",
          width: "calc(100% - 32px)",
          maxWidth: "var(--tb-max-wide)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 24,
          borderRadius: "var(--tb-r-card)",
          // blur only once the bar has a solid backing — a backdrop-filter over the
          // transparent hero bar leaves a ghost fringe on the CTA button
          backdropFilter: scrolled ? "blur(16px)" : "none",
          WebkitBackdropFilter: scrolled ? "blur(16px)" : "none",
          border: "1px solid rgba(255,255,255,0)",
        }}
        animate={{
          marginTop: scrolled ? 12 : 18,
          height: scrolled ? 58 : 66,
          paddingLeft: scrolled ? 18 : 22,
          paddingRight: scrolled ? 14 : 16,
          backgroundColor: scrolled ? "rgba(10,20,32,0.72)" : "rgba(10,20,32,0)",
          borderColor: scrolled ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0)",
        }}
        transition={{ duration: 0.45, ease: EASE_OUT }}
      >
        {/* wordmark */}
        <a
          href="#top"
          onClick={(e) => go(e, "#top")}
          style={{ display: "flex", alignItems: "center", gap: 9, textDecoration: "none" }}
        >
          <Image
            src="/Logo-new.png"
            alt="TraceBuild"
            width={533}
            height={400}
            priority
            style={{ height: 28, width: "auto", objectFit: "contain", display: "block" }}
          />
          <span
            style={{
              fontSize: 15.5,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: "var(--tb-text)",
              fontFamily: "var(--font-display, sans-serif)",
            }}
          >
            Trace
            <span
              style={{
                background: "var(--tb-accent-gradient)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              Build
            </span>
          </span>
        </a>

        {/* desktop links */}
        <nav
          className="tb-nav-links"
          style={{ display: "flex", alignItems: "center", gap: 30 }}
        >
          {LINKS.map((l) => {
            const isActive = active === l.href.slice(1);
            return (
              <a
                key={l.href}
                href={l.href}
                onClick={(e) => go(e, l.href)}
                style={{
                  position: "relative",
                  fontSize: 13,
                  fontWeight: 500,
                  letterSpacing: "0.02em",
                  color: isActive ? "var(--tb-text)" : "var(--tb-text-secondary)",
                  textDecoration: "none",
                  padding: "6px 0",
                  transition: "color var(--tb-dur-base) var(--tb-ease-out)",
                }}
              >
                {l.label}
                {isActive && (
                  <motion.span
                    layoutId="tb-nav-underline"
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      bottom: 0,
                      height: 2,
                      borderRadius: 2,
                      background: "var(--tb-accent-gradient)",
                    }}
                    transition={{ duration: 0.35, ease: EASE_OUT }}
                  />
                )}
              </a>
            );
          })}
        </nav>

        {/* actions */}
        <div className="tb-nav-actions" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link
            href="/login"
            className="tb-nav-login"
            style={{
              fontSize: 13,
              fontWeight: 500,
              letterSpacing: "0.02em",
              color: "var(--tb-text)",
              textDecoration: "none",
              padding: "8px 4px",
            }}
          >
            Anmelden
          </Link>
          <span className="tb-nav-demo">
            <GradientButton href="#kontakt" onClick={() => {}}>
              Loslegen
            </GradientButton>
          </span>
          <button
            className="tb-nav-burger"
            aria-label={menuOpen ? "Menü schliessen" : "Menü öffnen"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            style={{
              display: "none",
              width: 38,
              height: 38,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "var(--tb-r-chip)",
              background: "var(--tb-glass)",
              border: "1px solid var(--tb-border)",
              cursor: "pointer",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              {menuOpen ? (
                <path d="M3 3L13 13M13 3L3 13" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
              ) : (
                <path d="M2.5 4.5H13.5M2.5 8H13.5M2.5 11.5H13.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
      </motion.div>

      {/* mobile overlay */}
      <AnimatePresence>
        {menuOpen && (
          <motion.nav
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.24, ease: EASE_OUT }}
            style={{
              pointerEvents: "auto",
              width: "calc(100% - 32px)",
              maxWidth: 420,
              marginTop: 8,
              padding: 8,
              display: "flex",
              flexDirection: "column",
              gap: 2,
              background: "rgba(10,16,26,0.96)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              border: "1px solid var(--tb-border)",
              borderRadius: "var(--tb-r-card)",
              boxShadow: "var(--tb-float-shadow)",
            }}
          >
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={(e) => go(e, l.href)}
                style={{
                  padding: "14px 16px",
                  fontSize: 14,
                  fontWeight: 500,
                  color: "var(--tb-text-bright-2)",
                  textDecoration: "none",
                  borderRadius: "var(--tb-r-btn)",
                }}
              >
                {l.label}
              </a>
            ))}
            <Link
              href="/login"
              style={{
                padding: "14px 16px",
                fontSize: 14,
                fontWeight: 500,
                color: "var(--tb-text)",
                textDecoration: "none",
                borderRadius: "var(--tb-r-btn)",
              }}
            >
              Anmelden
            </Link>
          </motion.nav>
        )}
      </AnimatePresence>

      <style>{`
        @media (max-width: 860px) {
          .tb-nav-links, .tb-nav-demo, .tb-nav-login { display: none !important; }
          .tb-nav-burger { display: flex !important; }
        }
      `}</style>
    </header>
  );
}
