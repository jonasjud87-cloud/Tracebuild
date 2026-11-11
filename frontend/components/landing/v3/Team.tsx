import Image from "next/image";
import styles from "./Team.module.css";

const TEAM = [
  {
    name: "Jonas Jud",
    photo: "/landing/team-jonas-jud.jpg",
    text: "TraceBuild ist das Ergebnis vieler kleiner Schritte, gemeinsamer Entscheidungen und einer Idee, an die wir von Anfang an geglaubt haben.",
    mail: "jonas.jud@tracebuild.ch",
    reverse: false,
  },
  {
    name: "Livio Thoma",
    photo: "/landing/team-livio-thoma.jpg",
    text: "Wir haben TraceBuild von Grund auf selbst aufgebaut – mit dem Anspruch, eine Lösung zu entwickeln, die im echten Arbeitsalltag einen Unterschied macht.",
    mail: "livio.thoma@tracebuild.ch",
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
              <div className={styles.avatar}>
                <Image src={p.photo} alt={`Porträt ${p.name}`} fill sizes="200px" className={styles.photo} />
              </div>
              <div className={styles.info}>
                <h3 className={styles.name}>{p.name}</h3>
                <p className={styles.role}>Mitgründer</p>
                <p className={styles.text}>{p.text}</p>
                <div className={styles.contact}>
                  <a href={`mailto:${p.mail}`} className={styles.mail}>
                    {p.mail}
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className={styles.general}>
          TraceBuild:{" "}
          <a href="mailto:info@tracebuild.ch" className={styles.generalMail}>
            info@tracebuild.ch
          </a>
        </p>
      </div>
    </section>
  );
}
