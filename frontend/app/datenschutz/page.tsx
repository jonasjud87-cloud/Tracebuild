import Link from "next/link";
import type { Metadata } from "next";
import AmbientField from "@/components/landing/redesign/AmbientField";
import Footer from "@/components/landing/redesign/Footer";

export const metadata: Metadata = {
  title: "Datenschutz - TraceBuild",
  description: "Datenschutzerklärung von TraceBuild nach Schweizer Datenschutzgesetz.",
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

export default function DatenschutzPage() {
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
            Datenschutz
          </h1>

          <p style={{ ...body, marginTop: 16, color: "var(--tb-text-secondary)" }}>
            Wir bearbeiten Personendaten sorgfältig und nach den Grundsätzen des
            Schweizer Datenschutzgesetzes (DSG). Diese Erklärung fasst zusammen,
            welche Daten wir zu welchem Zweck bearbeiten.
          </p>

          <div style={section}>
            <h2 style={h2}>Verantwortliche Stelle</h2>
            <p style={body}>
              TraceBuild
              <br />
              Jonas Jud &amp; Livio Thoma
              <br />
              Mels SG, Schweiz
              <br />
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
            <h2 style={h2}>Welche Daten wir bearbeiten</h2>
            <p style={body}>
              Bei Kontakt- und Demo-Anfragen bearbeiten wir die Angaben, die Sie
              uns übermitteln - in der Regel Name, E-Mail-Adresse und den Inhalt
              Ihrer Nachricht. Beim Betrieb der Website fallen zudem technische
              Server-Logs an (IP-Adresse, Zeitpunkt des Zugriffs, aufgerufene
              Seite, Browsertyp).
            </p>
          </div>

          <div style={section}>
            <h2 style={h2}>Zweck der Bearbeitung</h2>
            <p style={body}>
              Wir bearbeiten diese Daten, um Ihre Anfrage zu beantworten und mit
              Ihnen in Kontakt zu treten, sowie zum sicheren und stabilen Betrieb
              der Website.
            </p>
          </div>

          <div style={section}>
            <h2 style={h2}>Weitergabe an Dritte</h2>
            <p style={body}>
              Wir geben Ihre Daten nicht zu Werbezwecken an Dritte weiter. Für den
              Betrieb setzen wir sorgfältig ausgewählte Dienstleister ein (etwa
              für Hosting), die Daten als Auftragsbearbeiter und nur nach unseren
              Weisungen bearbeiten.
            </p>
          </div>

          <div style={section}>
            <h2 style={h2}>Aufbewahrung</h2>
            <p style={body}>
              Wir bewahren Personendaten nur so lange auf, wie es für den
              jeweiligen Zweck oder aufgrund gesetzlicher Vorgaben nötig ist.
              Danach werden sie gelöscht oder anonymisiert.
            </p>
          </div>

          <div style={section}>
            <h2 style={h2}>Ihre Rechte</h2>
            <p style={body}>
              Sie haben das Recht auf Auskunft über die zu Ihnen bearbeiteten
              Daten sowie auf Berichtigung oder Löschung. Wenden Sie sich dazu
              per E-Mail an eine der oben genannten Adressen.
            </p>
          </div>

          <p style={{ ...body, marginTop: 40, fontSize: 12.5, color: "var(--tb-text-muted)" }}>
            Diese Erklärung wird bei Bedarf angepasst.
          </p>
        </div>
      </div>

      <Footer />
    </div>
  );
}
