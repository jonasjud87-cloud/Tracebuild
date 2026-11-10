import Image from "next/image";
import Link from "next/link";
import AnchorLink from "./AnchorLink";
import styles from "./Navbar.module.css";

const LINKS = [
  { href: "#problem", label: "Problem" },
  { href: "#ansatz", label: "Ansatz" },
  { href: "#produkt", label: "Produkt" },
  { href: "#qualitaet", label: "Qualität" },
  { href: "#team", label: "Team" },
] as const;

export default function Navbar({ offsite = false }: { offsite?: boolean }) {
  return (
    <header className={styles.header}>
      <AnchorLink href="#top" offsite={offsite} className={styles.brand}>
        <Image
          src="/landing/logo-tb.svg"
          alt=""
          width={24}
          height={37}
          priority
          className={styles.mark}
        />
        <span>TraceBuild</span>
      </AnchorLink>
      <nav className={styles.nav} aria-label="Hauptnavigation">
        {LINKS.map((l) => (
          <AnchorLink key={l.href} href={l.href} offsite={offsite} className={styles.link}>
            {l.label}
          </AnchorLink>
        ))}
        <Link href="/login" className={styles.login}>
          Login
        </Link>
      </nav>
      <div id="tb-progress" className={styles.progress} aria-hidden="true" />
    </header>
  );
}
