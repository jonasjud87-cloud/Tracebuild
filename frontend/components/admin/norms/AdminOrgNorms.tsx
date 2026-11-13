"use client";

import { useMemo, useState } from "react";
import AdminNormRow from "./AdminNormRow";
import { inputCls, type AdminNorm } from "./admin-norm-types";
import { groupLabel } from "./norm-watch-groups";

interface Props {
  norms: AdminNorm[];
  loading: boolean;
  promotingId: string | null;
  onPromote: (id: string) => void;
  onDelete: (id: string) => void;
}

interface OrgGroup {
  key: string;
  name: string;
  norms: AdminNorm[];
}

export default function AdminOrgNorms({ norms, loading, promotingId, onPromote, onDelete }: Props) {
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();

  const groups = useMemo<OrgGroup[]>(() => {
    const map = new Map<string, OrgGroup>();
    for (const n of norms) {
      if (!n.org_id) continue;
      const name = n.org_name ?? "Unbekannte Organisation";
      const matches =
        !needle ||
        name.toLowerCase().includes(needle) ||
        n.title?.toLowerCase().includes(needle) ||
        n.category.toLowerCase().includes(needle) ||
        n.jurisdiction_name?.toLowerCase().includes(needle);
      if (!matches) continue;
      const group = map.get(n.org_id) ?? { key: n.org_id, name, norms: [] };
      group.norms.push(n);
      map.set(n.org_id, group);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "de"));
  }, [norms, needle]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#5f5f64]">
        Normen, die Organisationen selbst hochgeladen haben. Sie gelten nur für die jeweilige Organisation. Mit «Für alle Organisationen freigeben» wird eine
        Norm plattformweit.
      </p>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Organisation, Titel oder Kategorie suchen"
        aria-label="Organisations-Normen durchsuchen"
        className={`${inputCls} sm:max-w-sm`}
      />

      {loading ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-[rgba(21,20,20,.05)] motion-reduce:animate-none" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <p className="rounded-xl border border-[rgba(21,20,20,0.08)] bg-white p-8 text-center text-sm text-[#46464a]">
          {needle ? "Keine Normen für diese Suche." : "Noch keine Normen von Organisationen."}
        </p>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <details key={g.key} open className="tba-glass tba-glass--flat rounded-[20px] px-5 py-1">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 py-3.5">
                <h3 className="text-[15px] font-bold text-[#151414]">{g.name}</h3>
                <span className="text-[13px] text-[#5f5f64]">
                  {g.norms.length} {g.norms.length === 1 ? "Norm" : "Normen"}
                </span>
              </summary>
              <ul>
                {g.norms.map((n) => (
                  <li key={n.id} className="border-b border-[rgba(21,20,20,0.08)] last:border-0">
                    <p className="pt-3 text-[13px] font-semibold uppercase tracking-wide text-[#5f5f64]">
                      {groupLabel(n.jurisdiction_type, n.jurisdiction_name)}
                    </p>
                    <ul>
                      <AdminNormRow norm={n} promoting={promotingId === n.id} onPromote={onPromote} onDelete={onDelete} />
                    </ul>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
