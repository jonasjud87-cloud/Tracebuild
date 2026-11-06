import Link from "next/link";
import type { Metadata } from "next";
import "@/components/landing/v3/landing.css";
import LandingShell from "@/components/landing/v3/LandingShell";
import Navbar from "@/components/landing/v3/Navbar";
import Footer from "@/components/landing/v3/Footer";

export const metadata: Metadata = {
  title: "Datenschutz - TraceBuild",
  description: "Datenschutzerklärung von TraceBuild nach Schweizer Datenschutzgesetz.",
};

const section: React.CSSProperties = { marginTop: 32 };
const h2: React.CSSProperties = {
  fontFamily: "var(--font)",
  fontWeight: 600,
  fontSize: 15,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--sand)",
  margin: "0 0 10px",
};
const body: React.CSSProperties = {
  margin: 0,
  fontSize: 15,
  lineHeight: 1.7,
  color: "rgba(255,255,255,0.85)",
};

export default function DatenschutzPage() {
  return (
    <LandingShell>
      <a href="#tb-main" className="tbl-skip">
        Zum Inhalt springen
      </a>
      <Navbar offsite />
      <main
        id="tb-main"
        style={{
          background: "var(--navy)",
          minHeight: "100vh",
          padding: "clamp(110px, 16vh, 170px) clamp(20px, 6vw, 96px) clamp(64px, 10vh, 120px)",
        }}
      >
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          <Link
            href="/"
            style={{ fontSize: 13, color: "var(--sand)", textDecoration: "none" }}
          >
            ← Zurück zur Startseite
          </Link>

          <h1
            style={{
              fontFamily: "var(--font)",
              fontWeight: 600,
              fontSize: "clamp(30px, 5vw, 46px)",
              letterSpacing: "-0.025em",
              margin: "24px 0 0",
            }}
          >
            Datenschutz
          </h1>

          <p style={{ ...body, marginTop: 16, color: "rgba(255,255,255,0.78)" }}>
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
              <a href="mailto:jonas@tracebuild.ch" style={{ color: "var(--sand)", textDecoration: "none" }}>
                jonas@tracebuild.ch
              </a>
              <br />
              <a href="mailto:livio@tracebuild.ch" style={{ color: "var(--sand)", textDecoration: "none" }}>
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

          <p style={{ ...body, marginTop: 40, fontSize: 12.5, color: "rgba(255,255,255,0.6)" }}>
            Diese Erklärung wird bei Bedarf angepasst.
          </p>
        </div>
      </main>
      <Footer offsite />
    </LandingShell>
  );
}
