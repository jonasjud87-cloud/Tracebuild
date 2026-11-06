"use client";

import { useCallback, useRef, useState } from "react";
import Image from "next/image";
import styles from "./Quality.module.css";

const CARDS = [
  {
    img: "/landing/quality-security.png",
    t: "Ihre Daten sind sicher.",
    d: "Verschlüsselt · Zugriffskontrolliert",
  },
  {
    img: "/landing/quality-decision.png",
    t: "TraceBuild prüft. Sie entscheiden.",
    d: "Kein Eingriff in den Plan · Freigabe durch Ihr Team",
  },
  {
    img: "/landing/quality-updates.png",
    t: "Ändert sich was, sagen wir Bescheid.",
    d: "Wir schauen hin · Sie bekommen Bescheid",
  },
];

export default function Quality() {
  const trackRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(33);

  const scrollByCard = useCallback((dir: number) => {
    const t = trackRef.current;
    const first = t?.firstElementChild as HTMLElement | null;
    if (!t || !first) return;
    t.scrollBy({ left: dir * (first.offsetWidth + 22), behavior: "smooth" });
  }, []);

  const onScroll = useCallback(() => {
    const t = trackRef.current;
    if (!t) return;
    const max = t.scrollWidth - t.clientWidth;
    setProgress(Math.round(33 + (max > 0 ? t.scrollLeft / max : 1) * 67));
  }, []);

  return (
    <section id="qualitaet" data-screen-label="05 Qualität" className={styles.section}>
      <div className={styles.inner}>
        <div className={styles.head}>
          <div>
            <span className={styles.pill}>Qualität</span>
            <h2 className={styles.title}>
              Unser Anspruch
              <br />
              an jede Prüfung.
            </h2>
          </div>
          <div className={styles.controls}>
            <button type="button" className={styles.prev} aria-label="Zurück" onClick={() => scrollByCard(-1)}>
              <span aria-hidden="true">‹</span>
            </button>
            <button type="button" className={styles.next} aria-label="Weiter" onClick={() => scrollByCard(1)}>
              <span aria-hidden="true">›</span>
            </button>
          </div>
        </div>
        <div
          ref={trackRef}
          onScroll={onScroll}
          className={styles.track}
          role="region"
          aria-label="Qualitätsansprüche"
          tabIndex={0}
        >
          {CARDS.map((c) => (
            <article key={c.t} className={styles.card}>
              <div className={styles.media}>
                <Image src={c.img} alt="" fill sizes="(max-width: 512px) 86vw, 440px" className={styles.cardImage} />
              </div>
              <div className={styles.fade} />
              <div className={styles.cardBody}>
                <h3 className={styles.cardTitle}>{c.t}</h3>
                <p className={styles.soon}>Coming soon.</p>
                <div className={styles.cardFoot}>{c.d}</div>
              </div>
            </article>
          ))}
        </div>
        <div className={styles.bar} aria-hidden="true">
          <div className={styles.barFill} style={{ width: `${progress}%` }} />
        </div>
      </div>
    </section>
  );
}
