"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  INITIAL_RUN_POLL,
  applyPoll,
  interpretStatusResponse,
  isInterruptedRun,
  pollDelayMs,
  shouldResume,
  type RunPollState,
  type StatusPoll,
} from "./analysis-run-view";

async function fetchRunStatus(projectId: string, runId: string): Promise<StatusPoll> {
  try {
    const res = await fetch(`/api/v1/projects/${projectId}/analyses/${runId}`, { cache: "no-store" });
    return interpretStatusResponse(res.status, await res.text(), runId);
  } catch {
    return { kind: "failed" };
  }
}

/**
 * Folgt einer laufenden Analyse: fragt den Stand ab und stösst als Rückfall die Wiederaufnahme an,
 * wenn der Server darauf wartet. Der Lauf kommt aus der Liste, deshalb braucht es für Reload und
 * zweiten Tab keinen eigenen Zustand.
 *
 * `onEnded` kommt bei jeder Abfrage nach dem Ende erneut, bis die Liste den Lauf nicht mehr als
 * laufend führt (`runId` wechselt). So bleibt ein fehlgeschlagenes Nachladen nicht hängen.
 */
export function useAnalysisRun(
  projectId: string,
  runId: string | null,
  createdAt: string | null,
  onEnded: (runId: string) => void,
): RunPollState {
  const [state, setState] = useState<RunPollState>(INITIAL_RUN_POLL);
  const onEndedRef = useRef(onEnded);
  useEffect(() => { onEndedRef.current = onEnded; });

  useEffect(() => {
    setState(INITIAL_RUN_POLL);
    if (!runId) return;

    let stopped = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current = INITIAL_RUN_POLL;
    let lastResumeAt: number | null = null;

    const schedule = () => {
      clearTimeout(timer);
      const delay = pollDelayMs(document.hidden, isInterruptedRun(current, createdAt, Date.now()));
      timer = setTimeout(poll, delay);
    };

    const poll = async () => {
      if (stopped || inFlight) return;
      inFlight = true;
      const result = await fetchRunStatus(projectId, runId);
      inFlight = false;
      if (stopped) return;

      current = applyPoll(current, result);
      setState(current);
      if (current.ended) {
        onEndedRef.current(runId);
      } else if (result.kind === "status") {
        const now = Date.now();
        if (shouldResume(result.status.progress, lastResumeAt, now)) {
          lastResumeAt = now;
          // Scheitert der Anstoss, meldet die nächste Abfrage weiter needs_resume.
          api.post(`/projects/${projectId}/analyses/${runId}/resume`, {}).catch(() => {});
        }
      }
      schedule();
    };

    const onVisibility = () => { if (!document.hidden) poll(); };
    document.addEventListener("visibilitychange", onVisibility);
    poll();

    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [projectId, runId, createdAt]);

  return state;
}
