"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { DigestState } from "./library-filter";

export interface DigestRow {
  normId: string;
  title: string;
  level: string;
  sourceChars: number;
  state: DigestState;
  digestChars: number | null;
  note: string | null;
  costUsd: number | null;
  createdAt: string | null;
}

interface Overview {
  available: boolean;
  rows: DigestRow[];
}

interface RunSummary {
  created: number;
  failed: number;
  skipped: number;
  costUsd: number;
}

export interface NormDigests {
  available: boolean;
  loaded: boolean;
  error: string | null;
  rows: DigestRow[];
  byNorm: Map<string, DigestRow>;
  states: Map<string, DigestState>;
  busy: boolean;
  message: string | null;
  viewing: string | null;
  viewText: string | null;
  run: (force: boolean, normId?: string) => Promise<void>;
  toggleView: (normId: string) => Promise<void>;
}

export default function useNormDigests(): NormDigests {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [viewText, setViewText] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<Overview>("/admin/norm-digests"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Prüfauszüge konnten nicht geladen werden.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const byNorm = useMemo(() => new Map(rows.map((r) => [r.normId, r])), [rows]);
  const states = useMemo(() => new Map(rows.map((r) => [r.normId, r.state] as [string, DigestState])), [rows]);

  const toggleView = useCallback(
    async (normId: string) => {
      if (viewing === normId) {
        setViewing(null);
        return;
      }
      setViewing(normId);
      setViewText(null);
      try {
        const result = await api.get<{ digest: string | null } | null>(`/admin/norm-digests?normId=${normId}`);
        setViewText(result?.digest ?? "Kein Text gespeichert.");
      } catch (e) {
        setViewText(e instanceof Error ? e.message : "Auszug konnte nicht geladen werden.");
      }
    },
    [viewing],
  );

  const run = useCallback(
    async (force: boolean, normId?: string) => {
      const targets = normId ? rows.filter((r) => r.normId === normId) : rows.filter((r) => force || r.state !== "ok");
      setBusy(true);
      setMessage(null);
      const total: RunSummary = { created: 0, failed: 0, skipped: 0, costUsd: 0 };
      try {
        for (let i = 0; i < targets.length; i++) {
          const row = targets[i];
          setMessage(`Erstelle ${i + 1} von ${targets.length}: ${row.title}`);
          const result = await api.post<RunSummary>("/admin/norm-digests", { force, normId: row.normId });
          total.created += result.created;
          total.failed += result.failed;
          total.skipped += result.skipped;
          total.costUsd += result.costUsd;
          await load();
        }
        setMessage(`${total.created} erstellt, ${total.failed} fehlgeschlagen, ${total.skipped} übersprungen. Kosten ${total.costUsd.toFixed(2)} USD.`);
      } catch (e) {
        setMessage(`${e instanceof Error ? e.message : "Erstellung fehlgeschlagen."} Bisher: ${total.created} erstellt, ${total.failed} fehlgeschlagen, Kosten ${total.costUsd.toFixed(2)} USD.`);
      } finally {
        setBusy(false);
      }
    },
    [rows, load],
  );

  return {
    available: data?.available ?? true,
    loaded: data !== null,
    error,
    rows,
    byNorm,
    states,
    busy,
    message,
    viewing,
    viewText,
    run,
    toggleView,
  };
}
