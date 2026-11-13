"use client";

import { useMemo, useState } from "react";
import AdminNormRow from "./AdminNormRow";
import AdminNormUpload from "./AdminNormUpload";
import DigestInline from "./DigestInline";
import DigestSummaryBar from "./DigestSummaryBar";
import { inputCls, type AdminNorm } from "./admin-norm-types";
import {
  EMPTY_LIBRARY_FILTER,
  cantonsOf,
  filterLibrary,
  groupTone,
  levelCounts,
  type CareFilter,
  type DigestFilter,
  type LevelFilter,
  type LibraryFilter,
} from "./library-filter";
import { CANTON_NAMES, groupByJurisdiction } from "./norm-watch-groups";
import type { NormDigests } from "./useNormDigests";

interface Props {
  norms: AdminNorm[];
  loading: boolean;
  watchedIds: Set<string>;
  digests: NormDigests;
  onDelete: (id: string) => void;
  onUploaded: () => void;
}

const LEVELS: { id: LevelFilter; label: string }[] = [
  { id: "all", label: "Alle" },
  { id: "national", label: "Bund" },
  { id: "cantonal", label: "Kanton" },
  { id: "municipal", label: "Gemeinde" },
];

const SELECT = `${inputCls} w-auto appearance-none sm:py-2`;

export default function AdminNormLibrary({ norms, loading, watchedIds, digests, onDelete, onUploaded }: Props) {
  const [filter, setFilter] = useState<LibraryFilter>(EMPTY_LIBRARY_FILTER);
  const [uploadOpen, setUploadOpen] = useState(false);

  const counts = useMemo(() => levelCounts(norms), [norms]);
  const cantons = useMemo(() => cantonsOf(norms), [norms]);
  const patch = (next: Partial<LibraryFilter>) => setFilter((f) => ({ ...f, ...next }));
  const needle = filter.needle.trim();

  const groups = useMemo(() => {
    const entries = filterLibrary(norms, filter, watchedIds, digests.states).map((n) => ({
      jurisdictionType: n.jurisdiction_type,
      jurisdictionName: n.jurisdiction_name,
      norm: n,
    }));
    return groupByJurisdiction(entries);
  }, [norms, filter, watchedIds, digests.states]);

  const shown = groups.reduce((sum, g) => sum + g.items.length, 0);
  const filtered = filter.level !== "all" || filter.canton !== "" || filter.care !== "all" || filter.digest !== "all" || needle !== "";

  return (
    <div className="space-y-4">
      <DigestSummaryBar digests={digests} />

      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Ebene">
        {LEVELS.map((level) => {
          const selected = filter.level === level.id;
          return (
            <button
              key={level.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => patch({ level: level.id, canton: "" })}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#151414] ${
                selected ? "bg-[#151414] text-white" : "border border-[#8c8b8e] bg-white text-[#151414] hover:border-[#151414]"
              }`}
            >
              {level.label}
              <span className={`text-[13px] font-bold tabular-nums ${selected ? "text-white/80" : "text-[#5f5f64]"}`}>{counts[level.id]}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <button
          type="button"
          onClick={() => setUploadOpen((v) => !v)}
          aria-expanded={uploadOpen}
          className="rounded-xl bg-[#151414] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#2e2e30]"
        >
          Norm hochladen
        </button>
        <input
          value={filter.needle}
          onChange={(e) => patch({ needle: e.target.value })}
          placeholder="Titel, Kategorie oder Ort suchen"
          aria-label="Normen durchsuchen"
          className={`${inputCls} sm:max-w-xs`}
        />
        {filter.level === "cantonal" && cantons.length > 0 && (
          <select value={filter.canton} onChange={(e) => patch({ canton: e.target.value })} aria-label="Kanton filtern" className={SELECT}>
            <option value="">Alle Kantone</option>
            {cantons.map((c) => (
              <option key={c} value={c}>
                {CANTON_NAMES[c] ? `${CANTON_NAMES[c]} (${c})` : c}
              </option>
            ))}
          </select>
        )}
        <select value={filter.digest} onChange={(e) => patch({ digest: e.target.value as DigestFilter })} aria-label="Prüfauszug filtern" className={SELECT}>
          <option value="all">Alle Prüfauszüge</option>
          <option value="active">Auszug aktiv</option>
          <option value="todo">Auszug fehlt oder fehlgeschlagen</option>
          <option value="none">Ohne Auszug</option>
        </select>
        <select value={filter.care} onChange={(e) => patch({ care: e.target.value as CareFilter })} aria-label="Pflege filtern" className={SELECT}>
          <option value="all">Alle Normen</option>
          <option value="watched">Mit automatischem Abgleich</option>
          <option value="manual">Nur manuell gepflegt</option>
        </select>
        {filtered && (
          <button type="button" onClick={() => setFilter(EMPTY_LIBRARY_FILTER)} className="text-sm font-medium text-[#46464a] underline underline-offset-2 hover:text-[#151414]">
            Filter zurücksetzen
          </button>
        )}
      </div>

      {uploadOpen && <AdminNormUpload onUploaded={onUploaded} onClose={() => setUploadOpen(false)} />}

      {loading ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-[rgba(21,20,20,.05)] motion-reduce:animate-none" />
          ))}
        </div>
      ) : shown === 0 ? (
        <p className="rounded-xl border border-[rgba(21,20,20,0.08)] bg-white p-8 text-center text-sm text-[#46464a]">
          {norms.length === 0 ? "Noch keine plattformweiten Normen." : "Keine Normen für diese Auswahl."}
        </p>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => {
            const tone = groupTone(g.label);
            return (
              <details key={g.key} open={needle ? true : !g.key.startsWith("municipal:")} className={`overflow-hidden rounded-xl border-2 bg-white ${tone.edge}`}>
                <summary className={`flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-2.5 ${tone.bar}`}>
                  <h3 className="text-[15px] font-bold">{g.label}</h3>
                  <span className={`text-[13px] ${tone.sub}`}>
                    {g.items.length} {g.items.length === 1 ? "Norm" : "Normen"}
                  </span>
                </summary>
                <ul className="px-4">
                  {g.items.map((entry) => {
                    const row = digests.byNorm.get(entry.norm.id);
                    return (
                      <AdminNormRow
                        key={entry.norm.id}
                        norm={entry.norm}
                        watched={watchedIds.has(entry.norm.id)}
                        onDelete={onDelete}
                        extra={row ? <DigestInline row={row} digests={digests} /> : undefined}
                      />
                    );
                  })}
                </ul>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}
