"use client";

import { useCallback, useRef, useState, type KeyboardEvent } from "react";
import { motion } from "framer-motion";
import ProductPlanCheck from "./ProductPlanCheck";
import ProductNormDb from "./ProductNormDb";
import { findNorm } from "./norms-sample";
import { EASE_OUT, inView } from "./motion";
import styles from "./Product.module.css";

type Tab = "plan" | "normen";

const TABS: { id: Tab; label: string }[] = [
  { id: "plan", label: "Planprüfung" },
  { id: "normen", label: "Normen-Datenbank" },
];

export default function Product() {
  const [tab, setTab] = useState<Tab>("plan");
  const [normQuery, setNormQuery] = useState("");
  const [focusNormId, setFocusNormId] = useState<string | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectTab = useCallback((id: Tab) => {
    setTab(id);
    if (id === "normen") {
      setFocusNormId(null);
      setNormQuery("");
    }
  }, []);

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = TABS.findIndex((t) => t.id === tab);
    let next = -1;
    if (e.key === "ArrowRight") next = (current + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (current - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    selectTab(TABS[next].id);
    tabRefs.current[next]?.focus();
  };

  const openNorm = useCallback((id: string) => {
    setFocusNormId(id);
    setNormQuery(findNorm(id)?.code ?? "");
    setTab("normen");
  }, []);

  const useInCheck = useCallback(() => {
    setFocusNormId(null);
    setTab("plan");
  }, []);

  return (
    <section id="produkt" data-screen-label="04 Produkt" data-theme="light" className={styles.section}>
      <div className={styles.inner}>
        <span className={styles.pill}>Produkt</span>
        <h2 className={styles.title}>
          Sehen Sie jeden Konflikt,
          <br />
          bevor die Behörde ihn sieht.
        </h2>
        <div className={styles.row}>
          <p className={styles.lead}>Beispieldaten zur Veranschaulichung – frei erfunden, nicht rechtsverbindlich.</p>
          <div className={`${styles.scope} ${styles.segmented}`} data-theme="dark" role="tablist" aria-label="Ansicht" onKeyDown={onTabKey}>
            {TABS.map((t, i) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`produkt-tab-${t.id}`}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                tabIndex={tab === t.id ? 0 : -1}
                aria-controls="produkt-panel"
                aria-selected={tab === t.id}
                className={styles.segment}
                data-active={tab === t.id}
                onClick={() => selectTab(t.id)}
              >
                {tab === t.id && (
                  <motion.span
                    layoutId="tb-sc-tab"
                    transition={{ duration: 0.32, ease: EASE_OUT }}
                    className={styles.segmentBg}
                  />
                )}
                <span className={styles.segmentLabel}>{t.label}</span>
                {tab === t.id && (
                  <motion.span
                    layoutId="tb-sc-tab-underline"
                    transition={{ duration: 0.32, ease: EASE_OUT }}
                    className={styles.segmentLine}
                  />
                )}
              </button>
            ))}
          </div>
        </div>
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={inView}
          transition={{ duration: 0.72, ease: EASE_OUT }}
          data-theme="dark"
          data-card="static"
          className={`${styles.scope} ${styles.frame}`}
        >
          <motion.div
            key={tab}
            initial={{ opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.28, ease: EASE_OUT }}
            role="tabpanel"
            id="produkt-panel"
            aria-labelledby={`produkt-tab-${tab}`}
            style={{ minHeight: 440 }}
          >
            {tab === "plan" ? (
              <ProductPlanCheck onOpenNorm={openNorm} />
            ) : (
              <ProductNormDb query={normQuery} focusNormId={focusNormId} onUseInCheck={useInCheck} />
            )}
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
