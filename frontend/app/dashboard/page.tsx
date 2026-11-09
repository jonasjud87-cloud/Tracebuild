"use client";

import { useDashboard } from "@/lib/dashboardContext";
import { AlertCircleIcon, DocumentIcon, LayersIcon, ShieldCheckIcon } from "@/components/dashboard/icons";
import DashboardBackdrop from "@/components/dashboard/DashboardBackdrop";
import s from "./dashboard.module.css";

const DONUT = [
  { label: "Abstände",     pct: "42%", color: "#151414", dash: "58.06 80.17",  offset: "0" },
  { label: "Bemaßung",     pct: "28%", color: "#6b6153", dash: "38.70 99.53",  offset: "-58.06" },
  { label: "Konstruktion", pct: "18%", color: "#8c8b8e", dash: "24.88 113.35", offset: "-96.76" },
  { label: "Sonstige",     pct: "12%", color: "#bdb7aa", dash: "16.59 121.64", offset: "-121.64" },
];

function relTime(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1)  return "Gerade eben";
  if (m < 60) return `vor ${m} Min.`;
  const h = Math.floor(m / 60);
  if (h < 24) return `vor ${h} Std.`;
  const d = Math.floor(h / 24);
  return d === 1 ? "Gestern" : `vor ${d} Tagen`;
}

export default function DashboardOverviewPage() {
  const { activeOrg, userName, projects, projectsLoading, analysesCount, failCount, okPct, activities } = useDashboard();
  const orgName = activeOrg?.name ?? "Organisation";

  const kpis = [
    { label: "Projekte",         value: projectsLoading ? "…" : String(projects.length), icon: <LayersIcon size={30} /> },
    { label: "Geprüfte Pläne",   value: analysesCount === null ? "…" : String(analysesCount), icon: <DocumentIcon size={30} /> },
    { label: "Gefundene Fehler", value: failCount === null ? "…" : String(failCount), icon: <AlertCircleIcon size={30} /> },
    { label: "Normen geprüft",   value: okPct === null ? "…" : okPct + "%", icon: <ShieldCheckIcon size={30} /> },
  ];

  return (
    <>
      <section className={s.hero}>
        <DashboardBackdrop />
        <div className={s.heroInner}>
          <p className={s.eyebrow}>Organisation<i>/</i>{orgName}</p>
          <h1 className={s.h1}>
            Willkommen zurück{userName ? <>, <span className={s.accent}>{userName}</span></> : ""}
          </h1>
          <p className={s.lead}>
            Hier findest du eine Übersicht über eure Projekte, Prüfungen und die aktuelle Normkonformität.
          </p>
        </div>
      </section>

      <div className={s.body}>
      <section className={`${s.glass} ${s.kpi}`} aria-label="Kennzahlen">
        {kpis.map(k => (
          <div key={k.label} className={s.kpiItem}>
            <span className={s.iconBox}>{k.icon}</span>
            <div>
              <p className={s.kpiValue}>{k.value}</p>
              <p className={s.kpiLabel}>{k.label}</p>
            </div>
          </div>
        ))}
      </section>

      <div className={s.row}>
        <section className={`${s.glass} ${s.glassPad}`} aria-labelledby="dash-errors">
          <h2 id="dash-errors" className={s.cardTitle}>Fehler nach Kategorie</h2>
          {failCount !== null && failCount > 0 ? (
            <>
              <div className={s.donutWrap}>
                <div className={s.donut}>
                  <svg viewBox="0 0 60 60" role="img" aria-label="Beispielverteilung der Fehler nach Kategorie als Ringdiagramm">
                    <circle cx="30" cy="30" r="22" fill="none" stroke="rgba(21,20,20,0.08)" strokeWidth="9" />
                    {DONUT.map(seg => (
                      <circle key={seg.label} cx="30" cy="30" r="22" fill="none" stroke={seg.color} strokeWidth="9"
                        strokeDasharray={seg.dash} strokeDashoffset={seg.offset} transform="rotate(-90 30 30)" />
                    ))}
                  </svg>
                  <div className={s.donutCenter}>
                    <span className={s.donutNum}>{failCount}</span>
                    <span className={s.donutSub}>Gesamtfehler</span>
                  </div>
                </div>
                <ul className={s.legend} aria-label="Beispielverteilung">
                  {DONUT.map(seg => (
                    <li key={seg.label}>
                      <span className={s.dot} style={{ background: seg.color }} aria-hidden="true" />
                      <span>{seg.label}</span>
                      <span className={s.pct}>{seg.pct}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <p className={s.sample}>Beispielverteilung</p>
            </>
          ) : (
            <div className={s.donutEmpty}>
              <span className={s.emptyIcon}><ShieldCheckIcon size={28} /></span>
              <p className={s.emptyTitle}>Noch keine Fehler</p>
              <p className={s.emptyText}>Sobald Befunde vorliegen, erscheint hier die Verteilung.</p>
            </div>
          )}
        </section>

        <section className={`${s.glass} ${s.glassPad}`} aria-labelledby="dash-acts">
          <h2 id="dash-acts" className={s.cardTitle}>Letzte Aktivitäten</h2>
          {activities.length === 0 ? (
            <p className={s.empty}>Noch keine Analyseergebnisse</p>
          ) : (
            <ul className={s.acts}>
              {activities.map((a, i) => (
                <li key={i} className={s.act}>
                  <span className={`${s.actDot} ${a.status === "fail" ? s.actFail : ""}`} aria-hidden="true" />
                  <span className={s.actText}>{a.text}</span>
                  <span className={s.chip}>{relTime(a.time)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      </div>
    </>
  );
}
