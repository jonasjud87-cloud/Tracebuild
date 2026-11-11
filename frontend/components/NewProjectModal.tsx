"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import ParcelSearch, { type ParcelSelection } from "./ParcelSearch";
import type { ParcelIdentityFields } from "./geoportal-logic";
import { PROJECT_NUMBER_MAX } from "@/lib/project-number";
import { countryForCanton } from "@/lib/oereb/cantons";
import css from "./NewProjectModal.module.css";

const CANTONS = [
  "AG","AI","AR","BE","BL","BS","FR","GE","GL","GR",
  "JU","LU","NE","NW","OW","SG","SH","SO","SZ","TG",
  "TI","UR","VD","VS","ZG","ZH","FL",
];

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

interface CreateProjectResponse {
  project: { id: string };
  assigned_norms_count: number;
  zone: string | null;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className={css.fieldHead}>
        <label className={css.label}>{label}</label>
        {hint && <span className={css.hint}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, required, maxLength }: {
  value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean; maxLength?: number;
}) {
  return (
    <input
      type="text" required={required} value={value} maxLength={maxLength}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={css.input}
    />
  );
}

export default function NewProjectModal({ onClose, onCreated }: Props) {
  const router = useRouter();
  const [name, setName]                 = useState("");
  const [projectNumber, setProjectNumber] = useState("");
  const [canton, setCanton]             = useState(CANTONS[0]);
  const [municipality, setMunicipality] = useState("");
  const [parcelNumber, setParcelNumber] = useState("");
  const [bauzone, setBauzone]           = useState("");
  // Grundstück aus der Suche. Jede Handänderung an Kanton, Gemeinde oder Nummer verwirft es.
  const [identity, setIdentity]         = useState<ParcelIdentityFields | null>(null);
  const [pickedLabel, setPickedLabel]   = useState<string | null>(null);
  const [identityDropped, setIdentityDropped] = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [loading, setLoading]           = useState(false);

  const hasEgrid = !!identity?.egrid;
  // Mit EGRID ist das Grundstück auch ohne Nummer bestimmt (die Route verlangt eines von beiden).
  const incomplete = !name.trim() || !municipality.trim() || (!parcelNumber.trim() && !hasEgrid);

  function handleSelect(selection: ParcelSelection) {
    const { fields } = selection;
    if (fields.canton && CANTONS.includes(fields.canton)) setCanton(fields.canton);
    setMunicipality(fields.municipality ?? "");
    setParcelNumber(fields.parcelNumber ?? "");
    setIdentity(fields.identity);
    setPickedLabel(selection.label);
    setIdentityDropped(false);
  }

  /** Von Hand korrigiert: Die EGRID gehört dann nicht mehr sicher zu den Angaben. */
  function dropIdentity() {
    if (!identity) return;
    setIdentity(null);
    setPickedLabel(null);
    setIdentityDropped(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (incomplete) return;
    setError(null);
    setLoading(true);
    try {
      const result = await api.post<CreateProjectResponse>("/projects", {
        name: name.trim(),
        project_number: projectNumber.trim() || null,
        domain: "bau",
        location: { canton, municipality: municipality.trim(), country: countryForCanton(canton) },
        parcel_number: parcelNumber.trim() || null,
        // Die Route nimmt diese Zone nur, wenn der ÖREB-Auszug keine sichere liefert.
        bauzone: bauzone.trim() || null,
        ...(identity ?? {}),
      });
      onCreated();
      onClose();
      router.push(`/projects/${result.project.id}/analysis`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler beim Erstellen");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className={css.overlay}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={css.dialog}>
        <p className={css.eyebrow}>Neues Analyseprojekt</p>
        <h2 className={css.title}>Projekt erstellen</h2>

        <form onSubmit={handleSubmit} className={css.form}>

          <ParcelSearch tone="light" onSelect={handleSelect} hint="(füllt die Felder unten)" />

          {pickedLabel && (
            <p className={css.ok}>
              Übernommen: {pickedLabel}{identity?.egrid ? ` (${identity.egrid})` : ""}. Die Felder bleiben korrigierbar.
            </p>
          )}
          {identityDropped && (
            <p className={css.warn}>
              Von Hand geändert: Das Grundstück aus der Suche gilt nicht mehr. TraceBuild sucht es anhand Ihrer Angaben.
            </p>
          )}

          <div className={css.divider} />

          <Field label="Projektname">
            <TextInput value={name} onChange={setName} required />
          </Field>

          <Field label="Projektnummer" hint="(optional)">
            <TextInput value={projectNumber} onChange={setProjectNumber} placeholder="z.B. 2024-017" maxLength={PROJECT_NUMBER_MAX} />
            <p className={css.note}>Ihre interne Nummer. Sie muss in Ihrer Organisation eindeutig sein.</p>
          </Field>

          <div className={css.grid}>
            <Field label="Kanton">
              <select
                value={canton} onChange={e => { setCanton(e.target.value); dropIdentity(); }}
                className={`${css.input} ${css.select}`}
              >
                {CANTONS.map(c => <option key={c} value={c}>{c === "FL" ? "FL (Liechtenstein)" : c}</option>)}
              </select>
            </Field>
            <Field label="Gemeinde">
              <TextInput value={municipality} onChange={v => { setMunicipality(v); dropIdentity(); }} required />
            </Field>
          </div>

          <div className={css.divider} />

          <Field label="Parzellennummer">
            <TextInput
              value={parcelNumber}
              onChange={v => { setParcelNumber(v); dropIdentity(); }}
              placeholder="z.B. 1234"
              required={!hasEgrid}
            />
          </Field>

          <Field label="Bauzone" hint="(optional)">
            <TextInput value={bauzone} onChange={setBauzone} placeholder="z.B. W2" />
            <p className={css.note}>
              TraceBuild ermittelt die Zone nach dem Anlegen aus dem ÖREB-Kataster. Ihre Angabe gilt nur, wenn der Kataster keine sichere Zone liefert.
            </p>
          </Field>

          {error && <div className={css.error}>{error}</div>}

          <div className={css.actions}>
            <button type="button" onClick={onClose} className={css.cancel}>
              Abbrechen
            </button>
            <button type="submit" disabled={loading || incomplete} className={css.submit}>
              {loading ? "ÖREB-Auszug wird abgerufen…" : "Projekt erstellen →"}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}
