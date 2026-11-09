import Image from "next/image";
import styles from "./Problem.module.css";

export default function Problem() {
  return (
    <section id="problem" data-screen-label="02 Problem" className={styles.section}>
      <span className={styles.pill}>Das Problem</span>
      <h2 className={styles.title}>Ein übersehener Grenzabstand kostet Wochen.</h2>
      <p className={styles.lead}>
        Normen sind komplex und ändern sich laufend. Prüfungen sind zeitaufwendig und fehleranfällig.
        Abweichungen werden oft zu spät erkannt.
      </p>
      <Image
        src="/landing/problem-plan.png"
        alt="Bauplan mit rot markierter Abweichung"
        data-card=""
        width={970}
        height={517}
        sizes="(max-width: 1100px) 100vw, 970px"
        className={styles.image}
      />
    </section>
  );
}
