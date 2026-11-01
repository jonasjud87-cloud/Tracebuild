"use client";

import { useRef, useState } from "react";
import NewProjectModal from "@/components/NewProjectModal";
import ProjectCard from "@/components/ProjectCard";
import { useDashboard } from "@/lib/dashboardContext";

const WORKFLOW_STEPS = [
  { number: "01", title: "Projekt",  description: "Kanton, Gemeinde und Parzelle eingeben." },
  { number: "02", title: "Upload",   description: "Plan als PDF oder Bild hochladen." },
  { number: "03", title: "Analyse",  description: "KI prüft den Plan gegen die geltenden Normen." },
  { number: "04", title: "Ergebnis", description: "Befunde prüfen, Bericht als PDF exportieren." },
];

function Toast({ msg }: { msg: string }) {
  return (
    <div style={{
      position: "fixed", bottom: 24, left: 24, zIndex: 70,
      background: "#0E111B", border: "1px solid rgba(133,166,233,0.25)",
      color: "#fff", fontSize: 13, padding: "11px 18px",
      borderRadius: 12, boxShadow: "0 20px 40px rgba(0,0,0,0.4)",
    }}>
      {msg}
    </div>
  );
}

export default function DashboardProjectsPage() {
  const { projects, projectsLoading, reloadProjects } = useDashboard();
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch]       = useState("");
  const [toast, setToast]         = useState("");
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function addToast(msg: string) {
    setToast(msg);
    if (toastRef.current) clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(""), 2600);
  }

  const filteredProjects = search.trim()
    ? projects.filter(p => p.name.toLowerCase().includes(search.trim().toLowerCase()))
    : projects;

  return (
    <>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, color: "#85A6E9", textTransform: "uppercase", letterSpacing: "0.14em", margin: "0 0 8px" }}>Projekte</p>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: "#fff", margin: 0, letterSpacing: "-0.01em", fontFamily: "'Inter',sans-serif" }}>
            {projectsLoading ? "…" : projects.length === 0 ? "Alle Projekte" : `${projects.length} Projekt${projects.length !== 1 ? "e" : ""}`}
          </h1>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {projects.length > 0 && (
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Projekt suchen…"
              style={{ border: "1px solid rgba(133,166,233,0.25)", background: "rgba(23,37,64,0.6)", color: "#fff", borderRadius: 10, padding: "9px 14px", fontSize: 13, outline: "none", width: 180, fontFamily: "inherit", transition: "box-shadow .15s, border-color .15s" }}
              onFocus={e => { e.currentTarget.style.borderColor = "#2862D7"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(40,98,215,0.2)"; }}
              onBlur={e => { e.currentTarget.style.borderColor = "rgba(133,166,233,0.25)"; e.currentTarget.style.boxShadow = "none"; }}
            />
          )}
          <button
            onClick={() => setShowModal(true)}
            style={{ background: "linear-gradient(90deg,#4fd1ff,#38bdf8 55%,#2862D7)", color: "#fff", padding: "10px 18px", borderRadius: 10, fontSize: 14, fontWeight: 600, border: "none", cursor: "pointer", fontFamily: "inherit", boxShadow: "0 4px 16px rgba(40,98,215,0.35)", transition: "filter .15s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.filter = "brightness(1.1)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.filter = "none"; }}
          >
            + Neues Projekt
          </button>
        </div>
      </div>

      {/* Empty state */}
      {!projectsLoading && projects.length === 0 && (
        <div style={{ background: "rgba(23,37,64,0.55)", border: "1px solid rgba(133,166,233,0.18)", borderRadius: 18, padding: "48px 40px" }}>
          <div style={{ textAlign: "center", marginBottom: 44 }}>
            <div style={{ width: 52, height: 52, background: "rgba(40,98,215,0.12)", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
              <svg width="24" height="24" fill="none" stroke="#85A6E9" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            </div>
            <p style={{ fontSize: 15, fontWeight: 600, color: "#fff", margin: 0 }}>Noch keine Projekte vorhanden</p>
            <p style={{ fontSize: 13, color: "#7B8299", margin: "5px 0 0" }}>Erstelle dein erstes Analyseprojekt, um loszulegen</p>
            <button onClick={() => setShowModal(true)} style={{ marginTop: 14, fontSize: 14, color: "#85A6E9", fontWeight: 600, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", transition: "color .15s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#fff"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#85A6E9"; }}
            >
              Erstes Projekt erstellen →
            </button>
          </div>

          <p style={{ fontSize: 11, fontWeight: 700, color: "#85A6E9", textTransform: "uppercase", letterSpacing: "0.14em", margin: "0 0 20px", textAlign: "center" }}>{"So funktioniert's"}</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 28 }}>
            {WORKFLOW_STEPS.map(w => (
              <div key={w.number} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: "#3470E8" }}>{w.number}</span>
                  <div style={{ height: 1, flex: 1, background: "rgba(133,166,233,0.18)" }} />
                </div>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "#fff", margin: 0 }}>{w.title}</h4>
                <p style={{ fontSize: 12.5, color: "#7B8299", margin: 0, lineHeight: 1.5 }}>{w.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No search results */}
      {!projectsLoading && projects.length > 0 && search.trim() && filteredProjects.length === 0 && (
        <div style={{ background: "rgba(23,37,64,0.55)", border: "1px solid rgba(133,166,233,0.18)", borderRadius: 18, padding: 40, textAlign: "center" }}>
          <p style={{ fontSize: 14, color: "#7B8299", margin: 0 }}>{`Keine Projekte für „${search}"`}</p>
        </div>
      )}

      {/* Project grid */}
      {!projectsLoading && filteredProjects.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 18 }}>
          {filteredProjects.map(p => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}

      {/* Loading skeletons */}
      {projectsLoading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 18 }}>
          {[...Array(3)].map((_, i) => (
            <div key={i} style={{ background: "rgba(23,37,64,0.55)", border: "1px solid rgba(133,166,233,0.18)", borderRadius: 16, padding: 22, opacity: 0.6 }}>
              <div style={{ height: 16, background: "rgba(133,166,233,0.1)", borderRadius: 8, width: "70%", marginBottom: 10 }} />
              <div style={{ height: 12, background: "rgba(133,166,233,0.07)", borderRadius: 6, width: "45%" }} />
            </div>
          ))}
        </div>
      )}

      {toast && <Toast msg={toast} />}

      {showModal && (
        <NewProjectModal
          onClose={() => setShowModal(false)}
          onCreated={() => { reloadProjects(); addToast("Projekt wurde erstellt."); }}
        />
      )}
    </>
  );
}
