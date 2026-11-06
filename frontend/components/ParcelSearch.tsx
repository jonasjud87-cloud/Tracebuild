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
import css from "./ParcelSearch.module.css";

export type ParcelSearchTone = "light" | "dark";

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

export function CandidateList({ candidates, onPick, disabled, firstRef, tone = "light" }: {
  candidates: ParcelCandidate[];
  onPick: (candidate: ParcelCandidate) => void;
  disabled?: boolean;
  firstRef?: React.Ref<HTMLButtonElement>;
  tone?: ParcelSearchTone;
}) {
  return (
    <ul className={`${css.candidates} ${tone === "dark" ? css.candDark : ""}`}>
      {candidates.map((c, i) => (
        <li key={c.egrid} className={css.candItem}>
          <button
            type="button"
            ref={i === 0 ? firstRef : undefined}
            disabled={disabled}
            onClick={() => onPick(c)}
            className={css.cand}
          >
            <span className={css.candTitle}>{candidateLabel(c)}</span>
            <span className={css.candSub}>
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
export default function ParcelSearch({ onSelect, label = "Adresse oder Parzelle suchen", placeholder = "z.B. Bahnhofstrasse 1 Herisau oder Herisau 859", hint, requireComplete = false, tone = "light" }: {
  onSelect: (selection: ParcelSelection) => void;
  /** Ohne verbindliche Parzellenabfrage nichts liefern, weil es keine Felder zum Ergänzen gibt. */
  requireComplete?: boolean;
  label?: string;
  placeholder?: string;
  hint?: string;
  tone?: ParcelSearchTone;
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
    <div className={`${css.root} ${tone === "dark" ? css.dark : ""}`}>
      <div className={css.labelRow}>
        <label htmlFor={inputId} className={css.label}>{label}</label>
        {hint && <span className={css.hint}>{hint}</span>}
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
        onFocus={() => { if (results.length > 0 && !candidates && !resolving) setOpen(true); }}
        onBlur={() => { setOpen(false); }}
        className={css.input}
      />

      <ul
        id={listId}
        role="listbox"
        aria-label="Suchtreffer"
        className={css.list}
        style={{ display: open ? "block" : "none" }}
      >
        {results.map((hit, i) => (
          <li
            key={hit.id}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => { e.preventDefault(); pickHit(hit); }}
            onMouseEnter={() => setActive(i)}
            ref={(el) => { if (el && i === active) el.scrollIntoView({ block: "nearest" }); }}
            className={css.option}
          >
            <span className={`${css.kind} ${hit.kind === "parcel" ? css.kindParcel : css.kindAddress}`}>
              {hit.kind === "parcel" ? "Parzelle" : "Adresse"}
            </span>
            <span className={css.optionText}>{hit.label}</span>
          </li>
        ))}
      </ul>

      {candidates && (
        <div role="group" aria-label="Grundstück wählen" style={{ marginTop: 8 }}>
          <CandidateList
            candidates={candidates.list}
            firstRef={firstCandidateRef}
            tone={tone}
            onPick={(c) => pickCandidate(c, candidates.hit)}
          />
        </div>
      )}

      <p role="status" aria-live="polite" className={`${css.status} ${message ? css.statusWarn : ""}`}>
        {statusText}
      </p>
      <p className={css.source}>Quelle: swisstopo (geo.admin.ch)</p>
    </div>
  );
}
