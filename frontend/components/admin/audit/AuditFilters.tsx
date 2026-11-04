"use client";

import { ACTION_LABELS, EMPTY_FILTERS } from "./types";
import type { AuditFilterState, OrgOption } from "./types";

const FIELD =
  "w-full border border-[rgba(133,166,233,0.25)] rounded-xl px-3 py-2.5 text-sm text-white bg-[rgba(23,37,64,0.6)] focus:outline-none focus:ring-2 focus:ring-[#2862D7]/40 focus:border-[#2862D7] transition-colors placeholder:text-[#7B8299]";

function Label({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-semibold text-[#7B8299] uppercase tracking-widest mb-1.5">{text}</span>
      {children}
    </label>
  );
}

interface Props {
  value: AuditFilterState;
  orgs: OrgOption[];
  exporting: boolean;
  canExport: boolean;
  onChange: (next: AuditFilterState) => void;
  onExport: () => void;
}

export default function AuditFilters({ value, orgs, exporting, canExport, onChange, onExport }: Props) {
  const set = (patch: Partial<AuditFilterState>) => onChange({ ...value, ...patch });
  const dirty = JSON.stringify(value) !== JSON.stringify(EMPTY_FILTERS);

  return (
    <div className="bg-[#172540] border border-[rgba(60,63,68,0.5)] rounded-2xl p-4 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Label text="Suche">
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7B8299] pointer-events-none"
              width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true"
            >
              <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.3" />
              <path d="M9 9L11.5 11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            <input
              value={value.q}
              maxLength={80}
              onChange={e => set({ q: e.target.value })}
              placeholder="E-Mail oder Aktion..."
              className={`${FIELD} pl-8`}
            />
          </div>
        </Label>
        <Label text="Organisation">
          <select value={value.org} onChange={e => set({ org: e.target.value })} className={FIELD}>
            <option value="">Alle Organisationen</option>
            <option value="none">Plattform (ohne Organisation)</option>
            {orgs.map(o => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </Label>
        <Label text="Aktion">
          <select value={value.action} onChange={e => set({ action: e.target.value })} className={FIELD}>
            <option value="">Alle Aktionen</option>
            {Object.entries(ACTION_LABELS).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
        </Label>
        <Label text="Akteur">
          <input
            value={value.actor}
            maxLength={120}
            onChange={e => set({ actor: e.target.value })}
            placeholder="E-Mail-Teilstring"
            className={FIELD}
          />
        </Label>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="grid grid-cols-2 gap-3 sm:w-96">
          <Label text="Von">
            <input type="date" value={value.from} max={value.to || undefined} onChange={e => set({ from: e.target.value })} className={`${FIELD} [color-scheme:dark]`} />
          </Label>
          <Label text="Bis">
            <input type="date" value={value.to} min={value.from || undefined} onChange={e => set({ to: e.target.value })} className={`${FIELD} [color-scheme:dark]`} />
          </Label>
        </div>
        <div className="flex items-center gap-2 sm:ml-auto">
          {dirty && (
            <button
              type="button"
              onClick={() => onChange(EMPTY_FILTERS)}
              className="text-sm font-medium text-[#ABAEBB] hover:text-white px-3 py-2.5 transition-colors"
            >
              Zurücksetzen
            </button>
          )}
          <button
            type="button"
            onClick={onExport}
            disabled={exporting || !canExport}
            className="flex items-center gap-2 bg-[#2862D7] text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-[#3470E8] active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none transition-all shadow-sm shadow-[#2862D7]/25 whitespace-nowrap"
          >
            <svg width="14" height="14" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path d="M9 11V3M6 8L9 11L12 8M3 13V15H15V13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {exporting ? "Exportiere..." : "CSV exportieren"}
          </button>
        </div>
      </div>
    </div>
  );
}
