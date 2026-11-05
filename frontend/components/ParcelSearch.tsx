"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { GeoParcelResponse, GeoSearchHit, GeoSearchResponse, ParcelCandidate } from "@/lib/geoadmin/contract";
import {
  candidateLabel,
  candidateToFields,
  nextActiveIndex,
  parcelHitToFields,
  parcelQueryFor,
  sortCandidates,
  type ParcelFields,
} from "./geoportal-logic";

const DEBOUNCE_MS = 350;
const MIN_CHARS = 3;

export interface ParcelSelection {
  fields: ParcelFields;
  /** Nur Rückfall aus dem Suchtreffer: Kanton und Gemeinde muss der Nutzer ergänzen. */
  partial: boolean;
  label: string;
  candidate: ParcelCandidate | null;
}

/** Wie `api.get`, aber abbrechbar. Der Helfer in lib/api.ts nimmt beim GET kein Signal an. */
async function getJson<T>(path: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(`/api/v1${path}`, { signal });
  const json = (await res.json()) as { data?: T; error?: string };
  if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json.data as T;
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

export function CandidateList({ candidates, onPick, disabled, firstRef }: {
  candidates: ParcelCandidate[];
  onPick: (candidate: ParcelCandidate) => void;
  disabled?: boolean;
  firstRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
      {candidates.map((c, i) => (
        <li key={c.egrid}>
          <button
            type="button"
            ref={i === 0 ? firstRef : undefined}
            disabled={disabled}
            onClick={() => onPick(c)}
            style={{ width: "100%", minHeight: 44, textAlign: "left", background: "rgba(23,37,64,0.6)", border: "1px solid rgba(133,166,233,0.25)", borderRadius: 10, padding: "8px 12px", cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: disabled ? 0.6 : 1 }}
          >
            <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#fff" }}>{candidateLabel(c)}</span>
            <span style={{ display: "block", fontSize: 11, color: "#7B8299", marginTop: 2, overflowWrap: "anywhere" }}>
              {[c.type, c.egrid].filter(Boolean).join(" · ")}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Suche nach Adresse oder Parzelle (Combobox-Muster). Die Liste steht im normalen Fluss und
 * nicht absolut, weil Dialog und Handy-Ansicht ein schwebendes Element abschneiden würden.
 */
export default function ParcelSearch({ onSelect, label = "Adresse oder Parzelle suchen", placeholder = "z.B. Bahnhofstrasse 1 Herisau oder Herisau 859", hint, requireComplete = false }: {
  onSelect: (selection: ParcelSelection) => void;
  /** Ohne verbindliche Parzellenabfrage nichts liefern, weil es keine Felder zum Ergänzen gibt. */
  requireComplete?: boolean;
  label?: string;
  placeholder?: string;
  hint?: string;
}) {
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const listId = `${baseId}-list`;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoSearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<{ list: ParcelCandidate[]; hit: GeoSearchHit } | null>(null);
  const [focused, setFocused] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const lookupAbortRef = useRef<AbortController | null>(null);
  const firstCandidateRef = useRef<HTMLButtonElement>(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    searchAbortRef.current?.abort();
    lookupAbortRef.current?.abort();
  }, []);

  // Mehrfachtreffer: Die Auswahl muss für die Tastatur sofort erreichbar sein.
  useEffect(() => {
    if (candidates) firstCandidateRef.current?.focus();
  }, [candidates]);

  function cancelSearch() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    searchAbortRef.current?.abort();
    searchAbortRef.current = null;
    setSearching(false);
  }

  function handleChange(value: string) {
    setQuery(value);
    setMessage(null);
    setCandidates(null);
    lookupAbortRef.current?.abort();
    setResolving(false);
    cancelSearch();
    setActive(-1);
    if (value.trim().length < MIN_CHARS) {
      setResults([]);
      setOpen(false);
      return;
    }
    setSearching(true);
    timerRef.current = setTimeout(() => search(value.trim()), DEBOUNCE_MS);
  }

  async function search(q: string) {
    const controller = new AbortController();
    searchAbortRef.current = controller;
    try {
      const res = await getJson<GeoSearchResponse>(`/geo/search?q=${encodeURIComponent(q)}&lang=de`, controller.signal);
      if (controller.signal.aborted) return;
      setResults(res.results);
      setActive(-1);
      setOpen(res.results.length > 0);
      if (res.unavailable) {
        setMessage("Die Suche von swisstopo ist zurzeit nicht verfügbar. Bitte die Felder von Hand ausfüllen.");
      } else if (res.results.length === 0) {
        setMessage("Kein Treffer. Bitte die Schreibweise prüfen oder die Felder von Hand ausfüllen.");
      }
    } catch (e) {
      if (isAbort(e)) return;
      setResults([]);
      setOpen(false);
      setMessage("Die Suche ist fehlgeschlagen. Bitte die Felder von Hand ausfüllen.");
    } finally {
      if (searchAbortRef.current === controller) setSearching(false);
    }
  }

  function selectFallback(hit: GeoSearchHit, reason: string) {
    if (requireComplete) {
      setMessage(`${reason} Es wurde nichts übernommen. Bitte später erneut versuchen.`);
      return;
    }
    const fields = parcelHitToFields(hit);
    if (!fields) {
      setMessage(`${reason} Bitte Gemeinde und Parzellennummer von Hand ausfüllen.`);
      return;
    }
    setMessage(`${reason} Bitte Kanton und Gemeinde von Hand ergänzen.`);
    onSelect({ fields, partial: true, label: hit.label, candidate: null });
  }

  function pickCandidate(candidate: ParcelCandidate, hit: GeoSearchHit) {
    setCandidates(null);
    setMessage(null);
    onSelect({
      fields: candidateToFields(candidate, hit),
      partial: false,
      label: candidateLabel(candidate),
      candidate,
    });
  }

  async function pickHit(hit: GeoSearchHit) {
    setOpen(false);
    setActive(-1);
    setQuery(hit.label);
    setMessage(null);
    setCandidates(null);
    cancelSearch();
    lookupAbortRef.current?.abort();
    const controller = new AbortController();
    lookupAbortRef.current = controller;
    setResolving(true);
    try {
      const res = await getJson<GeoParcelResponse>(`/geo/parcel?${parcelQueryFor(hit)}`, controller.signal);
      if (controller.signal.aborted) return;
      if (res.candidates.length === 1) {
        pickCandidate(res.candidates[0], hit);
      } else if (res.candidates.length > 1) {
        setCandidates({ list: sortCandidates(res.candidates), hit });
      } else if (res.unavailable) {
        selectFallback(hit, "Die Parzellenabfrage ist zurzeit nicht verfügbar.");
      } else {
        selectFallback(hit, "An dieser Stelle ist keine Parzelle erfasst.");
      }
    } catch (e) {
      if (isAbort(e)) return;
      selectFallback(hit, "Die Parzellenabfrage ist fehlgeschlagen.");
    } finally {
      if (lookupAbortRef.current === controller) setResolving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (results.length === 0) return;
      e.preventDefault();
      if (!open) setOpen(true);
      setActive((a) => nextActiveIndex(a, results.length, e.key));
    } else if (open && (e.key === "Home" || e.key === "End")) {
      e.preventDefault();
      setActive((a) => nextActiveIndex(a, results.length, e.key));
    } else if (e.key === "Enter") {
      // Enter in der Suche legt nie das Projekt an.
      e.preventDefault();
      if (open && active >= 0 && results[active]) pickHit(results[active]);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setActive(-1);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  const statusText = searching
    ? "Suche läuft…"
    : resolving
      ? "Parzelle wird abgefragt…"
      : message
        ?? (candidates ? `${candidates.list.length} Grundstücke an dieser Stelle. Bitte eines wählen.` : open ? `${results.length} Treffer` : "");

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 5, flexWrap: "wrap" }}>
        <label htmlFor={inputId} style={{ fontSize: 12, fontWeight: 600, color: "#ABAEBB" }}>{label}</label>
        {hint && <span style={{ fontSize: 11, color: "#7B8299" }}>{hint}</span>}
      </div>
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        value={query}
        placeholder={placeholder}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => { setFocused(true); if (results.length > 0 && !candidates && !resolving) setOpen(true); }}
        onBlur={() => { setFocused(false); setOpen(false); }}
        style={{
          width: "100%", border: `1px solid ${focused ? "#2862D7" : "rgba(133,166,233,0.25)"}`,
          background: "rgba(23,37,64,0.6)", borderRadius: 10, padding: "9px 13px", fontSize: 14,
          color: "#fff", outline: "none", fontFamily: "inherit", boxSizing: "border-box",
          boxShadow: focused ? "0 0 0 3px rgba(40,98,215,0.2)" : "none",
          transition: "box-shadow .15s, border-color .15s",
        }}
      />

      <ul
        id={listId}
        role="listbox"
        aria-label="Suchtreffer"
        style={{
          display: open ? "block" : "none", listStyle: "none", margin: "6px 0 0", padding: 4,
          maxHeight: 264, overflowY: "auto", background: "#0E111B",
          border: "1px solid rgba(133,166,233,0.25)", borderRadius: 10,
        }}
      >
        {results.map((hit, i) => (
          <li
            key={hit.id}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            // mousedown statt click: Das Eingabefeld darf vorher den Fokus nicht verlieren.
            onMouseDown={(e) => { e.preventDefault(); pickHit(hit); }}
            onMouseEnter={() => setActive(i)}
            ref={(el) => { if (el && i === active) el.scrollIntoView({ block: "nearest" }); }}
            style={{
              display: "flex", alignItems: "center", gap: 8, minHeight: 40, padding: "6px 8px",
              borderRadius: 8, cursor: "pointer",
              background: i === active ? "rgba(40,98,215,0.2)" : "none",
            }}
          >
            <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 100, background: hit.kind === "parcel" ? "rgba(52,211,153,0.12)" : "rgba(133,166,233,0.1)", color: hit.kind === "parcel" ? "#34D399" : "#85A6E9" }}>
              {hit.kind === "parcel" ? "Parzelle" : "Adresse"}
            </span>
            <span style={{ fontSize: 13, color: "#fff", minWidth: 0, overflowWrap: "anywhere" }}>{hit.label}</span>
          </li>
        ))}
      </ul>

      {candidates && (
        <div role="group" aria-label="Grundstück wählen" style={{ marginTop: 8 }}>
          <CandidateList
            candidates={candidates.list}
            firstRef={firstCandidateRef}
            onPick={(c) => pickCandidate(c, candidates.hit)}
          />
        </div>
      )}

      <p role="status" aria-live="polite" style={{ fontSize: 11, color: message ? "#FBBF24" : "#7B8299", margin: "5px 0 0", lineHeight: 1.4, minHeight: 15 }}>
        {statusText}
      </p>
      <p style={{ fontSize: 11, color: "#7B8299", margin: "2px 0 0" }}>Quelle: swisstopo (geo.admin.ch)</p>
    </div>
  );
}
