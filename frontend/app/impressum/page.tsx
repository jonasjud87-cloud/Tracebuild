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
            Mels, St. Gallen, Schweiz
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>Kontakt</h2>
          <p style={body}>
            Jonas Jud
            <br />
            Livio Thoma
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>Verantwortlich für den Inhalt</h2>
          <p style={body}>
            Jonas Jud &amp; Livio Thoma
            <br />
            Mels, St. Gallen, Schweiz
          </p>
        </div>

        <div style={section}>
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

        <div style={section}>
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

        <div style={section}>
          <h2 style={h2}>Externe Links</h2>
          <p style={body}>
            Diese Website kann Links zu externen Websites Dritter enthalten.
            TraceBuild hat keinen Einfluss auf deren Inhalte und übernimmt
            dafür keine Verantwortung. Für die Inhalte der verlinkten
            Websites sind ausschliesslich deren Betreiber verantwortlich.
          </p>
        </div>

        <div style={section}>
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

        <div style={section}>
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
      </div>

      <Footer />
    </div>
  );
}
