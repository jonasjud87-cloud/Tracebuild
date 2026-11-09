import styles from "./Team.module.css";

const TEAM = [
  {
    name: "Jonas Jud",
    initials: "JJ",
    text: "TraceBuild ist das Ergebnis vieler kleiner Schritte, gemeinsamer Entscheidungen und einer Idee, an die wir von Anfang an geglaubt haben.",
    mail: "jonas@tracebuild.ch",
    reverse: false,
  },
  {
    name: "Livio Thoma",
    initials: "LT",
    text: "Wir haben TraceBuild von Grund auf selbst aufgebaut – mit dem Anspruch, eine Lösung zu entwickeln, die im echten Arbeitsalltag einen Unterschied macht.",
    mail: "livio@tracebuild.ch",
    reverse: true,
  },
];

export default function Team() {
  return (
    <section id="team" data-screen-label="06 Team" data-theme="light" className={styles.section}>
      <div className={styles.inner}>
        <span className={styles.pill}>TEAM</span>
        <h2 className={styles.title}>
          Zwei Gründer. Eine Vision.
          <br />
          TraceBuild.
        </h2>
        <p className={styles.lead}>TraceBuild ist von uns beiden – von der ersten Idee bis zur fertigen Anwendung.</p>
        <div className={styles.list}>
          {TEAM.map((p) => (
            <div key={p.mail} data-card="" className={p.reverse ? `${styles.person} ${styles.reverse}` : styles.person}>
              <div className={styles.avatar} aria-hidden="true">
                <div className={styles.monogram}>{p.initials}</div>
                <div className={styles.circle} />
              </div>
              <div className={styles.info}>
                <h3 className={styles.name}>{p.name}</h3>
                <p className={styles.role}>Mitgründer</p>
                <p className={styles.text}>{p.text}</p>
                <div className={styles.contact}>
                  <a href={`mailto:${p.mail}`} className={styles.mail}>
                    {p.mail}
                  </a>
                  <span className={styles.soon}>bald verfügbar</span>
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className={styles.general}>
          TraceBuild:{" "}
          <a href="mailto:tracebuild.info@gmail.com" className={styles.generalMail}>
            tracebuild.info@gmail.com
          </a>
        </p>
      </div>
    </section>
  );
}
