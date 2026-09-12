"use client";

import Image from "next/image";
import Link from "next/link";

const COLS: { title: string; links: { label: string; href: string; external?: boolean }[] }[] = [
  {
    title: "Produkt",
    links: [
      { label: "Produktvorschau", href: "#produkt" },
      { label: "Preise", href: "#preise" },
    ],
  },
  {
    title: "Unternehmen",
    links: [
      { label: "Team", href: "#kontakt" },
      { label: "Kontakt", href: "mailto:jonas@tracebuild.ch" },
      { label: "Impressum", href: "/impressum", external: true },
      { label: "Datenschutz", href: "/datenschutz", external: true },
      { label: "Anmelden", href: "/login", external: true },
    ],
  },
];

export default function Footer() {
  return (
    <footer
      style={{
        position: "relative",
        zIndex: 2,
        padding: "72px var(--tb-gutter) 40px",
      }}
    >
      <div
        style={{
          maxWidth: "var(--tb-max)",
          margin: "0 auto",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          gap: 40,
        }}
      >
        <div style={{ maxWidth: 320 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12 }}>
            <Image src="/Logo-new.png" alt="TraceBuild" width={533} height={400} style={{ height: 22, width: "auto", objectFit: "contain" }} />
            <span style={{ fontSize: 14, fontWeight: 600, fontFamily: "var(--font-display, sans-serif)" }}>
              Trace
              <span style={{ background: "var(--tb-accent-gradient)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>Build</span>
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: "var(--tb-text-tertiary)" }}>
            KI-Prüfung von Plänen gegen geltende Normen - als übersichtliche
            Auswertung, nicht als Eingriff. Verschlüsselt · DSG-konform.
          </p>
        </div>

        <div style={{ display: "flex", gap: 56, flexWrap: "wrap" }}>
          {COLS.map((c) => (
            <div key={c.title} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--tb-text-muted)" }}>
                {c.title}
              </span>
              {c.links.map((l) =>
                l.external ? (
                  <Link key={l.label} href={l.href} style={{ fontSize: 13, color: "var(--tb-text-secondary)", textDecoration: "none" }}>
                    {l.label}
                  </Link>
                ) : (
                  <a key={l.label} href={l.href} style={{ fontSize: 13, color: "var(--tb-text-secondary)", textDecoration: "none" }}>
                    {l.label}
                  </a>
                )
              )}
            </div>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: "var(--tb-max)", margin: "32px auto 0", paddingTop: 20, borderTop: "1px solid var(--tb-hairline)", fontSize: 12, color: "var(--tb-text-muted)" }}>
        © 2026 TraceBuild · Mels SG ·{" "}
        <Link href="/impressum" style={{ color: "inherit", textDecoration: "none" }}>Impressum</Link>
        {" · "}
        <Link href="/datenschutz" style={{ color: "inherit", textDecoration: "none" }}>Datenschutz</Link>
      </div>
    </footer>
  );
}
