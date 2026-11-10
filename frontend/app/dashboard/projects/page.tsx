"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import NewProjectModal from "@/components/NewProjectModal";
import ProjectCard, { isProjectDone } from "@/components/ProjectCard";
import { AlertCircleIcon, CheckCircleIcon, ClockIcon, GridIcon, LayersIcon, ListIcon, SearchIcon } from "@/components/dashboard/icons";
import DashboardBackdrop from "@/components/dashboard/DashboardBackdrop";
import { useDashboard } from "@/lib/dashboardContext";
import s from "../dashboard.module.css";

const WORKFLOW_STEPS = [
  { number: "01", title: "Projekt",  description: "Kanton, Gemeinde und Parzelle eingeben." },
  { number: "02", title: "Upload",   description: "Alle Pläne zusammen hochladen, PDF oder Bild." },
  { number: "03", title: "Analyse",  description: "KI prüft den Plansatz gegen die geltenden Normen." },
  { number: "04", title: "Ergebnis", description: "Befunde prüfen, Bericht als PDF exportieren." },
];

export default function DashboardProjectsPage() {
  const { projects, projectsLoading, reloadProjects, failCount } = useDashboard();
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch]       = useState("");
  const [view, setView]           = useState<"grid" | "list">("grid");
  const [toast, setToast]         = useState("");
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function addToast(msg: string) {
    setToast(msg);
    if (toastRef.current) clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(""), 2600);
  }

  const q = search.trim().toLowerCase();
  const filteredProjects = q
    ? projects.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.project_number ?? "").toLowerCase().includes(q) ||
        `${p.location?.municipality ?? ""} ${p.location?.canton ?? ""}`.toLowerCase().includes(q))
    : projects;

  const doneCount = projects.filter(p => isProjectDone(p.status)).length;
  const kpis = [
    { label: "Projekte gesamt", value: projectsLoading ? "…" : String(projects.length), icon: <LayersIcon size={28} /> },
    { label: "In Arbeit",       value: projectsLoading ? "…" : String(projects.length - doneCount), icon: <ClockIcon size={28} /> },
    { label: "Abgeschlossen",   value: projectsLoading ? "…" : String(doneCount), icon: <CheckCircleIcon size={28} /> },
    { label: "Gefundene Fehler", value: failCount === null ? "…" : String(failCount), icon: <AlertCircleIcon size={28} /> },
  ];

  return (
    <>
      <section className={!projectsLoading && projects.length > 0 ? s.hero : `${s.hero} ${s.heroBare}`}>
      <DashboardBackdrop />
      <div className={s.heroInner}>
      <div className={s.pHead}>
        <div>
          <p className={`${s.eyebrow} ${s.eyebrowBronze}`}>Projekte</p>
          <h1 className={s.h1}>
            {projectsLoading ? "…" : projects.length === 0 ? "Alle Projekte" : `${projects.length} Projekt${projects.length !== 1 ? "e" : ""}`}
          </h1>
          <p className={s.lead}>Übersicht und Verwaltung aller aktiven Projekte.</p>
        </div>
        <div className={s.pTools}>
          {projects.length > 0 && (
            <>
              <div className={`${s.glass} ${s.toggle}`} role="group" aria-label="Ansicht">
                <button type="button" className={`${s.toggleBtn} ${view === "grid" ? s.toggleOn : ""}`} onClick={() => setView("grid")} aria-pressed={view === "grid"} aria-label="Kachelansicht">
                  <GridIcon size={22} />
                </button>
                <button type="button" className={`${s.toggleBtn} ${view === "list" ? s.toggleOn : ""}`} onClick={() => setView("list")} aria-pressed={view === "list"} aria-label="Listenansicht">
                  <ListIcon size={22} />
                </button>
              </div>
              <div className={`${s.glass} ${s.searchWrap}`}>
                <SearchIcon size={18} />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Projekt suchen…"
                  aria-label="Projekt suchen"
                  className={s.input}
                />
              </div>
            </>
          )}
          <button type="button" onClick={() => setShowModal(true)} className={s.btnDark}>
            + Neues Projekt
          </button>
        </div>
      </div>
      </div>
      </section>

      <div className={s.body}>
      {!projectsLoading && projects.length > 0 && (
        <section className={s.pKpi} aria-label="Kennzahlen">
          {kpis.map(k => (
            <div key={k.label} className={`${s.glass} ${s.pKpiTile}`}>
              <span className={s.iconBox}>{k.icon}</span>
              <div>
                <p className={s.kpiValue}>{k.value}</p>
                <p className={s.kpiLabel}>{k.label}</p>
              </div>
            </div>
          ))}
        </section>
      )}

      {!projectsLoading && projects.length === 0 && (
        <div className={`${s.glass} ${s.emptyBox}`}>
          <div style={{ marginBottom: 12 }}>
            <div className={s.emptyIcon}>
              <svg width="26" height="26" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            </div>
            <p className={s.emptyTitle}>Noch keine Projekte vorhanden</p>
            <p className={s.emptyText}>Erstelle dein erstes Analyseprojekt, um loszulegen</p>
            <button type="button" onClick={() => setShowModal(true)} className={s.linkBtn}>
              Erstes Projekt erstellen →
            </button>
          </div>

          <p className={s.stepsTitle} style={{ textAlign: "center" }}>{"So funktioniert's"}</p>
          <div className={s.steps}>
            {WORKFLOW_STEPS.map(w => (
              <div key={w.number}>
                <div className={s.stepHead}>
                  <span className={s.stepNum}>{w.number}</span>
                  <div className={s.stepLine} />
                </div>
                <h2 className={s.stepTitle}>{w.title}</h2>
                <p className={s.stepText}>{w.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {!projectsLoading && projects.length > 0 && q && filteredProjects.length === 0 && (
        <div className={`${s.glass} ${s.emptyBox}`}>
          <p className={s.emptyText} style={{ margin: 0 }}>{`Keine Projekte für „${search}"`}</p>
        </div>
      )}

      {!projectsLoading && filteredProjects.length > 0 && (
        <div className={view === "grid" ? s.pGrid : s.pList}>
          {filteredProjects.map(p => (
            <ProjectCard key={p.id} project={p} view={view} />
          ))}
        </div>
      )}

      {projectsLoading && (
        <div className={s.pGrid} aria-busy="true">
          {[...Array(3)].map((_, i) => (
            <div key={i} className={s.skelCard}>
              <div />
              <div />
              <div />
            </div>
          ))}
        </div>
      )}

      </div>

      {toast && createPortal(<div className={s.toast} role="status">{toast}</div>, document.body)}

      {showModal && createPortal(
        <NewProjectModal
          onClose={() => setShowModal(false)}
          onCreated={() => { reloadProjects(); addToast("Projekt wurde erstellt."); }}
        />,
        document.body,
      )}
    </>
  );
}
