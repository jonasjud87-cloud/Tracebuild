import Image from "next/image";
import AnchorLink from "./AnchorLink";
import styles from "./Hero.module.css";

export default function Hero() {
  return (
    <section id="top" data-screen-label="01 Hero" className={styles.section}>
      <Image
        data-par="0.18"
        src="/landing/hero.png"
        alt=""
        fill
        priority
        sizes="100vw"
        className={styles.image}
      />
      <div id="hero-shade" className={styles.shade} />
      <div className={styles.content}>
        <h1 className={styles.title}>
          Zeichnungen <span className={styles.accent}>prüfen,</span>
          <br />
          Normen einhalten.
        </h1>
        <p className={styles.lead}>
          TraceBuild prüft Ihre Zeichnungen, gleicht sie mit geltenden Normen und Vorschriften ab und macht
          Abweichungen sichtbar – präzise, verständlich und nachvollziehbar.
        </p>
        <div className={styles.actions}>
          <AnchorLink href="#kontakt" className={styles.primary}>
            Loslegen →
          </AnchorLink>
          <AnchorLink href="#produkt" className={styles.secondary}>
            Produktvorschau
          </AnchorLink>
        </div>
      </div>
    </section>
  );
}
