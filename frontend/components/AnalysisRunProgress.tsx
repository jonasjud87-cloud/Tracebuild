"use client";

import type { RunProgressView } from "./analysis-run-view";

interface Props {
  view: RunProgressView;
  /** "full": anstelle der Upload-Zone. "banner": über einem sichtbaren Ergebnis. */
  variant: "full" | "banner";
  /** Name der Prüfung, wenn sie nicht ohnehin geöffnet ist. */
  title?: string | null;
  /** Hinweise zum Lauf, z. B. Stand der Reglemente oder warum gerade nichts gestartet werden kann. */
  notes?: (string | null | undefined)[];
  cancelling: boolean;
  cancelError?: string | null;
  onCancel: () => void;
  onOpen?: () => void;
}

/** Ein durchgehender Fortschritt für die ganze Analyse, gleich wie lange sie serverseitig dauert. */
export default function AnalysisRunProgress({ view, variant, title, notes, cancelling, cancelError, onCancel, onOpen }: Props) {
  const full = variant === "full";
  const shownNotes = (notes ?? []).filter((n): n is string => !!n);

  return (
    <div
      style={{
        background: full ? "rgba(23,37,64,0.3)" : "rgba(40,98,215,0.1)",
        border: "1px solid rgba(133,166,233,0.25)",
        borderRadius: full ? 18 : 12,
        padding: full ? "40px 24px" : "12px 14px",
        marginBottom: onOpen ? 16 : 0,
        textAlign: full ? "center" : "left",
      }}
    >
      <style>{`
        @keyframes analysis-run-slide { from { left: -35%; } to { left: 100%; } }
        @media (prefers-reduced-motion: reduce) { .analysis-run-indeterminate { animation: none !important; left: 0 !important; width: 100% !important; opacity: .4; } }
      `}</style>

      {title && (
        <p style={{ fontSize: 11, fontWeight: 700, color: "#7B8299", textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 6px" }}>
          {title}
        </p>
      )}

      <p role="status" aria-live="polite" style={{ fontSize: full ? 15 : 13, fontWeight: 600, color: "#fff", margin: "0 0 10px", overflowWrap: "anywhere" }}>
        {view.label}
      </p>

      {!view.interrupted && (
        <div
          role="progressbar"
          aria-label="Fortschritt der Analyse"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={view.percent ?? undefined}
          style={{ position: "relative", height: 6, borderRadius: 50, overflow: "hidden", background: "rgba(133,166,233,0.15)", maxWidth: full ? 480 : undefined, margin: full ? "0 auto 14px" : "0 0 10px" }}
        >
          {view.percent === null ? (
            <div
              className="analysis-run-indeterminate"
              style={{ position: "absolute", top: 0, bottom: 0, width: "35%", borderRadius: 50, background: "#2862D7", animation: "analysis-run-slide 1.4s ease-in-out infinite" }}
            />
          ) : (
            <div style={{ height: "100%", width: `${view.percent}%`, borderRadius: 50, background: "linear-gradient(90deg,#4fd1ff,#2862D7)", transition: "width .6s ease" }} />
          )}
        </div>
      )}

      {view.hints.map((hint) => (
        <p key={hint} style={{ fontSize: 12.5, color: "#ABAEBB", margin: "0 0 6px", lineHeight: 1.45 }}>{hint}</p>
      ))}
      {shownNotes.map((note) => (
        <p key={note} style={{ fontSize: 12.5, color: "#FBBF24", margin: "0 0 6px", lineHeight: 1.45 }}>{note}</p>
      ))}
      {cancelError && (
        <p role="alert" style={{ fontSize: 12.5, color: "#F87171", margin: "0 0 6px", lineHeight: 1.45 }}>{cancelError}</p>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: full ? "center" : "flex-start", marginTop: full ? 16 : 8 }}>
        {onOpen && (
          <button
            type="button"
            onClick={onOpen}
            style={{ fontSize: 12, fontWeight: 500, color: "#ABAEBB", background: "rgba(133,166,233,0.08)", border: "1px solid rgba(133,166,233,0.18)", padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit" }}
          >
            Prüfung öffnen
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          disabled={cancelling}
          style={{ fontSize: 12, fontWeight: 600, color: "#F87171", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.3)", padding: "6px 14px", borderRadius: 8, cursor: cancelling ? "wait" : "pointer", fontFamily: "inherit", opacity: cancelling ? 0.6 : 1 }}
        >
          {cancelling ? "Wird abgebrochen…" : view.interrupted ? "Analyse entfernen" : "Analyse abbrechen"}
        </button>
      </div>
    </div>
  );
}
