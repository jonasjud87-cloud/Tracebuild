"use client";

import type { RunProgressView } from "./analysis-run-view";
import p from "@/app/projects/project.module.css";
import g from "./project-geo.module.css";

interface Props {
  view: RunProgressView;
  variant: "full" | "banner";
  title?: string | null;
  notes?: (string | null | undefined)[];
  cancelling: boolean;
  cancelError?: string | null;
  onCancel: () => void;
  onOpen?: () => void;
}

export default function AnalysisRunProgress({ view, variant, title, notes, cancelling, cancelError, onCancel, onOpen }: Props) {
  const full = variant === "full";
  const shownNotes = (notes ?? []).filter((n): n is string => !!n);

  return (
    <div className={`${p.glassFlat} ${full ? g.runFull : g.run} ${onOpen ? g.runGap : ""}`}>
      {title && <p className={g.runEyebrow}>{title}</p>}

      <p role="status" aria-live="polite" className={`${g.runLabel} ${full ? g.runLabelFull : ""}`}>
        {view.label}
      </p>

      {!view.interrupted && (
        <div
          role="progressbar"
          aria-label="Fortschritt der Analyse"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={view.percent ?? undefined}
          className={`${g.track} ${full ? g.trackFull : ""}`}
        >
          {view.percent === null ? (
            <div className={g.barIndeterminate} />
          ) : (
            <div className={g.bar} style={{ width: `${view.percent}%` }} />
          )}
        </div>
      )}

      {view.hints.map((hint) => (
        <p key={hint} className={g.runHint}>{hint}</p>
      ))}
      {shownNotes.map((note) => (
        <p key={note} className={g.runNote}>{note}</p>
      ))}
      {cancelError && (
        <p role="alert" className={g.runError}>{cancelError}</p>
      )}

      <div className={`${g.runActions} ${full ? g.runActionsFull : ""}`}>
        {onOpen && (
          <button type="button" onClick={onOpen} className={`${p.btnGhost} ${p.btnSm}`}>
            Prüfung öffnen
          </button>
        )}
        <button type="button" onClick={onCancel} disabled={cancelling} className={`${p.btnGhost} ${p.btnSm} ${g.cancelBtn}`}>
          {cancelling ? "Wird abgebrochen…" : view.interrupted ? "Analyse entfernen" : "Analyse abbrechen"}
        </button>
      </div>
    </div>
  );
}
