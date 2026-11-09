import Link from "next/link";
import type { Metadata } from "next";
import "@/components/landing/v3/landing.css";
import LandingShell from "@/components/landing/v3/LandingShell";
import Navbar from "@/components/landing/v3/Navbar";
import Footer from "@/components/landing/v3/Footer";
import RevealOnScroll from "@/app/anleitung/RevealOnScroll";

export const metadata: Metadata = {
  title: "Datenschutz - TraceBuild",
  description: "Datenschutzerklärung von TraceBuild nach Schweizer Datenschutzgesetz.",
};

const band: React.CSSProperties = {
  background:
    "linear-gradient(90deg, rgba(21,20,20,0.86) 0%, rgba(21,20,20,0.5) 70%), url(/landing/hero.png) center / cover no-repeat #151414",
  padding: "clamp(110px, 16vh, 170px) clamp(20px, 6vw, 96px) 120px",
};
const card: React.CSSProperties = {
  maxWidth: 760,
  margin: "-64px auto 0",
  padding: "8px clamp(24px, 4vw, 48px) 48px",
  background: "#ffffff",
  color: "#46464a",
  border: "1px solid rgba(21,20,20,0.08)",
  borderRadius: 24,
  boxShadow: "0 1px 2px rgba(21,20,20,0.04), 0 10px 30px rgba(21,20,20,0.07)",
};

const section: React.CSSProperties = {
  marginTop: 40,
  paddingTop: 28,
  borderTop: "1px solid rgba(21,20,20,0.08)",
};
const h2: React.CSSProperties = {
  fontFamily: "var(--font)",
  fontWeight: 600,
  fontSize: 22,
  lineHeight: 1.3,
  letterSpacing: "-0.01em",
  color: "#151414",
  margin: "0 0 14px",
};
const body: React.CSSProperties = {
  margin: 0,
  fontSize: 17,
  lineHeight: 1.75,
  color: "#46464a",
};
const link: React.CSSProperties = {
  color: "#151414",
  textDecoration: "underline",
  textUnderlineOffset: 3,
};

export default function DatenschutzPage() {
  return (
    <LandingShell>
      <a href="#tb-main" className="tbl-skip">
        Zum Inhalt springen
      </a>
      <RevealOnScroll selector="main [data-rv]" />
      <Navbar offsite />
      <main
        id="tb-main"
        style={{
          background: "#f6f3ee",
          minHeight: "100vh",
          paddingBottom: "clamp(64px, 10vh, 120px)",
        }}
      >
        <div style={band}>
<div style={{ maxWidth: 680, margin: "0 auto" }}>
          <Link
            href="/"
            style={{ fontSize: 15, color: "rgba(255,255,255,0.92)", textDecoration: "none" }}
          >
            ← Zurück zur Startseite
          </Link>

          <h1
            style={{
              fontFamily: "var(--font)",
              fontWeight: 600,
              fontSize: "clamp(34px, 5vw, 52px)",
            lineHeight: 1.1,
              letterSpacing: "-0.025em",
              margin: "24px 0 0",
            }}
          >
            Datenschutz
          </h1>

          <p style={{ ...body, marginTop: 16, color: "rgba(255,255,255,0.86)", fontSize: 18 }}>
            Wir bearbeiten Personendaten sorgfältig und nach den Grundsätzen des
            Schweizer Datenschutzgesetzes (DSG). Diese Erklärung fasst zusammen,
            welche Daten wir zu welchem Zweck bearbeiten.
          </p>
      </div>
      </div>
      <div style={{ padding: "0 clamp(16px, 4vw, 48px)" }}>
      <div style={card}>

          <div style={section} data-rv>
            <h2 style={h2}>Verantwortliche Stelle</h2>
            <p style={body}>
              TraceBuild
              <br />
              Jonas Jud &amp; Livio Thoma
              <br />
              Mels SG, Schweiz
              <br />
              <a href="mailto:jonas@tracebuild.ch" style={link}>
                jonas@tracebuild.ch
              </a>
              <br />
              <a href="mailto:livio@tracebuild.ch" style={link}>
                livio@tracebuild.ch
              </a>
            </p>
          </div>

          <div style={section} data-rv>
            <h2 style={h2}>Welche Daten wir bearbeiten</h2>
            <p style={body}>
              Bei Kontakt- und Demo-Anfragen bearbeiten wir die Angaben, die Sie
              uns übermitteln - in der Regel Name, E-Mail-Adresse und den Inhalt
              Ihrer Nachricht. Beim Betrieb der Website fallen zudem technische
              Server-Logs an (IP-Adresse, Zeitpunkt des Zugriffs, aufgerufene
              Seite, Browsertyp).
            </p>
          </div>

          <div style={section} data-rv>
            <h2 style={h2}>Zweck der Bearbeitung</h2>
            <p style={body}>
              Wir bearbeiten diese Daten, um Ihre Anfrage zu beantworten und mit
              Ihnen in Kontakt zu treten, sowie zum sicheren und stabilen Betrieb
              der Website.
            </p>
          </div>

          <div style={section} data-rv>
            <h2 style={h2}>Weitergabe an Dritte</h2>
            <p style={body}>
              Wir geben Ihre Daten nicht zu Werbezwecken an Dritte weiter. Für den
              Betrieb setzen wir sorgfältig ausgewählte Dienstleister ein (etwa
              für Hosting), die Daten als Auftragsbearbeiter und nur nach unseren
              Weisungen bearbeiten.
            </p>
          </div>

          <div style={section} data-rv>
            <h2 style={h2}>Aufbewahrung</h2>
            <p style={body}>
              Wir bewahren Personendaten nur so lange auf, wie es für den
              jeweiligen Zweck oder aufgrund gesetzlicher Vorgaben nötig ist.
              Danach werden sie gelöscht oder anonymisiert.
            </p>
          </div>

          <div style={section} data-rv>
            <h2 style={h2}>Ihre Rechte</h2>
            <p style={body}>
              Sie haben das Recht auf Auskunft über die zu Ihnen bearbeiteten
              Daten sowie auf Berichtigung oder Löschung. Wenden Sie sich dazu
              per E-Mail an eine der oben genannten Adressen.
            </p>
          </div>

          <p style={{ ...body, marginTop: 40, fontSize: 14, color: "#5f5f64" }}>
            Diese Erklärung wird bei Bedarf angepasst.
          </p>
        </div>
      </div>
      </main>
      <Footer offsite />
    </LandingShell>
  );
}
