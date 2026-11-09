import { jakarta as font } from "@/lib/fonts";
import styles from "./auth.module.css";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${styles.shell} ${font.className}`}>
      <div className={styles.photo} aria-hidden="true">
        <div className={styles.photoImg} />
        <div className={styles.photoShade} />
      </div>
      <div className={styles.stage}>
        <div className={styles.slot}>{children}</div>
      </div>
    </div>
  );
}
