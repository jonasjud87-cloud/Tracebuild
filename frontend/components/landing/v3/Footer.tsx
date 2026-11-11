import Image from "next/image";
import Link from "next/link";
import AnchorLink from "./AnchorLink";
import styles from "./Footer.module.css";

const MAIL = "info@tracebuild.ch";

export default function Footer({ offsite = false }: { offsite?: boolean }) {
  return (
    <footer id="kontakt" data-screen-label="07 Footer" className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.cta}>
          <Image
            src="/landing/logo-tb.svg"
            alt="TraceBuild"
            width={113}
            height={161}
            className={styles.logo}
          />
          <h2 className={styles.title}>Bereit für die erste Prüfung?</h2>
          <p className={styles.lead}>Zeigen Sie uns ein Projekt – wir zeigen Ihnen, was TraceBuild findet.</p>
          <div className={styles.actions}>
            <a href={`mailto:${MAIL}?subject=TraceBuild%20-%20Loslegen`} className={styles.primary}>
              Loslegen →
            </a>
            <a href={`mailto:${MAIL}`} className={styles.secondary}>
              Mit uns sprechen
            </a>
          </div>
        </div>
        <div className={styles.columns}>
          <div>
            <div className={styles.brand}>
              <Image src="/landing/logo-tb.svg" alt="" width={28} height={40} className={styles.mark} />
              TraceBuild
            </div>
            <p className={styles.about}>
              KI-Prüfung von Plänen gegen geltende Normen – als übersichtliche Auswertung, nicht als Eingriff.
              Verschlüsselt · DSG-konform.
            </p>
          </div>
          <div>
            <h3 className={styles.heading}>Produkt</h3>
            <div className={styles.links}>
              <AnchorLink href="#produkt" offsite={offsite} className={styles.link}>
                Produktvorschau
              </AnchorLink>
              <AnchorLink href="#kontakt" className={styles.link}>
                Preise
              </AnchorLink>
            </div>
          </div>
          <div>
            <h3 className={styles.heading}>Unternehmen</h3>
            <div className={`${styles.links} ${styles.linksStart}`}>
              <AnchorLink href="#team" offsite={offsite} className={styles.link}>
                Team
              </AnchorLink>
              <a href={`mailto:${MAIL}`} className={styles.link}>
                Kontakt
              </a>
              <Link href="/impressum" className={styles.link}>
                Impressum
              </Link>
              <Link href="/datenschutz" className={styles.link}>
                Datenschutz
              </Link>
              <Link href="/login" className={styles.link}>
                Anmelden
              </Link>
            </div>
          </div>
        </div>
        <div className={styles.legal}>
          © 2026 TraceBuild · Mels SG ·{" "}
          <Link href="/impressum" className={styles.legalLink}>
            Impressum
          </Link>{" "}
          ·{" "}
          <Link href="/datenschutz" className={styles.legalLink}>
            Datenschutz
          </Link>
        </div>
      </div>
    </footer>
  );
}
