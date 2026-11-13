"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import ProjectBanner from "@/components/project/ProjectBanner";
import p from "@/app/projects/project.module.css";
import s from "./normenblatt.module.css";
import type { KenndatenBlatt } from "@/lib/kenndaten";

interface BlattResponse {
  blatt: KenndatenBlatt | null;
  veraltet?: boolean;
  erstellt?: string | null;
}

export default function NormenblattPage({ params }: { params: { id: string } }) {
  const [blatt, setBlatt] = useState<KenndatenBlatt | null>(null);
  const [veraltet, setVeraltet] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [projectName, setProjectName] = useState("");

  useEffect(() => {
    let cancelled = false;
    api.get<{ name: string }>(`/projects/${params.id}`)
      .then((proj) => { if (!cancelled) setProjectName(proj?.name ?? ""); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [params.id]);

  useEffect(() => {
    let cancelled = false;
    api.get<BlattResponse>(`/projects/${params.id}/kenndaten`)
      .then((res) => {
        if (cancelled) return;
        setBlatt(res?.blatt ?? null);
        setVeraltet(!!res?.veraltet);
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Das Normenblatt konnte nicht geladen werden."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [params.id]);

  const erstellen = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<BlattResponse>(`/projects/${params.id}/kenndaten`, {});
      setBlatt(res.blatt);
      setVeraltet(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Das Normenblatt konnte nicht erstellt werden.");
    } finally {
      setBusy(false);
    }
  }, [params.id]);

  const downloadPdf = useCallback(async () => {
    if (!blatt) return;
    setPdfBusy(true);
    try {
      const { downloadKenndatenPdf } = await import("@/lib/kenndaten-report");
      await downloadKenndatenPdf(blatt);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Das PDF konnte nicht erstellt werden.");
    } finally {
      setPdfBusy(false);
    }
  }, [blatt]);

  const berechnung = blatt?.berechnung ?? null;

  return (
    <>
      <ProjectBanner
        variant="normenblatt"
        title="Normenblatt"
        subtitle={blatt ? blatt.ort : undefined}
        actions={
          <>
            <button type="button" onClick={erstellen} disabled={busy} aria-busy={busy} className={p.btnSand}>
              {busy ? "Wird erstellt…" : veraltet ? "Aktualisieren" : blatt ? "Neu erstellen" : "Normenblatt erstellen"}
            </button>
            <button type="button" onClick={downloadPdf} disabled={!blatt || pdfBusy} className={p.btnGhost}>
              {pdfBusy ? "PDF wird erstellt…" : "PDF herunterladen"}
            </button>
          </>
        }
      />

      {error && (
        <div className={`${p.glassFlat} ${s.msgCard} ${s.errCard}`} role="alert">
          <p className={s.msgErr}>{error}</p>
        </div>
      )}

      {veraltet && blatt && !busy && (
        <div className={`${p.glassFlat} ${s.msgCard}`} role="status">
          <p className={s.msgText}>Normen oder Zone haben sich seit der Erstellung geändert. Das Blatt zeigt den älteren Stand, mit «Aktualisieren» wird es neu erstellt.</p>
        </div>
      )}

      {!blatt && (busy || loading) && (
        <div className={`${p.glassFlat} ${s.sheet}`} role="status" aria-label="Normenblatt wird erstellt">
          <span className={p.skeleton} style={{ width: "30%" }} />
          <span className={p.skeleton} style={{ width: "80%" }} />
          <span className={p.skeleton} style={{ width: "70%" }} />
        </div>
      )}

      {!blatt && !busy && !loading && (
        <div className={`${p.glassFlat} ${s.empty}`}>
          <span className={p.iconTile}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <rect x="4.5" y="3.5" width="15" height="17" rx="3" /><path d="M8 9h8M8 13h8M8 17h4" />
            </svg>
          </span>
          <p className={s.emptyTitle}>Noch kein Normenblatt erstellt</p>
          <p className={s.emptySub}>
            Das Blatt wird aus den zugewiesenen Normen und dem ÖREB-Auszug erstellt{projectName ? ` (${projectName})` : ""}.
          </p>
        </div>
      )}

      {blatt && (
        <article className={`${p.glassFlat} ${s.sheet}`} aria-label="Normenblatt">
          <header className={s.head}>
            <h2 className={s.projectName}>{blatt.projektName}</h2>
            <dl className={s.meta}>
              <div><dt>Gemeinde, Kanton</dt><dd>{blatt.ort}</dd></div>
              <div><dt>Parzelle</dt><dd>{blatt.parzelle}</dd></div>
              <div><dt>Datum</dt><dd>{blatt.datum}</dd></div>
            </dl>
          </header>

          <section aria-labelledby="nb-kenndaten">
            <h3 id="nb-kenndaten" className={s.sectionLabel}>Kenndaten</h3>
            <div className={p.tableWrap}>
              <table className={`${p.table} ${s.kennTable}`}>
                <thead>
                  <tr>
                    {["Bezeichnung", "Wert", "Quelle"].map((h) => (
                      <th key={h} scope="col" className={p.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {blatt.zeilen.map((z) => (
                    <tr key={z.bezeichnung}>
                      <td className={`${p.td} ${s.cellLabel}`}>{z.bezeichnung}</td>
                      <td className={`${p.td} ${s.cellValue}`}>{z.wert}</td>
                      <td className={`${p.td} ${s.cellSource}`}>{z.quelle}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="nb-berechnungen">
            <h3 id="nb-berechnungen" className={s.sectionLabel}>Berechnungen</h3>
            {berechnung && (
              <>
                {berechnung.zeilen.length > 0 && <p className={s.calcTitle}>{berechnung.titel}</p>}
                {berechnung.zeilen.map((z, i) => (
                  <p key={i} className={s.calcLine}>{z}</p>
                ))}
                <p className={s.calcNote}>{berechnung.hinweis}</p>
              </>
            )}
          </section>

          <footer className={s.foot}>
            <p>{blatt.oerebStand}</p>
            {blatt.hinweise.map((h, i) => <p key={i}>{h}</p>)}
            <p>Automatisch aus den zugewiesenen Normen und dem ÖREB-Auszug erstellt. Keine behördliche Auskunft, Werte am Original prüfen.</p>
          </footer>
        </article>
      )}
    </>
  );
}
