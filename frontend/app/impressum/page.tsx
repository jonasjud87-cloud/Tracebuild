import Link from "next/link";
import type { Metadata } from "next";
import AmbientField from "@/components/landing/redesign/AmbientField";
import Footer from "@/components/landing/redesign/Footer";

export const metadata: Metadata = {
  title: "Impressum - TraceBuild",
  description: "Impressum und Kontaktangaben zu TraceBuild.",
};

const section: React.CSSProperties = { marginTop: 32 };
const h2: React.CSSProperties = {
  fontFamily: "var(--font-display, sans-serif)",
  fontWeight: 600,
  fontSize: 15,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--tb-text-tertiary)",
  margin: "0 0 10px",
};
const body: React.CSSProperties = {
  margin: 0,
  fontSize: 15,
  lineHeight: 1.7,
  color: "var(--tb-text-bright)",
};

export default function ImpressumPage() {
  return (
    <div className="tb-landing" style={{ minHeight: "100vh" }}>
      <AmbientField />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          padding: "clamp(64px, 12vh, 140px) var(--tb-gutter)",
        }}
      >
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <Link
          href="/"
          style={{ fontSize: 13, color: "var(--tb-accent)", textDecoration: "none" }}
        >
          ← Zurück zur Startseite
        </Link>

        <h1
          style={{
            fontFamily: "var(--font-display, sans-serif)",
            fontWeight: 600,
            fontSize: "clamp(30px, 5vw, 46px)",
            letterSpacing: "-0.025em",
            margin: "24px 0 0",
          }}
        >
          Impressum
        </h1>

        <div style={section}>
          <h2 style={h2}>Anbieter</h2>
          <p style={body}>
            TraceBuild
            <br />
            Jonas Jud &amp; Livio Thoma
            <br />
            Mels SG, Schweiz
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>Kontakt</h2>
          <p style={body}>
            <a href="mailto:jonas@tracebuild.ch" style={{ color: "var(--tb-accent)", textDecoration: "none" }}>
              jonas@tracebuild.ch
            </a>
            <br />
            <a href="mailto:livio@tracebuild.ch" style={{ color: "var(--tb-accent)", textDecoration: "none" }}>
              livio@tracebuild.ch
            </a>
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>Verantwortlich für den Inhalt</h2>
          <p style={body}>Jonas Jud, Livio Thoma</p>
        </div>

        <div style={section}>
          <h2 style={h2}>Haftungsausschluss</h2>
          <p style={body}>
            Die Inhalte dieser Website wurden mit Sorgfalt erstellt. Für die
            Richtigkeit, Vollständigkeit und Aktualität wird keine Gewähr
            übernommen. Die auf der Website dargestellten Prüfergebnisse dienen
            als Unterstützung; die inhaltliche Beurteilung und die Freigabe von
            Plänen liegen bei den Nutzenden.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>Urheberrecht</h2>
          <p style={body}>
            Alle Inhalte dieser Website sind urheberrechtlich geschützt. Eine
            Weiterverwendung bedarf der vorgängigen schriftlichen Zustimmung.
          </p>
        </div>

        <p style={{ ...body, marginTop: 40, fontSize: 12.5, color: "var(--tb-text-muted)" }}>
          Angaben zu Adresse und Rechtsform werden ergänzt.
        </p>
      </div>
      </div>

      <Footer />
    </div>
  );
}
