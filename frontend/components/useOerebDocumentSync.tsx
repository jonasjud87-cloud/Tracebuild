"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { DocumentsResponse, DocumentSyncResponse } from "@/lib/geoadmin/contract";
import {
  documentSummaryLine,
  runDocumentSync,
  summarizeDocuments,
  type SyncEnd,
  type SyncProgress,
  type SyncRunResult,
} from "./geoportal-logic";
import n from "@/app/projects/[id]/norms/norms.module.css";

export interface OerebSyncState {
  running: boolean;
  progress: SyncProgress | null;
  /** Ende des letzten Laufs in dieser Sitzung; null = noch keiner. */
  lastEnd: SyncEnd | null;
  lastError: string | null;
  documents: DocumentsResponse | null;
  documentsError: string | null;
  /** Steigt nach jedem Lauf: Normen können sich geändert haben. */
  version: number;
}

const INITIAL: OerebSyncState = {
  running: false, progress: null, lastEnd: null, lastError: null,
  documents: null, documentsError: null, version: 0,
};

const IDLE_RESULT: SyncRunResult = {
  end: "aborted", error: null,
  progress: { processed: 0, total: 0, remaining: 0, waiting: false, currentTitle: null, outcomes: {} },
};

/**
 * Automatischer Import der Reglemente: Der Client stösst pro offenem Dokument einen eigenen
 * Request an, weil jeder Request eigene 300 s braucht (Spezifikation Abschnitt 2). Verlässt der
 * Nutzer das Projekt, wird abgebrochen; der Rest läuft beim nächsten Öffnen weiter.
 */
export function useOerebDocumentSync(projectId: string) {
  const [state, setState] = useState<OerebSyncState>(INITIAL);
  const runningRef = useRef<Promise<SyncRunResult> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const loadDocuments = useCallback(async (): Promise<DocumentsResponse | null> => {
    try {
      const documents = await api.get<DocumentsResponse>(`/projects/${projectId}/oereb/documents`);
      setState((s) => ({ ...s, documents, documentsError: null }));
      return documents;
    } catch (e) {
      setState((s) => ({ ...s, documentsError: e instanceof Error ? e.message : "Unbekannter Fehler" }));
      return null;
    }
  }, [projectId]);

  const run = useCallback((initialPending = 0): Promise<SyncRunResult> => {
    if (runningRef.current) return runningRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    setState((s) => ({
      ...s, running: true, lastEnd: null, lastError: null,
      progress: { processed: 0, total: initialPending, remaining: initialPending, waiting: false, currentTitle: null, outcomes: {} },
    }));

    const promise = runDocumentSync({
      post: (signal) => api.post<DocumentSyncResponse>(`/projects/${projectId}/oereb/documents/sync`, {}, signal),
      signal: controller.signal,
      initialPending,
      onProgress: (progress) => {
        if (!controller.signal.aborted) setState((s) => ({ ...s, progress }));
      },
    }).then(async (result) => {
      if (controller.signal.aborted) return result;
      runningRef.current = null;
      setState((s) => ({
        ...s, running: false, progress: result.progress, lastEnd: result.end,
        lastError: result.error, version: s.version + 1,
      }));
      await loadDocuments();
      return result;
    });
    runningRef.current = promise;
    return promise;
  }, [projectId, loadDocuments]);

  useEffect(() => {
    let cancelled = false;
    setState(INITIAL);
    (async () => {
      const documents = await loadDocuments();
      if (cancelled || !documents?.available || documents.pending <= 0) return;
      run(documents.pending);
    })();
    return () => {
      cancelled = true;
      controllerRef.current?.abort();
      controllerRef.current = null;
      runningRef.current = null;
    };
  }, [loadDocuments, run]);

  return useMemo(() => ({ state, run, reloadDocuments: loadDocuments }), [state, run, loadDocuments]);
}

export type OerebSync = ReturnType<typeof useOerebDocumentSync>;

