"use client";

import { useId } from "react";
import { CANTON_NAMES } from "@/lib/norm-groups";
import { PRIORITIES, SCOPE_MODES, type NormPriority, type ScopeMode } from "@/lib/company-norms";
import s from "./standards.module.css";

export interface ScopeValue {
  priority: NormPriority;
  mode: ScopeMode;
  cantons: string[];
  projectIds: string[];
}

export interface ProjectOption {
  id: string;
  name: string;
}

export const DEFAULT_SCOPE: ScopeValue = { priority: "advisory", mode: "all", cantons: [], projectIds: [] };

const CANTONS = Object.keys(CANTON_NAMES);

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((v) => v !== id) : list.concat(id);
}

interface Props {
  value: ScopeValue;
  onChange: (next: ScopeValue) => void;
  projects: ProjectOption[];
  disabled?: boolean;
}

export default function ScopeFields({ value, onChange, projects, disabled }: Props) {
  const uid = useId();
  const priorityHint = PRIORITIES.find((p) => p.value === value.priority)?.hint;

  return (
    <>
      <div>
        <label htmlFor={`${uid}-priority`} className={s.label}>
          Verbindlichkeit
        </label>
        <select
          id={`${uid}-priority`}
          value={value.priority}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, priority: e.target.value as NormPriority })}
          className={s.input}
        >
          {PRIORITIES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        {priorityHint && <p className={s.fieldHint}>{priorityHint}</p>}
      </div>

      <div>
        <label htmlFor={`${uid}-mode`} className={s.label}>
          Gilt für
        </label>
        <select
          id={`${uid}-mode`}
          value={value.mode}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, mode: e.target.value as ScopeMode })}
          className={s.input}
        >
          {SCOPE_MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <p className={s.fieldHint}>Gesetzliche Normen gelten unabhängig davon immer.</p>
      </div>

      {value.mode === "cantons" && (
        <fieldset className={`${s.fieldFull} ${s.checkSet}`} disabled={disabled}>
          <legend className={s.label}>Kantone</legend>
          <div className={s.checkGrid}>
            {CANTONS.map((c) => (
              <label key={c} className={s.checkItem}>
                <input type="checkbox" checked={value.cantons.includes(c)} onChange={() => onChange({ ...value, cantons: toggle(value.cantons, c) })} />
                <span>{c}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {value.mode === "projects" && (
        <fieldset className={`${s.fieldFull} ${s.checkSet}`} disabled={disabled}>
          <legend className={s.label}>Projekte</legend>
          {projects.length === 0 ? (
            <p className={s.fieldHint}>Ihre Organisation hat noch keine Projekte.</p>
          ) : (
            <div className={s.checkList}>
              {projects.map((p) => (
                <label key={p.id} className={s.checkItem}>
                  <input type="checkbox" checked={value.projectIds.includes(p.id)} onChange={() => onChange({ ...value, projectIds: toggle(value.projectIds, p.id) })} />
                  <span>{p.name}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
      )}
    </>
  );
}

export function scopeError(value: ScopeValue): string | null {
  if (value.mode === "cantons" && value.cantons.length === 0) return "Bitte mindestens einen Kanton wählen.";
  if (value.mode === "projects" && value.projectIds.length === 0) return "Bitte mindestens ein Projekt wählen.";
  return null;
}
