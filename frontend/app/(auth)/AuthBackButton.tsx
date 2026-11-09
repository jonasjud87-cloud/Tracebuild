import Link from "next/link";
import Image from "next/image";
import styles from "./auth.module.css";

export default function AuthBackButton() {
  return (
    <Link href="/" className={styles.brand} aria-label="TraceBuild Startseite">
      <Image src="/landing/logo-tb-dark.svg" alt="" className={styles.brandMark} style={{ width: "auto" }} width={28} height={40} unoptimized priority />
      <span className={styles.brandWord} aria-hidden="true">
        <span className={styles.brandTrace}>Trace</span>
        <span className={styles.brandBuild}>Build</span>
      </span>
    </Link>
  );
}
