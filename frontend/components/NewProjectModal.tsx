"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import ParcelSearch, { type ParcelSelection } from "./ParcelSearch";
import type { ParcelIdentityFields } from "./geoportal-logic";

const CANTONS = [
  "AG","AI","AR","BE","BL","BS","FR","GE","GL","GR",
  "JU","LU","NE","NW","OW","SG","SH","SO","SZ","TG",
  "TI","UR","VD","VS","ZG","ZH",
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

const inputStyle: React.CSSProperties = {
  width: "100%", border: "1px solid rgba(240,201,154,0.25)",
  background: "rgba(23,37,64,0.6)", borderRadius: 10, padding: "9px 13px",
  fontSize: 14, color: "#fff", outline: "none", fontFamily: "inherit",
  transition: "box-shadow .15s, border-color .15s", boxSizing: "border-box",
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 5 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#ABAEBB" }}>{label}</label>
        {hint && <span style={{ fontSize: 11, color: "#A7AFBA", fontWeight: 400 }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, required }: {
  value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean;
}) {
  return (
    <input
      type="text" required={required} value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={inputStyle}
      onFocus={e => { e.currentTarget.style.borderColor = "#F0C99A"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(240,201,154,0.28)"; }}
      onBlur={e =>  { e.currentTarget.style.borderColor = "rgba(240,201,154,0.25)"; e.currentTarget.style.boxShadow = "none"; }}
    />
  );
}

export default function NewProjectModal({ onClose, onCreated }: Props) {
  const router = useRouter();
  const [name, setName]                 = useState("");
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
        domain: "bau",
        location: { canton, municipality: municipality.trim(), country: "CH" },
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
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: "#0E111B", borderRadius: 18, boxShadow: "0 30px 70px rgba(0,0,0,0.5)", border: "1px solid rgba(240,201,154,0.2)", width: "100%", maxWidth: 440, padding: 28, maxHeight: "90vh", overflowY: "auto" }}>
        <p style={{ fontSize: 10, fontWeight: 700, color: "#F0C99A", textTransform: "uppercase", letterSpacing: "0.12em", margin: "0 0 6px" }}>Neues Analyseprojekt</p>
        <h2 style={{ fontSize: 19, fontWeight: 800, color: "#fff", margin: "0 0 22px" }}>Projekt erstellen</h2>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          <ParcelSearch onSelect={handleSelect} hint="(füllt die Felder unten)" />

          {pickedLabel && (
            <p style={{ fontSize: 12, color: "#34D399", margin: "-8px 0 0", lineHeight: 1.4, overflowWrap: "anywhere" }}>
              Übernommen: {pickedLabel}{identity?.egrid ? ` (${identity.egrid})` : ""}. Die Felder bleiben korrigierbar.
            </p>
          )}
          {identityDropped && (
            <p style={{ fontSize: 12, color: "#FBBF24", margin: "-8px 0 0", lineHeight: 1.4 }}>
              Von Hand geändert: Das Grundstück aus der Suche gilt nicht mehr. TraceBuild sucht es anhand Ihrer Angaben.
            </p>
          )}

          <div style={{ borderTop: "1px solid rgba(240,201,154,0.12)", margin: "2px 0" }} />

          <Field label="Projektname">
            <TextInput value={name} onChange={setName} required />
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Kanton">
              <select
                value={canton} onChange={e => { setCanton(e.target.value); dropIdentity(); }}
                style={{ ...inputStyle, appearance: "none" as const }}
                onFocus={e => { e.currentTarget.style.borderColor = "#F0C99A"; }}
                onBlur={e =>  { e.currentTarget.style.borderColor = "rgba(240,201,154,0.25)"; }}
              >
                {CANTONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Gemeinde">
              <TextInput value={municipality} onChange={v => { setMunicipality(v); dropIdentity(); }} required />
            </Field>
          </div>

          {/* Divider */}
          <div style={{ borderTop: "1px solid rgba(240,201,154,0.12)", margin: "2px 0" }} />

          <Field label="Parzellennummer">
            <TextInput
              value={parcelNumber}
              onChange={v => { setParcelNumber(v); dropIdentity(); }}
              placeholder="z.B. 1234"
              required={!hasEgrid}
            />
          </Field>

          {/* Vor dem Anlegen steht keine sichere ÖREB-Zone fest, deshalb bleibt das Feld immer da. */}
          <Field label="Bauzone" hint="(optional)">
            <TextInput value={bauzone} onChange={setBauzone} placeholder="z.B. W2" />
            <p style={{ fontSize: 11, color: "#A7AFBA", margin: "5px 0 0", lineHeight: 1.4 }}>
              TraceBuild ermittelt die Zone nach dem Anlegen aus dem ÖREB-Kataster. Ihre Angabe gilt nur, wenn der Kataster keine sichere Zone liefert.
            </p>
          </Field>

          {error && (
            <div style={{ fontSize: 13, color: "#f87171", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: "10px 14px" }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", gap: 12, paddingTop: 4 }}>
            <button type="button" onClick={onClose}
              style={{ flex: 1, border: "1px solid rgba(240,201,154,0.25)", color: "#ABAEBB", padding: 10, borderRadius: 10, fontSize: 14, fontWeight: 500, background: "none", cursor: "pointer", fontFamily: "inherit", transition: "background .15s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(240,201,154,0.1)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "none"; }}
            >
              Abbrechen
            </button>
            <button type="submit" disabled={loading || incomplete}
              style={{
                flex: 1, background: "linear-gradient(135deg,#F0C99A,#B07D3E)",
                color: "#07142B", padding: 10, borderRadius: 10, fontSize: 14, fontWeight: 600,
                border: "none", fontFamily: "inherit",
                cursor: (loading || incomplete) ? "not-allowed" : "pointer",
                opacity: (loading || incomplete) ? 0.5 : 1,
                boxShadow: "0 4px 16px rgba(176,125,62,0.4)", transition: "filter .15s, opacity .15s",
              }}
              onMouseEnter={e => { if (!loading) (e.currentTarget as HTMLElement).style.filter = "brightness(1.1)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.filter = "none"; }}
            >
              {loading ? "ÖREB-Auszug wird abgerufen…" : "Projekt erstellen →"}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}
