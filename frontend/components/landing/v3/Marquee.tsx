import styles from "./Marquee.module.css";

const WORDS = ["Vision.", "Technologie.", "Fortschritt."];

export default function Marquee() {
  const row = Array.from({ length: 4 }, () => WORDS).flat();
  return (
    <section className={styles.band} aria-label="Vision. Technologie. Fortschritt.">
      <div className={styles.track} aria-hidden="true">
        {[0, 1].map((copy) => (
          <div key={copy} className={styles.row}>
            {row.map((w, i) => (
              <span key={`${copy}-${i}`} className={styles.word}>
                {w}
              </span>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