const OerebSyncContext = createContext<OerebSync | null>(null);

const FALLBACK: OerebSync = {
  state: INITIAL,
  run: async () => IDLE_RESULT,
  reloadDocuments: async () => null,
};

/** Zugriff auf den einen Lauf des Projekts; ausserhalb des Projekt-Layouts wirkungslos. */
export function useOerebSync(): OerebSync {
  return useContext(OerebSyncContext) ?? FALLBACK;
}

export function OerebSyncProvider({ projectId, children }: { projectId: string; children: React.ReactNode }) {
  const sync = useOerebDocumentSync(projectId);
  return <OerebSyncContext.Provider value={sync}>{children}</OerebSyncContext.Provider>;
}

const END_TEXT: Partial<Record<SyncEnd, string>> = {
  error: "Abgleich unterbrochen. Er läuft beim nächsten Öffnen des Projekts weiter. Analysen sind davon nicht betroffen.",
  busy: "Ein anderer Abruf bearbeitet gerade dasselbe Dokument. Der Rest folgt beim nächsten Öffnen des Projekts.",
  stalled: "Die offenen Dokumente sind erst später wieder an der Reihe. Analysen sind davon nicht betroffen.",
};

/** Kleine Statuszeile über dem Projektinhalt. Ohne Lauf und ohne Fehler bleibt sie weg. */
export function OerebSyncStatus({ projectId }: { projectId: string }) {
  const { state } = useOerebSync();
  const [dismissedVersion, setDismissedVersion] = useState(-1);
  const { running, progress, lastEnd, lastError, documents } = state;

  if (!running && (!lastEnd || lastEnd === "aborted" || lastEnd === "unavailable")) return null;
  if (!running && dismissedVersion === state.version) return null;

  const total = progress?.total ?? 0;
  const done = progress?.processed ?? 0;
  const summary = documents?.items.length ? documentSummaryLine(summarizeDocuments(documents.items)) : "";
  const trouble = !running && lastEnd !== "done";

  return (
    <div
      role="status"
      aria-live="polite"
      className={`${n.notice} ${trouble ? n.toneWarn : n.toneSand}`}
      style={{ marginBottom: 16, display: "block" }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <p className={n.noticeText} style={{ flex: "1 1 240px", minWidth: 0, margin: 0 }}>
          {running ? (
            <>
              <strong style={{ color: "var(--ink)" }}>Reglemente aus dem ÖREB-Kataster</strong>
              {total > 0 ? ` werden übernommen (${done}/${total})` : " werden geprüft"}
              {progress?.waiting ? ", warten auf einen anderen Abruf…" : "…"}
            </>
          ) : (
            <>
              <strong style={{ color: trouble ? "var(--warn-text)" : "var(--ink)" }}>Reglemente aus dem ÖREB-Kataster</strong>
              {summary ? `: ${summary}` : lastEnd === "done" ? ": geprüft." : "."}
              {END_TEXT[lastEnd!] && <span style={{ display: "block", marginTop: 2 }}>{END_TEXT[lastEnd!]}</span>}
              {lastError && <span className={n.noticeDetail} style={{ marginTop: 2 }}>Meldung: {lastError}</span>}
            </>
          )}
        </p>
        {!running && (
          <span style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <Link href={`/projects/${projectId}/norms#reglemente`} className={n.link}>
              Details
            </Link>
            <button
              type="button"
              aria-label="Meldung schliessen"
              onClick={() => setDismissedVersion(state.version)}
              className={n.dismiss}
            >
              ×
            </button>
          </span>
        )}
      </div>
      {running && total > 0 && (
        <div
          role="progressbar"
          aria-label="Fortschritt des Reglement-Imports"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          className={n.progress}
        >
          <div className={n.progressFill} style={{ width: `${Math.round((done / total) * 100)}%` }} />
        </div>
      )}
    </div>
  );
}
