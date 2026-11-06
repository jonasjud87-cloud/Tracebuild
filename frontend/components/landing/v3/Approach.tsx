import Image from "next/image";
import styles from "./Approach.module.css";

const STEPS = [
  { n: "01", t: "PDF hochladen", d: "TraceBuild prüft den Plan gegen relevante Normen und Vorschriften." },
  { n: "02", t: "Klare Übersicht", d: "Erkennen Sie sofort, was passt, kritisch ist oder geprüft werden sollte." },
  { n: "03", t: "Volle Kontrolle", d: "Ihre Zeichnung bleibt unverändert. Die Freigabe liegt bei Ihnen." },
];

export default function Approach() {
  return (
    <section id="ansatz" data-screen-label="03 Ansatz" data-theme="light" className={styles.section}>
      <div className={styles.inner}>
        <div className={styles.head}>
          <div>
            <span className={styles.pill}>Der Ansatz</span>
            <h2 className={styles.title}>Planprüfung, die mitdenkt</h2>
          </div>
          <Image
            src="/landing/approach-model.png"
            alt="Architekturmodell"
            width={572}
            height={249}
            sizes="(max-width: 560px) 100vw, 520px"
            className={styles.image}
          />
        </div>
        <div className={styles.steps}>
          {STEPS.map((s) => (
            <div key={s.n} className={styles.step}>
              <div className={styles.stepHead}>
                <span className={styles.num}>{s.n}</span>
                <h3 className={styles.stepTitle}>{s.t}</h3>
              </div>
              <p className={styles.stepText}>{s.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
