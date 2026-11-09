import Link from "next/link";
import type { Metadata } from "next";
import "@/components/landing/v3/landing.css";
import LandingShell from "@/components/landing/v3/LandingShell";
import Navbar from "@/components/landing/v3/Navbar";
import Footer from "@/components/landing/v3/Footer";
import RevealOnScroll from "@/app/anleitung/RevealOnScroll";

export const metadata: Metadata = {
  title: "Impressum - TraceBuild",
  description: "Impressum und Kontaktangaben zu TraceBuild.",
};

const section: React.CSSProperties = {
  marginTop: 40,
  paddingTop: 28,
  borderTop: "1px solid rgba(255,255,255,0.1)",
};
const h2: React.CSSProperties = {
  fontFamily: "var(--font)",
  fontWeight: 600,
  fontSize: 22,
  lineHeight: 1.3,
  letterSpacing: "-0.01em",
  color: "#ffffff",
  margin: "0 0 14px",
};
const body: React.CSSProperties = {
  margin: 0,
  fontSize: 17,
  lineHeight: 1.75,
  color: "rgba(255,255,255,0.86)",
};

export default function ImpressumPage() {
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
          background: "var(--navy)",
          minHeight: "100vh",
          padding: "clamp(110px, 16vh, 170px) clamp(20px, 6vw, 96px) clamp(64px, 10vh, 120px)",
        }}
      >
      <div style={{ maxWidth: 680, margin: "0 auto" }}>
        <Link
          href="/"
          style={{ fontSize: 15, color: "var(--sand)", textDecoration: "none" }}
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
          Impressum
        </h1>

        <div style={section} data-rv>
          <h2 style={h2}>Anbieter</h2>
          <p style={body}>
            TraceBuild
            <br />
            Jonas Jud &amp; Livio Thoma
            <br />
            Mels, St. Gallen, Schweiz
          </p>
        </div>

        <div style={section} data-rv>
          <h2 style={h2}>Kontakt</h2>
          <p style={body}>
            Jonas Jud
            <br />
            Livio Thoma
          </p>
        </div>

        <div style={section} data-rv>
          <h2 style={h2}>Verantwortlich für den Inhalt</h2>
          <p style={body}>
            Jonas Jud &amp; Livio Thoma
            <br />
            Mels, St. Gallen, Schweiz
          </p>
        </div>

        <div style={section} data-rv>
          <h2 style={h2}>Zweck und Leistungsumfang</h2>
          <p style={body}>
            TraceBuild bietet digitale Lösungen zur Unterstützung bei der
            Prüfung von Planunterlagen. Die auf dieser Website beschriebenen
            Funktionen und Prüfergebnisse dienen der Unterstützung der
            fachlichen Prüfung und ersetzen keine eigenständige fachliche,
            rechtliche oder planerische Beurteilung.
          </p>
          <p style={{ ...body, marginTop: 14 }}>
            Die Verantwortung für die Prüfung, Beurteilung und Freigabe von
            Planunterlagen verbleibt jederzeit bei den Nutzenden.
          </p>
        </div>

        <div style={section} data-rv>
          <h2 style={h2}>Haftungsausschluss</h2>
          <p style={body}>
            Die Inhalte dieser Website werden mit angemessener Sorgfalt
            erstellt und laufend weiterentwickelt. Trotz sorgfältiger Prüfung
            kann keine Gewähr für die Richtigkeit, Vollständigkeit,
            Aktualität oder Fehlerfreiheit der bereitgestellten Informationen
            übernommen werden.
          </p>
          <p style={{ ...body, marginTop: 14 }}>
            Insbesondere können automatisiert bzw. softwaregestützt erstellte
            Prüfergebnisse Fehler oder Unvollständigkeiten enthalten.
            TraceBuild übernimmt keine Gewähr dafür, dass sämtliche relevanten
            Normen, Vorschriften oder Abweichungen erkannt werden.
          </p>
          <p style={{ ...body, marginTop: 14 }}>
            Die Nutzung der auf dieser Website und innerhalb von TraceBuild
            bereitgestellten Informationen erfolgt in eigener Verantwortung.
            Eine abschliessende fachliche Prüfung und die Freigabe von Plänen
            obliegen den zuständigen bzw. verantwortlichen Fachpersonen.
          </p>
        </div>

        <div style={section} data-rv>
          <h2 style={h2}>Externe Links</h2>
          <p style={body}>
            Diese Website kann Links zu externen Websites Dritter enthalten.
            TraceBuild hat keinen Einfluss auf deren Inhalte und übernimmt
            dafür keine Verantwortung. Für die Inhalte der verlinkten
            Websites sind ausschliesslich deren Betreiber verantwortlich.
          </p>
        </div>

        <div style={section} data-rv>
          <h2 style={h2}>Urheberrecht</h2>
          <p style={body}>
            Sämtliche Inhalte dieser Website, insbesondere Texte, Grafiken,
            Logos, Bilder, Designs und Softwarebestandteile, sind
            urheberrechtlich geschützt.
          </p>
          <p style={{ ...body, marginTop: 14 }}>
            Die Vervielfältigung, Bearbeitung, Verbreitung oder sonstige
            Verwendung von Inhalten bedarf der vorgängigen schriftlichen
            Zustimmung von TraceBuild, soweit keine gesetzliche Ausnahme
            besteht.
          </p>
        </div>

        <div style={section} data-rv>
          <h2 style={h2}>Angaben zur Rechtsform</h2>
          <p style={body}>
            Rechtsform: [wird ergänzt]
            <br />
            Geschäftsadresse: [wird ergänzt]
            <br />
            UID / Handelsregisternummer: [wird ergänzt]
          </p>
        </div>
      </div>
      </main>
      <Footer offsite />
    </LandingShell>
  );
}
