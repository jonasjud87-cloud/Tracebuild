"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Resource } from "./CardFrame";

export async function fetchEnvelope<T>(url: string, fallback: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch {
    throw new Error("Keine Verbindung zum Server.");
  }
  let body: { data?: T | null; error?: string | null } | null = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok || !body || body.error || body.data === null || body.data === undefined) {
    throw new Error(body?.error && typeof body.error === "string" ? body.error : fallback);
  }
  return body.data;
}

export function useResource<T>(load: () => Promise<T>) {
  const [state, setState] = useState<Resource<T>>({ status: "loading" });
  const [busy, setBusy] = useState(true);
  const alive = useRef(true);
  const seq = useRef(0);

  const run = useCallback(() => {
    const id = ++seq.current;
    setBusy(true);
    setState(prev => (prev.status === "ready" ? prev : { status: "loading" }));
    load().then(
      data => {
        if (alive.current && id === seq.current) {
          setState({ status: "ready", data });
          setBusy(false);
        }
      },
      (e: unknown) => {
        if (alive.current && id === seq.current) {
          setState({ status: "error", message: e instanceof Error ? e.message : "Unbekannter Fehler." });
          setBusy(false);
        }
      }
    );
  }, [load]);

  useEffect(() => {
    alive.current = true;
    run();
    return () => {
      alive.current = false;
    };
  }, [run]);

  return [state, run, busy] as const;
}
