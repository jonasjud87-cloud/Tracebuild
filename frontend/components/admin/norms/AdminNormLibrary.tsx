"use client";

import { useMemo, useState } from "react";
import AdminNormRow from "./AdminNormRow";
import AdminNormUpload from "./AdminNormUpload";
import { inputCls, type AdminNorm } from "./admin-norm-types";
import { groupByJurisdiction } from "./norm-watch-groups";

type LevelFilter = "all" | "national" | "cantonal" | "municipal";
type CareFilter = "all" | "watched" | "manual";

interface Props {
  norms: AdminNorm[];
  loading: boolean;
  watchedIds: Set<string>;
  onDelete: (id: string) => void;
  onUploaded: () => void;
}

interface Entry {
  jurisdictionType: string;
  jurisdictionName: string | null;
  norm: AdminNorm;
}

export default function AdminNormLibrary({ norms, loading, watchedIds, onDelete, onUploaded }: Props) {
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState<LevelFilter>("all");
  const [care, setCare] = useState<CareFilter>("all");
  const [uploadOpen, setUploadOpen] = useState(false);

  const needle = search.trim().toLowerCase();

  const groups = useMemo(() => {
    const entries: Entry[] = norms
      .filter((n) => level === "all" || n.jurisdiction_type === level)
      .filter((n) => care === "all" || (care === "watched" ? watchedIds.has(n.id) : !watchedIds.has(n.id)))
      .filter(
        (n) =>
          !needle ||
          n.title?.toLowerCase().includes(needle) ||
          n.category.toLowerCase().includes(needle) ||
          n.jurisdiction_name?.toLowerCase().includes(needle),
      )
      .map((n) => ({ jurisdictionType: n.jurisdiction_type, jurisdictionName: n.jurisdiction_name, norm: n }));
    return groupByJurisdiction(entries);
  }, [norms, level, care, needle, watchedIds]);

  const shown = groups.reduce((sum, g) => sum + g.items.length, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={() => setUploadOpen((v) => !v)}
          aria-expanded={uploadOpen}
          className="rounded-xl bg-[#151414] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#2e2e30]"
        >
          Norm hochladen
        </button>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Titel, Kategorie oder Ort suchen"
          aria-label="Normen durchsuchen"
          className={`${inputCls} sm:max-w-xs`}
        />
        <select value={level} onChange={(e) => setLevel(e.target.value as LevelFilter)} aria-label="Ebene filtern" className={`${inputCls} w-auto appearance-none sm:py-2`}>
          <option value="all">Alle Ebenen</option>
          <option value="national">Bund</option>
          <option value="cantonal">Kanton</option>
          <option value="municipal">Gemeinde</option>
        </select>
        <select value={care} onChange={(e) => setCare(e.target.value as CareFilter)} aria-label="Pflege filtern" className={`${inputCls} w-auto appearance-none sm:py-2`}>
          <option value="all">Alle Normen</option>
          <option value="watched">Mit automatischem Abgleich</option>
          <option value="manual">Nur manuell gepflegt</option>
        </select>
      </div>

      {uploadOpen && (
        <AdminNormUpload
          onUploaded={onUploaded}
          onClose={() => setUploadOpen(false)}
        />
      )}

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
        <div className="space-y-3">
          {groups.map((g) => (
            <details
              key={g.key}
              open={needle ? true : !g.key.startsWith("municipal:")}
              className="tba-glass tba-glass--flat rounded-[20px] px-5 py-1"
            >
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 py-3.5">
                <h3 className="text-[15px] font-bold text-[#151414]">{g.label}</h3>
                <span className="text-[13px] text-[#5f5f64]">
                  {g.items.length} {g.items.length === 1 ? "Norm" : "Normen"}
                </span>
              </summary>
              <ul>
                {g.items.map((entry) => (
                  <AdminNormRow key={entry.norm.id} norm={entry.norm} watched={watchedIds.has(entry.norm.id)} onDelete={onDelete} />
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
